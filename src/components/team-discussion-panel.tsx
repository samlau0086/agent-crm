"use client";

import { AtSign, Download, File, Image as ImageIcon, Loader2, MessageCircle, Paperclip, Pencil, Reply, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/lib/crm/types";
import type { DiscussionAttachmentDto, DiscussionMessageDto, DiscussionMessagesPage, DiscussionTarget } from "@/lib/discussions/types";

export function TeamDiscussionPanel({
  target,
  currentUserId,
  users,
  title = "团队讨论",
  onClose,
  onUnreadChange
}: {
  target: DiscussionTarget;
  currentUserId: string;
  users: User[];
  title?: string;
  onClose?: () => void;
  onUnreadChange?: (count: number) => void;
}) {
  const [messages, setMessages] = useState<DiscussionMessageDto[]>([]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<DiscussionMessageDto>();
  const [editing, setEditing] = useState<DiscussionMessageDto>();
  const [attachments, setAttachments] = useState<DiscussionAttachmentDto[]>([]);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string>();
  const [nextBefore, setNextBefore] = useState<string>();
  const [latestCursor, setLatestCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const targetKey = target.type === "record" ? `${target.type}:${target.objectKey}:${target.targetId}` : `${target.type}:${target.targetId}`;
  const activeUsers = useMemo(() => users.filter((user) => user.active && user.id !== currentUserId), [currentUserId, users]);
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === undefined) return [];
    const query = mentionQuery.toLowerCase();
    return activeUsers.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query)).slice(0, 8);
  }, [activeUsers, mentionQuery]);

  const markRead = useCallback(async () => {
    await discussionFetch("/api/discussions/read", { method: "POST", body: { target } });
    onUnreadChange?.(0);
  }, [onUnreadChange, target]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const page = await discussionFetch<DiscussionMessagesPage>(discussionMessagesUrl(target));
      setMessages(page.messages);
      setNextBefore(page.nextBefore);
      setLatestCursor(page.latestCursor);
      onUnreadChange?.(page.unreadCount);
      await markRead();
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [markRead, onUnreadChange, target]);

  useEffect(() => {
    setMessages([]);
    setAttachments([]);
    setBody("");
    setEditing(undefined);
    setReplyTo(undefined);
    void loadInitial();
  }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const url = latestCursor ? `${discussionMessagesUrl(target)}&after=${encodeURIComponent(latestCursor)}` : discussionMessagesUrl(target);
      void discussionFetch<DiscussionMessagesPage>(url)
        .then(async (page) => {
          if (!page.messages.length) return;
          setMessages((current) => mergeMessages(current, page.messages));
          setLatestCursor(page.latestCursor ?? latestCursor);
          await markRead();
        })
        .catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [latestCursor, markRead, target, targetKey]);

  function updateBody(value: string) {
    setBody(value);
    const match = value.match(/(?:^|\s)@([^@\s]*)$/);
    setMentionQuery(match?.[1]);
  }

  function addMention(user: User) {
    setBody((current) => current.replace(/(?:^|\s)@([^@\s]*)$/, (match) => `${match.startsWith(" ") ? " " : ""}@${user.name} `));
    setMentionIds((current) => [...new Set([...current, user.id])]);
    setMentionQuery(undefined);
  }

  async function loadOlder() {
    if (!nextBefore || pending) return;
    setPending(true);
    try {
      const page = await discussionFetch<DiscussionMessagesPage>(`${discussionMessagesUrl(target)}&before=${encodeURIComponent(nextBefore)}`);
      setMessages((current) => mergeMessages(page.messages, current));
      setNextBefore(page.nextBefore);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setPending(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(undefined);
    try {
      const remaining = Math.max(0, 10 - attachments.length);
      for (const file of Array.from(files).slice(0, remaining)) {
        const form = new FormData();
        form.set("file", file);
        form.set("type", target.type);
        form.set("targetId", target.targetId);
        if (target.type === "record") form.set("objectKey", target.objectKey);
        const uploaded = await discussionFetch<DiscussionAttachmentDto>("/api/discussions/attachments", { method: "POST", form });
        setAttachments((current) => [...current, uploaded]);
      }
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (pending || (!body.trim() && !attachments.length)) return;
    setPending(true);
    setError(undefined);
    const validMentionIds = mentionIds.filter((id) => {
      const user = users.find((candidate) => candidate.id === id);
      return user && body.includes(`@${user.name}`);
    });
    try {
      if (editing) {
        const updated = await discussionFetch<DiscussionMessageDto>(`/api/discussions/messages/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: { body, mentionUserIds: validMentionIds } });
        setMessages((current) => current.map((message) => message.id === updated.id ? updated : message));
      } else {
        const created = await discussionFetch<DiscussionMessageDto>("/api/discussions/messages", { method: "POST", body: { target, body, replyToId: replyTo?.id, attachmentIds: attachments.map((item) => item.id), mentionUserIds: validMentionIds } });
        setMessages((current) => mergeMessages(current, [created]));
        setLatestCursor(BufferlessCursor(created));
      }
      setBody("");
      setMentionIds([]);
      setAttachments([]);
      setEditing(undefined);
      setReplyTo(undefined);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  }

  function startEdit(message: DiscussionMessageDto) {
    setEditing(message);
    setReplyTo(undefined);
    setBody(message.body);
    setMentionIds(message.mentionUserIds);
    setAttachments([]);
  }

  async function removeMessage(message: DiscussionMessageDto) {
    if (!window.confirm("删除这条讨论消息？")) return;
    setPending(true);
    try {
      await discussionFetch(`/api/discussions/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" });
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, body: "", attachments: [], mentionUserIds: [], deletedAt: new Date().toISOString() } : item));
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="team-discussion" data-testid="team-discussion-panel">
      <header className="team-discussion-header">
        <span><MessageCircle size={18} /><strong>{title}</strong></span>
        {onClose ? <button className="icon-button" type="button" aria-label="关闭团队讨论" onClick={onClose}><X size={16} /></button> : null}
      </header>
      <div className="team-discussion-list" ref={listRef}>
        {nextBefore ? <button className="discussion-load-older" type="button" disabled={pending} onClick={loadOlder}>加载更早消息</button> : null}
        {loading ? <div className="discussion-state"><Loader2 className="spin-icon" size={18} />加载讨论…</div> : null}
        {!loading && !messages.length ? <div className="discussion-state">还没有讨论，发送第一条消息吧。</div> : null}
        {messages.map((message) => (
          <article className={`discussion-message ${message.author.id === currentUserId ? "mine" : ""}`} key={message.id} data-testid={`discussion-message-${message.id}`}>
            <div className="discussion-avatar">{message.author.name.slice(0, 1).toUpperCase()}</div>
            <div className="discussion-message-content">
              <div className="discussion-message-meta"><strong>{message.author.name}</strong><time>{formatDiscussionTime(message.createdAt)}</time>{message.editedAt ? <span>已编辑</span> : null}</div>
              {message.deletedAt ? <div className="discussion-deleted">消息已删除</div> : (
                <>
                  {message.replyTo ? <div className="discussion-reply-quote"><strong>{message.replyTo.authorName}</strong>{message.replyTo.deleted ? "消息已删除" : message.replyTo.body}</div> : null}
                  {message.body ? <div className="discussion-body">{renderMentions(message.body)}</div> : null}
                  {message.attachments.length ? <div className="discussion-attachments">{message.attachments.map((attachment) => <DiscussionAttachment key={attachment.id} attachment={attachment} />)}</div> : null}
                  <div className="discussion-message-actions">
                    <button type="button" onClick={() => { setReplyTo(message); setEditing(undefined); setBody(""); }}><Reply size={13} />回复</button>
                    {message.author.id === currentUserId ? <button type="button" onClick={() => startEdit(message)}><Pencil size={13} />编辑</button> : null}
                    {message.author.id === currentUserId ? <button type="button" onClick={() => void removeMessage(message)}><Trash2 size={13} />删除</button> : null}
                  </div>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="team-discussion-composer">
        {replyTo || editing ? <div className="discussion-compose-context"><span>{editing ? "编辑消息" : `回复 ${replyTo?.author.name}`}</span><button type="button" onClick={() => { setReplyTo(undefined); setEditing(undefined); setBody(""); setMentionIds([]); }}><X size={14} /></button></div> : null}
        {attachments.length ? <div className="discussion-pending-attachments">{attachments.map((attachment) => <span key={attachment.id}>{attachment.fileName}<button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><X size={12} /></button></span>)}</div> : null}
        <textarea value={body} maxLength={10_000} placeholder="输入消息，使用 @ 提及成员…" onChange={(event) => updateBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit(); }} />
        {mentionSuggestions.length ? <div className="discussion-mention-menu">{mentionSuggestions.map((user) => <button type="button" key={user.id} onClick={() => addMention(user)}><AtSign size={14} /><span><strong>{user.name}</strong><small>{user.email}</small></span></button>)}</div> : null}
        {error ? <div className="discussion-error">{error}</div> : null}
        <div className="discussion-composer-actions">
          <label className="secondary-button discussion-upload-button"><Paperclip size={14} />{uploading ? "上传中…" : "图片/附件"}<input type="file" multiple disabled={uploading || attachments.length >= 10} onChange={(event) => { void uploadFiles(event.target.files); event.currentTarget.value = ""; }} /></label>
          <span>Ctrl/⌘ + Enter 发送</span>
          <button className="primary-button" type="button" disabled={pending || uploading || (!body.trim() && !attachments.length)} onClick={() => void submit()}>{pending ? <Loader2 className="spin-icon" size={14} /> : <Send size={14} />}{editing ? "保存" : "发送"}</button>
        </div>
      </div>
    </section>
  );
}

function DiscussionAttachment({ attachment }: { attachment: DiscussionAttachmentDto }) {
  const image = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(attachment.contentType.toLowerCase());
  return image ? (
    <a className="discussion-image" href={attachment.downloadUrl} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={attachment.downloadUrl} alt={attachment.fileName} />
      <span><ImageIcon size={13} />{attachment.fileName}</span>
    </a>
  ) : (
    <a className="discussion-file" href={attachment.downloadUrl}><File size={18} /><span><strong>{attachment.fileName}</strong><small>{formatBytes(attachment.size)}</small></span><Download size={15} /></a>
  );
}

function discussionMessagesUrl(target: DiscussionTarget): string {
  const params = new URLSearchParams({ type: target.type, targetId: target.targetId });
  if (target.type === "record") params.set("objectKey", target.objectKey);
  return `/api/discussions/messages?${params.toString()}`;
}

async function discussionFetch<T = unknown>(url: string, options: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const response = await fetch(url, { method: options.method ?? "GET", headers: options.form ? undefined : options.body === undefined ? undefined : { "content-type": "application/json" }, body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "团队讨论请求失败");
  return payload as T;
}

function mergeMessages(left: DiscussionMessageDto[], right: DiscussionMessageDto[]): DiscussionMessageDto[] {
  return [...new Map([...left, ...right].map((message) => [message.id, message])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function BufferlessCursor(message: DiscussionMessageDto): string {
  const text = `${message.createdAt}|${message.id}`;
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function renderMentions(body: string) {
  return body.split(/(@[^\s@]+)/g).map((part, index) => part.startsWith("@") ? <strong className="discussion-mention" key={`${part}-${index}`}>{part}</strong> : part);
}

function formatDiscussionTime(value: string): string {
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return date.toLocaleString("zh-CN");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "团队讨论操作失败";
}
