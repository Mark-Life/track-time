import { Effect } from "effect";
import { initializeCalendarPage } from "../features/calendar";
import { initializeProjectsPage } from "../features/projects";

const timerPage = document.getElementById("timer-page") as HTMLDivElement;
const projectsPage = document.getElementById("projects-page") as HTMLDivElement;
const calendarPage = document.getElementById("calendar-page") as HTMLDivElement;
const navLinks = Array.from(
  document.querySelectorAll(".nav-link")
) as HTMLAnchorElement[];

/**
 * Normalizes route (remove trailing slash, ensure it starts with /app)
 */
export const normalizeRoute = (route: string): string => {
  const normalized =
    route.endsWith("/") && route !== "/" ? route.slice(0, -1) : route;
  // If route doesn't start with /app, default to /app
  if (!normalized.startsWith("/app")) {
    return "/app";
  }
  return normalized;
};

/**
 * Shows the appropriate page based on route
 */
export const showPage = (route: string) => {
  const normalizedRoute = normalizeRoute(route);

  // Hide all pages first
  timerPage.classList.add("hidden");
  projectsPage.classList.add("hidden");
  calendarPage.classList.add("hidden");

  // Show the appropriate page
  if (normalizedRoute === "/app/projects") {
    projectsPage.classList.remove("hidden");
    window.history.pushState({ route: normalizedRoute }, "", "/app/projects");
  } else if (normalizedRoute === "/app/calendar") {
    calendarPage.classList.remove("hidden");
    window.history.pushState({ route: normalizedRoute }, "", "/app/calendar");
  } else {
    timerPage.classList.remove("hidden");
    window.history.pushState({ route: normalizedRoute }, "", "/app");
  }

  // Update active nav link
  for (const link of navLinks) {
    const linkRoute = link.getAttribute("data-route");
    if (linkRoute === normalizedRoute) {
      link.classList.add("text-primary");
    } else {
      link.classList.remove("text-primary");
    }
  }
};

/**
 * Handles route navigation and initializes appropriate page
 */
export const handleRouteNavigation = (
  route: string,
  initializeApp: Effect.Effect<void, Error>
) => {
  const normalizedRoute = normalizeRoute(route);
  showPage(normalizedRoute);

  if (normalizedRoute === "/app/projects") {
    Effect.runPromise(
      Effect.catchAll(initializeProjectsPage, (error) =>
        Effect.logError(`Failed to initialize projects page: ${error}`)
      )
    );
  } else if (normalizedRoute === "/app/calendar") {
    Effect.runPromise(
      Effect.catchAll(initializeCalendarPage, (error) =>
        Effect.logError(`Failed to initialize calendar page: ${error}`)
      )
    );
  } else if (normalizedRoute === "/app") {
    Effect.runPromise(
      Effect.catchAll(initializeApp, (error) =>
        Effect.logError(`Failed to initialize app: ${error}`)
      )
    );
  }
};

/**
 * Initializes routing with navigation handlers
 */
export const initializeRouting = (
  initializeApp: Effect.Effect<void, Error>
) => {
  // Handle initial route - both show page and initialize it
  const currentRoute = normalizeRoute(window.location.pathname);
  handleRouteNavigation(currentRoute, initializeApp);

  // Handle navigation clicks
  for (const link of navLinks) {
    link.addEventListener("click", (e: MouseEvent) => {
      e.preventDefault();
      const route = link.getAttribute("data-route");
      if (route) {
        handleRouteNavigation(route, initializeApp);
      }
    });
  }

  // Handle browser back/forward
  window.addEventListener("popstate", () => {
    const route = normalizeRoute(window.location.pathname);
    handleRouteNavigation(route, initializeApp);
  });
};
