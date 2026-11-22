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
 * Cover for the prize additions to the Leaderboard window's Sunday comp view:
 *
 *   - the player-facing first prize, shown ONLY for a Sunday that has an
 *     allocation and nothing at all for a Sunday without one. The player view
 *     never shows the pool, the fees or any principal;
 *   - the signed-in player's own "My prize" panel, showing the amount and a
 *     claim status that reads claimable within its window and expired after the
 *     deadline passes;
 *   - the admin panel, rendered ONLY for the hardcoded admin principal and
 *     hidden for every other signed-in player, with its claim state reading
 *     "No allocation" when the Sunday has no allocation;
 *   - the admin allocation controls: the upcoming-Sunday dropdown, the ICP
 *     amount field, the live backend-computed preview with its rejections and
 *     warnings, the two-step "Confirm total prize" flow, and "Clear allocation".
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real prize reads (pool computation,
 * myPrize, claim status, the admin-only rejection, the allocation save/clear)
 * are asserted in the PocketIC backend lane, not here.
 *
 * The admin gate is a frontend mirror only: `useSignedInPrincipal()` reads the
 * `principal` field from the shared `@/lib/backend-actor` seam, so the mock
 * supplies it. A forged principal in the browser still cannot read or mutate
 * anything the backend does not permit — the backend remains the boundary.
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
  ClaimStatus,
  CompStatus,
  MyPrize,
  PrizePool,
  PrizePreviewResult,
  SundayAllocationStatus,
} from "@/backend";
import {
  ClaimStatus as ClaimStatusEnum,
  PrizeRejection,
  PrizeWarning,
} from "@/backend";
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

/** A frozen status: the last competition ended, next comp in 2d 5h. */
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

/** An expired prize: the deadline is in the past. */
const EXPIRED_PRIZE: MyPrize = {
  sunday: 1_792_281_600_000_000_000n,
  rank: 2n,
  amountE8s: 0n,
  // 2026-10-11T00:00:00Z — a week before the Sunday, already past.
  deadline: 1_791_676_800_000_000_000n,
};

/** The next upcoming Sunday (UTC) the admin dropdown offers. */
const NEXT_SUNDAY = 1_792_886_400_000_000_000n; // 2026-10-25T00:00:00Z

/** The Sunday after that, for a second dropdown row. */
const FOLLOWING_SUNDAY = NEXT_SUNDAY + 604_800_000_000_000n;

