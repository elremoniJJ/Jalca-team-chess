import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardToolbar } from "@/components/BoardToolbar";

/**
 * Cover for the BoardToolbar's individual control behaviors after the Game #
 * button was relocated into the "Vote on next game" window header and the
 * Advice toggle was removed from the board toolbar.
 *
 * The toolbar now holds ONLY the two board-level controls that stay with the
 * board:
 *   1. Coords toggle   — shows/hides the a-h / 1-8 labels around the board.
 *   2. Flip button     — manually reverses board orientation.
 *
 * The Game # button has MOVED into the VotingWindow header (covered in
 * voting-window.test.tsx / game-controls-relocation-characterization.test.tsx),
 * and the Advice control has been removed entirely, so this file asserts both
 * are absent from the toolbar and that the two remaining controls still render
 * and fire their handlers.
 */
describe("BoardToolbar control behaviors", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  const renderToolbar = (
    overrides: Partial<Parameters<typeof BoardToolbar>[0]> = {},
  ) =>
    render(
      <BoardToolbar
        showCoordinates
        onToggleCoordinates={vi.fn()}
        onFlipBoard={vi.fn()}
        {...overrides}
      />,
    );

  it("renders the two board controls (Coords, Flip) in the toolbar row", () => {
    renderToolbar();

    expect(
      screen.getByRole("button", { name: "Hide coordinates" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Flip board" }),
    ).toBeInTheDocument();
  });

  it("renders no Advice control in the toolbar row", () => {
    renderToolbar();

    // The Advice toggle was removed from the board toolbar; no button whose
    // accessible name mentions advice may render.
    expect(
      screen.queryByRole("button", { name: /advice/i }),
    ).not.toBeInTheDocument();
  });

  it("no longer renders the Game # button in the toolbar", () => {
    renderToolbar();

    // The Game # control moved to the VotingWindow header; the toolbar must
    // not render it (nor any button whose accessible name mentions Game #).
    expect(
      screen.queryByRole("button", { name: /Game #/ }),
    ).not.toBeInTheDocument();
  });

  it("toggles coordinates and fires the flip handler", async () => {
    const user = userEvent.setup();
    const onToggleCoordinates = vi.fn();
    const onFlipBoard = vi.fn();
    renderToolbar({ onToggleCoordinates, onFlipBoard });

    await user.click(screen.getByRole("button", { name: "Hide coordinates" }));
    expect(onToggleCoordinates).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Flip board" }));
    expect(onFlipBoard).toHaveBeenCalledTimes(1);
  });
});
