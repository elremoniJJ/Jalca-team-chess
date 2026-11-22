import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the prize-claim flow added to the Leaderboard window's Sunday comp
 * view, and for the admin-only claims overview.
 *
 * The accepted behavior asserted here:
 *   - a signed-in Internet Identity player with a claimable prize sees the
 *     congratulations modal on load; a signed-out caller never does;
 *   - the modal validates the recipient locally (well-formed, not anonymous,
 *     not a canister) and requires the confirm checkbox before the claim is
 *     sent;
 *   - the claim action calls the backend `claimPrize(competition, rank,
 *     recipient)` update call with the entered principal — the amount is never
 *     sent from the browser;
 *   - on `paid` the modal shows "Prize sent" with the block index;
 *   - on `paying` the modal shows "Payment in progress" with a "Try again"
 *     button that retries the SAME claim with the recipient locked at the first
 *     attempt;
 *   - on a flagged outcome (a paying result carrying a message) the modal shows
 *     "Manual check needed" and offers no retry;
 *   - the admin-only claims section shows each competition's unclaimed, paying
 *     and paid prizes with the amount, the recipient principal for paid ones and
 *     the block index, and is rendered only for the hardcoded admin principal.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real claim behavior (the ownership
 * check, the synchronous paying lock, the pay call, the paid/rejected/unknown
 * outcomes, the admin-only rejection) is asserted in the PocketIC backend lane,
 * not here.
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
    getAdminPrizeClaims: () => Promise<unknown>;
    getAdminAllocatedCompetitionDates: () => Promise<unknown>;
    getAdminCompetitionDetail: (sunday: bigint) => Promise<unknown>;
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

import type {
  AdminCompetitionDate,
  AdminCompetitionDetail,
  ClaimResult,
  ClaimStatus,
  CompStatus,
  MyPrize,
  PrizePool,
} from "@/backend";
import { ClaimState, ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/* --- Fixtures ----------------------------------------------------------- */

/** A live competition status: Sunday 18 Oct 2026 00:00 UTC, 6h 12m remaining. */
const LIVE_STATUS: CompStatus = {
  live: true,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

/**
 * A frozen competition status: no competition is live, so the window's default
 * view is All time. A claimable prize still exists after the competition day,
 * which is exactly the case the accepted requirement covers by rendering the
 * My prize panel in both views.
 */
const FROZEN_STATUS: CompStatus = {
  live: false,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

/** A pool of 1,450.50 ICP with a first prize of 725.25 ICP. */
const POOL: PrizePool = {
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
};

/** A claimable prize: deadline far in the future so the status reads claimable. */
const CLAIMABLE_PRIZE: MyPrize = {
  sunday: 1_792_281_600_000_000_000n,
  rank: 1n,
  amountE8s: 72_525_000_000n,
  // 2030-01-01T00:00:00Z — far in the future, so the prize is always claimable.
  deadline: 1_893_456_000_000_000_000n,
};

/**
 * A well-formed, non-anonymous, non-canister principal the modal accepts. It is
 * a 29-byte self-authenticating user principal, so `validateRecipientPrincipal`
 * accepts it.
 */
const RECIPIENT_TEXT =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae";

/** The paid result: the place is paid with a ledger block index. */
const PAID_RESULT: ClaimResult = {
  state: ClaimState.paid,
  amountE8s: 72_525_000_000n,
  blockIndex: 42n,
};

/** A paying result with no message: the place may be retried. */
const PAYING_RESULT: ClaimResult = {
  state: ClaimState.paying,
  amountE8s: 72_525_000_000n,
  blockIndex: undefined,
  message: undefined,
};

/** A flagged paying result: the place needs a manual check and is not retried. */
const FLAGGED_RESULT: ClaimResult = {
  state: ClaimState.paying,
  amountE8s: 72_525_000_000n,
  blockIndex: undefined,
  message:
    "Your prize needs a manual check. The team has been notified and will resolve it; please do not retry.",
};

interface ActorOverrides {
  status?: CompStatus;
  pool?: PrizePool;
  myPrize?: MyPrize | null;
  claimStatus?: ClaimStatus | null;
  firstPrize?: bigint | null;
  claimResult?: ClaimResult;
  adminDates?: AdminCompetitionDate[];
  adminDetail?: AdminCompetitionDetail | null;
}

/** Build a typed actor fake with the leaderboard, prize and claim methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getCurrentPrizePool: vi.fn().mockResolvedValue(overrides.pool ?? POOL),
    getArchivedPrizePool: vi.fn().mockResolvedValue(null),
    getMyPrize: vi
      .fn()
      .mockResolvedValue(
        overrides.myPrize === undefined ? null : overrides.myPrize,
      ),
    getClaimStatus: vi
      .fn()
      .mockResolvedValue(
        overrides.claimStatus === undefined
          ? ClaimStatusEnum.claimable
          : overrides.claimStatus,
      ),
    getFirstPrizeForSunday: vi
      .fn()
      .mockResolvedValue(
        overrides.firstPrize === undefined ? null : overrides.firstPrize,
      ),
    getUpcomingAllocationStatuses: vi.fn().mockResolvedValue([]),
    previewPrizeAllocation: vi.fn().mockResolvedValue(null),
    savePrizeAllocation: vi.fn().mockResolvedValue(null),
    clearPrizeAllocation: vi.fn().mockResolvedValue(null),
    claimPrize: vi.fn().mockResolvedValue(overrides.claimResult ?? PAID_RESULT),
    getAdminPrizeClaims: vi.fn().mockResolvedValue(null),
    getAdminAllocatedCompetitionDates: vi
      .fn()
      .mockResolvedValue(overrides.adminDates ?? []),
    getAdminCompetitionDetail: vi
      .fn()
      .mockResolvedValue(
        overrides.adminDetail === undefined ? null : overrides.adminDetail,
      ),
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

/* --- Congratulations modal on load -------------------------------------- */

describe("Congratulations modal on load", () => {
  it("opens the modal for a signed-in player with a claimable prize", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      myPrize: CLAIMABLE_PRIZE,
    });
    renderWindow();

    // The modal opens on load, without any click, for a claimable prize.
    const modal = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.claim.modal"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(
      within(modal).getByText("Congratulations — you won a prize!"),
    ).toBeInTheDocument();
    // The modal states the amount and rank from the stored prize.
    expect(
      within(modal).getByText(/You won 725.25 ICP for rank 1/),
    ).toBeInTheDocument();
  });

  it("does not open the modal for a signed-out caller", async () => {
    seedOpen();
    actorState.principal = null;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // The Sunday view renders, but the signed-in-only modal never appears.
    await screen.findByText("First prize 725.25 ICP");
    expect(
      container.querySelector('[data-ocid="leaderboard.claim.modal"]'),
    ).toBeNull();
  });

  it("does not open the modal for a signed-in player with no prize", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({ status: LIVE_STATUS, myPrize: null });
    const { container } = renderWindow();

    await screen.findByText("No prize to claim yet");
    expect(
      container.querySelector('[data-ocid="leaderboard.claim.modal"]'),
    ).toBeNull();
  });

  it("opens the modal on load in the All time view when no competition is live", async () => {
    seedOpen();
    actorState.principal = "player-1";
    // A frozen competition defaults the window to All time, but a claimable
    // prize still exists after the competition day. The accepted requirement
    // renders the My prize panel in both views, so the modal must open on load
    // without the player manually switching to the Comp view.
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      myPrize: CLAIMABLE_PRIZE,
    });
    renderWindow();

    // The window is on the All time view (its tab is selected)...
    const allTimeTab = await screen.findByRole("tab", { name: "All time" });
    expect(allTimeTab).toHaveAttribute("aria-selected", "true");

    // ...and the congratulations modal is open on load anyway.
    const modal = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.claim.modal"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(
      within(modal).getByText("Congratulations — you won a prize!"),
    ).toBeInTheDocument();
  });
});

