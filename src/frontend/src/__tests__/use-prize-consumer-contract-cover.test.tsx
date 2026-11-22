import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the frontend consumer contract of the prize data layer
 * (`src/frontend/src/hooks/use-prize.ts`), the seam the Leaderboard window's
 * prize panel, "My prize" panel and admin panel all read through.
 *
 * The window-level cover (leaderboard-prize-cover.test.tsx) asserts the
 * rendered panels. This file pins the layer beneath them, which that file does
 * not: the exact actor method each hook calls, the exact argument it passes,
 * and the `enabled` / `signedIn` gates that keep the prize reads out of the
 * game poll and off the anonymous caller.
 *
 * The accepted behavior asserted here:
 *   - `useCurrentPrizePool` calls `getCurrentPrizePool()` with no arguments and
 *     exposes the pool; it issues no request while disabled.
 *   - `useArchivedPrizePool(sunday)` calls `getArchivedPrizePool(sunday)` with
 *     the exact Sunday it was given, and issues no request while disabled or
 *     while `sunday` is null.
 *   - `useMyPrize` calls `getMyPrize()` with no arguments, and issues no
 *     request while disabled OR while signed out — `getMyPrize` is an update
 *     call that traps for the anonymous principal, so a signed-out caller must
 *     never reach it.
 *   - `useClaimStatus(sunday)` calls `getClaimStatus(sunday)` with the exact
 *     Sunday it was given, and issues no request while disabled or while
 *     `sunday` is null.
 *   - Each hook tolerates an actor that does not expose the prize method (an
 *     older binding or a test double) by resolving to null rather than
 *     throwing, so the surrounding window keeps rendering.
 *
 * The backend actor is a typed local mock throughout: this is
 * component/integration coverage, not deployed browser E2E. The real prize
 * reads (pool computation, myPrize, claim status, the admin-only rejection) are
 * asserted in the PocketIC backend lane, not here.
 */

// The hook module imports useActorState from lib/backend-actor, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the actor seam directly, exactly as the existing leaderboard tests do.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getCurrentPrizePool?: () => Promise<unknown>;
    getArchivedPrizePool?: (sunday: bigint) => Promise<unknown>;
    getMyPrize?: () => Promise<unknown>;
    getClaimStatus?: (sunday: bigint) => Promise<unknown>;
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
}));

import type { ArchivedPrizePool, MyPrize, PrizePool } from "@/backend";
import { ClaimStatus } from "@/backend";
import {
  useArchivedPrizePool,
  useClaimStatus,
  useCurrentPrizePool,
  useMyPrize,
} from "@/hooks/use-prize";

/* --- Fixtures ----------------------------------------------------------- */

/** A pool of 1,450.50 ICP with a first prize of 725.25 ICP. */
const POOL: PrizePool = {
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
};

/** An archived competition's pool, keyed by its Sunday. */
const ARCHIVED_POOL: ArchivedPrizePool = {
  sunday: 1_792_281_600_000_000_000n,
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
};

/** A claimable prize for the signed-in caller. */
const MY_PRIZE: MyPrize = {
  sunday: 1_792_281_600_000_000n,
  rank: 1n,
  amountE8s: 72_525_000_000n,
  deadline: 1_792_886_400_000_000_000n,
};

/** The Sunday the archived-pool and claim-status reads are keyed on. */
const SUNDAY = 1_792_281_600_000_000_000n;

/* --- Harnesses ---------------------------------------------------------- */

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/** Probe for useCurrentPrizePool: renders the pool amounts or "none". */
function CurrentPoolProbe({ enabled }: { enabled: boolean }) {
  const { pool, isLoading } = useCurrentPrizePool(enabled);
  return (
    <div>
      <span data-ocid="probe.loading">{isLoading ? "loading" : "idle"}</span>
      <span data-ocid="probe.pool">
        {pool ? pool.poolE8s.toString() : "none"}
      </span>
      <span data-ocid="probe.first_prize">
        {pool ? pool.firstPrizeE8s.toString() : "none"}
      </span>
    </div>
  );
}

