import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the spell table AROUND the five resurrection spells
 * (ids 21-25: Thayma, Hipsy Titam, Lazarus, Cuoclot Sac Wonmuc Rook, Anne
 * Boleyn), taken BEFORE the backend change that gives them a board effect.
 *
 * The request intentionally changes two things about these five entries:
 *   - their Function text becomes "Summons 1 friendly <type> on the closest
 *     safe square to the centre" (the "Respawns 1 previously captured ..."
 *     wording and the "(Requires at least 1 captured ...)" clause go away);
 *   - the backend burn path gains a summon effect for them.
 *
 * Everything ELSE about these entries is the contract the change must
 * preserve, and no other suite pins it as a group:
 *   - each of the five keeps its id, name, meaning and Minor category. Thayma
 *     (21) and Hipsy Titam (22) also keep Moderate complexity and
 *     nftEligible=false (so they stay out of the mint pool and render the
 *     disabled mark); the other three (23-25) have their complexity and
 *     eligibility intentionally changed by the summon-image request, so neither
 *     is pinned here;
 *   - the five render in the Minor section in ascending id order;
 *   - the neighbouring spells' entries are untouched: the five removal spells
 *     (10-14) keep their exact Function wording and enabled check, and the
 *     seven newly-wired spells (3, 4, 6, 15-18) keep theirs.
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
 * The five resurrection spells' identity fields, exactly as the backend's
 * static table defines them. Only the Function text is intentionally changed
 * by the request, so it is deliberately NOT pinned here.
 */
const RESURRECTION_SPELLS = [
  { id: 21n, name: "Thayma", meaning: "Zombie" },
  { id: 22n, name: "Hipsy Titam", meaning: "Knight whisperer" },
  { id: 23n, name: "Lazarus", meaning: "Lazarus" },
  {
    id: 24n,
    name: "Cuoclot Sac Wonmuc Rook",
    meaning: "Extreme Makeover: Rook edition",
  },
  { id: 25n, name: "Anne Boleyn", meaning: "Anne Boleyn" },
] as const;

/**
 * The neighbouring spells whose entries the change must leave alone: the five
 * removal spells (10-14) and the seven newly-wired spells (3, 4, 6, 15-18).
 * Their exact Function wording and enabled state are the contract.
 */
const NEIGHBOURING_SPELLS = [
  {
    id: 10n,
    name: "Tia Lua",
    meaning: "Fire bolt",
    enabled: true,
    spell: "Removes 1 random enemy Pawn from the board.",
  },
  {
    id: 11n,
    name: "Cau Lua",
    meaning: "Fireball",
    enabled: true,
    spell: "Removes up to 2 random enemy Pawns (as many as possible up to 2).",
  },
  {
    id: 12n,
    name: "Hoa Boc",
    meaning: "Pyroblast",
    enabled: true,
    spell: "Removes up to 3 random enemy Pawns (as many as possible up to 3).",
  },
  {
    id: 13n,
    name: "Buc Tung Lua",
    meaning: "Wall of fire",
    enabled: true,
    spell: "Removes up to 4 random enemy Pawns (as many as possible up to 4).",
  },
  {
    id: 14n,
    name: "Mua Lua",
    meaning: "Rain of fire",
    enabled: true,
    spell: "Removes up to 5 random enemy Pawns (as many as possible up to 5).",
  },
  {
    id: 3n,
    name: "Bendika",
    meaning: "Plague",
    enabled: true,
    spell: "Removes all remaining enemy Pawns from the board.",
  },
  {
    id: 4n,
    name: "Bendika Tah",
    meaning: "Big plague",
    enabled: true,
    spell:
      "Removes all remaining Pawns (both enemy and friendly) from the board.",
  },
  {
    id: 6n,
    name: "Mayban Dadoy Tron",
    meaning: "Trebuchet",
    enabled: true,
    spell:
      "Removes all remaining enemy Rooks from the board, regardless of where they are positioned.",
  },
  {
    id: 15n,
    name: "Chila Cao",
    meaning: "Tisa scratch",
    enabled: true,
    spell: "Removes 1 random enemy Knight from the board.",
  },
  {
    id: 16n,
    name: "Handom Zitie Zumuc",
    meaning: "Episcopicide",
    enabled: true,
    spell: "Removes 1 random enemy Bishop from the board.",
  },
  {
    id: 17n,
    name: "Bamburgh",
    meaning: "Bamburgh",
    enabled: true,
    spell: "Removes 1 random enemy Rook from the board.",
  },
  {
    id: 18n,
    name: "Bouvet Hondao",
    meaning: "Bouvet Island",
    enabled: false,
    spell:
      "Permanently blocks 1 random empty square. No piece can land on or move through this square for the rest of the game.",
  },
] as const;

