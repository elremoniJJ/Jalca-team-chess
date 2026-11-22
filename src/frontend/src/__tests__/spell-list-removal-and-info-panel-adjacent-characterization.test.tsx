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

// The app marks elements with `data-ocid`; the info-panel button is located by
// that stable marker rather than its label.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the spell-list removal and the NFT Spells
 * information-panel rewrite.
 *
 * The request intentionally changes three things, which this file deliberately
 * does NOT pin:
 *   - the spell list loses Sinchua Cuna Vua, Xetang, Sandy Balls, Cloudy Balls,
 *     Grassy Balls, Fiery Balls and Wooden Balls;
 *   - the Hairy / Shiny / Veiny Balls effect texts are replaced with the short
 *     "Places <name> on the squares of the opponent." wording;
 *   - the information panel's text is replaced with the new "Game NFT spells"
 *     content.
 *
 * What IS protected here — the surrounding behavior those changes must not
 * disturb, and which the existing suite does not already cover:
 *   1. the information panel keeps its "Spell names and effects" button, and
 *      that button still opens the full-screen spell list;
 *   2. the remaining spells (Subao Ve, Tia Lua, Bendika) still render normally
 *      in the spell list with their name and effect text;
 *   3. the spell list keeps its accessible dialog semantics (role="dialog",
 *      aria-modal, title heading).
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
 * A spell table fixture carrying the spells that SURVIVE the removal, with
 * their real names and effect text. The removed spells and the three Balls
 * effect texts are the intentional change and are deliberately absent from
 * this fixture.
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

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the spell list and info panel.
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

/** Open the info panel, then the spell-table modal. */
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

describe("spell list removal and info panel (adjacent behavior)", () => {
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

  it("keeps the 'Spell names and effects' button in the info panel and opens the spell list from it", async () => {
    const user = userEvent.setup();
    renderWindow();
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );

    // The button survives the panel rewrite and still opens the full-screen
    // spell list.
    const button = screen.getByTestId(
      "wallet_connection_window.spell_table_button",
    );
    expect(button).toHaveTextContent("Spell names and effects");

    await user.click(button);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the spell list's accessible dialog semantics and title heading", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const title = document.getElementById(labelledBy ?? "");
    expect(title).not.toBeNull();
    expect(title).toHaveTextContent("Spell names and effects");
  });

  it("still renders the remaining spells with their name and effect text", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    // The spells that survive the removal keep rendering normally, each with
    // its name and its effect text.
    const subaoRow = rowFor("Subao Ve");
    expect(within(subaoRow).getByText("Subao Ve")).toBeInTheDocument();
    expect(
      within(subaoRow).getByText("Preemptively sets up a shield."),
    ).toBeInTheDocument();

    const tiaRow = rowFor("Tia Lua");
    expect(within(tiaRow).getByText("Tia Lua")).toBeInTheDocument();
    expect(
      within(tiaRow).getByText("Removes 1 random enemy Pawn from the board."),
    ).toBeInTheDocument();

    const bendikaRow = rowFor("Bendika");
    expect(within(bendikaRow).getByText("Bendika")).toBeInTheDocument();
    expect(
      within(bendikaRow).getByText(
        "Removes all remaining enemy Pawns from the board.",
      ),
    ).toBeInTheDocument();

    // The list renders one row per surviving spell, in block/minor/major order.
    const rows = Array.from(
      dialog.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
    );
    expect(rows.length).toBe(3);
    expect(rows[0]).toHaveTextContent("Subao Ve");
    expect(rows[1]).toHaveTextContent("Tia Lua");
    expect(rows[2]).toHaveTextContent("Bendika");
  });
});
