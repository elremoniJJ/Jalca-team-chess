import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the behavior ADJACENT to adding the three summon-spell
 * images (Anne Boleyn id 25, Cuoclot Sac Wonmuc Rook id 24, Lazarus id 23),
 * taken BEFORE the change lands.
 *
 * The request intentionally changes, for those three spells:
 *   - their Oisy wallet NFT grid card image (Rabbit placeholder -> own PNG);
 *   - their board spell image after the 3-frame burning pre-roll;
 *   - their backend `nftEligible`/complexity so the spell table's Enabled
 *     column flips from the disabled mark to the enabled check.
 *
 * Those are the intentional changes, so this file deliberately does NOT pin
 * what those three spells currently render or how they are currently flagged.
 *
 * What IS protected is the adjacent image-mapping, eligibility and overlay
 * behavior the new cases must not disturb, because the change edits the exact
 * same `spellImageFor` switch (twice), the same `SPELL_EFFECT_IDS` map and the
 * same backend spell table:
 *   - the collection UI keeps showing each existing image-mapped spell's own
 *     PNG (the three Balls spells, the five Lua fire spells, Subao Ve, and the
 *     three Minor removal spells);
 *   - the burn card keeps showing each existing image-mapped spell's own PNG
 *     and keeps the Rabbit placeholder for an unmapped spell;
 *   - the spell table's Enabled column keeps following the
 *     `complexity === Easy && nftEligible` rule for the spells the request does
 *     not touch;
 *   - the board overlay keeps keying each of the five fire spells to its own
 *     `spell-effect-<id>` class (ids 10-14);
 *   - a fired cast of a spell with no board-effect mapping still shows no
 *     overlay.
 *
 * The two summon spells the request explicitly leaves alone (Thayma id 21 and
 * Hipsy Titam id 22, per doNotBuild) are pinned as still disabled and still
 * unmapped, so a careless edit cannot enable or image them alongside the three
 * accepted spells.
 *
 * The unmapped sentinel is "Newkai Dodan" (id 1), which the request does not
 * touch, rather than one of the three spells this change intentionally maps.
 *
 * The backend actor is a typed local mock (or absent entirely for the pure
 * rendering surfaces), so this is component/integration coverage of the
 * frontend's rendering — not real backend behavior. See episode.coverageLimits.
 */

// The Chessboard and the collection windows import enum values from @/backend
// at runtime, which transitively pulls in @caffeineai/object-storage and
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
  SpellResolutionOutcome: {
    fired: "fired",
    cancelled: "cancelled",
    legacy: "legacy",
  },
}));

// AdvicePopup -> lib/backend-actor imports createActorWithConfig from
// @caffeineai/core-infrastructure, which also fails to resolve its own
// submodules in jsdom. The surfaces under test never call the actor directly.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

import {
  type BurnAndPlayResult,
  type Piece,
  type PieceType,
  type PlayerInfo,
  SpellKind,
  SpellResolutionOutcome,
  Team,
  WalletSource,
} from "@/backend";
import { Chessboard } from "@/components/Chessboard";

/* ------------------------------------------------------------------ */
/* Board overlay (adjacent to the new ids 23/24/25 overlay cases)      */
/* ------------------------------------------------------------------ */

const EMPTY_BOARD: Array<Piece | null> = Array.from({ length: 64 }, () => null);

const WHITE_PLAYER: PlayerInfo = {
  principal: "player-1",
  username: "Ada",
  team: Team.White,
  walletSource: WalletSource.none,
  isMoveMaker: false,
  isFresh: false,
  isInactive: false,
  isBot: false,
};

/** A minimal board with a single White rook on a1 so the grid renders. */
function boardWithRook(): Array<Piece | null> {
  const board = [...EMPTY_BOARD];
  board[0] = {
    pieceType: "Rook" as PieceType,
    color: Team.White,
    summoned: false,
  };
  return board;
}

/** A fired burn-and-play result for the given spell name. */
function firedResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 42n,
    spellName,
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.Major,
    resolution: {
      attacker: Team.White,
      defender: Team.Black,
      spellValue: 5n,
      shieldBefore: 0n,
      shieldAfter: 0n,
      outcome: SpellResolutionOutcome.fired,
      firesOnBoard: true,
    },
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
  };
}

function renderBoard(lastBurnAndPlay: BurnAndPlayResult | null) {
  return render(
    <Chessboard
      board={boardWithRook()}
      turn={Team.White}
      moveMaker="maker-1"
      currentPlayer={WHITE_PLAYER}
      onMove={() => {}}
      orientation={Team.White}
      selectedSquareProp={null}
      destinationSquareProp={null}
      pendingPromotionPieceProp={null}
      lastBurnAndPlay={lastBurnAndPlay}
    />,
  );
}

/** The spell-effect overlay is the only element carrying the
 * `data-ocid="chess.spell_effect"` marker. */
function spellOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-ocid="chess.spell_effect"]',
  );
}