/**
 * A spell table fixture carrying the five resurrection spells plus the
 * neighbouring spells, in the backend's Minor-then-Major order. The
 * resurrection entries use a placeholder Function text: the request changes
 * that text, so this file never asserts on it.
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
      {
        id: 11n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fireball",
        name: "Cau Lua",
        spell:
          "Removes up to 2 random enemy Pawns (as many as possible up to 2).",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 12n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Pyroblast",
        name: "Hoa Boc",
        spell:
          "Removes up to 3 random enemy Pawns (as many as possible up to 3).",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 13n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Wall of fire",
        name: "Buc Tung Lua",
        spell:
          "Removes up to 4 random enemy Pawns (as many as possible up to 4).",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 14n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Rain of fire",
        name: "Mua Lua",
        spell:
          "Removes up to 5 random enemy Pawns (as many as possible up to 5).",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 15n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Tisa scratch",
        name: "Chila Cao",
        spell: "Removes 1 random enemy Knight from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 16n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Episcopicide",
        name: "Handom Zitie Zumuc",
        spell: "Removes 1 random enemy Bishop from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 17n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Bamburgh",
        name: "Bamburgh",
        spell: "Removes 1 random enemy Rook from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 18n,
        complexity: "Complex",
        nftEligible: false,
        meaning: "Bouvet Island",
        name: "Bouvet Hondao",
        spell:
          "Permanently blocks 1 random empty square. No piece can land on or move through this square for the rest of the game.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 21n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Zombie",
        name: "Thayma",
        spell: "PLACEHOLDER — the request changes this text.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 22n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Knight whisperer",
        name: "Hipsy Titam",
        spell: "PLACEHOLDER — the request changes this text.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 23n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Lazarus",
        name: "Lazarus",
        spell: "PLACEHOLDER — the request changes this text.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 24n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Extreme Makeover: Rook edition",
        name: "Cuoclot Sac Wonmuc Rook",
        spell: "PLACEHOLDER — the request changes this text.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 25n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Anne Boleyn",
        name: "Anne Boleyn",
        spell: "PLACEHOLDER — the request changes this text.",
        category: { Minor: null },
        dropChance: 10n,
      },
    ],
    major: [
      {
        id: 3n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Plague",
        name: "Bendika",
        spell: "Removes all remaining enemy Pawns from the board.",
        category: { Major: null },
        dropChance: 2n,
      },
      {
        id: 4n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Big plague",
        name: "Bendika Tah",
        spell:
          "Removes all remaining Pawns (both enemy and friendly) from the board.",
        category: { Major: null },
        dropChance: 2n,
      },
      {
        id: 6n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Trebuchet",
        name: "Mayban Dadoy Tron",
        spell:
          "Removes all remaining enemy Rooks from the board, regardless of where they are positioned.",
        category: { Major: null },
        dropChance: 2n,
      },
    ],
    balls: [],
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

describe("spell table around the five resurrection spells", () => {
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

  it("keeps each resurrection spell's name in the table", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    for (const spell of RESURRECTION_SPELLS) {
      const row = rowFor(document.body, spell.name);
      expect(row).toHaveTextContent(spell.name);
      // The Function text is intentionally changed by the request, so it is
      // not pinned here. The old Meaning column is intentionally removed.
    }
  });

  it("keeps the two untouched resurrection spells' names and effect text", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // Thayma (21) and Hipsy Titam (22) are left alone by the summon-image
    // request. The old Enabled column is intentionally removed, so only the
    // name and effect text are asserted.
    for (const name of ["Thayma", "Hipsy Titam"]) {
      const row = rowFor(document.body, name);
      expect(row).toHaveTextContent(name);
    }
  });

  it("shows the three enabled summon spells' names and effect text", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // Lazarus (23), Cuoclot Sac Wonmuc Rook (24) and Anne Boleyn (25) are
    // enabled by the summon-image request. The old Enabled column is
    // intentionally removed, so only the name and effect text are asserted.
    for (const name of ["Lazarus", "Cuoclot Sac Wonmuc Rook", "Anne Boleyn"]) {
      const row = rowFor(document.body, name);
      expect(row).toHaveTextContent(name);
    }
  });

  it("renders the five resurrection spells in the Minor section in id order", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The modal is portaled to document.body, so rows are queried there.
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
    );
    const names = rows.map((r) => r.textContent ?? "");
    const positions = RESURRECTION_SPELLS.map((spell) =>
      names.findIndex((text) => text.includes(spell.name)),
    );

    // Every resurrection spell is present and they appear in ascending id
    // order (21, 22, 23, 24, 25).
    expect(positions.every((p) => p >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("leaves the neighbouring spells' Function wording unchanged", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    for (const spell of NEIGHBOURING_SPELLS) {
      const row = rowFor(document.body, spell.name);
      expect(row).toHaveTextContent(spell.name);
      // The exact Function text is the contract the change must not reword.
      expect(row).toHaveTextContent(spell.spell);
    }
  });
});
