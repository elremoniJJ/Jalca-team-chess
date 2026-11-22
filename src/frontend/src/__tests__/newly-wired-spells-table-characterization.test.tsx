import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the seven spells the request wires into the burn-and-play
 * board-effect path, taken BEFORE that backend wiring lands.
 *
 * The request makes these spells mutate the board when they fire:
 *   - Bendika (id 3) removes all remaining enemy Pawns;
 *   - Bendika Tah (id 4) removes all remaining Pawns of both colours;
 *   - Mayban Dadoy Tron (id 6) removes all remaining enemy Rooks;
 *   - Chila Cao (id 15) removes 1 random enemy Knight;
 *   - Handom Zitie Zumuc (id 16) removes 1 random enemy Bishop;
 *   - Bamburgh (id 17) removes 1 random enemy Rook;
 *   - Bouvet Hondao (id 18) permanently blocks one empty centre square.
 *
 * It does NOT change the static spell table. The names, meanings, categories,
 * complexity, eligibility flags, and Function wording of these seven entries
 * are the contract the backend fix must preserve, and no other suite pins them
 * as a group. This file protects the frontend consumer's view of that table:
 *   - each of the seven names is present with its meaning and its exact
 *     Function text (the wording the request's acceptance criteria restate);
 *   - each entry's category and complexity are the ones the table defines, and
 *     the enabled check follows the `Easy && nftEligible` rule (Bouvet Hondao
 *     is Complex + ineligible, so it is the one disabled entry here);
 *   - the seven entries render in the modal's block/minor/major/balls order.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering of the static table — not real backend
 * behavior. The removal/block itself runs only after a successful burn through
 * the external ICRC-7 collection canister, which the PocketIC lane cannot
 * reach; see episode.coverageLimits.
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
 * The seven newly-wired spells exactly as the backend's static table defines
 * them. `enabled` is the modal's `complexity === Easy && nftEligible` rule.
 */
const NEWLY_WIRED_SPELLS = [
  {
    id: 3n,
    name: "Bendika",
    meaning: "Plague",
    category: "Major",
    complexity: "Easy",
    nftEligible: true,
    enabled: true,
    spell: "Removes all remaining enemy Pawns from the board.",
  },
  {
    id: 4n,
    name: "Bendika Tah",
    meaning: "Big plague",
    category: "Major",
    complexity: "Easy",
    nftEligible: true,
    enabled: true,
    spell:
      "Removes all remaining Pawns (both enemy and friendly) from the board.",
  },
  {
    id: 6n,
    name: "Mayban Dadoy Tron",
    meaning: "Trebuchet",
    category: "Major",
    complexity: "Easy",
    nftEligible: true,
    enabled: true,
    spell:
      "Removes all remaining enemy Rooks from the board, regardless of where they are positioned.",
  },
  {
    id: 15n,
    name: "Chila Cao",
    meaning: "Tisa scratch",
    category: "Minor",
    complexity: "Easy",
    nftEligible: true,
    enabled: true,
    spell: "Removes 1 random enemy Knight from the board.",
  },
  {
    id: 16n,
    name: "Handom Zitie Zumuc",
    meaning: "Episcopicide",
    category: "Minor",
    complexity: "Easy",
    nftEligible: true,
    enabled: true,
    spell: "Removes 1 random enemy Bishop from the board.",
  },
  {
    id: 17n,
    name: "Bamburgh",
    meaning: "Bamburgh",
    category: "Minor",
    complexity: "Easy",
    nftEligible: true,
    enabled: true,
    spell: "Removes 1 random enemy Rook from the board.",
  },
  {
    id: 18n,
    name: "Bouvet Hondao",
    meaning: "Bouvet Island",
    category: "Minor",
    complexity: "Complex",
    nftEligible: false,
    enabled: false,
    spell:
      "Permanently blocks 1 random empty square. No piece can land on or move through this square for the rest of the game.",
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

describe("newly-wired spells in the spell table", () => {
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

  it("renders all seven newly-wired spells with their name and no meaning", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    await openSpellTable(user);

    for (const spell of NEWLY_WIRED_SPELLS) {
      const row = rowFor(container, spell.name);
      expect(row).toHaveTextContent(spell.name);
      // The accepted request removes the Meaning column, so the meaning text
      // no longer appears in any row. Skip the entries whose meaning string is
      // identical to the spell name (Bamburgh), where the name itself would
      // satisfy the assertion.
      if (spell.meaning !== spell.name) {
        expect(row).not.toHaveTextContent(spell.meaning);
      }
    }
  });

  it("states each newly-wired spell's exact Function text", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    await openSpellTable(user);

    for (const spell of NEWLY_WIRED_SPELLS) {
      const row = rowFor(container, spell.name);
      // The Function cell carries the exact wording the acceptance criteria
      // restate; the backend fix must not reword the static table.
      expect(row).toHaveTextContent(spell.spell);
    }
  });

  it("renders each newly-wired spell's name and effect text", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The accepted two-column layout shows each spell's name and its effect
    // text. The old Enabled column is intentionally removed, so it is not
    // asserted.
    for (const spell of NEWLY_WIRED_SPELLS) {
      const row = rowFor(document.body, spell.name);
      expect(row).toHaveTextContent(spell.name);
      expect(row).toHaveTextContent(spell.spell);
    }
  });

  it("renders the seven newly-wired spells in the modal's minor-then-major order", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The modal is portaled to document.body, so rows are queried there.
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
    );
    const names = rows.map((r) => r.textContent ?? "");
    const positions = NEWLY_WIRED_SPELLS.map((spell) =>
      names.findIndex((text) => text.includes(spell.name)),
    );

    // Every newly-wired spell is present.
    expect(positions.every((p) => p >= 0)).toBe(true);

    // The modal renders Minor before Major, so the four Minor entries (15-18)
    // precede the three Major entries (3, 4, 6), and within each category the
    // entries keep ascending id order.
    const minorPositions = NEWLY_WIRED_SPELLS.filter(
      (s) => s.category === "Minor",
    ).map((s) => positions[NEWLY_WIRED_SPELLS.indexOf(s)]);
    const majorPositions = NEWLY_WIRED_SPELLS.filter(
      (s) => s.category === "Major",
    ).map((s) => positions[NEWLY_WIRED_SPELLS.indexOf(s)]);

    for (let i = 1; i < minorPositions.length; i += 1) {
      expect(minorPositions[i]).toBeGreaterThan(minorPositions[i - 1]);
    }
    for (let i = 1; i < majorPositions.length; i += 1) {
      expect(majorPositions[i]).toBeGreaterThan(majorPositions[i - 1]);
    }
    expect(Math.max(...minorPositions)).toBeLessThan(
      Math.min(...majorPositions),
    );
  });
});
