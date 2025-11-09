// Shared types for timer tracking app

export type Timer = {
  startedAt: string; // ISO timestamp
};

export type Entry = {
  id: string;
  startedAt: string; // ISO timestamp
  endedAt: string; // ISO timestamp
  duration: number; // decimal hours
};

export type WebSocketMessage =
  | { type: "timer:started"; data: { startedAt: string } }
  | { type: "timer:stopped"; data: { entry: Entry } }
  | { type: "entry:deleted"; data: { id: string } };
