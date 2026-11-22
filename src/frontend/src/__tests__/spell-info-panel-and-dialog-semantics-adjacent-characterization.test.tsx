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
// that stable marker rather than its label, which the request relabels.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the spell-table modal is moved out of the
 * board-sized overlay into a full-screen modal, its rows are re-laid-out into
 * two columns, and the info-panel button is relabelled.
 *
 * The request intentionally changes the modal's container geometry, its row
 * grid, and the button label. This file therefore deliberately does NOT assert
 * the modal's container size/position, its row grid, or the button label —
 * those are the behavior under change.
 *
 * What it protects is the surrounding behavior that must survive the
 * restructure:
 *   - the NFT spells information panel keeps its explanatory content (the four
 *     NFT spells, how powers are calculated, the first-turn restriction, and
 *     the burning-authorization notice) — the request only relabels the button
 *     inside it;
 *   - the spell-table modal keeps its accessible dialog semantics: it is a
 *     `role="dialog"` with `aria-modal="true"` and an accessible name taken
 *     from its title heading;
 *   - the modal keeps its title heading text.
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
 * A spell table fixture with one entry per category (Block + Minor + Major +
 * Balls) so the modal renders four rows in its block/minor/major/balls order.
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

/**
 * Open the info panel, then the spell-table modal. The button is located by
 * its stable data-ocid marker rather than its label, because the request
 * intentionally relabels it.
 */
async function openSpellTable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
  );
  await user.click(
    screen.getByTestId("wallet_connection_window.spell_table_button"),
  );
  return screen.findByRole("dialog");
}

describe("NFT spells info panel and spell-table dialog semantics (adjacent behavior)", () => {
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

  it("keeps the info panel's explanatory content around the spell-table button", async () => {
    const user = userEvent.setup();
    renderWindow();
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );

    // The request replaces the panel's explanatory content with the new
    // 'Game NFT spells' copy; the panel still renders its sections around the
    // spell-table button.
    expect(screen.getByText("Game NFT spells")).toBeInTheDocument();
    expect(screen.getByText("Getting spells")).toBeInTheDocument();
    expect(screen.getByText("The kinds of spell")).toBeInTheDocument();
    expect(screen.getByText("How power works")).toBeInTheDocument();
    expect(screen.getByText("Playing a spell")).toBeInTheDocument();
    expect(screen.getByText("First turn")).toBeInTheDocument();
    expect(screen.getByText("Played spells are burned")).toBeInTheDocument();

    // The button itself is still present (located by its stable marker, not
    // its label, which the request changes).
    expect(
      screen.getByTestId("wallet_connection_window.spell_table_button"),
    ).toBeInTheDocument();
  });

  it("shows the new 'Game NFT spells' heading and intro", async () => {
    const user = userEvent.setup();
    renderWindow();
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );

    // The accepted panel heading and intro, verbatim.
    expect(
      screen.getByRole("heading", { name: "Game NFT spells" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "NFT spells let you influence the game. Here is how they work.",
      ),
    ).toBeInTheDocument();
  });

  it("shows all six supplied sections with their text", async () => {
    const user = userEvent.setup();
    renderWindow();
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );

    // Each of the six supplied sections renders its heading and its body text.
    expect(screen.getByText("Getting spells")).toBeInTheDocument();
    expect(
      screen.getByText(/At the end of a game, spells are awarded to players/i),
    ).toBeInTheDocument();

    expect(screen.getByText("The kinds of spell")).toBeInTheDocument();
    expect(
      screen.getByText(/There are five kinds of spell: Subao Ve, Necromancy/i),
    ).toBeInTheDocument();

    expect(screen.getByText("How power works")).toBeInTheDocument();
    expect(
      screen.getByText(/A spell's power is the current game number minus/i),
    ).toBeInTheDocument();

    expect(screen.getByText("Playing a spell")).toBeInTheDocument();
    expect(
      screen.getByText(
        /A Subao Ve can be played on top of existing protection, increasing that protection/i,
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("First turn")).toBeInTheDocument();
    expect(
      screen.getByText(/On the first turn the Move_Maker can't play/i),
    ).toBeInTheDocument();

    expect(screen.getByText("Played spells are burned")).toBeInTheDocument();
    expect(
      screen.getByText(/A played spell is burned and never returned/i),
    ).toBeInTheDocument();
  });

  it("keeps the 'Spell names and effects' button and opens the spell list", async () => {
    const user = userEvent.setup();
    renderWindow();
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );

    // The button keeps its accepted label and opens the full-screen modal.
    const button = screen.getByRole("button", {
      name: "Spell names and effects",
    });
    expect(button).toBeInTheDocument();

    await user.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Spell names and effects" }),
    ).toBeInTheDocument();
  });

  it("keeps the modal's accessible dialog semantics and title heading", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    // The request changes the modal's container geometry, not its dialog
    // semantics: it stays a modal dialog with an accessible name.
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // The accessible name is taken from the title heading via aria-labelledby.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const title = document.getElementById(labelledBy ?? "");
    expect(title).not.toBeNull();
    expect(title).toHaveTextContent("Spell names and effects");

    // The title heading is rendered inside the dialog.
    expect(
      within(dialog).getByText("Spell names and effects"),
    ).toBeInTheDocument();
  });
});
