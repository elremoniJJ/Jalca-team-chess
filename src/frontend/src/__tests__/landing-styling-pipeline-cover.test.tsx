import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The login route imports WalletSource as a runtime value from @/backend,
// which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum value the route needs.
vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The login route now consumes useInternetIdentity() for the ranked-play
// Internet Identity option. The real @caffeineai/core-infrastructure package
// fails to resolve its own submodules in jsdom, so mock the hook with an
// anonymous, idle state. This test never exercises ranked sign-in.
vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: null,
    isAuthenticated: false,
    isLoggingIn: false,
    login: vi.fn(),
    loginError: null,
  }),
}));

// The route's hooks. Mock every hook the route consumes so the test can
// render the landing page deterministically without a real actor or the heavy
// polling hooks.
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

// The route calls unlockAudio() in its login handler and imports the module
// at the top; mock it so no AudioContext is touched in jsdom.
vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers (not exercised here) do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { Route as indexRoute } from "@/routes/index";

// The landing page's deterministic markers use `data-ocid` rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

// Render the route's component directly (rather than through the router) so
// the test needs no router context. The route's useNavigate is mocked to a
// no-op.
const LoginRouteComponent = indexRoute.options.component!;

/**
 * Cover for the landing page's Tailwind styling pipeline.
 *
 * The accepted requirement is that the landing/login page renders with its
 * full Tailwind styling and design tokens applied — the card, background,
 * typography, and form fields — rather than unstyled default browser markup.
 *
 * jsdom has no layout engine and does not apply the app's `index.css`, so the
 * stylesheet half of the change is asserted against the source files (the same
 * approach the rounded-corners cover and the header no-clip cover use). These
 * tests pin the pipeline contract that produces the styled page:
 *
 *   - `src/index.css` carries the three Tailwind layer directives and the
 *     design-token custom properties the theme consumes;
 *   - `postcss.config.js` runs the `tailwindcss` and `autoprefixer` plugins,
 *     which is what actually compiles the utility classes;
 *   - `tailwind.config.js` maps the token custom properties into the color and
 *     font utilities the landing page uses;
 *   - `src/main.tsx` imports `./index.css`, so the compiled stylesheet is part
 *     of the app bundle.
 *
 * The rendered-DOM half asserts that the landing route actually applies the
 * Tailwind utility classes for the card, background, typography, and form
 * fields — the classes the pipeline above compiles. A regression that strips
 * the classes from the route (leaving default browser markup) fails here even
 * though jsdom cannot compute the resulting pixels.
 *
 * This is component/integration coverage, not deployed browser E2E: it cannot
 * prove the compiled CSS reaches a real browser, only that the pipeline and
 * the class contract are wired.
 */

const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const POSTCSS = readFileSync(
  resolve(process.cwd(), "postcss.config.js"),
  "utf8",
);
const TAILWIND = readFileSync(
  resolve(process.cwd(), "tailwind.config.js"),
  "utf8",
);
const MAIN = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");

describe("landing page Tailwind styling pipeline", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  const renderLogin = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <LoginRouteComponent />
      </QueryClientProvider>,
    );
  };

  it("declares the three Tailwind layer directives in index.css", () => {
    expect(CSS).toMatch(/@tailwind\s+base\s*;/);
    expect(CSS).toMatch(/@tailwind\s+components\s*;/);
    expect(CSS).toMatch(/@tailwind\s+utilities\s*;/);
  });

  it("defines the design-token custom properties the theme consumes", () => {
    // The landing page's card/background/foreground/primary/border/input
    // utilities all resolve to these tokens; a dropped token would render the
    // page with unresolved oklch(var(--...)) values.
    for (const token of [
      "--background",
      "--foreground",
      "--card",
      "--card-foreground",
      "--primary",
      "--primary-foreground",
      "--border",
      "--input",
      "--ring",
      "--muted-foreground",
      "--radius",
    ]) {
      expect(CSS, `${token} should be defined`).toMatch(
        new RegExp(`${token}\\s*:`),
      );
    }
  });

  it("runs the tailwindcss and autoprefixer PostCSS plugins", () => {
    expect(POSTCSS).toMatch(/tailwindcss\s*:\s*\{\s*\}/);
    expect(POSTCSS).toMatch(/autoprefixer\s*:\s*\{\s*\}/);
  });

  it("maps the design tokens into Tailwind color and font utilities", () => {
    // The landing page's bg-background / bg-card / text-foreground /
    // border-border / border-input / font-body / font-display utilities only
    // exist if the config maps the tokens.
    expect(TAILWIND).toMatch(
      /background\s*:\s*["']oklch\(var\(--background\)\)["']/,
    );
    expect(TAILWIND).toMatch(/card\s*:\s*\{/);
    expect(TAILWIND).toMatch(
      /foreground\s*:\s*["']oklch\(var\(--foreground\)\)["']/,
    );
    expect(TAILWIND).toMatch(/border\s*:\s*["']oklch\(var\(--border\)\)["']/);
    expect(TAILWIND).toMatch(/input\s*:\s*["']oklch\(var\(--input\)\)["']/);
    expect(TAILWIND).toMatch(/display\s*:\s*\[/);
    expect(TAILWIND).toMatch(/body\s*:\s*\[/);
  });

  it("imports the compiled stylesheet from the app entry point", () => {
    expect(MAIN).toMatch(/import\s+["']\.\/index\.css["']\s*;/);
  });

  it("applies the card, background, and typography utilities to the landing page", () => {
    const { container } = renderLogin();

    // The page background wrapper.
    const page = container.firstElementChild as HTMLElement;
    expect(page).toHaveClass("min-h-screen");
    expect(page).toHaveClass("bg-background");

    // The login card surface: card background, rounded corners, border,
    // shadow, and padding.
    const card = page.querySelector(".bg-card");
    expect(card).not.toBeNull();
    expect(card).toHaveClass("rounded-xl");
    expect(card).toHaveClass("shadow-lg");
    expect(card).toHaveClass("border");
    expect(card).toHaveClass("border-border");
    expect(card).toHaveClass("p-8");

    // Typography: the wordmark heading uses the display font size and the
    // foreground token.
    const wordmark = screen.getByTestId("login.wordmark");
    expect(wordmark).toHaveClass("text-2xl");
    expect(wordmark).toHaveClass("text-foreground");
  });

  it("applies the form-field utilities to the landing page inputs", () => {
    renderLogin();

    const username = screen.getByLabelText("Username");
    expect(username).toHaveClass("w-full");
    expect(username).toHaveClass("rounded-lg");
    expect(username).toHaveClass("border");
    expect(username).toHaveClass("border-input");
    expect(username).toHaveClass("bg-background");
    expect(username).toHaveClass("text-foreground");
    expect(username).toHaveClass("placeholder:text-muted-foreground");

    // The wallet address field was intentionally removed, so the username
    // field is the only text input on the landing page.
    expect(document.querySelectorAll("input")).toHaveLength(1);

    // The primary action button uses the primary token pair.
    const join = screen.getByRole("button", { name: "Just Play" });
    expect(join).toHaveClass("bg-primary");
    expect(join).toHaveClass("text-primary-foreground");
  });
});