/** Probe for useArchivedPrizePool. */
function ArchivedPoolProbe({
  sunday,
  enabled,
}: {
  sunday: bigint | null;
  enabled: boolean;
}) {
  const { pool } = useArchivedPrizePool(sunday, enabled);
  return (
    <span data-ocid="probe.archived_pool">
      {pool ? pool.poolE8s.toString() : "none"}
    </span>
  );
}

/** Probe for useMyPrize. */
function MyPrizeProbe({
  enabled,
  signedIn,
}: {
  enabled: boolean;
  signedIn: boolean;
}) {
  const { prize } = useMyPrize(enabled, signedIn);
  return (
    <span data-ocid="probe.my_prize">
      {prize ? prize.amountE8s.toString() : "none"}
    </span>
  );
}

/** Probe for useClaimStatus. */
function ClaimStatusProbe({
  sunday,
  enabled,
}: {
  sunday: bigint | null;
  enabled: boolean;
}) {
  const { status } = useClaimStatus(sunday, enabled);
  return <span data-ocid="probe.claim_status">{status ?? "none"}</span>;
}

afterEach(() => {
  cleanup();
  actorState.actor = null;
  actorState.isLoading = false;
  actorState.error = null;
  vi.clearAllMocks();
});

/* --- Current competition pool ------------------------------------------- */

describe("useCurrentPrizePool consumer contract", () => {
  it("calls getCurrentPrizePool() with no arguments and exposes the pool", async () => {
    const getCurrentPrizePool = vi.fn().mockResolvedValue(POOL);
    actorState.actor = { getCurrentPrizePool };
    renderWithQuery(<CurrentPoolProbe enabled />);

    await waitFor(() => {
      expect(getCurrentPrizePool).toHaveBeenCalledWith();
    });
    expect(await screen.findByText("145050000000")).toBeInTheDocument();
    expect(screen.getByText("72525000000")).toBeInTheDocument();
  });

  it("issues no request while disabled, so the pool stays out of the game poll", async () => {
    const getCurrentPrizePool = vi.fn().mockResolvedValue(POOL);
    actorState.actor = { getCurrentPrizePool };
    renderWithQuery(<CurrentPoolProbe enabled={false} />);

    // Give React Query a chance to run any query it would have started.
    await waitFor(() => {
      expect(document.querySelector('[data-ocid="probe.pool"]')).not.toBeNull();
    });
    expect(getCurrentPrizePool).not.toHaveBeenCalled();
  });

  it("resolves to null when the actor does not expose the prize method", async () => {
    // An older binding or a test double without the method must not throw; the
    // surrounding window keeps rendering.
    actorState.actor = {};
    renderWithQuery(<CurrentPoolProbe enabled />);

    // Both amount spans read "none"; scope the assertion to the pool span.
    await waitFor(() => {
      expect(
        document.querySelector('[data-ocid="probe.pool"]')?.textContent,
      ).toBe("none");
    });
  });
});

/* --- Archived competition pool ------------------------------------------ */

describe("useArchivedPrizePool consumer contract", () => {
  it("calls getArchivedPrizePool(sunday) with the exact Sunday it was given", async () => {
    const getArchivedPrizePool = vi.fn().mockResolvedValue(ARCHIVED_POOL);
    actorState.actor = { getArchivedPrizePool };
    renderWithQuery(<ArchivedPoolProbe sunday={SUNDAY} enabled />);

    await waitFor(() => {
      expect(getArchivedPrizePool).toHaveBeenCalledWith(SUNDAY);
    });
    expect(await screen.findByText("145050000000")).toBeInTheDocument();
  });

  it("issues no request while disabled", async () => {
    const getArchivedPrizePool = vi.fn().mockResolvedValue(ARCHIVED_POOL);
    actorState.actor = { getArchivedPrizePool };
    renderWithQuery(<ArchivedPoolProbe sunday={SUNDAY} enabled={false} />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-ocid="probe.archived_pool"]'),
      ).not.toBeNull();
    });
    expect(getArchivedPrizePool).not.toHaveBeenCalled();
  });

  it("issues no request while the Sunday is null", async () => {
    const getArchivedPrizePool = vi.fn().mockResolvedValue(ARCHIVED_POOL);
    actorState.actor = { getArchivedPrizePool };
    renderWithQuery(<ArchivedPoolProbe sunday={null} enabled />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-ocid="probe.archived_pool"]'),
      ).not.toBeNull();
    });
    expect(getArchivedPrizePool).not.toHaveBeenCalled();
  });
});

