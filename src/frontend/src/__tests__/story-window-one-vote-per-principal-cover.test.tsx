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
 * Cover for the Story window's one-vote-per-principal UI contract.
 *
 * The accepted behavior this file asserts in the frontend:
 *   - a section whose caller-relative `hasVotedDelete` / `hasVotedKeep` flag is
 *     set renders its Delete/Keep controls in a disabled, already-voted state
 *     and shows the "You've already voted on this section." note;
 *   - a signed-in user pressing Delete once calls `pressStoryDelete` with that
 *     section's index, and after the invalidated refetch returns the voted
 *     state the control is disabled so a second press does not call the
 *     backend again;
 *   - the same for Keep;
 *   - the Forever section (position 0) renders the exact JALCA medieval-fool
 *     text character-for-character with no Delete/Keep controls and no
 *     counters;
 *   - a deleted section renders as a gap with no counters and no vote controls.
 *
 * The backend actor is a typed local mock (no real canister, no network), so
 * this file proves the frontend consumer contract only. The real backend rule
 * (a repeat press from the same principal is rejected server-side) is the
 * PocketIC lane's job; it cannot be exercised there because the hardcoded sole
 * writer principal cannot be produced from a seed, so no live section can be
 * created in the lane. That is a coverage limit, not a passing assertion.
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

/**
 * The exact JALCA medieval-fool text. Duplicated here on purpose so a rewrite
 * or truncation of the Forever section fails this assertion. The blank lines
 * between paragraphs and the trailing ellipsis are part of the accepted text.
 */
const FOREVER_TEXT =
  'Can you think of a short story about a medieval fool named JALCA who dressed up like a wizard, played chess against the king and blatantly cheated by knocking the king\'s horses off the board. The king was outraged, and asked "Why did you do that you stupid fool?"\n\n' +
  'The fool answered, "Tis magic m\'lord. I wield the magic of surprise."\n\n' +
  'The king, even more enraged, pulled out a sword and chopped off JALCA\'s head. "Surprise, JALCA, you fool", the king exclaimed.\n\n' +
  "As JALCA's body slumped to the floor, and his head rolled to a stop, the king added, \"It's not a terrible idea though.\"\n\n" +
  'The real surprise then occurred as JALCA\'s head, motionless, somehow sputtered, "Probably better if we just played online".\n\n' +
  '"What sorcery is this? Damn you head, riddled with the dark arts!" The king shouted, and kicked the head across the court.\n\n' +
  'The head flew, losing its wizard hat, and struck the stone wall, cracking the skull. As it hit the floor, the king walked to it and kneeled down. "What do you have to say now, my bloody funny friend?"\n\n' +
  'Once again to his surprise, the lips moved, "...';

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

/** A live section with the given caller-relative vote flags. */
function liveSection(overrides: Partial<StoryRow> = {}): StoryRow {
  return {
    index: 1n,
    text: "Wilkin met a travelling juggler.",
    deleteCount: 2n,
    keepCount: 1n,
    deleted: false,
    hasVotedDelete: false,
    hasVotedKeep: false,
    ...overrides,
  };
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
  await screen.findByText("Forever");
  await user.click(
    screen.getByRole("button", { name: "Next page of story sections" }),
  );
}

/**
 * Wait for the Forever section to render and return its text paragraph.
 *
 * The Forever text now contains blank lines between paragraphs, and Testing
 * Library's text queries normalize whitespace, so `findByText(FOREVER_TEXT)`
 * cannot match it. The paragraph is located structurally and its `textContent`
 * compared exactly instead.
 */
