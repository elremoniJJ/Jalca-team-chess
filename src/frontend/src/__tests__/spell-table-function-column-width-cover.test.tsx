import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted spell-table two-column layout.
 *
 * The accepted request replaces the old five-column grid with two columns of
 * rows: the left column (spell name plus its category and level) is half the
 * width of the right column (the effect explanation). The grid template is
 * therefore `grid-cols-[1fr_2fr]`, and the effect text must render in full (no
 * truncation class on the effect cell).
 *
 * This file renders the real `WalletConnectionWindow` spell-table modal against
 * a typed local actor mock whose `getSpellTable` returns a table with a long
 * effect string, so it proves the accepted layout reaches the user through the
 * real component tree. The modal is portaled to `document.body`, so its rows
 * are queried there.
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
 * A long Function string, representative of the real table's longest entries
 * (e.g. Subao Ve's shield description). The width change exists so text this
 * long stays readable, so the fixture carries a long one.
 */
const LONG_FUNCTION =
  "Preemptively sets up a shield to block incoming enemy Major or Minor spells. A spell's Power equals the Current Game Number minus the Game Number it was acquired (older spells are more powerful).";

/**
 * A spell table fixture with one row per category so the modal renders a
 * stable, non-empty table. The Function text is deliberately long.
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
        "Preemptively sets up a shield to block incoming enemy Major or Minor spells. A spell's Power equals the Current Game Number minus the Game Number it was acquired (older spells are more powerful).",
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

/**
 * The grid-template-columns track list of the spell table's two-column body.
 * The body grid carries the Tailwind `grid-cols-[...]` class; Tailwind emits
 * the arbitrary value as a class, not an inline style, so read the class
 * attribute. The modal is portaled to document.body.
 */
function gridTemplateColumns(): string {
  const grid = document.querySelector<HTMLElement>(
    "[data-ocid='spell_table.dialog'] .grid",
  );
  if (grid === null) throw new Error("spell table body grid not found");
  const match = grid.className.match(/grid-cols-\[([^\]]+)\]/);
  if (match === null) throw new Error("spell table body has no grid-cols");
  return match[1];
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

describe("spell table two-column layout", () => {
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

  it("lays the rows out in two columns where the left is half the right", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const tracks = gridTemplateColumns();
    // The accepted track list: left column 1fr, right column 2fr — the left is
    // half the width of the right.
    const parts = tracks.split("_");
    expect(parts).toHaveLength(2);
    const frValue = (track: string | undefined): number =>
      Number.parseFloat(track?.match(/([\d.]+)fr/)?.[1] ?? "0");
    const leftTrack = frValue(parts[0]);
    const rightTrack = frValue(parts[1]);
    expect(leftTrack).toBeGreaterThan(0);
    expect(rightTrack).toBe(leftTrack * 2);
  });

  it("renders the long effect text in full without a truncation class", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const row = rowFor("Subao Ve");
    // The effect cell carries the full text, not an ellipsised prefix.
    expect(row).toHaveTextContent(LONG_FUNCTION);

    // Locate the effect cell by its text rather than by position, so the
    // assertion does not depend on whether the leading image slot is an img
    // or a span.
    const cells = Array.from(row.querySelectorAll<HTMLElement>("span"));
    const functionCell = cells.find(
      (cell) => cell.textContent === LONG_FUNCTION,
    );
    expect(functionCell).toBeDefined();
    expect(functionCell?.className).not.toMatch(/truncate|line-clamp|ellipsis/);
  });

  it("puts the name and category/level in the left column and the effect in the right", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The accepted layout is one spell per row: the row's inner grid has a
    // narrow left column holding the name with its category/level line, and a
    // wider right column holding the effect explanation.
    const row = rowFor("Subao Ve");
    const rowGrid = row.querySelector<HTMLElement>(".grid");
    expect(rowGrid).not.toBeNull();
    if (rowGrid === null) return;

    const columns = Array.from(rowGrid.children) as HTMLElement[];
    expect(columns).toHaveLength(2);

    const [left, right] = columns;
    // The left column holds the name and its category/level line.
    expect(left).toHaveTextContent("Subao Ve");
    // The right column holds the effect explanation, in full.
    expect(right).toHaveTextContent(LONG_FUNCTION);
    // The effect text is not in the left column, and the name is not in the
    // right column, so the two columns are not cross-wired.
    expect(left).not.toHaveTextContent(LONG_FUNCTION);
    expect(right).not.toHaveTextContent("Subao Ve");
  });
});
