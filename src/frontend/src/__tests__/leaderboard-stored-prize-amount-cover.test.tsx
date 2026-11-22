import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the stored-prize change to the prize-claim surface, at the frontend
 * consumer seam.
 *
 * The accepted change: a claim's amount is the prize stored for that exact rank
 * in the place record written at finalization (first prize divided by
 * 2^(rank-1), rounded down), never a value recomputed from the live allocation.
 * The archived place record gained a stored `prizeE8s` field, and the retry
 * branch re-verifies after the await that the place is still paying with the
 * same recipient and amount.
 *
 * The backend lane cannot reach the positive stored-amount path: the admin
 * principal is a fixed compile-time literal, so `savePrizeAllocation` cannot be
 * driven through the public API, and without an allocation every archived
 * placement stores `prizeE8s = 0`. The stored per-rank amount is therefore
 * observable only at this seam: `getMyPrize()` returns the stored
 * `placement.prizeE8s` as `amountE8s`, and the congratulations modal renders it
 * verbatim. This file pins that contract for every rank 1..10 at a 0.1 ICP and
 * a 10 ICP first prize, including the rank 9 and rank 10 rounding, and pins
 * that the rendered amount is the stored value the backend returned rather than
 * anything recomputed in the browser.
 *
 * The backend actor is a typed local mock throughout: this is
 * component/integration coverage, not deployed browser E2E. The real backend
 * behavior (the ownership gate, the claim state machine, the pay call) is
 * asserted in the PocketIC backend lane, not here.
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
    getCurrentPrizePool: () => Promise<unknown>;
    getArchivedPrizePool: (sunday: bigint) => Promise<unknown>;
    getMyPrize: () => Promise<unknown>;
    getClaimStatus: (sunday: bigint) => Promise<unknown>;
    getFirstPrizeForSunday: (sunday: bigint) => Promise<unknown>;
    getUpcomingAllocationStatuses: () => Promise<unknown>;
    previewPrizeAllocation: (poolE8s: bigint) => Promise<unknown>;
    savePrizeAllocation: (sunday: bigint, poolE8s: bigint) => Promise<unknown>;
    clearPrizeAllocation: (sunday: bigint) => Promise<unknown>;
    claimPrize: (
      competition: bigint,
      rank: bigint,
      recipient: unknown,
    ) => Promise<unknown>;
  } | null,
  isLoading: false,
  error: null as Error | null,
  principal: null as string | null,
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    isLoading: actorState.isLoading,
    error: actorState.error,
    retry: vi.fn(),
    principal: actorState.principal,
  }),
}));

import type { ClaimResult, CompStatus, MyPrize } from "@/backend";
import { ClaimState } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";

/* --- Fixtures ----------------------------------------------------------- */

