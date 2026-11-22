import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

import { Team, WalletSource } from "@/backend";
import type { PlayerInfo } from "@/backend";
import { PlayerList } from "@/components/PlayerList";

/**
 * Characterization of the Players window roster rendering.
 *
 * The request adds a 'kick?' button beside the NFTs in the players list so
 * wallet-connected players can vote to kick a teammate. That change touches
 * the PlayerList component, so the roster's core rendering must remain
 * stable. Protected here:
 *   - players are grouped into their team columns (White / Black) with the
 *     correct per-team header counts;
 *   - the current player is marked with the "you" indicator;
 *   - the Move_Maker is marked with the crown indicator and "to move";
 *   - stale players (isFresh === false) are filtered out of the roster;
 *   - the empty state ("Waiting for players to join...") renders when no
 *     fresh players are present.
 *
 * The kick button itself is intentionally NOT asserted: the request adds it.
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

function renderList(players: PlayerInfo[], currentPrincipal = "me") {
  return render(
    <PlayerList players={players} currentPrincipal={currentPrincipal} />,
  );
}

describe("PlayerList roster rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("groups players into their team columns with correct header counts", () => {
    renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
      makePlayer({ principal: "w2", username: "Bob", team: Team.White }),
      makePlayer({ principal: "b1", username: "Cara", team: Team.Black }),
    ]);

    // Header counts: 2 White, 1 Black.
    expect(screen.getByText("2W / 1B")).toBeInTheDocument();

    // Each player appears in the roster.
    expect(screen.getByRole("button", { name: /Ada/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bob/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cara/ })).toBeInTheDocument();
  });

  it("marks the current player with the 'you' indicator", () => {
    renderList(
      [
        makePlayer({ principal: "me", username: "Ada", team: Team.White }),
        makePlayer({ principal: "other", username: "Bob", team: Team.White }),
      ],
      "me",
    );

    const adaRow = screen.getByRole("button", { name: /Ada/ });
    expect(adaRow).toHaveTextContent("you");
    const bobRow = screen.getByRole("button", { name: /Bob/ });
    expect(bobRow).not.toHaveTextContent("you");
  });

  it("marks the Move_Maker with the crown and 'to move' indicator", () => {
    renderList([
      makePlayer({
        principal: "maker",
        username: "Ada",
        team: Team.White,
        isMoveMaker: true,
      }),
      makePlayer({ principal: "other", username: "Bob", team: Team.White }),
    ]);

    const makerRow = screen.getByRole("button", { name: /Ada/ });
    expect(makerRow).toHaveTextContent("to move");
    const otherRow = screen.getByRole("button", { name: /Bob/ });
    expect(otherRow).not.toHaveTextContent("to move");
  });

  it("filters stale players (isFresh === false) out of the roster", () => {
    renderList([
      makePlayer({ principal: "fresh", username: "Ada", team: Team.White }),
      makePlayer({
        principal: "stale",
        username: "Bob",
        team: Team.White,
        isFresh: false,
      }),
    ]);

    expect(screen.getByRole("button", { name: /Ada/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Bob/ }),
    ).not.toBeInTheDocument();
    // The stale player is not counted in the header either.
    expect(screen.getByText("1W / 0B")).toBeInTheDocument();
  });

  it("renders the empty state when no fresh players are present", () => {
    renderList([
      makePlayer({
        principal: "stale",
        username: "Bob",
        team: Team.White,
        isFresh: false,
      }),
    ]);

    expect(
      screen.getByText("Waiting for players to join..."),
    ).toBeInTheDocument();
  });

  // The accepted window rework adds an optional `embedded` prop that skips the
  // header and always shows the body. Absent, the component must behave exactly
  // as today: the "Players" header renders and the roster body is present.
  it("renders the Players header and roster body when embedded is absent", () => {
    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
    ]);

    // The header heading is present (not skipped).
    expect(screen.getByText("Players")).toBeInTheDocument();
    // The roster body is mounted.
    expect(
      container.querySelector('[data-ocid="player_list.list"]'),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: /Ada/ })).toBeInTheDocument();
  });

  // The accepted presence change marks a player inactive after ~90s without a
  // ping: they STAY in the roster (unlike a stale player) but are excluded
  // from Move_Maker selection. The roster must show the inactive badge for
  // such a player and keep them counted, while an active player shows no badge.
  it("shows the inactive badge for an inactive player and keeps them in the roster", () => {
    renderList([
      makePlayer({
        principal: "inactive",
        username: "Ada",
        team: Team.White,
        isInactive: true,
      }),
      makePlayer({ principal: "active", username: "Bob", team: Team.White }),
    ]);

    // The inactive player is still rendered and counted (not filtered out).
    expect(screen.getByRole("button", { name: /Ada/ })).toBeInTheDocument();
    expect(screen.getByText("2W / 0B")).toBeInTheDocument();

    // The inactive badge is present for the inactive player only.
    expect(screen.getByText("inactive")).toBeInTheDocument();
    const adaRow = screen.getByRole("button", { name: /Ada/ });
    expect(adaRow).toHaveTextContent("inactive");
    const bobRow = screen.getByRole("button", { name: /Bob/ });
    expect(bobRow).not.toHaveTextContent("inactive");
  });
});