/* --- The caller's own prize --------------------------------------------- */

describe("useMyPrize consumer contract", () => {
  it("calls getMyPrize() with no arguments and exposes the prize when signed in", async () => {
    const getMyPrize = vi.fn().mockResolvedValue(MY_PRIZE);
    actorState.actor = { getMyPrize };
    renderWithQuery(<MyPrizeProbe enabled signedIn />);

    await waitFor(() => {
      expect(getMyPrize).toHaveBeenCalledWith();
    });
    expect(await screen.findByText("72525000000")).toBeInTheDocument();
  });

  it("issues no request while signed out, so the anonymous caller never reaches the trapping update call", async () => {
    // getMyPrize is an update call that traps for the anonymous principal, so a
    // signed-out caller must never issue it.
    const getMyPrize = vi.fn().mockResolvedValue(MY_PRIZE);
    actorState.actor = { getMyPrize };
    renderWithQuery(<MyPrizeProbe enabled signedIn={false} />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-ocid="probe.my_prize"]'),
      ).not.toBeNull();
    });
    expect(getMyPrize).not.toHaveBeenCalled();
  });

  it("issues no request while disabled even when signed in", async () => {
    const getMyPrize = vi.fn().mockResolvedValue(MY_PRIZE);
    actorState.actor = { getMyPrize };
    renderWithQuery(<MyPrizeProbe enabled={false} signedIn />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-ocid="probe.my_prize"]'),
      ).not.toBeNull();
    });
    expect(getMyPrize).not.toHaveBeenCalled();
  });

  it("resolves to null when the actor does not expose the prize method", async () => {
    actorState.actor = {};
    renderWithQuery(<MyPrizeProbe enabled signedIn />);

    expect(await screen.findByText("none")).toBeInTheDocument();
  });
});

/* --- Claim status ------------------------------------------------------- */

describe("useClaimStatus consumer contract", () => {
  it("calls getClaimStatus(sunday) with the exact Sunday it was given", async () => {
    const getClaimStatus = vi.fn().mockResolvedValue(ClaimStatus.claimable);
    actorState.actor = { getClaimStatus };
    renderWithQuery(<ClaimStatusProbe sunday={SUNDAY} enabled />);

    await waitFor(() => {
      expect(getClaimStatus).toHaveBeenCalledWith(SUNDAY);
    });
    expect(await screen.findByText("claimable")).toBeInTheDocument();
  });

  it("exposes the expired status the backend returns", async () => {
    const getClaimStatus = vi.fn().mockResolvedValue(ClaimStatus.expired);
    actorState.actor = { getClaimStatus };
    renderWithQuery(<ClaimStatusProbe sunday={SUNDAY} enabled />);

    expect(await screen.findByText("expired")).toBeInTheDocument();
  });

  it("issues no request while disabled", async () => {
    const getClaimStatus = vi.fn().mockResolvedValue(ClaimStatus.claimable);
    actorState.actor = { getClaimStatus };
    renderWithQuery(<ClaimStatusProbe sunday={SUNDAY} enabled={false} />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-ocid="probe.claim_status"]'),
      ).not.toBeNull();
    });
    expect(getClaimStatus).not.toHaveBeenCalled();
  });

  it("issues no request while the Sunday is null", async () => {
    const getClaimStatus = vi.fn().mockResolvedValue(ClaimStatus.claimable);
    actorState.actor = { getClaimStatus };
    renderWithQuery(<ClaimStatusProbe sunday={null} enabled />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-ocid="probe.claim_status"]'),
      ).not.toBeNull();
    });
    expect(getClaimStatus).not.toHaveBeenCalled();
  });
});
