import { PrismaClient } from "@prisma/client";

type GlobalWithPrisma = typeof globalThis & {
  __prisma?: PrismaClient;
};

function getPrismaClient(): PrismaClient {
  const globalWithPrisma = globalThis as GlobalWithPrisma;
  globalWithPrisma.__prisma ??= new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });
  return globalWithPrisma.__prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  }
});
