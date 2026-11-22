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

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted Story success paths that the backend array-growth fix
 * unblocks:
 *
 *   1. adding a new story section succeeds instead of trapping with an array
 *      index out of bounds error;
 *   2. the first Delete or Keep press on a story section succeeds instead of
 *      trapping with the same error.
 *
 * The backend fix (reassigning the grown `[var StorySection]` / `[var Principal]`
 * array instead of copying element-by-element into the original size-N array)
 * is real backend behavior and is the PocketIC lane's job. The lane skips in
 * this project (`no_backend_wasm`), and the hardcoded sole-writer principal
 * cannot be produced from a seed, so the positive writer append path cannot be
 * exercised there either. What this file proves is the FRONTEND half of the
 * accepted behavior: through the real StoryWindow component and the real
 * use-story hooks, a successful append / first Delete / first Keep resolves,
 * the invalidated refetch returns the grown list / incremented counters, and
 * the UI renders that new state with NO error surface.
 *
 * The actor is a typed local mock (no real canister, no network), so this file
 * proves the frontend consumer contract only. It would pass identically against
 * a backend whose append/vote methods are unimplemented stubs that trap at
 * runtime — that is exactly why the PocketIC lane exists and why its skip is
 * recorded as a coverage limit.
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

const FOREVER_TEXT = "Forever placeholder text.";

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
  mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
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

describe("StoryWindow append success", () => {
  it("adds a section and renders the grown list with no error surface", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));

    // First fetch (on open) has two sections; the invalidated refetch after the
    // successful append returns the grown list with the new section at index 2.
    getStorySections
      .mockResolvedValueOnce(sectionsFixture())
      .mockResolvedValue([
        ...sectionsFixture(),
        {
          index: 2n,
          text: "A new chapter.",
          deleteCount: 0n,
          keepCount: 0n,
          deleted: false,
          hasVotedDelete: false,
          hasVotedKeep: false,
        },
      ]);

    const { container } = renderStory();
    await openStoryOnLivePage(user);

    await user.type(
      screen.getByPlaceholderText("Continue the story…"),
      "A new chapter.",
    );
    await user.click(screen.getByRole("button", { name: /Add section/ }));

    // The append reaches the backend with the exact text and resolves.
    await waitFor(() => {
      expect(appendStorySection).toHaveBeenCalledWith("A new chapter.");
    });

    // The invalidated refetch returns the grown list and the UI renders the new
    // section — the append succeeded rather than trapping.
    await waitFor(() => {
      expect(
        container.querySelector('[data-ocid="story.section.3"]'),
      ).not.toBeNull();
    });
    expect(screen.getByText("A new chapter.")).toBeInTheDocument();

    // No error surface is shown for a successful append.
    expect(
      container.querySelector('[data-ocid="story.add_section_error"]'),
    ).toBeNull();
  });
});

describe("StoryWindow first Delete/Keep success", () => {
  it("records the first Delete press and renders the incremented counter with no error", async () => {
    const user = userEvent.setup();

    // First fetch reports no vote; the invalidated refetch after the successful
    // press reports the caller's own vote and the incremented counter.
    getStorySections
      .mockResolvedValueOnce(sectionsFixture())
      .mockResolvedValue([
        sectionsFixture()[0],
        {
          index: 1n,
          text: "Wilkin met a travelling juggler.",
          deleteCount: 3n,
          keepCount: 1n,
          deleted: false,
          hasVotedDelete: true,
          hasVotedKeep: false,
        },
      ]);

    const { container } = renderStory();
    await openStoryOnLivePage(user);

    const deleteButton = container.querySelector(
      '[data-ocid="story.delete_button.1"]',
    );
    expect(deleteButton).not.toBeNull();
    await user.click(deleteButton as HTMLElement);

    // The first press reaches the backend with the section index and resolves.
    await waitFor(() => {
      expect(pressStoryDelete).toHaveBeenCalledWith(1n);
    });

    // The refetched counter reflects the successful press (2 -> 3) and the
    // control locks, so the first press succeeded rather than trapping.
    await waitFor(() => {
      const counters = container.querySelector(
        '[data-ocid="story.counters.1"]',
      );
      expect(counters?.textContent).toContain("Delete 3");
    });
    await waitFor(() => {
      expect(
        container.querySelector('[data-ocid="story.delete_button.1"]'),
      ).toBeDisabled();
    });
  });

  it("records the first Keep press and renders the incremented counter with no error", async () => {
    const user = userEvent.setup();

    getStorySections
      .mockResolvedValueOnce(sectionsFixture())
      .mockResolvedValue([
        sectionsFixture()[0],
        {
          index: 1n,
          text: "Wilkin met a travelling juggler.",
          deleteCount: 2n,
          keepCount: 2n,
          deleted: false,
          hasVotedDelete: false,
          hasVotedKeep: true,
        },
      ]);

    const { container } = renderStory();
    await openStoryOnLivePage(user);

    const keepButton = container.querySelector(
      '[data-ocid="story.keep_button.1"]',
    );
    expect(keepButton).not.toBeNull();
    await user.click(keepButton as HTMLElement);

    await waitFor(() => {
      expect(pressStoryKeep).toHaveBeenCalledWith(1n);
    });

    // The refetched counter reflects the successful press (1 -> 2) and the
    // control locks, so the first press succeeded rather than trapping.
    await waitFor(() => {
      const counters = container.querySelector(
        '[data-ocid="story.counters.1"]',
      );
      expect(counters?.textContent).toContain("Keep 2");
    });
    await waitFor(() => {
      expect(
        container.querySelector('[data-ocid="story.keep_button.1"]'),
      ).toBeDisabled();
    });
  });
});
