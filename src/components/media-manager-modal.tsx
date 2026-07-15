"use client";

import { Check, Download, File, Grid2X2, List, Loader2, RefreshCw, Search, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaAsset } from "@/lib/crm/types";
import type { DiscussionTarget } from "@/lib/discussions/types";
import type { MediaAssetDto } from "@/lib/media/service";

type QueueItem = { id: string; file: File; progress: number; status: "queued" | "uploading" | "done" | "error"; error?: string; asset?: MediaAssetDto };
export type MediaManagerAssetKind = "image" | "all";
export type MediaManagerScopeMode = "workspace" | "target-and-workspace";
export type MediaManagerSelectionMode = "single" | "multiple";

export function mediaAssetContentUrl(asset: Pick<MediaAsset, "id" | "contentBase64" | "contentType" | "contentUrl"> | MediaAssetDto): string {
  if ("contentBase64" in asset && asset.contentBase64) return `data:${asset.contentType};base64,${asset.contentBase64}`;
  return asset.contentUrl ?? `/api/media-assets/${encodeURIComponent(asset.id)}/content`;
}

export function isImageMediaAsset(asset: Pick<MediaAsset, "contentType"> | MediaAssetDto): boolean {
  return asset.contentType.toLowerCase().startsWith("image/");
}

export function mediaAssetToDto(asset: MediaAsset): MediaAssetDto {
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    name: asset.name,
    contentType: asset.contentType,
    size: asset.size,
    scope: asset.scope ?? "WORKSPACE",
    targetKey: asset.targetKey,
    archivedAt: asset.archivedAt,
    createdById: asset.createdById,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    contentUrl: mediaAssetContentUrl(asset),
    referenceCount: asset.referenceCount ?? 0
  };
}

export function MediaAssetPreview({ asset }: { asset: MediaAsset | MediaAssetDto }) {
  return isImageMediaAsset(asset) ? <img alt={asset.name} src={mediaAssetContentUrl(asset)} /> : <span className="media-manager-file-icon"><File size={28} /></span>;
}

