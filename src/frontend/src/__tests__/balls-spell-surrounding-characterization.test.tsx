import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the behavior SURROUNDING the Balls spell category,
 * taken BEFORE the Balls work lands.
 *
 * The request intentionally changes four things, which this file deliberately
 * does NOT pin:
 *   - the spell table gains a new Balls category with five spells;
 *   - the polled spell state gains a per-team board colour field;
 *   - the board renderer gains a per-viewer colour override;
 *   - the wordmark version moves from v262 to v264.
 *
 * What IS protected here is the surrounding behavior those changes must not
 * disturb:
 *   1. the spell-table modal still renders the EXISTING Block / Minor / Major
 *      spells with their name, meaning, function, and enabled marker, and the
 *      existing categories still resolve to their existing burn kinds
 *      (Subao Ve -> SubaoVe, a Major spell -> Major, anything else -> Minor);
 *   2. the board's default square colouring is unchanged when no colour
 *      override is present: light/dark squares still carry
 *      `board-square-light` / `board-square-dark`, and the piece, selection,
 *      last-move, check, blocked-square and explosive overlays keep their
 *      existing classes — the new colour override must apply only to the
 *      board squares, never to those overlays.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering and kind resolution — not real backend
 * behavior. The real `getSpellTable` / `getSpellBoardState` queries are
 * exercised by the PocketIC lane when it runs.
 */

// The components import enum values from @/backend at runtime, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need.
vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  SpellCategory: { Block: "Block", Major: "Major", Minor: "Minor" },
  SpellKind: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  LegacyReason: {
    keysAbsent: "keysAbsent",
    wrongType: "wrongType",
    keysDisagree: "keysDisagree",
    readFailed: "readFailed",
  },
  BurnedSpellCategory: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  BallsColourFamily: {
    Sandy: "Sandy",
    Cloudy: "Cloudy",
    Grassy: "Grassy",
    Fiery: "Fiery",
    Wooden: "Wooden",
  },
  OpponentBoardImage: { Hairy: "Hairy", Veiny: "Veiny", Shiny: "Shiny" },
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// AdvicePopup -> lib/backend-actor imports createActorWithConfig from
// @caffeineai/core-infrastructure, which also fails to resolve its own
// submodules in jsdom. The board rendering under test never calls the actor.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

// A static spell table carrying the EXISTING categories only. The Balls
// category is the intentional change and is not asserted here; this fixture
// pins that the existing categories keep rendering and resolving.
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: { Easy: null },
      nftEligible: true,
      meaning: "Protection",
      name: "Subao Ve",
      spell: "Preemptively sets up a shield.",
      category: { Block: null },
      dropChance: 8n,
    },
    minor: [
      {
        id: 10n,
        complexity: { Easy: null },
        nftEligible: true,
        meaning: "Fire bolt",
        name: "Tia Lua",
        spell: "Removes 1 random enemy Pawn from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 18n,
        complexity: { Complex: null },
        nftEligible: false,
        meaning: "Bouvet Island",
        name: "Bouvet Hondao",
        spell: "Permanently blocks 1 random empty square.",
        category: { Minor: null },
        dropChance: 10n,
      },
    ],
    major: [
      {
        id: 1n,
        complexity: { Moderate: null },
        nftEligible: false,
        meaning: "Queen horse",
        name: "Newkai Dodan",
        spell: "Replaces the enemy Queen with an enemy Knight.",
        category: { Major: null },
        dropChance: 2n,
      },
    ],
  },
}));

const { getSpellTable, useActorState, useGameState, useBurnState } = vi.hoisted(
  () => ({
    getSpellTable: vi.fn(),
    useActorState: vi.fn(),
    useGameState: vi.fn(),
    useBurnState: vi.fn(),
  }),
);

vi.mock("@/lib/backend-actor", () => ({
  useActorState,
  getActor: vi.fn().mockResolvedValue({ getSpellTable, burnAndPlay }),
}));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock
// it to a marker so the window test stays focused on the spell table.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { SpellUse, Team } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

