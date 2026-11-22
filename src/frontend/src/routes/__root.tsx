import { Outlet, createRootRoute } from "@tanstack/react-router";

/**
 * Route-level fallback. Without this, an uncaught render error in a child
 * route propagates all the way to the top-level ErrorBoundary (or, for a
 * module-load throw, past every boundary) and the user sees a blank page.
 * Rendering a visible, recoverable panel here keeps the default route
 * non-blank even when a child route fails.
 */
function RootErrorComponent({ error }: { error: Error }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-background px-4 gap-4 text-center"
      data-ocid="root.error_state"
    >
      <div
        className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive text-2xl"
        aria-hidden="true"
      >
        !
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-display font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="text-sm font-body text-muted-foreground break-words max-w-md">
          {error.message}
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        data-ocid="root.reload_button"
        className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring transition-smooth"
      >
        Reload
      </button>
    </div>
  );
}

export const Route = createRootRoute({
  component: () => <Outlet />,
  errorComponent: RootErrorComponent,
});
