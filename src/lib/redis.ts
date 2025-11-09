import { redis } from "bun";
import { Effect } from "effect";
import type { Entry, Project, Timer } from "./types.ts";

// Redis connection resource - verifies connection before use
const connectRedis = Effect.gen(function* () {
  // Connect (idempotent - safe to call multiple times)
  redis.connect();

  // Verify connection with PING
  yield* Effect.tryPromise({
    try: () => redis.ping(),
    catch: (error) => new Error(`Failed to connect to Redis: ${error}`),
  });

  yield* Effect.log("✅ Redis connection established");

  return redis;
});

export const redisResource = Effect.acquireRelease(connectRedis, () =>
  Effect.sync(() => {
    // Cleanup if needed (Bun manages connection lifecycle)
  })
);

// Get active timer
export const getActiveTimer = (): Effect.Effect<Timer | null, Error> =>
  Effect.gen(function* () {
    const startedAt: string | null = yield* Effect.tryPromise({
      try: () => redis.hget("active:timer", "startedAt"),
      catch: (error) => new Error(`Failed to get active timer: ${error}`),
    });

    if (!startedAt) {
      return null;
    }

    const projectId: string | null = yield* Effect.tryPromise({
      try: () => redis.hget("active:timer", "projectId"),
      catch: (error) => new Error(`Failed to get timer projectId: ${error}`),
    });

    return {
      startedAt: startedAt as string,
      ...(projectId ? { projectId } : {}),
    };
  });

// Start timer
export const startTimer = (
  startedAt?: string,
  projectId?: string
): Effect.Effect<Timer, Error> =>
  Effect.gen(function* () {
    const timerStartedAt = startedAt ?? new Date().toISOString();

    const timerData: Record<string, string> = {
      startedAt: timerStartedAt,
      ...(projectId ? { projectId } : {}),
    };

    yield* Effect.tryPromise({
      try: () => redis.hset("active:timer", timerData),
      catch: (error) => new Error(`Failed to start timer: ${error}`),
    });

    yield* Effect.log(`⏱️  Timer started at ${timerStartedAt}`);

    return {
      startedAt: timerStartedAt,
      ...(projectId ? { projectId } : {}),
    };
  });