/** Two upcoming Sundays, the first unallocated and the second allocated. */
const UPCOMING_STATUSES: SundayAllocationStatus[] = [
  { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
  { sunday: FOLLOWING_SUNDAY, allocated: true, poolE8s: 1_000_000_000n },
];

/**
 * A backend-computed preview for a 10 ICP pool: a 4.99999999 ICP first prize,
 * ten halving rank prizes, a prizes total, the ten ledger fees (0.001 ICP) and
 * the pool required. The exact figures come from the backend; the frontend only
 * renders them.
 */
const PREVIEW: PrizePreviewResult = {
  preview: {
    firstPrizeE8s: 499_999_999n,
    rankPrizesE8s: [
      499_999_999n,
      249_999_999n,
      124_999_999n,
      62_499_999n,
      31_249_999n,
      15_624_999n,
      7_812_499n,
      3_906_249n,
      1_953_124n,
      976_562n,
    ],
    prizesTotalE8s: 999_023_428n,
    feesTotalE8s: 100_000n,
    poolRequiredE8s: 999_123_428n,
  },
  rejections: [],
  warnings: [],
};

/** A preview the backend rejects: the pool is too small to cover the fees. */
const REJECTED_PREVIEW: PrizePreviewResult = {
  preview: {
    firstPrizeE8s: 0n,
    rankPrizesE8s: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    prizesTotalE8s: 0n,
    feesTotalE8s: 100_000n,
    poolRequiredE8s: 100_000n,
  },
  rejections: [PrizeRejection.poolTooSmallForFees],
  warnings: [],
};

/** A preview the backend warns about: low ranks pay less than the fee. */
const WARNED_PREVIEW: PrizePreviewResult = {
  preview: {
    firstPrizeE8s: 1_000_000n,
    rankPrizesE8s: [
      1_000_000n,
      500_000n,
      250_000n,
      125_000n,
      62_500n,
      31_250n,
      15_625n,
      7_812n,
      3_906n,
      1_953n,
    ],
    prizesTotalE8s: 1_998_046n,
    feesTotalE8s: 100_000n,
    poolRequiredE8s: 2_098_046n,
  },
  rejections: [],
  warnings: [PrizeWarning.lowRanksBelowFee],
};

interface ActorOverrides {
  status?: CompStatus;
  pool?: PrizePool;
  myPrize?: MyPrize | null;
  claimStatus?: ClaimStatus | null;
  firstPrize?: bigint | null;
  upcomingStatuses?: SundayAllocationStatus[];
  preview?: PrizePreviewResult;
  saveResult?: unknown;
  clearResult?: unknown;
}

/** Build a typed actor fake with the leaderboard and prize methods. */
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
    getUpcomingAllocationStatuses: vi
      .fn()
      .mockResolvedValue(overrides.upcomingStatuses ?? UPCOMING_STATUSES),
    previewPrizeAllocation: vi
      .fn()
      .mockResolvedValue(overrides.preview ?? PREVIEW),
    savePrizeAllocation: vi.fn().mockResolvedValue(
      overrides.saveResult ?? {
        __kind__: "ok",
        ok: { sunday: NEXT_SUNDAY, allocated: true, poolE8s: 1_000_000_000n },
      },
    ),
    clearPrizeAllocation: vi.fn().mockResolvedValue(
      overrides.clearResult ?? {
        __kind__: "ok",
        ok: { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
      },
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

/* --- Player-facing first prize ------------------------------------------ */

describe("Player-facing first prize", () => {
  it("shows 'First prize: X ICP' for a Sunday that has an allocation", async () => {
    seedOpen();
    // The player view reads ONLY the player-facing first prize, never the pool.
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    renderWindow();

    // The live default opens on Sunday comp; the player block renders the
    // first prize. formatIcp trims trailing zeros, so 72_525_000_000 e8s reads
    // as "725.25 ICP".
    const panel = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.prize.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(
      within(panel).getByText("First prize 725.25 ICP"),
    ).toBeInTheDocument();
  });

  it("shows the empty label for a Sunday without an allocation", async () => {
    seedOpen();
    // No allocation: the player-facing first prize is null.
    actorState.actor = makeActor({ status: LIVE_STATUS, firstPrize: null });
    const { container } = renderWindow();

    // The Sunday view renders (its header is present) but the player prize
    // block is absent entirely — the header shows the empty label instead.
    await screen.findByText("LIVE NOW, Sunday 18 Oct");
    expect(
      container.querySelector('[data-ocid="leaderboard.prize.panel"]'),
    ).toBeNull();
    expect(
      await screen.findByText("No prize set for this competition"),
    ).toBeInTheDocument();
  });

  it("shows the player-facing pool derived as the first prize times two", async () => {
    seedOpen();
    // The player view derives its pool frontend-only as the first prize times
    // two; it never reads the admin-only getCurrentPrizePool value.
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    const panel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.prize.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // 72,525,000,000 e8s first prize -> 145,050,000,000 e8s pool = 1,450.5 ICP.
    expect(within(panel).getByText("Pool 1,450.5 ICP")).toBeInTheDocument();
    expect(
      within(panel).getByText("First prize 725.25 ICP"),
    ).toBeInTheDocument();
  });

  it("requests the player-facing first prize only while the Sunday comp view is shown", async () => {
    seedOpen();
    const actor = makeActor({ status: FROZEN_STATUS });
    actorState.actor = actor;
    renderWindow();

    // Frozen default is All time: the first-prize read is not issued yet.
    await screen.findByRole("tab", { name: "All time" });
    expect(actor.getFirstPrizeForSunday).not.toHaveBeenCalled();

    // Switching to Comp issues the first-prize read for the Sunday.
    await userEvent.setup().click(screen.getByRole("tab", { name: "Comp" }));
    await waitFor(() => {
      expect(actor.getFirstPrizeForSunday).toHaveBeenCalledWith(
        FROZEN_STATUS.sunday,
      );
    });
  });
});

/* --- My prize panel ----------------------------------------------------- */

describe("My prize panel", () => {
  it("shows the signed-in player's prize amount and a claimable status", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      myPrize: CLAIMABLE_PRIZE,
    });
    renderWindow();

    // The amount is rendered in ICP and the status reads claimable. The
    // header's first-prize row reads "First prize 725.25 ICP" as one span, so
    // the bare amount is unique to the My prize panel's amount row.
    await waitFor(() => {
      expect(screen.getByText("725.25 ICP")).toBeInTheDocument();
    });
    const status = document.querySelector(
      '[data-ocid="leaderboard.my_prize.status"]',
    );
    expect(status).not.toBeNull();
    expect(status?.textContent).toMatch(/Claimable/);
  });

  it("shows an expired status once the deadline has passed", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      myPrize: EXPIRED_PRIZE,
    });
    renderWindow();

    const status = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.my_prize.status"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(status.textContent).toBe("Expired");
  });

  it("shows the empty state when the player has no prize to claim", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({ status: LIVE_STATUS, myPrize: null });
    renderWindow();

    await waitFor(() => {
      expect(screen.getByText("No prize to claim yet")).toBeInTheDocument();
    });
  });

  it("does not render the My prize panel for a signed-out caller", async () => {
    seedOpen();
    // No principal: signed out. The panel is signed-in only.
    actorState.principal = null;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // The Sunday view renders (the player first-prize block is present) but the
    // signed-in-only My prize panel is absent.
    await screen.findByText("First prize 725.25 ICP");
    expect(
      container.querySelector('[data-ocid="leaderboard.my_prize.panel"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="leaderboard.my_prize.empty_state"]'),
    ).toBeNull();
  });
});

