import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const workspaceCount = await prisma.workspace.count();
  if (workspaceCount > 0) {
    console.log(`Skipping seed: database already has ${workspaceCount} workspace(s).`);
    process.exit(0);
  }
} finally {
  await prisma.$disconnect();
}

console.log("Database is empty. Running seed script.");

const child = spawn(process.execPath, ["--experimental-strip-types", "prisma/seed.ts"], {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
