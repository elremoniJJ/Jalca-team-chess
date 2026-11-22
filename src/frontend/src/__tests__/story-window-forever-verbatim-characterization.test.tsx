import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Story window's Forever-section rendering MECHANISM,
 * taken BEFORE the request replaces the Forever section text with a new
 * verbatim text.
 *
 * The request intentionally changes the Forever section's wording. That wording
 * is therefore NOT pinned here — this file deliberately uses a distinctive
 * placeholder string and never asserts the current "Wilkin" text. What it
 * protects is the behavior ADJACENT to the change that must survive it:
 *
 *   - the Forever section (position 0) renders the text the backend returns
 *     VERBATIM, character-for-character — no trimming, no collapsing of
 *     whitespace, no truncation, no AI rewriting, no HTML escaping of the
 *     literal characters;
 *   - the Forever section is always the first section in the ordered list;
 *   - the Forever section carries no Delete/Keep controls and no counters,
 *     regardless of the text it holds.
 *
 * The backend actor is a typed local mock (no real canister, no network), so
 * this file proves the frontend consumer contract only. The real backend
 * seeding of the Forever text is the PocketIC lane's job.
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

/**
 * A distinctive placeholder that is intentionally NOT the current Forever
 * wording. The requirement is that whatever text the backend supplies is shown
 * character-for-character, so the assertion must hold for any text — including
 * one that differs from the text being replaced.
 *
 * It deliberately contains leading/trailing spaces, a double space, a newline,
 * and punctuation that a rewriting or trimming layer would alter.
 */
const VERBATIM_TEXT =
  "  First line with  a double space.\nSecond line — em dash, ellipsis… and 'quotes'.  ";

/** The sole writer/editor principal, hardcoded in the backend and frontend. */
const WRITER_PRINCIPAL =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae";

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

/** The Forever section (position 0) plus one live appended section. */
function sectionsFixture(foreverText: string): StoryRow[] {
  return [
    {
      index: 0n,
      text: foreverText,
      deleteCount: 0n,
      keepCount: 0n,
      deleted: false,
      hasVotedDelete: false,
      hasVotedKeep: false,
    },
    {
      index: 1n,
      text: "An appended section.",
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
  getStorySections.mockResolvedValue(sectionsFixture(VERBATIM_TEXT));
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

/**
 * The Forever section's text paragraph. Testing Library's text queries
 * normalize whitespace, so a verbatim assertion cannot go through
 * `getByText`; the paragraph is located structurally and its `textContent`
 * compared exactly instead.
 */
function foreverTextParagraph(container: HTMLElement): HTMLElement {
  const forever = container.querySelector(
    '[data-ocid="story.forever_section"]',
  );
  expect(forever).not.toBeNull();
  const paragraph = forever?.querySelector("p:last-of-type");
  expect(paragraph).not.toBeNull();
  return paragraph as HTMLElement;
}

describe("StoryWindow Forever section renders the backend text verbatim", () => {
  it("shows the exact text the backend returned, character-for-character", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    // Wait for the section list to render before reading the paragraph.
    await screen.findByText("Forever");

    const paragraph = foreverTextParagraph(container);

    // The rendered text is byte-identical to the backend value: no trimming,
    // no whitespace collapsing, no truncation, no rewriting.
    expect(paragraph.textContent).toBe(VERBATIM_TEXT);
    expect(paragraph.textContent).toHaveLength(VERBATIM_TEXT.length);

    // The Forever section is the first section in the ordered list.
    const firstSection = container.querySelector(
      '[data-ocid="story.section.1"]',
    );
    expect(firstSection).not.toBeNull();
    expect(
      firstSection?.querySelector('[data-ocid="story.forever_section"]'),
    ).not.toBeNull();
  });

  it("keeps the Forever section free of controls and counters for any text", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await screen.findByText("Forever");

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

  it("offers no edit path inside the Forever section, even to the writer", async () => {
    const user = userEvent.setup();
    // The writer principal is the only caller who ever sees edit controls
    // anywhere in the window, so it is the strongest case for "no edit path".
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await screen.findByText("Forever");

    const firstSection = container.querySelector(
      '[data-ocid="story.section.1"]',
    );
    expect(firstSection).not.toBeNull();
    const foreverScope = within(firstSection as HTMLElement);

    // No editable control of any kind lives inside the Forever section.
    expect(foreverScope.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      firstSection?.querySelector("textarea, input, [contenteditable='true']"),
    ).toBeNull();

    // The writer composer exists elsewhere in the window (so the writer is
    // genuinely signed in), but it is not inside the Forever section.
    expect(screen.getByText("Add a new section")).toBeInTheDocument();
    expect(
      foreverScope.queryByText("Add a new section"),
    ).not.toBeInTheDocument();
  });
});
