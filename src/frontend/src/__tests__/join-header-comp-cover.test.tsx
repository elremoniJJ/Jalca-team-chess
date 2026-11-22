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
 * Cover for the accepted join-screen, game-header and Comp-view changes.
 *
 * The request adds:
 *   1. helper text under the Just Play and Internet Identity buttons, and a
 *      footer consistent with the guest/ranked distinction;
 *   2. a confirm step when an already-signed-in Internet Identity user taps
 *      Just Play, gating guest login behind "Continue as guest";
 *   3. a Ranked/Guest badge in the game header, styled like the Spectating
 *      badge;
 *   4. a guest notice line and the signed-in player's own competition wins
 *      (credited name and principal) in the Comp view;
 *   5. the backend's exact ranked-login rejection reason in plain words,
 *      instead of the fixed generic message.
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
  setRankedSession: vi.fn(),
  clearRankedSession: vi.fn(),
  clearRankedIdentity: vi.fn(),
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  // The Comp view's own-wins panel reads the active identity accessor; the
  // login route and the badge do not. Return the same stable principal the
  // guest hook returns so the Comp-view assertions stay unchanged.
  useActiveIdentity: () => "player-1",
  // The Ranked/Guest badge follows the ranked session flag, not the slot.
  useRankedSession: () => false,
  useWalletAddress: () => ["", vi.fn()],
  generateRankedKey: identityHooks.generateRankedKey,
  setRankedIdentity: identityHooks.setRankedIdentity,
  setRankedSession: identityHooks.setRankedSession,
  clearRankedSession: identityHooks.clearRankedSession,
  clearRankedIdentity: identityHooks.clearRankedIdentity,
  // The login route's online-count poll reads the spectator flag through
  // getGamePollMs() -> isSpectating(); a player is never spectating.
  isSpectating: () => false,
  useSpectator: () => null,
  readSpectator: () => null,
  clearSpectator: vi.fn(),
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
  readRankedIdentity: () => null,
  RANKED_STORAGE_KEY: "team-chess-ranked-principal",
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
// assigns a typed fake; the login route never reads it. `principal` drives the
// signed-in gate: null is a guest, a string is a signed-in player.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getWinnerRanking: (limit: bigint) => Promise<unknown>;
    getSundayCompStandings: (limit: bigint) => Promise<unknown>;
    getSundayCompStatus: () => Promise<unknown>;
    getPastWinners: () => Promise<unknown>;
    getMyWins: () => Promise<unknown>;
  } | null,
  principal: null as string | null,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    principal: actorState.principal,
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
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
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
  actorState.actor = null;
  actorState.principal = null;
  actorState.isLoading = false;
  actorState.error = null;
});

/* --- Join screen: helper text and footer -------------------------------- */

describe("Join screen helper text and footer", () => {
  const renderLogin = () => renderWithProviders(<LoginRouteComponent />);

  it("shows the guest helper under Just Play and the ranked helper under Internet Identity", () => {
    renderLogin();

    expect(screen.getByTestId("login.guest_helper")).toHaveTextContent(
      "Guest. Your wins do not count for the competition or the prize.",
    );
    expect(screen.getByTestId("login.ranked_helper")).toHaveTextContent(
      "Ranked. Your wins count for the competition and the prize.",
    );
  });

  it("shows a footer consistent with the guest/ranked distinction", () => {
    const { container } = renderLogin();

    // The footer is the last paragraph in the login card; it names guest mode
    // and that its wins do not count. Scope to the footer so the guest helper
    // above (which shares the "wins do not count" phrase) is not matched.
    const footer = container.querySelector(".w-full.max-w-sm > p:last-of-type");
    expect(footer).not.toBeNull();
    expect(footer).toHaveTextContent(/Guest mode · no account needed/i);
    expect(footer).toHaveTextContent(
      /wins do not count for the competition or the prize/i,
    );
  });
});

/* --- Join screen: confirm step for a signed-in II user ------------------ */

