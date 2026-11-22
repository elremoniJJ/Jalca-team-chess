import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE spectator mode is added.
 *
 * The request intentionally changes the polling cadence for a SPECTATOR: a
 * shared `getGamePollMs()` helper returns 5000ms for a spectator while a
 * PLAYER stays at 1500ms. It also suppresses the live-vote cast for a
 * spectator. None of the spectator behavior is asserted here — it does not
 * exist yet.
 *
 * What this file protects is the behavior ADJACENT to that change that must
 * survive it: the PLAYER's polling cadence and the PLAYER's live-vote cast.
 * A refactor that routes every hook through `getGamePollMs()` must keep
 * returning 1500 for a player, and the live-vote effect must keep firing
 * `castVote` for a player. If the helper is wired so a player also gets
 * 5000ms, or the vote suppression leaks to players, this fails here rather
 * than in front of a user.
 *
 * The actor is a typed local mock (no real canister, no network). The
 * backend's own behavior is NOT exercised here — that is the PocketIC lane's
 * job.
 */

// The hooks import SpellUse/StartingPosition/GamePhase/Team/PieceType as
// runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test
// environment (a pre-existing dependency issue), so mock the backend module
// with the enum values the hooks and their consumers need.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  TurnDuration: {
    TwoMinutes: "TwoMinutes",
    NinetySeconds: "NinetySeconds",
    OneMinute: "OneMinute",
  },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  Team: { Black: "Black", White: "White" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  GameResult: { Draw: "Draw", BlackWin: "BlackWin", WhiteWin: "WhiteWin" },
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
  },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  ExerciseKind: {
    NinjaRoll: "NinjaRoll",
    PushUps: "PushUps",
    Squats: "Squats",
    Cartwheel: "Cartwheel",
    Crunches: "Crunches",
  },
  RecipientRole: { Drawer: "Drawer", Winner: "Winner" },
  SpellCategory: { Block: "Block", Major: "Major", Minor: "Minor" },
  TriggerType: {
    Capture: "Capture",
    EnPassant: "EnPassant",
    Castling: "Castling",
    Check: "Check",
  },
  Pot: {
    One: "One",
    Ten: "Ten",
    Hundred: "Hundred",
    Thousand: "Thousand",
  },
}));

// The hooks reach the backend through useActorState() from lib/backend-actor.
// Mock it with a typed actor whose read methods are vi.fn()s so the test can
// observe the exact calls and control the responses.
const {
  getGameState,
  getGameRecord,
  getGameNumber,
  getVoteTally,
  getNextGameSettings,
  getGameSettingsSnapshot,
  getKickState,
  castVote,
  getActor,
} = vi.hoisted(() => ({
  getGameState: vi.fn(),
  getGameRecord: vi.fn(),
  getGameNumber: vi.fn(),
  getVoteTally: vi.fn(),
  getNextGameSettings: vi.fn(),
  getGameSettingsSnapshot: vi.fn(),
  getKickState: vi.fn(),
  castVote: vi.fn(),
  getActor: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {
      getGameState,
      getGameRecord,
      getGameNumber,
      getVoteTally,
      getNextGameSettings,
      getGameSettingsSnapshot,
      getKickState,
      castVote,
    },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor,
}));

import { GamePhase, SpellUse, StartingPosition, TurnDuration } from "@/backend";
import { useGameMeta } from "@/hooks/use-game-meta";
import { useGameState } from "@/hooks/use-game-state";
import { useKickState } from "@/hooks/use-kick";
import {
  useCastVote,
  useGameSettingsSnapshot,
  useNextGameSettings,
  useVoteTally,
} from "@/hooks/use-voting";

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/** A minimal snapshot covering the fields useGameState reads. */
const snapshotFixture = {
  spellBoardState: {
    blockedSquareOwners: [],
    explosiveSquares: [],
    blockedSquares: [],
  },
  spellUseEnabled: false,
  turn: "White",
  timerRemainingMs: 300000n,
  players: [],
  board: Array.from({ length: 64 }, () => null),
  moveMaker: undefined,
  phase: "Playing",
};