async function findForeverParagraph(
  container: HTMLElement,
): Promise<HTMLElement> {
  await waitFor(() => {
    expect(
      container.querySelector('[data-ocid="story.forever_section"]'),
    ).not.toBeNull();
  });
  const forever = container.querySelector(
    '[data-ocid="story.forever_section"]',
  );
  const paragraph = forever?.querySelector("p:last-of-type");
  expect(paragraph).not.toBeNull();
  return paragraph as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
  mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
  getStorySections.mockResolvedValue([
    {
      index: 0n,
      text: FOREVER_TEXT,
      deleteCount: 0n,
      keepCount: 0n,
      deleted: false,
      hasVotedDelete: false,
      hasVotedKeep: false,
    },
    liveSection(),
  ]);
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

describe("StoryWindow already-voted state", () => {
  it("renders Delete in a disabled, already-voted state when hasVotedDelete is set", async () => {
    const user = userEvent.setup();
    getStorySections.mockResolvedValue([
      {
        index: 0n,
        text: FOREVER_TEXT,
        deleteCount: 0n,
        keepCount: 0n,
        deleted: false,
        hasVotedDelete: false,
        hasVotedKeep: false,
      },
      liveSection({ hasVotedDelete: true }),
    ]);
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    const deleteButton = container.querySelector(
      '[data-ocid="story.delete_button.1"]',
    );
    expect(deleteButton).not.toBeNull();
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveTextContent("Delete · voted");
    expect(deleteButton).toHaveAttribute("aria-pressed", "true");

    // Both controls lock once the caller has voted on the section.
    const keepButton = container.querySelector(
      '[data-ocid="story.keep_button.1"]',
    );
    expect(keepButton).toBeDisabled();

    expect(
      container.querySelector('[data-ocid="story.voted_state.1"]'),
    ).not.toBeNull();
  });

  it("renders Keep in a disabled, already-voted state when hasVotedKeep is set", async () => {
    const user = userEvent.setup();
    getStorySections.mockResolvedValue([
      {
        index: 0n,
        text: FOREVER_TEXT,
        deleteCount: 0n,
        keepCount: 0n,
        deleted: false,
        hasVotedDelete: false,
        hasVotedKeep: false,
      },
      liveSection({ hasVotedKeep: true }),
    ]);
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    const keepButton = container.querySelector(
      '[data-ocid="story.keep_button.1"]',
    );
    expect(keepButton).not.toBeNull();
    expect(keepButton).toBeDisabled();
    expect(keepButton).toHaveTextContent("Keep · voted");
    expect(keepButton).toHaveAttribute("aria-pressed", "true");

    const deleteButton = container.querySelector(
      '[data-ocid="story.delete_button.1"]',
    );
    expect(deleteButton).toBeDisabled();
  });
});

describe("StoryWindow one press per principal", () => {
  it("calls pressStoryDelete once and then locks the control after the refetch", async () => {
    const user = userEvent.setup();
    // First fetch (on open) reports no vote; the invalidated refetch after the
    // press reports the caller's own vote, so the control locks.
    getStorySections
      .mockResolvedValueOnce([
        {
          index: 0n,
          text: FOREVER_TEXT,
          deleteCount: 0n,
          keepCount: 0n,
          deleted: false,
          hasVotedDelete: false,
          hasVotedKeep: false,
        },
        liveSection(),
      ])
      .mockResolvedValue([
        {
          index: 0n,
          text: FOREVER_TEXT,
          deleteCount: 0n,
          keepCount: 0n,
          deleted: false,
          hasVotedDelete: false,
          hasVotedKeep: false,
        },
        liveSection({ hasVotedDelete: true, deleteCount: 3n }),
      ]);

    const { container } = renderStory();
    await openStoryOnLivePage(user);

    const deleteButton = container.querySelector(
      '[data-ocid="story.delete_button.1"]',
    );
    expect(deleteButton).not.toBeNull();
    await user.click(deleteButton as HTMLElement);

    await waitFor(() => {
      expect(pressStoryDelete).toHaveBeenCalledTimes(1);
    });
    expect(pressStoryDelete).toHaveBeenCalledWith(1n);

    await waitFor(() => {
      const button = container.querySelector(
        '[data-ocid="story.delete_button.1"]',
      );
      expect(button).toBeDisabled();
    });

    // The authoritative refetch reports the incremented counter, and the UI
    // renders it: the section started at Delete 2 and now reads Delete 3.
    const counters = container.querySelector('[data-ocid="story.counters.1"]');
    expect(counters?.textContent).toContain("Delete 3");
    expect(counters?.textContent).toContain("Keep 1");

    const locked = container.querySelector(
      '[data-ocid="story.delete_button.1"]',
    );
    await user.click(locked as HTMLElement);
    expect(pressStoryDelete).toHaveBeenCalledTimes(1);
  });

  it("calls pressStoryKeep once and then locks the control after the refetch", async () => {
    const user = userEvent.setup();
    getStorySections
      .mockResolvedValueOnce([
        {
          index: 0n,
          text: FOREVER_TEXT,
          deleteCount: 0n,
          keepCount: 0n,
          deleted: false,
          hasVotedDelete: false,
          hasVotedKeep: false,
        },
        liveSection(),
      ])
      .mockResolvedValue([
        {
          index: 0n,
          text: FOREVER_TEXT,
          deleteCount: 0n,
          keepCount: 0n,
          deleted: false,
          hasVotedDelete: false,
          hasVotedKeep: false,
        },
        liveSection({ hasVotedKeep: true, keepCount: 2n }),
      ]);

    const { container } = renderStory();
    await openStoryOnLivePage(user);

    const keepButton = container.querySelector(
      '[data-ocid="story.keep_button.1"]',
    );
    expect(keepButton).not.toBeNull();
    await user.click(keepButton as HTMLElement);

    await waitFor(() => {
      expect(pressStoryKeep).toHaveBeenCalledTimes(1);
    });
    expect(pressStoryKeep).toHaveBeenCalledWith(1n);

    await waitFor(() => {
      const button = container.querySelector(
        '[data-ocid="story.keep_button.1"]',
      );
      expect(button).toBeDisabled();
    });

    // The authoritative refetch reports the incremented counter, and the UI
    // renders it: the section started at Keep 1 and now reads Keep 2.
    const counters = container.querySelector('[data-ocid="story.counters.1"]');
    expect(counters?.textContent).toContain("Keep 2");
    expect(counters?.textContent).toContain("Delete 2");

    const locked = container.querySelector('[data-ocid="story.keep_button.1"]');
    await user.click(locked as HTMLElement);
    expect(pressStoryKeep).toHaveBeenCalledTimes(1);
  });
});

describe("StoryWindow Forever section exact text", () => {
  it("renders the exact JALCA text with no controls and no counters", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    const paragraph = await findForeverParagraph(container);
    expect(paragraph.textContent).toBe(FOREVER_TEXT);

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
    expect(
      firstSection?.querySelector('[data-ocid="story.counters.0"]'),
    ).toBeNull();
  });
});

describe("StoryWindow deleted gap", () => {
  it("renders a deleted section as a gap with no counters and no vote controls", async () => {
    const user = userEvent.setup();
    getStorySections.mockResolvedValue([
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
        text: "",
        deleteCount: 0n,
        keepCount: 0n,
        deleted: true,
        hasVotedDelete: false,
        hasVotedKeep: false,
      },
    ]);
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    expect(
      await screen.findByText("This section was removed and awaits rewriting."),
    ).toBeInTheDocument();

    // A deleted section shows no counters and no Delete/Keep controls.
    expect(
      container.querySelector('[data-ocid="story.counters.1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="story.delete_button.1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="story.keep_button.1"]'),
    ).toBeNull();
  });
});
