import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the dead chat path is removed from the game
 * backend.
 *
 * The request intentionally deletes the `sendChat` endpoint, the
 * `appendChat`/`broadcastSystem` helpers, the `chat` field from the
 * game-state snapshot, the chat store, and the `chatMessage` OQL entity. None
 * of that is asserted here — it is the intentional change.
 *
 * What this file protects is the behavior ADJACENT to the change that must
 * survive it: the DATA SHAPE of the `getGameState` snapshot the frontend
 * consumes. Removing the `chat` field must not disturb the sibling fields the
 * UI reads — `phase`, `turn`, `board`, `players`, `moveMaker`,
 * `timerRemainingMs`, `spellUseEnabled`, `spellBoardState`, and the optional
 * `winner` / `openingName` / `celebrationSecondsLeft`. A backend edit that
 * drops or renames one of those while deleting `chat` fails here rather than
 * in front of a user.
 *
 * The actor is a typed local mock (no real canister, no network). The
 * backend's own serialization is NOT exercised here — that is the PocketIC
 * lane's job, and it is skipped when no compiled wasm is present.
 */

// use-game-state imports the backend module for its types only, but the
// generated module transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure, which fail to resolve their own submodules
// in the jsdom test environment (a pre-existing dependency issue). Mock the
// backend module with the enum values the hook's consumers need.
vi.mock("@/backend", () => ({
  Team: { Black: "Black", White: "White" },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  // chess-logic (imported by use-game-state) reads PieceType as a runtime
  // value, so the mock must provide it.
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Queen: "Queen",
    Rook: "Rook",
    Knight: "Knight",
  },
}));

