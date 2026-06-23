import { setTimeout as sleep } from "node:timers/promises";
import { formatJobWorkerResult, runQueuedJobOnce } from "@/lib/jobs/worker";
import { assertDatabaseReachable } from "./database-preflight.ts";
import { loadLocalEnvFiles } from "./load-env.ts";

loadLocalEnvFiles();

const loop = process.argv.includes("--loop");
const pollMs = Number(process.env.JOB_WORKER_POLL_MS || 2000);
let stopping = false;

async function tick() {
  const result = await runQueuedJobOnce();
  const message = formatJobWorkerResult(result);
  if (message) {
    console.log(message);
  }
}

try {
  if (loop) {
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await waitForDatabase();
    while (!stopping) {
      try {
        await tick();
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Job worker tick failed.");
      }
      await sleep(pollMs);
    }
  } else {
    await assertDatabaseReachable({ label: "job-worker" });
    await tick();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Job worker failed.");
  process.exit(1);
}

async function waitForDatabase(): Promise<void> {
  while (!stopping) {
    try {
      await assertDatabaseReachable({ label: "job-worker" });
      return;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Job worker database preflight failed.");
      await sleep(pollMs);
    }
  }
}

function stop(): void {
  stopping = true;
}
