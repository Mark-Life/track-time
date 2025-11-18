import type { ServerWebSocket } from "bun";

export type Server = ReturnType<typeof Bun.serve>;
export type WebSocketData = { userId: string };
export type ServerWebSocketType = ServerWebSocket<WebSocketData>;
