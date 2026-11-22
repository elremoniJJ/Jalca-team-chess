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
 * Cover for the accepted change that removes seven spells from the spell list,
 * shortens the three image Balls spells' effect text, and replaces the NFT
 * Spells information panel with the new "Game NFT spells" content.
 *
 * The accepted request:
 *   - removes Sinchua Cuna Vua, Xetang, Sandy Balls, Cloudy Balls, Grassy
 *     Balls, Fiery Balls and Wooden Balls from the list;
 *   - makes the Hairy / Shiny / Veiny Balls effect text read exactly
 *     "Places <name> on the squares of the opponent.", each naming only itself;
 *   - replaces the information panel text with the supplied "Game NFT spells"
 *     content covering Getting spells, The kinds of spell, How power works,
 *     Playing a spell, First turn, and Played spells are burned.
 *
 * This file pins the observable consequences of that change through the real
 * component: the removed names are absent from the rendered list, the three
 * Balls rows carry their exact short effect text, and the panel shows the new
 * heading, intro and all six sections. The sibling characterization file
 * protects the surrounding behavior (the button, the dialog semantics, the
 * surviving spells) and deliberately does not pin the change.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering of the table — not real backend
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

/**
 * A spell table fixture carrying the POST-change table: the surviving Block /
 * Minor / Major spells, and the three Balls spells with their accepted short
 * effect text. The seven removed spells are deliberately absent, matching the
 * accepted backend table.
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
        id: 31n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Hairy Balls",
        name: "Hairy Balls",
        spell: "Places Hairy Balls on the squares of the opponent.",
        category: { Balls: null },
        dropChance: 0n,
        magicCategory: "Hex",
        level: "Skilled",
      },
      {
        id: 32n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Veiny Balls",
        name: "Veiny Balls",
        spell: "Places Veiny Balls on the squares of the opponent.",
        category: { Balls: null },
        dropChance: 0n,
        magicCategory: "Hex",
        level: "Advanced",
      },
      {
        id: 33n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Shiny Balls",
        name: "Shiny Balls",
        spell: "Places Shiny Balls on the squares of the opponent.",
        category: { Balls: null },
        dropChance: 0n,
        magicCategory: "Hex",
        level: "Basic",
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

/** The seven spell names the accepted request removes from the list. */
const REMOVED_NAMES = [
  "Sinchua Cuna Vua",
  "Xetang",
  "Sandy Balls",
  "Cloudy Balls",
  "Grassy Balls",
  "Fiery Balls",
  "Wooden Balls",
];

describe("spell list removal and Balls wording (accepted change)", () => {
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

  it("does not render any of the seven removed spells in the list", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    for (const removed of REMOVED_NAMES) {
      expect(within(dialog).queryByText(removed)).not.toBeInTheDocument();
    }
  });

  it("renders the three Balls spells with their exact short effect text", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    const expected: Array<[string, string]> = [
      ["Hairy Balls", "Places Hairy Balls on the squares of the opponent."],
      ["Shiny Balls", "Places Shiny Balls on the squares of the opponent."],
      ["Veiny Balls", "Places Veiny Balls on the squares of the opponent."],
    ];
    for (const [name, effect] of expected) {
      const row = rowFor(name);
      expect(within(row).getByText(name)).toBeInTheDocument();
      expect(within(row).getByText(effect)).toBeInTheDocument();
    }
  });

  it("never groups the three Balls spells as 'Hairy/Shiny/Veiny Balls'", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    for (const name of ["Hairy Balls", "Shiny Balls", "Veiny Balls"]) {
      const row = rowFor(name);
      expect(row).not.toHaveTextContent("Hairy/Shiny/Veiny Balls");
    }
  });

  it("shows the new 'Game NFT spells' heading and intro in the info panel", async () => {
    const user = userEvent.setup();
    renderWindow();
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );

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

  it("shows no claim that only one Subao Ve can be active at a time", async () => {
    const user = userEvent.setup();
    renderWindow();
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );

    // The accepted change removes the old "only one Subao Ve can be active at a
    // time" claim from the "Playing a spell" panel. Assert the panel's body
    // carries neither the old sentence nor its distinctive phrasing.
    const panel = screen.getByText("Playing a spell").parentElement;
    expect(panel).not.toBeNull();
    expect(panel).not.toHaveTextContent(/only one Subao Ve/i);
    expect(panel).not.toHaveTextContent(/active at a time/i);
    expect(panel).not.toHaveTextContent(/can be active/i);
  });

  it("keeps the 'Spell names and effects' button and opens the spell list", async () => {
    const user = userEvent.setup();
    renderWindow();
    await user.click(
      screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
    );

    const button = screen.getByTestId(
      "wallet_connection_window.spell_table_button",
    );
    expect(button).toHaveTextContent("Spell names and effects");

    await user.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Spell names and effects" }),
    ).toBeInTheDocument();
  });
});
