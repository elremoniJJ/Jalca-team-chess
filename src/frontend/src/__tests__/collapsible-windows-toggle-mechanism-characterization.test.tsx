import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// VotingWindow imports SpellUse/StartingPosition as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  TurnDuration: {
    TwoMinutes: "TwoMinutes",
    NinetySeconds: "NinetySeconds",
    OneMinute: "OneMinute",
  },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The VotingWindow historical summary comes from useGameSettingsSnapshot,
// which polls the backend actor. Mock the hook so the component renders
// without a real actor or QueryClient.
vi.mock("@/hooks/use-voting", () => ({
  useVoteTally: () => ({ tally: null, isLoading: false, error: null }),
  useGameSettingsSnapshot: () => ({
    snapshot: null,
    isLoading: false,
    error: null,
  }),
}));

import {
  GamePhase,
  SpellUse,
  StartingPosition,
  Team,
  WalletSource,
} from "@/backend";
import { AlsoOnIcWindow } from "@/components/AlsoOnIcWindow";
import { StatusWindow } from "@/components/StatusWindow";
import { VotingWindow } from "@/components/VotingWindow";

// StoryWindow is the only consumer of useInternetIdentity() in the app. The
// real @caffeineai/core-infrastructure package fails to resolve its own
// submodules in the jsdom environment (a pre-existing dependency issue), so
// mock the hook with a signed-out state. The default (non-embedded) rendering
// under test never needs a signed-in identity.
vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: null,
    login: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: false,
    isLoggingIn: false,
    loginError: null,
  }),
}));

// StoryWindow's data layer reaches the backend through useActorState() from
// lib/backend-actor. Mock it with a resting actor so the window renders
// without a real canister; the default-rendering contract under test never
// asserts on the fetched sections.
vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {
      getStorySections: vi.fn().mockResolvedValue([]),
      appendStorySection: vi.fn(),
      fillStoryGap: vi.fn(),
      pressStoryDelete: vi.fn(),
      pressStoryKeep: vi.fn(),
    },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

import { StoryWindow } from "@/components/StoryWindow";

/**
 * Characterization of the COLLAPSIBLE-WINDOW TOGGLE MECHANISM, taken BEFORE
 * the request flips every window's first-visit default from expanded to
 * collapsed.
 *
 * The default itself is the intentional change, so this file deliberately
 * does NOT assert what a window does with an empty localStorage. Instead it
 * seeds an explicit stored state and protects the mechanism that must keep
 * working after the flip:
 *
 *   - the header button toggles `aria-expanded` and mounts/unmounts the body;
 *   - the open/collapsed state round-trips through the window's own
 *     localStorage key and is restored on the next mount;
 *   - a stored `true` opens the window and a stored `false` closes it,
 *     regardless of which way the first-visit default points.
 *
 * The backend actor is mocked; this is component/integration coverage, not
 * deployed browser E2E.
 */

function renderVotingWindow() {
  return render(
    <VotingWindow
      spellUse={SpellUse.Off}
      onSpellUseChange={() => {}}
      startingPosition={StartingPosition.Standard}
      onStartingPositionChange={() => {}}
      gameNumber={7n}
    />,
  );
}