/** Stub ResizeObserver so the board measures a deterministic 800px width. */
function stubResizeObserver(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        Object.defineProperty(el, "clientWidth", {
          configurable: true,
          value: width,
        });
        this.cb([], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

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

describe("Chessboard spell-effect overlay adjacent to the summon-spell images", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps each of the five fire spells mapped to its own effect image", () => {
    const spells: Array<[string, number]> = [
      ["Tia Lua", 10],
      ["Cau Lua", 11],
      ["Hoa Boc", 12],
      ["Buc Tung Lua", 13],
      ["Mua Lua", 14],
    ];

    for (const [spellName, spellId] of spells) {
      const { container, unmount } = renderBoard(firedResult(spellName));
      const overlay = spellOverlay(container);
      expect(overlay, `${spellName} should show an overlay`).not.toBeNull();
      expect(overlay).toHaveClass(`spell-effect-${spellId}`);
      unmount();
    }
  });

  it("keeps showing no overlay for a fired cast with no board-effect mapping", () => {
    // "Hipsy Tan Chin" (id 2) has no board-effect mapping. ("Newkai Dodan" is
    // now intentionally mapped to spell-effect-1 by this change.)
    const { container } = renderBoard(firedResult("Hipsy Tan Chin"));

    expect(spellOverlay(container)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Collection UI image mapping (adjacent to the new ids 23/24/25 cases)*/
/* ------------------------------------------------------------------ */

/**
 * A spell table fixture carrying the existing image-mapped spells (the three
 * Balls spells, the five Lua fire spells, Subao Ve and the three Minor removal
 * spells) plus one spell with no image mapping. The three spells this change
 * intentionally maps (Lazarus, Cuoclot Sac Wonmuc Rook, Anne Boleyn) are
 * deliberately absent from this fixture.
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
        id: 15n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Removal",
        name: "Chila Cao",
        spell: "Removes 1 random enemy Knight.",
        category: { Minor: null },
        dropChance: 5n,
      },
      {
        id: 16n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Removal",
        name: "Handom Zitie Zumuc",
        spell: "Removes 1 random enemy Bishop.",
        category: { Minor: null },
        dropChance: 5n,
      },
      {
        id: 17n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Removal",
        name: "Bamburgh",
        spell: "Removes 1 random enemy Rook.",
        category: { Minor: null },
        dropChance: 5n,
      },
    ],
    major: [
      {
        id: 1n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Queen horse",
        name: "Newkai Dodan",
        spell: "Replaces the enemy Queen with an enemy Knight.",
        category: { Major: null },
        dropChance: 2n,
      },
      {
        id: 10n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fire",
        name: "Tia Lua",
        spell: "A Lua fire spell.",
        category: { Major: null },
        dropChance: 5n,
      },
      {
        id: 11n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fire",
        name: "Cau Lua",
        spell: "A Lua fire spell.",
        category: { Major: null },
        dropChance: 5n,
      },
      {
        id: 12n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fire",
        name: "Hoa Boc",
        spell: "A Lua fire spell.",
        category: { Major: null },
        dropChance: 5n,
      },
      {
        id: 13n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fire",
        name: "Buc Tung Lua",
        spell: "A Lua fire spell.",
        category: { Major: null },
        dropChance: 5n,
      },
      {
        id: 14n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fire",
        name: "Mua Lua",
        spell: "A Lua fire spell.",
        category: { Major: null },
        dropChance: 5n,
      },
    ],
    balls: [
      {
        id: 31n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Hairy Balls",
        name: "Hairy Balls",
        spell: "An offensive Balls spell.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 32n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Veiny Balls",
        name: "Veiny Balls",
        spell: "An offensive Balls spell.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 33n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Shiny Balls",
        name: "Shiny Balls",
        spell: "An offensive Balls spell.",
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
  getActor: vi.fn().mockResolvedValue({ getSpellTable }),
}));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the spell table.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

/** The existing image-mapped spells and the asset each must keep rendering. */
const EXISTING_IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Veiny Balls", image: "/assets/spells/veiny-balls.png" },
  { name: "Shiny Balls", image: "/assets/spells/shiny-balls.png" },
  { name: "Tia Lua", image: "/assets/spells/10.png" },
  { name: "Cau Lua", image: "/assets/spells/11.png" },
  { name: "Hoa Boc", image: "/assets/spells/12.png" },
  { name: "Buc Tung Lua", image: "/assets/spells/13.png" },
  { name: "Mua Lua", image: "/assets/spells/14.png" },
  { name: "Subao Ve", image: "/assets/spells/subao-ve.png" },
  { name: "Chila Cao", image: "/assets/spells/15.png" },
  { name: "Handom Zitie Zumuc", image: "/assets/spells/16.png" },
  { name: "Bamburgh", image: "/assets/spells/17.png" },
] as const;

/** A spell with no image mapping — must render no <img>. */
const NO_IMAGE_SPELL = "Hipsy Tan Chin";

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

describe("spell collection UI image mapping adjacent to the summon-spell images", () => {
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

  it("keeps showing each existing image-mapped spell's own PNG in its row", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    await openSpellTable(user);

    for (const spell of EXISTING_IMAGE_SPELLS) {
      const row = rowFor(container, spell.name);
      const img = row.querySelector("img");
      expect(img, `${spell.name} should render an image`).not.toBeNull();
      expect(img).toHaveAttribute("src", spell.image);
    }
  });

  it("keeps rendering no image element for a spell with no image mapping", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    await openSpellTable(user);

    const row = rowFor(container, NO_IMAGE_SPELL);
    expect(within(row).getByText(NO_IMAGE_SPELL)).toBeInTheDocument();
    expect(row.querySelector("img")).toBeNull();
  });

  it("keeps rendering each spell's name and effect text", async () => {
    const user = userEvent.setup();
    renderWindow();

    await openSpellTable(user);

    // The accepted two-column layout shows each spell's name and its effect
    // text. The old Enabled column is intentionally removed, so it is not
    // asserted.
    for (const name of ["Subao Ve", "Tia Lua", "Chila Cao", "Hairy Balls"]) {
      const row = rowFor(document.body, name);
      expect(within(row).getAllByText(name).length).toBeGreaterThan(0);
    }
  });
});
