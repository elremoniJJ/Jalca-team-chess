import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the Story window's Internet Identity sign-in error surface.
 *
 * The accepted behavior this file asserts in the frontend:
 *   - when Internet Identity sign-in fails, the Story window shows the REAL
 *     underlying failure reason (the hook's `loginError` message) instead of
 *     collapsing every failure into the generic
 *     "Sign-in failed. Please try again.";
 *   - a plain string `loginError` is surfaced verbatim too;
 *   - the generic sentence is used ONLY as a fallback when no usable message
 *     exists (an Error with a blank message, or a non-string/non-Error value),
 *     so the error surface is never blank;
 *   - the error paragraph (story.sign_in_error) is rendered only when
 *     loginError is truthy, and is absent on a clean signed-out state;
 *   - the signed-out voting prompt
 *     "Sign in with Internet Identity to press Delete or Keep." remains
 *     verbatim and is distinct from the sign-in error path.
 *
 * The backend actor is a typed local mock (no real canister, no network) and
 * the real @caffeineai/core-infrastructure InternetIdentityProvider /
 * useInternetIdentity hook is mocked, so this file proves the frontend
 * consumer contract only. The real Internet Identity provider and the real
 * backend are NOT exercised here.
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

const GENERIC_ERROR = "Sign-in failed. Please try again.";
const FOREVER_TEXT = "Forever placeholder text.";

/** A signed-out hook state with the given loginError. */
function signedOutState(loginError: unknown = null) {
  return {
    identity: null,
    login: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: false,
    isLoggingIn: false,
    loginError,
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

describe("StoryWindow sign-in error surfaces the real failure reason", () => {
  it("shows the Error message instead of the generic sentence", () => {
    mockUseInternetIdentity.mockReturnValue(
      signedOutState(new Error("User closed the sign-in window")),
    );
    renderStory();

    const error = screen.getByTestId("story.sign_in_error");
    expect(error).toHaveTextContent("User closed the sign-in window");
    expect(error).not.toHaveTextContent(GENERIC_ERROR);
  });

  it("shows a plain string loginError verbatim", () => {
    mockUseInternetIdentity.mockReturnValue(
      signedOutState("Network request failed"),
    );
    renderStory();

    const error = screen.getByTestId("story.sign_in_error");
    expect(error).toHaveTextContent("Network request failed");
    expect(error).not.toHaveTextContent(GENERIC_ERROR);
  });

  it("falls back to the generic sentence when the Error message is blank", () => {
    mockUseInternetIdentity.mockReturnValue(signedOutState(new Error("   ")));
    renderStory();

    expect(screen.getByTestId("story.sign_in_error")).toHaveTextContent(
      GENERIC_ERROR,
    );
  });

  it("falls back to the generic sentence for a non-string, non-Error value", () => {
    mockUseInternetIdentity.mockReturnValue(signedOutState({ code: 500 }));
    renderStory();

    expect(screen.getByTestId("story.sign_in_error")).toHaveTextContent(
      GENERIC_ERROR,
    );
  });

  it("renders no error paragraph on a clean signed-out state", () => {
    renderStory();

    expect(screen.queryByTestId("story.sign_in_error")).not.toBeInTheDocument();
  });

  it("keeps the signed-out voting prompt verbatim and distinct from the error path", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    mockUseInternetIdentity.mockReturnValue(
      signedOutState(new Error("User closed the sign-in window")),
    );
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
    expect(screen.getByTestId("story.sign_in_error")).toHaveTextContent(
      "User closed the sign-in window",
    );
  });
});
