"use client";

import {
  Activity,
  Bot,
  CalendarClock,
  CheckCircle2,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  UserRound,
  type LucideIcon
} from "lucide-react";
import type { ReactNode } from "react";

export type RecordDetailTab = "activities" | "emails" | "notes" | "tasks" | "calls" | "meetings" | "details" | "ai" | "discussions";

export type RecordDetailTabCounts = Partial<Record<RecordDetailTab, number>>;

const recordDetailTabs = [
  { key: "ai", label: "AI 协作", icon: Bot },
  { key: "discussions", label: "团队讨论", icon: MessageCircle },
  { key: "activities", label: "活动时间线", icon: Activity },
  { key: "emails", label: "邮件", icon: Mail },
  { key: "notes", label: "备注", icon: FileText },
  { key: "tasks", label: "任务", icon: CheckCircle2 },
  { key: "calls", label: "电话", icon: Phone },
  { key: "meetings", label: "会议", icon: CalendarClock },
  { key: "details", label: "资料详情", icon: UserRound }
] satisfies Array<{ key: RecordDetailTab; label: string; icon: LucideIcon }>;

export function RecordDetailWorkspace({
  activeTab,
  children,
  counts,
  notices,
  rail,
  summary,
  onTabChange
}: {
  activeTab: RecordDetailTab;
  children: ReactNode;
  counts?: RecordDetailTabCounts;
  notices?: ReactNode;
  rail: ReactNode;
  summary: ReactNode;
  onTabChange: (tab: RecordDetailTab) => void;
}) {
  return (
    <div className="record-detail-workspace" data-testid="record-detail-workspace" data-active-tab={activeTab}>
      {summary}
      {notices ? <div className="record-detail-notices">{notices}</div> : null}
      <div className="record-detail-layout">
        <main className="record-detail-main">
          <RecordDetailTabs activeTab={activeTab} counts={counts} onChange={onTabChange} />
          <div className="record-detail-tab-content" data-testid={`record-detail-panel-${activeTab}`}>
            {children}
          </div>
        </main>
        <aside className="record-detail-rail" data-testid="record-detail-context-rail">
          {rail}
        </aside>
      </div>
    </div>
  );
}

export function RecordDetailTabs({
  activeTab,
  counts = {},
  onChange
}: {
  activeTab: RecordDetailTab;
  counts?: RecordDetailTabCounts;
  onChange: (tab: RecordDetailTab) => void;
}) {
  return (
    <div className="record-detail-tabs" role="tablist" aria-label="记录详情" data-testid="record-detail-tabs">
      {recordDetailTabs.map((tab) => {
        const Icon = tab.icon;
        const count = counts[tab.key];
        return (
          <button
            aria-selected={activeTab === tab.key}
            className={`record-detail-tab ${activeTab === tab.key ? "active" : ""}`}
            data-testid={`record-detail-tab-${tab.key}`}
            key={tab.key}
            role="tab"
            type="button"
            onClick={() => onChange(tab.key)}
          >
            <Icon size={15} />
            <span>{tab.label}</span>
            {typeof count === "number" && count > 0 ? <span className="record-detail-tab-count">{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