export function MediaManagerModal({
  assetKind = "all",
  scopeMode = "target-and-workspace",
  selectionMode = "multiple",
  target,
  initialSelected = [],
  maxFiles,
  maxTotalBytes = 50 * 1024 * 1024,
  title,
  description,
  confirmLabel,
  testId = "media-manager-modal",
  onClose,
  onConfirm
}: {
  assetKind?: MediaManagerAssetKind;
  scopeMode?: MediaManagerScopeMode;
  selectionMode?: MediaManagerSelectionMode;
  target?: DiscussionTarget;
  initialSelected?: MediaAssetDto[];
  maxFiles?: number;
  maxTotalBytes?: number;
  title?: string;
  description?: string;
  confirmLabel?: string;
  testId?: string;
  onClose: () => void;
  onConfirm: (assets: MediaAssetDto[]) => void;
}) {
  if (scopeMode === "target-and-workspace" && !target) throw new Error("MediaManagerModal target is required for target-and-workspace scope");
  const effectiveMaxFiles = selectionMode === "single" ? 1 : maxFiles ?? 10;
  const [tab, setTab] = useState<"TARGET" | "WORKSPACE">(scopeMode === "workspace" ? "WORKSPACE" : "TARGET");
  const [assets, setAssets] = useState<MediaAssetDto[]>([]);
  const [selected, setSelected] = useState(() => new Map(initialSelected.map((asset) => [asset.id, asset])));
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, XMLHttpRequest>());
  const targetKey = target ? buildTargetKey(target) : "";
  const imageOnly = assetKind === "image";

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const params = new URLSearchParams({ scope: tab, limit: "100" });
      if (tab === "TARGET") params.set("targetKey", targetKey);
      if (query.trim()) params.set("q", query.trim());
      if (imageOnly) params.set("type", "image"); else if (kind) params.set("type", kind);
      const response = await fetch(`/api/media-assets?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "加载媒体失败");
      setAssets((payload.assets ?? []).filter((asset: MediaAssetDto) => !imageOnly || isImageMediaAsset(asset)));
    } catch (loadError) { setError(messageOf(loadError)); } finally { setLoading(false); }
  }, [imageOnly, kind, query, tab, targetKey]);

  useEffect(() => { void loadAssets(); }, [loadAssets]);
  useEffect(() => () => controllers.current.forEach((xhr) => xhr.abort()), []);

  function addFiles(files: FileList | File[]) {
    const candidates = Array.from(files);
    const accepted = imageOnly ? candidates.filter((file) => file.type.toLowerCase().startsWith("image/")) : candidates;
    const rejected = candidates.length - accepted.length;
    if (rejected) setError(`${rejected} 个非图片文件已跳过。`); else setError(undefined);
    const uploadFiles = selectionMode === "single" ? accepted.slice(0, 1) : accepted;
    if (selectionMode === "single" && accepted.length > 1) setError("一次只能选择或上传 1 张图片，其他文件已跳过。");
    const items = uploadFiles.map((file) => ({ id: `${Date.now()}-${crypto.randomUUID()}`, file, progress: 0, status: "queued" as const }));
    if (!items.length) return;
    setQueue((current) => [...current, ...items]);
    void runQueue(items);
  }

  async function runQueue(items: QueueItem[]) {
    let index = 0;
    const worker = async () => {
      while (index < items.length) {
        const item = items[index++];
        if (item) await uploadOne(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  }

  async function uploadOne(item: QueueItem) {
    if (imageOnly && !item.file.type.toLowerCase().startsWith("image/")) {
      setQueue((current) => patchQueue(current, item.id, { status: "error", error: "只能上传图片文件" }));
      return;
    }
    setQueue((current) => patchQueue(current, item.id, { status: "uploading", progress: 1, error: undefined }));
    try {
      const asset = await xhrUpload(item, target, tab, controllers, (progress) => setQueue((current) => patchQueue(current, item.id, { progress })));
      if (imageOnly && !isImageMediaAsset(asset)) throw new Error("服务器返回的文件不是图片");
      setQueue((current) => patchQueue(current, item.id, { status: "done", progress: 100, asset }));
      setAssets((current) => [asset, ...current.filter((candidate) => candidate.id !== asset.id)]);
      toggleAsset(asset, true);
    } catch (uploadError) {
      setQueue((current) => patchQueue(current, item.id, { status: "error", error: messageOf(uploadError) }));
    }
  }

  function toggleAsset(asset: MediaAssetDto, force?: boolean) {
    setSelected((current) => {
      if (selectionMode === "single") {
        if (force !== true && current.has(asset.id)) return new Map();
        return new Map([[asset.id, asset]]);
      }
      const next = new Map(current);
      if (force === true || !next.has(asset.id)) next.set(asset.id, asset); else next.delete(asset.id);
      return next;
    });
  }

  const selectedAssets = [...selected.values()];
  const totalBytes = selectedAssets.reduce((total, asset) => total + asset.size, 0);
  const validSelection = selectedAssets.length > 0 && selectedAssets.length <= effectiveMaxFiles && totalBytes <= maxTotalBytes;
  const uploading = queue.some((item) => item.status === "uploading" || item.status === "queued");
  const resolvedTitle = title ?? (imageOnly ? "选择图片" : "图片与附件");
  const resolvedDescription = description ?? (imageOnly ? "上传图片，或从工作区媒体库选择已有素材。" : "拖拽批量上传，或选择已有素材。");

  return (
    <div className="modal-backdrop media-manager-backdrop" role="dialog" aria-modal="true" aria-label={resolvedTitle} data-testid={testId}>
      <div className="modal-panel media-manager-modal">
        <header className="media-manager-header"><div><h2>{resolvedTitle}</h2><p className="subtle">{resolvedDescription}</p></div><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
        {scopeMode === "target-and-workspace" ? <div className="media-manager-tabs"><button className={tab === "TARGET" ? "active" : ""} onClick={() => setTab("TARGET")}>当前记录</button><button className={tab === "WORKSPACE" ? "active" : ""} onClick={() => setTab("WORKSPACE")}>工作区媒体库</button></div> : null}
        <div className="media-manager-tools"><label><Search size={15} /><input value={query} placeholder={imageOnly ? "搜索图片名" : "搜索文件名"} onChange={(event) => setQuery(event.target.value)} /></label>{imageOnly ? null : <select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">全部类型</option><option value="image">图片</option><option value="file">其他文件</option></select>}<span className="media-manager-view"><button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid2X2 size={15} /></button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={15} /></button></span></div>
        <div className={`media-manager-dropzone ${dragActive ? "active" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragActive(false)} onDrop={(event) => { event.preventDefault(); setDragActive(false); addFiles(event.dataTransfer.files); }}>
          <Upload size={22} /><span><strong>{imageOnly ? "拖拽图片到这里" : "拖拽文件到这里"}</strong><small>单文件最大 20 MB，最多 3 个文件同时上传</small></span><button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}>{imageOnly ? "选择图片" : "选择文件"}</button><input ref={fileInput} accept={imageOnly ? "image/*" : undefined} hidden multiple={selectionMode === "multiple"} type="file" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
        </div>
        {queue.length ? <div className="media-upload-queue">{queue.map((item) => <div key={item.id}><File size={16} /><span><strong>{item.file.name}</strong><small>{item.error || `${formatBytes(item.file.size)} · ${item.status === "done" ? "已完成" : item.status === "error" ? "失败" : `${item.progress}%`}`}</small><i><b style={{ width: `${item.progress}%` }} /></i></span>{item.status === "uploading" ? <button onClick={() => controllers.current.get(item.id)?.abort()}><X size={14} /></button> : item.status === "error" ? <button onClick={() => void uploadOne(item)}><RefreshCw size={14} /></button> : <Check size={15} />}</div>)}</div> : null}
        {error ? <div className="discussion-error">{error}</div> : null}
        <div className={`media-manager-assets ${view}`}>{loading ? <div className="discussion-state"><Loader2 className="spin-icon" size={18} />加载中…</div> : assets.map((asset) => { const active = selected.has(asset.id); return <button className={`media-manager-asset ${active ? "selected" : ""}`} type="button" key={asset.id} onClick={() => toggleAsset(asset)}><MediaAssetPreview asset={asset} /><span><strong title={asset.name}>{asset.name}</strong><small>{formatBytes(asset.size)} · 引用 {asset.referenceCount}</small></span>{active ? <i><Check size={13} /></i> : null}<a href={`${asset.contentUrl}?download=1`} onClick={(event) => event.stopPropagation()} aria-label={`下载 ${asset.name}`}><Download size={14} /></a></button>; })}</div>
        <footer className="media-manager-footer"><span className={!validSelection && selectedAssets.length ? "danger-text" : "subtle"}>已选 {selectedAssets.length}/{effectiveMaxFiles} 个，{formatBytes(totalBytes)}/{formatBytes(maxTotalBytes)}</span><div><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={!validSelection || uploading} onClick={() => onConfirm(selectedAssets)}>{confirmLabel ?? (selectionMode === "single" ? "使用所选图片" : "添加所选文件")}</button></div></footer>
      </div>
    </div>
  );
}

