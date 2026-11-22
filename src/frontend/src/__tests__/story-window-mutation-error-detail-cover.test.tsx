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
 * Cover for the Story window's writer-mutation error surface.
 *
 * The accepted behavior this file asserts in the frontend:
 *   - when a Story append fails, the writer sees the REAL underlying failure
 *     reason (the mutation error's message) instead of the generic
 *     "Couldn't add the section. Please try again.";
 *   - when a gap fill fails, the writer sees the real reason instead of the
 *     generic "Couldn't fill this gap. Please try again.";
 *   - a plain string error is surfaced verbatim too;
 *   - the generic sentence is used ONLY as a fallback when no usable message
 *     exists (an Error with a blank message, or a non-string/non-Error value),
 *     so the error surface is never blank;
 *   - a failed append restores the writer's typed text so it is not lost.
 *
 * The backend actor is a typed local mock (no real canister, no network) and
 * the real @caffeineai/core-infrastructure InternetIdentityProvider /
 * useInternetIdentity hook is mocked, so this file proves the frontend
 * consumer contract only. The real backend is NOT exercised here.
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

const GENERIC_APPEND_ERROR = "Couldn't add the section. Please try again.";
const GENERIC_FILL_ERROR = "Couldn't fill this gap. Please try again.";
const FOREVER_TEXT = "Forever placeholder text.";

/** A signed-in hook state carrying the writer principal. */
function writerState() {
  return {
    identity: {
      getPrincipal: () => ({ toText: () => WRITER_PRINCIPAL }),
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

/** The Forever section plus one deleted section (a fillable gap). */
function gapFixture(): StoryRow[] {
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
      text: "",
      deleteCount: 10n,
      keepCount: 1n,
      deleted: true,
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
 * alone on page 1, so the deleted gap lives on page 2.
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
  mockUseInternetIdentity.mockReturnValue(writerState());
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

describe("StoryWindow append error surfaces the real failure reason", () => {
  it("shows the Error message instead of the generic sentence", async () => {
    const user = userEvent.setup();
    appendStorySection.mockRejectedValue(
      new Error("Only the Story writer may modify the Story"),
    );
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    await user.type(
      screen.getByPlaceholderText("Continue the story…"),
      "A new chapter.",
    );
    await user.click(screen.getByRole("button", { name: /Add section/ }));

    const error = await screen.findByTestId("story.add_section_error");
    expect(error).toHaveTextContent(
      "Only the Story writer may modify the Story",
    );
    expect(error).not.toHaveTextContent(GENERIC_APPEND_ERROR);
  });

  it("shows a plain string error verbatim", async () => {
    const user = userEvent.setup();
    appendStorySection.mockRejectedValue("Network request failed");
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    await user.type(
      screen.getByPlaceholderText("Continue the story…"),
      "A new chapter.",
    );
    await user.click(screen.getByRole("button", { name: /Add section/ }));

    const error = await screen.findByTestId("story.add_section_error");
    expect(error).toHaveTextContent("Network request failed");
    expect(error).not.toHaveTextContent(GENERIC_APPEND_ERROR);
  });

  it("falls back to the generic sentence when the Error message is blank", async () => {
    const user = userEvent.setup();
    appendStorySection.mockRejectedValue(new Error("   "));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    await user.type(
      screen.getByPlaceholderText("Continue the story…"),
      "A new chapter.",
    );
    await user.click(screen.getByRole("button", { name: /Add section/ }));

    const error = await screen.findByTestId("story.add_section_error");
    expect(error).toHaveTextContent(GENERIC_APPEND_ERROR);
  });

  it("restores the writer's typed text after a failed append", async () => {
    const user = userEvent.setup();
    appendStorySection.mockRejectedValue(new Error("writer gate rejected"));
    renderStory();
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    const textarea = screen.getByPlaceholderText("Continue the story…");
    await user.type(textarea, "A new chapter.");
    await user.click(screen.getByRole("button", { name: /Add section/ }));

    await screen.findByTestId("story.add_section_error");
    // The text is put back so the writer does not lose their work.
    await waitFor(() => {
      expect(textarea).toHaveValue("A new chapter.");
    });
  });
});

describe("StoryWindow gap-fill error surfaces the real failure reason", () => {
  it("shows the Error message instead of the generic sentence", async () => {
    const user = userEvent.setup();
    getStorySections.mockResolvedValue(gapFixture());
    fillStoryGap.mockRejectedValue(
      new Error("Only the Story writer may modify the Story"),
    );
    renderStory();
    await openStoryOnLivePage(user);

    await user.type(
      screen.getByPlaceholderText("Rewrite this section…"),
      "Wilkin returned.",
    );
    await user.click(screen.getByRole("button", { name: /Fill this gap/ }));

    const error = await screen.findByTestId("story.gap_fill_error.1");
    expect(error).toHaveTextContent(
      "Only the Story writer may modify the Story",
    );
    expect(error).not.toHaveTextContent(GENERIC_FILL_ERROR);
  });

  it("falls back to the generic sentence for a non-string, non-Error value", async () => {
    const user = userEvent.setup();
    getStorySections.mockResolvedValue(gapFixture());
    fillStoryGap.mockRejectedValue({ code: 500 });
    renderStory();
    await openStoryOnLivePage(user);

    await user.type(
      screen.getByPlaceholderText("Rewrite this section…"),
      "Wilkin returned.",
    );
    await user.click(screen.getByRole("button", { name: /Fill this gap/ }));

    const error = await screen.findByTestId("story.gap_fill_error.1");
    expect(error).toHaveTextContent(GENERIC_FILL_ERROR);
  });
});
