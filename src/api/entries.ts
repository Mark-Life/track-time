import { Effect } from "effect";
import { deleteEntry, getEntries, updateEntry } from "~/lib/redis.ts";
import type { Entry, WebSocketMessage } from "~/lib/types.ts";

type Server = ReturnType<typeof Bun.serve>;

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

  const startedAtDate = new Date(startedAt);
  const endedAtDate = new Date(endedAt);

  if (Number.isNaN(startedAtDate.getTime())) {
    return Response.json(
      { error: "Invalid startedAt format. Expected ISO string." },
      { status: 400 }
    );
  }

  if (Number.isNaN(endedAtDate.getTime())) {
    return Response.json(
      { error: "Invalid endedAt format. Expected ISO string." },
      { status: 400 }
    );
  }

  if (endedAtDate.getTime() <= startedAtDate.getTime()) {
    return Response.json(
      { error: "End time must be after start time" },
      { status: 400 }
    );
  }

  return null;
};

const createEntryUpdatedMessage = (entry: Entry): WebSocketMessage => ({
  type: "entry:updated",
  data: { entry },
});

export const handleEntriesGet = async () =>
  Response.json(await Effect.runPromise(getEntries()));

export const handleEntryUpdate = (req: Request, id: string, server: Server) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const body = yield* parseEntryUpdateBody(req);

      const validationError = validateEntryDates(body.startedAt, body.endedAt);
      if (validationError) {
        return validationError;
      }

      const entry = yield* updateEntry(
        id,
        body.startedAt,
        body.endedAt,
        body.projectId
      );

      const message = createEntryUpdatedMessage(entry);
      server.publish("timer:updates", JSON.stringify(message));

      return Response.json(entry);
    })
  ).catch((error) =>
    Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update entry",
      },
      { status: 500 }
    )
  );

export const handleEntryDelete = (id: string, server: Server) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* deleteEntry(id);

      const message: WebSocketMessage = {
        type: "entry:deleted",
        data: { id },
      };
      server.publish("timer:updates", JSON.stringify(message));

      return Response.json({ success: true });
    })
  ).catch((error) =>
    Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete entry",
      },
      { status: 500 }
    )
  );
