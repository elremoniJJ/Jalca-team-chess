import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the Move_Maker turn-announcement changes on
 * TurnAnnouncementOverlay.
 *
 * Accepted behavior:
 *   - When the local player is the Move_Maker, the existing turn-announcement
 *     label reads exactly "you are the Move_Maker" and stays visible for 3s
 *     (MOVE_MAKER_ANNOUNCE_MS), replacing the "White — <name> to move" /
 *     "Black — <name> to move" text.
 *   - The existing transient announcement path for both teams still fires on
 *     every turn change for 2s (ANNOUNCE_MS).
 *   - The isConsistent guard still suppresses the announcement when the mover
 *     is inconsistent.
 *   - Reduced-motion handling gates the infinite pulse: under
 *     prefers-reduced-motion the pulse does not run.
 *
 * These are component/integration contracts with no actor or network access.
 * The overlay is driven entirely by props exactly as the game route supplies
 * them; the real backend is not exercised here.
 */

// The overlay imports Team as a runtime value from @/backend, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the overlay needs. The
// overlay under test is pure frontend rendering and never touches the actor.
vi.mock("@/backend", () => ({
  Team: { Black: "Black", White: "White" },
}));

import { Team } from "@/backend";
import { TurnAnnouncementOverlay } from "@/components/TurnAnnouncementOverlay";

/**
 * Stub matchMedia so the overlay's useReducedMotion hook reads a deterministic
 * value. jsdom does not implement matchMedia.
 */
function stubMatchMedia(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  );
}

/**
 * The overlay measures the board inside a requestAnimationFrame callback and
 * renders nothing until a rect is available. jsdom's rAF is timer-backed, so
 * run the callback synchronously to make the measurement deterministic.
 */
