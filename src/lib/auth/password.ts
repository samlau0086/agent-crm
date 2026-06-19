import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) {
    return false;
  }

  const incoming = scryptSync(password, salt, KEY_LENGTH);
  const existing = Buffer.from(hash, "hex");

  if (incoming.length !== existing.length) {
    return false;
  }

  return timingSafeEqual(incoming, existing);
}
