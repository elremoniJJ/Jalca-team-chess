import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted spectator header badge and Prediction Bet change.
 *
 * Two accepted behaviors are asserted here:
 *   1. The Layout renders a "Spectating" badge plus a "Leave and join as a
 *      player" control for a spectator, and hides the Replay guide button.
 *   2. The Prediction Bet window stays usable for a spectator: it shows the
 *      note that spectators can bet but are not eligible for NFTs, and the
 *      bet username is formed from the reserved non-typable spectator prefix.
 *
 * The backend actor and the wallet hook are mocked; this is
 * component/integration coverage, not deployed browser E2E.
 */

// The PredictionBetWindow imports Pot from @/backend, which transitively pulls
// in @caffeineai/object-storage, and its usePbppBet hook pulls in
// @caffeineai/core-infrastructure via lib/backend-actor. Those packages fail to
// resolve their own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock them with the symbols the generated backend
// wrapper re-exports.
vi.mock("@caffeineai/object-storage", () => ({
  ExternalBlob: Symbol("ExternalBlob"),
}));
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
  useInternetIdentity: () => ({ identity: null }),
}));

// The window's BettingPanel calls useGameState -> useActorState, which reads
// the React Query client. The actor itself is never called.
vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

// The spectator state seam. `useSpectator` returns a stable suffix for a
// spectator and null for a player; the test drives it per case.
const spectatorState = vi.hoisted(() => ({
  suffix: null as string | null,
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  // The prediction window's principal now comes from the active-identity
  // accessor. Return the same stable principal the guest hook returns so the
  // spectator-usability assertions below stay unchanged.
  useActiveIdentity: () => "player-1",
  useSpectator: () => spectatorState.suffix,
  useWalletAddress: () => ["", vi.fn()],
  SPECTATOR_USERNAME_PREFIX: "\u0000spectator:",
  // useGameState's poll interval reads the spectator flag through this
  // accessor.
  isSpectating: () => spectatorState.suffix !== null,
}));

// Mock usePbppBet so the window renders without a real wallet/actor.
const { mockUsePbppBet } = vi.hoisted(() => ({
  mockUsePbppBet: vi.fn(),
}));
vi.mock("@/lib/use-pbpp-bet", () => ({
  usePbppBet: mockUsePbppBet,
}));

mockUsePbppBet.mockReturnValue({
  connection: { status: "disconnected" },
  connect: vi.fn(),
  disconnect: vi.fn(),
  signerAvailable: true,
  anonymous: false,
  setAnonymous: vi.fn(),
  approveAllowance: vi.fn(),
  checkAllowance: vi.fn().mockResolvedValue(null),
  relayState: { status: "idle" },
  relayBet: vi.fn(),
});

import { Layout } from "@/components/Layout";
import { PredictionBetWindow } from "@/components/PredictionBetWindow";

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("Layout spectator header (cover)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

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

  it("shows the Spectating badge and leave control for a spectator", () => {
    renderLayout(true);

    expect(screen.getByTestId("header.spectator_badge")).toHaveTextContent(
      "Spectating",
    );
    expect(
      screen.getByTestId("header.leave_spectating.button"),
    ).toHaveTextContent("Leave and join as a player");
    // The Logout button is replaced by the leave control for a spectator.
    expect(
      screen.queryByTestId("header.logout.button"),
    ).not.toBeInTheDocument();
  });

  it("hides the Replay guide button for a spectator", () => {
    renderLayout(true);

    expect(
      screen.queryByTestId("header.replay_guide.button"),
    ).not.toBeInTheDocument();
  });

  it("shows the Logout button and no spectator badge for a player", () => {
    renderLayout(false);

    expect(screen.getByTestId("header.logout.button")).toBeInTheDocument();
    expect(
      screen.queryByTestId("header.spectator_badge"),
    ).not.toBeInTheDocument();
  });
});

describe("Prediction Bet spectator usability (cover)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    spectatorState.suffix = null;
    // The window persists its open state to localStorage; clear it so each
    // test starts from the collapsed default and the expand click is a no-op
    // toggle in the expected direction.
    window.localStorage.clear();
  });

  const openWindow = async () => {
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);
    // The window is collapsed by default; expand it so the betting panel
    // renders.
    await user.click(screen.getByTestId("prediction_bet_window.header"));
    return user;
  };

  it("shows the spectator note and a non-typable prefixed bet username", async () => {
    spectatorState.suffix = "spectator-suffix";
    await openWindow();

    expect(
      screen.getByTestId("prediction_bet.spectator_note"),
    ).toHaveTextContent("Spectators can bet, but aren't eligible for NFTs.");

    // The anonymity toggle's helper text names the spectator's bet username,
    // which is the reserved non-typable prefix plus the stable suffix. The
    // prefix starts with a NUL control character, so match on the rendered
    // text content with a string rather than a regex literal (which lint
    // rejects for containing a control character).
    const spectatorUsername = "\u0000spectator:spectator-suffix";
    expect(
      screen.getByText((content) => content.includes(spectatorUsername)),
    ).toBeInTheDocument();
  });

  it("keeps the Place bet control available for a spectator", async () => {
    spectatorState.suffix = "spectator-suffix";
    await openWindow();

    // The betting controls remain usable — a spectator can still bet.
    expect(screen.getByTestId("prediction_bet.pot.1")).toBeInTheDocument();
    expect(screen.getByTestId("prediction_bet.outcome.1")).toBeInTheDocument();
  });

  it("shows no spectator note for a player", async () => {
    spectatorState.suffix = null;
    await openWindow();

    expect(
      screen.queryByTestId("prediction_bet.spectator_note"),
    ).not.toBeInTheDocument();
  });
});
