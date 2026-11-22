import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization for the existing TurnAnnouncementOverlay behavior that the
 * accepted request does NOT intentionally change.
 *
 * The request changes the label text when the local player is the Move_Maker
 * and adds reduced-motion handling to the pulse. Those two things are
 * deliberately NOT asserted here. What must keep working:
 *   - the transient announcement fires on every turn change, for both teams;
 *   - it auto-dismisses after 2 seconds (ANNOUNCE_MS);
 *   - it does NOT fire on initial mount;
 *   - a null moveMakerName falls back to the team name rather than suppressing;
 *   - the isConsistent guard suppresses the announcement when the mover is
 *     inconsistent, and does not re-fire on the same turn once consistency is
 *     restored.
 *
 * The overlay imports the `Team` runtime enum from `../backend`, which
 * transitively pulls in @caffeineai/object-storage and
 * @caffeineai/core-infrastructure. Those packages fail to resolve their own
 * submodules in jsdom (a pre-existing dependency issue), so mock the backend
 * module with just the enum values the overlay needs. The overlay under test
 * is pure frontend rendering and never touches the actor.
 */
vi.mock("@/backend", () => ({
  Team: { Black: "Black", White: "White" },
}));

import { Team } from "@/backend";
import { TurnAnnouncementOverlay } from "@/components/TurnAnnouncementOverlay";

/**
 * The overlay measures the real `.chess-board` element via
 * getBoundingClientRect inside a requestAnimationFrame. jsdom has no layout,
 * so we render a stand-in `.chess-board` and run rAF synchronously so the
 * measurement lands within the same act() as the render.
 */
function stubRafSync() {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

function renderOverlay(props: {
  turn: Team;
  moveMakerName: string | null;
  isConsistent?: boolean;
  isGameInProgress?: boolean;
}) {
  return render(
    <div>
      <div className="chess-board" />
      <TurnAnnouncementOverlay
        turn={props.turn}
        moveMakerName={props.moveMakerName}
        isConsistent={props.isConsistent}
        isGameInProgress={props.isGameInProgress}
      />
    </div>,
  );
}

/** The announcement glow is the only element carrying this data-ocid. */
function glow(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-ocid="turn_announcement.board_glow"]',
  );
}

describe("TurnAnnouncementOverlay characterization", () => {
  beforeEach(() => {
    stubRafSync();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not announce on initial mount", () => {
    const { container } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
    });

    expect(glow(container)).toBeNull();
  });

  it("announces on a turn change and auto-dismisses after 2 seconds", () => {
    // Fake only the timeout clock the overlay uses for ANNOUNCE_MS; leave
    // requestAnimationFrame real so the synchronous rAF stub still measures.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
    });

    // Initial mount: no announcement.
    expect(glow(container)).toBeNull();

    // Turn changes White -> Black: the announcement fires.
    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay turn={Team.Black} moveMakerName="Bob" />
        </div>,
      );
    });
    expect(glow(container)).not.toBeNull();

    // Still visible just before the 2s window closes.
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(glow(container)).not.toBeNull();

    // Gone at exactly 2s.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(glow(container)).toBeNull();
  });

  it("fires for both teams on each turn change", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
    });

    const changeTo = (turn: Team, name: string) => {
      act(() => {
        rerender(
          <div>
            <div className="chess-board" />
            <TurnAnnouncementOverlay turn={turn} moveMakerName={name} />
          </div>,
        );
      });
    };

    // White -> Black fires.
    changeTo(Team.Black, "Bob");
    expect(glow(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(glow(container)).toBeNull();

    // Black -> White fires again.
    changeTo(Team.White, "Ada");
    expect(glow(container)).not.toBeNull();
  });

  it("falls back to the team name when moveMakerName is null", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
    });

    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay turn={Team.Black} moveMakerName={null} />
        </div>,
      );
    });

    // A null name must NOT suppress the announcement.
    expect(glow(container)).not.toBeNull();
  });

  it("suppresses the announcement when the mover is inconsistent", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
    });

    // Turn changes but the snapshot is inconsistent: no announcement.
    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Ada"
            isConsistent={false}
          />
        </div>,
      );
    });
    expect(glow(container)).toBeNull();

    // Consistency restored on the SAME turn must not re-fire (the turn was
    // already recorded), so the announcement stays suppressed.
    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
          />
        </div>,
      );
    });
    expect(glow(container)).toBeNull();
  });

  // The accepted request hides the cue once the game is no longer in progress.
  // What must keep working is the ordinary case: a real turn change while the
  // game is in progress still shows the cue normally, and it still
  // auto-dismisses after the standard 2s window. These assertions do not
  // characterize the non-Playing phases the request intentionally changes.
  it("still shows the cue on a real turn change while the game is in progress", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
    });

    // Initial mount records the turn and does not announce.
    expect(glow(container)).toBeNull();

    // A genuine turn change in a Playing game fires the cue.
    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
          />
        </div>,
      );
    });
    expect(glow(container)).not.toBeNull();

    // It still auto-dismisses after the standard 2s window.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(glow(container)).toBeNull();
  });

  it("shows the cue again on the next real turn change in the same game", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
    });

    const changeTo = (turn: Team, name: string) => {
      act(() => {
        rerender(
          <div>
            <div className="chess-board" />
            <TurnAnnouncementOverlay
              turn={turn}
              moveMakerName={name}
              isConsistent={true}
            />
          </div>,
        );
      });
    };

    // First real turn change fires and dismisses.
    changeTo(Team.Black, "Bob");
    expect(glow(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(glow(container)).toBeNull();

    // The next real turn change fires the cue again.
    changeTo(Team.White, "Ada");
    expect(glow(container)).not.toBeNull();
  });

  // The accepted request hides the cue once the game is no longer in progress.
  // What must keep working is the ordinary in-progress case: a real turn change
  // in a new Playing game still shows the cue normally, and it still
  // auto-dismisses after the standard 2s window. These assertions deliberately
  // do NOT characterize the non-Playing phases (Celebration / Draw / Paused)
  // that the request intentionally changes.
  it("shows the cue on a real turn change in a new Playing game", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
    });

    // Initial mount records the turn and does not announce.
    expect(glow(container)).toBeNull();

    // A genuine turn change in a Playing game fires the cue.
    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
          />
        </div>,
      );
    });
    expect(glow(container)).not.toBeNull();

    // It still auto-dismisses after the standard 2s window.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(glow(container)).toBeNull();
  });

  it("keeps the cue visible for the full 2s window on a Playing turn change", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
    });

    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
          />
        </div>,
      );
    });
    expect(glow(container)).not.toBeNull();

    // Still visible just before the window closes.
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(glow(container)).not.toBeNull();

    // Gone at exactly 2s.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(glow(container)).toBeNull();
  });
});

