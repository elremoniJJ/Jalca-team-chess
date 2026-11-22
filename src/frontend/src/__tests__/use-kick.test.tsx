import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// use-kick imports KickState as a type only (no runtime value from @/backend),
// so the backend module does not need mocking here. The hooks call getActor()
// from lib/backend-actor to reach the backend; mock it so the test captures
// the exact castKickVote / withdrawKickVote calls without a real actor.
const { castKickVote, withdrawKickVote } = vi.hoisted(() => ({
  castKickVote: vi.fn(),
  withdrawKickVote: vi.fn(),
}));
vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({ castKickVote, withdrawKickVote }),
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

import { useCastKickVote, useWithdrawKickVote } from "@/hooks/use-kick";

/**
 * Cover for the use-kick hook API consumer contract.
 *
 * The request wires the Players window kick buttons to the backend kick
 * mutations. The use-kick hooks are the typed seam between the UI and the
 * backend actor:
 *   - useCastKickVote.mutate({ principal, target }) calls
 *     actor.castKickVote(principal, target) and invalidates the kick-state
 *     query so the live counts / 'kicked by' arrays refresh;
 *   - useWithdrawKickVote.mutate({ principal, target }) calls
 *     actor.withdrawKickVote(principal, target) and invalidates the same
 *     query.
 *
 * Covered here (typed API-consumer contract):
 *   - casting a vote forwards the exact (principal, target) to the actor;
 *   - withdrawing a vote forwards the exact (principal, target) to the actor.
 */
function CastHarness() {
  const cast = useCastKickVote();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          void cast.mutate({ principal: "player-1", target: "player-2" })
        }
      >
        cast
      </button>
    </div>
  );
}

function WithdrawHarness() {
  const withdraw = useWithdrawKickVote();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          void withdraw.mutate({ principal: "player-1", target: "player-2" })
        }
      >
        withdraw
      </button>
    </div>
  );
}

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("use-kick API consumer contract", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("useCastKickVote forwards the exact (principal, target) to actor.castKickVote", async () => {
    const user = userEvent.setup();
    castKickVote.mockResolvedValue({ __kind__: "ok", ok: null });
    renderWithQuery(<CastHarness />);

    await user.click(screen.getByRole("button", { name: "cast" }));

    await waitFor(() => {
      expect(castKickVote).toHaveBeenCalledWith("player-1", "player-2");
    });
  });

  it("useWithdrawKickVote forwards the exact (principal, target) to actor.withdrawKickVote", async () => {
    const user = userEvent.setup();
    withdrawKickVote.mockResolvedValue({ __kind__: "ok", ok: null });
    renderWithQuery(<WithdrawHarness />);

    await user.click(screen.getByRole("button", { name: "withdraw" }));

    await waitFor(() => {
      expect(withdrawKickVote).toHaveBeenCalledWith("player-1", "player-2");
    });
  });
});
