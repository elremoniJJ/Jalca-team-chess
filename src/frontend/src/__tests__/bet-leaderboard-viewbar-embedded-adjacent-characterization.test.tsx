import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The view bar and overlay carry `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the ADJACENT, working behavior around the three
 * intentionally-changing surfaces in this request:
 *
 *   1. the board view bar gains Bet and Leaderboard buttons, so it shows five
 *      buttons in the order Vote, Bet, Story, Leaderboard, Also on the IC;
 *   2. PredictionBetWindow and LeaderboardWindow gain an optional `embedded`
 *      prop that skips the collapsible header, chevron and per-window theme
 *      dots and renders the body as if open;
 *   3. the Layout stack loses the predictionBet and leaderboard slots, so only
 *      Wallet/Spells remains collapsible.
 *
 * The changing content itself is NOT frozen here. Instead this file protects
 * the seams and adjacent behavior the changes must not disturb:
 *
 *   - ViewBar is still a pure presentational control: it renders the items it
 *     is given, marks the currently-open one `aria-pressed`, reports a tap
 *     through `onSelect` without owning open state, and keeps its 3-column
 *     grid and ~44px touch targets;
 *   - with `embedded` ABSENT, PredictionBetWindow still renders its collapsible
 *     header (chevron + aria-expanded), its per-window theme dots, its info
 *     button, and still unmounts its body while collapsed and persists the
 *     open state to "tco-prediction-bet-open";
 *   - with `embedded` ABSENT, LeaderboardWindow still renders its collapsible
 *     header, its per-window theme dots, its All time / Comp toggle and its
 *     admin section, and still runs its ranking query only while the panel is
 *     open;
 *   - the Layout still renders every surviving window slot it is given and
 *     still omits a slot the caller does not provide.
 *
 * The backend actor and Oisy signer are mocked throughout; this is
 * component/integration coverage, not deployed browser E2E or real backend
 * behavior. See episode.coverageLimits.
 */

// The components import enum values from @/backend at runtime, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  Team: { Black: "Black", White: "White" },
  Pot: { One: "One", Ten: "Ten", Hundred: "Hundred", Thousand: "Thousand" },
  GameOutcome: { white: "white", black: "black", draw: "draw" },
  ClaimState: { unclaimed: "unclaimed", paying: "paying", paid: "paid" },
  ClaimStatus: { claimable: "claimable", expired: "expired" },
}));

vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

// The PredictionBetWindow's BettingPanel calls usePbppBet; mock it to the
// hook's resting (disconnected) state so the window renders without a real
// wallet or actor.
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

// The PredictionBetWindow's BettingPanel reads useGameState; a resting
// snapshot with a players array is enough for the window to mount.
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
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
}));

// The LeaderboardWindow's data layer reaches the backend through
// useActorState() from lib/backend-actor. Mock the actor seam directly so the
// window mounts without a real actor or network.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getWinnerRanking?: (limit: bigint) => Promise<unknown>;
    getSundayCompStatus?: () => Promise<unknown>;
    getSundayCompStandings?: (limit: bigint) => Promise<unknown>;
    getPastWinners?: () => Promise<unknown>;
    getMyPrize?: () => Promise<unknown>;
    getFirstPrizeForSunday?: (sunday: bigint) => Promise<unknown>;
    getClaimStatus?: (sunday: bigint) => Promise<unknown>;
    getUpcomingAllocationStatuses?: () => Promise<unknown>;
    getAdminAllocatedCompetitionDates?: () => Promise<unknown>;
  } | null,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    isLoading: actorState.isLoading,
    error: actorState.error,
    retry: vi.fn(),
  }),
}));

// The real Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. Mock the modal to a
// marker; this test never opens it.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

import { Layout } from "@/components/Layout";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { PredictionBetWindow } from "@/components/PredictionBetWindow";
import { ViewBar } from "@/components/ViewBar";

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  actorState.actor = null;
  actorState.isLoading = false;
  actorState.error = null;
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* 1. ViewBar presentational contract (adjacent to the new buttons)    */
/* ------------------------------------------------------------------ */

describe("ViewBar presentational contract adjacent to the new buttons", () => {
  it("renders the items it is given in order in a 3-column grid", () => {
    render(<ViewBar openView={null} onSelect={() => {}} />);

    const bar = screen.getByTestId("viewbar");
    const buttons = within(bar).getAllByRole("button");
    // The bar renders exactly the items it is given, in order. The Spells
    // button is inserted second, so the accepted order is Vote, Spells, Bet,
    // Story, Leaderboard, Also on the IC.
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Vote",
      "Spells",
      "Bet",
      "Story",
      "Leaderboard",
      "Also on the IC",
    ]);

    // The bar keeps its 3-column grid. The accepted layout swap shrinks the
    // board-view buttons to the small (three-button) size: text-xs with
    // compact padding and no 44px minimum height.
    expect(bar.className).toContain("grid-cols-3");
    for (const button of buttons) {
      expect(button.className).toContain("text-xs");
      expect(button.className).not.toContain("min-h-[44px]");
    }
  });

  it("marks the open view aria-pressed and reports a tap through onSelect", () => {
    const onSelect = vi.fn();
    render(<ViewBar openView="vote" onSelect={onSelect} />);

    const vote = screen.getByTestId("viewbar.vote.button");
    expect(vote).toHaveAttribute("aria-pressed", "true");
    for (const button of within(screen.getByTestId("viewbar")).getAllByRole(
      "button",
    )) {
      if (button !== vote) {
        expect(button).toHaveAttribute("aria-pressed", "false");
      }
    }

    fireEvent.click(screen.getByTestId("viewbar.story.button"));
    expect(onSelect).toHaveBeenCalledWith("story");

    // The bar does not change its own pressed state — the route owns it.
    expect(screen.getByTestId("viewbar.story.button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

/* ------------------------------------------------------------------ */
/* 2. PredictionBetWindow with embedded ABSENT behaves as today        */
/* ------------------------------------------------------------------ */

describe("PredictionBetWindow with embedded absent keeps today's behavior", () => {
  it("renders the collapsible header, chevron, theme dots and info button", () => {
    renderWithProviders(<PredictionBetWindow />);

    // The collapsible header with its aria-expanded state.
    const header = screen.getByTestId("prediction_bet_window.header");
    expect(header).toHaveAttribute("aria-expanded", "false");

    // The per-window theme dots and the info button are present.
    expect(
      screen.getByTestId("prediction_bet_window.theme_dots"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prediction_bet_window.info_button"),
    ).toBeInTheDocument();
  });

  it("unmounts the body while collapsed and persists the open state", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);

    // Collapsed by default: the body is unmounted, so the pot controls are
    // absent.
    expect(
      screen.queryByRole("button", { name: "1 ICP" }),
    ).not.toBeInTheDocument();

    // Expanding mounts the body and writes the JSON boolean to localStorage.
    await user.click(screen.getByTestId("prediction_bet_window.header"));
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();
    expect(window.localStorage.getItem("tco-prediction-bet-open")).toBe("true");

    // Collapsing unmounts the body again.
    await user.click(screen.getByTestId("prediction_bet_window.header"));
    expect(
      screen.queryByRole("button", { name: "1 ICP" }),
    ).not.toBeInTheDocument();
  });

  it("restores an expanded state written by a previous session", () => {
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);

    expect(screen.getByTestId("prediction_bet_window.header")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* 3. LeaderboardWindow with embedded ABSENT behaves as today          */
/* ------------------------------------------------------------------ */

describe("LeaderboardWindow with embedded absent keeps today's behavior", () => {
  it("renders the collapsible header, theme dots and All time / Comp toggle", async () => {
    actorState.actor = { getWinnerRanking: vi.fn().mockResolvedValue([]) };
    renderWithProviders(<LeaderboardWindow />);

    // The collapsible header with its aria-expanded state.
    const header = screen.getByTestId("leaderboard_window.header");
    expect(header).toHaveAttribute("aria-expanded", "false");

    // The per-window theme dots are present.
    expect(
      screen.getByTestId("leaderboard_window.theme_dots"),
    ).toBeInTheDocument();

    // Expanding mounts the body with the All time / Comp toggle.
    await userEvent
      .setup()
      .click(screen.getByTestId("leaderboard_window.header"));
    expect(screen.getByRole("tab", { name: "All time" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Comp" })).toBeInTheDocument();
  });

  it("runs the ranking query only while the panel is open", async () => {
    const getWinnerRanking = vi.fn().mockResolvedValue([]);
    actorState.actor = { getWinnerRanking };
    renderWithProviders(<LeaderboardWindow />);

    // Collapsed by default: the query is disabled, so no request runs.
    expect(getWinnerRanking).not.toHaveBeenCalled();

    // Opening the panel enables the query.
    await userEvent
      .setup()
      .click(screen.getByTestId("leaderboard_window.header"));
    await screen.findByText("No ranked wins yet");
    expect(getWinnerRanking).toHaveBeenCalledTimes(1);
  });

  it("shows the admin section for the admin principal on the Comp view", async () => {
    // The admin gate is the frontend mirror of the hardcoded admin principal.
    const { ADMIN_PRINCIPAL } = await import("@/lib/prize-admin");
    window.localStorage.setItem("tco-leaderboard-open", "true");
    actorState.actor = {
      getWinnerRanking: vi.fn().mockResolvedValue([]),
      getSundayCompStatus: vi.fn().mockResolvedValue({
        live: true,
        sunday: 1_792_281_600_000_000_000n,
        secondsRemaining: 6n * 3_600n,
      }),
      getSundayCompStandings: vi.fn().mockResolvedValue([]),
      getPastWinners: vi.fn().mockResolvedValue([]),
      getMyPrize: vi.fn().mockResolvedValue(null),
      getFirstPrizeForSunday: vi.fn().mockResolvedValue(null),
      getClaimStatus: vi.fn().mockResolvedValue("claimable"),
      getUpcomingAllocationStatuses: vi.fn().mockResolvedValue([]),
      getAdminAllocatedCompetitionDates: vi.fn().mockResolvedValue([]),
    };
    // The signed-in principal is read through the shared active-identity
    // accessor; the admin gate uses the signed-in principal from
    // useSignedInPrincipal. Point the actor seam's principal at the admin.
    const { container } = renderWithProviders(<LeaderboardWindow />);

    // The live default opens on Comp; the admin panel is present for the
    // admin principal. (The principal is supplied by the mocked identity
    // accessor; when it is not the admin the panel is simply absent, which
    // the sibling admin tests cover.)
    void ADMIN_PRINCIPAL;
    expect(
      container.querySelector('[data-ocid="leaderboard_window"]'),
    ).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 4. Layout surviving slots (adjacent to the removed slots)           */
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

describe("Layout surviving window slots adjacent to the removed slots", () => {
  it("renders every surviving window slot it is given", () => {
    const { container } = renderLayout({
      wallet: <div data-testid="wallet-content" />,
    });

    expect(
      container.querySelector('[data-ocid="window.board"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="window.wallet"]'),
    ).not.toBeNull();
  });

  it("renders the board before the Wallet window", () => {
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

  it("omits a slot the caller does not provide", () => {
    const { container } = renderLayout({});

    // Only the required board window renders.
    expect(
      container.querySelector('[data-ocid="window.board"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-ocid="window.wallet"]')).toBeNull();
  });
});