/* --- Admin panel gating ------------------------------------------------- */

describe("Admin prize panel gating", () => {
  it("renders the admin panel for the hardcoded admin principal", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    // The claim state is tied to the current Sunday's allocation: the
    // player-facing first-prize read returns a value exactly when the Sunday
    // has an allocation, so a non-null first prize is what makes the state
    // read "Claimable" rather than "No allocation".
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      firstPrize: 72_525_000_000n,
      claimStatus: ClaimStatusEnum.claimable,
    });
    const { container } = renderWindow();

    const panel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The admin panel shows the STORED Sunday allocation, not the recomputed
    // per-win pool: the stored first prize is 725.25 ICP and the stored total
    // pool is twice that (1,450.5 ICP). The claim state is also shown.
    expect(within(panel).getByText("1,450.5 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("725.25 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("Claimable")).toBeInTheDocument();
  });

  it("reads 'No allocation' when the Sunday has no allocation", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    // The backend reports no claim status (null) for a Sunday with no
    // allocation, which the panel renders as "No allocation".
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      claimStatus: null,
    });
    const { container } = renderWindow();

    const panel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The claim state reads "No allocation" — never "Claimable" — when the
    // Sunday has no allocation.
    const claimState = panel.querySelector(
      '[data-ocid="leaderboard.admin.claim_state"]',
    );
    expect(claimState).not.toBeNull();
    expect(claimState?.textContent).toBe("No allocation");
    expect(within(panel).queryByText("Claimable")).not.toBeInTheDocument();
  });

  it("hides the admin panel for a non-admin signed-in player", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // The Sunday view renders (the player first-prize block is present) but the
    // admin panel is absent for a non-admin caller.
    await screen.findByText("First prize 725.25 ICP");
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });

  it("hides the admin panel for a signed-out caller", async () => {
    seedOpen();
    actorState.principal = null;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    await screen.findByText("First prize 725.25 ICP");
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });

  it("does not read the claim status for a non-admin caller", async () => {
    seedOpen();
    actorState.principal = "player-1";
    const actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    actorState.actor = actor;
    renderWindow();

    await screen.findByText("First prize 725.25 ICP");
    // The claim-status read is admin-only; a non-admin caller never issues it.
    expect(actor.getClaimStatus).not.toHaveBeenCalled();
  });
});

/* --- Admin allocation controls ------------------------------------------ */

/** Render the window as the admin and wait for the allocation controls. */
async function renderAdminAllocation() {
  seedOpen();
  actorState.principal = ADMIN_PRINCIPAL;
  const actor = makeActor({
    status: LIVE_STATUS,
    pool: POOL,
    claimStatus: ClaimStatusEnum.claimable,
  });
  actorState.actor = actor;
  const view = renderWindow();
  await screen.findByRole("combobox");
  return { actor, ...view };
}

/** Select the first upcoming Sunday in the dropdown. */
async function selectFirstSunday() {
  const user = userEvent.setup();
  await user.selectOptions(
    screen.getByRole("combobox"),
    NEXT_SUNDAY.toString(),
  );
}

