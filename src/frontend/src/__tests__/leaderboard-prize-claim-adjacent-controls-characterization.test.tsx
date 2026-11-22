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
 * Characterization of the Leaderboard window's prize surfaces that the claim
 * flow must NOT disturb, taken BEFORE the claim flow is added.
 *
 * The request intentionally changes two things:
 *   1. the "My prize" panel gains a congratulations modal and a claim action
 *      that calls the prize canister;
 *   2. the admin prize panel gains unclaimed, paying and paid prize rows per
 *      competition.
 *
 * This file deliberately does NOT assert the new modal, the new claim action or
 * the new admin rows. It pins the adjacent behavior that must keep working
 * through the change:
 *
 *   - the player-facing first prize block: shown ONLY for a Sunday that has an
 *     allocation, nothing at all for a Sunday without one, and never the pool;
 *   - the admin allocation controls: the upcoming-Sunday dropdown with each
 *     Sunday's allocation status, the ICP amount field, the backend-computed
 *     preview, the two-step "Confirm total prize" flow and "Clear allocation";
 *   - the admin panel's existing current-pool / first-prize / claim-state rows.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real claim behavior (ownership check,
 * the synchronous paying lock, the pay call, the paid/rejected/unknown
 * outcomes) is asserted in the PocketIC backend lane, not here.
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
  PrizePool,
  PrizePreviewResult,
  SundayAllocationStatus,
} from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
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

/** A pool of 1,450.50 ICP with a first prize of 725.25 ICP. */
const POOL: PrizePool = {
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
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

interface ActorOverrides {
  status?: CompStatus;
  pool?: PrizePool;
  claimStatus?: ClaimStatus | null;
  firstPrize?: bigint | null;
  upcomingStatuses?: SundayAllocationStatus[];
  preview?: PrizePreviewResult;
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
    getMyPrize: vi.fn().mockResolvedValue(null),
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
    savePrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: NEXT_SUNDAY, allocated: true, poolE8s: 1_000_000_000n },
    }),
    clearPrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
    }),
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

/* --- Player-facing first prize block (unchanged) ------------------------ */

describe("Player-facing first prize block is unchanged", () => {
  it("shows 'First prize: X ICP' for a Sunday that has an allocation", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    renderWindow();

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
});

/* --- Admin allocation controls (unchanged) ------------------------------ */

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

describe("Admin allocation controls are unchanged", () => {
  it("lists the upcoming Sundays with each Sunday's allocation status", async () => {
    await renderAdminAllocation();

    const select = screen.getByRole("combobox");
    const options = within(select).getAllByRole("option");
    // A placeholder plus the two upcoming Sundays.
    expect(options).toHaveLength(3);

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

    expect(
      screen.getByRole("button", { name: "Clear allocation" }),
    ).toBeDisabled();
  });
});
