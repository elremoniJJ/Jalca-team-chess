import "@testing-library/jest-dom/vitest";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted requirement "a module-load or render failure surfaces
 * a visible, recoverable message instead of a blank page".
 *
 * The production change adds an `errorComponent` to the root route
 * (src/frontend/src/routes/__root.tsx). Without it, an uncaught render error in
 * a child route propagates past every boundary and the user sees a blank page.
 *
 * This file drives the REAL root route's errorComponent through a real
 * TanStack Router instance: a child route whose component throws during render
 * is mounted, and the test asserts the visible fallback panel, the surfaced
 * error message, and the Reload control. The router is built with an in-memory
 * history so no browser URL is touched.
 *
 * The child route is a local test fixture, not a production route: the point is
 * the root route's fallback behavior, which is what the change added.
 */

// The root route module imports only @tanstack/react-router, so it loads
// cleanly under jsdom. Import it directly to exercise the real errorComponent.
import { Route as rootRoute } from "@/routes/__root";

function ThrowingChild(): never {
  throw new Error("child route exploded");
}

function buildRouter() {
  // A fresh root route per test keeps the real errorComponent while avoiding
  // cross-test route-tree mutation.
  const root = createRootRoute({
    component: rootRoute.options.component,
    errorComponent: rootRoute.options.errorComponent,
  });
  const child = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: ThrowingChild,
  });
  const router = createRouter({
    routeTree: root.addChildren([child]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return router;
}

describe("Root route render-failure fallback", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a visible fallback panel instead of a blank page when a child route throws", async () => {
    // React logs the caught render error; silence it so the run output stays
    // readable without weakening the assertion.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const router = buildRouter();
    const { container } = render(<RouterProvider router={router} />);

    // The router resolves the route tree asynchronously; wait for the fallback.
    const panel = await screen.findByTestId("root.error_state");
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    // The underlying failure message is surfaced, not swallowed.
    expect(screen.getByText("child route exploded")).toBeInTheDocument();
    // The rendered tree is not empty — the user does not get a blank page.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("offers a recoverable Reload control in the fallback panel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const router = buildRouter();
    render(<RouterProvider router={router} />);

    const reload = await screen.findByTestId("root.reload_button");
    expect(reload).toBeInTheDocument();
    expect(reload).toHaveTextContent("Reload");
  });
});