describe("Admin allocation controls", () => {
  it("lists the upcoming Sundays with each Sunday's allocation status", async () => {
    await renderAdminAllocation();

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    // A placeholder plus the two upcoming Sundays.
    expect(options).toHaveLength(3);

    // The first upcoming Sunday is unallocated; the second is allocated with
    // its stored pool shown.
    expect(options[1]?.textContent).toContain("Sunday 25 Oct 2026, 00:00 UTC");
    expect(options[1]?.textContent).toContain("No allocation");
    expect(options[2]?.textContent).toContain("Allocated");
    expect(options[2]?.textContent).toContain("10 ICP");
  });

  it("shows the live preview figures for a typed ICP amount", async () => {
    const { actor } = await renderAdminAllocation();
    await selectFirstSunday();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Total pool (ICP)"), "10");

    // The preview is computed by the backend for the parsed e8s amount.
    await waitFor(() => {
      expect(actor.previewPrizeAllocation).toHaveBeenCalledWith(1_000_000_000n);
    });

    const preview = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.admin.allocation.preview"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // First prize, all ten rank prizes, prizes total, 10 x ledger fee and pool
    // required are all rendered from the backend's exact figures. The first
    // prize also appears as rank 1, so scope that assertion to its own row.
    expect(
      preview.querySelector(
        '[data-ocid="leaderboard.admin.allocation.preview.first_prize"]',
      )?.textContent,
    ).toBe("4.99999999 ICP");
    expect(
      preview.querySelectorAll(
        '[data-ocid^="leaderboard.admin.allocation.preview.rank_prize."]',
      ),
    ).toHaveLength(10);
    expect(within(preview).getByText("9.99023428 ICP")).toBeInTheDocument();
    expect(within(preview).getByText("0.001 ICP")).toBeInTheDocument();
    expect(within(preview).getByText("9.99123428 ICP")).toBeInTheDocument();
  });

  it("shows the backend's rejection and disables the confirm button", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      claimStatus: ClaimStatusEnum.claimable,
      preview: REJECTED_PREVIEW,
    });
    renderWindow();
    await screen.findByRole("combobox");
    await selectFirstSunday();

    await userEvent
      .setup()
      .type(screen.getByLabelText("Total pool (ICP)"), "0.0005");

    // The rejection copy is shown and the confirm button is disabled.
    expect(
      await screen.findByText(
        "The pool is too small to cover the ten ledger fees.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm total prize" }),
    ).toBeDisabled();
  });

  it("shows the backend's warning without blocking the confirm button", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      claimStatus: ClaimStatusEnum.claimable,
      preview: WARNED_PREVIEW,
    });
    renderWindow();
    await screen.findByRole("combobox");
    await selectFirstSunday();

    await userEvent
      .setup()
      .type(screen.getByLabelText("Total pool (ICP)"), "0.02");

    // The warning is shown but the confirm button stays enabled.
    expect(
      await screen.findByText("Low ranks pay less than the ledger fee."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm total prize" }),
    ).toBeEnabled();
  });

  it("saves only after the second confirmation, which warns the first prize becomes public", async () => {
    const { actor } = await renderAdminAllocation();
    await selectFirstSunday();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Total pool (ICP)"), "10");

    const confirm = screen.getByRole("button", {
      name: "Confirm total prize",
    });

    // First press: the second confirmation warning appears; nothing is saved.
    await user.click(confirm);
    expect(
      await screen.findByText(
        /Saving this allocation makes the first prize public/,
      ),
    ).toBeInTheDocument();
    expect(actor.savePrizeAllocation).not.toHaveBeenCalled();

    // Second press: the allocation is saved for the selected Sunday.
    await user.click(confirm);
    await waitFor(() => {
      expect(actor.savePrizeAllocation).toHaveBeenCalledWith(
        NEXT_SUNDAY,
        1_000_000_000n,
      );
    });
    expect(await screen.findByText("Allocation saved.")).toBeInTheDocument();
  });

  it("clears an allocated Sunday's allocation", async () => {
    const { actor } = await renderAdminAllocation();
    // Select the second Sunday, which is already allocated.
    await userEvent
      .setup()
      .selectOptions(screen.getByRole("combobox"), FOLLOWING_SUNDAY.toString());

    const clear = screen.getByRole("button", { name: "Clear allocation" });
    expect(clear).toBeEnabled();
    await userEvent.setup().click(clear);

    await waitFor(() => {
      expect(actor.clearPrizeAllocation).toHaveBeenCalledWith(FOLLOWING_SUNDAY);
    });
    expect(await screen.findByText("Allocation cleared.")).toBeInTheDocument();
  });

  it("disables Clear allocation for a Sunday with no allocation", async () => {
    await renderAdminAllocation();
    await selectFirstSunday();

    // The first upcoming Sunday has no allocation, so Clear is disabled.
    expect(
      screen.getByRole("button", { name: "Clear allocation" }),
    ).toBeDisabled();
  });
});
