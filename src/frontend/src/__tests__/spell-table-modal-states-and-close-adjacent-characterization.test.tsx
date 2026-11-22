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
 * board-sized overlay into a full-screen modal and its rows are re-laid-out
 * into two columns.
 *
 * The request intentionally changes the modal's presentation: its container
 * becomes full-viewport, its rows become a two-column name/effect layout, and
 * the info-panel button is relabelled. This file therefore deliberately does
 * NOT assert the modal's container geometry, its row grid, or the button
 * label — those are the behavior under change.
 *
 * What it protects is the modal's surrounding behavior, which must survive the
 * restructure:
 *   - the modal still opens from the info panel's spell-table button;
 *   - it still fetches the list through the actor's `getSpellTable` seam;
 *   - it still shows a loading state before the list resolves;
 *   - it still shows an error state when the fetch fails;
 *   - it still closes via its close button and its dismiss button;
 *   - it still lists every spell across Block / Minor / Major / Balls, in the
 *     block/minor/major/balls order.
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

describe("spell table modal states and close paths (adjacent behavior)", () => {
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

  it("fetches the list through the actor's getSpellTable seam", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    expect(getSpellTable).toHaveBeenCalled();
  });

  it("shows a loading state before the list resolves", async () => {
    // A never-resolving fetch keeps the query in its loading state.
    getSpellTable.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    expect(
      within(dialog).getByTestId("spell_table.loading_state"),
    ).toBeInTheDocument();
  });

  it("shows an error state when the fetch fails", async () => {
    getSpellTable.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    expect(
      await within(dialog).findByTestId("spell_table.error_state"),
    ).toBeInTheDocument();
  });

  it("closes via its close button", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    await user.click(screen.getByTestId("spell_table.close_button"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes via its dismiss button", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    await user.click(screen.getByTestId("spell_table.got_it_button"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every spell across Block, Minor, Major and Balls in order", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    await openSpellTable(user);

    const rows = container.querySelectorAll("[data-ocid^='spell_table.row.']");
    expect(rows.length).toBe(4);
    expect(rows[0]).toHaveTextContent("Subao Ve");
    expect(rows[1]).toHaveTextContent("Tia Lua");
    expect(rows[2]).toHaveTextContent("Bendika");
    expect(rows[3]).toHaveTextContent("Sandy Balls");
  });
});