// Stop timer and save entry
export const stopTimer = (): Effect.Effect<Entry | null, Error> =>
  Effect.gen(function* () {
    const timer: Timer | null = yield* getActiveTimer();
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
      ...(timer.projectId ? { projectId: timer.projectId } : {}),
    };

    // Save entry to Redis
    const entryData: Record<string, string> = {
      id,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      duration: entry.duration.toString(),
      ...(entry.projectId ? { projectId: entry.projectId } : {}),
    };

    yield* Effect.tryPromise({
      try: () => redis.hset(`entry:${id}`, entryData),
      catch: (error) => new Error(`Failed to save entry: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.sadd("entries:list", id),
      catch: (error) => new Error(`Failed to add entry to list: ${error}`),
    });

    // Remove active timer
    yield* Effect.tryPromise({
      try: () => redis.del("active:timer"),
      catch: (error) => new Error(`Failed to delete active timer: ${error}`),
    });

    yield* Effect.log("✅ Timer stopped - Entry created:");
    yield* Effect.log(`   ID: ${entry.id}`);
    yield* Effect.log(`   Started: ${entry.startedAt}`);
    yield* Effect.log(`   Ended: ${entry.endedAt}`);
    yield* Effect.log(
      `   Duration: ${entry.duration.toFixed(4)} hours (${(entry.duration * 60).toFixed(2)} minutes)`
    );

    return entry;
  });

// Get all entries
export const getEntries = (): Effect.Effect<Entry[], Error> =>
  Effect.gen(function* () {
    const ids: string[] = yield* Effect.tryPromise({
      try: () => redis.smembers("entries:list"),
      catch: (error) => new Error(`Failed to get entry IDs: ${error}`),
    });

    if (!ids || ids.length === 0) {
      yield* Effect.log("📋 No entries found");
      return [];
    }

    // Fetch all entries in parallel
    const entryPromises = ids.map((id) =>
      Effect.tryPromise({
        try: () => redis.hgetall(`entry:${id}`),
        catch: (error) => new Error(`Failed to get entry ${id}: ${error}`),
      })
    );

    const entryDataArray = yield* Effect.all(entryPromises, {
      concurrency: "unbounded",
    });

    const entries: Entry[] = [];
    for (const data of entryDataArray) {
      if (data) {
        const entryData = data as {
          id: string;
          startedAt: string;
          endedAt: string;
          duration: string;
          projectId?: string;
        };
        entries.push({
          id: entryData.id,
          startedAt: entryData.startedAt,
          endedAt: entryData.endedAt,
          duration: Number.parseFloat(entryData.duration),
          ...(entryData.projectId ? { projectId: entryData.projectId } : {}),
        });
      }
    }

    // Sort by startedAt descending (newest first)
    const sorted = entries.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    yield* Effect.log(`📋 Loaded ${sorted.length} entries from Redis`);

    return sorted;
  });

// Update entry
export const updateEntry = (
  id: string,
  startedAt: string,
  endedAt: string,
  projectId?: string
): Effect.Effect<Entry, Error> =>
  Effect.gen(function* () {
    // Check if entry exists
    const exists: boolean = yield* Effect.tryPromise({
      try: () => redis.sismember("entries:list", id),
      catch: (error) => new Error(`Failed to check if entry exists: ${error}`),
    });

    if (!exists) {
      yield* Effect.fail(new Error(`Entry with id ${id} not found`));
    }

    // Validate date formats
    const startedAtDate = new Date(startedAt);
    const endedAtDate = new Date(endedAt);

    if (Number.isNaN(startedAtDate.getTime())) {
      yield* Effect.fail(
        new Error("Invalid startedAt format. Expected ISO string.")
      );
    }

    if (Number.isNaN(endedAtDate.getTime())) {
      yield* Effect.fail(
        new Error("Invalid endedAt format. Expected ISO string.")
      );
    }

    const startTime = startedAtDate.getTime();
    const endTime = endedAtDate.getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60);

    if (duration < 0) {
      yield* Effect.fail(new Error("End time must be after start time"));
    }

    const entry: Entry = {
      id,
      startedAt,
      endedAt,
      duration,
      ...(projectId ? { projectId } : {}),
    };

    const entryData: Record<string, string> = {
      id,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      duration: entry.duration.toString(),
      ...(entry.projectId ? { projectId: entry.projectId } : {}),
    };

    if (!entry.projectId) {
      // Remove projectId if it was set before but is now being removed
      yield* Effect.tryPromise({
        try: () => redis.hdel(`entry:${id}`, "projectId"),
        catch: (error) =>
          new Error(`Failed to remove projectId from entry: ${error}`),
      });
    }

    yield* Effect.tryPromise({
      try: () => redis.hset(`entry:${id}`, entryData),
      catch: (error) => new Error(`Failed to update entry: ${error}`),
    });

    yield* Effect.log(`✏️  Updated entry ${id}`);
    yield* Effect.log(`   Started: ${entry.startedAt}`);
    yield* Effect.log(`   Ended: ${entry.endedAt}`);
    yield* Effect.log(
      `   Duration: ${entry.duration.toFixed(4)} hours (${(entry.duration * 60).toFixed(2)} minutes)`
    );

    return entry;
  });

// Delete entry
export const deleteEntry = (id: string): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => redis.del(`entry:${id}`),
      catch: (error) => new Error(`Failed to delete entry hash: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.srem("entries:list", id),
      catch: (error) => new Error(`Failed to remove entry from list: ${error}`),
    });

    yield* Effect.log(`🗑️  Deleted entry ${id}`);
  });

