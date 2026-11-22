import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The app marks elements with `data-ocid`; the spell-table button is located by
// that stable marker rather than its label.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the behavior ADJACENT to the accepted change that
 * rewrites the Subao Ve effect text in the spell list so it no longer claims
 * only one Subao Ve can be active at a time, and instead says a Subao Ve can be
 * played on top of existing protection, increasing that protection.
 *
 * The request changes the `spell` field of the BLOCK entry (id 0) in the
 * module-constant spell table in src/backend/lib/spells.mo, which the frontend
 * renders verbatim in the "Spell names and effects" modal. This file therefore
 * deliberately does NOT pin the Subao Ve effect wording — that is the text
 * under change. It protects the surrounding behavior the wording change must
 * not disturb:
 *
 *   - the Subao Ve row still renders first, with its name;
 *   - the effect text is still rendered verbatim from the backend `spell.spell`
 *     field (proved with a sentinel, so neither the old nor the new production
 *     wording is pinned);
 *   - the row still carries its identity fields (id 0, Block category,
 *     nftEligible = true, meaning "Protection");
 *   - the sibling spells' effect text is untouched.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering of the static table — not real backend
 * behavior. The real `getSpellTable` query is exercised by the PocketIC lane.
 * See episode.coverageLimits.
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

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the spell table.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

/**
 * A spell table fixture with the Subao Ve BLOCK entry plus one Minor and one
 * Major sibling. The Subao Ve effect text is a neutral placeholder: the exact
 * wording is the intentional change and is never asserted here.
 */
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: "Easy",
      nftEligible: true,
      meaning: "Protection",
      name: "Subao Ve",
      spell: "PLACEHOLDER-SUBAO-VE-EFFECT-TEXT",
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
    screen.getByTestId("wallet_connection_window.spell_table_button"),
  );
  return screen.findByRole("dialog");
}

/** The row whose text contains the given spell name. The modal is portaled to
 * document.body, so rows are queried there rather than in the render
 * container. */
function rowFor(name: string): HTMLElement {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
  );
  const row = rows.find((r) => r.textContent?.includes(name));
  if (row === undefined) throw new Error(`no spell table row for ${name}`);
  return row;
}

describe("Subao Ve effect text stacking — adjacent behavior", () => {
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

  it("still renders the Subao Ve row first with its name", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const rows = document.querySelectorAll("[data-ocid^='spell_table.row.']");
    expect(rows.length).toBe(3);
    expect(rows[0]).toHaveTextContent("Subao Ve");

    const row = rowFor("Subao Ve");
    expect(within(row).getByText("Subao Ve")).toBeInTheDocument();
  });

  it("renders the Subao Ve effect text verbatim from the backend field", async () => {
    // The frontend must not hardcode the Subao Ve wording: it renders whatever
    // `spell.spell` the backend returns. This is the seam the accepted backend
    // change travels through, so a distinct sentinel proves the pass-through
    // without pinning either the old or the new production wording.
    const sentinel = "SENTINEL-SUBAO-VE-STACKING-EFFECT-TEXT";
    getSpellTable.mockResolvedValue({
      ...spellTable,
      block: { ...spellTable.block, spell: sentinel },
    });

    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const row = rowFor("Subao Ve");
    expect(within(row).getByText(sentinel)).toBeInTheDocument();
  });

  it("keeps the Subao Ve entry's identity fields unchanged", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The request changes only the effect text, so the entry's identity fields
    // are the contract: it stays the first row, named Subao Ve, and the backend
    // fixture still carries id 0, the Block category, nftEligible=true and the
    // "Protection" meaning.
    const rows = document.querySelectorAll("[data-ocid^='spell_table.row.']");
    expect(rows[0]).toHaveTextContent("Subao Ve");

    const row = rowFor("Subao Ve");
    expect(within(row).getByText("Subao Ve")).toBeInTheDocument();
    expect(spellTable.block.id).toBe(0n);
    expect(spellTable.block.category).toEqual({ Block: null });
    expect(spellTable.block.nftEligible).toBe(true);
    expect(spellTable.block.meaning).toBe("Protection");
  });

  it("leaves the sibling spells' effect text untouched", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    // The request touches only the Subao Ve entry, so the sibling entries'
    // effect text is the contract.
    const tia = rowFor("Tia Lua");
    expect(tia).toHaveTextContent("Tia Lua");
    expect(tia).toHaveTextContent(
      "Removes 1 random enemy Pawn from the board.",
    );

    const bendika = rowFor("Bendika");
    expect(bendika).toHaveTextContent("Bendika");
    expect(bendika).toHaveTextContent(
      "Removes all remaining enemy Pawns from the board.",
    );
  });
});
