import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the spell table dialog's PER-SPELL FIELD ASSOCIATION,
 * taken BEFORE the row layout changes from two spells side by side (each card
 * stacking name, category/level and effect vertically) to one spell per row
 * with a narrower left column (name, category, level) and a wider right column
 * (effect).
 *
 * The request intentionally changes the ROW LAYOUT only. It does not change
 * which spells are shown, their names, their category/level line, or their
 * effect text. This file therefore deliberately does NOT assert the row's
 * column geometry or the grid template — those are the behavior under change.
 *
 * What it protects, which the existing spell-table tests do not:
 *   - each spell's name, its category/level line and its effect text stay
 *     associated with the SAME spell, so a re-layout cannot cross-wire one
 *     spell's effect onto another spell's name.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering of the static table — not real backend
 * behavior. See episode.coverageLimits.
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
 * A spell table fixture with two Minor spells that each carry a distinct name,
 * a distinct category/level line and a distinct effect text, so a cross-wired
 * re-layout is detectable. The two Minor entries are adjacent in the flat row
 * list, which is exactly where a two-column split would separate them.
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
        magicCategory: "Necromancy",
        level: "Basic",
      },
      {
        id: 11n,
        complexity: "Moderate",
        nftEligible: true,
        meaning: "Ice shard",
        name: "Gelida",
        spell: "Freezes the enemy Rook for one turn.",
        category: { Minor: null },
        dropChance: 10n,
        magicCategory: "Elemental",
        level: "Skilled",
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

/** The row whose text contains the given spell name. */
function rowFor(name: string): HTMLElement {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
  );
  const row = rows.find((r) => r.textContent?.includes(name));
  if (row === undefined) throw new Error(`no spell table row for ${name}`);
  return row;
}

describe("spell table per-spell field association", () => {
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

  it("keeps each spell's name, category/level line and effect together", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // Each spell's three fields must stay in the same row. A re-layout that
    // splits the flat list into columns must not move one spell's effect onto
    // another spell's name.
    const tia = rowFor("Tia Lua");
    expect(within(tia).getByText("Tia Lua")).toBeInTheDocument();
    expect(within(tia).getByText("Necromancy · Basic")).toBeInTheDocument();
    expect(
      within(tia).getByText("Removes 1 random enemy Pawn from the board."),
    ).toBeInTheDocument();
    // The other spell's fields must not leak into this row.
    expect(within(tia).queryByText("Gelida")).not.toBeInTheDocument();
    expect(
      within(tia).queryByText("Elemental · Skilled"),
    ).not.toBeInTheDocument();
    expect(
      within(tia).queryByText("Freezes the enemy Rook for one turn."),
    ).not.toBeInTheDocument();

    const gelida = rowFor("Gelida");
    expect(within(gelida).getByText("Gelida")).toBeInTheDocument();
    expect(within(gelida).getByText("Elemental · Skilled")).toBeInTheDocument();
    expect(
      within(gelida).getByText("Freezes the enemy Rook for one turn."),
    ).toBeInTheDocument();
    expect(within(gelida).queryByText("Tia Lua")).not.toBeInTheDocument();
    expect(
      within(gelida).queryByText("Removes 1 random enemy Pawn from the board."),
    ).not.toBeInTheDocument();
  });
});