describe("Join screen confirm step for a signed-in Internet Identity user", () => {
  const renderLogin = () => renderWithProviders(<LoginRouteComponent />);

  it("shows the confirm step with both choices and does not run guest login yet", async () => {
    const user = userEvent.setup();
    identityState.isAuthenticated = true;
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));

    // The confirm step appears with both choices.
    expect(
      await screen.findByTestId("login.guest_confirm_modal"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("login.guest_confirm.ranked_button"),
    ).toHaveTextContent("Play ranked");
    expect(
      screen.getByTestId("login.guest_confirm.guest_button"),
    ).toHaveTextContent("Continue as guest");

    // Guest login has NOT run: no login call, no ranked call.
    expect(actorMethods.login).not.toHaveBeenCalled();
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
  });

  it("runs guest login only after Continue as guest is chosen", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    identityState.isAuthenticated = true;
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));
    await screen.findByTestId("login.guest_confirm_modal");

    await user.click(screen.getByTestId("login.guest_confirm.guest_button"));

    expect(actorMethods.login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
  });

  it("starts the ranked path when Play ranked is chosen", async () => {
    const user = userEvent.setup();
    identityState.isAuthenticated = true;
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));
    await screen.findByTestId("login.guest_confirm_modal");

    await user.click(screen.getByTestId("login.guest_confirm.ranked_button"));

    // The ranked path starts the shared Internet Identity sign-in flow and
    // never runs guest login.
    expect(identityState.login).toHaveBeenCalledTimes(1);
    expect(actorMethods.login).not.toHaveBeenCalled();
  });

  it("does not show the confirm step for a guest tapping Just Play", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    identityState.isAuthenticated = false;
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));

    expect(
      screen.queryByTestId("login.guest_confirm_modal"),
    ).not.toBeInTheDocument();
    expect(actorMethods.login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
  });
});

/* --- Join screen: ranked-login failure in plain words ------------------- */

describe("Ranked-login failure shows the exact reason in plain words", () => {
  const renderLogin = () => renderWithProviders(<LoginRouteComponent />);
  const iiButton = () => screen.getByTestId("login.internet_identity_button");

  const failRankedWith = async (message: string) => {
    const user = userEvent.setup();
    actorMethods.loginRanked.mockRejectedValue(new Error(message));
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    identityState.isAuthenticated = true;
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());
  };

  it("shows the guest-name rejection reason instead of the generic message", async () => {
    await failRankedWith("name already in use by a guest");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That name is already in use by a guest. Sign in as a guest or pick another name.",
    );
    expect(alert).not.toHaveTextContent(
      "Could not join the game. Please try again.",
    );
  });

  it("shows the different-Internet-Identity rejection reason", async () => {
    await failRankedWith("name is bound to a different Internet Identity");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That name is already linked to a different Internet Identity account. Pick another name.",
    );
  });

  it("shows the invalid-roster-key rejection reason", async () => {
    await failRankedWith("invalid roster key");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This sign-in key is not valid. Please try again.",
    );
  });

  it("falls back to a clear generic message for an unrecognised reason", async () => {
    await failRankedWith("some unexpected backend failure");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not join the game. Please try again.",
    );
  });
});

/* --- Game header: Ranked/Guest badge ------------------------------------ */

describe("Game header Ranked/Guest badge", () => {
  const renderLayout = (ranked: boolean | undefined) =>
    renderWithProviders(
      <Layout
        windows={{ board: <div /> }}
        onLogout={vi.fn()}
        onReplayGuide={vi.fn()}
        ranked={ranked}
      />,
    );

  it("shows a Ranked badge for a ranked player", () => {
    renderLayout(true);

    expect(screen.getByTestId("header.ranked_badge")).toHaveTextContent(
      "Ranked",
    );
  });

  it("shows a Guest badge for a guest player", () => {
    renderLayout(false);

    expect(screen.getByTestId("header.ranked_badge")).toHaveTextContent(
      "Guest",
    );
  });

  it("renders no Ranked/Guest badge when the caller does not track identity", () => {
    renderLayout(undefined);

    expect(screen.queryByTestId("header.ranked_badge")).not.toBeInTheDocument();
  });

  it("styles the Ranked/Guest badge like the Spectating badge", () => {
    renderLayout(true);
    const rankedBadge = screen.getByTestId("header.ranked_badge");

    cleanup();
    renderWithProviders(
      <Layout
        windows={{ board: <div /> }}
        onLogout={vi.fn()}
        spectator={true}
        onLeaveSpectating={vi.fn()}
      />,
    );
    const spectatorBadge = screen.getByTestId("header.spectator_badge");

    // The two badges share the same pill styling classes.
    expect(rankedBadge.className).toBe(spectatorBadge.className);
  });
});

