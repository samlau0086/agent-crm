"use client";

import { Database, Edit2, RefreshCw, Save, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AiProviderProfile, KnowledgeArticle, KnowledgeVectorSettings, KnowledgeVectorStatus } from "@/lib/crm/types";

export type KnowledgeArticleDraft = {
  title: string;
  body: string;
  tags: string;
  active: boolean;
  editingArticleId?: string;
};

type KnowledgeVectorDraft = Omit<KnowledgeVectorSettings, "workspaceId" | "updatedAt">;

type KnowledgeBaseManagerProps = {
  knowledgeArticles: KnowledgeArticle[];
  knowledgeDraft: KnowledgeArticleDraft;
  knowledgeVectorSettings?: KnowledgeVectorSettings;
  providerProfiles?: AiProviderProfile[];
  disabled?: boolean;
  activeLimit?: number;
  helperText?: string;
  vectorActionKey?: string | null;
  onKnowledgeDraftChange: (draft: KnowledgeArticleDraft) => void;
  onCreateKnowledgeArticle: () => void;
  onUpdateKnowledgeArticle: (articleId: string, patch: Partial<Pick<KnowledgeArticle, "active">>) => void;
  onDeleteKnowledgeArticle?: (articleId: string) => void;
  onSaveKnowledgeVectorSettings?: (patch: Partial<KnowledgeVectorDraft>) => void;
  onVectorizeKnowledgeArticle?: (articleId: string) => void;
  onVectorizeKnowledge?: () => void;
};

const defaultVectorDraft: KnowledgeVectorDraft = {
  enabled: false,
  providerProfileKey: "openai",
  embeddingModel: "text-embedding-3-small",
  dimensions: 1536,
  chunkSizeChars: 1200,
  chunkOverlapChars: 200,
  topK: 5,
  similarityThreshold: 0.25
};

