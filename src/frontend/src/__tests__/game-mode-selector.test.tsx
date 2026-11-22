import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { GameModeSelector } from "@/components/GameModeSelector";

/**
 * Cover for the three separate mutually-exclusive game-mode buttons.
 *
 * The layout reorganization replaced the single cycling smiley toggle with
 * three separate buttons (Just for Fun / Exercise Game / Drinking Game).
 * Selecting one button deselects the other two, and the selected mode
 * persists to localStorage (via useGameMode) as before.
 *
 * These tests assert:
 *   - all three buttons are visible with their labels;
 *   - exactly one button is active at a time (mutually exclusive);
 *   - clicking a button selects it and deselects the others;
 *   - the selected mode persists to localStorage.
 */
describe("GameModeSelector", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders three separate game-mode buttons labeled Just for Fun, Exercise Game, and Drinking Game", () => {
    render(<GameModeSelector />);

    // The active button carries an "(active)" suffix on its accessible name.
    expect(
      screen.getByRole("button", { name: /^Just for Fun( \(active\))?$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Exercise Game" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Drinking Game" }),
    ).toBeInTheDocument();
  });

  it("defaults to Just for Fun active and the other two inactive", () => {
    render(<GameModeSelector />);

    expect(
      screen.getByRole("button", { name: "Just for Fun (active)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Exercise Game" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Drinking Game" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("selecting one mode deselects the other two and persists the selection", async () => {
    const user = userEvent.setup();
    render(<GameModeSelector />);

    // Select Exercise Game.
    await user.click(screen.getByRole("button", { name: "Exercise Game" }));
    expect(
      screen.getByRole("button", { name: "Exercise Game (active)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Just for Fun" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Drinking Game" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem("game-mode")).toBe("exercise");

    // Select Drinking Game — Exercise Game becomes inactive.
    await user.click(screen.getByRole("button", { name: "Drinking Game" }));
    expect(
      screen.getByRole("button", { name: "Drinking Game (active)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Exercise Game" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Just for Fun" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem("game-mode")).toBe("drinking");
  });

  it("reads a previously persisted mode on mount", () => {
    window.localStorage.setItem("game-mode", "drinking");
    render(<GameModeSelector />);

    expect(
      screen.getByRole("button", { name: "Drinking Game (active)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Just for Fun" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Exercise Game" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  /**
   * Adjacent behavior the button move/size change must not disturb: each
   * button keeps its own distinct icon, and the active button keeps the
   * primary active-state styling while the inactive ones keep the muted
   * styling. The icons are decorative (aria-hidden), so they are asserted by
   * their distinct SVG shape rather than by an accessible name.
   */
  it("renders a distinct decorative icon inside each mode button", () => {
    render(<GameModeSelector />);

    const funIcon = screen
      .getByRole("button", { name: /^Just for Fun( \(active\))?$/ })
      .querySelector("svg");
    const exerciseIcon = screen
      .getByRole("button", { name: "Exercise Game" })
      .querySelector("svg");
    const drinkingIcon = screen
      .getByRole("button", { name: "Drinking Game" })
      .querySelector("svg");

    expect(funIcon).not.toBeNull();
    expect(exerciseIcon).not.toBeNull();
    expect(drinkingIcon).not.toBeNull();

    // Each icon is decorative and distinct from the other two.
    for (const icon of [funIcon, exerciseIcon, drinkingIcon]) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
    expect(funIcon?.innerHTML).not.toBe(exerciseIcon?.innerHTML);
    expect(exerciseIcon?.innerHTML).not.toBe(drinkingIcon?.innerHTML);
    expect(funIcon?.innerHTML).not.toBe(drinkingIcon?.innerHTML);
  });

  /**
   * The accepted layout swap enlarges the three game-mode buttons to the
   * large (six-button) size: a 44px minimum height with text-sm and
   * font-semibold. This is the size the six board-view buttons used before the
   * swap.
   */
  it("renders every game-mode button at the large (six-button) size", () => {
    render(<GameModeSelector />);

    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("min-h-[44px]");
      expect(button.className).toContain("text-sm");
      expect(button.className).toContain("font-semibold");
    }
  });

  it("keeps the primary active-state styling on the active button only", () => {
    render(<GameModeSelector />);

    const active = screen.getByRole("button", {
      name: "Just for Fun (active)",
    });
    const inactive = screen.getByRole("button", { name: "Exercise Game" });

    expect(active.className).toContain("border-primary");
    expect(active.className).toContain("text-primary");
    expect(inactive.className).not.toContain("border-primary");
    expect(inactive.className).toContain("text-muted-foreground");
  });

  it("calls setMode with the clicked button's own mode", async () => {
    const user = userEvent.setup();
    render(<GameModeSelector />);

    // Clicking each button writes that button's mode to the shared store.
    await user.click(screen.getByRole("button", { name: "Exercise Game" }));
    expect(window.localStorage.getItem("game-mode")).toBe("exercise");

    await user.click(screen.getByRole("button", { name: "Drinking Game" }));
    expect(window.localStorage.getItem("game-mode")).toBe("drinking");

    await user.click(screen.getByRole("button", { name: "Just for Fun" }));
    expect(window.localStorage.getItem("game-mode")).toBe("off");
  });
});
