"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Blocks, CalendarPlus, Columns3, Eye, FilePlus2, GripVertical, Image as ImageIcon, Redo2, Rows3, SeparatorHorizontal, Table2, TextCursorInput, Trash2, Undo2, XCircle } from "lucide-react";
import type { MediaAsset } from "@/lib/crm/types";
import { isImageMediaAsset, mediaAssetContentUrl } from "@/components/media-manager-modal";

type JsonRecord = Record<string, unknown>;
type Path = Array<string | number>;
type PaletteKind = "text" | "todayOffset" | "row" | "splitter" | "table" | "image" | "condition" | "pageBreak";
type BlockKind = "documentHeader" | "customerDetails" | "totals" | "payment" | "signature";

interface DocumentTemplateVisualEditorProps {
  value: string;
  onChange: (value: string) => void;
  mediaAssets?: MediaAsset[];
  preview?: { objectKey: string; recordId: string };
}

const palette: Array<{ kind: PaletteKind; label: string; icon: typeof TextCursorInput }> = [
  { kind: "text", label: "文本", icon: TextCursorInput },
  { kind: "todayOffset", label: "距离今日 + N 天", icon: CalendarPlus },
  { kind: "row", label: "行 / 列", icon: Rows3 },
  { kind: "splitter", label: "分隔线", icon: SeparatorHorizontal },
  { kind: "table", label: "产品表格", icon: Table2 },
  { kind: "image", label: "图片", icon: ImageIcon }
  ,{ kind: "condition", label: "条件区块", icon: Blocks }
  ,{ kind: "pageBreak", label: "分页符", icon: FilePlus2 }
];

const templateBlocks: Array<{ kind: BlockKind; label: string }> = [
  { kind: "documentHeader", label: "文档页头" },
  { kind: "customerDetails", label: "客户信息" },
  { kind: "totals", label: "金额汇总" },
  { kind: "payment", label: "付款信息" },
  { kind: "signature", label: "签名区" }
];

