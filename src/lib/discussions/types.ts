export type DiscussionTarget =
  | { type: "record"; objectKey: string; targetId: string }
  | { type: "activity"; targetId: string }
  | { type: "email_thread"; targetId: string };

export interface DiscussionAttachmentDto {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  downloadUrl: string;
}

export interface DiscussionMessageDto {
  id: string;
  threadId: string;
  author: { id: string; name: string; avatarMediaAssetId?: string };
  body: string;
  replyTo?: { id: string; authorName: string; body: string; deleted: boolean };
  attachments: DiscussionAttachmentDto[];
  mentionUserIds: string[];
  editedAt?: string;
  deletedAt?: string;
  createdAt: string;
}

export interface DiscussionMessagesPage {
  messages: DiscussionMessageDto[];
  nextBefore?: string;
  latestCursor?: string;
  unreadCount: number;
}

export interface DiscussionNotificationDto {
  id: string;
  type: "mention" | "reply";
  readAt?: string;
  createdAt: string;
  messageId: string;
  preview: string;
  authorName: string;
  target: DiscussionTarget;
}
