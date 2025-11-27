import { Effect } from "effect";
import {
  CacheKeys,
  getCachedWithRevalidate,
  invalidateCache,
} from "~/lib/cache";
import type { Project } from "~/lib/types";

import {
  getCsrfTokenFromCookie,
  handleAuthError,
  handleCsrfError,
} from "./auth";

export const getProjects = Effect.gen(function* () {
  if (!navigator.onLine) {
    // Return empty array if offline - projects are server-only for now
    return [];
  }

  // Use stale-while-revalidate: return cached immediately, fetch fresh in background
  return yield* getCachedWithRevalidate(CacheKeys.projects, () =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch("/api/projects", { credentials: "include" }),
        catch: (error) => new Error(`Failed to fetch projects: ${error}`),
      });

      if (!response.ok) {
        handleAuthError(response);
        return [];
      }

      const projects = yield* Effect.tryPromise({
        try: () => response.json() as Promise<Project[]>,
        catch: (error) => new Error(`Failed to parse projects JSON: ${error}`),
      });

      return projects;
    })
  );
});

export const createProject = (name: string) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      return yield* Effect.fail(
        new Error("Cannot create project while offline")
      );
    }

    const makeCreateProjectRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch("/api/projects", {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({ name }),
          });
        },
        catch: (error) => new Error(`Failed to create project: ${error}`),
      });

    const csrfToken = getCsrfTokenFromCookie();
    let createResponse: Response = yield* makeCreateProjectRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (createResponse.status === 403) {
      createResponse = yield* handleCsrfError(createResponse, (newCsrfToken) =>
        makeCreateProjectRequest(newCsrfToken)
      );
    }

    if (!createResponse.ok) {
      handleAuthError(createResponse);
      const errorData: { error: string } = yield* Effect.tryPromise({
        try: () => createResponse.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Failed to create project" }),
      });
      return yield* Effect.fail(new Error(errorData.error));
    }

    const project: Project = yield* Effect.tryPromise({
      try: () => createResponse.json() as Promise<Project>,
      catch: (error) => new Error(`Failed to parse project JSON: ${error}`),
    });

    // Invalidate projects cache
    yield* invalidateCache(CacheKeys.projects);

    return project;
  });

export const updateProject = (id: string, name: string) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      return yield* Effect.fail(
        new Error("Cannot update project while offline")
      );
    }

    const makeUpdateProjectRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch(`/api/projects/${id}`, {
            method: "PUT",
            headers,
            credentials: "include",
            body: JSON.stringify({ name }),
          });
        },
        catch: (error) => new Error(`Failed to update project: ${error}`),
      });

    const csrfToken = getCsrfTokenFromCookie();
    let updateResponse: Response = yield* makeUpdateProjectRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (updateResponse.status === 403) {
      updateResponse = yield* handleCsrfError(updateResponse, (newCsrfToken) =>
        makeUpdateProjectRequest(newCsrfToken)
      );
    }

    if (!updateResponse.ok) {
      handleAuthError(updateResponse);
      const errorData: { error: string } = yield* Effect.tryPromise({
        try: () => updateResponse.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Failed to update project" }),
      });
      return yield* Effect.fail(new Error(errorData.error));
    }

    const project: Project = yield* Effect.tryPromise({
      try: () => updateResponse.json() as Promise<Project>,
      catch: (error) => new Error(`Failed to parse project JSON: ${error}`),
    });

    // Invalidate projects cache
    yield* invalidateCache(CacheKeys.projects);

    return project;
  });

export const deleteProject = (id: string, deleteEntries: boolean) =>
  Effect.gen(function* () {
    if (!navigator.onLine) {
      return yield* Effect.fail(
        new Error("Cannot delete project while offline")
      );
    }

    const makeDeleteProjectRequest = (token: string | null) =>
      Effect.tryPromise({
        try: () => {
          const headers: Record<string, string> = {};
          if (token) {
            headers["X-CSRF-Token"] = token;
          }
          return fetch(`/api/projects/${id}?deleteEntries=${deleteEntries}`, {
            method: "DELETE",
            headers,
            credentials: "include",
          });
        },
        catch: (error) => new Error(`Failed to delete project: ${error}`),
      });

    const csrfToken = getCsrfTokenFromCookie();
    let deleteResponse: Response = yield* makeDeleteProjectRequest(csrfToken);

    // Handle CSRF error (403) by refreshing token and retrying
    if (deleteResponse.status === 403) {
      deleteResponse = yield* handleCsrfError(deleteResponse, (newCsrfToken) =>
        makeDeleteProjectRequest(newCsrfToken)
      );
    }

    if (!deleteResponse.ok) {
      handleAuthError(deleteResponse);
      const errorData: { error: string } = yield* Effect.tryPromise({
        try: () => deleteResponse.json() as Promise<{ error: string }>,
        catch: () => ({ error: "Failed to delete project" }),
      });
      return yield* Effect.fail(new Error(errorData.error));
    }

    // Invalidate projects cache and entries cache (if entries were deleted)
    yield* invalidateCache([CacheKeys.projects, CacheKeys.entries]);
  });
