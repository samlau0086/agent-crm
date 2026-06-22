import { getRequestContextByUserId } from "@/lib/crm/repository";
import { prisma } from "@/lib/db";
import type { Permission, RequestContext } from "@/lib/crm/types";

export interface OperationalUserSelection {
  userId?: string;
  strict?: boolean;
  purpose: string;
  requiredPermission?: Permission;
}

export interface OperationalUserResolution {
  context: RequestContext;
  requestedUserId?: string;
  resolvedUserId: string;
  strict: boolean;
  fallbackUsed: boolean;
  requiredPermission: Permission;
}

export async function resolveOperationalUser(selection: OperationalUserSelection): Promise<OperationalUserResolution> {
  const requiredPermission = selection.requiredPermission ?? "crm.admin";
  const requestedUserId = selection.userId?.trim() || undefined;
  const strict = selection.strict === true;
  if (requestedUserId) {
    try {
      const context = await getRequestContextByUserId(requestedUserId);
      assertOperationalPermission(context, requiredPermission, selection.purpose);
      return {
        context,
        requestedUserId,
        resolvedUserId: context.user.id,
        strict,
        fallbackUsed: false,
        requiredPermission
      };
    } catch (error) {
      if (strict) {
        throw error;
      }
      const missing = error instanceof Error && /Current user is not available/.test(error.message);
      if (!missing) {
        throw error;
      }
    }
  }

  const fallback = await prisma.user.findFirst({
    where: {
      active: true,
      role: {
        is: {
          permissions: {
            has: requiredPermission
          }
        }
      }
    },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });

  if (!fallback) {
    throw new Error(`No active user with ${requiredPermission} was found; set --user-id, EMAIL_VERIFY_USER_ID, EMAIL_SYNC_USER_ID, or JOB_USER_ID for ${selection.purpose}.`);
  }

  const context = await getRequestContextByUserId(fallback.id);
  assertOperationalPermission(context, requiredPermission, selection.purpose);
  return {
    context,
    requestedUserId,
    resolvedUserId: context.user.id,
    strict,
    fallbackUsed: Boolean(requestedUserId && requestedUserId !== context.user.id),
    requiredPermission
  };
}

export async function resolveOperationalRequestContext(selection: OperationalUserSelection): Promise<RequestContext> {
  return (await resolveOperationalUser(selection)).context;
}

export function configuredOperationalUserId(args: Record<string, string | boolean>, envNames: string[], fallback = "user-admin"): { userId: string; strict: boolean } {
  const cliValue = typeof args["user-id"] === "string" ? args["user-id"].trim() : "";
  if (cliValue) {
    return { userId: cliValue, strict: true };
  }
  for (const envName of envNames) {
    const value = process.env[envName]?.trim();
    if (value) {
      return { userId: value, strict: false };
    }
  }
  return { userId: fallback, strict: false };
}

function assertOperationalPermission(context: RequestContext, permission: Permission, purpose: string): void {
  if (!context.role.permissions.includes(permission)) {
    throw new Error(`${purpose} user ${context.user.id} must have ${permission} permission.`);
  }
}
