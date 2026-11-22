import "@testing-library/jest-dom/vitest";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { usePanelCollapse } from "@/hooks/use-panel-collapse";

/**
 * Characterization of the shared panel-collapse state model, taken BEFORE the
 * collapsible Story window is added at the bottom of the game page.
 *
 * The Story window is a new collapsible window and the request requires its
 * collapse state to persist across reloads. The existing Players/Moves panels
 * already persist their expand/collapse state through this hook under the
 * "tco-panel-collapse" localStorage key, and that behavior is NOT part of the
 * requested change — it must keep working.
 *
 * What is protected here:
 *   - the default state (players and moves collapsed) when nothing is stored;
 *   - toggling a panel flips only that panel and persists the whole object;
 *   - a previously persisted state is restored on mount;
 *   - a stored object carrying the existing players/moves keys is honored
 *     (so extending the state shape for a new panel must not discard the
 *     state existing users already have);
 *   - corrupt or unreadable stored JSON falls back to the default instead of
 *     throwing.
 *
 * This is a pure hook contract with no actor or network access.
 */

const STORAGE_KEY = "tco-panel-collapse";

describe("usePanelCollapse state model", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults players and moves to collapsed when nothing is stored", () => {
    const { result } = renderHook(() => usePanelCollapse());

    expect(result.current.isExpanded("players")).toBe(false);
    expect(result.current.isExpanded("moves")).toBe(false);
  });

  it("toggles a single panel and persists the whole state object", () => {
    const { result } = renderHook(() => usePanelCollapse());

    act(() => {
      result.current.toggle("players");
    });

    expect(result.current.isExpanded("players")).toBe(true);
    // Toggling one panel must not disturb the other.
    expect(result.current.isExpanded("moves")).toBe(false);

    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as { players: boolean; moves: boolean } | null;
    expect(stored).toEqual({ players: true, moves: false });
  });

  it("restores a previously persisted state on mount", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ players: true, moves: false }),
    );

    const { result } = renderHook(() => usePanelCollapse());

    expect(result.current.isExpanded("players")).toBe(true);
    expect(result.current.isExpanded("moves")).toBe(false);
  });

  it("honors a stored object carrying the existing players/moves keys", () => {
    // The shape existing users already have in localStorage. Extending the
    // state model for a new panel must not discard this.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ players: false, moves: true }),
    );

    const { result } = renderHook(() => usePanelCollapse());

    expect(result.current.isExpanded("players")).toBe(false);
    expect(result.current.isExpanded("moves")).toBe(true);
  });

  it("falls back to the default for corrupt stored JSON instead of throwing", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");

    const { result } = renderHook(() => usePanelCollapse());

    expect(result.current.isExpanded("players")).toBe(false);
    expect(result.current.isExpanded("moves")).toBe(false);
  });

  it("falls back to the default for a stored value of the wrong shape", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ players: "yes", moves: 1 }),
    );

    const { result } = renderHook(() => usePanelCollapse());

    expect(result.current.isExpanded("players")).toBe(false);
    expect(result.current.isExpanded("moves")).toBe(false);
  });
});
