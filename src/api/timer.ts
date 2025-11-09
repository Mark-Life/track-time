import { Effect } from "effect";
import { getActiveTimer, startTimer, stopTimer } from "~/lib/redis.ts";
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

export const handleTimerGet = async () =>
  Response.json(await Effect.runPromise(getActiveTimer()));

export const handleTimerStart = (req: Request, server: Server) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const body = yield* parseTimerStartBody(req);

      if (body?.startedAt) {
        const validationError = validateStartedAt(body.startedAt);
        if (validationError) {
          return validationError;
        }
      }

      const timer = yield* startTimer(body?.startedAt, body?.projectId);

      const message = createTimerStartedMessage(timer);
      server.publish("timer:updates", JSON.stringify(message));

      return Response.json(timer);
    })
  ).catch((error) =>
    Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to start timer",
      },
      { status: 500 }
    )
  );

export const handleTimerStop = async (server: Server) => {
  const entry = await Effect.runPromise(stopTimer());
  if (!entry) {
    return Response.json({ error: "No active timer" }, { status: 400 });
  }

  const message: WebSocketMessage = {
    type: "timer:stopped",
    data: { entry },
  };
  server.publish("timer:updates", JSON.stringify(message));

  return Response.json(entry);
};
