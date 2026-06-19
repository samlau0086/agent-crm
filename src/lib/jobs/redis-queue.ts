import net from "node:net";

type RedisReply = string | number | null | RedisReply[];

const DEFAULT_QUEUE_NAME = "crm:jobs";
const DEFAULT_REDIS_TIMEOUT_MS = 5000;

export function getJobQueueName(): string {
  return process.env.JOB_QUEUE_NAME?.trim() || DEFAULT_QUEUE_NAME;
}

export function getDeadLetterQueueName(queueName = getJobQueueName()): string {
  return process.env.JOB_DEAD_LETTER_QUEUE_NAME?.trim() || `${queueName}:dead`;
}

export async function enqueueJob(queueName: string, payload: unknown): Promise<number> {
  const reply = await redisCommand(["LPUSH", queueName, JSON.stringify(payload)]);
  if (typeof reply !== "number") {
    throw new Error("Redis queue did not return a numeric length");
  }
  return reply;
}

export async function dequeueJob<T>(queueName: string): Promise<T | undefined> {
  const reply = await redisCommand(["RPOP", queueName]);
  if (reply === null) {
    return undefined;
  }
  if (typeof reply !== "string") {
    throw new Error("Redis queue returned an invalid job payload");
  }
  return JSON.parse(reply) as T;
}

export async function redisCommand(parts: string[], redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"): Promise<RedisReply> {
  const url = new URL(redisUrl);
  const port = Number(url.port || 6379);
  const host = url.hostname || "127.0.0.1";
  const timeoutMs = Number(process.env.REDIS_TIMEOUT_MS || DEFAULT_REDIS_TIMEOUT_MS);
  const commandPayloads = buildCommandPayloads(url, parts);

  return new Promise<RedisReply>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks: Buffer[] = [];
    let timeout: NodeJS.Timeout | undefined;
    let settled = false;

    function cleanup() {
      if (timeout) {
        clearTimeout(timeout);
      }
      socket.removeAllListeners();
      socket.destroy();
    }

    function fail(error: Error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    }

    timeout = setTimeout(() => fail(new Error("Redis queue command timed out")), timeoutMs);

    socket.on("connect", () => {
      for (const payload of commandPayloads) {
        socket.write(payload);
      }
    });

    socket.on("data", (chunk) => {
      chunks.push(chunk);
      try {
        const parsed = tryParseReplies(Buffer.concat(chunks), commandPayloads.length);
        if (!parsed) {
          return;
        }
        settled = true;
        cleanup();
        resolve(parsed[parsed.length - 1] ?? null);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Redis queue command failed"));
      }
    });

    socket.on("error", fail);
    socket.on("end", () => fail(new Error("Redis connection closed before a reply was received")));
  });
}

function buildCommandPayloads(url: URL, parts: string[]): Buffer[] {
  const payloads: Buffer[] = [];
  const password = decodeURIComponent(url.password);
  const username = decodeURIComponent(url.username);

  if (password) {
    payloads.push(encodeRedisCommand(username ? ["AUTH", username, password] : ["AUTH", password]));
  }

  payloads.push(encodeRedisCommand(parts));
  return payloads;
}

export function encodeRedisCommand(parts: string[]): Buffer {
  const buffers: Buffer[] = [Buffer.from(`*${parts.length}\r\n`, "utf8")];
  for (const part of parts) {
    const value = Buffer.from(part, "utf8");
    buffers.push(Buffer.from(`$${value.length}\r\n`, "utf8"), value, Buffer.from("\r\n", "utf8"));
  }
  return Buffer.concat(buffers);
}

function tryParseReplies(buffer: Buffer, expectedReplies: number): RedisReply[] | undefined {
  try {
    let offset = 0;
    const replies: RedisReply[] = [];
    while (offset < buffer.length && replies.length < expectedReplies) {
      const parsed = parseReply(buffer, offset);
      replies.push(parsed.value);
      offset = parsed.offset;
    }
    return replies.length === expectedReplies ? replies : undefined;
  } catch (error) {
    if (error instanceof NeedMoreDataError) {
      return undefined;
    }
    throw error;
  }
}

function parseReply(buffer: Buffer, offset: number): { value: RedisReply; offset: number } {
  if (offset >= buffer.length) {
    throw new NeedMoreDataError();
  }

  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd === -1) {
    throw new NeedMoreDataError();
  }

  const line = buffer.toString("utf8", offset + 1, lineEnd);
  const nextOffset = lineEnd + 2;

  if (prefix === "+") {
    return { value: line, offset: nextOffset };
  }

  if (prefix === "-") {
    throw new Error(`Redis queue error: ${line}`);
  }

  if (prefix === ":") {
    return { value: Number(line), offset: nextOffset };
  }

  if (prefix === "$") {
    const length = Number(line);
    if (length === -1) {
      return { value: null, offset: nextOffset };
    }
    const end = nextOffset + length;
    if (buffer.length < end + 2) {
      throw new NeedMoreDataError();
    }
    return { value: buffer.toString("utf8", nextOffset, end), offset: end + 2 };
  }

  if (prefix === "*") {
    const count = Number(line);
    if (count === -1) {
      return { value: null, offset: nextOffset };
    }
    let itemOffset = nextOffset;
    const values: RedisReply[] = [];
    for (let index = 0; index < count; index += 1) {
      const parsed = parseReply(buffer, itemOffset);
      values.push(parsed.value);
      itemOffset = parsed.offset;
    }
    return { value: values, offset: itemOffset };
  }

  throw new Error("Redis queue returned an unknown reply type");
}

class NeedMoreDataError extends Error {}
