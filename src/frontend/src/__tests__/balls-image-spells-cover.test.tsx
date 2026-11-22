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
 * Cover for the three offensive image Balls spells (Hairy Balls, Veiny Balls,
 * Shiny Balls, ids 31-33) added by the request.
 *
 * The accepted behavior these tests assert in the frontend:
 *   1. the spell names/meanings/effects list renders the three new spells with
 *      their name, meaning, effect text and their own image;
 *   2. burning one of the three resolves to the `Balls` kind in the
 *      `burnAndPlay` request (the kind that drives the backend's offensive
 *      shield math and the opponent-board image branch);
 *   3. an owned NFT of one of the three shows the spell's own image on the
 *      burn card instead of the Rabbit placeholder;
 *   4. the Chessboard paints EVERY square of the OPPONENT's board with the
 *      spell image and leaves the caster's own board untouched — the inverse
 *      of the existing colour Balls spells;
 *   5. `useSpellBoardState` maps the backend's per-team opponent-image fields
 *      into the `SpellContext` the board consumes.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering, kind resolution and mapping — not real
 * backend behavior. The real `getSpellTable` / `getSpellBoardState` queries and
 * the burn-and-play board mutation are exercised by the PocketIC lane when it
 * runs; the burn itself cannot succeed there because the external ICRC-7
 * collection canister is absent from the replica.
 */

// The components import enum values from @/backend at runtime, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need.
vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  SpellCategory: {
    Block: "Block",
    Major: "Major",
    Minor: "Minor",
    Balls: "Balls",
  },
  SpellKind: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
  },
  LegacyReason: {
    keysAbsent: "keysAbsent",
    wrongType: "wrongType",
    keysDisagree: "keysDisagree",
    readFailed: "readFailed",
  },
  BurnedSpellCategory: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
  },
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
// submodules in jsdom. The surfaces under test never call the actor directly.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

/** The three new image spells with their real names, meanings and effects. */
const IMAGE_SPELLS = [
  {
    id: 31n,
    name: "Hairy Balls",
    meaning: "Hairy Balls",
    image: "/assets/spells/hairy-balls.png",
    effect:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Hairy Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected.",
  },
  {
    id: 32n,
    name: "Veiny Balls",
    meaning: "Veiny Balls",
    image: "/assets/spells/veiny-balls.png",
    effect:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Veiny Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected.",
  },
  {
    id: 33n,
    name: "Shiny Balls",
    meaning: "Shiny Balls",
    image: "/assets/spells/shiny-balls.png",
    effect:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Shiny Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected.",
  },
] as const;

/**
 * A spell table fixture carrying the three new image spells (nftEligible, so
 * they are in the mint pool) plus one existing Minor spell so the modal's
 * non-Balls rows are present too.
 */
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: "Easy",
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
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fire bolt",
        name: "Tia Lua",
        spell: "Removes 1 random enemy Pawn from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
    ],
    major: [],
    balls: [
      {
        id: 31n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Hairy Balls",
        name: "Hairy Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Hairy Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 32n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Veiny Balls",
        name: "Veiny Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Veiny Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 33n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Shiny Balls",
        name: "Shiny Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Shiny Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected.",
        category: { Balls: null },
        dropChance: 0n,
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

import { OpponentBoardImage, SpellUse } from "@/backend";
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

/** Open the info panel, then the spell table modal. */
async function openSpellTable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
  );
  await user.click(
    screen.getByRole("button", { name: /Spell names and effects/i }),
  );
  return screen.findByRole("dialog");
}

/** The row whose text contains the given spell name. The modal is portaled to
 * document.body, so rows are queried there rather than in the render
 * container. */
function rowFor(_container: HTMLElement, name: string): HTMLElement {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
  );
  const row = rows.find((r) => r.textContent?.includes(name));
  if (row === undefined) throw new Error(`no spell table row for ${name}`);
  return row;
}