describe("player polling cadence and live-vote cast (adjacent to spectator mode)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("useGameState polls getGameState every 1500ms for a player", async () => {
    getGameState.mockResolvedValue(snapshotFixture);
    getGameRecord.mockResolvedValue({
      moves: [],
      active: false,
      concluded: false,
      openingName: "",
      rosters: [],
      playerList: [],
      finalBoard: [],
    });

    function Harness() {
      const { data } = useGameState("player-1");
      return <span data-testid="phase">{data?.phase ?? "none"}</span>;
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getGameState).toHaveBeenCalledWith("player-1");
    });

    // The player's poll interval is 1500ms. The request changes only the
    // spectator cadence, so a player must stay at 1500.
    const callsAfterFirst = getGameState.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(getGameState.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  }, 10_000);

  it("useVoteTally polls getVoteTally every 1500ms for a player", async () => {
    getVoteTally.mockResolvedValue({
      standardCount: 0n,
      randomCount: 0n,
      spellOnCount: 0n,
      spellOffCount: 0n,
      winning: {
        startingPosition: StartingPosition.Random,
        spellUse: SpellUse.On,
      },
    });

    function Harness() {
      const { tally } = useVoteTally();
      return <span data-testid="tally">{tally ? "loaded" : "none"}</span>;
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getVoteTally).toHaveBeenCalledWith();
    });

    const callsAfterFirst = getVoteTally.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(getVoteTally.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  }, 10_000);

  it("useNextGameSettings polls getNextGameSettings every 1500ms for a player", async () => {
    getNextGameSettings.mockResolvedValue({
      startingPosition: StartingPosition.Random,
      spellUse: SpellUse.On,
    });

    function Harness() {
      const { settings } = useNextGameSettings();
      return <span data-testid="settings">{settings ? "loaded" : "none"}</span>;
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getNextGameSettings).toHaveBeenCalledWith();
    });

    const callsAfterFirst = getNextGameSettings.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(getNextGameSettings.mock.calls.length).toBeGreaterThan(
      callsAfterFirst,
    );
  }, 10_000);

  it("useGameSettingsSnapshot polls getGameSettingsSnapshot every 1500ms for a player", async () => {
    getGameSettingsSnapshot.mockResolvedValue({
      standardCount: 0n,
      randomCount: 0n,
      spellOnCount: 0n,
      spellOffCount: 0n,
      startingPosition: StartingPosition.Random,
      spellUse: SpellUse.On,
    });

    function Harness() {
      const { snapshot } = useGameSettingsSnapshot();
      return <span data-testid="snapshot">{snapshot ? "loaded" : "none"}</span>;
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getGameSettingsSnapshot).toHaveBeenCalledWith();
    });

    const callsAfterFirst = getGameSettingsSnapshot.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(getGameSettingsSnapshot.mock.calls.length).toBeGreaterThan(
      callsAfterFirst,
    );
  }, 10_000);

  it("useGameMeta polls getGameNumber every 1500ms for a player", async () => {
    getGameNumber.mockResolvedValue(1n);

    function Harness() {
      const { gameNumber } = useGameMeta("player-1");
      return (
        <span data-testid="gameNumber">
          {gameNumber !== null ? String(gameNumber) : "none"}
        </span>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getGameNumber).toHaveBeenCalledWith();
    });

    const callsAfterFirst = getGameNumber.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(getGameNumber.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  }, 10_000);

  it("useKickState polls getKickState every 1500ms for a player", async () => {
    getKickState.mockResolvedValue({ kickCounts: [], kickedBy: [] });

    function Harness() {
      const { kickState } = useKickState();
      return <span data-testid="kick">{kickState ? "loaded" : "none"}</span>;
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getKickState).toHaveBeenCalledWith();
    });

    const callsAfterFirst = getKickState.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(getKickState.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  }, 10_000);

  it("useCastVote still calls actor.castVote(principal, vote) for a player", async () => {
    castVote.mockResolvedValue(undefined);
    getActor.mockResolvedValue({ castVote });

    function Harness() {
      const { mutate } = useCastVote();
      return (
        <button
          type="button"
          onClick={() =>
            mutate({
              principal: "player-1",
              vote: {
                startingPosition: StartingPosition.Random,
                spellUse: SpellUse.On,
                turnDuration: TurnDuration.TwoMinutes,
              },
            })
          }
        >
          cast
        </button>
      );
    }

    renderWithQuery(<Harness />);
    screen.getByRole("button", { name: "cast" }).click();

    await waitFor(() => {
      expect(castVote).toHaveBeenCalledWith("player-1", {
        startingPosition: StartingPosition.Random,
        spellUse: SpellUse.On,
        turnDuration: TurnDuration.TwoMinutes,
      });
    });
  });

  it("keeps the game phase readable while a player polls", async () => {
    getGameState.mockResolvedValue({
      ...snapshotFixture,
      phase: GamePhase.Playing,
    });
    getGameRecord.mockResolvedValue({
      moves: [],
      active: false,
      concluded: false,
      openingName: "",
      rosters: [],
      playerList: [],
      finalBoard: [],
    });

    function Harness() {
      const { data } = useGameState("player-1");
      return <span data-testid="phase">{data?.phase ?? "none"}</span>;
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("phase")).toHaveTextContent("Playing");
    });
  });
});
