import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Story window's EXISTING signed-out gating, taken
 * BEFORE the request adds an Internet Identity sign-in affordance INSIDE the
 * Story window.
 *
 * The request intentionally adds a sign-in button (signed out) and a
 * principal/sign-out indicator (signed in) to the Story window. That new
 * affordance is therefore NOT asserted here. What this file protects is the
 * behavior ADJACENT to the change that must survive it:
 *
 *   - a signed-out reader still sees the existing sign-in prompt on a live
 *     section ("Sign in with Internet Identity to press Delete or Keep.") and
 *     the Delete/Keep controls remain disabled;
 *   - a signed-in reader does NOT see that signed-out prompt, and the controls
 *     are enabled;
 *   - the prompt is scoped to the live section's voting controls, not the
 *     Forever section (which has no controls at all);
 *   - the writer composer remains gated on the exact hardcoded writer
 *     principal, so adding an identity affordance does not accidentally reveal
 *     it to a non-writer.
 *
 * The backend actor is a typed local mock (no real canister, no network), so
 * this file proves the frontend consumer contract only. The real backend
 * behavior is the PocketIC lane's job.
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

// The current Forever text is not the subject of this file; a stable
// placeholder is enough for position 0.
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

describe("StoryWindow signed-out gating survives the sign-in affordance", () => {
  it("shows the sign-in prompt and disables Delete/Keep for a signed-out reader", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await screen.findByText(FOREVER_TEXT);
    // The live section lives on page 2 under the accepted pagination model.
    await user.click(
      screen.getByRole("button", { name: "Next page of story sections" }),
    );

    // The existing signed-out prompt is still shown on the live section.
    expect(
      screen.getByText(
        "Sign in with Internet Identity to press Delete or Keep.",
      ),
    ).toBeInTheDocument();

    // The controls remain disabled, so a signed-out reader cannot vote.
    const deleteButton = container.querySelector(
      '[data-ocid="story.delete_button.1"]',
    );
    const keepButton = container.querySelector(
      '[data-ocid="story.keep_button.1"]',
    );
    expect(deleteButton).toBeDisabled();
    expect(keepButton).toBeDisabled();
  });

  it("does not show the signed-out prompt to a signed-in reader", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await screen.findByText(FOREVER_TEXT);
    // The live section lives on page 2 under the accepted pagination model.
    await user.click(
      screen.getByRole("button", { name: "Next page of story sections" }),
    );

    expect(
      screen.queryByText(
        "Sign in with Internet Identity to press Delete or Keep.",
      ),
    ).not.toBeInTheDocument();

    // The controls are enabled for a signed-in reader.
    expect(
      container.querySelector('[data-ocid="story.delete_button.1"]'),
    ).toBeEnabled();
    expect(
      container.querySelector('[data-ocid="story.keep_button.1"]'),
    ).toBeEnabled();
  });

  it("keeps the signed-out prompt out of the Forever section", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await screen.findByText(FOREVER_TEXT);

    const firstSection = container.querySelector(
      '[data-ocid="story.section.1"]',
    );
    expect(firstSection).not.toBeNull();
    const foreverScope = within(firstSection as HTMLElement);
    expect(
      foreverScope.queryByText(
        "Sign in with Internet Identity to press Delete or Keep.",
      ),
    ).not.toBeInTheDocument();
  });

  it("does not reveal the writer composer to a signed-in non-writer", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await screen.findByText(FOREVER_TEXT);

    // A signed-in non-writer sees no composer.
    expect(screen.queryByText("Add a new section")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add section/ }),
    ).not.toBeInTheDocument();
  });

  it("still reveals the writer composer to the exact writer principal", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await waitFor(() => {
      expect(screen.getByText("Add a new section")).toBeInTheDocument();
    });
  });
});
