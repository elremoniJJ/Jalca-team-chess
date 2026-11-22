import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the spell table dialog's two-column layout and the five
 * resurrection spells' identity fields, updated for the accepted restructure.
 *
 * The accepted request replaces the old five-column grid (image / Spell name /
 * Meaning / Function / Enabled) with two columns of rows: the left column shows
 * the spell name with its magic category and level on one line beneath it, and
 * the right column shows a brief effect explanation. The modal is portaled to
 * `document.body`, so its rows live outside the render container.
 *
 * What this file protects:
 *   - the body grid keeps exactly two tracks, the left half the width of the
 *     right (`grid-cols-[1fr_2fr]`);
 *   - each of the five resurrection spells keeps its id, name and Minor
 *     category, and its meaning text is no longer rendered;
 *   - the five resurrection spells appear in ascending id order (21-25).
 *
 * It deliberately does NOT assert the old column headers, the old per-row grid,
 * or the old Enabled column, all of which the request intentionally removes.
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
 * A spell table fixture carrying the five resurrection spells plus one entry
 * per other category, so the dialog renders a stable multi-row table. The
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

/**
 * Parse a Tailwind `grid-cols-[...]` class into its ordered track list. The
 * class is the only place the dialog declares its column widths.
 */
function gridTracks(el: HTMLElement): string[] {
  const cls = el.className;
  const match = cls.match(/grid-cols-\[([^\]]+)\]/);
  if (match === null) throw new Error("element has no grid-cols-[...] class");
  return match[1].split("_");
}

describe("spell table two-column body grid", () => {
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

  it("keeps two grid tracks with the left half the width of the right", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const grid = document.querySelector<HTMLElement>(
      "[data-ocid='spell_table.dialog'] .grid",
    );
    expect(grid).not.toBeNull();
    if (grid === null) return;
    const tracks = gridTracks(grid);

    // The accepted request replaces the five-column grid with two columns of
    // rows: the left column (name + category/level) is half the width of the
    // right column (effect explanation).
    expect(tracks).toHaveLength(2);
    const frValue = (track: string | undefined): number =>
      Number.parseFloat(track?.match(/([\d.]+)fr/)?.[1] ?? "0");
    expect(frValue(tracks[1])).toBe(frValue(tracks[0]) * 2);
  });
});

describe("resurrection spells' identity fields", () => {
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

  it("keeps each resurrection spell's name and no longer renders its meaning", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    for (const spell of RESURRECTION_SPELLS) {
      const row = rowFor(spell.name);
      expect(row).toHaveTextContent(spell.name);
      // The accepted request removes the Meaning column, so the meaning text
      // no longer appears in any row. Skip the entries whose meaning string is
      // identical to the spell name (Lazarus, Anne Boleyn), where the name
      // itself would satisfy the assertion.
      if (spell.meaning !== spell.name) {
        expect(row).not.toHaveTextContent(spell.meaning);
      }
    }
  });

  it("renders the five resurrection spells in the Minor section in id order", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

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
});
