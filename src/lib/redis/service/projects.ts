import { Effect } from "effect";
import type { Project } from "~/lib/types.ts";
import { Redis } from "../client.ts";
import { deleteEntry, getEntries } from "./entries.ts";

const userKey = (userId: string, key: string): string =>
  `user:${userId}:${key}`;

/**
 * Create project
 */
export const createProject = (
  userId: string,
  name: string
): Effect.Effect<Project, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;

    if (!name || name.trim().length === 0) {
      yield* Effect.fail(new Error("Project name cannot be empty"));
    }

    if (name.length > 100) {
      yield* Effect.fail(new Error("Project name cannot exceed 100 characters"));
    }

    const trimmedName = name.trim();

    const projects = yield* getProjects(userId);
    const duplicate = projects.find((p) => p.name === trimmedName);
    if (duplicate) {
      yield* Effect.fail(new Error("Project name must be unique"));
    }

    const id = crypto.randomUUID();
    const project: Project = { id, name: trimmedName };

    yield* redis.hset(userKey(userId, `project:${id}`), {
      id,
      name: trimmedName,
    });

    yield* redis.sadd(userKey(userId, "projects:list"), id);

    yield* Effect.log(`✅ Created project: ${trimmedName} (${id})`);

    return project;
  });

/**
 * Get all projects
 */
export const getProjects = (
  userId: string
): Effect.Effect<Project[], Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;

    const ids: string[] = yield* redis.smembers(
      userKey(userId, "projects:list")
    );

    if (!ids || ids.length === 0) {
      yield* Effect.log("📁 No projects found");
      return [];
    }

    const projectPromises = ids.map((id) =>
      redis.hgetall(userKey(userId, `project:${id}`))
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

/**
 * Get single project
 */
export const getProject = (
  userId: string,
  id: string
): Effect.Effect<Project | null, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;

    const data = yield* redis.hgetall(userKey(userId, `project:${id}`));

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

/**
 * Update project
 */
export const updateProject = (
  userId: string,
  id: string,
  name: string
): Effect.Effect<Project, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;

    if (!name || name.trim().length === 0) {
      yield* Effect.fail(new Error("Project name cannot be empty"));
    }

    if (name.length > 100) {
      yield* Effect.fail(new Error("Project name cannot exceed 100 characters"));
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

    yield* redis.hset(userKey(userId, `project:${id}`), {
      id,
      name: trimmedName,
    });

    yield* Effect.log(`✏️  Updated project: ${trimmedName} (${id})`);

    return project;
  });

/**
 * Delete project
 */
export const deleteProject = (
  userId: string,
  id: string,
  deleteEntries: boolean
): Effect.Effect<void, Error, Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;

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
        yield* redis.hdel(userKey(userId, `entry:${entry.id}`), "projectId");
      }

      yield* Effect.log(
        `✏️  Removed project from ${projectEntries.length} entries`
      );
    }

    yield* redis.del(userKey(userId, `project:${id}`));
    yield* redis.srem(userKey(userId, "projects:list"), id);

    yield* Effect.log(`🗑️  Deleted project ${id}`);
  });