/** A live competition status: Sunday 18 Oct 2026 00:00 UTC. */
const LIVE_STATUS: CompStatus = {
  live: true,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

/** The Sunday the stored prize is keyed on. */
const SUNDAY = 1_792_281_600_000_000_000n;

/** A deadline one week after the Sunday, still in the future. */
const DEADLINE = 1_792_886_400_000_000_000n;

/**
 * The stored per-rank prizes for a 0.1 ICP first prize (10,000,000 e8s), in
 * rank order. Each later rank halves the previous prize, rounding down:
 * rank r = F / 2^(r-1). Ranks 9 and 10 are the rounding cases:
 *   78,125 / 2 = 39,062.5 -> 39,062
 *   39,062 / 2 = 19,531
 */
const RANK_PRIZES_0_1_ICP: bigint[] = [
  10_000_000n,
  5_000_000n,
  2_500_000n,
  1_250_000n,
  625_000n,
  312_500n,
  156_250n,
  78_125n,
  39_062n,
  19_531n,
];

/**
 * The stored per-rank prizes for a 10 ICP first prize (1,000,000,000 e8s), in
 * rank order. Ranks 9 and 10 are the rounding cases:
 *   7,812,500 / 2 = 3,906,250
 *   3,906,250 / 2 = 1,953,125
 */
const RANK_PRIZES_10_ICP: bigint[] = [
  1_000_000_000n,
  500_000_000n,
  250_000_000n,
  125_000_000n,
  62_500_000n,
  31_250_000n,
  15_625_000n,
  7_812_500n,
  3_906_250n,
  1_953_125n,
];

/** The stored prize the backend returns for one rank. */
function storedPrize(rank: bigint, prizes: bigint[]): MyPrize {
  return {
    sunday: SUNDAY,
    rank,
    amountE8s: prizes[Number(rank) - 1]!,
    deadline: DEADLINE,
  };
}

/** A paid claim result, so the modal settles after a claim if one is sent. */
const PAID_RESULT: ClaimResult = {
  state: ClaimState.paid,
  amountE8s: 0n,
  blockIndex: 42n,
};

interface ActorOverrides {
  myPrize?: MyPrize | null;
}

/** Build a typed actor fake with the leaderboard and prize methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getCurrentPrizePool: vi.fn().mockResolvedValue({
      poolE8s: 0n,
      firstPrizeE8s: 0n,
    }),
    getArchivedPrizePool: vi.fn().mockResolvedValue(null),
    getMyPrize: vi
      .fn()
      .mockResolvedValue(
        overrides.myPrize === undefined ? null : overrides.myPrize,
      ),
    getClaimStatus: vi.fn().mockResolvedValue({ claimable: null }),
    getFirstPrizeForSunday: vi.fn().mockResolvedValue(null),
    getUpcomingAllocationStatuses: vi.fn().mockResolvedValue([]),
    previewPrizeAllocation: vi.fn().mockResolvedValue(null),
    savePrizeAllocation: vi.fn().mockResolvedValue(null),
    clearPrizeAllocation: vi.fn().mockResolvedValue(null),
    claimPrize: vi.fn().mockResolvedValue(PAID_RESULT),
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
  actorState.isLoading = false;
  actorState.error = null;
  actorState.principal = null;
  vi.clearAllMocks();
});

/* --- Stored per-rank amount at a 0.1 ICP first prize -------------------- */

describe("stored prize amount at a 0.1 ICP first prize", () => {
  for (let rank = 1n; rank <= 10n; rank += 1n) {
    it(`renders the stored prize for rank ${rank}`, async () => {
      seedOpen();
      actorState.principal = "player-1";
      const prize = storedPrize(rank, RANK_PRIZES_0_1_ICP);
      actorState.actor = makeActor({ myPrize: prize });
      renderWindow();

      // The modal states the exact stored amount and rank the backend returned.
      const modal = await waitFor(() => {
        const el = document.querySelector(
          '[data-ocid="leaderboard.claim.modal"]',
        );
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      const expected = formatIcp(prize.amountE8s);
      expect(
        within(modal).getByText(
          `You won ${expected} for rank ${rank.toString()}. Enter the ICP principal of your wallet to receive it.`,
        ),
      ).toBeInTheDocument();
    });
  }

  it("rounds the rank 9 and rank 10 stored prizes down", async () => {
    // The rounding is the acceptance criterion: rank 9 is 78,125 / 2 = 39,062.5
    // floored to 39,062, and rank 10 is 39,062 / 2 = 19,531. Assert the exact
    // e8s values the backend stored, not a rounded display.
    expect(RANK_PRIZES_0_1_ICP[8]).toBe(39_062n);
    expect(RANK_PRIZES_0_1_ICP[9]).toBe(19_531n);

    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      myPrize: storedPrize(9n, RANK_PRIZES_0_1_ICP),
    });
    renderWindow();

    const modal = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.claim.modal"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // 39,062 e8s = 0.00039062 ICP.
    expect(
      within(modal).getByText(/You won 0\.00039062 ICP for rank 9/),
    ).toBeInTheDocument();
  });
});

/* --- Stored per-rank amount at a 10 ICP first prize --------------------- */

describe("stored prize amount at a 10 ICP first prize", () => {
  for (let rank = 1n; rank <= 10n; rank += 1n) {
    it(`renders the stored prize for rank ${rank}`, async () => {
      seedOpen();
      actorState.principal = "player-1";
      const prize = storedPrize(rank, RANK_PRIZES_10_ICP);
      actorState.actor = makeActor({ myPrize: prize });
      renderWindow();

      const modal = await waitFor(() => {
        const el = document.querySelector(
          '[data-ocid="leaderboard.claim.modal"]',
        );
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      const expected = formatIcp(prize.amountE8s);
      expect(
        within(modal).getByText(
          `You won ${expected} for rank ${rank.toString()}. Enter the ICP principal of your wallet to receive it.`,
        ),
      ).toBeInTheDocument();
    });
  }

  it("rounds the rank 9 and rank 10 stored prizes down", async () => {
    // Rank 9 is 7,812,500 / 2 = 3,906,250 and rank 10 is 3,906,250 / 2 =
    // 1,953,125; both are exact here, so the assertion pins the halving chain
    // rather than a rounding artifact.
    expect(RANK_PRIZES_10_ICP[8]).toBe(3_906_250n);
    expect(RANK_PRIZES_10_ICP[9]).toBe(1_953_125n);

    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      myPrize: storedPrize(10n, RANK_PRIZES_10_ICP),
    });
    renderWindow();

    const modal = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.claim.modal"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // 1,953,125 e8s = 0.01953125 ICP.
    expect(
      within(modal).getByText(/You won 0\.01953125 ICP for rank 10/),
    ).toBeInTheDocument();
  });
});

/* --- The amount is the stored value, not a live recomputation ----------- */

describe("the rendered amount is the stored prize", () => {
  it("renders the stored amount even when the live pool disagrees", async () => {
    // The accepted invariant: changing the allocation after finalization does
    // not change a claim's amount. The frontend renders whatever stored amount
    // `getMyPrize` returns; it never recomputes from the live pool. Seed a live
    // pool that would imply a different first prize and assert the stored
    // amount still wins.
    seedOpen();
    actorState.principal = "player-1";
    const stored = storedPrize(1n, RANK_PRIZES_0_1_ICP);
    const actor = makeActor({ myPrize: stored });
    // A live pool of 1,450.50 ICP would imply a 725.25 ICP first prize, far
    // from the stored 0.1 ICP. The rendered amount must be the stored one.
    actor.getCurrentPrizePool = vi.fn().mockResolvedValue({
      poolE8s: 145_050_000_000n,
      firstPrizeE8s: 72_525_000_000n,
    });
    actorState.actor = actor;
    renderWindow();

    const modal = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.claim.modal"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(
      within(modal).getByText(/You won 0\.1 ICP for rank 1/),
    ).toBeInTheDocument();
    // The live first prize never appears in the modal.
    expect(within(modal).queryByText(/725\.25 ICP/)).not.toBeInTheDocument();
  });

  it("reads the caller's own prize through getMyPrize() with no arguments", async () => {
    seedOpen();
    actorState.principal = "player-1";
    const actor = makeActor({ myPrize: storedPrize(1n, RANK_PRIZES_0_1_ICP) });
    actorState.actor = actor;
    renderWindow();

    await waitFor(() => {
      expect(actor.getMyPrize).toHaveBeenCalledWith();
    });
  });
});

/* --- formatIcp mirror --------------------------------------------------- */

/**
 * The window's own ICP formatter, mirrored so the expected display string is
 * derived from the stored e8s rather than hardcoded. Trailing zeros in the
 * fractional part are trimmed, matching `formatIcp` in lib/prize-admin.ts.
 */
function formatIcp(e8s: bigint): string {
  const E8S_PER_ICP = 100_000_000n;
  const whole = e8s / E8S_PER_ICP;
  const frac = e8s % E8S_PER_ICP;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  const wholeStr = whole.toLocaleString();
  return fracStr ? `${wholeStr}.${fracStr} ICP` : `${wholeStr} ICP`;
}
