import { Effect } from "effect";
import {
  createAuthErrorResponse,
  getVerifiedUserId,
  isAuthError,
} from "~/lib/auth/auth";
import { validateProjectName } from "~/lib/entry-validation";
import {
  createProject,
  deleteProject,
  getProjects,
  RedisLive,
  updateProject,
} from "~/lib/redis";
import type { WebSocketMessage } from "~/lib/types";

type Server = ReturnType<typeof Bun.serve>;

export const handleProjectsGet = (req: Request) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          const projects = yield* getProjects(userId);
          return Response.json(projects);
        })
      ),
      RedisLive
    )
  ).catch((error) => {
    if (isAuthError(error)) {
      return createAuthErrorResponse();
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
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          const body: { name: string } = yield* Effect.tryPromise({
            try: () => req.json() as Promise<{ name: string }>,
            catch: (error) =>
              new Error(`Failed to parse request body: ${error}`),
          });

          if (!body.name || typeof body.name !== "string") {
            return Response.json(
              { error: "name is required and must be a string" },
              { status: 400 }
            );
          }

          yield* validateProjectName(body.name);

          const project = yield* createProject(userId, body.name);

          const message: WebSocketMessage = {
            type: "project:created",
            data: { project },
          };
          server.publish(
            `user:${userId}:timer:updates`,
            JSON.stringify(message)
          );

          return Response.json(project);
        })
      ),
      RedisLive
    )
  ).catch((error) => {
    if (isAuthError(error)) {
      return createAuthErrorResponse();
    }
    // Validation errors should return 400
    if (
      error instanceof Error &&
      (error.message.includes("Project name") ||
        error.message.includes("invalid characters") ||
        error.message.includes("cannot be empty") ||
        error.message.includes("is required"))
    ) {
      return Response.json({ error: error.message }, { status: 400 });
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
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          const body: { name: string } = yield* Effect.tryPromise({
            try: () => req.json() as Promise<{ name: string }>,
            catch: (error) =>
              new Error(`Failed to parse request body: ${error}`),
          });

          if (!body.name || typeof body.name !== "string") {
            return Response.json(
              { error: "name is required and must be a string" },
              { status: 400 }
            );
          }

          yield* validateProjectName(body.name);

          const project = yield* updateProject(userId, id, body.name);

          const message: WebSocketMessage = {
            type: "project:updated",
            data: { project },
          };
          server.publish(
            `user:${userId}:timer:updates`,
            JSON.stringify(message)
          );

          return Response.json(project);
        })
      ),
      RedisLive
    )
  ).catch((error) => {
    if (isAuthError(error)) {
      return createAuthErrorResponse();
    }
    // Validation errors should return 400
    if (
      error instanceof Error &&
      (error.message.includes("Project name") ||
        error.message.includes("invalid characters") ||
        error.message.includes("cannot be empty") ||
        error.message.includes("is required"))
    ) {
      return Response.json({ error: error.message }, { status: 400 });
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
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          yield* deleteProject(userId, id, deleteEntries);

          const message: WebSocketMessage = {
            type: "project:deleted",
            data: { id },
          };
          server.publish(
            `user:${userId}:timer:updates`,
            JSON.stringify(message)
          );

          return Response.json({ success: true });
        })
      ),
      RedisLive
    )
  ).catch((error) => {
    if (isAuthError(error)) {
      return createAuthErrorResponse();
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete project",
      },
      { status: 500 }
    );
  });