/* --- Claim action ------------------------------------------------------- */

/** Render as a signed-in player with a claimable prize and wait for the modal. */
async function renderClaimModal(overrides: ActorOverrides = {}) {
  seedOpen();
  actorState.principal = "player-1";
  const actor = makeActor({
    status: LIVE_STATUS,
    myPrize: CLAIMABLE_PRIZE,
    ...overrides,
  });
  actorState.actor = actor;
  const view = renderWindow();
  await screen.findByText("Congratulations — you won a prize!");
  return { actor, ...view };
}

/** Type a recipient and tick the confirm checkbox, leaving the claim ready. */
async function fillRecipient(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your ICP principal"), text);
  await user.click(screen.getByRole("checkbox"));
}

/**
 * The modal's own submit button. The My prize card also carries a "Claim prize"
 * button, so scope the query to the modal's submit ocid.
 */
function submitButton(): HTMLElement {
  const el = document.querySelector(
    '[data-ocid="leaderboard.claim.submit_button"]',
  );
  if (el === null) throw new Error("claim submit button not found");
  return el as HTMLElement;
}

describe("Claim action", () => {
  it("calls claimPrize with the competition, rank and entered recipient, never an amount", async () => {
    const { actor } = await renderClaimModal();
    await fillRecipient(RECIPIENT_TEXT);

    await userEvent.setup().click(submitButton());

    await waitFor(() => {
      expect(actor.claimPrize).toHaveBeenCalledTimes(1);
    });
    const [competition, rank, recipient] = actor.claimPrize.mock.calls[0]!;
    // The competition is the exact archive key timestamp and the rank is the
    // stored rank. The recipient is the entered principal. No amount argument
    // exists: the backend reads the stored prize.
    expect(competition).toBe(CLAIMABLE_PRIZE.sunday);
    expect(rank).toBe(CLAIMABLE_PRIZE.rank);
    expect(String(recipient)).toBe(RECIPIENT_TEXT);
  });

  it("rejects a malformed recipient locally and never calls the backend", async () => {
    const { actor } = await renderClaimModal();
    const user = userEvent.setup();
    // A 64-character account ID is not a principal.
    await user.type(
      screen.getByLabelText("Your ICP principal"),
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );

    expect(
      await screen.findByText(/not a valid principal/),
    ).toBeInTheDocument();
    // The confirm checkbox is not even offered for an invalid address.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(actor.claimPrize).not.toHaveBeenCalled();
  });

  it("shows 'Prize sent' with the block index on a paid result", async () => {
    await renderClaimModal({ claimResult: PAID_RESULT });
    await fillRecipient(RECIPIENT_TEXT);

    await userEvent.setup().click(submitButton());

    const paid = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.claim.paid_state"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(paid).getByText("Prize sent")).toBeInTheDocument();
    expect(within(paid).getByText("Block 42")).toBeInTheDocument();
  });

  it("shows 'Payment in progress' with a retry on a paying result", async () => {
    await renderClaimModal({ claimResult: PAYING_RESULT });
    await fillRecipient(RECIPIENT_TEXT);

    await userEvent.setup().click(submitButton());

    const paying = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.claim.paying_state"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(paying).getByText("Payment in progress")).toBeInTheDocument();
    expect(
      within(paying).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("retries the same claim with the recipient locked at the first attempt", async () => {
    const { actor } = await renderClaimModal({ claimResult: PAYING_RESULT });
    await fillRecipient(RECIPIENT_TEXT);

    const user = userEvent.setup();
    await user.click(submitButton());
    await screen.findByText("Payment in progress");

    // The retry reuses the locked recipient, not a freshly typed one.
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(actor.claimPrize).toHaveBeenCalledTimes(2);
    });
    const first = actor.claimPrize.mock.calls[0]!;
    const second = actor.claimPrize.mock.calls[1]!;
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(String(second[2])).toBe(String(first[2]));
  });

  it("shows 'Manual check needed' and offers no retry on a flagged result", async () => {
    await renderClaimModal({ claimResult: FLAGGED_RESULT });
    await fillRecipient(RECIPIENT_TEXT);

    await userEvent.setup().click(submitButton());

    const flagged = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.claim.flagged_state"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(
      within(flagged).getByText("Manual check needed"),
    ).toBeInTheDocument();
    // A flagged place is not retried.
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });
});

