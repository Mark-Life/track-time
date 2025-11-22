import { Effect } from "effect";
import { login, register } from "./auth.ts";

const authForm = document.getElementById("auth-form") as HTMLFormElement;
const emailInput = document.getElementById("email") as HTMLInputElement;
const passwordInput = document.getElementById("password") as HTMLInputElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const toggleRegister = document.getElementById(
  "toggle-register"
) as HTMLButtonElement;
const errorMessage = document.getElementById("error-message") as HTMLDivElement;

let isRegisterMode = false;

const showError = (message: string) => {
  errorMessage.textContent = message;
  errorMessage.classList.remove("hidden");
};

const hideError = () => {
  errorMessage.classList.add("hidden");
};

const setLoading = (loading: boolean) => {
  submitBtn.disabled = loading;
  if (loading) {
    submitBtn.textContent = "Please wait...";
  } else if (isRegisterMode) {
    submitBtn.textContent = "Sign Up";
  } else {
    submitBtn.textContent = "Sign In";
  }
};

const handleAuth = () =>
  Effect.gen(function* () {
    hideError();
    setLoading(true);

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!(email && password)) {
      showError("Please fill in all fields");
      setLoading(false);
      return;
    }

    try {
      if (isRegisterMode) {
        yield* register(email, password);
      } else {
        yield* login(email, password);
      }

      // Small delay to ensure cookies are set before redirect
      yield* Effect.sleep("100 millis");
      window.location.href = "/app";
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Authentication failed";
      showError(message);
      setLoading(false);
    }
  });

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  Effect.runPromise(
    Effect.catchAll(handleAuth(), (error) =>
      Effect.sync(() => {
        const message =
          error instanceof Error ? error.message : "Authentication failed";
        showError(message);
        setLoading(false);
      })
    )
  ).catch(() => {
    showError("An unexpected error occurred");
    setLoading(false);
  });
});

toggleRegister.addEventListener("click", () => {
  isRegisterMode = !isRegisterMode;
  hideError();

  if (isRegisterMode) {
    submitBtn.textContent = "Sign Up";
    toggleRegister.textContent = "Sign in";
    passwordInput.autocomplete = "new-password";
    const heading = document.querySelector("h1");
    if (heading) {
      heading.textContent = "Create Account";
    }
    const subheading = document.querySelector("p");
    if (subheading) {
      subheading.textContent = "Create an account to start tracking your time";
    }
  } else {
    submitBtn.textContent = "Sign In";
    toggleRegister.textContent = "Sign up";
    passwordInput.autocomplete = "current-password";
    const heading = document.querySelector("h1");
    if (heading) {
      heading.textContent = "Log Time";
    }
    const subheading = document.querySelector("p");
    if (subheading) {
      subheading.textContent = "Sign in to track your time";
    }
  }
});