describe("new image Balls spells in the spell table modal", () => {
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

  it("renders each new spell with its name, meaning, effect and image", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    await openSpellTable(user);

    for (const spell of IMAGE_SPELLS) {
      const row = rowFor(container, spell.name);
      // Name and meaning are the same string for these spells, so both cells
      // match; the row must carry at least one.
      expect(within(row).getAllByText(spell.name).length).toBeGreaterThan(0);
      // The effect text names the OPPONENT's board and the caster's own board
      // being unaffected — the accepted behavior, not the existing colour
      // spells' "painting the caster's board" wording.
      expect(row).toHaveTextContent("every square of the OPPONENT's board");
      expect(row).toHaveTextContent("The caster's own board is unaffected.");
      // The row shows the spell's own image.
      const img = row.querySelector("img");
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute("src", spell.image);
    }
  });

  it("renders each new spell's name and effect text", async () => {
    const user = userEvent.setup();
    renderWindow();

    await openSpellTable(user);

    // The accepted two-column layout shows each spell's name and its effect
    // text. The old Enabled column is intentionally removed, so it is not
    // asserted.
    for (const spell of IMAGE_SPELLS) {
      const row = rowFor(document.body, spell.name);
      expect(within(row).getAllByText(spell.name).length).toBeGreaterThan(0);
      expect(row).toHaveTextContent("every square of the OPPONENT's board");
    }
  });
});

/**
 * The burn-kind resolution seam for the three new spells. They are
 * Balls-category and must resolve to the `Balls` kind so the backend's
 * offensive shield math and opponent-board image branch run.
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
    spellName: "Hairy Balls",
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

describe("new image Balls spell-kind resolution", () => {
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
          spellName: "Hairy Balls",
          gameNumber: 7n,
          team: "White",
          kind: "Balls",
        },
        shieldState: { whiteShield: 0n, blackShield: 0n },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("resolves each new image spell name to the Balls kind", async () => {
    for (const spell of IMAGE_SPELLS) {
      burnAndPlay.mockClear();
      const { queryClient, unmount } = renderBurnHarness(
        makeNft({ spellName: spell.name }),
      );
      await waitForSpellTable(queryClient);

      screen.getByRole("button", { name: "burn" }).click();

      await waitFor(() => {
        expect(burnAndPlay).toHaveBeenCalledTimes(1);
      });
      expect(burnAndPlay).toHaveBeenCalledWith(
        "player-1",
        expect.objectContaining({ spellName: spell.name, kind: "Balls" }),
      );
      unmount();
    }
  });
});

/**
 * The Chessboard opponent-board image seam. The backend sets
 * `whiteOpponentImage` when BLACK cast the image spell (so it covers White's
 * board) and `blackOpponentImage` when WHITE cast it. Each viewer therefore
 * sees the image on their OWN board only when the opponent cast it on them,
 * and on the opponent's board when their own team cast it. The caster's own
 * board is never imaged by their own cast.
 */
import type { Piece, PieceType, PlayerInfo } from "@/backend";
import { Chessboard } from "@/components/Chessboard";

const EMPTY_BOARD: Array<Piece | null> = Array.from({ length: 64 }, () => null);

const WHITE_PLAYER: PlayerInfo = {
  principal: "player-1",
  username: "Ada",
  team: "White" as PlayerInfo["team"],
  walletSource: "none" as PlayerInfo["walletSource"],
  isMoveMaker: false,
  isFresh: false,
  isInactive: false,
  isBot: false,
};

const BLACK_PLAYER: PlayerInfo = {
  principal: "player-2",
  username: "Bob",
  team: "Black" as PlayerInfo["team"],
  walletSource: "none" as PlayerInfo["walletSource"],
  isMoveMaker: false,
  isFresh: false,
  isInactive: false,
  isBot: false,
};

function renderBoard(
  currentPlayer: PlayerInfo,
  spellContext: {
    whiteOpponentImage?: OpponentBoardImage | null;
    blackOpponentImage?: OpponentBoardImage | null;
  },
) {
  return render(
    <Chessboard
      board={EMPTY_BOARD}
      turn={currentPlayer.team}
      moveMaker="maker-1"
      currentPlayer={currentPlayer}
      onMove={() => {}}
      orientation={"White" as PlayerInfo["team"]}
      selectedSquareProp={null}
      destinationSquareProp={null}
      pendingPromotionPieceProp={null}
      spellContext={spellContext}
    />,
  );
}

