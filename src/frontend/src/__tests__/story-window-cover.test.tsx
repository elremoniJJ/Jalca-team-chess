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
 * Cover for the collapsible Story window that replaced the temporary Internet
 * Identity window at the bottom of the game page.
 *
 * What is covered (component/integration, no real canister):
 *   - the window is collapsed by default and its body is UNMOUNTED while
 *     collapsed, so no story request runs until the panel is opened;
 *   - opening the panel fetches the sections exactly once and renders the
 *     Forever section first with the JALCA story text and NO buttons;
 *   - the collapse state persists to localStorage ("tco-story-open") and is
 *     restored on remount (survives a reload);
 *   - a non-writer signed in with Internet Identity sees no composer and no
 *     gap-fill control, and the Delete/Keep buttons are enabled;
 *   - the hardcoded writer principal sees the composer and can add a section;
 *   - a deleted section renders as a visible gap placeholder, and the writer
 *     can fill it with new text;
 *   - the Info button explains how the story can be affected externally.
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

const FOREVER_TEXT =
  'Can you think of a short story about a medieval fool named JALCA who dressed up like a wizard, played chess against the king and blatantly cheated by knocking the king\'s horses off the board. The king was outraged, and asked "Why did you do that you stupid fool?"\n\n' +
  'The fool answered, "Tis magic m\'lord. I wield the magic of surprise."\n\n' +
  'The king, even more enraged, pulled out a sword and chopped off JALCA\'s head. "Surprise, JALCA, you fool", the king exclaimed.\n\n' +
  "As JALCA's body slumped to the floor, and his head rolled to a stop, the king added, \"It's not a terrible idea though.\"\n\n" +
  'The real surprise then occurred as JALCA\'s head, motionless, somehow sputtered, "Probably better if we just played online".\n\n' +
  '"What sorcery is this? Damn you head, riddled with the dark arts!" The king shouted, and kicked the head across the court.\n\n' +
  'The head flew, losing its wizard hat, and struck the stone wall, cracking the skull. As it hit the floor, the king walked to it and kneeled down. "What do you have to say now, my bloody funny friend?"\n\n' +
  'Once again to his surprise, the lips moved, "...';

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

/**
 * Open the Story window and page forward to the first page that holds the
 * non-Forever sections. Under the accepted model the Forever section renders
 * alone on page 1, so the live and deleted sections live on page 2.
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

describe("StoryWindow collapse and lazy loading", () => {
  it("is collapsed by default and does not fetch the story until opened", async () => {
    const user = userEvent.setup();
    renderStory();

    const header = screen.getByRole("button", { name: /Story/ });
    expect(header).toHaveAttribute("aria-expanded", "false");

    // Collapsed: the body is unmounted and no story request has run.
    expect(screen.queryByText(FOREVER_TEXT)).not.toBeInTheDocument();
    expect(getStorySections).not.toHaveBeenCalled();

    // Opening the panel fetches the sections exactly once.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(getStorySections).toHaveBeenCalledTimes(1);
    });
    const paragraph = await findForeverParagraph(
      document.querySelector('[data-ocid="story_window"]') as HTMLElement,
    );
    expect(paragraph.textContent).toBe(FOREVER_TEXT);
  });

  it("persists the open state and restores it on remount (survives a reload)", async () => {
    const user = userEvent.setup();
    const first = renderStory();

    await user.click(screen.getByRole("button", { name: /Story/ }));
    expect(window.localStorage.getItem("tco-story-open")).toBe("true");

    // Remount simulates a page refresh: the open state is restored and the
    // story is fetched again.
    first.unmount();
    renderStory();
    expect(screen.getByRole("button", { name: /Story/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await waitFor(() => {
      expect(getStorySections).toHaveBeenCalled();
    });
  });

  it("restores a collapsed state written by a previous session", () => {
    window.localStorage.setItem("tco-story-open", "false");
    renderStory();

    expect(screen.getByRole("button", { name: /Story/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(getStorySections).not.toHaveBeenCalled();
  });
});

describe("StoryWindow Forever section", () => {
  it("renders the Forever section first with the JALCA text and no buttons", async () => {
    const user = userEvent.setup();
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    const paragraph = await findForeverParagraph(container);
    expect(paragraph.textContent).toBe(FOREVER_TEXT);

    // The Forever section is the first section in the ordered list.
    const firstSection = container.querySelector(
      '[data-ocid="story.section.1"]',
    );
    expect(firstSection).not.toBeNull();
    expect(
      firstSection?.querySelector('[data-ocid="story.forever_section"]'),
    ).not.toBeNull();

    // No Delete/Keep buttons and no counters inside the Forever section.
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

describe("StoryWindow writer gating", () => {
  it("shows no composer to a non-writer signed in with Internet Identity", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await findForeverParagraph(container);
    expect(screen.queryByText("Add a new section")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add section/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the composer to the hardcoded writer principal and adds a section", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    const { container } = renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await findForeverParagraph(container);
    const composer = screen.getByText("Add a new section");
    expect(composer).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("Continue the story…");
    await user.type(textarea, "A new chapter.");
    await user.click(screen.getByRole("button", { name: /Add section/ }));

    await waitFor(() => {
      expect(appendStorySection).toHaveBeenCalledWith("A new chapter.");
    });
  });

  it("disables the Delete and Keep buttons when signed out", async () => {
    const user = userEvent.setup();
    renderStory();
    await openStoryOnLivePage(user);

    // The appended section (index 1) carries the voting controls.
    expect(screen.getByRole("button", { name: /Delete/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Keep/ })).toBeDisabled();
  });

  it("enables the Delete and Keep buttons for a signed-in viewer", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    renderStory();
    await openStoryOnLivePage(user);

    expect(screen.getByRole("button", { name: /Delete/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Keep/ })).toBeEnabled();
  });
});

describe("StoryWindow deleted gap", () => {
  it("renders a deleted section as a visible gap and lets the writer fill it", async () => {
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

    // The gap placeholder is visible.
    expect(
      await screen.findByText("This section was removed and awaits rewriting."),
    ).toBeInTheDocument();

    // The writer can fill the gap with new text.
    const textarea = screen.getByPlaceholderText("Rewrite this section…");
    await user.type(textarea, "Wilkin returned.");
    await user.click(screen.getByRole("button", { name: /Fill this gap/ }));

    await waitFor(() => {
      expect(fillStoryGap).toHaveBeenCalledWith(1n, "Wilkin returned.");
    });
  });

  it("does not offer a gap-fill control to a non-writer", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
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

    await screen.findByText("This section was removed and awaits rewriting.");
    expect(
      screen.queryByPlaceholderText("Rewrite this section…"),
    ).not.toBeInTheDocument();
  });
});

describe("StoryWindow Info content", () => {
  it("explains how the story can be affected externally", async () => {
    const user = userEvent.setup();
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));

    await user.click(
      screen.getByRole("button", { name: "Toggle story information" }),
    );

    expect(
      screen.getByText("How the story can be affected"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /A section is only removed once its Delete count reaches/,
      ),
    ).toBeInTheDocument();
  });
});
