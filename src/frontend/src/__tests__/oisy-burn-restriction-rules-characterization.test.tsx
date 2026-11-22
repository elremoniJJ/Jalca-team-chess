import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Oisy burn RESTRICTION RULES, taken BEFORE the burn
 * authorization path is repointed to a wallet-signed ICRC-37 approval.
 *
 * The request intentionally changes HOW a burn is authorized (the "Authorize
 * burn" toggle will open the wallet once to sign a collection-level approval,
 * and burns will route through that approval instead of the collection
 * canister's admin allowlist). That authorization behavior is deliberately NOT
 * asserted here.
 *
 * What IS protected — the restriction rules that decide WHICH NFT may be burned
 * and WHEN, which must survive the authorization change unchanged. The hook
 * exposes them as `canBurn`, `burnDisabledReason`, `burnDisabledReasonFor`, and
 * `burnNoteFor`; the panel consumes exactly those values to enable or disable
 * each burn button:
 *   - an NFT with no spell name cannot be burned, with its own reason;
 *   - a legacy NFT with no game number IS burnable (it burns inert with no
 *     shield or board effect), so it is enabled with no note;
 *   - once a burn has happened this turn, the global and per-NFT gates both
 *     report the already-burned reason;
 *   - a player who is not the Move_Maker is blocked by the global and per-NFT
 *     gates with the Move_Maker reason;
 *   - an eligible Move_Maker's NFT is enabled with no note.
 *
 * The existing suites cover the first-turn Subao Ve-only rule, the spells-off
 * rule, and the not-Move_Maker note wording. This file pins the remaining
 * branches of the same rule set, which no other suite exercises.
 *
 * The backend actor and the oisy-signer module are mocked with typed local
 * mocks (the real @caffeineai/core-infrastructure package does not resolve its
 * submodules in jsdom, and the signer would open a real popup).
 */

vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  BurnedSpellCategory: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  Team: { Black: "Black", White: "White" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
}));

// The hook calls getActor() on connect and reads the spell table through
// useActorState; the actor mock must expose those methods even though this file
// only asserts the restriction gates.
const { actorMethods } = vi.hoisted(() => ({
  actorMethods: {
    updateWalletAddress: vi.fn(),
    burnAndPlay: vi.fn(),
    getNftsForOwner: vi.fn(),
    getNftMetadata: vi.fn(),
  },
}));

// A static spell table used to resolve a spell's burn category from its name.
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 1n,
      complexity: { Moderate: null },
      nftEligible: true,
      meaning: "Defensive shield",
      name: "Subao Ve",
      spell: "block",
      category: { Block: null },
      dropChance: 1n,
    },
    minor: [
      {
        id: 2n,
        complexity: { Easy: null },
        nftEligible: true,
        meaning: "Attacking",
        name: "Minor Spell",
        spell: "minor",
        category: { Minor: null },
        dropChance: 1n,
      },
    ],
    major: [
      {
        id: 3n,
        complexity: { Complex: null },
        nftEligible: true,
        meaning: "Attacking",
        name: "Major Spell",
        spell: "major",
        category: { Major: null },
        dropChance: 1n,
      },
    ],
  },
}));

vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({
    ...actorMethods,
    getSpellTable: vi.fn().mockResolvedValue(spellTable),
  }),
  useActorState: () => ({
    actor: { getSpellTable: vi.fn().mockResolvedValue(spellTable) },
    isLoading: false,
    error: null,
  }),
}));

// The hook consumes useGameState (Move_Maker principal + move list) and
// useBurnState (one-burn-per-turn flag). Both are hoisted so individual tests
// can drive the restriction state deterministically: the Move_Maker seat, the
// first-turn (no moves) vs later-turn (one move) distinction, and the
// already-burned-this-turn flag.
const { gameState, burnState } = vi.hoisted(() => ({
  gameState: {
    moveMaker: "player-1" as string,
    moves: [] as unknown[],
  },
  burnState: { burnOccurredThisTurn: false },
}));

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: { moveMaker: gameState.moveMaker, turn: "White" },
    isLoading: false,
    error: null,
    moves: gameState.moves,
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  }),
}));
vi.mock("@/hooks/use-burn-state", () => ({
  useBurnState: () => ({
    data: { burnOccurredThisTurn: burnState.burnOccurredThisTurn },
    isLoading: false,
    error: null,
  }),
}));

// The hook's mount effect probes the signer library and preloads its modules;
// the connect flow opens the signer. Mock the whole module so no real popup is
// opened, and report the signer as available so the panel path is exercised.
const { isSignerAvailable, preloadSigner } = vi.hoisted(() => ({
  isSignerAvailable: vi.fn(),
  preloadSigner: vi.fn(),
}));
vi.mock("@/oisy-burn/oisy-signer", () => ({
  openOisySignerSync: vi.fn(),
  getOisyAccounts: vi.fn(),
  fetchOwnedNfts: vi.fn(),
  isSignerAvailable,
  preloadSigner,
}));

