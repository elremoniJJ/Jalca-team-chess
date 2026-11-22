import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the Story window's sign-in error display is
 * changed to surface the real underlying failure reason instead of the
 * generic "Sign-in failed. Please try again.".
 *
 * The request intentionally changes WHAT the error text says, so this file
 * deliberately does NOT freeze the generic string. What it protects is the
 * behavior ADJACENT to that change that must survive it:
 *
 *   - the sign-in affordance structure: signed out shows a "Sign in" button
 *     that calls login(); while logging in the button is disabled and reads
 *     "Signing in…"; signed in shows the principal indicator and a "Sign out"
 *     control that calls clear();
 *   - the signed-out prompt on a live section
 *     ("Sign in with Internet Identity to press Delete or Keep.") is the
 *     gating message and is NOT the sign-in error path — it must not be
 *     reworded or replaced by the error detail;
 *   - the error paragraph is rendered only when loginError is truthy, and is
 *     absent on a clean signed-out state;
 *   - the app has exactly one InternetIdentityProvider and no leftover wiring
 *     from the removed temporary Internet Identity window. The accepted change
 *     that attaches the signed-in identity to the backend actor intentionally
 *     adds lib/backend-actor.ts as a second useInternetIdentity() consumer, so
 *     the consumer set is pinned to exactly {StoryWindow.tsx, backend-actor.ts}
 *     rather than to a single file.
 *
 * The backend actor is a typed local mock (no real canister, no network), so
 * this file proves the frontend consumer contract only. The real Internet
 * Identity provider and the real backend are NOT exercised here.
 */

// StoryWindow is the only consumer of useInternetIdentity() in the app. The
// real @caffeineai/core-infrastructure package fails to resolve its own
// submodules in the jsdom environment (a pre-existing dependency issue), so
// mock the hook with a controllable local state.
const { mockUseInternetIdentity } = vi.hoisted(() => ({
  mockUseInternetIdentity: vi.fn(),
}));

vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: mockUseInternetIdentity,
}));

