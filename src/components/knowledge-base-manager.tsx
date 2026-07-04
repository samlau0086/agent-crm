"use client";

import { Edit2, Save, XCircle } from "lucide-react";
import type { KnowledgeArticle } from "@/lib/crm/types";

export type KnowledgeArticleDraft = {
  title: string;
  body: string;
  tags: string;
  active: boolean;
  editingArticleId?: string;
};

type KnowledgeBaseManagerProps = {
  knowledgeArticles: KnowledgeArticle[];
  knowledgeDraft: KnowledgeArticleDraft;
  disabled?: boolean;
  activeLimit?: number;
  helperText?: string;
  onKnowledgeDraftChange: (draft: KnowledgeArticleDraft) => void;
  onCreateKnowledgeArticle: () => void;
  onUpdateKnowledgeArticle: (articleId: string, patch: Partial<Pick<KnowledgeArticle, "active">>) => void;
};

export function KnowledgeBaseManager({
  knowledgeArticles,
  knowledgeDraft,
  disabled = false,
  activeLimit,
  helperText,
  onKnowledgeDraftChange,
  onCreateKnowledgeArticle,
  onUpdateKnowledgeArticle
}: KnowledgeBaseManagerProps) {
  const activeKnowledgeArticleCount = knowledgeArticles.filter((article) => article.active).length;

  return (
    <div className="settings-item" data-testid="knowledge-base-manager">
      <div className="settings-panel-header">
        <div>
          <strong>系统知识库</strong>
          <p className="subtle">{helperText ?? "这些知识会进入开启知识库上下文的 AI Agent，例如邮件写作、线程分析、Talk about this 和工作流设计。"}</p>
          {knowledgeDraft.editingArticleId ? <div className="subtle">正在编辑已有知识条目，保存后会更新 AI 可用的知识库内容。</div> : null}
        </div>
        <span className="badge">知识 {activeKnowledgeArticleCount}{activeLimit ? `/${activeLimit}` : ""}</span>
      </div>
      <div className="form-grid" style={{ marginTop: 8 }}>
        <label>
          <span className="subtle">标题</span>
          <input className="input" data-testid="knowledge-title" value={knowledgeDraft.title} onChange={(event) => onKnowledgeDraftChange({ ...knowledgeDraft, title: event.target.value })} />
        </label>
        <label>
          <span className="subtle">标签</span>
          <input className="input" data-testid="knowledge-tags" value={knowledgeDraft.tags} onChange={(event) => onKnowledgeDraftChange({ ...knowledgeDraft, tags: event.target.value })} placeholder="pricing, onboarding" />
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={knowledgeDraft.active} onChange={(event) => onKnowledgeDraftChange({ ...knowledgeDraft, active: event.target.checked })} />
          启用
        </label>
        <label className="wide">
          <span className="subtle">内容</span>
          <textarea className="textarea" data-testid="knowledge-body" value={knowledgeDraft.body} onChange={(event) => onKnowledgeDraftChange({ ...knowledgeDraft, body: event.target.value })} />
        </label>
      </div>
      <div className="button-row" style={{ marginTop: 8 }}>
        <button className="secondary-button" data-testid="knowledge-create" type="button" onClick={onCreateKnowledgeArticle} disabled={disabled || !knowledgeDraft.title.trim() || !knowledgeDraft.body.trim()}>
          <Save size={16} />
          {knowledgeDraft.editingArticleId ? "保存知识" : "添加知识"}
        </button>
        {knowledgeDraft.editingArticleId ? (
          <button className="ghost-button" data-testid="knowledge-edit-cancel" type="button" onClick={() => onKnowledgeDraftChange({ title: "", body: "", tags: "", active: true })} disabled={disabled}>
            <XCircle size={16} />
            取消编辑
          </button>
        ) : null}
      </div>
      <div className="activity-list" style={{ marginTop: 12 }}>
        {knowledgeArticles.map((article) => (
          <article className="activity-item" key={article.id}>
            <div className="activity-header-row">
              <div>
                <strong>{article.title}</strong>
                <div className="subtle">{article.tags.length ? article.tags.join(", ") : "无标签"}</div>
              </div>
              <span className={article.active ? "badge" : "muted-badge"}>{article.active ? "on" : "off"}</span>
            </div>
            <div className="subtle" style={{ marginTop: 6 }}>{article.body.slice(0, 180)}{article.body.length > 180 ? "..." : ""}</div>
            <div className="button-row" style={{ marginTop: 8 }}>
              <button
                className="secondary-button"
                data-testid="knowledge-edit"
                type="button"
                onClick={() => onKnowledgeDraftChange({ editingArticleId: article.id, title: article.title, body: article.body, tags: article.tags.join(", "), active: article.active })}
                disabled={disabled}
              >
                <Edit2 size={14} />
                编辑
              </button>
              <button
                className={article.active ? "ghost-button" : "secondary-button"}
                data-testid="knowledge-toggle"
                type="button"
                onClick={() => onUpdateKnowledgeArticle(article.id, { active: !article.active })}
                disabled={disabled}
              >
                {article.active ? "停用" : "启用"}
              </button>
            </div>
          </article>
        ))}
        {knowledgeArticles.length === 0 ? <div className="empty-state">暂无知识条目。添加产品、部署、报价或常见异议处理内容后，AI 生成邮件和分析时会引用它们。</div> : null}
      </div>
    </div>
  );
}
