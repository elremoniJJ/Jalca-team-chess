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
 * Characterization of the Story window's EXISTING sectioned display and
 * Delete/Keep wiring, taken BEFORE the request changes voting to
 * one-vote-per-principal.
 *
 * The request intentionally changes:
 *   1. `pressStoryDelete` / `pressStoryKeep` from unlimited global presses to
 *      at most one press per signed-in principal per section;
 *   2. the Forever section text to the user's exact JALCA medieval-fool text;
 *   3. deleted sections to reset their counters and clear recorded votes.
 *
 * Those three things are intentional, so this file deliberately does NOT
 * assert the current unlimited-press behavior, does NOT pin the current Forever
 * text, and does NOT freeze the counters of a deleted section. What it protects
 * is the behavior ADJACENT to the change that must survive it:
 *
 *   - the sectioned display renders every live section in order, each with its
 *     own Delete/Keep controls and its own counters;
 *   - the counters render the section's deleteCount and keepCount values;
 *   - pressing Delete calls `pressStoryDelete` with that section's index, and
 *     pressing Keep calls `pressStoryKeep` with that section's index;
 *   - the Forever section (position 0) still renders with no controls and no
 *     counters;
 *   - a signed-out viewer still cannot press Delete or Keep.
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

const OTHER_PRINCIPAL = "aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa";

// The current Forever text is intentionally being replaced, so this file only
// needs a stable placeholder for position 0 — it never asserts the text.
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

/** The Forever section plus two live appended sections with distinct counters. */
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
    {
      index: 2n,
      text: "The juggler taught him to juggle bells.",
      deleteCount: 7n,
      keepCount: 4n,
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

/**
 * Open the Story window and page forward to the first page that holds the live
 * sections. Under the accepted model the Forever section renders alone on page
 * 1, so the live sections live on page 2.
 */
async function openStoryOnLivePage(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: /Story/ }));
  await screen.findByText(FOREVER_TEXT);
  await user.click(
    screen.getByRole("button", { name: "Next page of story sections" }),
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

describe("StoryWindow sectioned display", () => {
  it("renders every live section in order with its own counters", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    // The two live sections are rendered in the order the backend returned
    // them, on the page after the Forever section.
    const sections = container.querySelectorAll(
      '[data-ocid^="story.section."]',
    );
    expect(sections).toHaveLength(2);

    // The two live appended sections each carry their own counters.
    const counters1 = container.querySelector('[data-ocid="story.counters.1"]');
    const counters2 = container.querySelector('[data-ocid="story.counters.2"]');
    expect(counters1).not.toBeNull();
    expect(counters2).not.toBeNull();
    expect(counters1?.textContent).toContain("Delete 2");
    expect(counters1?.textContent).toContain("Keep 1");
    expect(counters2?.textContent).toContain("Delete 7");
    expect(counters2?.textContent).toContain("Keep 4");

    // The Forever section (position 0) has no counters.
    expect(
      container.querySelector('[data-ocid="story.counters.0"]'),
    ).toBeNull();
  });

  it("renders the Forever section with no Delete/Keep controls", async () => {
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
      foreverScope.queryByRole("button", { name: /Delete/ }),
    ).not.toBeInTheDocument();
    expect(
      foreverScope.queryByRole("button", { name: /Keep/ }),
    ).not.toBeInTheDocument();
  });
});

describe("StoryWindow Delete/Keep wiring", () => {
  it("calls pressStoryDelete with the pressed section's index", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    // Section index 1's Delete button.
    const delete1 = container.querySelector(
      '[data-ocid="story.delete_button.1"]',
    );
    expect(delete1).not.toBeNull();
    await user.click(delete1 as HTMLElement);

    await waitFor(() => {
      expect(pressStoryDelete).toHaveBeenCalledWith(1n);
    });
  });

  it("calls pressStoryKeep with the pressed section's index", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    const keep1 = container.querySelector('[data-ocid="story.keep_button.1"]');
    expect(keep1).not.toBeNull();
    await user.click(keep1 as HTMLElement);

    await waitFor(() => {
      expect(pressStoryKeep).toHaveBeenCalledWith(1n);
    });
  });

  it("targets the correct section when a later section's Delete is pressed", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    const delete2 = container.querySelector(
      '[data-ocid="story.delete_button.2"]',
    );
    expect(delete2).not.toBeNull();
    await user.click(delete2 as HTMLElement);

    await waitFor(() => {
      expect(pressStoryDelete).toHaveBeenCalledWith(2n);
    });
  });

  it("does not call the backend when a signed-out viewer presses Delete", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    // The controls are disabled for a signed-out viewer, so a click is a no-op.
    const deleteButton = container.querySelector(
      '[data-ocid="story.delete_button.1"]',
    );
    expect(deleteButton).not.toBeNull();
    expect(deleteButton).toBeDisabled();
    await user.click(deleteButton as HTMLElement);
    expect(pressStoryDelete).not.toHaveBeenCalled();
  });
});