function renderWindow() {
  // Seed the NFT wallet window open so its body (and the info panel) mounts
  // regardless of the collapsed-by-default first-visit state.
  window.localStorage.setItem("tco-wallet-connection-open", "true");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletConnectionWindow spellUse={SpellUse.On} />
    </QueryClientProvider>,
  );
}

describe("spell table existing categories", () => {
  beforeEach(() => {
    window.localStorage.clear();
    getSpellTable.mockResolvedValue(spellTable);
    useActorState.mockReturnValue({
      actor: { getSpellTable },
      isLoading: false,
      error: null,
      retry: () => {},
    });
    useGameState.mockReturnValue({
      data: { moveMaker: "player-1", turn: "White" },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the existing Block, Minor and Major spells with their details", async () => {
    const user = userEvent.setup();
    renderWindow();

    // Open the info panel, then the spell table modal.
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Spell names and effects/i }),
    );

    const dialog = await screen.findByRole("dialog");
    // The existing Block spell is present with its name and function. The
    // accepted request removes the MEANING column, so the meaning text no
    // longer renders and is not asserted here.
    expect(within(dialog).getByText("Subao Ve")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Preemptively sets up a shield."),
    ).toBeInTheDocument();
    // The existing Minor spells are present.
    expect(within(dialog).getByText("Tia Lua")).toBeInTheDocument();
    expect(within(dialog).getByText("Bouvet Hondao")).toBeInTheDocument();
    // The existing Major spell is present.
    expect(within(dialog).getByText("Newkai Dodan")).toBeInTheDocument();
  });

  it("renders one row per existing spell in the table", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Spell names and effects/i }),
    );

    await screen.findByRole("dialog");
    // The rows are ordered block, minor, major. The fixture carries the four
    // existing spells, so the modal renders exactly four rows — the Balls
    // category is the intentional change and is not part of this fixture.
    const rows = container.querySelectorAll("[data-ocid^='spell_table.row.']");
    expect(rows.length).toBe(4);
    expect(rows[0]).toHaveTextContent("Subao Ve");
    expect(rows[1]).toHaveTextContent("Tia Lua");
    expect(rows[2]).toHaveTextContent("Bouvet Hondao");
    expect(rows[3]).toHaveTextContent("Newkai Dodan");
  });
});

/**
 * The burn-kind resolution seam. The Balls category is added to the spell
 * table, but the EXISTING categories must keep resolving to their existing
 * backend kinds so the shield math and the first-turn restriction are
 * unaffected.
 */
const { burnAndPlay } = vi.hoisted(() => ({ burnAndPlay: vi.fn() }));

vi.mock("@/oisy-burn/oisy-signer", () => ({
  openOisySignerSync: vi.fn(),
  getOisyAccounts: vi.fn(),
  fetchOwnedNfts: vi.fn().mockResolvedValue([]),
  isSignerAvailable: vi.fn().mockReturnValue(true),
  preloadSigner: vi.fn().mockResolvedValue(true),
}));

vi.mock("@icp-sdk/signer", () => ({ __esModule: true, default: {} }));

import type { OisyNft } from "@/oisy-burn/types";
import { useOisyBurn } from "@/oisy-burn/use-oisy-burn";

function makeNft(overrides: Partial<OisyNft> = {}): OisyNft {
  return {
    id: 42n,
    name: "JALCA Game NFT #42",
    thumbnailUrl: null,
    gameNumber: 7n,
    spellName: "Tia Lua",
    ...overrides,
  };
}

function BurnHarness({ nft }: { nft: OisyNft }) {
  const oisy = useOisyBurn("player-1", true);
  return (
    <button type="button" onClick={() => void oisy.burnOne(nft)}>
      burn
    </button>
  );
}

function renderBurnHarness(nft: OisyNft) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <BurnHarness nft={nft} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

async function waitForSpellTable(queryClient: QueryClient) {
  await waitFor(() => {
    expect(queryClient.getQueryData(["spellTable"])).toBeDefined();
  });
}

