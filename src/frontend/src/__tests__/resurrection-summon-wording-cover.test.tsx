import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted resurrection-spell wording change.
 *
 * The request rewrites the five resurrection spells' (ids 21-25: Thayma,
 * Hipsy Titam, Lazarus, Cuoclot Sac Wonmuc Rook, Anne Boleyn) Function text to
 * "Summons 1 friendly <type> on the closest safe square to the centre, whether
 * or not one was captured." and removes the old "Respawns 1 previously
 * captured ... (Requires at least 1 captured ...)" wording.
 *
 * This file renders the real `WalletConnectionWindow` spell-table modal against
 * a typed local actor mock whose `getSpellTable` returns the accepted table, so
 * it proves the new text reaches the user through the real component tree. The
 * sibling `resurrection-spells-adjacent-characterization.test.tsx` deliberately
 * uses placeholder text for these five entries and never asserts on it; this
 * file is the one that pins the accepted wording.
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
 * The five resurrection spells' identity fields plus the exact accepted
 * Function text. The piece type in the text is the piece the spell summons.
 */
const RESURRECTION_SPELLS = [
  { id: 21n, name: "Thayma", meaning: "Zombie", piece: "Pawn" },
  {
    id: 22n,
    name: "Hipsy Titam",
    meaning: "Knight whisperer",
    piece: "Knight",
  },
  { id: 23n, name: "Lazarus", meaning: "Lazarus", piece: "Bishop" },
  {
    id: 24n,
    name: "Cuoclot Sac Wonmuc Rook",
    meaning: "Extreme Makeover: Rook edition",
    piece: "Rook",
  },
  { id: 25n, name: "Anne Boleyn", meaning: "Anne Boleyn", piece: "Queen" },
] as const;

/** The accepted Function text for a resurrection spell. */
function acceptedText(piece: string): string {
  return `Summons 1 friendly ${piece} on the closest safe square to the centre, whether or not one was captured.`;
}

/**
 * A spell table fixture carrying the five resurrection spells with the accepted
 * wording, plus a neighbouring removal spell so the modal has a stable row set.
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
        spell:
          "Summons 1 friendly Pawn on the closest safe square to the centre, whether or not one was captured.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 22n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Knight whisperer",
        name: "Hipsy Titam",
        spell:
          "Summons 1 friendly Knight on the closest safe square to the centre, whether or not one was captured.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 23n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Lazarus",
        name: "Lazarus",
        spell:
          "Summons 1 friendly Bishop on the closest safe square to the centre, whether or not one was captured.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 24n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Extreme Makeover: Rook edition",
        name: "Cuoclot Sac Wonmuc Rook",
        spell:
          "Summons 1 friendly Rook on the closest safe square to the centre, whether or not one was captured.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 25n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Anne Boleyn",
        name: "Anne Boleyn",
        spell:
          "Summons 1 friendly Queen on the closest safe square to the centre, whether or not one was captured.",
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

describe("resurrection spell summon wording", () => {
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

  it("shows the new summon wording for each of the five resurrection spells", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    await openSpellTable(user);

    for (const spell of RESURRECTION_SPELLS) {
      const row = rowFor(container, spell.name);
      expect(row).toHaveTextContent(spell.name);
      expect(row).toHaveTextContent(spell.meaning);
      // The accepted Function text is the contract, verbatim.
      expect(row).toHaveTextContent(acceptedText(spell.piece));
    }
  });

  it("drops the superseded captured-piece requirement wording from every resurrection row", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    await openSpellTable(user);

    for (const spell of RESURRECTION_SPELLS) {
      const row = rowFor(container, spell.name);
      // The old wording required a previously captured piece. The accepted
      // text keeps the word "captured" only in the "whether or not one was
      // captured" clause, so assert the requirement phrasing is gone rather
      // than the bare word.
      expect(row).not.toHaveTextContent(/Respawns/i);
      expect(row).not.toHaveTextContent(/previously captured/i);
      expect(row).not.toHaveTextContent(/Requires at least 1/i);
      expect(row).not.toHaveTextContent(/requires a captured/i);
    }
  });
});
