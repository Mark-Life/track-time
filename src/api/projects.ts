import { Effect } from "effect";
import { getUserId, isAuthError } from "~/lib/auth/auth";
import {
  createProject,
  deleteProject,
  getProjects,
  updateProject,
} from "~/lib/redis-scoped.ts";
import type { WebSocketMessage } from "~/lib/types.ts";

type Server = ReturnType<typeof Bun.serve>;

export const handleProjectsGet = (req: Request) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const userId = yield* getUserId(req);
      const projects = yield* getProjects(userId);
      return Response.json(projects);
    })
  ).catch((error) => {
    if (isAuthError(error)) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get projects",
      },
      { status: 500 }
    );
  });

export const handleProjectCreate = (req: Request, server: Server) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const userId = yield* getUserId(req);
      const body: { name: string } = yield* Effect.tryPromise({
        try: () => req.json() as Promise<{ name: string }>,
        catch: (error) => new Error(`Failed to parse request body: ${error}`),
      });

      if (!body.name || typeof body.name !== "string") {
        return Response.json(
          { error: "name is required and must be a string" },
          { status: 400 }
        );
      }

      const project = yield* createProject(userId, body.name);

      const message: WebSocketMessage = {
        type: "project:created",
        data: { project },
      };
      server.publish(`user:${userId}:timer:updates`, JSON.stringify(message));

      return Response.json(project);
    })
  ).catch((error) => {
    if (isAuthError(error)) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create project",
      },
      { status: 500 }
    );
  });

export const handleProjectUpdate = (req: Request, id: string, server: Server) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const userId = yield* getUserId(req);
      const body: { name: string } = yield* Effect.tryPromise({
        try: () => req.json() as Promise<{ name: string }>,
        catch: (error) => new Error(`Failed to parse request body: ${error}`),
      });

      if (!body.name || typeof body.name !== "string") {
        return Response.json(
          { error: "name is required and must be a string" },
          { status: 400 }
        );
      }

      const project = yield* updateProject(userId, id, body.name);

      const message: WebSocketMessage = {
        type: "project:updated",
        data: { project },
      };
      server.publish(`user:${userId}:timer:updates`, JSON.stringify(message));

      return Response.json(project);
    })
  ).catch((error) => {
    if (isAuthError(error)) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update project",
      },
      { status: 500 }
    );
  });

export const handleProjectDelete = (
  req: Request,
  id: string,
  deleteEntries: boolean,
  server: Server
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const userId = yield* getUserId(req);
      yield* deleteProject(userId, id, deleteEntries);

      const message: WebSocketMessage = {
        type: "project:deleted",
        data: { id },
      };
      server.publish(`user:${userId}:timer:updates`, JSON.stringify(message));

      return Response.json({ success: true });
    })
  ).catch((error) => {
    if (isAuthError(error)) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete project",
      },
      { status: 500 }
    );
  });