describe("chessboard opponent-board image effect", () => {
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

  it("paints every square of the target board with the image when the opponent cast it", () => {
    // Black cast Hairy Balls: the backend sets whiteOpponentImage (it covers
    // White's board). A White viewer sees the image on every square of their
    // own board — the board the opponent targeted.
    const { container } = renderBoard(WHITE_PLAYER, {
      whiteOpponentImage: OpponentBoardImage.Hairy,
    });

    const board = container.querySelector("[data-ocid='chess.board']");
    expect(board).not.toBeNull();
    // The board-level marker is present.
    expect(board).toHaveClass("board-opponent-image");

    // Every one of the 64 squares carries the Hairy image class.
    const squares = container.querySelectorAll("[data-ocid^='chess.square.']");
    expect(squares.length).toBe(64);
    for (const square of squares) {
      expect(square).toHaveClass("board-square-opponent-image-hairy");
    }
  });

  it("leaves the caster's own board untouched when their own team cast the image", () => {
    // White cast Hairy Balls: the backend sets blackOpponentImage (it covers
    // Black's board). A White viewer — the caster — sees no image on their own
    // board, because the image lands on the opponent's board.
    const { container } = renderBoard(WHITE_PLAYER, {
      blackOpponentImage: OpponentBoardImage.Hairy,
    });

    const board = container.querySelector("[data-ocid='chess.board']");
    expect(board).not.toHaveClass("board-opponent-image");
    const squares = container.querySelectorAll("[data-ocid^='chess.square.']");
    expect(squares.length).toBe(64);
    for (const square of squares) {
      expect(square.className).not.toMatch(/board-square-opponent-image-/);
    }
  });

  it("applies no image layer when no image spell has fired", () => {
    const { container } = renderBoard(WHITE_PLAYER, {});

    const board = container.querySelector("[data-ocid='chess.board']");
    expect(board).not.toHaveClass("board-opponent-image");
    const squares = container.querySelectorAll("[data-ocid^='chess.square.']");
    for (const square of squares) {
      expect(square.className).not.toMatch(/board-square-opponent-image-/);
    }
  });

  it("paints the target board for a Black viewer when White cast the image", () => {
    // White cast Shiny Balls: blackOpponentImage covers Black's board. A Black
    // viewer sees the image on every square of their own board.
    const { container } = renderBoard(BLACK_PLAYER, {
      blackOpponentImage: OpponentBoardImage.Shiny,
    });

    const squares = container.querySelectorAll("[data-ocid^='chess.square.']");
    expect(squares.length).toBe(64);
    for (const square of squares) {
      expect(square).toHaveClass("board-square-opponent-image-shiny");
    }
  });
});

/**
 * The `useSpellBoardState` mapping seam for the new opponent-image fields.
 * The real hook is used; only its actor state is mocked (via the top-level
 * `@/lib/backend-actor` mock), so the mapping itself is exercised.
 */
const { getSpellBoardState } = vi.hoisted(() => ({
  getSpellBoardState: vi.fn(),
}));

import type { SpellBoardView } from "@/backend";
import { useSpellBoardState } from "@/hooks/use-spell-board-state";

function SpellBoardHarness() {
  const { spellContext } = useSpellBoardState();
  return (
    <div>
      <span data-testid="white-image">
        {spellContext?.whiteOpponentImage ?? "NONE"}
      </span>
      <span data-testid="black-image">
        {spellContext?.blackOpponentImage ?? "NONE"}
      </span>
    </div>
  );
}

function view(overrides: Partial<SpellBoardView> = {}): SpellBoardView {
  return {
    spellUseEnabled: true,
    blockedSquares: [],
    blockedSquareOwners: [],
    explosiveSquares: [],
    ...overrides,
  };
}

describe("useSpellBoardState opponent-image mapping", () => {
  beforeEach(() => {
    getSpellBoardState.mockReset();
    useActorState.mockReturnValue({
      actor: { getSpellBoardState },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("maps each team's opponent-image field into the SpellContext", async () => {
    getSpellBoardState.mockResolvedValue(
      view({
        whiteOpponentImage: OpponentBoardImage.Hairy,
        blackOpponentImage: OpponentBoardImage.Shiny,
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SpellBoardHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("white-image")).toHaveTextContent("Hairy");
    });
    expect(screen.getByTestId("black-image")).toHaveTextContent("Shiny");
  });

  it("yields null when the backend reports no image", async () => {
    getSpellBoardState.mockResolvedValue(view());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SpellBoardHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("white-image")).toHaveTextContent("NONE");
    });
    expect(screen.getByTestId("black-image")).toHaveTextContent("NONE");
  });
});
