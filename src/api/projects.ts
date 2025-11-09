import { Effect } from "effect";
import {
  createProject,
  deleteProject,
  getProjects,
  updateProject,
} from "~/lib/redis.ts";
import type { WebSocketMessage } from "~/lib/types.ts";

type Server = ReturnType<typeof Bun.serve>;

export const handleProjectsGet = async () => {
  const projects = await Effect.runPromise(getProjects());
  return Response.json(projects);
};

export const handleProjectCreate = (req: Request, server: Server) =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const project = yield* createProject(body.name);

      const message: WebSocketMessage = {
        type: "project:created",
        data: { project },
      };
      server.publish("timer:updates", JSON.stringify(message));

      return Response.json(project);
    })
  ).catch((error) =>
    Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create project",
      },
      { status: 500 }
    )
  );

export const handleProjectUpdate = (req: Request, id: string, server: Server) =>
  Effect.runPromise(
    Effect.gen(function* () {
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

      const project = yield* updateProject(id, body.name);

      const message: WebSocketMessage = {
        type: "project:updated",
        data: { project },
      };
      server.publish("timer:updates", JSON.stringify(message));

      return Response.json(project);
    })
  ).catch((error) =>
    Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update project",
      },
      { status: 500 }
    )
  );

export const handleProjectDelete = (
  id: string,
  deleteEntries: boolean,
  server: Server
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* deleteProject(id, deleteEntries);

      const message: WebSocketMessage = {
        type: "project:deleted",
        data: { id },
      };
      server.publish("timer:updates", JSON.stringify(message));

      return Response.json({ success: true });
    })
  ).catch((error) =>
    Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete project",
      },
      { status: 500 }
    )
  );
