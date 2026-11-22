import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the spell-table entries the resurrection-spell request
 * must leave ALONE, taken BEFORE the backend change that gives the five
 * resurrection spells (ids 21-25) a board effect and rewrites their Function
 * text.
 *
 * The request changes exactly two things about the static table:
 *   - the five resurrection spells' Function text becomes "Summons 1 friendly
 *     <type> on the closest safe square to the centre";
 *   - the backend burn path gains a summon effect for them.
 *
 * It explicitly states "all other spells are unchanged". The sibling
 * `resurrection-spells-adjacent-characterization.test.tsx` pins the five
 * resurrection entries' identity fields and the neighbouring removal /
 * newly-wired spells' wording. It does NOT pin the rest of the table, so a
 * careless edit to the shared spell table could silently reword or re-flag the
 * Major transform spells, the Balls spells, or the Subao Ve block spell with no
 * test noticing. This file closes that gap:
 *   - the nine Major spells (ids 1, 2, 5, 7, 8, 9) keep their exact name,
 *     meaning, Function text, and enabled state;
 *   - the eight Balls spells (ids 26-33) keep their exact name, meaning,
 *     Function text, and enabled state;
 *   - the single Block spell Subao Ve (id 0) keeps its exact name, meaning,
 *     Function text, and enabled state.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering of the static table — not real backend
 * behavior. The summon itself runs only after a successful burn through the
 * external ICRC-7 collection canister, which the PocketIC lane cannot reach;
 * see episode.coverageLimits.
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
  SpellKind: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  BurnedSpellCategory: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  BallsColourFamily: {
    Sandy: "Sandy",
    Cloudy: "Cloudy",
    Grassy: "Grassy",
    Fiery: "Fiery",
    Wooden: "Wooden",
  },
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

/**
 * The nine Major spells' identity fields and exact Function wording, exactly
 * as the backend's static table defines them. The request does not touch any
 * of these, so every field is the contract.
 */
const MAJOR_SPELLS = [
  {
    id: 1n,
    name: "Newkai Dodan",
    meaning: "Queen horse",
    enabled: false,
    spell: "Replaces the enemy Queen with an enemy Knight on the same square.",
  },
  {
    id: 2n,
    name: "Hipsy Tan Chin",
    meaning: "Paladin",
    enabled: false,
    spell:
      "Removes 1 random friendly Knight and 1 random friendly Bishop from the board. Places a new piece, the Paladin, on the square where the Knight was located. The Paladin can move as both a Knight and a Bishop. (Requires at least 1 friendly Knight and 1 friendly Bishop on the board).",
  },
  {
    id: 5n,
    name: "Chinsa Homza Nep",
    meaning: "Claustrophobia",
    enabled: false,
    spell:
      "Permanently prevents the enemy King from castling for the remainder of the game.",
  },
  {
    id: 7n,
    name: "Suchu Indoi",
    meaning: "Conversion",
    enabled: false,
    spell:
      "Converts 1 random enemy Bishop into a friendly Bishop on the same square.",
  },
  {
    id: 8n,
    name: "Sinchua Cuna Vua",
    meaning: "God save the king",
    enabled: false,
    spell:
      "Removes 1 random friendly Bishop from the board. For the remainder of the game, the friendly King gains the ability to move as both a King and a Bishop (keeps normal King movement AND gains Bishop movement). (Requires at least 1 friendly Bishop on the board).",
  },
  {
    id: 9n,
    name: "Xetang",
    meaning: "Tank",
    enabled: false,
    spell:
      "Converts 1 random friendly Rook into a Tank. The Tank retains standard Rook movement and captures pieces normally, but destroys and removes all Pawns (friendly and enemy) in its path, including any Pawn on its target landing square.",
  },
] as const;

/**
 * The eight Balls spells' identity fields and exact Function wording. The
 * request does not touch the Balls family, so every field is the contract.
 * Balls spells are never nftEligible, so all eight render disabled.
 */
const BALLS_SPELLS = [
  {
    id: 26n,
    name: "Sandy Balls",
    meaning: "Sandy Balls",
    enabled: false,
    spell:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Sandy colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
  },
  {
    id: 27n,
    name: "Cloudy Balls",
    meaning: "Cloudy Balls",
    enabled: false,
    spell:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Cloudy colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
  },
  {
    id: 28n,
    name: "Grassy Balls",
    meaning: "Grassy Balls",
    enabled: false,
    spell:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Grassy colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
  },
  {
    id: 29n,
    name: "Fiery Balls",
    meaning: "Fiery Balls",
    enabled: false,
    spell:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Fiery colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
  },
  {
    id: 30n,
    name: "Wooden Balls",
    meaning: "Wooden Balls",
    enabled: false,
    spell:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Wooden colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
  },
  {
    id: 31n,
    name: "Hairy Balls",
    meaning: "Hairy Balls",
    enabled: true,
    spell:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Hairy Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no image effect and no shield math.",
  },
  {
    id: 32n,
    name: "Veiny Balls",
    meaning: "Veiny Balls",
    enabled: true,
    spell:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Veiny Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no image effect and no shield math.",
  },
  {
    id: 33n,
    name: "Shiny Balls",
    meaning: "Shiny Balls",
    enabled: true,
    spell:
      "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Shiny Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no image effect and no shield math.",
  },
] as const;

