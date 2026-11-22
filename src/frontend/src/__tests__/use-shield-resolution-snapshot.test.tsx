import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the shield-resolution snapshot consumer seam.
 *
 * The request adds per-team, per-game shield totals plus a pending
 * burn-and-play result that drives the distinct toast. The frontend reads both
 * through `useShieldResolutionSnapshot`, which polls the backend's
 * `getShieldResolutionSnapshot` query. This file pins the hook's contract:
 *   - it calls `getShieldResolutionSnapshot` (not `getShieldState`) and
 *     surfaces the returned per-team shield totals;
 *   - it surfaces `lastBurnAndPlay` (the pending burn-and-play result) so the
 *     route can push one toast per new burn;
 *   - a fresh snapshot with no pending burn resolves `lastBurnAndPlay` to
 *     undefined rather than trapping.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the hook's read contract — not real backend behavior. The real
 * `getShieldResolutionSnapshot` query is exercised by the PocketIC lane.
 */

const { getShieldResolutionSnapshot, useActorState } = vi.hoisted(() => ({
  getShieldResolutionSnapshot: vi.fn(),
  useActorState: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({ useActorState }));

import { SpellKind, Team } from "@/backend";
import type { ShieldResolutionSnapshot } from "@/backend";
import { useShieldResolutionSnapshot } from "@/hooks/use-shield-resolution-snapshot";

function SnapshotHarness() {
  const { data, isLoading } = useShieldResolutionSnapshot();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="white">{data?.whiteShield.toString() ?? "NONE"}</span>
      <span data-testid="black">{data?.blackShield.toString() ?? "NONE"}</span>
      <span data-testid="last">
        {data?.lastBurnAndPlay
          ? `${data.lastBurnAndPlay.spellName}:${data.lastBurnAndPlay.tokenId.toString()}`
          : "NONE"}
      </span>
    </div>
  );
}

function renderHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SnapshotHarness />
    </QueryClientProvider>,
  );
}

function snapshot(
  overrides: Partial<ShieldResolutionSnapshot> = {},
): ShieldResolutionSnapshot {
  return {
    whiteShield: 0n,
    blackShield: 0n,
    ...overrides,
  };
}

describe("useShieldResolutionSnapshot", () => {
  beforeEach(() => {
    getShieldResolutionSnapshot.mockReset();
    useActorState.mockReturnValue({
      actor: { getShieldResolutionSnapshot },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reads the per-team shield totals from getShieldResolutionSnapshot", async () => {
    getShieldResolutionSnapshot.mockResolvedValue(
      snapshot({ whiteShield: 6n, blackShield: 4n }),
    );
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("white")).toHaveTextContent("6");
    });
    expect(screen.getByTestId("black")).toHaveTextContent("4");
    expect(getShieldResolutionSnapshot).toHaveBeenCalled();
  });

  it("surfaces the pending burn-and-play result for the toast poll", async () => {
    getShieldResolutionSnapshot.mockResolvedValue(
      snapshot({
        whiteShield: 0n,
        blackShield: 0n,
        lastBurnAndPlay: {
          tokenId: 42n,
          spellName: "Minor Spell",
          gameNumber: 7n,
          team: Team.White,
          kind: SpellKind.Minor,
          removedSquares: [],
          insufficientMaterial: false,
          transformedSquares: [],
        },
      }),
    );
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("last")).toHaveTextContent("Minor Spell:42");
    });
  });

  it("resolves an absent pending burn to undefined rather than trapping", async () => {
    getShieldResolutionSnapshot.mockResolvedValue(snapshot());
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("last")).toHaveTextContent("NONE");
    expect(screen.getByTestId("white")).toHaveTextContent("0");
    expect(screen.getByTestId("black")).toHaveTextContent("0");
  });
});
