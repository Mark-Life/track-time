import { redis } from "bun";
import { Effect } from "effect";
import type { Entry, Project, Timer } from "./types.ts";

const userKey = (userId: string, key: string): string => `user:${userId}:${key}`;

export const getActiveTimer = (
  userId: string
): Effect.Effect<Timer | null, Error> =>
  Effect.gen(function* () {
    const startedAt: string | null = yield* Effect.tryPromise({
      try: () => redis.hget(userKey(userId, "active:timer"), "startedAt"),
      catch: (error) => new Error(`Failed to get active timer: ${error}`),
    });

    if (!startedAt) {
      return null;
    }

    const projectId: string | null = yield* Effect.tryPromise({
      try: () => redis.hget(userKey(userId, "active:timer"), "projectId"),
      catch: (error) => new Error(`Failed to get timer projectId: ${error}`),
    });

    return {
      startedAt: startedAt as string,
      ...(projectId ? { projectId } : {}),
    };
  });

export const startTimer = (
  userId: string,
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
      try: () => redis.hset(userKey(userId, "active:timer"), timerData),
      catch: (error) => new Error(`Failed to start timer: ${error}`),
    });

    yield* Effect.log(`⏱️  Timer started at ${timerStartedAt}`);

    return {
      startedAt: timerStartedAt,
      ...(projectId ? { projectId } : {}),
    };
  });

