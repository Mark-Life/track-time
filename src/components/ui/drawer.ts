import { Effect } from "effect";

export const openDrawer = (): Effect.Effect<void> =>
  Effect.sync(() => {
    const drawer = document.getElementById("mobile-drawer");
    const overlay = document.getElementById("drawer-overlay");
    if (drawer && overlay) {
      drawer.classList.remove("translate-x-[-100%]");
      overlay.classList.remove("hidden");
      document.body.style.overflow = "hidden";
    }
  });

export const closeDrawer = (): Effect.Effect<void> =>
  Effect.sync(() => {
    const drawer = document.getElementById("mobile-drawer");
    const overlay = document.getElementById("drawer-overlay");
    if (drawer && overlay) {
      drawer.classList.add("translate-x-[-100%]");
      overlay.classList.add("hidden");
      document.body.style.overflow = "";
    }
  });

export const initializeDrawer = (): Effect.Effect<void> =>
  Effect.sync(() => {
    const menuButton = document.getElementById("mobile-menu-btn");
    const closeButton = document.getElementById("drawer-close-btn");
    const overlay = document.getElementById("drawer-overlay");
    const navLinks = Array.from(
      document.querySelectorAll(".drawer-nav-link")
    ) as HTMLAnchorElement[];

    if (menuButton) {
      menuButton.addEventListener("click", () => {
        Effect.runPromise(openDrawer());
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", () => {
        Effect.runPromise(closeDrawer());
      });
    }

    if (overlay) {
      overlay.addEventListener("click", () => {
        Effect.runPromise(closeDrawer());
      });
    }

    for (const link of navLinks) {
      link.addEventListener("click", () => {
        Effect.runPromise(closeDrawer());
      });
    }
  });