vi.mock("@icp-sdk/signer", () => ({ __esModule: true, default: {} }));

import type { OisyNft } from "@/oisy-burn/types";
import { useOisyBurn } from "@/oisy-burn/use-oisy-burn";

/** One move, so the game is past the first turn by default. */
const oneMove = {
  from: 12,
  to: 28,
  color: "White",
  piece: "Pawn",
  captured: null,
  capturedSquare: null,
  promotion: null,
  castle: false,
  isEnPassant: false,
};

function makeNft(overrides: Partial<OisyNft> = {}): OisyNft {
  return {
    id: 1n,
    name: "JALCA Game NFT #1",
    thumbnailUrl: null,
    gameNumber: 7n,
    spellName: "Minor Spell",
    ...overrides,
  };
}

/**
 * A harness exposing the per-NFT restriction reason and note plus the global
 * canBurn gate, so the restriction rules can be asserted directly without
 * rendering the whole panel. The panel consumes exactly these values to decide
 * whether each burn button is enabled.
 */
function RestrictionHarness({
  principal,
  nft,
}: {
  principal: string;
  nft: OisyNft;
}) {
  const oisy = useOisyBurn(principal, true);
  return (
    <div>
      <span data-testid="can-burn">{String(oisy.canBurn)}</span>
      <span data-testid="burn-reason">{oisy.burnDisabledReason ?? "NONE"}</span>
      <span data-testid="reason">
        {oisy.burnDisabledReasonFor(nft) ?? "ENABLED"}
      </span>
      <span data-testid="note">{oisy.burnNoteFor(nft) ?? "NO-NOTE"}</span>
    </div>
  );
}

function renderHarness(principal: string, nft: OisyNft) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RestrictionHarness principal={principal} nft={nft} />
    </QueryClientProvider>,
  );
}

describe("useOisyBurn per-NFT restriction reasons", () => {
  beforeEach(() => {
    isSignerAvailable.mockReturnValue(true);
    preloadSigner.mockResolvedValue(true);
    gameState.moveMaker = "player-1";
    gameState.moves = [oneMove];
    burnState.burnOccurredThisTurn = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("disables an NFT with no spell name with its own reason", async () => {
    renderHarness("player-1", makeNft({ spellName: null }));

    await waitFor(() => {
      expect(screen.getByTestId("reason")).toHaveTextContent(
        "This NFT has no spell name and cannot be burned.",
      );
    });
  });

  it("keeps a legacy NFT with no game number burnable (it burns inert)", async () => {
    // A legacy NFT (minted before the jalca: metadata keys) has no game
    // number. It is excluded from shield math entirely and burns inert, but it
    // is still burnable — so the per-NFT gate must NOT block it.
    renderHarness("player-1", makeNft({ gameNumber: null }));

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("reason")).toHaveTextContent("ENABLED");
    expect(screen.getByTestId("note")).toHaveTextContent("NO-NOTE");
  });

  it("disables every burn once a burn has happened this turn", async () => {
    burnState.burnOccurredThisTurn = true;
    renderHarness("player-1", makeNft());

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("false");
    });
    // The global reason and the per-NFT reason both report the one-burn rule.
    expect(screen.getByTestId("burn-reason")).toHaveTextContent(
      "An NFT was already burned this turn.",
    );
    expect(screen.getByTestId("reason")).toHaveTextContent(
      "An NFT was already burned this turn.",
    );
  });

  it("reports the not-Move_Maker restriction through the global and per-NFT gates", async () => {
    // The signed-in player is not the Move_Maker seat.
    gameState.moveMaker = "someone-else";
    renderHarness("player-1", makeNft());

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("false");
    });
    // The global gate and the per-NFT gate both report the Move_Maker rule,
    // which is what the panel uses to disable every burn button.
    expect(screen.getByTestId("burn-reason")).toHaveTextContent(
      "Only the current Move_Maker can burn an NFT.",
    );
    expect(screen.getByTestId("reason")).toHaveTextContent(
      "Only the current Move_Maker can burn an NFT.",
    );
  });

  it("keeps an eligible Move_Maker's NFT enabled with no note", async () => {
    renderHarness("player-1", makeNft());

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("burn-reason")).toHaveTextContent("NONE");
    expect(screen.getByTestId("reason")).toHaveTextContent("ENABLED");
    expect(screen.getByTestId("note")).toHaveTextContent("NO-NOTE");
  });
});
