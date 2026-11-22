import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// The spectator toast uses the sonner pattern. Mock sonner so the test can
// assert the informational toast without a real toast host.
const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { info: toastInfo, error: vi.fn(), success: vi.fn() },
}));

import { Team, WalletSource } from "@/backend";
import type { KickState, PlayerInfo } from "@/backend";
import { PlayerList } from "@/components/PlayerList";

/**
 * Cover for the kick column in the Players window.
 *
 * The request removes the wallet requirement from the kick path: the
 * `hasWallet` prop is gone, a player without a connected wallet can still
 * press the Kick button and cast a vote, a spectator sees a clickable button
 * that shows an informational toast instead of calling the backend, and the
 * viewer's own row renders no kick button at all (self-votes are rejected by
 * the backend).
 *
 * Covered here (frontend observable behavior):
 *   - a player (no wallet prop) sees an enabled "kick?" button that calls
 *     onCastKickVote with the target's principal on click;
 *   - a spectator sees an enabled "kick?" button; clicking it shows the
 *     informational toast and never calls onCastKickVote;
 *   - the viewer's own row renders no kick button, but keeps the count and
 *     'kicked by' columns;
 *   - a player who voted sees "KICKED!" and clicking calls onWithdrawKickVote;
 *   - the 'number of kicks' count and the 'kicked by' array render for each
 *     player, and the count always equals the length of the 'kicked by'
 *     array (the backend derives both from the same vote records).
 */
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

function renderList(
  players: PlayerInfo[],
  opts: {
    kickState?: KickState | null;
    currentUsername?: string;
    spectator?: boolean;
    onCastKickVote?: (target: string) => void;
    onWithdrawKickVote?: (target: string) => void;
  } = {},
) {
  return render(
    <PlayerList
      players={players}
      currentPrincipal="me"
      kickState={opts.kickState}
      currentUsername={opts.currentUsername}
      spectator={opts.spectator}
      onCastKickVote={opts.onCastKickVote}
      onWithdrawKickVote={opts.onWithdrawKickVote}
    />,
  );
}

