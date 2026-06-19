import type { Permission, RequestContext } from "@/lib/crm/types";

export function hasPermission(context: RequestContext, permission: Permission): boolean {
  return context.role.permissions.includes(permission);
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