describe("existing spell-kind resolution", () => {
  beforeEach(() => {
    burnAndPlay.mockReset();
    getSpellTable.mockResolvedValue(spellTable);
    useActorState.mockReturnValue({
      actor: { getSpellTable },
      isLoading: false,
      error: null,
      retry: () => {},
    });
    useGameState.mockReturnValue({
      data: { moveMaker: "player-1", turn: "White" },
      isLoading: false,
      error: null,
      moves: [
        {
          from: 12,
          to: 28,
          color: "White",
          piece: "Pawn",
          captured: null,
          capturedSquare: null,
          promotion: null,
          castle: false,
          isEnPassant: false,
        },
      ],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
    });
    burnAndPlay.mockResolvedValue({
      __kind__: "ok",
      ok: {
        burn: {
          tokenId: 42n,
          spellName: "Tia Lua",
          gameNumber: 7n,
          team: Team.White,
          kind: "Minor",
        },
        shieldState: { whiteShield: 0n, blackShield: 0n },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("resolves the existing Block spell (Subao Ve) to the SubaoVe kind", async () => {
    const { queryClient } = renderBurnHarness(
      makeNft({ spellName: "Subao Ve", gameNumber: 5n }),
    );
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(burnAndPlay).toHaveBeenCalledTimes(1);
    });
    expect(burnAndPlay).toHaveBeenCalledWith(
      "player-1",
      expect.objectContaining({ spellName: "Subao Ve", kind: "SubaoVe" }),
    );
  });

  it("resolves an existing Major spell to the Major kind", async () => {
    const { queryClient } = renderBurnHarness(
      makeNft({ spellName: "Newkai Dodan", gameNumber: 9n }),
    );
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(burnAndPlay).toHaveBeenCalledTimes(1);
    });
    expect(burnAndPlay).toHaveBeenCalledWith(
      "player-1",
      expect.objectContaining({ spellName: "Newkai Dodan", kind: "Major" }),
    );
  });

  it("resolves an existing Minor spell to the Minor kind", async () => {
    const { queryClient } = renderBurnHarness(makeNft());
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(burnAndPlay).toHaveBeenCalledTimes(1);
    });
    expect(burnAndPlay).toHaveBeenCalledWith(
      "player-1",
      expect.objectContaining({ spellName: "Tia Lua", kind: "Minor" }),
    );
  });
});

/**
 * The board's default colouring and overlay classes. The new per-viewer
 * colour override must apply ONLY to the board squares; the piece, selection,
 * last-move, check, blocked-square and explosive overlays keep their existing
 * appearance. With no colour override present, the squares keep the default
 * theme classes.
 */
import type { Piece, PieceType, PlayerInfo } from "@/backend";
import { Chessboard } from "@/components/Chessboard";

const EMPTY_BOARD: Array<Piece | null> = Array.from({ length: 64 }, () => null);

function piece(pieceType: PieceType, color: Team): Piece {
  return { pieceType, color, summoned: false };
}

const WHITE_PLAYER: PlayerInfo = {
  principal: "player-1",
  username: "Ada",
  team: Team.White,
  walletSource: "none" as PlayerInfo["walletSource"],
  isMoveMaker: false,
  isFresh: false,
  isInactive: false,
  isBot: false,
};

function renderBoard(
  board: Array<Piece | null>,
  spellContext: {
    blockedSquares?: Set<number>;
    blockedSquareOwners?: Map<number, Team>;
    explosiveSquares?: Set<number>;
    explosiveOwners?: Map<number, Team>;
  },
  extras: {
    selectedSquareProp?: number | null;
    destinationSquareProp?: number | null;
    checkSquare?: number | null;
    lastMove?: {
      from: number;
      to: number;
      color: Team;
      piece: PieceType;
      captured: PieceType | null;
      capturedSquare: number | null;
      promotion: PieceType | null;
      castle: boolean;
      isEnPassant: boolean;
    } | null;
  } = {},
) {
  return render(
    <Chessboard
      board={board}
      turn={Team.White}
      moveMaker="maker-1"
      currentPlayer={WHITE_PLAYER}
      onMove={() => {}}
      orientation={Team.White}
      selectedSquareProp={extras.selectedSquareProp ?? null}
      destinationSquareProp={extras.destinationSquareProp ?? null}
      pendingPromotionPieceProp={null}
      checkSquare={extras.checkSquare ?? null}
      lastMove={extras.lastMove ?? null}
      spellContext={spellContext}
    />,
  );
}