export function DocumentTemplateVisualEditor({ value, onChange, mediaAssets = [], preview }: DocumentTemplateVisualEditorProps) {
  const parsed = useMemo(() => parseTemplate(value), [value]);
  const [mode, setMode] = useState<"visual" | "json">("visual");
  const [selectedPath, setSelectedPath] = useState<Path>(["content", 0]);
  const [history, setHistory] = useState<string[]>([value]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [canvasMode, setCanvasMode] = useState<"edit" | "preview">("edit");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewError, setPreviewError] = useState("");
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    setHistory([value]);
    setHistoryIndex(0);
    setSelectedPath(["content", 0]);
  }, [value]);

  useEffect(() => {
    if (canvasMode !== "preview" || !preview || !parsed.template) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewStatus("loading");
      setPreviewError("");
      try {
        const response = await fetch("/api/document-templates/preview", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ objectKey: preview.objectKey, recordId: preview.recordId, templateJson: parsed.template })
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(payload.error ?? "PDF preview failed");
        }
        const nextUrl = URL.createObjectURL(await response.blob());
        setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return nextUrl; });
        setPreviewStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreviewStatus("error");
        setPreviewError(error instanceof Error ? error.message : "PDF preview failed");
      }
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [canvasMode, parsed.template, preview]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const template = parsed.template;
  const selected = template ? getAtPath(template, selectedPath) : undefined;

  function commit(nextTemplate: JsonRecord) {
    const serialized = JSON.stringify(nextTemplate, null, 2);
    commitValue(serialized);
  }

  function commitValue(serialized: string) {
    const nextHistory = [...history.slice(0, historyIndex + 1), serialized].slice(-60);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    lastEmitted.current = serialized;
    onChange(serialized);
  }

  function travel(nextIndex: number) {
    const nextValue = history[nextIndex];
    if (nextValue === undefined) return;
    setHistoryIndex(nextIndex);
    lastEmitted.current = nextValue;
    onChange(nextValue);
  }

  function addNode(kind: PaletteKind, containerPath: Path = ["content"], index?: number) {
    if (!template) return;
    const node = createNode(kind);
    const target = getAtPath(template, containerPath);
    if (!Array.isArray(target)) return;
    const insertionIndex = index ?? target.length;
    const next = insertAtPath(template, containerPath, insertionIndex, node);
    commit(next);
    setSelectedPath([...containerPath, insertionIndex]);
  }

  function patchSelected(patch: JsonRecord) {
    if (!template || !isRecord(selected)) return;
    commit(setAtPath(template, selectedPath, { ...selected, ...patch }));
  }

  function updateNode(path: Path, nextNode: unknown) {
    if (!template) return;
    commit(setAtPath(template, path, nextNode));
  }

  function addBlock(kind: BlockKind) {
    if (!template) return;
    const content = Array.isArray(template.content) ? template.content : [];
    const node = createBlock(kind);
    commit(setAtPath(template, ["content"], [...content, node]));
    setSelectedPath(["content", content.length]);
  }

  function selectImage(asset: MediaAsset) {
    patchSelected({ image: mediaAssetContentUrl(asset), _mediaAssetId: asset.id, _mediaAssetName: asset.name });
    setImagePickerOpen(false);
  }

  function removeSelected() {
    if (!template || selectedPath.length < 2) return;
    const parentPath = selectedPath.slice(0, -1);
    const index = selectedPath.at(-1);
    const parent = getAtPath(template, parentPath);
    if (typeof index !== "number" || !Array.isArray(parent)) return;
    if (parentPath.at(-1) === "columns" && parent.length <= 1) return;
    commit(removeAtPath(template, parentPath, index));
    setSelectedPath(parentPath.length > 1 ? [...parentPath, Math.max(0, index - 1)] : ["content", Math.max(0, index - 1)]);
  }

  function handleDrop(event: DragEvent, containerPath: Path, index: number) {
    event.preventDefault();
    if (!template) return;
    const raw = event.dataTransfer.getData("application/x-pdf-template-node");
    if (!raw) return;
    const payload = JSON.parse(raw) as { kind: "palette"; paletteKind: PaletteKind } | { kind: "node"; path: Path };
    if (payload.kind === "palette") {
      addNode(payload.paletteKind, containerPath, index);
      return;
    }
    const sourceParent = payload.path.slice(0, -1);
    const sourceIndex = payload.path.at(-1);
    if (typeof sourceIndex !== "number" || pathKey(sourceParent) !== pathKey(containerPath)) return;
    const items = getAtPath(template, containerPath);
    if (!Array.isArray(items)) return;
    const reordered = [...items];
    const [node] = reordered.splice(sourceIndex, 1);
    const adjustedIndex = sourceIndex < index ? index - 1 : index;
    reordered.splice(adjustedIndex, 0, node);
    commit(setAtPath(template, containerPath, reordered));
    setSelectedPath([...containerPath, adjustedIndex]);
  }

  return (
    <div className="pdf-visual-editor" data-testid="pdf-visual-editor">
      <div className="pdf-editor-topbar">
        <div className="pdf-editor-tabs">
          <button className={mode === "visual" ? "active" : ""} type="button" onClick={() => setMode("visual")}>可视化</button>
          <button className={mode === "json" ? "active" : ""} type="button" onClick={() => setMode("json")}>JSON</button>
        </div>
        <div className="pdf-editor-history">
          <button className={canvasMode === "edit" ? "active" : ""} type="button" title="编辑画布" onClick={() => setCanvasMode("edit")}><Rows3 size={15} /></button>
          <button className={canvasMode === "preview" ? "active" : ""} type="button" title="实时 PDF 预览" disabled={!preview} onClick={() => setCanvasMode("preview")}><Eye size={15} /></button>
          <button type="button" title="撤销" disabled={historyIndex === 0} onClick={() => travel(historyIndex - 1)}><Undo2 size={15} /></button>
          <button type="button" title="重做" disabled={historyIndex >= history.length - 1} onClick={() => travel(historyIndex + 1)}><Redo2 size={15} /></button>
        </div>
      </div>

      {mode === "json" ? (
        <div className="pdf-editor-json-mode">
          <textarea className="textarea code-textarea" data-testid="document-template-json" value={value} onChange={(event) => commitValue(event.target.value)} rows={28} />
          {parsed.error ? <div className="settings-banner danger-badge">{parsed.error}</div> : null}
          <button className="secondary-button" type="button" onClick={() => parsed.template && commit(parsed.template)} disabled={!parsed.template}>Format JSON</button>
        </div>
      ) : !template ? (
        <div className="settings-banner danger-badge">JSON 无效，请切换到 JSON 模式修复：{parsed.error}</div>
      ) : (
        <div className="pdf-editor-workspace">
          <aside className="pdf-editor-palette">
            <strong>组件</strong>
            <span className="subtle">拖入画布，或点击添加到页面末尾</span>
            {palette.map(({ kind, label, icon: Icon }) => (
              <button
                draggable
                key={kind}
                type="button"
                onClick={() => addNode(kind)}
                onDragStart={(event) => event.dataTransfer.setData("application/x-pdf-template-node", JSON.stringify({ kind: "palette", paletteKind: kind }))}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
            <strong className="pdf-palette-section-title">模板区块</strong>
            {templateBlocks.map((block) => <button key={block.kind} type="button" onClick={() => addBlock(block.kind)}><Blocks size={16} />{block.label}</button>)}
          </aside>

          <main className="pdf-editor-canvas-shell">
            {canvasMode === "preview" ? (
              <div className="pdf-live-preview" data-testid="pdf-live-preview">
                <div className="pdf-live-preview-status">{previewStatus === "loading" ? "正在生成 PDF..." : previewStatus === "error" ? previewError : "实时 PDF 预览"}</div>
                {previewUrl ? <iframe title="PDF template preview" src={previewUrl} /> : <div className="empty-state">{preview ? "等待生成预览" : "当前对象没有可用于预览的销售文档"}</div>}
              </div>
            ) : <div className="pdf-editor-page" aria-label="A4 template canvas">
              <DropMarker onDrop={(event) => handleDrop(event, ["content"], 0)} />
              {(Array.isArray(template.content) ? template.content : []).map((node, index) => (
                <NodeCanvas
                  key={index}
                  node={node}
                  path={["content", index]}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  onDrop={(event, containerPath, targetIndex) => handleDrop(event, containerPath, targetIndex)}
                  onUpdateNode={updateNode}
                />
              ))}
              <div className="pdf-editor-empty-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event, ["content"], Array.isArray(template.content) ? template.content.length : 0)}>
                拖拽组件到这里
              </div>
            </div>}
          </main>

          <aside className="pdf-editor-properties">
            <div className="pdf-editor-properties-title">
              <strong>属性</strong>
              <button type="button" title="删除元素" onClick={removeSelected}><Trash2 size={15} /></button>
            </div>
            {isRecord(selected) ? <PropertyFields node={selected} onPatch={patchSelected} onChooseImage={() => setImagePickerOpen(true)} /> : <span className="subtle">选择画布中的元素</span>}
          </aside>
        </div>
      )}
      {imagePickerOpen ? (
        <div className="pdf-image-picker-backdrop" role="dialog" aria-modal="true" aria-label="选择模板图片">
          <div className="pdf-image-picker">
            <div className="pdf-editor-properties-title"><strong>选择媒体库图片</strong><button type="button" onClick={() => setImagePickerOpen(false)}><XCircle size={16} /></button></div>
            <div className="pdf-image-picker-grid">
              {mediaAssets.filter(isImageMediaAsset).map((asset) => <button key={asset.id} type="button" onClick={() => selectImage(asset)}><img alt={asset.name} src={mediaAssetContentUrl(asset)} /><span>{asset.name}</span></button>)}
            </div>
            {!mediaAssets.some(isImageMediaAsset) ? <div className="empty-state">媒体库中暂无图片，请先在媒体库上传。</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NodeCanvas({ node, path, selectedPath, onSelect, onDrop, onUpdateNode }: { node: unknown; path: Path; selectedPath: Path; onSelect: (path: Path) => void; onDrop: (event: DragEvent, containerPath: Path, index: number) => void; onUpdateNode: (path: Path, node: unknown) => void }) {
  const selected = pathKey(path) === pathKey(selectedPath);
  const record = isRecord(node) ? node : { text: String(node ?? "") };
  const type = String(record.type ?? (record.text !== undefined ? "text" : record.table ? "table" : record.image ? "image" : "advanced"));
  const rowColumns = Array.isArray(record.columns) ? record.columns : [];
  return (
    <>
      <div
        className={`pdf-canvas-node pdf-canvas-${type} ${selected ? "selected" : ""}`}
        draggable
        onClick={(event) => { event.stopPropagation(); onSelect(path); }}
        onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("application/x-pdf-template-node", JSON.stringify({ kind: "node", path })); }}
      >
        <span className="pdf-canvas-grip"><GripVertical size={13} /></span>
        {type === "row" ? (
          <div className="pdf-canvas-row" style={{ gap: Number(record.gutter ?? 12) }}>
            {rowColumns.map((column, columnIndex) => {
              if (isRecord(column) && column.type === "splitter") return <div className="pdf-canvas-v-splitter" key={columnIndex} />;
              const col = isRecord(column) ? column : {};
              const colPath = [...path, "columns", columnIndex];
              return (
                <div className={`pdf-canvas-col ${pathKey(colPath) === pathKey(selectedPath) ? "selected" : ""}`} style={{ flex: `${Number(col.span ?? 12)} 1 0` }} key={columnIndex} onClick={(event) => { event.stopPropagation(); onSelect(colPath); }}>
                  <span className="pdf-col-label">col-{String(col.span ?? 12)}</span>
                  <DropMarker onDrop={(event) => onDrop(event, [...colPath, "content"], 0)} />
                  {(Array.isArray(col.content) ? col.content : []).map((child, childIndex) => <NodeCanvas key={childIndex} node={child} path={[...colPath, "content", childIndex]} selectedPath={selectedPath} onSelect={onSelect} onDrop={onDrop} onUpdateNode={onUpdateNode} />)}
                  <div className="pdf-col-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, [...colPath, "content"], Array.isArray(col.content) ? col.content.length : 0)}>+</div>
                  {columnIndex < rowColumns.length - 1 && isRecord(rowColumns[columnIndex + 1]) && rowColumns[columnIndex + 1].type === "col" ? (
                    <ColumnResizeHandle row={record} rowPath={path} leftIndex={columnIndex} onUpdateNode={onUpdateNode} />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : type === "splitter" ? <div className="pdf-canvas-h-splitter" style={{ borderColor: String(record.color ?? "#e2e8f0"), borderTopWidth: Number(record.thickness ?? 1), borderTopStyle: record.style === "dashed" ? "dashed" : "solid" }} />
          : type === "condition" ? <div className="pdf-canvas-condition"><strong>条件：{String(isRecord(record.when) ? record.when.path ?? "" : "")}</strong>{(Array.isArray(record.content) ? record.content : []).map((child, childIndex) => <NodeCanvas key={childIndex} node={child} path={[...path, "content", childIndex]} selectedPath={selectedPath} onSelect={onSelect} onDrop={onDrop} onUpdateNode={onUpdateNode} />)}</div>
            : type === "pageBreak" ? <div className="pdf-page-break-node"><span>分页符</span></div>
          : type === "text" ? <div style={{ fontSize: Math.min(24, Number(record.fontSize ?? 12)), fontWeight: record.bold ? 700 : 400, color: String(record.color ?? "#0f172a"), textAlign: normalizeAlignment(record.alignment) }}>{String(record.text ?? "Text")}</div>
            : type === "table" ? <div className="pdf-canvas-placeholder"><Table2 size={18} /> 产品明细表</div>
              : type === "image" ? <div className="pdf-canvas-placeholder"><ImageIcon size={18} /> 图片：{String(record.image ?? "未绑定")}</div>
                : <div className="pdf-canvas-placeholder"><Columns3 size={18} /> 高级 pdfmake 节点</div>}
      </div>
      <DropMarker onDrop={(event) => onDrop(event, path.slice(0, -1), Number(path.at(-1)) + 1)} />
    </>
  );
}

function ColumnResizeHandle({ row, rowPath, leftIndex, onUpdateNode }: { row: JsonRecord; rowPath: Path; leftIndex: number; onUpdateNode: (path: Path, node: unknown) => void }) {
  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const columns = Array.isArray(row.columns) ? row.columns : [];
    const left = isRecord(columns[leftIndex]) ? columns[leftIndex] : {};
    const right = isRecord(columns[leftIndex + 1]) ? columns[leftIndex + 1] : {};
    const leftSpan = Number(left.span ?? 6);
    const rightSpan = Number(right.span ?? 6);
    const startX = event.clientX;
    const rowWidth = event.currentTarget.closest(".pdf-canvas-row")?.getBoundingClientRect().width ?? 600;
    const finish = (pointerEvent: PointerEvent) => {
      const delta = Math.round(((pointerEvent.clientX - startX) / rowWidth) * 12);
      const nextLeft = Math.max(1, Math.min(leftSpan + rightSpan - 1, leftSpan + delta));
      const nextRight = leftSpan + rightSpan - nextLeft;
      const nextColumns = columns.map((column, index) => index === leftIndex && isRecord(column) ? { ...column, span: nextLeft } : index === leftIndex + 1 && isRecord(column) ? { ...column, span: nextRight } : column);
      onUpdateNode(rowPath, { ...row, columns: nextColumns });
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointerup", finish, { once: true });
  }
  return <button className="pdf-column-resize-handle" type="button" aria-label="拖动调整列宽" title="拖动调整列宽" onPointerDown={startResize}><span /></button>;
}

function DropMarker({ onDrop }: { onDrop: (event: DragEvent) => void }) {
  return <div className="pdf-drop-marker" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("active"); }} onDragLeave={(event) => event.currentTarget.classList.remove("active")} onDrop={(event) => { event.currentTarget.classList.remove("active"); onDrop(event); }} />;
}

function PropertyFields({ node, onPatch, onChooseImage }: { node: JsonRecord; onPatch: (patch: JsonRecord) => void; onChooseImage: () => void }) {
  const type = String(node.type ?? (node.text !== undefined ? "text" : node.table ? "table" : node.image ? "image" : "advanced"));
  const pagination = <>
    <PropertySelect label="分页" value={String(node.pageBreak ?? "none")} options={["none", "before", "after"]} onChange={(pageBreak) => onPatch({ pageBreak: pageBreak === "none" ? undefined : pageBreak })} />
    <label className="settings-toggle"><input type="checkbox" checked={Boolean(node.unbreakable)} onChange={(event) => onPatch({ unbreakable: event.target.checked })} /><span>避免跨页拆分</span></label>
  </>;
  if (type === "row") return <>
    <PropertyNumber label="Gutter" value={Number(node.gutter ?? 12)} min={0} onChange={(gutter) => onPatch({ gutter })} />
    <PropertySelect label="Align" value={String(node.align ?? "top")} options={["top", "center", "bottom"]} onChange={(align) => onPatch({ align })} />
    {pagination}
  </>;
  if (type === "col") return <>
    <PropertyNumber label="Span" value={Number(node.span ?? 12)} min={1} max={12} onChange={(span) => onPatch({ span })} />
    <PropertyNumber label="Offset" value={Number(node.offset ?? 0)} min={0} max={11} onChange={(offset) => onPatch({ offset })} />
  </>;
  if (type === "splitter") return <>
    <PropertyText label="颜色" value={String(node.color ?? "#e2e8f0")} onChange={(color) => onPatch({ color })} />
    <PropertyNumber label="粗细" value={Number(node.thickness ?? 1)} min={1} onChange={(thickness) => onPatch({ thickness })} />
    <PropertySelect label="线型" value={String(node.style ?? "solid")} options={["solid", "dashed"]} onChange={(style) => onPatch({ style })} />
    {pagination}
  </>;
  if (type === "condition") {
    const when = isRecord(node.when) ? node.when : {};
    return <>
      <PropertyText label="上下文路径" value={String(when.path ?? "record.data.notes")} onChange={(path) => onPatch({ when: { ...when, path } })} />
      <PropertySelect label="条件" value={String(when.operator ?? "notEmpty")} options={["exists", "notEmpty", "equals", "notEquals"]} onChange={(operator) => onPatch({ when: { ...when, operator } })} />
      {["equals", "notEquals"].includes(String(when.operator)) ? <PropertyText label="比较值" value={String(when.value ?? "")} onChange={(value) => onPatch({ when: { ...when, value } })} /> : null}
      {pagination}
    </>;
  }
  if (type === "pageBreak") return <><span className="subtle">后续内容将从新页面开始。</span><PropertySelect label="位置" value={String(node.pageBreak ?? "before")} options={["before", "after"]} onChange={(pageBreak) => onPatch({ pageBreak })} /></>;
  if (type === "image") return <>
    <button className="secondary-button" type="button" onClick={onChooseImage}><ImageIcon size={15} /> 从媒体库选择</button>
    <PropertyNumber label="宽度" value={Number(node.width ?? 120)} min={1} max={515} onChange={(width) => onPatch({ width })} />
    <PropertySelect label="对齐" value={String(node.alignment ?? "left")} options={["left", "center", "right"]} onChange={(alignment) => onPatch({ alignment })} />
    {pagination}
  </>;
  if (type === "text") return <>
    {node._widget === "todayOffset" ? <>
      <PropertyNumber label="距离今日（天）" value={Number(node._days ?? 30)} min={0} max={36500} onChange={(days) => onPatch({ _days: days, text: `{{dateAdd generatedAt ${days}}}` })} />
      <span className="subtle">示例：设置 30，将显示生成 PDF 当天之后 30 天的日期。</span>
    </> : null}
    <label><span className="subtle">文本 / 变量</span><textarea className="textarea" rows={4} value={String(node.text ?? "")} onChange={(event) => onPatch({ text: event.target.value })} /></label>
    <PropertyNumber label="字号" value={Number(node.fontSize ?? 12)} min={6} max={72} onChange={(fontSize) => onPatch({ fontSize })} />
    <PropertyText label="颜色" value={String(node.color ?? "#0f172a")} onChange={(color) => onPatch({ color })} />
    <label className="settings-toggle"><input type="checkbox" checked={Boolean(node.bold)} onChange={(event) => onPatch({ bold: event.target.checked })} /><span>粗体</span></label>
    <PropertySelect label="对齐" value={String(node.alignment ?? "left")} options={["left", "center", "right"]} onChange={(alignment) => onPatch({ alignment })} />
    {pagination}
  </>;
  return <label><span className="subtle">高级节点 JSON（在 JSON 模式编辑）</span><textarea className="textarea code-textarea" readOnly rows={12} value={JSON.stringify(node, null, 2)} /></label>;
}

function PropertyText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span className="subtle">{label}</span><input className="input" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function PropertyNumber({ label, value, min, max, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <label><span className="subtle">{label}</span><input className="input" type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
function PropertySelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label><span className="subtle">{label}</span><select className="select" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function createNode(kind: PaletteKind): JsonRecord {
  if (kind === "todayOffset") return { text: "{{dateAdd generatedAt 30}}", _widget: "todayOffset", _days: 30, fontSize: 12, color: "#0f172a" };
  if (kind === "row") return { type: "row", gutter: 12, align: "top", columns: [{ type: "col", span: 6, offset: 0, content: [{ text: "Left column" }] }, { type: "col", span: 6, offset: 0, content: [{ text: "Right column" }] }] };
  if (kind === "splitter") return { type: "splitter", orientation: "horizontal", color: "#e2e8f0", thickness: 1, style: "solid", margin: [0, 12, 0, 12] };
  if (kind === "table") return { table: { widths: ["*", "auto", "auto", "auto"], body: "{{lineItemsTable}}" }, layout: "lightHorizontalLines", margin: [0, 16, 0, 8] };
  if (kind === "image") return { image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xn0YAAAAAElFTkSuQmCC", width: 120, alignment: "left" };
  if (kind === "condition") return { type: "condition", when: { path: "record.data.notes", operator: "notEmpty" }, content: [{ text: "{{record.data.notes}}" }] };
  if (kind === "pageBreak") return { type: "pageBreak", text: "", pageBreak: "before" };
  return { text: "New text", fontSize: 12, color: "#0f172a" };
}

function createBlock(kind: BlockKind): JsonRecord {
  if (kind === "documentHeader") return { type: "row", gutter: 12, unbreakable: true, columns: [
    { type: "col", span: 8, content: [{ text: "{{documentTitle}}", fontSize: 20, bold: true }] },
    { type: "col", span: 4, content: [{ text: "{{documentNumber}}", alignment: "right", bold: true }, { text: "{{date issueDate}}", alignment: "right", color: "#64748b", margin: [0, 4, 0, 0] }] }
  ] };
  if (kind === "customerDetails") return { type: "row", gutter: 16, columns: [
    { type: "col", span: 6, content: [{ text: "Customer", bold: true }, { text: "{{company.title}}" }, { text: "{{company.data.billingAddresses}}", color: "#64748b" }] },
    { type: "col", span: 6, content: [{ text: "Contact", bold: true }, { text: "{{contact.title}}" }, { text: "{{contact.data.email}}", color: "#64748b" }] }
  ] };
  if (kind === "totals") return { type: "row", gutter: 12, unbreakable: true, columns: [
    { type: "col", span: 7, content: [{ text: "" }] },
    { type: "col", span: 5, content: [{ text: "Fees: {{money totals.feeSubtotal currency}}", alignment: "right" }, { text: "Total: {{money totals.totalAmount currency}}", alignment: "right", bold: true, fontSize: 14, margin: [0, 6, 0, 0] }] }
  ] };
  if (kind === "payment") return { type: "condition", when: { path: "paymentSummary", operator: "notEmpty" }, content: [{ text: "Payment", bold: true }, { text: "{{paymentSummary}}" }, { text: "{{paymentInstructions}}", color: "#64748b" }] };
  return { type: "row", gutter: 24, unbreakable: true, margin: [0, 36, 0, 0], columns: [
    { type: "col", span: 6, content: [{ type: "splitter", orientation: "horizontal", color: "#94a3b8", margin: [0, 0, 0, 6] }, { text: "Authorized signature", alignment: "center", color: "#64748b" }] },
    { type: "col", span: 6, content: [{ type: "splitter", orientation: "horizontal", color: "#94a3b8", margin: [0, 0, 0, 6] }, { text: "Customer signature", alignment: "center", color: "#64748b" }] }
  ] };
}

function parseTemplate(value: string): { template?: JsonRecord; error?: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return { error: "模板根节点必须是 JSON 对象" };
    if (!Array.isArray(parsed.content)) return { error: "模板必须包含 content 数组" };
    return { template: parsed };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "JSON 无效" };
  }
}

function getAtPath(root: unknown, path: Path): unknown { return path.reduce<unknown>((value, part) => isRecord(value) || Array.isArray(value) ? value[part as never] : undefined, root); }
function setAtPath(root: JsonRecord, path: Path, value: unknown): JsonRecord {
  if (!path.length) return value as JsonRecord;
  const clone = structuredClone(root);
  let cursor: JsonRecord | unknown[] = clone;
  path.slice(0, -1).forEach((part) => { cursor = cursor[part as never] as JsonRecord | unknown[]; });
  cursor[path.at(-1) as never] = value as never;
  return clone;
}
function insertAtPath(root: JsonRecord, path: Path, index: number, value: unknown): JsonRecord {
  const items = getAtPath(root, path);
  const next = [...(Array.isArray(items) ? items : [])];
  next.splice(index, 0, value);
  return setAtPath(root, path, next);
}
function removeAtPath(root: JsonRecord, path: Path, index: number): JsonRecord {
  const items = getAtPath(root, path);
  const next = [...(Array.isArray(items) ? items : [])];
  next.splice(index, 1);
  return setAtPath(root, path, next);
}
function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function pathKey(path: Path): string { return JSON.stringify(path); }
function normalizeAlignment(value: unknown): "left" | "center" | "right" { return value === "center" || value === "right" ? value : "left"; }