export function KnowledgeBaseManager({
  knowledgeArticles,
  knowledgeDraft,
  knowledgeVectorSettings,
  providerProfiles = [],
  disabled = false,
  activeLimit,
  helperText,
  vectorActionKey,
  onKnowledgeDraftChange,
  onCreateKnowledgeArticle,
  onUpdateKnowledgeArticle,
  onDeleteKnowledgeArticle,
  onSaveKnowledgeVectorSettings,
  onVectorizeKnowledgeArticle,
  onVectorizeKnowledge
}: KnowledgeBaseManagerProps) {
  const [activeTab, setActiveTab] = useState<"content" | "vector">("content");
  const [vectorDraft, setVectorDraft] = useState<KnowledgeVectorDraft>(() => vectorSettingsToDraft(knowledgeVectorSettings));
  const activeKnowledgeArticleCount = knowledgeArticles.filter((article) => article.active).length;
  const providerOptions = useMemo(() => {
    const configured = providerProfiles.map((profile) => ({ key: profile.key, label: `${profile.name} (${profile.provider})` }));
    return configured.length ? configured : [{ key: "openai", label: "OpenAI-compatible" }];
  }, [providerProfiles]);
  const indexedCount = knowledgeArticles.filter((article) => article.vectorStatus?.state === "indexed").length;
  const staleCount = knowledgeArticles.filter((article) => article.vectorStatus?.state === "stale").length;
  const failedCount = knowledgeArticles.filter((article) => article.vectorStatus?.state === "failed").length;

  useEffect(() => {
    setVectorDraft(vectorSettingsToDraft(knowledgeVectorSettings));
  }, [knowledgeVectorSettings]);

  return (
    <div className="settings-item" data-testid="knowledge-base-manager">
      <div className="settings-panel-header">
        <div>
          <strong>系统知识库</strong>
          <p className="subtle">
            {helperText ?? "这些知识会进入邮件撰写、Talk about this、工作流和其他 AI Agent 的上下文。产品事实仍直接读取产品目录。"}
          </p>
          {knowledgeDraft.editingArticleId ? <div className="subtle">正在编辑已有知识条目，保存后会将向量索引标记为过期。</div> : null}
        </div>
        <span className="badge">
          知识 {activeKnowledgeArticleCount}
          {activeLimit ? `/${activeLimit}` : ""}
        </span>
      </div>

      <div className="button-row" style={{ marginTop: 10 }}>
        <button className={activeTab === "content" ? "primary-button" : "secondary-button"} type="button" onClick={() => setActiveTab("content")}>
          知识内容
        </button>
        <button className={activeTab === "vector" ? "primary-button" : "secondary-button"} type="button" onClick={() => setActiveTab("vector")}>
          <Database size={15} />
          向量化配置
        </button>
      </div>

      {activeTab === "content" ? (
        <>
          <div className="form-grid" style={{ marginTop: 12 }}>
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
                  <div className="button-row">
                    <span className={article.active ? "badge" : "muted-badge"}>{article.active ? "启用" : "停用"}</span>
                    {renderVectorStatusBadge(article.vectorStatus)}
                  </div>
                </div>
                <div className="subtle" style={{ marginTop: 6 }}>
                  {article.body.slice(0, 180)}
                  {article.body.length > 180 ? "..." : ""}
                </div>
                {article.vectorStatus?.errorMessage ? <div className="error-text" style={{ marginTop: 6 }}>{article.vectorStatus.errorMessage}</div> : null}
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
                  {onVectorizeKnowledgeArticle ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => onVectorizeKnowledgeArticle(article.id)}
                      disabled={disabled || Boolean(vectorActionKey)}
                    >
                      <RefreshCw className={vectorActionKey === `article:${article.id}` ? "spin-icon" : undefined} size={14} />
                      重建索引
                    </button>
                  ) : null}
                  {onDeleteKnowledgeArticle ? (
                    <button className="danger-button" type="button" onClick={() => onDeleteKnowledgeArticle(article.id)} disabled={disabled || Boolean(vectorActionKey)}>
                      <Trash2 size={14} />
                      删除
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {knowledgeArticles.length === 0 ? <div className="empty-state">暂无知识条目。添加部署、销售话术、报价政策或常见异议处理后，AI 会在生成内容时引用它们。</div> : null}
          </div>
        </>
      ) : (
        <div className="settings-panel" style={{ marginTop: 12 }}>
          <div className="settings-panel-header">
            <div>
              <h3 className="panel-title">向量化检索</h3>
              <p className="subtle">开启后，AI 会优先用 pgvector 检索相关知识 chunk；不可用时自动回退关键词检索。</p>
            </div>
            <div className="button-row">
              <span className="badge">已索引 {indexedCount}</span>
              {staleCount ? <span className="muted-badge">过期 {staleCount}</span> : null}
              {failedCount ? <span className="danger-badge">失败 {failedCount}</span> : null}
            </div>
          </div>
          <div className="form-grid">
            <label className="settings-toggle">
              <input type="checkbox" checked={vectorDraft.enabled} onChange={(event) => setVectorDraft((current) => ({ ...current, enabled: event.target.checked }))} />
              启用向量检索
            </label>
            <label>
              <span className="subtle">Provider</span>
              <select className="input" value={vectorDraft.providerProfileKey} onChange={(event) => setVectorDraft((current) => ({ ...current, providerProfileKey: event.target.value }))}>
                {providerOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="subtle">Embedding model</span>
              <input className="input" value={vectorDraft.embeddingModel} onChange={(event) => setVectorDraft((current) => ({ ...current, embeddingModel: event.target.value }))} />
            </label>
            <label>
              <span className="subtle">维度</span>
              <input className="input" type="number" min={1} value={vectorDraft.dimensions} onChange={(event) => setVectorDraft((current) => ({ ...current, dimensions: Number(event.target.value) }))} />
            </label>
            <label>
              <span className="subtle">Chunk size</span>
              <input className="input" type="number" min={200} value={vectorDraft.chunkSizeChars} onChange={(event) => setVectorDraft((current) => ({ ...current, chunkSizeChars: Number(event.target.value) }))} />
            </label>
            <label>
              <span className="subtle">Chunk overlap</span>
              <input className="input" type="number" min={0} value={vectorDraft.chunkOverlapChars} onChange={(event) => setVectorDraft((current) => ({ ...current, chunkOverlapChars: Number(event.target.value) }))} />
            </label>
            <label>
              <span className="subtle">Top K</span>
              <input className="input" type="number" min={1} max={20} value={vectorDraft.topK} onChange={(event) => setVectorDraft((current) => ({ ...current, topK: Number(event.target.value) }))} />
            </label>
            <label>
              <span className="subtle">相似度阈值</span>
              <input className="input" type="number" min={0} max={1} step={0.01} value={vectorDraft.similarityThreshold} onChange={(event) => setVectorDraft((current) => ({ ...current, similarityThreshold: Number(event.target.value) }))} />
            </label>
          </div>
          <div className="button-row" style={{ marginTop: 12 }}>
            <button className="primary-button" type="button" onClick={() => onSaveKnowledgeVectorSettings?.(vectorDraft)} disabled={disabled || Boolean(vectorActionKey) || !onSaveKnowledgeVectorSettings}>
              <Save size={15} />
              保存向量配置
            </button>
            <button className="secondary-button" type="button" onClick={() => onVectorizeKnowledge?.()} disabled={disabled || Boolean(vectorActionKey) || !onVectorizeKnowledge}>
              <RefreshCw className={vectorActionKey === "bulk" ? "spin-icon" : undefined} size={15} />
              重建全部索引
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function vectorSettingsToDraft(settings?: KnowledgeVectorSettings): KnowledgeVectorDraft {
  return {
    ...defaultVectorDraft,
    ...(settings
      ? {
          enabled: settings.enabled,
          providerProfileKey: settings.providerProfileKey,
          embeddingModel: settings.embeddingModel,
          dimensions: settings.dimensions,
          chunkSizeChars: settings.chunkSizeChars,
          chunkOverlapChars: settings.chunkOverlapChars,
          topK: settings.topK,
          similarityThreshold: settings.similarityThreshold
        }
      : {})
  };
}

function renderVectorStatusBadge(status?: KnowledgeVectorStatus) {
  if (!status || status.state === "not_indexed") {
    return <span className="muted-badge">未索引</span>;
  }
  if (status.state === "indexed") {
    return <span className="badge">已索引 {status.chunkCount}</span>;
  }
  if (status.state === "stale") {
    return <span className="muted-badge">索引过期</span>;
  }
  return <span className="danger-badge">索引失败</span>;
}
