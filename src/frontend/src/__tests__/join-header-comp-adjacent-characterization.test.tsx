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
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the behavior ADJACENT to the accepted join-screen,
 * game-header and Comp-view changes, taken BEFORE those changes land.
 *
 * The request intentionally:
 *   1. adds helper text under the Just Play and Internet Identity buttons and
 *      makes the footer consistent with the guest/ranked distinction;
 *   2. adds a confirm step when an already-signed-in Internet Identity user
 *      taps Just Play;
 *   3. adds a Ranked/Guest badge to the game header alongside the Spectating
 *      badge;
 *   4. adds a guest notice line and the signed-in player's own competition
 *      wins (credited name and principal) to the Comp view;
 *   5. replaces the fixed generic ranked-login error with the backend's exact
 *      rejection reason.
 *
 * Those five things are intentional, so this file deliberately does NOT pin the
 * exact footer string, does NOT assert the absence of helper text or a
 * Ranked/Guest badge, does NOT assert the absence of a guest notice or wins
 * line, and does NOT assert the generic ranked-login error text. What it
 * protects is the behavior ADJACENT to the change that must survive it:
 *
 *   - the guest "Just Play" path still calls `login` with the guest principal
 *     and the typed username, and never calls `loginRanked`;
 *   - the Internet Identity option still starts the shared sign-in flow and
 *     still calls `loginRanked` with the minted key once the identity is
 *     available, persisting the key only after the backend accepts it;
 *   - a failed ranked call still does not persist the ranked key;
 *   - the Spectating badge still renders for a spectator and the Logout button
 *     for a player, with the leave-spectating control replacing Logout;
 *   - the Comp view still renders the standings, the live/frozen header text,
 *     the Past winners columns, the empty/loading/error states, and still
 *     carries no principal in any public response.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real loginRanked / getMyWins
 * behavior is asserted in the PocketIC backend lane.
 */

/* --- Login route mocks -------------------------------------------------- */

// The login route imports WalletSource as a runtime value from @/backend,
// which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum value the route needs.
vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The route consumes useInternetIdentity() for the ranked-play option. The real
// @caffeineai/core-infrastructure package fails to resolve its own submodules
// in jsdom, so mock the hook with a controllable state.
const identityState = vi.hoisted(() => ({
  identity: null as { getPrincipal: () => { toText: () => string } } | null,
  isAuthenticated: false,
  isLoggingIn: false,
  login: vi.fn(),
  loginError: null as { message: string } | null,
}));

vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: identityState.identity,
    isAuthenticated: identityState.isAuthenticated,
    isLoggingIn: identityState.isLoggingIn,
    login: identityState.login,
    loginError: identityState.loginError,
  }),
}));

// The route's identity hooks. `generateRankedKey` and `setRankedIdentity` are
// spies so the test can assert the exact key minted and written into the ranked
// slot. `useGuestIdentity` returns a stable guest pseudo-principal.
const identityHooks = vi.hoisted(() => ({
  generateRankedKey: vi.fn(() => "ranked-key-generated"),
  setRankedIdentity: vi.fn(),
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  generateRankedKey: identityHooks.generateRankedKey,
  setRankedIdentity: identityHooks.setRankedIdentity,
  // The login route's online-count poll reads the spectator flag through
  // getGamePollMs() -> isSpectating(); a player is never spectating.
  isSpectating: () => false,
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls getActor() on submit. Mock it so the test captures the exact
// login/loginRanked arguments without touching the real actor. The same module
// also backs the LeaderboardWindow's useActorState seam, so both are provided
// from one mock (a second vi.mock for the same path would replace this one).
const actorMethods = vi.hoisted(() => ({
  login: vi.fn(),
  loginRanked: vi.fn(),
}));

// The LeaderboardWindow's actor seam. `actor` is null until a Comp-view test
// assigns a typed fake; the login route never reads it.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getWinnerRanking: (limit: bigint) => Promise<unknown>;
    getSundayCompStandings: (limit: bigint) => Promise<unknown>;
    getSundayCompStatus: () => Promise<unknown>;
    getPastWinners: () => Promise<unknown>;
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
  getActor: vi.fn().mockResolvedValue({
    login: actorMethods.login,
    loginRanked: actorMethods.loginRanked,
  }),
}));

