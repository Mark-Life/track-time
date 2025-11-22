import { Effect } from "effect";
import { getCurrentUser, logout } from "../api.ts";

/**
 * Loads and displays user email
 */
export const loadUserEmail = Effect.gen(function* () {
  const userEmailElement = document.getElementById("user-email");
  const drawerUserEmailElement = document.getElementById("drawer-user-email");

  const user = yield* Effect.catchAll(getCurrentUser, (error) =>
    Effect.gen(function* () {
      yield* Effect.log(`Failed to load user email: ${error}`);
      return null;
    })
  );

  if (user) {
    if (userEmailElement) {
      userEmailElement.textContent = user.email;
    }
    if (drawerUserEmailElement) {
      drawerUserEmailElement.textContent = user.email;
    }
  }
});

/**
 * Sets up logout button handlers (shared between timer and projects pages)
 */
export const setupLogout = () => {
  const logoutBtn = document.getElementById("logout-btn");
  const drawerLogoutBtn = document.getElementById("drawer-logout-btn");

  const handleLogout = () => {
    Effect.runPromise(
      Effect.catchAll(logout, (error) =>
        Effect.gen(function* () {
          yield* Effect.logError(`Failed to logout: ${error}`);
          // Still redirect even if logout fails
          window.location.href = "/login";
        })
      )
    );
  };

  if (logoutBtn) {
    // Remove existing listeners by cloning and replacing
    const newLogoutBtn = logoutBtn.cloneNode(true) as HTMLButtonElement;
    logoutBtn.parentNode?.replaceChild(newLogoutBtn, logoutBtn);
    newLogoutBtn.addEventListener("click", handleLogout);
  }

  if (drawerLogoutBtn) {
    // Remove existing listeners by cloning and replacing
    const newDrawerLogoutBtn = drawerLogoutBtn.cloneNode(
      true
    ) as HTMLButtonElement;
    drawerLogoutBtn.parentNode?.replaceChild(
      newDrawerLogoutBtn,
      drawerLogoutBtn
    );
    newDrawerLogoutBtn.addEventListener("click", handleLogout);
  }
};