function xhrUpload(item: QueueItem, target: DiscussionTarget | undefined, scope: "TARGET" | "WORKSPACE", controllers: React.MutableRefObject<Map<string, XMLHttpRequest>>, onProgress: (value: number) => void): Promise<MediaAssetDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); controllers.current.set(item.id, xhr);
    const form = new FormData(); form.append("files", item.file); form.set("scope", scope);
    if (scope === "TARGET" && target) { form.set("targetType", target.type); form.set("targetId", target.targetId); if (target.type === "record") form.set("objectKey", target.objectKey); }
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.max(1, Math.round(event.loaded / event.total * 100))); };
    xhr.onerror = () => reject(new Error("网络错误")); xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.onload = () => { controllers.current.delete(item.id); try { const payload = JSON.parse(xhr.responseText); const result = payload.results?.[0]; if (xhr.status < 200 || xhr.status >= 300 || !result?.ok) reject(new Error(result?.error || payload.error || "上传失败")); else resolve(result.asset); } catch { reject(new Error("上传响应无效")); } };
    xhr.open("POST", "/api/media-assets"); xhr.send(form);
  });
}

function patchQueue(queue: QueueItem[], id: string, patch: Partial<QueueItem>) { return queue.map((item) => item.id === id ? { ...item, ...patch } : item); }
function buildTargetKey(target: DiscussionTarget) { return target.type === "record" ? `record:${target.objectKey}:${target.targetId}` : `${target.type}:${target.targetId}`; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : "操作失败"; }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