// The route calls unlockAudio() in its login handlers and imports the module at
// the top; mock it so no AudioContext is touched in jsdom.
vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { WalletSource } from "@/backend";
import { Layout } from "@/components/Layout";
import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

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
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  identityState.identity = null;
  identityState.isAuthenticated = false;
  identityState.isLoggingIn = false;
  identityState.loginError = null;
});

/* --- Join screen: guest and ranked entry paths -------------------------- */

describe("Join screen entry paths survive the helper-text and confirm-step change", () => {
  const renderLogin = () => renderWithProviders(<LoginRouteComponent />);
  const iiButton = () => screen.getByTestId("login.internet_identity_button");

  it("keeps the guest Just Play path calling login with the guest principal", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));

    expect(actorMethods.login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
  });

  it("keeps the Internet Identity option starting the shared sign-in flow", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    expect(identityState.login).toHaveBeenCalledTimes(1);
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
  });

  it("keeps loginRanked receiving the minted key once the identity is available", async () => {
    const user = userEvent.setup();
    actorMethods.loginRanked.mockResolvedValue({ gameState: null });
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    identityState.isAuthenticated = true;
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    expect(identityHooks.generateRankedKey).toHaveBeenCalled();
    expect(actorMethods.loginRanked).toHaveBeenCalledWith(
      "ranked-key-generated",
      "Ada",
      null,
      WalletSource.none,
    );
    expect(identityHooks.setRankedIdentity).toHaveBeenCalledWith(
      "ranked-key-generated",
    );
  });

  it("keeps a failed ranked call from persisting the ranked key", async () => {
    const user = userEvent.setup();
    actorMethods.loginRanked.mockRejectedValue(new Error("backend down"));
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    identityState.isAuthenticated = true;
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    // The failure surfaces an alert; the exact wording is intentionally
    // changing, so only the alert's presence and the key guard are asserted.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(identityHooks.setRankedIdentity).not.toHaveBeenCalled();
  });

  it("keeps the Player/Spectator mode toggle and the username field", async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    const player = screen.getByTestId("login.mode_toggle.player");
    const spectator = screen.getByTestId("login.mode_toggle.spectator");
    expect(player).toHaveAttribute("aria-pressed", "true");
    expect(spectator).toHaveAttribute("aria-pressed", "false");

    await user.click(spectator);
    expect(spectator).toHaveAttribute("aria-pressed", "true");
    expect(player).toHaveAttribute("aria-pressed", "false");
  });
});

/* --- Game header: Spectating badge and Logout --------------------------- */

describe("Game header spectator badge survives the Ranked/Guest badge addition", () => {
  const renderLayout = (spectator: boolean) =>
    renderWithProviders(
      <Layout
        windows={{ board: <div /> }}
        onLogout={vi.fn()}
        onReplayGuide={spectator ? undefined : vi.fn()}
        spectator={spectator}
        onLeaveSpectating={vi.fn()}
      />,
    );

  it("still shows the Spectating badge and leave control for a spectator", () => {
    renderLayout(true);

    expect(screen.getByTestId("header.spectator_badge")).toHaveTextContent(
      "Spectating",
    );
    expect(
      screen.getByTestId("header.leave_spectating.button"),
    ).toHaveTextContent("Leave and join as a player");
    expect(
      screen.queryByTestId("header.logout.button"),
    ).not.toBeInTheDocument();
  });

  it("still shows the Logout button and no spectator badge for a player", () => {
    renderLayout(false);

    expect(screen.getByTestId("header.logout.button")).toBeInTheDocument();
    expect(
      screen.queryByTestId("header.spectator_badge"),
    ).not.toBeInTheDocument();
  });
});

/* --- Comp view: standings, header, past winners, states ---------------- */

import type { CompStandingRow, CompStatus, PastWinnerRow } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";

const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

function standing(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): CompStandingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
}

function pastWinner(
  sunday: bigint,
  winnerName: string | undefined,
  winnerWins: number | undefined,
  runnerUpName: string | undefined,
  runnerUpWins: number | undefined,
): PastWinnerRow {
  return {
    sunday,
    winnerName,
    winnerWins: winnerWins === undefined ? undefined : BigInt(winnerWins),
    runnerUpName,
    runnerUpWins: runnerUpWins === undefined ? undefined : BigInt(runnerUpWins),
  };
}

