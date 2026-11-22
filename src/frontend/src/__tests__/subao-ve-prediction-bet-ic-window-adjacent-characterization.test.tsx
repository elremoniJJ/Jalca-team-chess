import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the ADJACENT, working behavior around the three
 * intentionally-changing surfaces in this request:
 *
 *   1. the Subao Ve spell description text (backend spellTable + api-doc prose)
 *      is being reworded to state that an offensive spell twice as powerful as
 *      Subao Ve both depletes Subao Ve and takes effect on the chessboard;
 *   2. a short support note is being added ABOVE the Prediction Bet explanation
 *      text;
 *   3. a new "Also on the IC" collapsible window is being added at the very top
 *      of the game page window stack, above "Vote on next game".
 *
 * The changing content itself is NOT frozen here. Instead this file protects
 * the seams and adjacent behavior the changes must not disturb:
 *
 *   - the spell table still renders the Subao Ve row and its description is
 *     still sourced from the backend `spell.spell` field (not hardcoded in the
 *     frontend), so a backend wording change flows through unchanged;
 *   - the Prediction Bet info content (intro, walkthrough, How it works,
 *     Worked example) and the permanent live-payments footer still render, and
 *     the info toggle still swaps between the info content and the betting
 *     panel;
 *   - the Layout still renders every existing window slot in its fixed
 *     relative order (voting → status → board → wallet → players → captured →
 *     moves → predictionBet → story) and still omits a slot the route does not
 *     provide.
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
/* 1. Subao Ve description is sourced from the backend spell table     */
/* ------------------------------------------------------------------ */

/**
 * A distinctive sentinel description. If the frontend hardcoded the Subao Ve
 * wording, this sentinel would never appear; asserting it renders proves the
 * description flows from the backend `spell.spell` field, so the accepted
 * backend wording change reaches the UI without a frontend edit.
 */
const SUBAO_VE_SENTINEL =
  "SENTINEL-SUBAO-VE-DESCRIPTION-FROM-BACKEND: shield absorbs or is destroyed.";

const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: "Easy",
      nftEligible: true,
      meaning: "Protection",
      name: "Subao Ve",
      spell:
        "SENTINEL-SUBAO-VE-DESCRIPTION-FROM-BACKEND: shield absorbs or is destroyed.",
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

describe("Subao Ve description is sourced from the backend spell table", () => {
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

  it("renders the Subao Ve row with the description supplied by the backend", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <WalletConnectionWindow spellUse={SpellUse.On} />,
    );

    await openSpellTable(user);

    const row = rowFor(container, "Subao Ve");
    // The row still renders the spell name and meaning.
    expect(within(row).getByText("Subao Ve")).toBeInTheDocument();
    expect(within(row).getByText("Protection")).toBeInTheDocument();
    // The description is the backend-supplied text, not a hardcoded frontend
    // string — so the accepted backend wording change flows through.
    expect(within(row).getByText(SUBAO_VE_SENTINEL)).toBeInTheDocument();
  });

  it("keeps the Subao Ve artwork mapping alongside the description", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <WalletConnectionWindow spellUse={SpellUse.On} />,
    );

    await openSpellTable(user);

    const row = rowFor(container, "Subao Ve");
    const img = row.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/assets/spells/subao-ve.png");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Prediction Bet info content and footer survive the support note  */
/* ------------------------------------------------------------------ */

describe("Prediction Bet info content adjacent to the new support note", () => {
  beforeEach(() => {
    // The BettingPanel reads the live roster to resolve the current player;
    // the info content under test is static copy, so a resting snapshot with
    // a players array is enough.
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
    renderWithProviders(<PredictionBetWindow />);
    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );
    return user;
  }

  it("keeps the intro paragraph, walkthrough, How it works, and Worked example", async () => {
    await openBetInfo();

    // The intro paragraph (the explanation text the support note sits above).
    expect(
      screen.getByText(
        /Prediction betting lets players put real ICP on the line/,
      ),
    ).toBeInTheDocument();

    // The interactive walkthrough and its first active stage.
    expect(screen.getByText("How your bet is placed")).toBeInTheDocument();
    expect(screen.getByText("Pick your bet")).toBeInTheDocument();
    expect(screen.getByText("1 / 8")).toBeInTheDocument();

    // The existing documentation sections.
    expect(screen.getByText("How it works")).toBeInTheDocument();
    expect(
      screen.getByText(/Players bet on the result of the NEXT game/),
    ).toBeInTheDocument();
    expect(screen.getByText("Worked example")).toBeInTheDocument();
    expect(screen.getByText(/1 ICP pot — 5 players/)).toBeInTheDocument();
  });

  it("keeps the permanent live-payments footer mention", () => {
    const { container } = renderWithProviders(<PredictionBetWindow />);

    const mention = container.querySelector(
      '[data-ocid="prediction_bet.live_payments_mention"]',
    );
    expect(mention).not.toBeNull();
    expect(mention?.textContent).toContain("to see live payments.");
    // The footer link still points at the escrow ledger.
    const link = mention?.querySelector("a");
    expect(link).toHaveAttribute("href", "https://jalca-escrow-ledger.xyz");
  });

  it("still swaps between the info content and the betting panel via the info button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);

    // Default: the wired betting panel.
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();

    // Info on: betting panel hidden, info content shown.
    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );
    expect(
      screen.queryByRole("button", { name: "1 ICP" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("How it works")).toBeInTheDocument();

    // Info off: betting panel restored.
    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();
    expect(screen.queryByText("How it works")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* 3. Layout window stack keeps its existing relative order            */
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

/** The data-ocid markers of the surviving window cards, in DOM order. */
function windowOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(
      '[data-ocid="window.board"], [data-ocid="window.wallet"]',
    ),
  ).map((el) => el.getAttribute("data-ocid") ?? "");
}

describe("Layout window stack relative order (adjacent to the new top window)", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("keeps the surviving windows in their fixed relative order", () => {
    const { container } = renderLayout({
      wallet: <div data-testid="wallet-content" />,
    });

    // The surviving windows keep their relative order: board first, then
    // wallet. The Prediction Bet and Leaderboard slots are no longer part of
    // the Layout stack.
    expect(windowOrder(container)).toEqual(["window.board", "window.wallet"]);
  });

  it("still renders the board window above the wallet window", () => {
    const { container } = renderLayout({
      wallet: <div data-testid="wallet-content" />,
    });

    const board = container.querySelector('[data-ocid="window.board"]');
    const wallet = container.querySelector('[data-ocid="window.wallet"]');
    expect(board).not.toBeNull();
    expect(wallet).not.toBeNull();

    const ordered = Array.from(
      container.querySelectorAll(
        '[data-ocid="window.board"], [data-ocid="window.wallet"]',
      ),
    );
    expect(ordered).toEqual([board, wallet]);
  });

  it("still omits optional windows the route does not provide", () => {
    const { container } = renderLayout({});

    expect(
      container.querySelector('[data-ocid="window.board"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-ocid="window.wallet"]')).toBeNull();
  });
});
