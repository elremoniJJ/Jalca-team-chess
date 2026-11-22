import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the three accepted changes in this request:
 *
 *   1. the Subao Ve spell description now states that an offensive spell at
 *      least twice as powerful as Subao Ve not only depletes Subao Ve but also
 *      takes effect on the chessboard;
 *   2. a short support note sits ABOVE the Prediction Bet explanation text,
 *      saying prediction betting funds the website, that support is
 *      appreciated, and linking to jalca-escrow-ledger.xyz in a new tab;
 *   3. a new collapsible "Also on the IC" window sits at the very top of the
 *      game page window stack, above "Vote on next game", showing a row of six
 *      tiles — three linked (delulu.game, piko.network, icp-flags.fans) and
 *      three "open to suggestions" placeholders — with each linked tile
 *      opening its target in a new browser tab.
 *
 * The Subao Ve description is sourced from the backend `spell.spell` field, so
 * the accepted wording is asserted through the real spell-table rendering with
 * a typed local actor mock. The backend resolution math itself is NOT exercised
 * here (the PocketIC lane cannot reach the burn path either — the external
 * collection canister is absent), so it remains a coverage limit.
 *
 * The backend actor is a typed local mock; this is component/integration
 * coverage, not deployed browser E2E or real backend behavior. See
 * episode.coverageLimits.
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
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  Team: { Black: "Black", White: "White" },
  Pot: { One: "One", Ten: "Ten", Hundred: "Hundred", Thousand: "Thousand" },
  GameOutcome: { white: "white", black: "black", draw: "draw" },
}));

vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

// The PredictionBetWindow's BettingPanel calls usePbppBet; mock it to the
// hook's resting (disconnected) state so the window renders without a real
// wallet or actor. The info content under test never touches the hook.
vi.mock("@/lib/use-pbpp-bet", () => ({
  usePbppBet: () => ({
    connection: { status: "disconnected" },
    connect: vi.fn(),
    disconnect: vi.fn(),
    signerAvailable: true,
    anonymous: false,
    setAnonymous: vi.fn(),
    submitState: { status: "idle" },
    submitBet: vi.fn(),
    approveAllowance: vi.fn(),
    checkAllowance: vi.fn().mockResolvedValue(null),
    relayState: { status: "idle" },
    relayBet: vi.fn(),
    getRealBets: vi.fn().mockResolvedValue([]),
    getSettlements: vi.fn().mockResolvedValue([]),
  }),
}));

// The PredictionBetWindow's BettingPanel reads useGameState; the info content
// under test is static copy, so a resting snapshot is enough.
vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: { players: [{ principal: "player-1", username: "Ada" }] },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useActiveIdentity: () => "player-1",
  useSpectator: () => null,
  isSpectating: () => false,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
}));

// The Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. Mock the modal to a
// marker; this test never opens it.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so the spell-table test stays focused on the table.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
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
import { AlsoOnIcWindow } from "@/components/AlsoOnIcWindow";
import { Layout } from "@/components/Layout";
import { PredictionBetWindow } from "@/components/PredictionBetWindow";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/* ------------------------------------------------------------------ */
/* 1. Subao Ve description states the fire-and-deplete rule            */
/* ------------------------------------------------------------------ */

/**
 * The accepted Subao Ve wording, as published by the backend `spell.spell`
 * field. The frontend renders this text verbatim in the spell table, so
 * asserting it appears proves the accepted description reaches the UI.
 */
const SUBAO_VE_ACCEPTED_DESCRIPTION =
  "Protection against incoming enemy spells. A spell can only affect the game if it has at least double the power of the Subao Ve. Otherwise it only reduces the Subao Ve's remaining power.";

const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: "Easy",
      nftEligible: true,
      meaning: "Protection",
      name: "Subao Ve",
      spell:
        "Protection against incoming enemy spells. A spell can only affect the game if it has at least double the power of the Subao Ve. Otherwise it only reduces the Subao Ve's remaining power.",
      category: { Block: null },
      dropChance: 8n,
    },
    minor: [
      {
        id: 3n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Plague",
        name: "Bendika",
        spell: "Removes all remaining enemy Pawns from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
    ],
    major: [
      {
        id: 1n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Queen horse",
        name: "Newkai Dodan",
        spell: "Replaces the enemy Queen with an enemy Knight.",
        category: { Major: null },
        dropChance: 2n,
      },
    ],
    balls: [],
  },
}));

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

describe("Subao Ve description states the fire-and-deplete rule", () => {
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

  it("renders the accepted Subao Ve description, including the twice-as-powerful rule", async () => {
    const user = userEvent.setup();
    // Seed the NFT wallet window open so its body (and the info panel) mounts.
    window.localStorage.setItem("tco-wallet-connection-open", "true");
    const { container } = renderWithProviders(
      <WalletConnectionWindow spellUse={SpellUse.On} />,
    );

    await openSpellTable(user);

    const row = rowFor(container, "Subao Ve");
    expect(within(row).getByText("Subao Ve")).toBeInTheDocument();
    // The accepted wording is rendered verbatim from the backend field.
    expect(
      within(row).getByText(SUBAO_VE_ACCEPTED_DESCRIPTION),
    ).toBeInTheDocument();
    // The specific accepted clause: a spell needs at least double the power to
    // affect the game.
    expect(row.textContent).toContain(
      "A spell can only affect the game if it has at least double the power of the Subao Ve",
    );
  });
});

