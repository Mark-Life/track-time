import { redis } from "bun";
import { Effect } from "effect";
import type { Project } from "~/lib/types.ts";
import { deleteEntry, getEntries } from "./entries.ts";

/**
 * Create project
 */
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

/**
 * Get all projects
 */
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

/**
 * Get single project
 */
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

/**
 * Update project
 */
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

/**
 * Delete project
 */
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