/* --- Comp view: guest notice and own competition wins ------------------- */

const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

function standing(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): import("@/backend").CompStandingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
}

const LIVE_STATUS: import("@/backend").CompStatus = {
  live: true,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

interface ActorOverrides {
  standings?: import("@/backend").CompStandingRow[];
  status?: import("@/backend").CompStatus;
}

function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi
      .fn()
      .mockResolvedValue(overrides.standings ?? []),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getMyWins: vi.fn().mockResolvedValue({ rank: 0n, wins: 0n }),
  };
}

function seedOpen() {
  window.localStorage.setItem("tco-leaderboard-open", "true");
}

describe("Comp view guest notice and own competition wins", () => {
  it("shows the guest notice for a guest and no own-wins panel", async () => {
    seedOpen();
    actorState.principal = null;
    actorState.actor = makeActor({ standings: [standing(1, "Ada", 3)] });
    renderWithProviders(<LeaderboardWindow />);

    expect(
      await screen.findByTestId("leaderboard.sunday.guest_notice"),
    ).toHaveTextContent(
      "Guests do not earn competition wins. Sign in and join as ranked to compete.",
    );
    expect(
      screen.queryByTestId("leaderboard.my_wins.panel"),
    ).not.toBeInTheDocument();
  });

  it("shows the signed-in player's own wins with credited name and principal", async () => {
    seedOpen();
    actorState.principal = "signed-in-principal";
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true), standing(2, "Bob", 1)],
    });
    renderWithProviders(<LeaderboardWindow />);

    const panel = await screen.findByTestId("leaderboard.my_wins.panel");
    expect(
      within(panel).getByTestId("leaderboard.my_wins.wins"),
    ).toHaveTextContent("3 wins");
    expect(
      within(panel).getByTestId("leaderboard.my_wins.credited_name"),
    ).toHaveTextContent("Ada");
    // The principal shown is the identity the app already holds for the
    // signed-in player (useGuestIdentity), not the actor's principal.
    expect(
      within(panel).getByTestId("leaderboard.my_wins.principal"),
    ).toHaveTextContent("player-1");

    // A signed-in player sees no guest notice.
    expect(
      screen.queryByTestId("leaderboard.sunday.guest_notice"),
    ).not.toBeInTheDocument();
  });

  it("shows zero wins and a dash credited name when the player has no own row", async () => {
    seedOpen();
    actorState.principal = "signed-in-principal";
    actorState.actor = makeActor({ standings: [standing(1, "Bob", 1)] });
    renderWithProviders(<LeaderboardWindow />);

    const panel = await screen.findByTestId("leaderboard.my_wins.panel");
    expect(
      within(panel).getByTestId("leaderboard.my_wins.wins"),
    ).toHaveTextContent("0 wins");
    expect(
      within(panel).getByTestId("leaderboard.my_wins.credited_name"),
    ).toHaveTextContent("—");
  });

  it("never renders another player's principal in the own-wins panel", async () => {
    seedOpen();
    actorState.principal = "signed-in-principal";
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true), standing(2, "Bob", 1)],
    });
    const { container } = renderWithProviders(<LeaderboardWindow />);

    await screen.findByTestId("leaderboard.my_wins.panel");
    // The only principal-shaped text is the signed-in player's own identity.
    const panel = screen.getByTestId("leaderboard.my_wins.panel");
    expect(panel.textContent).not.toMatch(PRINCIPAL_PATTERN);
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });
});