/* --- Admin claims overview ---------------------------------------------- */

describe("Admin claims overview", () => {
  it("shows unclaimed, paying and paid prizes with amount, recipient and block index", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      firstPrize: 72_525_000_000n,
      claimStatus: ClaimStatusEnum.claimable,
      adminDates: [
        { sunday: 1_792_281_600_000_000_000n, poolE8s: 145_050_000_000n },
      ],
      adminDetail: {
        sunday: 1_792_281_600_000_000n,
        poolE8s: 145_050_000_000n,
        firstPrizeE8s: 72_525_000_000n,
        unclaimed: [{ rank: 3n, amountE8s: 0n }],
        paying: [{ rank: 2n, amountE8s: 0n }],
        paid: [
          {
            rank: 1n,
            amountE8s: 72_525_000_000n,
            recipient: undefined,
            blockIndex: 42n,
          },
        ],
      },
    });
    const { container } = renderWindow();

    // The admin prize-claims area is now a dropdown of allocated competition
    // dates; selecting one reveals that competition's detail.
    const select = await screen.findByLabelText("Competition date");
    await userEvent.setup().selectOptions(select, "1792281600000000000");

    const detail = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.claims.detail"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The three claim-state groups are rendered with their counts.
    expect(within(detail).getByText("Unclaimed (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paying (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paid (1)")).toBeInTheDocument();

    // The paid entry carries the amount and the block index.
    const paidEntry = detail.querySelector(
      '[data-ocid="leaderboard.admin.claims.entry.paid.1"]',
    );
    expect(paidEntry).not.toBeNull();
    expect(paidEntry?.textContent).toContain("Rank 1");
    expect(paidEntry?.textContent).toContain("725.25 ICP");
    expect(paidEntry?.textContent).toContain("Block 42");
  });

  it("shows the empty state when no competition has a confirmed pool", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      firstPrize: 72_525_000_000n,
      claimStatus: ClaimStatusEnum.claimable,
      adminDates: [],
    });
    renderWindow();

    expect(
      await screen.findByText(
        "No competitions with a confirmed prize pool yet",
      ),
    ).toBeInTheDocument();
  });

  it("does not read the admin claims overview for a non-admin caller", async () => {
    seedOpen();
    actorState.principal = "player-1";
    const actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    actorState.actor = actor;
    renderWindow();

    await screen.findByText("First prize 725.25 ICP");
    // The admin-only reads are never issued for a non-admin caller.
    expect(actor.getAdminAllocatedCompetitionDates).not.toHaveBeenCalled();
    expect(actor.getAdminCompetitionDetail).not.toHaveBeenCalled();
  });
});