// The story data layer reaches the backend through useActorState() from
// lib/backend-actor. Mock it with a typed actor whose story methods are
// vi.fn()s so the test captures the exact calls and controls the responses.
const {
  getStorySections,
  appendStorySection,
  fillStoryGap,
  pressStoryDelete,
  pressStoryKeep,
} = vi.hoisted(() => ({
  getStorySections: vi.fn(),
  appendStorySection: vi.fn(),
  fillStoryGap: vi.fn(),
  pressStoryDelete: vi.fn(),
  pressStoryKeep: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {
      getStorySections,
      appendStorySection,
      fillStoryGap,
      pressStoryDelete,
      pressStoryKeep,
    },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

import type { StoryRow } from "@/backend";
import { StoryWindow } from "@/components/StoryWindow";

const OTHER_PRINCIPAL = "aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa";
const FOREVER_TEXT = "Forever placeholder text.";

/** A signed-out hook state with no error. */
function signedOutState() {
  return {
    identity: null,
    login: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: false,
    isLoggingIn: false,
    loginError: null,
  };
}

/** A signed-in hook state carrying the given principal. */
function signedInState(principalText: string) {
  return {
    identity: {
      getPrincipal: () => ({ toText: () => principalText }),
    },
    login: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: true,
    isLoggingIn: false,
    loginError: null,
  };
}

/** The Forever section plus one live appended section. */
function sectionsFixture(): StoryRow[] {
  return [
    {
      index: 0n,
      text: FOREVER_TEXT,
      deleteCount: 0n,
      keepCount: 0n,
      deleted: false,
      hasVotedDelete: false,
      hasVotedKeep: false,
    },
    {
      index: 1n,
      text: "Wilkin met a travelling juggler.",
      deleteCount: 2n,
      keepCount: 1n,
      deleted: false,
      hasVotedDelete: false,
      hasVotedKeep: false,
    },
  ];
}

function renderStory() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StoryWindow />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockUseInternetIdentity.mockReturnValue(signedOutState());
  getStorySections.mockResolvedValue(sectionsFixture());
  appendStorySection.mockResolvedValue(undefined);
  fillStoryGap.mockResolvedValue(undefined);
  pressStoryDelete.mockResolvedValue(undefined);
  pressStoryKeep.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("StoryWindow sign-in affordance structure survives the error-detail change", () => {
  it("shows a Sign in button that calls login() and no error paragraph on a clean signed-out state", async () => {
    const user = userEvent.setup();
    const state = signedOutState();
    mockUseInternetIdentity.mockReturnValue(state);
    renderStory();

    const signIn = screen.getByTestId("story.sign_in_button");
    expect(signIn).toHaveTextContent("Sign in");
    expect(signIn).toBeEnabled();

    // No error is shown until loginError is truthy.
    expect(screen.queryByTestId("story.sign_in_error")).not.toBeInTheDocument();

    await user.click(signIn);
    expect(state.login).toHaveBeenCalledTimes(1);
  });

  it("disables the Sign in button and shows the in-progress label while logging in", () => {
    mockUseInternetIdentity.mockReturnValue({
      ...signedOutState(),
      isLoggingIn: true,
    });
    renderStory();

    const signIn = screen.getByTestId("story.sign_in_button");
    expect(signIn).toBeDisabled();
    expect(signIn).toHaveTextContent("Signing in…");
  });

  it("shows the principal indicator and Sign out control when signed in, and calls clear()", async () => {
    const user = userEvent.setup();
    const state = signedInState(OTHER_PRINCIPAL);
    mockUseInternetIdentity.mockReturnValue(state);
    renderStory();

    expect(
      screen.queryByTestId("story.sign_in_button"),
    ).not.toBeInTheDocument();
    const indicator = screen.getByTestId("story.principal_indicator");
    expect(indicator).toHaveAttribute("title", OTHER_PRINCIPAL);

    const signOut = screen.getByTestId("story.sign_out_button");
    expect(signOut).toHaveTextContent("Sign out");
    await user.click(signOut);
    expect(state.clear).toHaveBeenCalledTimes(1);
  });

  it("renders the error paragraph only when loginError is truthy", () => {
    mockUseInternetIdentity.mockReturnValue({
      ...signedOutState(),
      loginError: "Network request failed",
    });
    renderStory();

    // The error paragraph exists; its exact wording is intentionally NOT
    // frozen here because the request changes it to surface the real detail.
    expect(screen.getByTestId("story.sign_in_error")).toBeInTheDocument();
  });

  it("keeps the signed-out voting prompt distinct from the sign-in error path", async () => {
    const user = userEvent.setup();
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);
    // The live section lives on page 2 under the accepted pagination model.
    await user.click(
      screen.getByRole("button", { name: "Next page of story sections" }),
    );

    // The gating prompt is still shown verbatim and is not the error element.
    expect(
      screen.getByText(
        "Sign in with Internet Identity to press Delete or Keep.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("story.sign_in_error")).not.toBeInTheDocument();
  });
});

describe("Internet Identity wiring has no leftover temporary-window coupling", () => {
  it("mounts exactly one InternetIdentityProvider and only the expected useInternetIdentity consumers", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // Walk the frontend source tree (excluding tests) and count the wiring.
    const srcRoot = path.resolve(__dirname, "..");
    const providerFiles: string[] = [];
    const consumerFiles: string[] = [];

    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") {
            continue;
          }
          await walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const text = await fs.readFile(full, "utf8");
        if (/<InternetIdentityProvider[\s>]/.test(text)) {
          providerFiles.push(full);
        }
        if (/\buseInternetIdentity\s*\(/.test(text)) {
          consumerFiles.push(full);
        }
      }
    }

    await walk(srcRoot);

    expect(providerFiles).toHaveLength(1);
    expect(providerFiles[0].endsWith("main.tsx")).toBe(true);

    // The accepted change attaches the signed-in identity to the backend actor
    // (lib/backend-actor.ts) and adds the Internet Identity option on the login
    // route (routes/index.tsx), so those are now consumers alongside
    // StoryWindow. Pin the exact set so a stray extra consumer (e.g. leftover
    // wiring from the removed temporary Internet Identity window) still fails
    // here.
    const consumerNames = consumerFiles
      .map((file) => file.split("/").pop())
      .sort();
    expect(consumerNames).toEqual([
      "StoryWindow.tsx",
      "backend-actor.ts",
      "index.tsx",
    ]);
  });

  it("has no remaining reference to the removed temporary Internet Identity window", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const srcRoot = path.resolve(__dirname, "..");
    const offenders: string[] = [];

    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") {
            continue;
          }
          await walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const text = await fs.readFile(full, "utf8");
        if (/InternetIdentityWindow/.test(text)) {
          offenders.push(full);
        }
      }
    }

    await walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});