// Create project
export const createProject = (name: string): Effect.Effect<Project, Error> =>
  Effect.gen(function* () {
    if (!name || name.trim().length === 0) {
      yield* Effect.fail(new Error("Project name cannot be empty"));
    }

    if (name.length > 50) {
      yield* Effect.fail(new Error("Project name cannot exceed 50 characters"));
    }

    const trimmedName = name.trim();

    // Check for duplicate names
    const projects = yield* getProjects();
    const duplicate = projects.find((p) => p.name === trimmedName);
    if (duplicate) {
      yield* Effect.fail(new Error("Project name must be unique"));
    }

    const id = crypto.randomUUID();
    const project: Project = { id, name: trimmedName };

    yield* Effect.tryPromise({
      try: () =>
        redis.hset(`project:${id}`, {
          id,
          name: trimmedName,
        }),
      catch: (error) => new Error(`Failed to create project: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.sadd("projects:list", id),
      catch: (error) => new Error(`Failed to add project to list: ${error}`),
    });

    yield* Effect.log(`✅ Created project: ${trimmedName} (${id})`);

    return project;
  });

// Get all projects
export const getProjects = (): Effect.Effect<Project[], Error> =>
  Effect.gen(function* () {
    const ids: string[] = yield* Effect.tryPromise({
      try: () => redis.smembers("projects:list"),
      catch: (error) => new Error(`Failed to get project IDs: ${error}`),
    });

    if (!ids || ids.length === 0) {
      yield* Effect.log("📁 No projects found");
      return [];
    }

    // Fetch all projects in parallel
    const projectPromises = ids.map((id) =>
      Effect.tryPromise({
        try: () => redis.hgetall(`project:${id}`),
        catch: (error) => new Error(`Failed to get project ${id}: ${error}`),
      })
    );

    const projectDataArray = yield* Effect.all(projectPromises, {
      concurrency: "unbounded",
    });

    const projects: Project[] = [];
    for (const data of projectDataArray) {
      if (data) {
        const projectData = data as {
          id: string;
          name: string;
        };
        projects.push({
          id: projectData.id,
          name: projectData.name,
        });
      }
    }

    // Sort by name
    const sorted = projects.sort((a, b) => a.name.localeCompare(b.name));

    yield* Effect.log(`📁 Loaded ${sorted.length} projects from Redis`);

    return sorted;
  });

// Get single project
export const getProject = (id: string): Effect.Effect<Project | null, Error> =>
  Effect.gen(function* () {
    const data = yield* Effect.tryPromise({
      try: () => redis.hgetall(`project:${id}`),
      catch: (error) => new Error(`Failed to get project ${id}: ${error}`),
    });

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    const projectData = data as {
      id: string;
      name: string;
    };

    return {
      id: projectData.id,
      name: projectData.name,
    };
  });

// Update project
export const updateProject = (
  id: string,
  name: string
): Effect.Effect<Project, Error> =>
  Effect.gen(function* () {
    if (!name || name.trim().length === 0) {
      yield* Effect.fail(new Error("Project name cannot be empty"));
    }

    if (name.length > 50) {
      yield* Effect.fail(new Error("Project name cannot exceed 50 characters"));
    }

    const trimmedName = name.trim();

    // Check if project exists
    const existing = yield* getProject(id);
    if (!existing) {
      yield* Effect.fail(new Error(`Project with id ${id} not found`));
    }

    // Check for duplicate names (excluding current project)
    const projects = yield* getProjects();
    const duplicate = projects.find(
      (p) => p.name === trimmedName && p.id !== id
    );
    if (duplicate) {
      yield* Effect.fail(new Error("Project name must be unique"));
    }

    const project: Project = { id, name: trimmedName };

    yield* Effect.tryPromise({
      try: () =>
        redis.hset(`project:${id}`, {
          id,
          name: trimmedName,
        }),
      catch: (error) => new Error(`Failed to update project: ${error}`),
    });

    yield* Effect.log(`✏️  Updated project: ${trimmedName} (${id})`);

    return project;
  });

// Delete project
export const deleteProject = (
  id: string,
  deleteEntries: boolean
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    // Check if project exists
    const existing = yield* getProject(id);
    if (!existing) {
      yield* Effect.fail(new Error(`Project with id ${id} not found`));
    }

    if (deleteEntries) {
      // Delete all entries with this projectId
      const entries = yield* getEntries();
      const projectEntries = entries.filter((e) => e.projectId === id);

      for (const entry of projectEntries) {
        yield* deleteEntry(entry.id);
      }

      yield* Effect.log(
        `🗑️  Deleted ${projectEntries.length} entries for project ${id}`
      );
    } else {
      // Remove projectId from all entries
      const entries = yield* getEntries();
      const projectEntries = entries.filter((e) => e.projectId === id);

      for (const entry of projectEntries) {
        yield* Effect.tryPromise({
          try: () => redis.hdel(`entry:${entry.id}`, "projectId"),
          catch: (error) =>
            new Error(`Failed to remove projectId from entry: ${error}`),
        });
      }

      yield* Effect.log(
        `✏️  Removed project from ${projectEntries.length} entries`
      );
    }

    // Delete project
    yield* Effect.tryPromise({
      try: () => redis.del(`project:${id}`),
      catch: (error) => new Error(`Failed to delete project hash: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.srem("projects:list", id),
      catch: (error) =>
        new Error(`Failed to remove project from list: ${error}`),
    });

    yield* Effect.log(`🗑️  Deleted project ${id}`);
  });
