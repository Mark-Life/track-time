import type { ServerWebSocket } from "bun";

export type Server = ReturnType<typeof Bun.serve>;
export type WebSocketData = {
  userId: string;
  tokenExp?: number; // Token expiration timestamp (Unix seconds)
};
export type ServerWebSocketType = ServerWebSocket<WebSocketData>;