/* ------------------------------------------------------------------ */
/* 2. Prediction Bet support note above the explanation text           */
/* ------------------------------------------------------------------ */

describe("Prediction Bet support note", () => {
  beforeEach(() => {
    useGameState.mockReturnValue({
      data: { players: [{ principal: "player-1", username: "Ada" }] },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  async function openBetInfo() {
    const user = userEvent.setup();
    // Seed the Prediction Bet window open so its body (and the info panel)
    // mounts regardless of the collapsed-by-default first-visit state.
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);
    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );
    return user;
  }

  it("shows the support note above the explanation text, mentioning funding and support", async () => {
    await openBetInfo();

    const note = screen.getByText(
      /Prediction betting is what funds this website/,
    );
    expect(note).toBeInTheDocument();
    expect(note.textContent).toContain("your support is much appreciated");

    // The note sits ABOVE the explanation paragraph in DOM order.
    const explanation = screen.getByText(
      /Prediction betting lets players put real ICP on the line/,
    );
    expect(
      note.compareDocumentPosition(explanation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("links to jalca-escrow-ledger.xyz in a new browser tab", async () => {
    await openBetInfo();

    const note = screen.getByText(
      /Prediction betting is what funds this website/,
    );
    const link = within(note).getByRole("link", {
      name: "jalca-escrow-ledger.xyz",
    });
    expect(link).toHaveAttribute("href", "https://jalca-escrow-ledger.xyz");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Also on the IC window                                            */
/* ------------------------------------------------------------------ */

describe("AlsoOnIcWindow", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("is collapsed by default and expands/collapses via the header", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AlsoOnIcWindow />);

    const header = screen.getByRole("button", { name: "Also on the IC" });
    // Collapsed by default: the body (and its tiles) is unmounted.
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("link", { name: /delulu\.game/ }),
    ).not.toBeInTheDocument();

    // Expanding mounts the body.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("link", { name: /delulu\.game/ }),
    ).toBeInTheDocument();

    // Collapsing unmounts the body again.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("link", { name: /delulu\.game/ }),
    ).not.toBeInTheDocument();
  });

  it("shows a row of six tiles: three linked and three open-to-suggestions placeholders", () => {
    // Seed the window open so the tile row is mounted.
    window.localStorage.setItem("tco-also-on-ic-open", "true");
    const { container } = renderWithProviders(<AlsoOnIcWindow />);

    const tiles = container.querySelectorAll('[data-ocid^="also_on_ic.tile."]');
    expect(tiles).toHaveLength(6);

    // The three linked tiles point at their target sites.
    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a[data-ocid^="also_on_ic.tile."]',
      ),
    );
    expect(links).toHaveLength(3);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://delulu.game",
      "https://www.piko.network",
      "https://icp-flags.fans",
    ]);

    // The three placeholders carry the "open to suggestions" label and are not
    // links.
    const placeholders = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-ocid^="also_on_ic.tile.suggestion-"]',
      ),
    );
    expect(placeholders).toHaveLength(3);
    for (const tile of placeholders) {
      expect(tile.tagName).not.toBe("A");
      expect(tile.textContent).toContain("open to suggestions");
    }
  });

  it("opens each linked tile in a new browser tab", () => {
    // Seed the window open so the tile row is mounted.
    window.localStorage.setItem("tco-also-on-ic-open", "true");
    const { container } = renderWithProviders(<AlsoOnIcWindow />);

    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a[data-ocid^="also_on_ic.tile."]',
      ),
    );
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4. Layout places Also on the IC above Vote on next game             */
/* ------------------------------------------------------------------ */

function renderLayout(
  windows: Partial<React.ComponentProps<typeof Layout>["windows"]>,
) {
  return render(
    <Layout
      onLogout={() => {}}
      windows={{
        board: <div data-testid="board-content" />,
        ...windows,
      }}
    />,
  );
}

describe("Layout places the board window above the wallet window", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders the board window above the wallet window", () => {
    const { container } = renderLayout({
      wallet: <div data-testid="wallet-content" />,
    });

    const board = container.querySelector('[data-ocid="window.board"]');
    const wallet = container.querySelector('[data-ocid="window.wallet"]');
    expect(board).not.toBeNull();
    expect(wallet).not.toBeNull();

    // DOM order encodes the vertical stack: board precedes wallet.
    const ordered = Array.from(
      container.querySelectorAll(
        '[data-ocid="window.board"], [data-ocid="window.wallet"]',
      ),
    );
    expect(ordered).toEqual([board, wallet]);
  });

  it("omits the wallet window when the route does not provide it", () => {
    const { container } = renderLayout({});

    expect(container.querySelector('[data-ocid="window.wallet"]')).toBeNull();
  });
});
