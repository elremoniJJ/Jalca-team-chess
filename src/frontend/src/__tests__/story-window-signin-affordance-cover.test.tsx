import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Story window's controls carry deterministic `data-ocid` markers rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the Story window's OWN Internet Identity sign-in affordance and
 * the principal-scoped vote state.
 *
 * The accepted behavior this file asserts in the frontend:
 *   - signed out, the Story window header shows a "Sign in" button
 *     (data-ocid story.sign_in_button) that calls the Internet Identity
 *     `login()` flow;
 *   - signed in, the header shows the reader's principal indicator
 *     (story.principal_indicator) and a "Sign out" control
 *     (story.sign_out_button) that calls `clear()`;
 *   - the affordance is reachable whether the panel is open or collapsed;
 *   - signing in from the Story window immediately reflects the signed-in
 *     state: the sign-in button disappears, the principal indicator and sign
 *     out appear, and the Delete/Keep controls become enabled;
 *   - a signed-in reader's vote state reflects the CURRENT principal: the
 *     query key includes the principal, so switching principals refetches and
 *     the new principal's caller-relative hasVoted flags drive the controls
 *     (a previously signed-in principal's vote lock does not leak).
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
const OTHER_PRINCIPAL = "aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa";
const SECOND_PRINCIPAL = "bbbbb-bb-bbbbb-bb-bbbbb-bb-bbbbb-bb-bbbbb-bb";

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
function sectionsFixture(overrides: Partial<StoryRow> = {}): StoryRow[] {
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
      ...overrides,
    },
  ];
}

function renderStory() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <StoryWindow />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

/**
 * Rerender the Story window with the same QueryClient, simulating the Internet
 * Identity context updating after a successful login. The query key includes
 * the principal, so a principal change refetches the caller-relative rows.
 */
function rerenderStory(
  rerender: (ui: React.ReactElement) => void,
  queryClient: QueryClient,
) {
  rerender(
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

describe("StoryWindow in-window Internet Identity affordance", () => {
  it("shows a Sign in button when signed out and calls login() when pressed", async () => {
    const user = userEvent.setup();
    const state = signedOutState();
    mockUseInternetIdentity.mockReturnValue(state);
    renderStory();

    const signIn = screen.getByTestId("story.sign_in_button");
    expect(signIn).toBeInTheDocument();
    expect(signIn).toHaveTextContent("Sign in");

    // The signed-in controls are absent while signed out.
    expect(
      screen.queryByTestId("story.principal_indicator"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("story.sign_out_button"),
    ).not.toBeInTheDocument();

    await user.click(signIn);
    expect(state.login).toHaveBeenCalledTimes(1);
  });

  it("shows the principal indicator and Sign out control when signed in, and calls clear()", async () => {
    const user = userEvent.setup();
    const state = signedInState(OTHER_PRINCIPAL);
    mockUseInternetIdentity.mockReturnValue(state);
    renderStory();

    // The sign-in button is gone; the identity indicator and sign-out appear.
    expect(
      screen.queryByTestId("story.sign_in_button"),
    ).not.toBeInTheDocument();
    const indicator = screen.getByTestId("story.principal_indicator");
    expect(indicator).toBeInTheDocument();
    // The indicator carries the full principal as its title.
    expect(indicator).toHaveAttribute("title", OTHER_PRINCIPAL);

    const signOut = screen.getByTestId("story.sign_out_button");
    expect(signOut).toHaveTextContent("Sign out");
    await user.click(signOut);
    expect(state.clear).toHaveBeenCalledTimes(1);
  });

  it("keeps the sign-in affordance reachable while the panel is collapsed", () => {
    renderStory();

    // Collapsed by default: the body is unmounted, but the header affordance
    // is still present.
    expect(screen.getByRole("button", { name: /Story/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByTestId("story.sign_in_button")).toBeInTheDocument();
  });

  it("reflects the signed-in state immediately after signing in from the Story window", async () => {
    const user = userEvent.setup();
    // Start signed out, then flip the hook to signed in and rerender, which is
    // what the Internet Identity context does on a successful login.
    const signedOut = signedOutState();
    mockUseInternetIdentity.mockReturnValue(signedOut);
    const { rerender, queryClient } = renderStory();

    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);
    // The live section lives on page 2 under the accepted pagination model.
    await user.click(
      screen.getByRole("button", { name: "Next page of story sections" }),
    );

    // Signed out: the prompt is shown and the controls are disabled.
    expect(
      screen.getByText(
        "Sign in with Internet Identity to press Delete or Keep.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("story.delete_button.1")).toBeDisabled();

    // The login flow succeeds and the context now reports the signed-in
    // principal.
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    rerenderStory(rerender, queryClient);

    // The window reflects the signed-in state immediately: sign-in button
    // gone, principal indicator present, controls enabled, prompt gone.
    await waitFor(() => {
      expect(
        screen.queryByTestId("story.sign_in_button"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("story.principal_indicator")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("story.delete_button.1")).toBeEnabled();
    });
    expect(
      screen.queryByText(
        "Sign in with Internet Identity to press Delete or Keep.",
      ),
    ).not.toBeInTheDocument();
  });
});

describe("StoryWindow vote state follows the current principal", () => {
  it("does not leak a previous principal's vote lock to a newly signed-in principal", async () => {
    const user = userEvent.setup();
    // The first principal has already voted on section 1, so its fetch reports
    // the caller-relative lock.
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    getStorySections.mockResolvedValue(
      sectionsFixture({ hasVotedDelete: true, deleteCount: 3n }),
    );
    const { rerender, queryClient } = renderStory();

    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);
    // The live section lives on page 2 under the accepted pagination model.
    await user.click(
      screen.getByRole("button", { name: "Next page of story sections" }),
    );

    // The first principal sees the locked, already-voted state.
    await waitFor(() => {
      expect(screen.getByTestId("story.delete_button.1")).toBeDisabled();
    });
    expect(screen.getByTestId("story.delete_button.1")).toHaveTextContent(
      "Delete · voted",
    );

    // A different principal signs in. Its caller-relative fetch reports no
    // vote, so the controls must be enabled again — the previous principal's
    // lock must not leak.
    mockUseInternetIdentity.mockReturnValue(signedInState(SECOND_PRINCIPAL));
    getStorySections.mockResolvedValue(sectionsFixture());
    rerenderStory(rerender, queryClient);

    await waitFor(() => {
      expect(screen.getByTestId("story.delete_button.1")).toBeEnabled();
    });
    expect(screen.getByTestId("story.delete_button.1")).toHaveTextContent(
      "Delete",
    );
    expect(screen.getByTestId("story.keep_button.1")).toBeEnabled();
  });

  it("keeps the writer composer gated on the exact writer principal after sign-in", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    renderStory();

    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    expect(screen.getByText("Add a new section")).toBeInTheDocument();
    expect(screen.getByTestId("story.principal_indicator")).toBeInTheDocument();
  });
});
