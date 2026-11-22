import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted change to the "Spell names, meanings and effects"
 * modal: it no longer renders a MEANING column header or any meaning text in
 * its rows. Each row shows only the spell name and its function/effect (plus
 * the existing spell art and Enabled state).
 *
 * The backend actor is a typed local mock throughout: this is
 * component/integration coverage, not deployed browser E2E. The real spell
 * table read (`getSpellTable`) is asserted in the PocketIC backend lane, not
 * here.
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
 * A spell table fixture whose entries carry a distinctive `meaning` string, so
 * a regression that re-renders the Meaning column is caught by the meaning
 * text appearing in the dialog.
 */
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: "Easy",
      nftEligible: true,
      meaning: "MEANING_SENTINEL_BLOCK",
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
        meaning: "MEANING_SENTINEL_MINOR",
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
        meaning: "MEANING_SENTINEL_MAJOR",
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

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the spell table.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

function renderWalletWindow() {
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

describe("spell table modal without a Meaning column", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  function seedSpellTable() {
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
  }

  it("renders no 'Meaning' column header", async () => {
    seedSpellTable();
    const user = userEvent.setup();
    renderWalletWindow();
    const dialog = await openSpellTable(user);

    // The accepted two-column layout has no column headers at all: the old
    // Spell name / Meaning / Function / Enabled header row is gone. The
    // surviving intent of this test is that no Meaning header (or any other
    // old header) is rendered.
    expect(within(dialog).queryByText("Meaning")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Spell name")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Function")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Enabled")).not.toBeInTheDocument();
  });

  it("renders no meaning text in any spell row", async () => {
    seedSpellTable();
    const user = userEvent.setup();
    renderWalletWindow();
    const dialog = await openSpellTable(user);

    // None of the fixture's distinctive meaning strings appear anywhere in the
    // dialog, and no row carries a meaning cell.
    expect(dialog.textContent).not.toContain("MEANING_SENTINEL_BLOCK");
    expect(dialog.textContent).not.toContain("MEANING_SENTINEL_MINOR");
    expect(dialog.textContent).not.toContain("MEANING_SENTINEL_MAJOR");
  });

  it("shows each spell's name and its function/effect", async () => {
    seedSpellTable();
    const user = userEvent.setup();
    renderWalletWindow();
    const dialog = await openSpellTable(user);

    // Each row shows the spell name and its function text.
    expect(within(dialog).getByText("Subao Ve")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Preemptively sets up a shield."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Tia Lua")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Removes 1 random enemy Pawn from the board."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Bendika")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Removes all remaining enemy Pawns from the board.",
      ),
    ).toBeInTheDocument();
  });
});
