import { setTimeout as sleep } from "node:timers/promises";
import { runQueuedJobOnce } from "@/lib/jobs/worker";

const loop = process.argv.includes("--loop");
const pollMs = Number(process.env.JOB_WORKER_POLL_MS || 2000);

async function tick() {
  const result = await runQueuedJobOnce();
  if (result.processed) {
    if (result.requeued) {
      console.log(`Requeued job after worker error: ${result.error ?? "unknown error"}`);
      return;
    }
    if (result.deadLettered) {
      console.log(`Moved job to dead letter queue: ${result.error ?? "unknown error"}`);
      return;
    }
    console.log(`Processed job ${result.job?.id ?? "unknown"} with status ${result.job?.status ?? "unknown"}`);
  }
}

if (loop) {
  while (true) {
    await tick();
    await sleep(pollMs);
  }
} else {
  await tick();
}