describe("board default colouring and overlay classes", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the default light/dark square classes when no colour override is present", () => {
    renderBoard(EMPTY_BOARD, {});

    // a1 (rank 0, file 0) is light; b1 (rank 0, file 1) is dark.
    const a1 = screen.getByRole("button", { name: /Square a1/ });
    const b1 = screen.getByRole("button", { name: /Square b1/ });
    expect(a1).toHaveClass("board-square-light");
    expect(b1).toHaveClass("board-square-dark");
  });

  it("keeps the selection, destination, last-move and check overlays on their squares", () => {
    renderBoard(
      EMPTY_BOARD,
      {},
      {
        selectedSquareProp: 0,
        destinationSquareProp: 1,
        checkSquare: 4,
        lastMove: {
          from: 8,
          to: 16,
          color: Team.White,
          piece: "Pawn" as PieceType,
          captured: null,
          capturedSquare: null,
          promotion: null,
          castle: false,
          isEnPassant: false,
        },
      },
    );

    expect(
      screen
        .getByRole("button", { name: /Square a1/ })
        .querySelector(".sq-selected"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: /Square b1/ })
        .querySelector(".sq-destination"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: /Square e1/ })
        .querySelector(".sq-check"),
    ).toBeInTheDocument();
    // The last-move overlay covers both the from and to squares.
    expect(
      screen
        .getByRole("button", { name: /Square a2/ })
        .querySelector(".sq-last-move"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: /Square a3/ })
        .querySelector(".sq-last-move"),
    ).toBeInTheDocument();
  });

  it("keeps the blocked-square and explosive overlays on their squares", () => {
    renderBoard(EMPTY_BOARD, {
      blockedSquares: new Set<number>([8]),
      blockedSquareOwners: new Map<number, Team>([[8, Team.White]]),
      explosiveSquares: new Set<number>([27]),
      explosiveOwners: new Map<number, Team>([[27, Team.White]]),
    });

    expect(
      screen
        .getByRole("button", { name: /Square a2/ })
        .querySelector(".sq-blocked"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: /Square d4/ })
        .querySelector(".sq-explosive"),
    ).toBeInTheDocument();
  });

  it("renders the piece on its square independently of the square colour", () => {
    const board = [...EMPTY_BOARD];
    board[4] = piece("King" as PieceType, Team.White);
    renderBoard(board, {});

    const e1 = screen.getByRole("button", { name: /Square e1/ });
    // The square keeps its default colour class and still carries the piece.
    expect(e1).toHaveClass("board-square-light");
    expect(e1).toHaveAccessibleName(/White King/);
  });

  it("keeps the coordinate labels as overlays outside the square buttons", () => {
    // The coordinate labels are absolutely-positioned overlays on top of the
    // board grid, not children of the square buttons. The new per-viewer
    // colour override applies only to the board squares, so the labels must
    // stay outside the recoloured elements and keep their existing classes.
    const { container } = renderBoard(EMPTY_BOARD, {});

    const board = container.querySelector("[data-ocid='chess.board']");
    expect(board).not.toBeNull();

    // The file/rank labels render as aria-hidden overlay layers, each a
    // grid of eight labels, and none of them lives inside a square button.
    const overlays = container.querySelectorAll(
      ".absolute.grid.pointer-events-none[aria-hidden='true']",
    );
    expect(overlays.length).toBeGreaterThanOrEqual(4);
    for (const overlay of overlays) {
      expect(overlay.closest("button")).toBeNull();
    }

    // The labels themselves keep their existing font/colour classes.
    const fileLabel = container.querySelector(
      ".absolute.top-0.left-0.right-0.grid.grid-cols-8",
    );
    expect(fileLabel).not.toBeNull();
    expect(fileLabel?.textContent).toContain("a");
    expect(fileLabel?.textContent).toContain("h");
    const rankLabel = container.querySelector(
      ".absolute.top-0.bottom-0.left-0.grid.grid-rows-8",
    );
    expect(rankLabel).not.toBeNull();
    expect(rankLabel?.textContent).toContain("1");
    expect(rankLabel?.textContent).toContain("8");
  });
});
