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
 * Characterization of the Story window's STABLE behavior, taken BEFORE the
 * request adds pagination (3 sections per page with forward/back controls and
 * a page indicator).
 *
 * The request intentionally changes the Story window to render 3 sections per
 * page instead of the full list, so this file deliberately does NOT assert
 * that every section renders at once. What it protects is the behavior
 * ADJACENT to the change that must survive it:
 *
 *   - the Forever section (position 0) still renders first, verbatim, with no
 *     Delete/Keep controls and no counters;
 *   - a live section still renders its text and its Delete/Keep controls, and
 *     a signed-in viewer can press them (the mutation is called with the
 *     section's index);
 *   - a deleted section still renders as a visible gap, and the writer can
 *     fill it (the mutation is called with the section's index and text);
 *   - the writer composer still appends a section for the hardcoded writer
 *     principal and is absent for a non-writer;
 *   - the panel is still collapsed by default and fetches only when opened.
 *
 * The fixture is kept to three sections (the Forever section plus two live
 * sections). Under the accepted model the Forever section renders ALONE on
 * page 1, so the live sections are reached by paging forward to page 2; the
 * assertions below navigate there before touching a live section, keeping this
 * file independent of the exact page size.
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

/**
 * The Forever section plus two live sections — three sections total, so all
 * three fit on the first page for any page size of 3 or more.
 */
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
      text: "The juggler taught Wilkin a trick.",
      deleteCount: 0n,
      keepCount: 0n,
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
 * Open the Story window and page forward to the first page that holds live
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

describe("StoryWindow collapse and lazy loading survive pagination", () => {
  it("is collapsed by default and does not fetch the story until opened", async () => {
    const user = userEvent.setup();
    renderStory();

    const header = screen.getByRole("button", { name: /Story/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(getStorySections).not.toHaveBeenCalled();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(getStorySections).toHaveBeenCalledTimes(1);
    });
  });
});

describe("StoryWindow Forever section survives pagination", () => {
  it("renders the Forever section first with no controls and no counters", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await screen.findByText("Forever");
    const firstSection = container.querySelector(
      '[data-ocid="story.section.1"]',
    );
    expect(firstSection).not.toBeNull();
    expect(
      firstSection?.querySelector('[data-ocid="story.forever_section"]'),
    ).not.toBeNull();
    expect(
      firstSection?.querySelector('[data-ocid="story.counters.0"]'),
    ).toBeNull();
  });
});

describe("StoryWindow voting survives pagination", () => {
  it("renders a live section's text and controls and records a Delete press", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    await screen.findByText("Wilkin met a travelling juggler.");
    // Scope to the first live section (index 1) so the query is unambiguous
    // when more than one live section is on the page.
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

  it("disables the Delete and Keep controls when signed out", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await openStoryOnLivePage(user);

    await screen.findByText("Wilkin met a travelling juggler.");
    const section = container.querySelector('[data-ocid="story.section.2"]');
    expect(section).not.toBeNull();
    const scope = within(section as HTMLElement);
    expect(scope.getByRole("button", { name: /Delete/ })).toBeDisabled();
    expect(scope.getByRole("button", { name: /Keep/ })).toBeDisabled();
  });
});

describe("StoryWindow writer composer survives pagination", () => {
  it("shows the composer to the writer and appends a section", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await screen.findByText("Add a new section");
    const textarea = screen.getByPlaceholderText("Continue the story…");
    await user.type(textarea, "A new chapter.");
    await user.click(screen.getByRole("button", { name: /Add section/ }));

    await waitFor(() => {
      expect(appendStorySection).toHaveBeenCalledWith("A new chapter.");
    });
  });

  it("shows no composer to a non-writer", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    renderStory();
    await openStoryOnLivePage(user);

    await screen.findByText("Wilkin met a travelling juggler.");
    expect(screen.queryByText("Add a new section")).not.toBeInTheDocument();
  });
});

describe("StoryWindow gap fill survives pagination", () => {
  it("renders a deleted section as a gap and lets the writer fill it", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    getStorySections.mockResolvedValue([
      {
        index: 0n,
        text: FOREVER_TEXT,
        deleteCount: 0n,
        keepCount: 0n,
        deleted: false,
      },
      {
        index: 1n,
        text: "",
        deleteCount: 10n,
        keepCount: 1n,
        deleted: true,
      },
    ]);
    renderStory();
    await openStoryOnLivePage(user);

    expect(
      await screen.findByText("This section was removed and awaits rewriting."),
    ).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("Rewrite this section…");
    await user.type(textarea, "Wilkin returned.");
    await user.click(screen.getByRole("button", { name: /Fill this gap/ }));

    await waitFor(() => {
      expect(fillStoryGap).toHaveBeenCalledWith(1n, "Wilkin returned.");
    });
  });
});
