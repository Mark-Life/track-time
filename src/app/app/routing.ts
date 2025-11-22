import { Effect } from "effect";
import { initializeProjectsPage } from "./projects.ts";

const timerPage = document.getElementById("timer-page") as HTMLDivElement;
const projectsPage = document.getElementById("projects-page") as HTMLDivElement;
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

  if (normalizedRoute === "/app/projects") {
    timerPage.classList.add("hidden");
    projectsPage.classList.remove("hidden");
    // Update URL without reload
    window.history.pushState({ route: normalizedRoute }, "", "/app/projects");
  } else {
    timerPage.classList.remove("hidden");
    projectsPage.classList.add("hidden");
    // Update URL without reload
    window.history.pushState({ route: normalizedRoute }, "", "/app");
  }

  // Update active nav link
  for (const link of navLinks) {
    const linkRoute = link.getAttribute("data-route");
    if (linkRoute === normalizedRoute) {
      link.classList.add("font-bold", "text-primary");
    } else {
      link.classList.remove("font-bold", "text-primary");
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
  showPage(route);
  if (route === "/app/projects") {
    Effect.runPromise(
      Effect.catchAll(initializeProjectsPage, (error) =>
        Effect.logError(`Failed to initialize projects page: ${error}`)
      )
    );
  } else if (route === "/app") {
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
  // Handle initial route
  const currentRoute = normalizeRoute(window.location.pathname);
  showPage(currentRoute);

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
