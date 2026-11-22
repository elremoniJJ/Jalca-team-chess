import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the spell table dialog's PER-ROW enabled marker and the
 * grouping of a row's name/category/level apart from its effect text, taken
 * BEFORE the row layout changes from two spells side by side (each card
 * stacking name, category/level and effect vertically) to one spell per row
 * with a narrower left column (name, category, level) and a wider right column
 * (effect).
 *
 * The request intentionally changes the ROW LAYOUT only. It does not change
 * which spells are shown, their names, their category/level line, their effect
 * text, or the enabled marker. This file therefore deliberately does NOT assert
 * the row's column geometry or the grid template — those are the behavior under
 * change.
 *
 * What it protects, which the existing spell-table tests do not:
 *   - each row still renders its enabled marker: a check for an NFT-eligible
 *     spell and a cross for an ineligible one, so the eligibility signal
 *     survives the re-layout;
 *   - a row's name, its category/level line and its effect text are still
 *     distinct elements, so the re-layout can move the effect into its own
 *     column without merging or dropping any of the three.
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
 * A spell table fixture with one eligible spell (Tia Lua, nftEligible) and one
 * ineligible spell (Sandy Balls, not nftEligible), so both sides of the enabled
 * marker are exercised. Tia Lua also carries a magic category and level so the
 * category line is present.
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
    ],
    major: [],
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

describe("spell table row enabled marker and cell grouping", () => {
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

  it("marks an eligible spell enabled and an ineligible spell disabled", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The enabled marker is the row's trailing span, whose colour class
    // distinguishes the two states: text-accent for enabled,
    // text-muted-foreground for disabled. The row's own text never contains the
    // marker glyph, so assert on the marker element's class rather than on
    // text. The category/level line also carries text-muted-foreground, so
    // select the trailing element rather than the first matching span.
    const eligibleRow = rowFor("Tia Lua");
    const ineligibleRow = rowFor("Sandy Balls");

    const markerOf = (row: HTMLElement): HTMLElement | null =>
      row.lastElementChild as HTMLElement | null;

    const eligibleMarker = markerOf(eligibleRow);
    const ineligibleMarker = markerOf(ineligibleRow);
    expect(eligibleMarker).not.toBeNull();
    expect(ineligibleMarker).not.toBeNull();
    expect(eligibleMarker?.className).toContain("text-accent");
    expect(ineligibleMarker?.className).toContain("text-muted-foreground");
  });

  it("keeps a row's name, category/level line and effect as distinct elements", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const row = rowFor("Tia Lua");

    // The name, the category/level line and the effect each render as their own
    // element, so the re-layout can move the effect into a separate column
    // without merging or dropping any of the three.
    expect(within(row).getByText("Tia Lua")).toBeInTheDocument();
    expect(within(row).getByText("Necromancy · Basic")).toBeInTheDocument();
    expect(
      within(row).getByText("Removes 1 random enemy Pawn from the board."),
    ).toBeInTheDocument();

    const nameEl = within(row).getByText("Tia Lua");
    const categoryEl = within(row).getByText("Necromancy · Basic");
    const effectEl = within(row).getByText(
      "Removes 1 random enemy Pawn from the board.",
    );
    expect(nameEl).not.toBe(categoryEl);
    expect(nameEl).not.toBe(effectEl);
    expect(categoryEl).not.toBe(effectEl);
  });
});
