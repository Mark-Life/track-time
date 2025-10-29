import { redis } from "bun";
import type { Entry, Timer } from "./types.ts";

// Initialize Redis connection
redis.connect();

// Get active timer
export async function getActiveTimer(): Promise<Timer | null> {
  const startedAt = await redis.hget("active:timer", "startedAt");
  if (!startedAt) {
    return null;
  }
  return { startedAt: startedAt as string };
}

// Start timer
export async function startTimer(): Promise<Timer> {
  const startedAt = new Date().toISOString();
  await redis.hset("active:timer", "startedAt", startedAt);
  console.log(`⏱️  Timer started at ${startedAt}`);
  return { startedAt };
}

// Stop timer and save entry
export async function stopTimer(): Promise<Entry | null> {
  const timer = await getActiveTimer();
  if (!timer) {
    return null;
  }

  const endedAt = new Date().toISOString();
  const startTime = new Date(timer.startedAt).getTime();
  const endTime = new Date(endedAt).getTime();
  const duration = (endTime - startTime) / (1000 * 60 * 60); // hours in decimal

  const id = crypto.randomUUID();
  const entry: Entry = {
    id,
    startedAt: timer.startedAt,
    endedAt,
    duration,
  };

  // Save entry to Redis
  await redis.hset(`entry:${id}`, {
    id,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    duration: entry.duration.toString(),
  });
  await redis.sadd("entries:list", id);

  // Remove active timer
  await redis.del("active:timer");

  console.log("✅ Timer stopped - Entry created:");
  console.log(`   ID: ${entry.id}`);
  console.log(`   Started: ${entry.startedAt}`);
  console.log(`   Ended: ${entry.endedAt}`);
  console.log(
    `   Duration: ${entry.duration.toFixed(4)} hours (${(entry.duration * 60).toFixed(2)} minutes)`
  );

  return entry;
}

// Get all entries
export async function getEntries(): Promise<Entry[]> {
  const ids = await redis.smembers("entries:list");
  if (!ids || ids.length === 0) {
    console.log("📋 No entries found");
    return [];
  }

  const entries: Entry[] = [];
  for (const id of ids) {
    const data = await redis.hgetall(`entry:${id}`);
    if (data) {
      entries.push({
        id: data.id as string,
        startedAt: data.startedAt as string,
        endedAt: data.endedAt as string,
        duration: Number.parseFloat(data.duration as string),
      });
    }
  }

  // Sort by startedAt descending (newest first)
  const sorted = entries.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  console.log(`📋 Loaded ${sorted.length} entries from Redis`);
  return sorted;
}