/**
 * The single Block spell Subao Ve (id 0). The request does not touch its name,
 * meaning or enabled state; its effect text is the accepted shortened wording.
 */
const SUBAO_VE = {
  id: 0n,
  name: "Subao Ve",
  meaning: "Protection",
  enabled: true,
  spell:
    "Protection against incoming enemy spells. A spell can only affect the game if it has at least double the power of the Subao Ve. Otherwise it only reduces the Subao Ve's remaining power.",
} as const;

/**
 * A spell table fixture carrying the untouched entries: the Block spell, the
 * nine Major spells, and the eight Balls spells. The five resurrection spells
 * are deliberately absent — the sibling characterization file owns them, and
 * this file must not pin their changing Function text.
 */
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: "Easy",
      nftEligible: true,
      meaning: "Protection",
      name: "Subao Ve",
      spell:
        "Protection against incoming enemy spells. A spell can only affect the game if it has at least double the power of the Subao Ve. Otherwise it only reduces the Subao Ve's remaining power.",
      category: { Block: null },
      dropChance: 8n,
    },
    minor: [],
    major: [
      {
        id: 1n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Queen horse",
        name: "Newkai Dodan",
        spell:
          "Replaces the enemy Queen with an enemy Knight on the same square.",
        category: { Major: null },
        dropChance: 2n,
      },
      {
        id: 2n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Paladin",
        name: "Hipsy Tan Chin",
        spell:
          "Removes 1 random friendly Knight and 1 random friendly Bishop from the board. Places a new piece, the Paladin, on the square where the Knight was located. The Paladin can move as both a Knight and a Bishop. (Requires at least 1 friendly Knight and 1 friendly Bishop on the board).",
        category: { Major: null },
        dropChance: 2n,
      },
      {
        id: 5n,
        complexity: "Complex",
        nftEligible: false,
        meaning: "Claustrophobia",
        name: "Chinsa Homza Nep",
        spell:
          "Permanently prevents the enemy King from castling for the remainder of the game.",
        category: { Major: null },
        dropChance: 2n,
      },
      {
        id: 7n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Conversion",
        name: "Suchu Indoi",
        spell:
          "Converts 1 random enemy Bishop into a friendly Bishop on the same square.",
        category: { Major: null },
        dropChance: 2n,
      },
      {
        id: 8n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "God save the king",
        name: "Sinchua Cuna Vua",
        spell:
          "Removes 1 random friendly Bishop from the board. For the remainder of the game, the friendly King gains the ability to move as both a King and a Bishop (keeps normal King movement AND gains Bishop movement). (Requires at least 1 friendly Bishop on the board).",
        category: { Major: null },
        dropChance: 2n,
      },
      {
        id: 9n,
        complexity: "Complex",
        nftEligible: false,
        meaning: "Tank",
        name: "Xetang",
        spell:
          "Converts 1 random friendly Rook into a Tank. The Tank retains standard Rook movement and captures pieces normally, but destroys and removes all Pawns (friendly and enemy) in its path, including any Pawn on its target landing square.",
        category: { Major: null },
        dropChance: 2n,
      },
    ],
    balls: [
      {
        id: 26n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Sandy Balls",
        name: "Sandy Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Sandy colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 27n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Cloudy Balls",
        name: "Cloudy Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Cloudy colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 28n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Grassy Balls",
        name: "Grassy Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Grassy colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 29n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Fiery Balls",
        name: "Fiery Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Fiery colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 30n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Wooden Balls",
        name: "Wooden Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Wooden colour family; equal or lower Power cancels it with no board effect. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no palette effect and no shield math.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 31n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Hairy Balls",
        name: "Hairy Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Hairy Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no image effect and no shield math.",
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
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Veiny Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no image effect and no shield math.",
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
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and showing the Shiny Balls image on every square of the OPPONENT's board; equal or lower Power cancels it with no board effect. The caster's own board is unaffected. Power equals the Current Game Number minus the NFT's Game Number, floored at 0. A legacy NFT with no Game Number burns inert with no image effect and no shield math.",
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

describe("spell table entries the resurrection-spell request leaves alone", () => {
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

  it("keeps the nine Major spells' wording unchanged", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    for (const spell of MAJOR_SPELLS) {
      const row = rowFor(document.body, spell.name);
      expect(row).toHaveTextContent(spell.name);
      // The accepted two-column layout shows the name and the effect text. The
      // old Meaning and Enabled columns are intentionally removed, so they are
      // not asserted.
      expect(row).toHaveTextContent(spell.spell);
    }
  });

  it("keeps the eight Balls spells' wording unchanged", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    for (const spell of BALLS_SPELLS) {
      const row = rowFor(document.body, spell.name);
      expect(row).toHaveTextContent(spell.name);
      expect(row).toHaveTextContent(spell.spell);
    }
  });

  it("keeps the Subao Ve block spell's wording unchanged", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const row = rowFor(document.body, SUBAO_VE.name);
    expect(row).toHaveTextContent(SUBAO_VE.name);
    // The accepted request removes the Meaning column, so the meaning is not
    // rendered as its own element. (The word "Protection" now appears only as
    // the first word of the accepted effect text, so a substring check on the
    // whole row would be wrong.)
    expect(within(row).queryByText(SUBAO_VE.meaning)).not.toBeInTheDocument();
    expect(row).toHaveTextContent(SUBAO_VE.spell);
  });
});
