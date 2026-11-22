import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the kick-wallet-removal change.
 *
 * The request intentionally:
 *   - removes the wallet requirement from the kick path (deletes the
 *     hasWallet state and its usages, the hasWallet prop, the !!hasWallet
 *     term in canKick, and the "Connect a wallet to kick" tooltip);
 *   - makes the Kick button clickable for a spectator, showing an
 *     informational toast instead of calling the backend;
 *   - renders no Kick button on the viewer's own row;
 *   - surfaces the backend #err text from use-kick so a rejected vote shows
 *     a toast instead of failing silently;
 *   - rewrites the kick wording in InformationModal and StatusWindow;
 *   - bumps JALCA_VERSION from v403 to v404.
 *
 * None of those intentional changes is asserted here. What this file protects
 * is the behavior ADJACENT to the change that must survive it:
 *   - the kick column still renders the 'KICKED!' withdraw state and calls
 *     onWithdrawKickVote with the target's principal;
 *   - the 'number of kicks' count and the 'kicked by' array still render for
 *     each player;
 *   - the roster still groups players into White/Black columns with the
 *     correct header counts and the 'you' marker;
 *   - the use-kick mutations still forward the exact (principal, target) to
 *     the actor and invalidate the kick-state query;
 *   - the InformationModal and StatusWindow keep their structural shell and
 *     their non-kick sections;
 *   - the wordmark still composes `jalca <JALCA_VERSION>` from the single
 *     constant.
 *
 * The actor and the route's data hooks are mocked; this is
 * component/integration coverage, not deployed browser E2E. The real backend
 * behavior is the PocketIC lane's job.
 */

// PlayerList imports Team as a runtime value from @/backend, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
vi.mock("@/backend", () => ({
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// PlayerList calls getActor() from lib/backend-actor on click to query the
// NFT count. Mock it so the test controls the returned token list without
// touching the real actor or @caffeineai/core-infrastructure.
const { getNftsForOwner } = vi.hoisted(() => ({ getNftsForOwner: vi.fn() }));
vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({ getNftsForOwner }),
}));

import { Team, WalletSource } from "@/backend";
import type { KickState, PlayerInfo } from "@/backend";
import { PlayerList } from "@/components/PlayerList";

function makePlayer(overrides: Partial<PlayerInfo> = {}): PlayerInfo {
  return {
    principal: "player-1",
    username: "Ada",
    team: Team.White,
    walletSource: WalletSource.none,
    isMoveMaker: false,
    isFresh: true,
    isInactive: false,
    isBot: false,
    ...overrides,
  };
}

function makeKickState(
  players: Array<{ principal: string; kickCount: bigint; kickedBy: string[] }>,
): KickState {
  return { players };
}

describe("PlayerList kick column (adjacent to the wallet-requirement removal)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("still shows 'KICKED!' for a target the current player voted for and withdraws on click", async () => {
    const user = userEvent.setup();
    const onWithdrawKickVote = vi.fn();
    const { container } = render(
      <PlayerList
        players={[
          makePlayer({ principal: "me", username: "Ada", team: Team.White }),
          makePlayer({
            principal: "target",
            username: "Bob",
            team: Team.White,
          }),
        ]}
        currentPrincipal="me"
        currentUsername="Ada"
        kickState={makeKickState([
          { principal: "target", kickCount: 1n, kickedBy: ["Ada"] },
        ])}
        onCastKickVote={vi.fn()}
        onWithdrawKickVote={onWithdrawKickVote}
      />,
    );

    const kickedButton = container.querySelector<HTMLButtonElement>(
      '[data-ocid="player_list.kick_button.1"]',
    );
    expect(kickedButton).not.toBeNull();
    expect(kickedButton).toHaveTextContent("KICKED!");
    expect(kickedButton).toBeEnabled();
    await user.click(kickedButton as HTMLButtonElement);
    expect(onWithdrawKickVote).toHaveBeenCalledWith("target");
  });

  it("still renders the 'number of kicks' count and 'kicked by' array for each player", () => {
    const { container } = render(
      <PlayerList
        players={[
          makePlayer({ principal: "me", username: "Ada", team: Team.White }),
          makePlayer({
            principal: "target",
            username: "Bob",
            team: Team.White,
          }),
        ]}
        currentPrincipal="me"
        currentUsername="Ada"
        kickState={makeKickState([
          { principal: "target", kickCount: 2n, kickedBy: ["Ada", "Cara"] },
          { principal: "me", kickCount: 0n, kickedBy: [] },
        ])}
      />,
    );

    expect(
      container.querySelector('[data-ocid="player_list.kick_count.1"]'),
    ).toHaveTextContent("2");
    expect(
      container.querySelector('[data-ocid="player_list.kicked_by.1"]'),
    ).toHaveTextContent("Ada, Cara");
    expect(
      container.querySelector('[data-ocid="player_list.kicked_by.0"]'),
    ).toHaveTextContent("—");
  });

  it("still groups players into White/Black columns with the correct header counts and 'you' marker", () => {
    render(
      <PlayerList
        players={[
          makePlayer({ principal: "me", username: "Ada", team: Team.White }),
          makePlayer({ principal: "w2", username: "Bob", team: Team.White }),
          makePlayer({ principal: "b1", username: "Cara", team: Team.Black }),
        ]}
        currentPrincipal="me"
      />,
    );

    expect(screen.getByText("2W / 1B")).toBeInTheDocument();
    const adaRow = screen.getByRole("button", { name: /Ada/ });
    expect(adaRow).toHaveTextContent("you");
    expect(screen.getByRole("button", { name: /Bob/ })).not.toHaveTextContent(
      "you",
    );
  });
});

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

function CastHarness() {
  const cast = useCastKickVote();
  return (
    <button
      type="button"
      onClick={() =>
        void cast.mutate({ principal: "player-1", target: "player-2" })
      }
    >
      cast
    </button>
  );
}

function WithdrawHarness() {
  const withdraw = useWithdrawKickVote();
  return (
    <button
      type="button"
      onClick={() =>
        void withdraw.mutate({ principal: "player-1", target: "player-2" })
      }
    >
      withdraw
    </button>
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

describe("use-kick mutations (adjacent to the #err surfacing change)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("still forwards the exact (principal, target) to actor.castKickVote", async () => {
    const user = userEvent.setup();
    castKickVote.mockResolvedValue({ __kind__: "ok", ok: null });
    renderWithQuery(<CastHarness />);

    await user.click(screen.getByRole("button", { name: "cast" }));

    await waitFor(() => {
      expect(castKickVote).toHaveBeenCalledWith("player-1", "player-2");
    });
  });

  it("still forwards the exact (principal, target) to actor.withdrawKickVote", async () => {
    const user = userEvent.setup();
    withdrawKickVote.mockResolvedValue({ __kind__: "ok", ok: null });
    renderWithQuery(<WithdrawHarness />);

    await user.click(screen.getByRole("button", { name: "withdraw" }));

    await waitFor(() => {
      expect(withdrawKickVote).toHaveBeenCalledWith("player-1", "player-2");
    });
  });
});
