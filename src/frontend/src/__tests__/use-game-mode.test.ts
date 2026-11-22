import "@testing-library/jest-dom/vitest";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useGameMode } from "@/hooks/use-game-mode";

/**
 * Characterization of the game-mode state model.
 *
 * The upcoming layout reorganization splits the single cycling game-mode
 * toggle into three separate mutually-exclusive buttons (Just for Fun /
 * Exercise Game / Drinking Game). The three-mode STATE MODEL that the
 * selector persists is not being removed — only the single-button cycling
 * UI is replaced by three buttons. These tests protect the underlying
 * contract the new three-button UI will rely on: exactly three modes, a
 * default of "off", explicit setMode, and persistence to localStorage.
 *
 * They deliberately do NOT assert the single-button `cycle` behavior, which
 * is the UI interaction the reorganization intentionally replaces.
 */
describe("useGameMode state model", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the off mode with no stored value", () => {
    const { result } = renderHook(() => useGameMode());
    expect(result.current.mode).toBe("off");
  });

  it("persists the selected mode to localStorage", () => {
    const { result } = renderHook(() => useGameMode());

    act(() => {
      result.current.setMode("exercise");
    });
    expect(result.current.mode).toBe("exercise");
    expect(window.localStorage.getItem("game-mode")).toBe("exercise");

    act(() => {
      result.current.setMode("drinking");
    });
    expect(result.current.mode).toBe("drinking");
    expect(window.localStorage.getItem("game-mode")).toBe("drinking");
  });

  it("reads a previously persisted mode on mount", () => {
    window.localStorage.setItem("game-mode", "drinking");
    const { result } = renderHook(() => useGameMode());
    expect(result.current.mode).toBe("drinking");
  });

  it("falls back to off for an unknown stored value", () => {
    window.localStorage.setItem("game-mode", "not-a-mode");
    const { result } = renderHook(() => useGameMode());
    expect(result.current.mode).toBe("off");
  });
});