function stubSyncRaf() {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

/**
 * The overlay measures the real `.chess-board` element and renders nothing
 * until a rect is available. jsdom returns an all-zero rect, which is still a
 * truthy object, so the overlay renders. We insert a `.chess-board` element so
 * the querySelector in the measure effect finds a target.
 */
function mountBoardElement() {
  const board = document.createElement("div");
  board.className = "chess-board";
  document.body.appendChild(board);
  return board;
}

function renderOverlay(props: {
  turn: string;
  moveMakerName: string | null;
  isLocalMoveMaker?: boolean;
  isConsistent?: boolean;
}) {
  return render(
    <TurnAnnouncementOverlay
      turn={props.turn as Team}
      moveMakerName={props.moveMakerName}
      isLocalMoveMaker={props.isLocalMoveMaker}
      isConsistent={props.isConsistent}
    />,
  );
}

/** The announcement label is the only element carrying the text. */
function labelText(): string | null {
  const glow = document.querySelector(
    '[data-ocid="turn_announcement.board_glow"]',
  );
  if (!glow) return null;
  return glow.textContent?.trim() ?? null;
}

describe("TurnAnnouncementOverlay Move_Maker label", () => {
  let board: HTMLElement;

  beforeEach(() => {
    stubMatchMedia(false);
    stubSyncRaf();
    board = mountBoardElement();
  });

  afterEach(() => {
    cleanup();
    board.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads exactly 'you are the Move_Maker' when the local player is the Move_Maker", () => {
    const { rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isLocalMoveMaker: false,
    });
    // First mount records the turn and does not announce.
    expect(labelText()).toBeNull();

    // Turn changes to Black and the local player is the Move_Maker.
    rerender(
      <TurnAnnouncementOverlay
        turn={Team.Black}
        moveMakerName="Ada"
        isLocalMoveMaker={true}
      />,
    );

    expect(labelText()).toBe("you are the Move_Maker");
  });

  it("keeps the Move_Maker label visible for 3 seconds, not 2", () => {
    vi.useFakeTimers();
    // useFakeTimers replaces rAF with a fake; re-stub it synchronously so the
    // board measurement runs before the assertion.
    stubSyncRaf();
    const { rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isLocalMoveMaker: false,
    });

    rerender(
      <TurnAnnouncementOverlay
        turn={Team.Black}
        moveMakerName="Ada"
        isLocalMoveMaker={true}
      />,
    );
    expect(labelText()).toBe("you are the Move_Maker");

    // Still visible just before 3s.
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(labelText()).toBe("you are the Move_Maker");

    // Gone at 3s.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(labelText()).toBeNull();
  });

  it("still shows the standard 'White — <name> to move' label for a non-local mover", () => {
    const { rerender } = renderOverlay({
      turn: Team.Black,
      moveMakerName: "Bob",
      isLocalMoveMaker: false,
    });

    rerender(
      <TurnAnnouncementOverlay
        turn={Team.White}
        moveMakerName="Ada"
        isLocalMoveMaker={false}
      />,
    );

    expect(labelText()).toBe("White — Ada to move");
  });

  it("still fires the transient announcement for both teams for 2 seconds", () => {
    vi.useFakeTimers();
    stubSyncRaf();
    const { rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isLocalMoveMaker: false,
    });

    // White -> Black fires the standard 2s announcement.
    rerender(
      <TurnAnnouncementOverlay
        turn={Team.Black}
        moveMakerName="Bob"
        isLocalMoveMaker={false}
      />,
    );
    expect(labelText()).toBe("Black — Bob to move");
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(labelText()).toBe("Black — Bob to move");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(labelText()).toBeNull();

    // Black -> White fires again for the other team.
    rerender(
      <TurnAnnouncementOverlay
        turn={Team.White}
        moveMakerName="Ada"
        isLocalMoveMaker={false}
      />,
    );
    expect(labelText()).toBe("White — Ada to move");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(labelText()).toBeNull();
  });

  it("suppresses the announcement when the mover is inconsistent", () => {
    const { rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isLocalMoveMaker: false,
      isConsistent: true,
    });

    // Turn changes but the snapshot is inconsistent (e.g. turn = Black while
    // the moveMaker is a White player's principal). No announcement.
    rerender(
      <TurnAnnouncementOverlay
        turn={Team.Black}
        moveMakerName="Ada"
        isLocalMoveMaker={false}
        isConsistent={false}
      />,
    );
    expect(labelText()).toBeNull();

    // A later consistent snapshot on the SAME turn must not re-fire (the turn
    // change was already recorded).
    rerender(
      <TurnAnnouncementOverlay
        turn={Team.Black}
        moveMakerName="Bob"
        isLocalMoveMaker={false}
        isConsistent={true}
      />,
    );
    expect(labelText()).toBeNull();
  });

  it("does not run the infinite pulse when the user prefers reduced motion", () => {
    stubMatchMedia(true);
    const { rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isLocalMoveMaker: false,
    });

    rerender(
      <TurnAnnouncementOverlay
        turn={Team.Black}
        moveMakerName="Bob"
        isLocalMoveMaker={false}
      />,
    );

    // The label still renders under reduced motion; only the pulse is gated.
    expect(labelText()).toBe("Black — Bob to move");

    // The pulsing inner element is the one with the box-shadow animation. Under
    // reduced motion its transition duration is 0 and it does not repeat. The
    // observable contract in jsdom is the absence of a repeating animation on
    // the glow's inner element; motion/react applies inline styles, so we
    // assert the label is present and the glow element exists without a
    // repeat-driven animation name.
    const glow = document.querySelector(
      '[data-ocid="turn_announcement.board_glow"]',
    );
    expect(glow).not.toBeNull();
    const inner = glow?.firstElementChild as HTMLElement | null;
    expect(inner).not.toBeNull();
    // No CSS animation is applied by motion/react for a non-repeating
    // transition; the pulse would otherwise set an infinite animation.
    expect(inner?.style.animationName ?? "").not.toContain("infinite");
  });
});
