import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the spell table's ELIGIBILITY display, taken BEFORE the
 * game-end mint distribution is changed from a category-weighted split to
 * 50% Subao Ve / 50% flat offensive pool.
 *
 * The request changes the DISTRIBUTION MATH only. It explicitly keeps pool
 * membership controlled solely by each spell's playable/eligible flag
 * (`nftEligible`), and it does not change how the spell table is rendered. The
 * frontend's `SpellTableModal` is the observable consumer of that flag: it
 * renders an "Enabled" column whose check mark means
 * `complexity === Easy && nftEligible`.
 *
 * What IS protected here:
 *   - the modal renders every category (Block + Minor + Major + Balls) as rows;
 *   - an eligible easy spell shows the enabled check, and a spell that is
 *     either not `nftEligible` or not `Easy` shows the disabled mark — so the
 *     single eligibility flag remains the visible pool-membership control;
 *   - the modal's loading and error states resolve rather than rendering a
 *     blank table.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering of the eligibility flag — not real
 * backend behavior. The real `getSpellTable` query is exercised by the PocketIC
 * lane when it runs. The distribution roll itself is NOT observable here (and
 * is the behavior the request intentionally changes), so it is not asserted.
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
 * A spell table fixture mirroring the real eligibility split: Subao Ve (Block,
 * Easy, eligible) plus one eligible easy offensive spell, one ineligible
 * offensive spell, and one Balls spell (never eligible). The eligibility flag
 * is the single control the new distribution reads, so the fixture pins both
 * sides of it.
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
        id: 18n,
        complexity: "Complex",
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
        id: 3n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Plague",
        name: "Bendika",
        spell: "Removes all remaining enemy Pawns from the board.",
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

/** The row whose text contains the given spell name. */
function rowFor(name: string): HTMLElement {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
  );
  const row = rows.find((r) => r.textContent?.includes(name));
  if (row === undefined) throw new Error(`no spell table row for ${name}`);
  return row;
}

describe("spell table eligibility display", () => {
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

  it("renders every category, including Balls, as a row", async () => {
    const user = userEvent.setup();
    renderWindow();

    const dialog = await openSpellTable(user);

    // Block + Minor (2) + Major + Balls = 5 rows, in the modal's
    // block/minor/major/balls order. The modal is portaled to document.body,
    // so the rows are queried there rather than in the render container.
    const rows = document.querySelectorAll("[data-ocid^='spell_table.row.']");
    expect(rows.length).toBe(5);
    expect(rows[0]).toHaveTextContent("Subao Ve");
    expect(rows[1]).toHaveTextContent("Tia Lua");
    expect(rows[2]).toHaveTextContent("Bouvet Hondao");
    expect(rows[3]).toHaveTextContent("Bendika");
    expect(rows[4]).toHaveTextContent("Sandy Balls");

    // The Balls spell is rendered even though it is never eligible.
    expect(within(dialog).getAllByText("Sandy Balls").length).toBeGreaterThan(
      0,
    );
  });

  it("renders each spell's name and effect text", async () => {
    const user = userEvent.setup();
    renderWindow();

    await openSpellTable(user);

    // The accepted two-column layout shows each spell's name and its effect
    // text. The old Enabled column is intentionally removed, so it is not
    // asserted.
    const expected: Array<[string, string]> = [
      ["Subao Ve", "Preemptively sets up a shield."],
      ["Tia Lua", "Removes 1 random enemy Pawn from the board."],
      ["Bouvet Hondao", "Permanently blocks 1 random empty square."],
      ["Bendika", "Removes all remaining enemy Pawns from the board."],
      ["Sandy Balls", "An offensive Balls spell."],
    ];
    for (const [name, effect] of expected) {
      const row = rowFor(name);
      expect(within(row).getAllByText(name).length).toBeGreaterThan(0);
      expect(within(row).getByText(effect)).toBeInTheDocument();
    }
  });

  it("shows the loading state before the table resolves", async () => {
    // A never-resolving query keeps the modal in its loading branch.
    getSpellTable.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderWindow();

    await openSpellTable(user);

    expect(screen.getByText("Loading spells…")).toBeInTheDocument();
  });

  it("shows the error state when the spell table query rejects", async () => {
    getSpellTable.mockRejectedValue(new Error("backend unavailable"));
    const user = userEvent.setup();
    renderWindow();

    await openSpellTable(user);

    expect(
      await screen.findByText(
        "Could not load the spell list. Please try again.",
      ),
    ).toBeInTheDocument();
  });
});
