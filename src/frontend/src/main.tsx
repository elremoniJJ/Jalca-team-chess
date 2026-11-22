import { InternetIdentityProvider } from "@caffeineai/core-infrastructure";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

BigInt.prototype.toJSON = function () {
  return this.toString();
};

declare global {
  interface BigInt {
    toJSON(): string;
  }
}

const queryClient = new QueryClient();

/**
 * Last-resort visible fallback for a failure that happens BEFORE React can
 * mount — a module-load throw in the import graph above, a missing `#root`
 * element, or a `createRoot`/`render` failure. The React `ErrorBoundary`
 * below only catches errors thrown while rendering its subtree; a throw
 * during module evaluation (for example a dependency that fails to resolve)
 * happens before any component exists, so without this guard the page would
 * stay blank white with no explanation.
 *
 * The panel is plain DOM (no React, no design tokens) so it renders even when
 * the stylesheet or the component tree failed to load. It surfaces the
 * underlying message and offers a Reload action so the user always has a
 * recovery path.
 */
function renderBootstrapFailure(error: unknown): void {
  const root = document.getElementById("root");
  if (!root) return;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown startup error";
  root.innerHTML = "";
  const panel = document.createElement("div");
  panel.setAttribute("data-ocid", "bootstrap.error_state");
  panel.style.cssText =
    "min-height:100vh;display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;gap:1rem;padding:2rem;text-align:center;" +
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
    "background:#0f1115;color:#f5f5f5;";
  const title = document.createElement("h1");
  title.textContent = "Something went wrong";
  title.style.cssText = "font-size:1.25rem;font-weight:600;margin:0;";
  const detail = document.createElement("p");
  detail.textContent = message;
  detail.style.cssText =
    "font-size:0.875rem;color:#a0a0a0;max-width:32rem;margin:0;" +
    "word-break:break-word;";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.setAttribute("data-ocid", "bootstrap.reload_button");
  reload.style.cssText =
    "padding:0.625rem 1.25rem;border:none;border-radius:0.5rem;" +
    "background:#3b82f6;color:#fff;font-size:0.9375rem;font-weight:600;" +
    "cursor:pointer;";
  reload.addEventListener("click", () => window.location.reload());
  panel.append(title, detail, reload);
  root.append(panel);
}

try {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Root element #root was not found in the document");
  }
  ReactDOM.createRoot(container).render(
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <InternetIdentityProvider>
          <App />
        </InternetIdentityProvider>
      </QueryClientProvider>
    </ErrorBoundary>,
  );
} catch (error) {
  console.error("Failed to start the application:", error);
  renderBootstrapFailure(error);
}
