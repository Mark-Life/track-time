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
    return handleTimerGet();
  }

  if (url.pathname === "/api/timer/start" && req.method === "POST") {
    return handleTimerStart(req, server);
  }

  if (url.pathname === "/api/timer/stop" && req.method === "POST") {
    return handleTimerStop(server);
  }

  return null;
};

const handleEntriesRoutes = (
  url: URL,
  req: Request,
  server: Server
): Promise<Response> | null => {
  if (url.pathname === "/api/entries" && req.method === "GET") {
    return handleEntriesGet();
  }

  const entriesMatch = url.pathname.match(ENTRIES_ID_REGEX);
  if (entriesMatch) {
    const id = entriesMatch[1];
    if (!id) {
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }

    if (req.method === "DELETE") {
      return handleEntryDelete(id, server);
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
    return handleProjectsGet();
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
      return handleProjectDelete(id, deleteEntries, server);
    }
  }

  return null;
};

export const handleApiRequest = (
  req: Request,
  server: Server
): Promise<Response> | null => {
  const url = new URL(req.url);

  const timerPromise = handleTimerRoutes(url, req, server);
  if (timerPromise) {
    return timerPromise;
  }

  const entriesPromise = handleEntriesRoutes(url, req, server);
  if (entriesPromise) {
    return entriesPromise;
  }

  const projectsPromise = handleProjectsRoutes(url, req, server);
  if (projectsPromise) {
    return projectsPromise;
  }

  return null;
};
