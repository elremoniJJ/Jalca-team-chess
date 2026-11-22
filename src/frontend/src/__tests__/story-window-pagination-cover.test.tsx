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
 * Cover for the accepted Story window pagination model: the Forever section
 * renders ALONE on page 1 and every page after it holds exactly 4 live
 * sections, with the final page holding the remaining 1-3 when the live count
 * is not a multiple of four.
 *
 * What is covered (component/integration, no real canister):
 *   - with the Forever section plus 4 live sections, the indicator reads
 *     "Page 1 of 2" and page 1 shows ONLY the Forever section;
 *   - Forward is enabled on page 1 and clicking it shows "Page 2 of 2" with the
 *     4 live sections;
 *   - with the Forever section plus 7 live sections, the indicator reads
 *     "Page 1 of 3" and Forward advances through page 2 (4 sections) and page 3
 *     (3 sections);
 *   - Forward is disabled only on the last page and Back is disabled only on
 *     page 1;
 *   - paging forward then back returns to the same page and sections;
 *   - a Delete press on a section visible only on a later page is recorded with
 *     that section's index;
 *   - the writer composer still appends a section while paginated.
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

const FOREVER_TEXT = "The JALCA story begins here.";

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

/** A live (non-deleted) section at the given index. */
function liveSection(index: number, text: string): StoryRow {
  return {
    index: BigInt(index),
    text,
    deleteCount: 0n,
    keepCount: 0n,
    deleted: false,
    hasVotedDelete: false,
    hasVotedKeep: false,
  };
}

/**
 * The Forever section plus four live sections — five sections total, so the
 * story spans two pages: page 1 holds the Forever section alone, page 2 holds
 * the four live sections.
 */
function fourLiveSectionsFixture(): StoryRow[] {
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
    liveSection(1, "Wilkin met a travelling juggler."),
    liveSection(2, "The juggler taught Wilkin a trick."),
    liveSection(3, "Wilkin practised the trick for a week."),
    liveSection(4, "The king heard of the trick and summoned Wilkin."),
  ];
}

/**
 * The Forever section plus seven live sections — eight sections total, so the
 * story spans three pages: page 1 holds the Forever section alone, page 2 holds
 * live sections 1-4, page 3 holds live sections 5-7.
 */
