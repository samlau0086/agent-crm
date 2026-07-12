"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Columns3, GripVertical, Image as ImageIcon, Redo2, Rows3, SeparatorHorizontal, Table2, TextCursorInput, Trash2, Undo2 } from "lucide-react";

type JsonRecord = Record<string, unknown>;
type Path = Array<string | number>;
type PaletteKind = "text" | "row" | "splitter" | "table" | "image";

interface DocumentTemplateVisualEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const palette: Array<{ kind: PaletteKind; label: string; icon: typeof TextCursorInput }> = [
  { kind: "text", label: "文本", icon: TextCursorInput },
  { kind: "row", label: "行 / 列", icon: Rows3 },
  { kind: "splitter", label: "分隔线", icon: SeparatorHorizontal },
  { kind: "table", label: "产品表格", icon: Table2 },
  { kind: "image", label: "图片", icon: ImageIcon }
];

export function DocumentTemplateVisualEditor({ value, onChange }: DocumentTemplateVisualEditorProps) {
  const parsed = useMemo(() => parseTemplate(value), [value]);
  const [mode, setMode] = useState<"visual" | "json">("visual");
  const [selectedPath, setSelectedPath] = useState<Path>(["content", 0]);
  const [history, setHistory] = useState<string[]>([value]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    setHistory([value]);
    setHistoryIndex(0);
    setSelectedPath(["content", 0]);
  }, [value]);

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
          </aside>

          <main className="pdf-editor-canvas-shell">
            <div className="pdf-editor-page" aria-label="A4 template canvas">
              <DropMarker onDrop={(event) => handleDrop(event, ["content"], 0)} />
              {(Array.isArray(template.content) ? template.content : []).map((node, index) => (
                <NodeCanvas
                  key={index}
                  node={node}
                  path={["content", index]}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  onDrop={(event, containerPath, targetIndex) => handleDrop(event, containerPath, targetIndex)}
                />
              ))}
              <div className="pdf-editor-empty-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event, ["content"], Array.isArray(template.content) ? template.content.length : 0)}>
                拖拽组件到这里
              </div>
            </div>
          </main>

          <aside className="pdf-editor-properties">
            <div className="pdf-editor-properties-title">
              <strong>属性</strong>
              <button type="button" title="删除元素" onClick={removeSelected}><Trash2 size={15} /></button>
            </div>
            {isRecord(selected) ? <PropertyFields node={selected} onPatch={patchSelected} /> : <span className="subtle">选择画布中的元素</span>}
          </aside>
        </div>
      )}
    </div>
  );
}

function NodeCanvas({ node, path, selectedPath, onSelect, onDrop }: { node: unknown; path: Path; selectedPath: Path; onSelect: (path: Path) => void; onDrop: (event: DragEvent, containerPath: Path, index: number) => void }) {
  const selected = pathKey(path) === pathKey(selectedPath);
  const record = isRecord(node) ? node : { text: String(node ?? "") };
  const type = String(record.type ?? (record.text !== undefined ? "text" : record.table ? "table" : record.image ? "image" : "advanced"));
  return (
    <>
      <div
        className={`pdf-canvas-node pdf-canvas-${type} ${selected ? "selected" : ""}`}
        draggable
        onClick={(event) => { event.stopPropagation(); onSelect(path); }}
        onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("application/x-pdf-template-node", JSON.stringify({ kind: "node", path })); }}
      >
        <span className="pdf-canvas-grip"><GripVertical size={13} /></span>
        {type === "row" && Array.isArray(record.columns) ? (
          <div className="pdf-canvas-row" style={{ gap: Number(record.gutter ?? 12) }}>
            {record.columns.map((column, columnIndex) => {
              if (isRecord(column) && column.type === "splitter") return <div className="pdf-canvas-v-splitter" key={columnIndex} />;
              const col = isRecord(column) ? column : {};
              const colPath = [...path, "columns", columnIndex];
              return (
                <div className={`pdf-canvas-col ${pathKey(colPath) === pathKey(selectedPath) ? "selected" : ""}`} style={{ flex: `${Number(col.span ?? 12)} 1 0` }} key={columnIndex} onClick={(event) => { event.stopPropagation(); onSelect(colPath); }}>
                  <span className="pdf-col-label">col-{String(col.span ?? 12)}</span>
                  <DropMarker onDrop={(event) => onDrop(event, [...colPath, "content"], 0)} />
                  {(Array.isArray(col.content) ? col.content : []).map((child, childIndex) => <NodeCanvas key={childIndex} node={child} path={[...colPath, "content", childIndex]} selectedPath={selectedPath} onSelect={onSelect} onDrop={onDrop} />)}
                  <div className="pdf-col-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, [...colPath, "content"], Array.isArray(col.content) ? col.content.length : 0)}>+</div>
                </div>
              );
            })}
          </div>
        ) : type === "splitter" ? <div className="pdf-canvas-h-splitter" style={{ borderColor: String(record.color ?? "#e2e8f0"), borderTopWidth: Number(record.thickness ?? 1), borderTopStyle: record.style === "dashed" ? "dashed" : "solid" }} />
          : type === "text" ? <div style={{ fontSize: Math.min(24, Number(record.fontSize ?? 12)), fontWeight: record.bold ? 700 : 400, color: String(record.color ?? "#0f172a"), textAlign: normalizeAlignment(record.alignment) }}>{String(record.text ?? "Text")}</div>
            : type === "table" ? <div className="pdf-canvas-placeholder"><Table2 size={18} /> 产品明细表</div>
              : type === "image" ? <div className="pdf-canvas-placeholder"><ImageIcon size={18} /> 图片：{String(record.image ?? "未绑定")}</div>
                : <div className="pdf-canvas-placeholder"><Columns3 size={18} /> 高级 pdfmake 节点</div>}
      </div>
      <DropMarker onDrop={(event) => onDrop(event, path.slice(0, -1), Number(path.at(-1)) + 1)} />
    </>
  );
}

