import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the Story window's EXISTING principal display, taken
 * BEFORE the request makes the signed-in reader's FULL Internet Identity
 * principal visible in the window.
 *
 * The request intentionally changes HOW the principal is presented (today the
 * visible text is truncated and the full value lives only in the `title`
 * attribute). That presentation is therefore NOT frozen here — this file does
 * not assert the truncated text, and it does not assert that the visible text
 * is short.
 *
 * What it protects is the behavior ADJACENT to that change that must survive
 * it:
 *
 *   - the principal indicator still carries the reader's FULL principal as its
 *     `title`, so the complete value remains available to the user no matter
 *     how the visible text is rendered;
 *   - the displayed identity and the writer-privilege gate read the SAME
 *     principal value: for the exact writer principal the indicator shows that
 *     principal AND the composer appears; for a non-writer the indicator shows
 *     that principal and no composer appears. A change that re-derives the
 *     principal separately for display could let the two diverge, and this
 *     pins them together;
 *   - the sign-out control stays in the same strip as the indicator and still
 *     calls clear().
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

const WRITER_PRINCIPAL =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae";
// A long, non-writer principal — longer than the current truncation window, so
// the full value is only recoverable from the title.
const OTHER_PRINCIPAL =
  "aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa";

const FOREVER_TEXT = "Forever placeholder text.";

/** A signed-out hook state. */
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

describe("StoryWindow principal display survives the full-principal change", () => {
  it("keeps the reader's full principal available on the indicator for a non-writer", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    const indicator = screen.getByTestId("story.principal_indicator");
    // The complete principal is still carried on the indicator regardless of
    // how the visible text is rendered.
    expect(indicator).toHaveAttribute("title", OTHER_PRINCIPAL);
    // A non-writer sees no composer.
    expect(screen.queryByText("Add a new section")).not.toBeInTheDocument();
  });

  it("shows the same principal that gates the writer composer for the exact writer", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    // Display and gate agree: the indicator carries the writer principal and
    // the composer is revealed for that same principal.
    const indicator = screen.getByTestId("story.principal_indicator");
    expect(indicator).toHaveAttribute("title", WRITER_PRINCIPAL);
    expect(screen.getByText("Add a new section")).toBeInTheDocument();
  });

  it("keeps the sign-out control beside the indicator and wired to clear()", async () => {
    const user = userEvent.setup();
    const state = signedInState(OTHER_PRINCIPAL);
    mockUseInternetIdentity.mockReturnValue(state);
    renderStory();

    const indicator = screen.getByTestId("story.principal_indicator");
    const signOut = screen.getByTestId("story.sign_out_button");
    // Both live in the same persistent identity strip, so the identity and its
    // control stay together. The accepted full-principal change moved the
    // principal into its own full-width block beside the sign-out row, so the
    // two are no longer immediate siblings; the strip that contains the
    // indicator still contains the sign-out control.
    expect(indicator.parentElement).not.toBeNull();
    expect(indicator.parentElement?.contains(signOut)).toBe(true);

    await user.click(signOut);
    expect(state.clear).toHaveBeenCalledTimes(1);
  });
});