function sevenLiveSectionsFixture(): StoryRow[] {
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
    liveSection(1, "Wilkin met a travelling juggler."),
    liveSection(2, "The juggler taught Wilkin a trick."),
    liveSection(3, "Wilkin practised the trick for a week."),
    liveSection(4, "The king heard of the trick and summoned Wilkin."),
    liveSection(5, "Wilkin performed before the court."),
    liveSection(6, "The court laughed and cheered."),
    liveSection(7, "Wilkin was made the royal jester."),
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

/** Render the Story window, open the panel, and wait for the first page. */
async function openStory(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  renderStory();
  await user.click(screen.getByRole("button", { name: /Story/ }));
  await screen.findByText("Forever");
  return document.querySelector('[data-ocid="story_window"]') as HTMLElement;
}

const nextButton = () =>
  screen.getByRole("button", { name: "Next page of story sections" });
const prevButton = () =>
  screen.getByRole("button", { name: "Previous page of story sections" });

beforeEach(() => {
  window.localStorage.clear();
  mockUseInternetIdentity.mockReturnValue(signedOutState());
  getStorySections.mockResolvedValue(fourLiveSectionsFixture());
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

describe("StoryWindow pagination — Forever alone on page 1, 4 per later page", () => {
  it("shows only the Forever section on page 1 with the indicator reading Page 1 of 2", async () => {
    const user = userEvent.setup();
    const container = await openStory(user);

    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    // Page 1 holds the Forever section alone — no live section is rendered.
    expect(
      container.querySelector('[data-ocid="story.section.1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="story.forever_section"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-ocid="story.section.2"]')).toBeNull();
    expect(
      screen.queryByText("Wilkin met a travelling juggler."),
    ).not.toBeInTheDocument();
  });

  it("enables Forward on page 1 and shows the 4 live sections on page 2", async () => {
    const user = userEvent.setup();
    const container = await openStory(user);

    expect(prevButton()).toBeDisabled();
    expect(nextButton()).toBeEnabled();

    await user.click(nextButton());

    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    // All four live sections are now visible; the Forever section is not.
    expect(
      container.querySelector('[data-ocid="story.section.2"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="story.section.3"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="story.section.4"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="story.section.5"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-ocid="story.section.1"]')).toBeNull();
    expect(
      container.querySelector('[data-ocid="story.forever_section"]'),
    ).toBeNull();

    // Forward is disabled only on the last page; Back is enabled here.
    expect(nextButton()).toBeDisabled();
    expect(prevButton()).toBeEnabled();
  });

  it("derives Page 1 of 3 and pages through 4 then 3 sections with 7 live sections", async () => {
    const user = userEvent.setup();
    getStorySections.mockResolvedValue(sevenLiveSectionsFixture());
    const container = await openStory(user);

    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(prevButton()).toBeDisabled();
    expect(nextButton()).toBeEnabled();

    // Page 2 — the first four live sections.
    await user.click(nextButton());
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="story.section.2"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="story.section.5"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-ocid="story.section.6"]')).toBeNull();
    expect(nextButton()).toBeEnabled();

    // Page 3 — the remaining three live sections.
    await user.click(nextButton());
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="story.section.6"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="story.section.7"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="story.section.8"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-ocid="story.section.5"]')).toBeNull();
    expect(nextButton()).toBeDisabled();
    expect(prevButton()).toBeEnabled();
  });

  it("returns to the same page and sections after paging forward then back", async () => {
    const user = userEvent.setup();
    getStorySections.mockResolvedValue(sevenLiveSectionsFixture());
    const container = await openStory(user);

    await user.click(nextButton());
    await user.click(nextButton());
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();

    await user.click(prevButton());
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="story.section.2"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="story.section.5"]'),
    ).not.toBeNull();

    await user.click(prevButton());
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="story.forever_section"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-ocid="story.section.2"]')).toBeNull();
    expect(prevButton()).toBeDisabled();
  });

  it("falls back to the last valid page instead of rendering an empty page when the list shrinks", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    getStorySections.mockResolvedValue(sevenLiveSectionsFixture());
    const container = await openStory(user);

    // Page 3 of 3 is the last page under the 7-live-section fixture.
    await user.click(nextButton());
    await user.click(nextButton());
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();

    // The section list shrinks to the Forever section plus one live section,
    // so only two pages remain. A successful Delete press invalidates the
    // story query and refetches the shorter list; the stored page (index 2) is
    // now out of range and must clamp to the last valid page rather than
    // render nothing.
    getStorySections.mockResolvedValue(fourLiveSectionsFixture().slice(0, 2));
    const section = container.querySelector('[data-ocid="story.section.6"]');
    expect(section).not.toBeNull();
    await user.click(
      within(section as HTMLElement).getByRole("button", { name: /Delete/ }),
    );

    await waitFor(() => {
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    });

    // The clamped page still shows the one remaining live section, not an
    // empty list.
    expect(
      container.querySelector('[data-ocid="story.section.2"]'),
    ).not.toBeNull();
    expect(
      screen.queryByText("The story hasn't started yet."),
    ).not.toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
  });
});

describe("StoryWindow pagination — voting and composer still work", () => {
  it("records a Delete press on a section visible only on a later page", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    const container = await openStory(user);

    await user.click(nextButton());

    // Section index 1 is the first live section, visible only on page 2.
    const section = container.querySelector('[data-ocid="story.section.2"]');
    expect(section).not.toBeNull();
    const deleteButton = within(section as HTMLElement).getByRole("button", {
      name: /Delete/,
    });
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);

    await waitFor(() => {
      expect(pressStoryDelete).toHaveBeenCalledWith(1n);
    });
  });

  it("still appends a section for the writer while paginated", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    await openStory(user);

    const textarea = screen.getByPlaceholderText("Continue the story…");
    await user.type(textarea, "A new chapter.");
    await user.click(screen.getByRole("button", { name: /Add section/ }));

    await waitFor(() => {
      expect(appendStorySection).toHaveBeenCalledWith("A new chapter.");
    });
  });
});
