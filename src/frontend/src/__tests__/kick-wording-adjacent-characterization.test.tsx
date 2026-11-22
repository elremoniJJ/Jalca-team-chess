import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the kick-wording change.
 *
 * The request intentionally rewrites the kick wording in InformationModal and
 * in the StatusWindow InfoContent to describe the active-member majority rule
 * and to remove any mention of a wallet being required. It also bumps
 * JALCA_VERSION from v403 to v404.
 *
 * None of the new wording is asserted here. What this file protects is the
 * behavior ADJACENT to the change that must survive it:
 *   - the InformationModal keeps its dialog shell (title, X close, "Got it",
 *     Escape) and its eight stable section markers;
 *   - the InformationModal's non-kick sections keep their content;
 *   - the StatusWindow Info toggle still swaps between the merged status body
 *     and the Info content, and back;
 *   - the wordmark still composes `jalca <JALCA_VERSION>` from the single
 *     constant, so a bump in one place updates every instance.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend module and the voting snapshot hook are mocked locally.
 */

// The InformationModal renders a CanisterCyclesGauge in its footer. That
// gauge's useCanisterCycles hook makes a real network call to the IC
// blackhole canister, and its import chain transitively pulls in
// @caffeineai/core-infrastructure, which fails to resolve its own submodules
// in the jsdom test environment (a pre-existing dependency issue). The gauge
// is out of scope for this characterization, so mock it to a marker.
vi.mock("@/components/CanisterCyclesGauge", () => ({
  CanisterCyclesGauge: () => <div data-testid="canister-cycles-gauge" />,
  NftMintingCanisterGauge: () => (
    <div data-testid="nft-minting-canister-gauge" />
  ),
  EscrowLedgerCanisterGauge: () => (
    <div data-testid="escrow-ledger-canister-gauge" />
  ),
}));

// StatusWindow/VotingWindow import GamePhase/Team/SpellUse/StartingPosition as
// runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the components need.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The historical summary comes from useGameSettingsSnapshot, which polls the
// backend actor. Mock the hook so VotingWindow renders without a real actor or
// QueryClient.
vi.mock("@/hooks/use-voting", () => ({
  useVoteTally: () => ({ tally: null, isLoading: false, error: null }),
  useGameSettingsSnapshot: () => ({
    snapshot: null,
    isLoading: false,
    error: null,
  }),
}));

import { GamePhase, Team, WalletSource } from "@/backend";
import { InformationModal } from "@/components/InformationModal";
import { StatusWindow } from "@/components/StatusWindow";
import { Wordmark } from "@/components/Wordmark";
import { JALCA_VERSION, JALCA_WORDMARK } from "@/lib/version";

// The modal's sections carry deterministic `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("InformationModal shell (adjacent to the kick-wording change)", () => {
  it("keeps its dialog shell and eight stable section markers", () => {
    render(<InformationModal onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "How the Chess App Works" }),
    ).toBeInTheDocument();

    for (const marker of [
      "information.section.game",
      "information.section.settings",
      "information.section.buttons",
      "information.section.move_maker",
      "information.section.move",
      "information.section.kick",
      "information.section.prediction",
      "information.section.wallet",
    ]) {
      expect(screen.getByTestId(marker)).toBeInTheDocument();
    }
  });

  it("still closes via the X close button, the Got it button, and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InformationModal onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close information" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("keeps the non-kick section content (game, settings, prediction fee)", () => {
    render(<InformationModal onClose={vi.fn()} />);

    expect(screen.getByTestId("information.section.game")).toHaveTextContent(
      /randomly assigned to the White and Black teams/i,
    );
    expect(
      screen.getByTestId("information.section.settings"),
    ).toHaveTextContent(/standard opening/i);
    expect(
      screen.getByTestId("information.section.prediction"),
    ).toHaveTextContent(/1\.5%/i);
  });
});

function renderStatusWindow(
  props: Partial<React.ComponentProps<typeof StatusWindow>> = {},
) {
  return render(
    <StatusWindow
      turn={Team.White}
      phase={GamePhase.Playing}
      moveMaker="player-1"
      players={[
        {
          principal: "player-1",
          username: "Ada",
          team: Team.White,
          walletSource: WalletSource.none,
          isMoveMaker: true,
          isFresh: false,
          isInactive: false,
          isBot: false,
        },
      ]}
      timerRemainingMs={300000n}
      showCoordinates
      onToggleCoordinates={() => {}}
      onFlipBoard={() => {}}
      {...props}
    />,
  );
}

describe("StatusWindow Info toggle (adjacent to the kick-wording change)", () => {
  it("still swaps between the merged status body and the Info content, and back", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle game status information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Heartbeat")).toBeInTheDocument();
    expect(screen.getByText("Timer scope")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Heartbeat")).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();
  });
});

describe("Wordmark version composition (adjacent to the version bump)", () => {
  it("composes the wordmark from the single JALCA_VERSION constant", () => {
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
  });

  it("renders the composed wordmark string as visible text and aria-label", () => {
    render(<Wordmark />);
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });
});