const LIVE_STATUS: CompStatus = {
  live: true,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

const FROZEN_STATUS: CompStatus = {
  live: false,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

interface ActorOverrides {
  standings?: CompStandingRow[];
  status?: CompStatus;
  pastWinners?: PastWinnerRow[];
}

function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi
      .fn()
      .mockResolvedValue(overrides.standings ?? []),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? FROZEN_STATUS),
    getPastWinners: vi.fn().mockResolvedValue(overrides.pastWinners ?? []),
  };
}

function renderWindow() {
  return renderWithProviders(<LeaderboardWindow />);
}

function seedOpen() {
  window.localStorage.setItem("tco-leaderboard-open", "true");
}

async function openSundayView() {
  await userEvent
    .setup()
    .click(await screen.findByRole("tab", { name: "Comp" }));
}

describe("Comp view survives the guest-notice and own-wins addition", () => {
  it("still renders the standings with rank, name and win count", async () => {
    seedOpen();
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true), standing(2, "Bob", 1)],
      status: LIVE_STATUS,
    });
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Ada")).toBeInTheDocument();
    expect(within(items[0]!).getByText("3")).toBeInTheDocument();
    expect(items[0]).toHaveAttribute("aria-current", "true");
  });

  it("still renders no principal in the public Sunday list", async () => {
    seedOpen();
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3)],
      status: LIVE_STATUS,
    });
    const { container } = renderWindow();

    await screen.findByText("Ada");
    const list = container.querySelector(
      '[data-ocid="leaderboard.sunday.list"]',
    );
    expect(list).not.toBeNull();
    expect(list?.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });

  it("still shows the empty state when the standings are empty", async () => {
    seedOpen();
    actorState.actor = makeActor({ standings: [], status: LIVE_STATUS });
    renderWindow();

    expect(
      await screen.findByText("No wins yet in this competition"),
    ).toBeInTheDocument();
  });

  it("still shows the Sunday loading state while the standings are fetched", async () => {
    seedOpen();
    actorState.actor = {
      getWinnerRanking: vi.fn().mockResolvedValue([]),
      getSundayCompStandings: vi.fn(() => new Promise<never>(() => {})),
      getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
      getPastWinners: vi.fn().mockResolvedValue([]),
    };
    renderWindow();

    expect(
      await screen.findByText("Loading the Sunday standings…"),
    ).toBeInTheDocument();
  });

  it("still shows the Sunday error state with a working retry", async () => {
    seedOpen();
    const getSundayCompStandings = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce([standing(1, "Ada", 2)]);
    actorState.actor = {
      getWinnerRanking: vi.fn().mockResolvedValue([]),
      getSundayCompStandings,
      getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
      getPastWinners: vi.fn().mockResolvedValue([]),
    };
    renderWindow();

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(
      document.querySelector('[data-ocid="leaderboard.sunday.error_state"]'),
    ).not.toBeNull();

    await userEvent.setup().click(retry);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(getSundayCompStandings).toHaveBeenCalledTimes(2);
  });

  it("still shows the live and frozen header text", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();
    expect(
      await screen.findByText("LIVE NOW, Sunday 18 Oct"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ends in 6h 12m")).toBeInTheDocument();

    cleanup();
    window.localStorage.clear();
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();
    await openSundayView();
    expect(
      await screen.findByText("NEXT COMPETITION, Thursday 22 Oct"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Starts in 2d 5h/)).toBeInTheDocument();
  });

  it("still lists the Past winners columns with win counts, newest first", async () => {
    seedOpen();
    const newest = 1_792_281_600_000_000_000n;
    const older = newest - 604_800_000_000_000n;
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [
        pastWinner(newest, "Ada", 4, "Bob", 2),
        pastWinner(older, "Cy", 1, undefined, undefined),
      ],
    });
    renderWindow();

    await openSundayView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const headers = within(rows[0]!).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Date",
      "Winner",
      "Runner-up",
    ]);
    expect(within(rows[1]!).getByText("Ada")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("4 wins")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Cy")).toBeInTheDocument();
  });

  it("still renders no principal in the Past winners table", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Ada", 4, "Bob", 2)],
    });
    const { container } = renderWindow();

    await openSundayView();

    const table = await screen.findByRole("table");
    expect(table.textContent).not.toMatch(PRINCIPAL_PATTERN);
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });
});