/**
 * Cover for the accepted `isGameInProgress` gate on TurnAnnouncementOverlay.
 *
 * Accepted behavior:
 *   - The overlay takes an optional boolean `isGameInProgress` defaulting to
 *     true; when false (Celebration, Draw or Paused) a turn change does NOT
 *     show the cue.
 *   - A cue already showing when the game stops being in progress is hidden
 *     immediately and its pending auto-dismiss timer is cleared, so the pill
 *     and glow are never visible during Celebration, Draw or Paused.
 *   - The next real turn change in a new Playing game still shows the cue
 *     normally.
 *
 * These are component contracts driven entirely by props, exactly as the game
 * route supplies them; no actor or network is exercised.
 */
describe("TurnAnnouncementOverlay isGameInProgress gate", () => {
  beforeEach(() => {
    stubRafSync();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not show the cue on a turn change while the game is not in progress", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
      isGameInProgress: false,
    });

    // A genuine turn change while not in progress must not announce.
    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
            isGameInProgress={false}
          />
        </div>,
      );
    });
    expect(glow(container)).toBeNull();
  });

  it("hides an already-showing cue immediately when the game stops being in progress", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
      isGameInProgress: true,
    });

    // A real turn change in a Playing game shows the cue.
    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
            isGameInProgress={true}
          />
        </div>,
      );
    });
    expect(glow(container)).not.toBeNull();

    // The phase leaves Playing: the cue is hidden immediately, well before
    // the 2s auto-dismiss window would have elapsed.
    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
            isGameInProgress={false}
          />
        </div>,
      );
    });
    expect(glow(container)).toBeNull();
  });

  it("clears the pending auto-dismiss timer when the game stops being in progress", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
      isGameInProgress: true,
    });

    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
            isGameInProgress={true}
          />
        </div>,
      );
    });
    expect(glow(container)).not.toBeNull();

    // Game stops being in progress: cue hidden and its timer cleared.
    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
            isGameInProgress={false}
          />
        </div>,
      );
    });
    expect(glow(container)).toBeNull();

    // Advancing past the original 2s window must not resurrect the cue (the
    // timer was cleared, not merely left to fire on a hidden element).
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(glow(container)).toBeNull();
  });

  it("shows the cue again on the next real turn change in a new Playing game", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
      isGameInProgress: true,
    });

    const changeTo = (turn: Team, name: string, inProgress: boolean) => {
      act(() => {
        rerender(
          <div>
            <div className="chess-board" />
            <TurnAnnouncementOverlay
              turn={turn}
              moveMakerName={name}
              isConsistent={true}
              isGameInProgress={inProgress}
            />
          </div>,
        );
      });
    };

    // A turn change while not in progress does not announce.
    changeTo(Team.Black, "Bob", false);
    expect(glow(container)).toBeNull();

    // The next real turn change in a new Playing game shows the cue normally.
    changeTo(Team.White, "Ada", true);
    expect(glow(container)).not.toBeNull();

    // And it still auto-dismisses after the standard 2s window.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(glow(container)).toBeNull();
  });

  it("defaults to announcing when isGameInProgress is omitted", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = renderOverlay({
      turn: Team.White,
      moveMakerName: "Ada",
      isConsistent: true,
    });

    act(() => {
      rerender(
        <div>
          <div className="chess-board" />
          <TurnAnnouncementOverlay
            turn={Team.Black}
            moveMakerName="Bob"
            isConsistent={true}
          />
        </div>,
      );
    });
    expect(glow(container)).not.toBeNull();
  });
});
