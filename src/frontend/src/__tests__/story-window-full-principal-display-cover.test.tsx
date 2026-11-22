import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted Story window change: when a reader is signed in with
 * Internet Identity, the FULL principal is displayed in the window so it can
 * be read and copied in its entirety — never shortened or truncated with an
 * ellipsis.
 *
 * The accepted behavior this file asserts in the frontend:
 *   - the visible text of the principal indicator (story.principal_indicator)
 *     is the reader's COMPLETE principal, character for character, for both a
 *     long non-writer principal and the writer principal;
 *   - the visible text contains no ellipsis character and no truncation marker
 *     ("…", "..."), so the value is not shortened;
 *   - the indicator's `title` still carries the same complete principal;
 *   - the existing sign-in / sign-out affordances keep working: signed out the
 *     Sign in button calls login(); signed in the Sign out control calls
 *     clear();
 *   - the writer-privilege gate is unchanged: only the exact writer principal
 *     reveals the composer, and the displayed principal and the gate agree.
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

const WRITER_PRINCIPAL =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae";
// A long, non-writer principal — longer than any truncation window, so a
// shortened rendering would be observable.
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

describe("StoryWindow displays the full Internet Identity principal", () => {
  it("renders the complete principal as visible text for a signed-in non-writer", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    const indicator = screen.getByTestId("story.principal_indicator");

    // The visible text is the reader's COMPLETE principal, character for
    // character — not a shortened prefix.
    expect(indicator.textContent).toBe(OTHER_PRINCIPAL);
    // No ellipsis or truncation marker anywhere in the rendered value.
    expect(indicator.textContent).not.toContain("…");
    expect(indicator.textContent).not.toContain("...");
    // The full value is also carried on the title attribute.
    expect(indicator).toHaveAttribute("title", OTHER_PRINCIPAL);
  });

  it("renders the complete writer principal as visible text", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    const indicator = screen.getByTestId("story.principal_indicator");
    expect(indicator.textContent).toBe(WRITER_PRINCIPAL);
    expect(indicator.textContent).not.toContain("…");
    expect(indicator.textContent).not.toContain("...");
  });

  it("keeps the displayed principal and the writer gate reading the same value", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    // The exact writer principal is displayed in full AND reveals the composer.
    expect(screen.getByTestId("story.principal_indicator").textContent).toBe(
      WRITER_PRINCIPAL,
    );
    expect(screen.getByText("Add a new section")).toBeInTheDocument();
  });

  it("does not reveal the composer to a signed-in non-writer whose principal is displayed in full", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    expect(screen.getByTestId("story.principal_indicator").textContent).toBe(
      OTHER_PRINCIPAL,
    );
    expect(screen.queryByText("Add a new section")).not.toBeInTheDocument();
  });
});

describe("StoryWindow sign-in and sign-out affordances are unchanged", () => {
  it("shows the Sign in button when signed out and calls login() when pressed", async () => {
    const user = userEvent.setup();
    const state = signedOutState();
    mockUseInternetIdentity.mockReturnValue(state);
    renderStory();

    const signIn = screen.getByTestId("story.sign_in_button");
    expect(signIn).toHaveTextContent("Sign in");
    expect(
      screen.queryByTestId("story.principal_indicator"),
    ).not.toBeInTheDocument();

    await user.click(signIn);
    expect(state.login).toHaveBeenCalledTimes(1);
  });

  it("shows the Sign out control when signed in and calls clear() when pressed", async () => {
    const user = userEvent.setup();
    const state = signedInState(OTHER_PRINCIPAL);
    mockUseInternetIdentity.mockReturnValue(state);
    renderStory();

    const signOut = screen.getByTestId("story.sign_out_button");
    expect(signOut).toHaveTextContent("Sign out");
    expect(
      screen.queryByTestId("story.sign_in_button"),
    ).not.toBeInTheDocument();

    await user.click(signOut);
    expect(state.clear).toHaveBeenCalledTimes(1);
  });
});
