import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Story data layer's frontend consumer contract,
 * taken BEFORE the backend's append/vote array-growth bug is fixed.
 *
 * The request intentionally changes the backend so that:
 *   1. appending a new story section succeeds instead of trapping with an
 *      array index out of bounds error;
 *   2. the first Delete or Keep press on a story section succeeds instead of
 *      trapping with the same error.
 *
 * Those two things are backend behavior and are deliberately NOT asserted
 * here. What this file protects is the behavior ADJACENT to the change that
 * must survive it — the `use-story` hook seam through which the UI reaches the
 * fixed backend:
 *
 *   - `useStorySections(enabled, caller)` calls `actor.getStorySections()` with
 *     no arguments, only while the panel is open, and exposes the returned
 *     rows unchanged;
 *   - `useAppendStorySection` calls `actor.appendStorySection(text)` with the
 *     exact text;
 *   - `usePressStoryDelete` calls `actor.pressStoryDelete(index)` with the
 *     section's index as a bigint;
 *   - `usePressStoryKeep` calls `actor.pressStoryKeep(index)` with the
 *     section's index as a bigint;
 *   - `useFillStoryGap` calls `actor.fillStoryGap(index, text)` with the exact
 *     index and text;
 *   - each successful mutation invalidates the story query so the panel
 *     refetches the authoritative section list.
 *
 * The actor is a typed local mock (no real canister, no network), so this file
 * proves the frontend consumer contract only. The real backend behavior is the
 * PocketIC lane's job.
 */

// The story hooks reach the backend through useActorState() from
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
import {
  STORY_QUERY_KEY,
  useAppendStorySection,
  useFillStoryGap,
  usePressStoryDelete,
  usePressStoryKeep,
  useStorySections,
} from "@/hooks/use-story";

/** The Forever section plus one live appended section. */
function sectionsFixture(): StoryRow[] {
  return [
    {
      index: 0n,
      text: "Forever placeholder text.",
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

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    ),
  };
}

/**
 * Render a mutation harness under a single QueryClient and return a spy on
 * that same client's `invalidateQueries`, so the assertion observes the call
 * the hook actually makes rather than a second, unrelated client.
 */
function renderMutation(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { invalidate };
}

beforeEach(() => {
  getStorySections.mockResolvedValue(sectionsFixture());
  appendStorySection.mockResolvedValue(undefined);
  fillStoryGap.mockResolvedValue(undefined);
  pressStoryDelete.mockResolvedValue(undefined);
  pressStoryKeep.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useStorySections consumer contract", () => {
  it("calls actor.getStorySections() with no arguments and exposes the rows", async () => {
    function Harness() {
      const { sections, isLoading } = useStorySections(true, "caller-1");
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="count">{sections.length}</span>
          <span data-testid="text">{sections[1]?.text ?? "none"}</span>
          <span data-testid="delete">
            {sections[1]?.deleteCount.toString() ?? "none"}
          </span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getStorySections).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("2");
    });
    // The rows are exposed unchanged: text and bigint counters survive.
    expect(screen.getByTestId("text")).toHaveTextContent(
      "Wilkin met a travelling juggler.",
    );
    expect(screen.getByTestId("delete")).toHaveTextContent("2");
  });

  it("does not call the actor while the panel is closed", async () => {
    function Harness() {
      const { sections } = useStorySections(false, "caller-1");
      return <span data-testid="count">{sections.length}</span>;
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("0");
    });
    expect(getStorySections).not.toHaveBeenCalled();
  });
});

describe("use-story mutation consumer contract", () => {
  it("useAppendStorySection calls actor.appendStorySection(text) and invalidates the story query", async () => {
    function Harness() {
      const mutation = useAppendStorySection();
      return (
        <button type="button" onClick={() => mutation.mutate("A new chapter.")}>
          append
        </button>
      );
    }
    const { invalidate } = renderMutation(<Harness />);

    screen.getByRole("button", { name: "append" }).click();

    await waitFor(() => {
      expect(appendStorySection).toHaveBeenCalledWith("A new chapter.");
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: STORY_QUERY_KEY });
    });
  });

  it("usePressStoryDelete calls actor.pressStoryDelete(index) and invalidates the story query", async () => {
    function Harness() {
      const mutation = usePressStoryDelete();
      return (
        <button type="button" onClick={() => mutation.mutate(1n)}>
          delete
        </button>
      );
    }
    const { invalidate } = renderMutation(<Harness />);

    screen.getByRole("button", { name: "delete" }).click();

    await waitFor(() => {
      expect(pressStoryDelete).toHaveBeenCalledWith(1n);
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: STORY_QUERY_KEY });
    });
  });

  it("usePressStoryKeep calls actor.pressStoryKeep(index) and invalidates the story query", async () => {
    function Harness() {
      const mutation = usePressStoryKeep();
      return (
        <button type="button" onClick={() => mutation.mutate(2n)}>
          keep
        </button>
      );
    }
    const { invalidate } = renderMutation(<Harness />);

    screen.getByRole("button", { name: "keep" }).click();

    await waitFor(() => {
      expect(pressStoryKeep).toHaveBeenCalledWith(2n);
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: STORY_QUERY_KEY });
    });
  });

  it("useFillStoryGap calls actor.fillStoryGap(index, text) and invalidates the story query", async () => {
    function Harness() {
      const mutation = useFillStoryGap();
      return (
        <button
          type="button"
          onClick={() =>
            mutation.mutate({ index: 1n, text: "Wilkin returned." })
          }
        >
          fill
        </button>
      );
    }
    const { invalidate } = renderMutation(<Harness />);

    screen.getByRole("button", { name: "fill" }).click();

    await waitFor(() => {
      expect(fillStoryGap).toHaveBeenCalledWith(1n, "Wilkin returned.");
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: STORY_QUERY_KEY });
    });
  });
});
