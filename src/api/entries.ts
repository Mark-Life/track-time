import { Effect } from "effect";
import {
  createAuthErrorResponse,
  getVerifiedUserId,
  isAuthError,
} from "~/lib/auth/auth";
import { validateEntryDuration } from "~/lib/entry-validation.ts";
import {
  createEntry,
  deleteEntry,
  getEntries,
  RedisLive,
  updateEntry,
} from "~/lib/redis";
import type { Entry, WebSocketMessage } from "~/lib/types.ts";

type Server = ReturnType<typeof Bun.serve>;

const parseEntryCreateBody = (
  req: Request
): Effect.Effect<
  { startedAt: string; endedAt: string; projectId?: string; id?: string },
  Error
> =>
  Effect.tryPromise({
    try: () =>
      req.json() as Promise<{
        startedAt: string;
        endedAt: string;
        projectId?: string;
        id?: string;
      }>,
    catch: (error) => new Error(`Failed to parse request body: ${error}`),
  });

const parseEntryUpdateBody = (
  req: Request
): Effect.Effect<
  { startedAt: string; endedAt: string; projectId?: string },
  Error
> =>
  Effect.tryPromise({
    try: () =>
      req.json() as Promise<{
        startedAt: string;
        endedAt: string;
        projectId?: string;
      }>,
    catch: (error) => new Error(`Failed to parse request body: ${error}`),
  });

const validateEntryDates = (
  startedAt: string,
  endedAt: string
): Response | null => {
  if (!(startedAt && endedAt)) {
    return Response.json(
      { error: "startedAt and endedAt are required" },
      { status: 400 }
    );
  }

  const validationResult = Effect.runSync(
    Effect.either(validateEntryDuration(startedAt, endedAt))
  );

  if (validationResult._tag === "Left") {
    return Response.json(
      { error: validationResult.left.message },
      { status: 400 }
    );
  }

  return null;
};

const createEntryUpdatedMessage = (entry: Entry): WebSocketMessage => ({
  type: "entry:updated",
  data: { entry },
});

const createEntryCreatedMessage = (entry: Entry): WebSocketMessage => ({
  type: "entry:updated", // Use updated type since created doesn't exist in WebSocketMessage
  data: { entry },
});

export const handleEntriesGet = (req: Request) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          const entries = yield* getEntries(userId);
          return Response.json(entries);
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
        error: error instanceof Error ? error.message : "Failed to get entries",
      },
      { status: 500 }
    );
  });

export const handleEntryCreate = (req: Request, server: Server) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          const body = yield* parseEntryCreateBody(req);

          const validationError = validateEntryDates(
            body.startedAt,
            body.endedAt
          );
          if (validationError) {
            return validationError;
          }

          const entry = yield* createEntry({
            userId,
            startedAt: body.startedAt,
            endedAt: body.endedAt,
            projectId: body.projectId,
            id: body.id,
          });

          const message = createEntryCreatedMessage(entry);
          server.publish(
            `user:${userId}:timer:updates`,
            JSON.stringify(message)
          );

          return Response.json(entry);
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
          error instanceof Error ? error.message : "Failed to create entry",
      },
      { status: 500 }
    );
  });

export const handleEntryUpdate = (req: Request, id: string, server: Server) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          const body = yield* parseEntryUpdateBody(req);

          const validationError = validateEntryDates(
            body.startedAt,
            body.endedAt
          );
          if (validationError) {
            return validationError;
          }

          const entry = yield* updateEntry({
            userId,
            id,
            startedAt: body.startedAt,
            endedAt: body.endedAt,
            projectId: body.projectId,
          });

          const message = createEntryUpdatedMessage(entry);
          server.publish(
            `user:${userId}:timer:updates`,
            JSON.stringify(message)
          );

          return Response.json(entry);
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
          error instanceof Error ? error.message : "Failed to update entry",
      },
      { status: 500 }
    );
  });

export const handleEntryDelete = (req: Request, id: string, server: Server) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          yield* deleteEntry(userId, id);

          const message: WebSocketMessage = {
            type: "entry:deleted",
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
          error instanceof Error ? error.message : "Failed to delete entry",
      },
      { status: 500 }
    );
  });