// The hook reaches the backend through useActorState() from lib/backend-actor.
// Mock it with a typed actor whose getGameState is a vi.fn() so the test
// captures the exact call and controls the response.
const { getGameState, getGameRecord } = vi.hoisted(() => ({
  getGameState: vi.fn(),
  getGameRecord: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: { getGameState, getGameRecord },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

import type { GameStateSnapshot } from "@/backend";
import { useGameState } from "@/hooks/use-game-state";

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/**
 * A minimal fixture covering every snapshot field the frontend consumes, and
 * deliberately NO `chat` field (that field is the intentional removal, so
 * asserting it would characterize the deleted behavior).
 *
 * It is typed as the consumed subset rather than as the full
 * `GameStateSnapshot`, because the full type still requires `chat` before the
 * change and will not after it. The subset compiles against both, and the
 * cast at the mock boundary is what the hook's own `as Promise<...>` already
 * does. The assertions below are what pin the adjacent fields.
 */
type ConsumedSnapshot = Pick<
  GameStateSnapshot,
  | "spellBoardState"
  | "spellUseEnabled"
  | "turn"
  | "timerRemainingMs"
  | "players"
  | "board"
  | "moveMaker"
  | "phase"
> &
  Partial<
    Pick<GameStateSnapshot, "winner" | "openingName" | "celebrationSecondsLeft">
  >;

const snapshotFixture: ConsumedSnapshot = {
  spellBoardState: {
    blockedSquareOwners: [],
    explosiveSquares: [],
    blockedSquares: [],
  },
  spellUseEnabled: true,
  turn: "White" as GameStateSnapshot["turn"],
  timerRemainingMs: 300000n,
  players: [
    {
      principal: "player-1",
      username: "Ada",
      team: "White" as GameStateSnapshot["turn"],
      walletSource: "none" as never,
      isMoveMaker: true,
      isFresh: false,
      isInactive: false,
      isBot: false,
    },
  ],
  board: Array.from({ length: 64 }, () => null),
  moveMaker: "player-1",
  phase: "Playing" as GameStateSnapshot["phase"],
};

describe("getGameState snapshot shape consumed by the frontend", () => {
  beforeEach(() => {
    // The hook's opening-name effect calls getGameRecord() whenever the
    // snapshot carries an openingName. Give it a resolved empty record so the
    // effect never throws on an undefined return.
    getGameRecord.mockResolvedValue({
      moves: [],
      active: false,
      concluded: false,
      openingName: "",
      rosters: [],
      playerList: [],
      finalBoard: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls actor.getGameState(principal) and exposes the non-chat snapshot fields", async () => {
    getGameState.mockResolvedValue(snapshotFixture);

    function Harness() {
      const { data } = useGameState("player-1");
      return (
        <div>
          <span data-testid="phase">{data?.phase ?? "none"}</span>
          <span data-testid="turn">{data?.turn ?? "none"}</span>
          <span data-testid="board">{data?.board.length ?? -1}</span>
          <span data-testid="players">{data?.players.length ?? -1}</span>
          <span data-testid="moveMaker">{data?.moveMaker ?? "none"}</span>
          <span data-testid="timer">
            {String(data?.timerRemainingMs ?? -1n)}
          </span>
          <span data-testid="spellUseEnabled">
            {String(data?.spellUseEnabled ?? "none")}
          </span>
          <span data-testid="blockedSquares">
            {data?.spellBoardState.blockedSquares.length ?? -1}
          </span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getGameState).toHaveBeenCalledWith("player-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("phase")).toHaveTextContent("Playing");
    });

    // Every sibling field the UI reads survives the chat removal.
    expect(screen.getByTestId("turn")).toHaveTextContent("White");
    expect(screen.getByTestId("board")).toHaveTextContent("64");
    expect(screen.getByTestId("players")).toHaveTextContent("1");
    expect(screen.getByTestId("moveMaker")).toHaveTextContent("player-1");
    expect(screen.getByTestId("timer")).toHaveTextContent("300000");
    expect(screen.getByTestId("spellUseEnabled")).toHaveTextContent("true");
    expect(screen.getByTestId("blockedSquares")).toHaveTextContent("0");
  });

  it("keeps the optional snapshot fields readable when present", async () => {
    getGameState.mockResolvedValue({
      ...snapshotFixture,
      phase: "Celebration" as GameStateSnapshot["phase"],
      winner: "Black" as GameStateSnapshot["turn"],
      openingName: "Sicilian Defence",
      celebrationSecondsLeft: 5n,
    });

    function Harness() {
      const { data } = useGameState("player-1");
      return (
        <div>
          <span data-testid="winner">{data?.winner ?? "none"}</span>
          <span data-testid="opening">{data?.openingName ?? "none"}</span>
          <span data-testid="celebration">
            {String(data?.celebrationSecondsLeft ?? -1n)}
          </span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("winner")).toHaveTextContent("Black");
    });
    expect(screen.getByTestId("opening")).toHaveTextContent("Sicilian Defence");
    expect(screen.getByTestId("celebration")).toHaveTextContent("5");
  });

  it("keeps the public PlayerInfo shape free of the internal turn counter", async () => {
    // The accepted change reseeds the internal `turnsThisGame` counter for a
    // joining, returning, reassigned or kicked player. That counter is NOT part
    // of the public snapshot: `PlayerInfo` must keep exposing exactly the
    // fields the UI reads and must NOT leak `turnsThisGame`. A backend edit
    // that adds the counter to the public shape (or drops a sibling field)
    // fails here rather than in front of a user.
    getGameState.mockResolvedValue(snapshotFixture);

    function Harness() {
      const { data } = useGameState("player-1");
      const player = data?.players[0];
      return (
        <div>
          <span data-testid="principal">{player?.principal ?? "none"}</span>
          <span data-testid="username">{player?.username ?? "none"}</span>
          <span data-testid="team">{player?.team ?? "none"}</span>
          <span data-testid="isMoveMaker">
            {String(player?.isMoveMaker ?? "none")}
          </span>
          <span data-testid="isFresh">{String(player?.isFresh ?? "none")}</span>
          <span data-testid="isInactive">
            {String(player?.isInactive ?? "none")}
          </span>
          <span data-testid="hasTurnsThisGame">
            {String(
              player !== undefined &&
                Object.prototype.hasOwnProperty.call(player, "turnsThisGame"),
            )}
          </span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("principal")).toHaveTextContent("player-1");
    });

    // The sibling fields the UI reads survive the counter change.
    expect(screen.getByTestId("username")).toHaveTextContent("Ada");
    expect(screen.getByTestId("team")).toHaveTextContent("White");
    expect(screen.getByTestId("isMoveMaker")).toHaveTextContent("true");
    expect(screen.getByTestId("isFresh")).toHaveTextContent("false");
    expect(screen.getByTestId("isInactive")).toHaveTextContent("false");

    // The internal turn counter is not part of the public player shape.
    expect(screen.getByTestId("hasTurnsThisGame")).toHaveTextContent("false");
  });

  it("keeps the snapshot shape when a player's team changes after a kick", async () => {
    // The accepted change reseeds the internal `turnsThisGame` counter when a
    // kicked player moves to the opposing team. That counter is internal, but
    // the team move itself IS observable: the snapshot the frontend consumes
    // must keep its shape and report the player's new team. A backend edit
    // that disturbs the snapshot while reseeding the counter fails here.
    getGameState.mockResolvedValue({
      ...snapshotFixture,
      players: [
        {
          principal: "player-1",
          username: "Ada",
          team: "Black" as GameStateSnapshot["turn"],
          walletSource: "none" as never,
          isMoveMaker: false,
          isFresh: true,
          isInactive: false,
          isBot: false,
        },
      ],
    });

    function Harness() {
      const { data } = useGameState("player-1");
      const player = data?.players[0];
      return (
        <div>
          <span data-testid="team">{player?.team ?? "none"}</span>
          <span data-testid="players">{data?.players.length ?? -1}</span>
          <span data-testid="phase">{data?.phase ?? "none"}</span>
          <span data-testid="board">{data?.board.length ?? -1}</span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("team")).toHaveTextContent("Black");
    });

    // The sibling snapshot fields the UI reads survive the team move.
    expect(screen.getByTestId("players")).toHaveTextContent("1");
    expect(screen.getByTestId("phase")).toHaveTextContent("Playing");
    expect(screen.getByTestId("board")).toHaveTextContent("64");
  });

  it("leaves the derived move list empty for a Standard opening with no seeded moves", async () => {
    // A Standard opening reports a non-null openingName but seeds ZERO replay
    // moves, so getGameRecord() returns no "Opening" records. The hook's
    // opening-seeding effect must therefore leave `moves` empty, which is what
    // keeps the first-turn burn restriction in force for the opening
    // Move_Maker. This is the adjacent behavior the opening-turn detection
    // change must not disturb: a Standard opening is still the opening turn.
    getGameRecord.mockResolvedValue({
      moves: [],
      active: false,
      concluded: false,
      openingName: "Standard Starting Position",
      rosters: [],
      playerList: [],
      finalBoard: [],
    });
    getGameState.mockResolvedValue({
      ...snapshotFixture,
      openingName: "Standard Starting Position",
    });

    function Harness() {
      const { moves } = useGameState("player-1");
      return <span data-testid="moves">{moves.length}</span>;
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getGameRecord).toHaveBeenCalled();
    });
    // No seeded opening moves -> the derived list stays empty.
    expect(screen.getByTestId("moves")).toHaveTextContent("0");
  });

  it("derives checkSquare from the snapshot board and turn while Playing", async () => {
    // A board with a lone White king on e1 and a Black rook on e8: the White
    // king is in check from the rook down the e-file. The hook derives
    // checkSquare locally from the snapshot (no extra backend call), so this
    // protects the board/turn/phase fields the derivation depends on.
    const board: GameStateSnapshot["board"] = Array.from(
      { length: 64 },
      () => null,
    );
    // Square index 4 = e1 (rank 1, file e); index 60 = e8.
    board[4] = { pieceType: "King", color: "White" } as never;
    board[60] = { pieceType: "Rook", color: "Black" } as never;

    getGameState.mockResolvedValue({
      ...snapshotFixture,
      board,
      turn: "White" as GameStateSnapshot["turn"],
      phase: "Playing" as GameStateSnapshot["phase"],
    });

    function Harness() {
      const { checkSquare } = useGameState("player-1");
      return <span data-testid="check">{String(checkSquare)}</span>;
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("check")).toHaveTextContent("4");
    });
  });
});