function DropMarker({ onDrop }: { onDrop: (event: DragEvent) => void }) {
  return <div className="pdf-drop-marker" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("active"); }} onDragLeave={(event) => event.currentTarget.classList.remove("active")} onDrop={(event) => { event.currentTarget.classList.remove("active"); onDrop(event); }} />;
}

function PropertyFields({ node, onPatch }: { node: JsonRecord; onPatch: (patch: JsonRecord) => void }) {
  const type = String(node.type ?? (node.text !== undefined ? "text" : node.table ? "table" : node.image ? "image" : "advanced"));
  if (type === "row") return <>
    <PropertyNumber label="Gutter" value={Number(node.gutter ?? 12)} min={0} onChange={(gutter) => onPatch({ gutter })} />
    <PropertySelect label="Align" value={String(node.align ?? "top")} options={["top", "center", "bottom"]} onChange={(align) => onPatch({ align })} />
  </>;
  if (type === "col") return <>
    <PropertyNumber label="Span" value={Number(node.span ?? 12)} min={1} max={12} onChange={(span) => onPatch({ span })} />
    <PropertyNumber label="Offset" value={Number(node.offset ?? 0)} min={0} max={11} onChange={(offset) => onPatch({ offset })} />
  </>;
  if (type === "splitter") return <>
    <PropertyText label="颜色" value={String(node.color ?? "#e2e8f0")} onChange={(color) => onPatch({ color })} />
    <PropertyNumber label="粗细" value={Number(node.thickness ?? 1)} min={1} onChange={(thickness) => onPatch({ thickness })} />
    <PropertySelect label="线型" value={String(node.style ?? "solid")} options={["solid", "dashed"]} onChange={(style) => onPatch({ style })} />
  </>;
  if (type === "text") return <>
    <label><span className="subtle">文本 / 变量</span><textarea className="textarea" rows={4} value={String(node.text ?? "")} onChange={(event) => onPatch({ text: event.target.value })} /></label>
    <PropertyNumber label="字号" value={Number(node.fontSize ?? 12)} min={6} max={72} onChange={(fontSize) => onPatch({ fontSize })} />
    <PropertyText label="颜色" value={String(node.color ?? "#0f172a")} onChange={(color) => onPatch({ color })} />
    <label className="settings-toggle"><input type="checkbox" checked={Boolean(node.bold)} onChange={(event) => onPatch({ bold: event.target.checked })} /><span>粗体</span></label>
    <PropertySelect label="对齐" value={String(node.alignment ?? "left")} options={["left", "center", "right"]} onChange={(alignment) => onPatch({ alignment })} />
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
  if (kind === "row") return { type: "row", gutter: 12, align: "top", columns: [{ type: "col", span: 6, offset: 0, content: [{ text: "Left column" }] }, { type: "col", span: 6, offset: 0, content: [{ text: "Right column" }] }] };
  if (kind === "splitter") return { type: "splitter", orientation: "horizontal", color: "#e2e8f0", thickness: 1, style: "solid", margin: [0, 12, 0, 12] };
  if (kind === "table") return { table: { widths: ["*", "auto", "auto", "auto"], body: "{{lineItemsTable}}" }, layout: "lightHorizontalLines", margin: [0, 16, 0, 8] };
  if (kind === "image") return { image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xn0YAAAAAElFTkSuQmCC", width: 120, alignment: "left" };
  return { text: "New text", fontSize: 12, color: "#0f172a" };
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
