import { setTimeout as sleep } from "node:timers/promises";
import { formatJobWorkerResult, runQueuedJobOnce } from "@/lib/jobs/worker";
import { assertDatabaseReachable } from "./database-preflight.ts";
import { loadLocalEnvFiles } from "./load-env.ts";

loadLocalEnvFiles();

const loop = process.argv.includes("--loop");
const pollMs = Number(process.env.JOB_WORKER_POLL_MS || 2000);

async function tick() {
  const result = await runQueuedJobOnce();
  const message = formatJobWorkerResult(result);
  if (message) {
    console.log(message);
  }
}

try {
  await assertDatabaseReachable({ label: "job-worker" });
  if (loop) {
    while (true) {
      await tick();
      await sleep(pollMs);
    }
  } else {
    await tick();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Job worker failed.");
  process.exit(1);
}
