import type { Permission, RequestContext } from "@/lib/crm/types";

export function hasPermission(context: RequestContext, permission: Permission): boolean {
  if (context.role.permissions.includes(permission)) {
    return true;
  }
  if (permission === "ai.admin") {
    return context.role.permissions.includes("crm.admin");
  }
  if (permission === "ai.use") {
    return context.role.permissions.includes("ai.admin") || context.role.permissions.includes("crm.admin");
  }
  return false;
}

export function requirePermission(context: RequestContext, permission: Permission): void {
  if (!hasPermission(context, permission)) {
    throw new Error(`Missing permission: ${permission}`);
  }
}

export function canManageAllRecords(context: RequestContext): boolean {
  return hasPermission(context, "crm.admin");
}

export function canAccessRecordOwner(context: RequestContext, ownerId: string | undefined, ownerTeamId?: string): boolean {
  if (canManageAllRecords(context)) {
    return true;
  }

  if (!ownerId) {
    return false;
  }

  return ownerId === context.user.id || Boolean(context.user.teamId && ownerTeamId && ownerTeamId === context.user.teamId);
}
