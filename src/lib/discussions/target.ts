import { ApiError } from "@/lib/api-error";
import { requirePermission } from "@/lib/auth/rbac";
import { getCrmRepository } from "@/lib/crm/repository";
import type { RequestContext } from "@/lib/crm/types";
import type { DiscussionTarget } from "@/lib/discussions/types";

const objectKeyPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const idPattern = /^[a-zA-Z0-9_-]{1,200}$/;

export function buildDiscussionTargetKey(target: DiscussionTarget): string {
  if (!idPattern.test(target.targetId)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Discussion target id is invalid");
  }
  if (target.type === "record") {
    if (!objectKeyPattern.test(target.objectKey)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Discussion object key is invalid");
    }
    return `record:${target.objectKey}:${target.targetId}`;
  }
  return `${target.type}:${target.targetId}`;
}

export function parseDiscussionTarget(input: Record<string, unknown>): DiscussionTarget {
  const type = String(input.type ?? "");
  const targetId = String(input.targetId ?? "").trim();
  if (type === "record") {
    const target = { type, objectKey: String(input.objectKey ?? "").trim(), targetId } as const;
    buildDiscussionTargetKey(target);
    return target;
  }
  if (type === "activity" || type === "email_thread") {
    const target = { type, targetId } as DiscussionTarget;
    buildDiscussionTargetKey(target);
    return target;
  }
  throw new ApiError(400, "VALIDATION_ERROR", "Discussion target type is invalid");
}

export async function assertDiscussionTargetAccess(context: RequestContext, target: DiscussionTarget, write = false): Promise<void> {
  requirePermission(context, write ? "crm.write" : "crm.read");
  const repository = getCrmRepository();
  if (target.type === "record") {
    await repository.getRecord(context, target.objectKey, target.targetId);
  } else if (target.type === "activity") {
    await repository.getActivity(context, target.targetId);
  } else {
    await repository.getEmailThread(context, target.targetId);
  }
}

export function targetFromThread(thread: { targetType: string; objectKey: string | null; targetId: string }): DiscussionTarget {
  if (thread.targetType === "record" && thread.objectKey) {
    return { type: "record", objectKey: thread.objectKey, targetId: thread.targetId };
  }
  if (thread.targetType === "activity" || thread.targetType === "email_thread") {
    return { type: thread.targetType, targetId: thread.targetId };
  }
  throw new ApiError(500, "INTERNAL_ERROR", "Discussion target is invalid");
}
