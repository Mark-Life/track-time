// Shared types for timer tracking app

export type Project = {
  id: string;
  name: string;
};

export type Timer = {
  startedAt: string; // ISO timestamp
  projectId?: string;
};

export type Entry = {
  id: string;
  startedAt: string; // ISO timestamp
  endedAt: string; // ISO timestamp
  duration: number; // decimal hours
  projectId?: string;
};

export type WebSocketMessage =
  | { type: "timer:started"; data: { startedAt: string; projectId?: string } }
  | { type: "timer:stopped"; data: { entry: Entry } }
  | { type: "entry:deleted"; data: { id: string } }
  | { type: "entry:updated"; data: { entry: Entry } }
  | { type: "project:created"; data: { project: Project } }
  | { type: "project:updated"; data: { project: Project } }
  | { type: "project:deleted"; data: { id: string } };
