import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The window carries deterministic `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target them.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the ranked-binding / retried-ranked-login
 * change.
 *
 * The request intentionally changes two things:
 *   1. the backend records the Sunday competition win in the same message
 *      execution as the All-time win, before any await, so a concurrent
 *      stale-player cleanup cannot remove the ranked binding in between;
 *   2. a retried ranked login reuses the ranked key already in the ranked slot
 *      instead of minting a fresh one.
 *
 * This file deliberately does NOT assert either intentional change. What it
 * protects is the behavior ADJACENT to the change that must survive it:
 *
 *   - the Comp view's "My competition wins" panel still shows the signed-in
 *     player's own competition wins and credited name, read from the `isMe` row
 *     of `getSundayCompStandings` (the same figure the "This competition"
 *     standings show), and still shows the identity the app holds for the
 *     player;
 *   - a signed-in player with no `isMe` row still sees "0 wins" and the
 *     credited name "—";
 *   - a guest still sees the guest notice and NO "My competition wins" panel,
 *     so a guest is never credited a ranked win;
 *   - the public Sunday standings still carry no principal.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage of the frontend wiring, NOT deployed browser E2E. The real
 * `getWinCreditPreview` / `loginRanked` / win-recording behavior is asserted in
 * the PocketIC backend lane.
 */

// The hook module imports useActorState from lib/backend-actor, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the actor seam directly, exactly as the existing leaderboard tests do.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getWinnerRanking: (limit: bigint) => Promise<unknown>;
    getSundayCompStandings: (limit: bigint) => Promise<unknown>;
    getSundayCompStatus: () => Promise<unknown>;
    getPastWinners: () => Promise<unknown>;
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
}));

// The Comp view's own-principal comes from the real active-identity accessor.
// Stub it to a stable value so the panel's principal line is deterministic.
const ACTIVE_IDENTITY = "ranked-key-in-slot";

vi.mock("@/hooks/use-guest-identity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/use-guest-identity")>();
  return {
    ...actual,
    useActiveIdentity: () => ACTIVE_IDENTITY,
  };
});

import type {
  CompStandingRow,
  CompStatus,
  PastWinnerRow,
  WinnerRankingRow,
} from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";

/**
 * A realistic principal-shaped token (five dash-separated base32 groups). The
 * looser `[a-z0-9]{5}-[a-z0-9]{5}` pattern false-positives on ordinary UI text
 * such as the "Runner-up" column header, so the assertion uses the full shape.
 */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

/* --- Fixtures ----------------------------------------------------------- */

function standing(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): CompStandingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
}

/** A live competition status: Sunday 18 Oct 2026 00:00 UTC, 6h 12m remaining. */
const LIVE_STATUS: CompStatus = {
  live: true,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

interface ActorOverrides {
  ranking?: WinnerRankingRow[];
  standings?: CompStandingRow[];
  status?: CompStatus;
  pastWinners?: PastWinnerRow[];
}

/** Build a typed actor fake with the four leaderboard methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue(overrides.ranking ?? []),
    getSundayCompStandings: vi
      .fn()
      .mockResolvedValue(overrides.standings ?? []),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue(overrides.pastWinners ?? []),
  };
}

function renderWindow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LeaderboardWindow />
    </QueryClientProvider>,
  );
}

/** Seed the panel open so the body mounts regardless of the default. */
function seedOpen() {
  window.localStorage.setItem("tco-leaderboard-open", "true");
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  actorState.actor = null;
  actorState.principal = null;
  actorState.isLoading = false;
  actorState.error = null;
  vi.clearAllMocks();
});

/* --- My competition wins (signed-in player) ----------------------------- */

describe("My competition wins panel for a signed-in player", () => {
  it("shows the player's own competition wins and credited name from the isMe row", async () => {
    seedOpen();
    actorState.principal = "ii-principal";
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true), standing(2, "Bob", 1)],
      status: LIVE_STATUS,
    });
    renderWindow();

    // The live default opens on the Comp view; the panel is signed-in only.
    const panel = await screen.findByTestId("leaderboard.my_wins.panel");
    expect(within(panel).getByText("3 wins")).toBeInTheDocument();
    expect(
      within(panel).getByTestId("leaderboard.my_wins.credited_name"),
    ).toHaveTextContent("Ada");
    // The panel shows the identity the app holds for the player.
    expect(
      within(panel).getByTestId("leaderboard.my_wins.principal"),
    ).toHaveTextContent(ACTIVE_IDENTITY);
  });

  it("shows '0 wins' and the credited name '—' when the player has no isMe row", async () => {
    seedOpen();
    actorState.principal = "ii-principal";
    actorState.actor = makeActor({
      // No row is marked isMe: the player has no wins yet this competition.
      standings: [standing(1, "Bob", 2)],
      status: LIVE_STATUS,
    });
    renderWindow();

    const panel = await screen.findByTestId("leaderboard.my_wins.panel");
    expect(within(panel).getByText("0 wins")).toBeInTheDocument();
    expect(
      within(panel).getByTestId("leaderboard.my_wins.credited_name"),
    ).toHaveTextContent("—");
  });

  it("still renders no principal in the public Sunday standings list", async () => {
    seedOpen();
    actorState.principal = "ii-principal";
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true)],
      status: LIVE_STATUS,
    });
    const { container } = renderWindow();

    const list = await screen.findByTestId("leaderboard.sunday.list");
    expect(list).not.toBeNull();
    expect(list.textContent).not.toMatch(PRINCIPAL_PATTERN);
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });
});

/* --- Guest is never credited a ranked win ------------------------------- */

describe("guest is not credited a ranked win", () => {
  it("shows the guest notice and no My competition wins panel for a guest", async () => {
    seedOpen();
    // A guest is not signed in: no principal.
    actorState.principal = null;
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true)],
      status: LIVE_STATUS,
    });
    renderWindow();

    expect(
      await screen.findByTestId("leaderboard.sunday.guest_notice"),
    ).toBeInTheDocument();
    // The signed-in-only panel is absent for a guest.
    expect(
      screen.queryByTestId("leaderboard.my_wins.panel"),
    ).not.toBeInTheDocument();
  });
});
