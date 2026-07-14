"use client";

import { Paperclip, Pencil, Save, Trash2, Upload, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import type { MediaAsset } from "@/lib/crm/types";
import { MAX_EMAIL_ATTACHMENT_BYTES } from "@/lib/email/attachments";

export function isImageMediaAsset(asset: Pick<MediaAsset, "contentType">): boolean {
  return asset.contentType.toLowerCase().startsWith("image/");
}

export function mediaAssetDataUrl(asset: MediaAsset): string {
  return asset.contentBase64 ? `data:${asset.contentType};base64,${asset.contentBase64}` : asset.contentUrl ?? `/api/media-assets/${encodeURIComponent(asset.id)}/content`;
}

export function MediaAssetPreview({ asset }: { asset: MediaAsset }) {
  if (isImageMediaAsset(asset)) {
    return <img alt={asset.name} src={mediaAssetDataUrl(asset)} />;
  }

  return (
    <div className="media-file-preview">
      <Paperclip size={22} />
      <span>{mediaAssetExtension(asset.name) || asset.contentType}</span>
    </div>
  );
}

export function MediaLibraryModal({
  accept,
  canSelectAsset,
  description,
  disabled,
  mediaAssets,
  onClose,
  onDeleteMediaAsset,
  onSelect,
  onUpdateMediaAsset,
  onUploadMediaAssets,
  selectFirstUploaded = false,
  selectLabel = "选择",
  testId,
  title
}: {
  accept?: string;
  canSelectAsset?: (asset: MediaAsset) => boolean;
  description: string;
  disabled?: boolean;
  mediaAssets: MediaAsset[];
  onClose: () => void;
  onDeleteMediaAsset?: (asset: MediaAsset) => void;
  onSelect: (asset: MediaAsset) => void;
  onUpdateMediaAsset?: (assetId: string, patch: Partial<Pick<MediaAsset, "name" | "contentType" | "size" | "contentBase64">>) => void;
  onUploadMediaAssets: (files: FileList | File[] | null) => Promise<MediaAsset[]>;
  selectFirstUploaded?: boolean;
  selectLabel?: string;
  testId: string;
  title: string;
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const editingAsset = mediaAssets.find((asset) => asset.id === editingAssetId);
  const visibleMediaAssets = canSelectAsset ? mediaAssets.filter(canSelectAsset) : mediaAssets;

  async function uploadFiles(files: FileList | File[] | null) {
    const uploaded = await onUploadMediaAssets(files);
    const selectableUploaded = canSelectAsset ? uploaded.find(canSelectAsset) : uploaded[0];
    if (selectFirstUploaded && selectableUploaded) {
      onSelect(selectableUploaded);
    }
  }

  async function replaceEditingAsset(files: FileList | null) {
    const file = files?.[0];
    if (!editingAsset || !file || !onUpdateMediaAsset) {
      return;
    }
    if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
      return;
    }
    onUpdateMediaAsset(editingAsset.id, {
      name: nameDraft.trim() || file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      contentBase64: await readFileAsBase64(file)
    });
    setEditingAssetId("");
    setNameDraft("");
  }

  function saveEditingAssetName(asset: MediaAsset) {
    const nextName = nameDraft.trim();
    if (!nextName || !onUpdateMediaAsset) {
      return;
    }
    onUpdateMediaAsset(asset.id, { name: nextName });
    setEditingAssetId("");
    setNameDraft("");
  }

  return (
    <div className="modal-backdrop" data-testid={testId} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel media-library-modal">
        <div className="email-pane-header compact">
          <div>
            <h2 className="page-title" style={{ fontSize: 18 }}>{title}</h2>
            <p className="subtle">{description}</p>
          </div>
          <button className="icon-button" aria-label="关闭媒体库" type="button" onClick={onClose}>
            <XCircle size={16} />
          </button>
        </div>
        <div
          className={`email-attachment-dropzone ${dragActive ? "active" : ""}`}
          data-testid={`${testId}-dropzone`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void uploadFiles(event.dataTransfer.files);
          }}
        >
          <Upload size={24} />
          <strong>拖拽文件到这里</strong>
          <span className="subtle">或从本地选择文件，上传后可复用于产品、联系人、公司、邮件和活动附件。</span>
          <button className="secondary-button" type="button" onClick={() => uploadInputRef.current?.click()} disabled={disabled}>
            <Upload size={16} />
            上传文件
          </button>
          <input
            ref={uploadInputRef}
            hidden
            accept={accept}
            multiple
            type="file"
            onChange={(event) => {
              void uploadFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={replaceInputRef}
            hidden
            accept={accept}
            type="file"
            onChange={(event) => {
              void replaceEditingAsset(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        {visibleMediaAssets.length ? (
          <div className="media-library-grid">
            {visibleMediaAssets.map((asset) => (
              <div className="media-library-card" key={asset.id}>
                <button className="media-library-select" type="button" onClick={() => onSelect(asset)}>
                  <MediaAssetPreview asset={asset} />
                </button>
                {editingAssetId === asset.id ? (
                  <div className="media-library-edit">
                    <input className="input" data-testid={`media-asset-name-${asset.id}`} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
                    <div className="toolbar compact-toolbar">
                      <button className="secondary-button" type="button" onClick={() => saveEditingAssetName(asset)} disabled={disabled || !nameDraft.trim() || !onUpdateMediaAsset}>
                        <Save size={14} />
                        保存
                      </button>
                      <button className="secondary-button" type="button" onClick={() => replaceInputRef.current?.click()} disabled={disabled || !onUpdateMediaAsset}>
                        <Upload size={14} />
                        替换
                      </button>
                      <button className="secondary-button" type="button" onClick={() => setEditingAssetId("")}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="media-library-card-footer">
                    <span title={asset.name}>{asset.name}</span>
                    <div className="toolbar compact-toolbar">
                      <button className="secondary-button" type="button" onClick={() => onSelect(asset)}>
                        {selectLabel}
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`编辑 ${asset.name}`}
                        data-testid={`media-asset-edit-${asset.id}`}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditingAssetId(asset.id);
                          setNameDraft(asset.name);
                        }}
                        disabled={disabled || !onUpdateMediaAsset}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-button danger-button"
                        aria-label={`删除 ${asset.name}`}
                        data-testid={`media-asset-delete-${asset.id}`}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onDeleteMediaAsset?.(asset);
                        }}
                        disabled={disabled || !onDeleteMediaAsset}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">媒体库暂无可选文件</div>
        )}
      </div>
    </div>
  );
}

function mediaAssetExtension(name: string): string {
  const extension = name.split(".").pop()?.trim();
  return extension && extension !== name ? extension.toUpperCase() : "";
}

function readFileAsBase64(file: File, onProgress?: (progress: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.min(98, Math.max(8, Math.round((event.loaded / event.total) * 100))));
      }
    });
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",", 2)[1] ?? "" : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取文件失败")));
    reader.readAsDataURL(file);
  });
}