export const stopTimer = (userId: string): Effect.Effect<Entry | null, Error> =>
  Effect.gen(function* () {
    const timer: Timer | null = yield* getActiveTimer(userId);
    if (!timer) {
      return null;
    }

    const endedAt = new Date().toISOString();
    const startTime = new Date(timer.startedAt).getTime();
    const endTime = new Date(endedAt).getTime();
    const duration = (endTime - startTime) / (1000 * 60 * 60);

    const id = crypto.randomUUID();
    const entry: Entry = {
      id,
      startedAt: timer.startedAt,
      endedAt,
      duration,
      ...(timer.projectId ? { projectId: timer.projectId } : {}),
    };

    const entryData: Record<string, string> = {
      id,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      duration: entry.duration.toString(),
      ...(entry.projectId ? { projectId: entry.projectId } : {}),
    };

    yield* Effect.tryPromise({
      try: () => redis.hset(userKey(userId, `entry:${id}`), entryData),
      catch: (error) => new Error(`Failed to save entry: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.sadd(userKey(userId, "entries:list"), id),
      catch: (error) => new Error(`Failed to add entry to list: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.del(userKey(userId, "active:timer")),
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

export const getEntries = (userId: string): Effect.Effect<Entry[], Error> =>
  Effect.gen(function* () {
    const ids: string[] = yield* Effect.tryPromise({
      try: () => redis.smembers(userKey(userId, "entries:list")),
      catch: (error) => new Error(`Failed to get entry IDs: ${error}`),
    });

    if (!ids || ids.length === 0) {
      yield* Effect.log("📋 No entries found");
      return [];
    }

    const entryPromises = ids.map((id) =>
      Effect.tryPromise({
        try: () => redis.hgetall(userKey(userId, `entry:${id}`)),
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

    const sorted = entries.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    yield* Effect.log(`📋 Loaded ${sorted.length} entries from Redis`);

    return sorted;
  });

export const updateEntry = (
  userId: string,
  id: string,
  startedAt: string,
  endedAt: string,
  projectId?: string
): Effect.Effect<Entry, Error> =>
  Effect.gen(function* () {
    const exists: boolean = yield* Effect.tryPromise({
      try: () => redis.sismember(userKey(userId, "entries:list"), id),
      catch: (error) => new Error(`Failed to check if entry exists: ${error}`),
    });

    if (!exists) {
      yield* Effect.fail(new Error(`Entry with id ${id} not found`));
    }

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
      yield* Effect.tryPromise({
        try: () => redis.hdel(userKey(userId, `entry:${id}`), "projectId"),
        catch: (error) =>
          new Error(`Failed to remove projectId from entry: ${error}`),
      });
    }

    yield* Effect.tryPromise({
      try: () => redis.hset(userKey(userId, `entry:${id}`), entryData),
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

export const deleteEntry = (
  userId: string,
  id: string
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => redis.del(userKey(userId, `entry:${id}`)),
      catch: (error) => new Error(`Failed to delete entry hash: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.srem(userKey(userId, "entries:list"), id),
      catch: (error) => new Error(`Failed to remove entry from list: ${error}`),
    });

    yield* Effect.log(`🗑️  Deleted entry ${id}`);
  });

export const createProject = (
  userId: string,
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

    const projects = yield* getProjects(userId);
    const duplicate = projects.find((p) => p.name === trimmedName);
    if (duplicate) {
      yield* Effect.fail(new Error("Project name must be unique"));
    }

    const id = crypto.randomUUID();
    const project: Project = { id, name: trimmedName };

    yield* Effect.tryPromise({
      try: () =>
        redis.hset(userKey(userId, `project:${id}`), {
          id,
          name: trimmedName,
        }),
      catch: (error) => new Error(`Failed to create project: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.sadd(userKey(userId, "projects:list"), id),
      catch: (error) => new Error(`Failed to add project to list: ${error}`),
    });

    yield* Effect.log(`✅ Created project: ${trimmedName} (${id})`);

    return project;
  });

export const getProjects = (userId: string): Effect.Effect<Project[], Error> =>
  Effect.gen(function* () {
    const ids: string[] = yield* Effect.tryPromise({
      try: () => redis.smembers(userKey(userId, "projects:list")),
      catch: (error) => new Error(`Failed to get project IDs: ${error}`),
    });

    if (!ids || ids.length === 0) {
      yield* Effect.log("📁 No projects found");
      return [];
    }

    const projectPromises = ids.map((id) =>
      Effect.tryPromise({
        try: () => redis.hgetall(userKey(userId, `project:${id}`)),
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

    const sorted = projects.sort((a, b) => a.name.localeCompare(b.name));

    yield* Effect.log(`📁 Loaded ${sorted.length} projects from Redis`);

    return sorted;
  });

export const getProject = (
  userId: string,
  id: string
): Effect.Effect<Project | null, Error> =>
  Effect.gen(function* () {
    const data = yield* Effect.tryPromise({
      try: () => redis.hgetall(userKey(userId, `project:${id}`)),
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

export const updateProject = (
  userId: string,
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

    const existing = yield* getProject(userId, id);
    if (!existing) {
      yield* Effect.fail(new Error(`Project with id ${id} not found`));
    }

    const projects = yield* getProjects(userId);
    const duplicate = projects.find(
      (p) => p.name === trimmedName && p.id !== id
    );
    if (duplicate) {
      yield* Effect.fail(new Error("Project name must be unique"));
    }

    const project: Project = { id, name: trimmedName };

    yield* Effect.tryPromise({
      try: () =>
        redis.hset(userKey(userId, `project:${id}`), {
          id,
          name: trimmedName,
        }),
      catch: (error) => new Error(`Failed to update project: ${error}`),
    });

    yield* Effect.log(`✏️  Updated project: ${trimmedName} (${id})`);

    return project;
  });

export const deleteProject = (
  userId: string,
  id: string,
  deleteEntries: boolean
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const existing = yield* getProject(userId, id);
    if (!existing) {
      yield* Effect.fail(new Error(`Project with id ${id} not found`));
    }

    if (deleteEntries) {
      const entries = yield* getEntries(userId);
      const projectEntries = entries.filter((e) => e.projectId === id);

      for (const entry of projectEntries) {
        yield* deleteEntry(userId, entry.id);
      }

      yield* Effect.log(
        `🗑️  Deleted ${projectEntries.length} entries for project ${id}`
      );
    } else {
      const entries = yield* getEntries(userId);
      const projectEntries = entries.filter((e) => e.projectId === id);

      for (const entry of projectEntries) {
        yield* Effect.tryPromise({
          try: () => redis.hdel(userKey(userId, `entry:${entry.id}`), "projectId"),
          catch: (error) =>
            new Error(`Failed to remove projectId from entry: ${error}`),
        });
      }

      yield* Effect.log(
        `✏️  Removed project from ${projectEntries.length} entries`
      );
    }

    yield* Effect.tryPromise({
      try: () => redis.del(userKey(userId, `project:${id}`)),
      catch: (error) => new Error(`Failed to delete project hash: ${error}`),
    });

    yield* Effect.tryPromise({
      try: () => redis.srem(userKey(userId, "projects:list"), id),
      catch: (error) =>
        new Error(`Failed to remove project from list: ${error}`),
    });

    yield* Effect.log(`🗑️  Deleted project ${id}`);
  });

