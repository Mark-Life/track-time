import { isAuthError } from "~/lib/auth/auth.ts";
import {
  handleCsrfToken,
  handleLogin,
  handleLogout,
  handleMe,
  handleRefreshToken,
  handleRegister,
} from "./auth.ts";
import {
  handleEntriesGet,
  handleEntryDelete,
  handleEntryUpdate,
} from "./entries.ts";
import {
  handleProjectCreate,
  handleProjectDelete,
  handleProjectsGet,
  handleProjectUpdate,
} from "./projects.ts";
import { handleTimerGet, handleTimerStart, handleTimerStop } from "./timer.ts";

type Server = ReturnType<typeof Bun.serve>;

const ENTRIES_ID_REGEX = /^\/api\/entries\/(.+)$/;
const PROJECTS_ID_REGEX = /^\/api\/projects\/(.+)$/;

const handleTimerRoutes = (
  url: URL,
  req: Request,
  server: Server
): Promise<Response> | null => {
  if (url.pathname === "/api/timer" && req.method === "GET") {
    return handleTimerGet(req);
  }

  if (url.pathname === "/api/timer/start" && req.method === "POST") {
    return handleTimerStart(req, server);
  }

  if (url.pathname === "/api/timer/stop" && req.method === "POST") {
    return handleTimerStop(req, server);
  }

  return null;
};

const handleEntriesRoutes = (
  url: URL,
  req: Request,
  server: Server
): Promise<Response> | null => {
  if (url.pathname === "/api/entries" && req.method === "GET") {
    return handleEntriesGet(req);
  }

  const entriesMatch = url.pathname.match(ENTRIES_ID_REGEX);
  if (entriesMatch) {
    const id = entriesMatch[1];
    if (!id) {
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }

    if (req.method === "DELETE") {
      return handleEntryDelete(req, id, server);
    }

    if (req.method === "PUT") {
      return handleEntryUpdate(req, id, server);
    }
  }

  return null;
};

const handleProjectsRoutes = (
  url: URL,
  req: Request,
  server: Server
): Promise<Response> | null => {
  if (url.pathname === "/api/projects" && req.method === "GET") {
    return handleProjectsGet(req);
  }

  if (url.pathname === "/api/projects" && req.method === "POST") {
    return handleProjectCreate(req, server);
  }

  const projectsMatch = url.pathname.match(PROJECTS_ID_REGEX);
  if (projectsMatch) {
    const id = projectsMatch[1];
    if (!id) {
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }

    if (req.method === "PUT") {
      return handleProjectUpdate(req, id, server);
    }

    if (req.method === "DELETE") {
      const deleteEntries = url.searchParams.get("deleteEntries") === "true";
      return handleProjectDelete(req, id, deleteEntries, server);
    }
  }

  return null;
};

const handleAuthRoutes = (url: URL, req: Request): Promise<Response> | null => {
  if (url.pathname === "/api/auth/register" && req.method === "POST") {
    return handleRegister(req);
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    return handleLogin(req);
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    return handleLogout();
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    return handleMe(req);
  }

  if (url.pathname === "/api/auth/csrf-token" && req.method === "GET") {
    return handleCsrfToken(req);
  }

  if (url.pathname === "/api/auth/refresh-token" && req.method === "POST") {
    return handleRefreshToken(req);
  }

  return null;
};

const safePromise = (promise: Promise<Response>): Promise<Response> =>
  promise.catch((error) => {
    console.error("Unhandled API error:", error);
    // Check if it's an auth error even in the safety net
    if (isAuthError(error)) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  });

export const handleApiRequest = (
  req: Request,
  server: Server
): Promise<Response> | null => {
  const url = new URL(req.url);

  const authPromise = handleAuthRoutes(url, req);
  if (authPromise) {
    return safePromise(authPromise);
  }

  const timerPromise = handleTimerRoutes(url, req, server);
  if (timerPromise) {
    return safePromise(timerPromise);
  }

  const entriesPromise = handleEntriesRoutes(url, req, server);
  if (entriesPromise) {
    return safePromise(entriesPromise);
  }

  const projectsPromise = handleProjectsRoutes(url, req, server);
  if (projectsPromise) {
    return safePromise(projectsPromise);
  }

  return null;
};
