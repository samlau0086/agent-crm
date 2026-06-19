import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE_NAME = "crm_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SESSION_TOKEN_BYTES = 32;

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function deleteExpiredSessions(now = new Date()): Promise<void> {
  await prisma.session.deleteMany({
    where: {
      expiresAt: { lte: now }
    }
  });
}

export async function createUserSession(userId: string): Promise<string> {
  await deleteExpiredSessions();

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.session.create({
    data: {
      token: hashSessionToken(token),
      userId,
      expiresAt
    }
  });

  return token;
}

export async function destroyUserSession(token: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { token: hashSessionToken(token) }
  });
}

export async function destroySessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId }
  });
}

export async function getSessionUserId(token: string): Promise<string | null> {
  const session = await prisma.session.findFirst({
    where: {
      token: hashSessionToken(token),
      expiresAt: { gt: new Date() },
      user: { active: true }
    },
    select: { userId: true }
  });

  if (!session) {
    await deleteExpiredSessions();
    return null;
  }

  return session.userId;
}
