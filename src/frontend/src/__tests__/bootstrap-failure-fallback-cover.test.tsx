import "@testing-library/jest-dom/vitest";
import { cleanup, configure, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted requirement "a load-time failure anywhere in the app
 * shows a recoverable error panel with a message and a reload action, never a
 * blank page".
 *
 * The production change wraps the React mount in `main.tsx` in a try/catch and
 * adds `renderBootstrapFailure(error)`: a plain-DOM panel (no React, no design
 * tokens) that renders even when the component tree or the stylesheet failed to
 * load. The React `ErrorBoundary` only catches errors thrown while rendering its
 * subtree; a throw during module evaluation or a `createRoot`/`render` failure
 * happens before any component exists, so without this guard the page stays
 * blank white.
 *
 * This file imports the REAL `src/main.tsx` with a `#root` element present but
 * `createRoot` forced to throw, which drives the catch branch and the real
 * `renderBootstrapFailure` panel. It asserts the visible panel, the surfaced
 * message, and the Reload control — the observable contract of the fallback.
 *
 * The panel is plain DOM, so this is component/integration coverage of the
 * bootstrap path, not deployed browser E2E. The real module-load failure and the
 * real browser reload are NOT exercised here.
 */

// `main.tsx` imports the Internet Identity provider, whose package fails to
// resolve its own submodules in the jsdom test environment (a pre-existing
// dependency issue). Mock it so the import graph loads and the bootstrap guard
// is what the test exercises.
vi.mock("@caffeineai/core-infrastructure", () => ({
  InternetIdentityProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

// `main.tsx` imports the real App, which builds the whole route tree and pulls
// in every window component. The bootstrap guard runs before App renders, so a
// minimal stub keeps the import cheap and focused on the fallback path.
vi.mock("@/App", () => ({ default: () => null }));

// Force the mount to fail so the bootstrap catch branch runs. `createRoot` is
// the first thing the try block does after the #root lookup, so throwing here
// reproduces a real mount failure with the root element present.
vi.mock("react-dom/client", () => ({
  default: {
    createRoot: () => {
      throw new Error("createRoot failed during bootstrap");
    },
  },
}));

describe("bootstrap failure fallback (cover)", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders a visible, recoverable panel instead of a blank page when the mount fails", async () => {
    // React logs the caught startup error; silence it so the run output stays
    // readable without weakening the assertion.
    vi.spyOn(console, "error").mockImplementation(() => {});

    // A #root element exists, so the fallback has somewhere to render.
    document.body.innerHTML = '<div id="root"></div>';

    // Importing main.tsx executes the bootstrap synchronously.
    await import("../main");

    const panel = screen.getByTestId("bootstrap.error_state");
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    // The underlying failure message is surfaced, not swallowed.
    expect(
      screen.getByText("createRoot failed during bootstrap"),
    ).toBeInTheDocument();
    // A recoverable Reload control is offered.
    const reload = screen.getByTestId("bootstrap.reload_button");
    expect(reload).toBeInTheDocument();
    expect(reload).toHaveTextContent("Reload");
    // The rendered tree is not empty — the user does not get a blank page.
    expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
