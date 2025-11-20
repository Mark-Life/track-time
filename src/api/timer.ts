import { Effect } from "effect";
import { getVerifiedUserId, isAuthError } from "~/lib/auth/auth";
import { getActiveTimer, RedisLive, startTimer, stopTimer } from "~/lib/redis";
import type { WebSocketMessage } from "~/lib/types.ts";

type Server = ReturnType<typeof Bun.serve>;

const parseTimerStartBody = (
  req: Request
): Effect.Effect<
  { startedAt?: string; projectId?: string } | undefined,
  Error
> =>
  Effect.tryPromise({
    try: () =>
      req.json() as Promise<{
        startedAt?: string;
        projectId?: string;
      }>,
    catch: () => new Error("Failed to parse body"),
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

const validateStartedAt = (startedAt: string): Response | null => {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) {
    return Response.json(
      { error: "Invalid startedAt format. Expected ISO string." },
      { status: 400 }
    );
  }
  return null;
};

const createTimerStartedMessage = (timer: {
  startedAt: string;
  projectId?: string;
}): WebSocketMessage => ({
  type: "timer:started",
  data: {
    startedAt: timer.startedAt,
    ...(timer.projectId ? { projectId: timer.projectId } : {}),
  },
});

export const handleTimerGet = (req: Request) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          const timer = yield* getActiveTimer(userId);
          return Response.json(timer);
        })
      ),
      RedisLive
    )
  ).catch((error) => {
    if (isAuthError(error)) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to get timer",
      },
      { status: 500 }
    );
  });

export const handleTimerStart = (req: Request, server: Server) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          const body = yield* parseTimerStartBody(req);

          if (body?.startedAt) {
            const validationError = validateStartedAt(body.startedAt);
            if (validationError) {
              return validationError;
            }
          }

          const timer = yield* startTimer(
            userId,
            body?.startedAt,
            body?.projectId
          );

          const message = createTimerStartedMessage(timer);
          server.publish(
            `user:${userId}:timer:updates`,
            JSON.stringify(message)
          );

          return Response.json(timer);
        })
      ),
      RedisLive
    )
  ).catch((error) => {
    if (isAuthError(error)) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to start timer",
      },
      { status: 500 }
    );
  });

export const handleTimerStop = (req: Request, server: Server) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const userId = yield* getVerifiedUserId(req);
          const entry = yield* stopTimer(userId);

          if (!entry) {
            return Response.json({ error: "No active timer" }, { status: 400 });
          }

          const message: WebSocketMessage = {
            type: "timer:stopped",
            data: { entry },
          };
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
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to stop timer",
      },
      { status: 500 }
    );
  });