function renderStatusWindow() {
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
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("AlsoOnIcWindow toggle mechanism", () => {
  it("toggles the body open and closed from the header, independent of the default", async () => {
    const user = userEvent.setup();
    // Seed an explicit open state so the assertion does not depend on the
    // first-visit default (which this request intentionally changes).
    window.localStorage.setItem("tco-also-on-ic-open", "true");
    render(<AlsoOnIcWindow />);

    const header = screen.getByRole("button", { name: "Also on the IC" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("link", { name: /delulu\.game/ }),
    ).toBeInTheDocument();

    // Collapsing unmounts the body.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("link", { name: /delulu\.game/ }),
    ).not.toBeInTheDocument();

    // Expanding restores the body.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("link", { name: /delulu\.game/ }),
    ).toBeInTheDocument();
  });

  it("persists the toggled state to its localStorage key and restores it on remount", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-also-on-ic-open", "true");
    const first = render(<AlsoOnIcWindow />);

    await user.click(screen.getByRole("button", { name: "Also on the IC" }));
    expect(window.localStorage.getItem("tco-also-on-ic-open")).toBe("false");

    first.unmount();
    render(<AlsoOnIcWindow />);
    expect(
      screen.getByRole("button", { name: "Also on the IC" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

describe("VotingWindow toggle mechanism", () => {
  it("toggles the body open and closed from the header, independent of the default", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-voting-open", "true");
    renderVotingWindow();

    const header = screen.getByRole("button", { name: /Vote on next game/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
  });

  it("restores a stored collapsed state on mount", () => {
    window.localStorage.setItem("tco-voting-open", "false");
    renderVotingWindow();

    expect(
      screen.getByRole("button", { name: /Vote on next game/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();
  });
});

describe("StatusWindow toggle mechanism", () => {
  it("toggles the merged body open and closed from the header, independent of the default", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow();

    const header = screen.getByRole("button", { name: /Game status/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();
  });

  it("restores a stored collapsed state on mount", () => {
    window.localStorage.setItem("tco-status-open", "false");
    const { container } = renderStatusWindow();

    expect(screen.getByRole("button", { name: /Game status/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();
  });
});

/**
 * Characterization of the DEFAULT (non-embedded) rendering of the three
 * windows that the request moves into a board overlay.
 *
 * The request intentionally adds an optional `embedded` prop to VotingWindow,
 * StoryWindow and AlsoOnIcWindow that skips the collapsible header, chevron
 * and per-window theme dots and renders the body as if open. That embedded
 * path is the intentional change, so this file deliberately does NOT assert
 * anything about it. What it protects is the behavior ADJACENT to the change
 * that must survive it: rendered WITHOUT the `embedded` prop, each of the
 * three components behaves exactly as today —
 *
 *   - the collapsible header button with its chevron and aria-expanded;
 *   - the per-window theme dots in the header;
 *   - the INFO button that swaps the body for the window's INFO content;
 *   - the existing data-ocid markers inside each component.
 *
 * The backend actor and the Internet Identity hook are mocked; this is
 * component/integration coverage, not deployed browser E2E.
 */

function renderStoryWindow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StoryWindow />
    </QueryClientProvider>,
  );
}

describe("VotingWindow default (non-embedded) rendering", () => {
  it("keeps its collapsible header, chevron, theme dots and INFO button", () => {
    window.localStorage.setItem("tco-voting-open", "true");
    const { container } = renderVotingWindow();

    const header = screen.getByRole("button", { name: /Vote on next game/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    // The chevron pair is always mounted in the header.
    expect(header.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
    // The per-window theme dots render in the header.
    expect(
      container.querySelector('[data-ocid="voting_window.theme_dots"]'),
    ).not.toBeNull();
    // The INFO button is present in the header.
    expect(
      container.querySelector('[data-ocid="voting_window.info_button"]'),
    ).not.toBeNull();
  });

  it("keeps its existing data-ocid markers", () => {
    window.localStorage.setItem("tco-voting-open", "true");
    const { container } = renderVotingWindow();

    for (const ocid of [
      "voting_window.panel",
      "voting_window.header",
      "voting_window.info_button",
      "voting_window.spell_toggle.1",
      "voting_window.spell_toggle.2",
      "voting_window.position_toggle.1",
      "voting_window.position_toggle.2",
      "voting_window.summary",
      "voting_window.summary.game_number",
      "voting_window.summary.spell_use",
      "voting_window.summary.starting_position",
    ]) {
      expect(container.querySelector(`[data-ocid="${ocid}"]`)).not.toBeNull();
    }
  });

  it("still swaps the voting controls for the INFO content via the INFO button", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-voting-open", "true");
    renderVotingWindow();

    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Toggle voting information" }),
    );
    expect(screen.getByText("How votes are counted")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the spectator prop behavior: read-only toggles and the spectator note", () => {
    window.localStorage.setItem("tco-voting-open", "true");
    const { container } = render(
      <VotingWindow
        spellUse={SpellUse.Off}
        onSpellUseChange={() => {}}
        startingPosition={StartingPosition.Standard}
        onStartingPositionChange={() => {}}
        gameNumber={7n}
        spectator
      />,
    );

    // The spectator note explains that spectator votes are not counted.
    expect(
      container.querySelector('[data-ocid="voting_window.spectator_note"]'),
    ).not.toBeNull();

    // Both toggle groups render read-only (disabled) for a spectator.
    for (const ocid of [
      "voting_window.spell_toggle.1",
      "voting_window.spell_toggle.2",
      "voting_window.position_toggle.1",
      "voting_window.position_toggle.2",
    ]) {
      const toggle = container.querySelector(`[data-ocid="${ocid}"]`);
      expect(toggle).not.toBeNull();
      expect(toggle).toBeDisabled();
    }
  });

  it("keeps the player prop behavior: enabled toggles and no spectator note", () => {
    window.localStorage.setItem("tco-voting-open", "true");
    const { container } = renderVotingWindow();

    expect(
      container.querySelector('[data-ocid="voting_window.spectator_note"]'),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "OFF" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ON" })).toBeEnabled();
  });
});

describe("AlsoOnIcWindow default (non-embedded) rendering", () => {
  it("keeps its collapsible header, chevron, theme dots and INFO button", () => {
    window.localStorage.setItem("tco-also-on-ic-open", "true");
    const { container } = render(<AlsoOnIcWindow />);

    const header = screen.getByRole("button", { name: "Also on the IC" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
    expect(
      container.querySelector('[data-ocid="also_on_ic_window.theme_dots"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="also_on_ic_window.info_button"]'),
    ).not.toBeNull();
  });

  it("keeps its existing data-ocid markers", () => {
    window.localStorage.setItem("tco-also-on-ic-open", "true");
    const { container } = render(<AlsoOnIcWindow />);

    for (const ocid of [
      "also_on_ic_window",
      "also_on_ic_window.header",
      "also_on_ic_window.info_button",
      "also_on_ic.tile_list",
    ]) {
      expect(container.querySelector(`[data-ocid="${ocid}"]`)).not.toBeNull();
    }
  });

  it("still reveals the INFO content via the INFO button", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-also-on-ic-open", "true");
    const { container } = render(<AlsoOnIcWindow />);

    expect(
      container.querySelector('[data-ocid="also_on_ic.info_content"]'),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Toggle Also on the IC information" }),
    );
    expect(
      container.querySelector('[data-ocid="also_on_ic.info_content"]'),
    ).not.toBeNull();
  });
});

describe("StoryWindow default (non-embedded) rendering", () => {
  it("keeps its collapsible header, chevron, theme dots and INFO button", () => {
    window.localStorage.setItem("tco-story-open", "true");
    const { container } = renderStoryWindow();

    const header = screen.getByRole("button", { name: /Story/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
    expect(
      container.querySelector('[data-ocid="story_window.theme_dots"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="story_window.info_button"]'),
    ).not.toBeNull();
  });

  it("keeps its existing data-ocid markers", () => {
    window.localStorage.setItem("tco-story-open", "true");
    const { container } = renderStoryWindow();

    for (const ocid of [
      "story_window",
      "story_window.header",
      "story_window.info_button",
    ]) {
      expect(container.querySelector(`[data-ocid="${ocid}"]`)).not.toBeNull();
    }
  });

  it("still reveals the INFO content via the INFO button", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-story-open", "true");
    const { container } = renderStoryWindow();

    expect(
      container.querySelector('[data-ocid="story.info_content"]'),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Toggle story information" }),
    );
    expect(
      container.querySelector('[data-ocid="story.info_content"]'),
    ).not.toBeNull();
  });
});
