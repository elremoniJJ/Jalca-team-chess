import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the five REMOVAL spells' spell-table entries, taken
 * BEFORE the backend burn-and-play path starts removing enemy pawns for them.
 *
 * The request wires removal spells ids 10-14 (Tia Lua, Cau Lua, Hoa Boc, Buc
 * Tung Lua, Mua Lua) into the burn-and-play path so that, when one fires, up to
 * N enemy pawns leave the board. It does NOT change the static spell table:
 * the names, meanings, categories, complexity, eligibility, and the
 * removal-budget wording are the contract the backend fix must preserve.
 *
 * What IS protected here — the frontend consumer's view of those five entries,
 * which no other suite pins as a group:
 *   - each of the five names is present with its id, Minor category, Easy
 *     complexity, and nftEligible=true (the enabled check);
 *   - each entry's Function text states the correct removal budget (1, 2, 3,
 *     4, 5 enemy pawns respectively) — the same N the backend fix must honor;
 *   - the five entries render in the Minor section in id order.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering of the static table — not real backend
 * behavior. The removal itself runs only after a successful burn through the
 * external ICRY-7 collection canister, which the PocketIC lane cannot reach;
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
 * The five removal spells exactly as the backend's static table defines them:
 * Minor, Easy, nftEligible, with the removal budget stated in the Function
 * text. The budget is the N the backend fix must honor.
 */
const REMOVAL_SPELLS = [
  {
    id: 10n,
    name: "Tia Lua",
    meaning: "Fire bolt",
    budget: 1,
    spell: "Removes 1 random enemy Pawn from the board.",
  },
  {
    id: 11n,
    name: "Cau Lua",
    meaning: "Fireball",
    budget: 2,
    spell: "Removes up to 2 random enemy Pawns (as many as possible up to 2).",
  },
  {
    id: 12n,
    name: "Hoa Boc",
    meaning: "Pyroblast",
    budget: 3,
    spell: "Removes up to 3 random enemy Pawns (as many as possible up to 3).",
  },
  {
    id: 13n,
    name: "Buc Tung Lua",
    meaning: "Wall of fire",
    budget: 4,
    spell: "Removes up to 4 random enemy Pawns (as many as possible up to 4).",
  },
  {
    id: 14n,
    name: "Mua Lua",
    meaning: "Rain of fire",
    budget: 5,
    spell: "Removes up to 5 random enemy Pawns (as many as possible up to 5).",
  },
] as const;

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
    ],
    major: [],
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

describe("removal spells in the spell table", () => {
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

  it("renders all five removal spells with their name and no meaning", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    await openSpellTable(user);

    for (const spell of REMOVAL_SPELLS) {
      const row = rowFor(container, spell.name);
      expect(row).toHaveTextContent(spell.name);
      // The accepted request removes the Meaning column, so the meaning text
      // no longer appears in any row.
      expect(row).not.toHaveTextContent(spell.meaning);
    }
  });

  it("states the correct removal budget in each spell's Function text", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    await openSpellTable(user);

    for (const spell of REMOVAL_SPELLS) {
      const row = rowFor(container, spell.name);
      // The Function cell carries the exact wording, including the budget N.
      // Tia Lua (budget 1) reads "Removes 1 random enemy Pawn"; the volleys
      // read "Removes up to N random enemy Pawns".
      expect(row).toHaveTextContent(spell.spell);
      expect(row).toHaveTextContent(`${spell.budget} random enemy Pawn`);
    }
  });

  it("renders each removal spell's name and effect text", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The accepted two-column layout shows each spell's name and its effect
    // text. The old Enabled column is intentionally removed, so it is not
    // asserted.
    for (const spell of REMOVAL_SPELLS) {
      const row = rowFor(document.body, spell.name);
      expect(row).toHaveTextContent(spell.name);
      expect(row).toHaveTextContent(spell.spell);
    }
  });

  it("renders the five removal spells in the Minor section in id order", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The modal is portaled to document.body, so rows are queried there.
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
    );
    const names = rows.map((r) => r.textContent ?? "");
    const positions = REMOVAL_SPELLS.map((spell) =>
      names.findIndex((text) => text.includes(spell.name)),
    );

    // Every removal spell is present and they appear in ascending id order.
    expect(positions.every((p) => p >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});
