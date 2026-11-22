import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted Lua fire spell image mapping in the
 * WalletConnectionWindow spell table. Each of the five Lua fire spells must
 * render its own PNG at `/assets/spells/10.png` ... `/assets/spells/14.png`,
 * while the existing Balls images and the unmapped-spell fallback keep
 * working.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering — not real backend behavior.
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
// submodules in jsdom. The window under test never calls the actor directly.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

/** The five Lua fire spells and the asset each must render. */
const LUA_FIRE_SPELLS = [
  { name: "Tia Lua", image: "/assets/spells/10.png" },
  { name: "Cau Lua", image: "/assets/spells/11.png" },
  { name: "Hoa Boc", image: "/assets/spells/12.png" },
  { name: "Buc Tung Lua", image: "/assets/spells/13.png" },
  { name: "Mua Lua", image: "/assets/spells/14.png" },
] as const;

/** The three image Balls spells whose mapping already existed. */
const IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Veiny Balls", image: "/assets/spells/veiny-balls.png" },
  { name: "Shiny Balls", image: "/assets/spells/shiny-balls.png" },
] as const;

/** A spell with no image mapping — must render no <img>.
 * "Newkai Dodan" (id 1) is not one of the spells this change maps; "Bendika"
 * is now intentionally mapped to /assets/spells/3.png. */
const NO_IMAGE_SPELL = "Hipsy Tan Chin";

/**
 * A spell table fixture carrying the five Lua fire spells (the accepted
 * change), the three image Balls spells, and one spell with no image mapping.
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
        id: 3n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Plague",
        name: "Bendika",
        spell: "Removes all remaining enemy Pawns from the board.",
        category: { Minor: null },
        dropChance: 10n,
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
        id: 2n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Paladin",
        name: "Hipsy Tan Chin",
        spell: "Removes a friendly Knight and Bishop and places a Paladin.",
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

function renderWindow() {
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

describe("WalletConnectionWindow Lua fire spell images", () => {
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

  it("renders each Lua fire spell's own PNG in its row", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    await openSpellTable(user);

    for (const spell of LUA_FIRE_SPELLS) {
      const row = rowFor(container, spell.name);
      const img = row.querySelector("img");
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute("src", spell.image);
    }
  });

  it("keeps the existing Balls images and the unmapped-spell fallback", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    await openSpellTable(user);

    for (const spell of IMAGE_SPELLS) {
      const row = rowFor(container, spell.name);
      expect(row.querySelector("img")).toHaveAttribute("src", spell.image);
    }

    const row = rowFor(container, NO_IMAGE_SPELL);
    expect(within(row).getByText(NO_IMAGE_SPELL)).toBeInTheDocument();
    expect(row.querySelector("img")).toBeNull();
  });
});
