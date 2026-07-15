"use client";

import { AtSign, ChevronUp, Download, File, Image as ImageIcon, Loader2, MessageCircle, Paperclip, Pencil, Reply, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MediaManagerModal } from "@/components/media-manager-modal";
import type { User } from "@/lib/crm/types";
import type { DiscussionAttachmentDto, DiscussionMessageDto, DiscussionMessagesPage, DiscussionTarget } from "@/lib/discussions/types";
import { buildDiscussionTree, pruneDiscussionTree, type DiscussionTreeNode } from "@/lib/discussions/tree";
import type { MediaAssetDto } from "@/lib/media/service";

export function TeamDiscussionPanel({ target, currentUserId, users, title = "团队讨论", embedded = false, focusMessageId, onClose, onUnreadChange }: { target: DiscussionTarget; currentUserId: string; users: User[]; title?: string; embedded?: boolean; focusMessageId?: string; onClose?: () => void; onUnreadChange?: (count: number) => void }) {
  const [messages, setMessages] = useState<DiscussionMessageDto[]>([]);
  const [replyingToId, setReplyingToId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [nextBefore, setNextBefore] = useState<string>();
  const [latestCursor, setLatestCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const targetKey = target.type === "record" ? `${target.type}:${target.objectKey}:${target.targetId}` : `${target.type}:${target.targetId}`;
  const tree = useMemo(() => pruneDiscussionTree(buildDiscussionTree(messages), (message) => !message.deletedAt), [messages]);
  const flattenedTree = useMemo(() => flattenTree(tree), [tree]);

  const markRead = useCallback(async () => {
    await discussionFetch("/api/discussions/read", { method: "POST", body: { target } });
    onUnreadChange?.(0);
  }, [onUnreadChange, target]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const page = await discussionFetch<DiscussionMessagesPage>(discussionMessagesUrl(target, focusMessageId));
      setMessages(mergeMessages(page.contextMessages ?? [], page.messages));
      setNextBefore(page.nextBefore);
      setLatestCursor(page.latestCursor);
      onUnreadChange?.(page.unreadCount);
      await markRead();
      requestAnimationFrame(() => {
        const focused = focusMessageId ? listRef.current?.querySelector<HTMLElement>(`[data-message-id="${cssEscape(focusMessageId)}"]`) : undefined;
        if (focused) focused.scrollIntoView({ block: "center" });
        else listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    } catch (loadError) { setError(errorMessage(loadError)); } finally { setLoading(false); }
  }, [focusMessageId, markRead, onUnreadChange, target]);

  useEffect(() => {
    setMessages([]); setReplyingToId(undefined); setEditingId(undefined); void loadInitial();
  }, [targetKey, focusMessageId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const url = latestCursor ? `${discussionMessagesUrl(target)}&after=${encodeURIComponent(latestCursor)}` : discussionMessagesUrl(target);
      void discussionFetch<DiscussionMessagesPage>(url).then(async (page) => {
        if (!page.messages.length) return;
        setMessages((current) => mergeMessages(current, page.contextMessages ?? [], page.messages));
        setLatestCursor(page.latestCursor ?? latestCursor);
        await markRead();
      }).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [latestCursor, markRead, target, targetKey]);

  async function loadOlder() {
    if (!nextBefore || pending) return;
    setPending(true);
    try {
      const page = await discussionFetch<DiscussionMessagesPage>(`${discussionMessagesUrl(target)}&before=${encodeURIComponent(nextBefore)}`);
      setMessages((current) => mergeMessages(page.contextMessages ?? [], page.messages, current));
      setNextBefore(page.nextBefore);
    } catch (loadError) { setError(errorMessage(loadError)); } finally { setPending(false); }
  }

  async function createComment(input: ComposerPayload, parentId?: string) {
    const created = await discussionFetch<DiscussionMessageDto>("/api/discussions/messages", { method: "POST", body: { target, body: input.body, replyToId: parentId, mediaAssetIds: input.attachments.map((item) => item.id), mentionUserIds: input.mentionUserIds } });
    setMessages((current) => mergeMessages(current, [created]));
    setLatestCursor(BufferlessCursor(created));
    setReplyingToId(undefined);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-message-id="${cssEscape(created.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function updateComment(message: DiscussionMessageDto, input: ComposerPayload) {
    const updated = await discussionFetch<DiscussionMessageDto>(`/api/discussions/messages/${encodeURIComponent(message.id)}`, { method: "PATCH", body: { body: input.body, mentionUserIds: input.mentionUserIds } });
    setMessages((current) => current.map((item) => item.id === updated.id ? updated : item));
    setEditingId(undefined);
  }

  async function removeMessage(message: DiscussionMessageDto) {
    if (!window.confirm("删除这条评论？其回复会继续保留。")) return;
    setPending(true);
    try {
      await discussionFetch(`/api/discussions/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" });
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, body: "", attachments: [], mentionUserIds: [], deletedAt: new Date().toISOString() } : item));
    } catch (deleteError) { setError(errorMessage(deleteError)); } finally { setPending(false); }
  }

  return (
    <section className={`team-discussion ${embedded ? "embedded" : ""}`} data-testid="team-discussion-panel" id={`discussion-panel-${target.targetId}`}>
      <header className="team-discussion-header"><span><MessageCircle size={18} /><strong>{title}</strong></span>{onClose ? <button className="icon-button" type="button" aria-label="收起团队评论" onClick={onClose}>{embedded ? <ChevronUp size={16} /> : <X size={16} />}</button> : null}</header>
      <div className="team-discussion-list" ref={listRef}>
        {nextBefore ? <button className="discussion-load-older" type="button" disabled={pending} onClick={() => void loadOlder()}>加载更早评论</button> : null}
        {loading ? <div className="discussion-state"><Loader2 className="spin-icon" size={18} />加载评论…</div> : null}
        {!loading && !flattenedTree.length ? <div className="discussion-state">还没有评论，发送第一条吧。</div> : null}
        {flattenedTree.map(({ node, depth }) => {
          const message = node.message;
          return <div className={`discussion-tree-node ${depth ? "reply" : "root"} depth-${Math.min(depth, 4)}`} data-depth={depth} key={message.id}>
            <article className={`discussion-message ${message.author.id === currentUserId ? "mine" : ""} ${focusMessageId === message.id ? "focused" : ""}`} data-message-id={message.id} data-testid={`discussion-message-${message.id}`}>
              <div className="discussion-avatar">{message.author.name.slice(0, 1).toUpperCase()}</div>
              <div className="discussion-message-content">
                <div className="discussion-message-meta"><strong>{message.author.name}</strong><time>{formatDiscussionTime(message.createdAt)}</time>{message.editedAt ? <span>已编辑</span> : null}</div>
                {message.deletedAt ? <div className="discussion-deleted">评论已删除</div> : editingId === message.id ? <CommentComposer autoFocus initialBody={message.body} initialMentionIds={message.mentionUserIds} users={users} currentUserId={currentUserId} target={target} submitLabel="保存" allowAttachments={false} onCancel={() => setEditingId(undefined)} onSubmit={(input) => updateComment(message, input)} /> : <>
                  {message.body ? <div className="discussion-body">{renderMentions(message.body)}</div> : null}
                  {message.attachments.length ? <div className="discussion-attachments">{message.attachments.map((attachment) => <DiscussionAttachment key={attachment.id} attachment={attachment} />)}</div> : null}
                  <div className="discussion-message-actions"><button type="button" onClick={() => { setReplyingToId(message.id); setEditingId(undefined); }}><Reply size={13} />回复</button>{message.author.id === currentUserId ? <button type="button" onClick={() => { setEditingId(message.id); setReplyingToId(undefined); }}><Pencil size={13} />编辑</button> : null}{message.author.id === currentUserId ? <button type="button" onClick={() => void removeMessage(message)}><Trash2 size={13} />删除</button> : null}</div>
                </>}
              </div>
            </article>
            {replyingToId === message.id ? <div className="discussion-inline-reply"><CommentComposer autoFocus compact users={users} currentUserId={currentUserId} target={target} placeholder={`回复 ${message.author.name}…`} submitLabel="回复" onCancel={() => setReplyingToId(undefined)} onSubmit={(input) => createComment(input, message.id)} /></div> : null}
          </div>;
        })}
      </div>
      {error ? <div className="discussion-error panel-error">{error}</div> : null}
      <div className="team-discussion-root-composer"><CommentComposer users={users} currentUserId={currentUserId} target={target} placeholder="输入评论，使用 @ 提及成员…" submitLabel="发送" onSubmit={(input) => createComment(input)} /></div>
    </section>
  );
}

type ComposerPayload = { body: string; attachments: MediaAssetDto[]; mentionUserIds: string[] };

function CommentComposer({ target, users, currentUserId, placeholder = "输入评论…", submitLabel, compact = false, autoFocus = false, allowAttachments = true, initialBody = "", initialMentionIds = [], onCancel, onSubmit }: { target: DiscussionTarget; users: User[]; currentUserId: string; placeholder?: string; submitLabel: string; compact?: boolean; autoFocus?: boolean; allowAttachments?: boolean; initialBody?: string; initialMentionIds?: string[]; onCancel?: () => void; onSubmit: (input: ComposerPayload) => Promise<void> }) {
  const [body, setBody] = useState(initialBody);
  const [attachments, setAttachments] = useState<MediaAssetDto[]>([]);
  const [mentionIds, setMentionIds] = useState(initialMentionIds);
  const [mentionQuery, setMentionQuery] = useState<string>();
  const [mediaManagerOpen, setMediaManagerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const activeUsers = useMemo(() => users.filter((user) => user.active && user.id !== currentUserId), [currentUserId, users]);
  const suggestions = mentionQuery === undefined ? [] : activeUsers.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8);

  function updateBody(value: string) { setBody(value); setMentionQuery(value.match(/(?:^|\s)@([^@\s]*)$/)?.[1]); }
  function addMention(user: User) { setBody((current) => current.replace(/(?:^|\s)@([^@\s]*)$/, (match) => `${match.startsWith(" ") ? " " : ""}@${user.name} `)); setMentionIds((current) => [...new Set([...current, user.id])]); setMentionQuery(undefined); }
  async function submit() {
    if (pending || (!body.trim() && !attachments.length)) return;
    setPending(true); setError(undefined);
    try {
      const validMentions = mentionIds.filter((id) => { const user = users.find((candidate) => candidate.id === id); return user && body.includes(`@${user.name}`); });
      await onSubmit({ body, attachments, mentionUserIds: validMentions });
      setBody(""); setAttachments([]); setMentionIds([]);
    } catch (submitError) { setError(errorMessage(submitError)); } finally { setPending(false); }
  }

  return <div className={`discussion-composer ${compact ? "compact" : ""}`}>
    {attachments.length ? <div className="discussion-pending-attachments">{attachments.map((attachment) => <span key={attachment.id}>{attachment.name}<button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><X size={12} /></button></span>)}</div> : null}
    <textarea autoFocus={autoFocus} value={body} maxLength={10_000} placeholder={placeholder} onChange={(event) => updateBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit(); }} />
    {suggestions.length ? <div className="discussion-mention-menu">{suggestions.map((user) => <button type="button" key={user.id} onClick={() => addMention(user)}><AtSign size={14} /><span><strong>{user.name}</strong><small>{user.email}</small></span></button>)}</div> : null}
    {error ? <div className="discussion-error">{error}</div> : null}
    <div className="discussion-composer-actions">{allowAttachments ? <button className="secondary-button discussion-upload-button" type="button" disabled={attachments.length >= 10} onClick={() => setMediaManagerOpen(true)}><Paperclip size={14} />图片/附件</button> : null}<span>Ctrl/⌘ + Enter</span>{onCancel ? <button className="secondary-button" type="button" onClick={onCancel}>取消</button> : null}<button className="primary-button" type="button" disabled={pending || (!body.trim() && !attachments.length)} onClick={() => void submit()}>{pending ? <Loader2 className="spin-icon" size={14} /> : <Send size={14} />}{submitLabel}</button></div>
    {mediaManagerOpen ? <MediaManagerModal target={target} initialSelected={attachments} onClose={() => setMediaManagerOpen(false)} onConfirm={(assets) => { setAttachments(assets); setMediaManagerOpen(false); }} /> : null}
  </div>;
}

function flattenTree<T extends DiscussionMessageDto>(tree: DiscussionTreeNode<T>[]): Array<{ node: DiscussionTreeNode<T>; depth: number }> {
  const flattened: Array<{ node: DiscussionTreeNode<T>; depth: number }> = [];
  const visit = (node: DiscussionTreeNode<T>) => { flattened.push({ node, depth: node.depth }); node.children.forEach(visit); };
  tree.forEach(visit);
  return flattened;
}

function DiscussionAttachment({ attachment }: { attachment: DiscussionAttachmentDto }) {
  const image = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(attachment.contentType.toLowerCase());
  return image ? <a className="discussion-image" href={attachment.downloadUrl} target="_blank" rel="noreferrer"><img src={attachment.downloadUrl} alt={attachment.fileName} /><span><ImageIcon size={13} />{attachment.fileName}</span></a> : <a className="discussion-file" href={attachment.downloadUrl}><File size={18} /><span><strong>{attachment.fileName}</strong><small>{formatBytes(attachment.size)}</small></span><Download size={15} /></a>;
}

function discussionMessagesUrl(target: DiscussionTarget, focusMessageId?: string): string { const params = new URLSearchParams({ type: target.type, targetId: target.targetId }); if (target.type === "record") params.set("objectKey", target.objectKey); if (focusMessageId) params.set("focus", focusMessageId); return `/api/discussions/messages?${params}`; }
async function discussionFetch<T = unknown>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> { const response = await fetch(url, { method: options.method ?? "GET", headers: options.body === undefined ? undefined : { "content-type": "application/json" }, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "团队评论请求失败"); return payload as T; }
function mergeMessages(...groups: DiscussionMessageDto[][]): DiscussionMessageDto[] { return [...new Map(groups.flat().map((message) => [message.id, message])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)); }
function BufferlessCursor(message: DiscussionMessageDto): string { const bytes = new TextEncoder().encode(`${message.createdAt}|${message.id}`); let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function renderMentions(body: string) { return body.split(/(@[^\s@]+)/g).map((part, index) => part.startsWith("@") ? <strong className="discussion-mention" key={`${part}-${index}`}>{part}</strong> : part); }
function formatDiscussionTime(value: string) { const time = new Date(value).getTime(); const seconds = Math.max(0, Math.round((Date.now() - time) / 1000)); if (seconds < 60) return `${seconds}秒前`; if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`; if (seconds < 86_400) return `${Math.floor(seconds / 3600)}小时前`; return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "团队评论操作失败"; }
function cssEscape(value: string) { return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