describe("PlayerList kick column", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // The two players are both on White, so the roster renders them in a single
  // column: index 0 = "me" (Ada), index 1 = "target" (Bob). The kick column
  // uses data-ocid selectors keyed by that index, which lets us scope each
  // assertion to the intended player's row without ambiguity.
  const targetKickButton = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>(
      '[data-ocid="player_list.kick_button.1"]',
    );
  const targetKickCount = (container: HTMLElement) =>
    container.querySelector<HTMLElement>(
      '[data-ocid="player_list.kick_count.1"]',
    );
  const targetKickedBy = (container: HTMLElement) =>
    container.querySelector<HTMLElement>(
      '[data-ocid="player_list.kicked_by.1"]',
    );

  it("shows an enabled 'kick?' button for a player and casts a vote on click", async () => {
    const user = userEvent.setup();
    const onCastKickVote = vi.fn();
    const { container } = renderList(
      [
        makePlayer({ principal: "me", username: "Ada", team: Team.White }),
        makePlayer({ principal: "target", username: "Bob", team: Team.White }),
      ],
      {
        currentUsername: "Ada",
        onCastKickVote,
        onWithdrawKickVote: vi.fn(),
      },
    );

    const kickButton = targetKickButton(container);
    expect(kickButton).not.toBeNull();
    expect(kickButton).toBeEnabled();
    await user.click(kickButton as HTMLButtonElement);
    expect(onCastKickVote).toHaveBeenCalledWith("target");
  });

  it("shows a clickable 'kick?' button for a spectator that toasts and never votes", async () => {
    const user = userEvent.setup();
    const onCastKickVote = vi.fn();
    const { container } = renderList(
      [
        makePlayer({ principal: "me", username: "Ada", team: Team.White }),
        makePlayer({ principal: "target", username: "Bob", team: Team.White }),
      ],
      {
        currentUsername: "Ada",
        spectator: true,
        onCastKickVote,
        onWithdrawKickVote: vi.fn(),
      },
    );

    const kickButton = targetKickButton(container);
    expect(kickButton).not.toBeNull();
    expect(kickButton).toBeEnabled();
    await user.click(kickButton as HTMLButtonElement);
    expect(toastInfo).toHaveBeenCalledWith(
      "Only active players can kick. Join the game as a player to vote.",
    );
    expect(onCastKickVote).not.toHaveBeenCalled();
  });

  it("renders no kick button on the viewer's own row but keeps the count columns", () => {
    const { container } = renderList(
      [
        makePlayer({ principal: "me", username: "Ada", team: Team.White }),
        makePlayer({ principal: "target", username: "Bob", team: Team.White }),
      ],
      {
        currentUsername: "Ada",
        onCastKickVote: vi.fn(),
        onWithdrawKickVote: vi.fn(),
      },
    );

    // The viewer's own row (index 0) has no kick button.
    expect(
      container.querySelector('[data-ocid="player_list.kick_button.0"]'),
    ).toBeNull();
    // The count and 'kicked by' columns still render for the own row.
    expect(
      container.querySelector('[data-ocid="player_list.kick_count.0"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="player_list.kicked_by.0"]'),
    ).not.toBeNull();
  });

  it("shows 'KICKED!' for a target the current player voted for and withdraws on click", async () => {
    const user = userEvent.setup();
    const onWithdrawKickVote = vi.fn();
    const { container } = renderList(
      [
        makePlayer({ principal: "me", username: "Ada", team: Team.White }),
        makePlayer({ principal: "target", username: "Bob", team: Team.White }),
      ],
      {
        currentUsername: "Ada",
        kickState: makeKickState([
          {
            principal: "target",
            kickCount: 1n,
            kickedBy: ["Ada"],
          },
        ]),
        onWithdrawKickVote,
      },
    );

    const kickedButton = targetKickButton(container);
    expect(kickedButton).not.toBeNull();
    expect(kickedButton).toHaveTextContent("KICKED!");
    expect(kickedButton).toBeEnabled();
    await user.click(kickedButton as HTMLButtonElement);
    expect(onWithdrawKickVote).toHaveBeenCalledWith("target");
  });

  it("renders the 'number of kicks' count and 'kicked by' array for each player", () => {
    const { container } = renderList(
      [
        makePlayer({ principal: "me", username: "Ada", team: Team.White }),
        makePlayer({ principal: "target", username: "Bob", team: Team.White }),
      ],
      {
        currentUsername: "Ada",
        kickState: makeKickState([
          {
            principal: "target",
            kickCount: 2n,
            kickedBy: ["Ada", "Cara"],
          },
          {
            principal: "me",
            kickCount: 0n,
            kickedBy: [],
          },
        ]),
      },
    );

    // The target's count (2) and 'kicked by' array (Ada, Cara) render.
    expect(targetKickCount(container)).toHaveTextContent("2");
    expect(targetKickedBy(container)).toHaveTextContent("Ada, Cara");
    // The current player's empty state renders a dash for 'kicked by'.
    expect(
      container.querySelector('[data-ocid="player_list.kicked_by.0"]'),
    ).toHaveTextContent("—");
  });

  it("keeps the count equal to the length of the 'kicked by' array for every player", () => {
    // The backend derives both from the same vote records, so the invariant
    // holds by construction. This asserts the rendered count matches the
    // length of the rendered 'kicked by' array for a multi-vote target.
    const kickedBy = ["Ada", "Cara", "Dan"];
    const { container } = renderList(
      [
        makePlayer({ principal: "me", username: "Ada", team: Team.White }),
        makePlayer({ principal: "target", username: "Bob", team: Team.White }),
      ],
      {
        currentUsername: "Ada",
        kickState: makeKickState([
          {
            principal: "target",
            kickCount: BigInt(kickedBy.length),
            kickedBy,
          },
        ]),
      },
    );

    expect(targetKickCount(container)).toHaveTextContent(
      String(kickedBy.length),
    );
    expect(targetKickedBy(container)).toHaveTextContent(kickedBy.join(", "));
  });
});
