import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the frontend BURN-AND-PLAY consumer seam.
 *
 * The request repoints the burn path from the old `burnNft` + `recordBurn`
 * sequence to a single backend `burnAndPlay(principal, request)` call that
 * performs the burn AND applies the shield math AND records the burn-and-play
 * result. This file pins the frontend contract that must hold across that
 * change:
 *   - `burnOne(nft)` calls the generated backend binding `burnAndPlay` with the
 *     signed-in principal and a request carrying the token id, spell name, game
 *     number, and the resolved `SpellKind`;
 *   - the `SpellKind` is resolved from the static spell table (Subao Ve →
 *     SubaoVe, a Major spell → Major, anything else → Minor);
 *   - a legacy NFT (no game number) is still burnable: `gameNumber` is omitted
 *     from the request and the burn succeeds;
 *   - an `#err` result surfaces a per-token error carrying the backend reason;
 *   - a successful burn removes the token from the owned list.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the hook's call contract — not real backend behavior. The real
 * backend burn-and-play path is exercised by the PocketIC lane.
 */

const { burnAndPlay, getSpellTable } = vi.hoisted(() => ({
  burnAndPlay: vi.fn(),
  getSpellTable: vi.fn(),
}));

const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 1n,
      complexity: { Moderate: null },
      nftEligible: true,
      meaning: "Defensive shield",
      name: "Subao Ve",
      spell: "block",
      category: { Block: null },
      dropChance: 1n,
    },
    minor: [
      {
        id: 2n,
        complexity: { Easy: null },
        nftEligible: true,
        meaning: "Attacking",
        name: "Minor Spell",
        spell: "minor",
        category: { Minor: null },
        dropChance: 1n,
      },
    ],
    major: [
      {
        id: 3n,
        complexity: { Complex: null },
        nftEligible: true,
        meaning: "Attacking",
        name: "Major Spell",
        spell: "major",
        category: { Major: null },
        dropChance: 1n,
      },
    ],
  },
}));

vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({
    burnAndPlay,
    getSpellTable,
  }),
  useActorState: () => ({
    actor: { getSpellTable },
    isLoading: false,
    error: null,
  }),
}));

// The hook imports enum values from @/backend at runtime; mock the module so
// the fixture can use them without pulling in the unresolvable dependency
// chain.
vi.mock("@/backend", () => ({
  BurnedSpellCategory: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  SpellKind: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  LegacyReason: {
    keysAbsent: "keysAbsent",
    wrongType: "wrongType",
    keysDisagree: "keysDisagree",
    readFailed: "readFailed",
  },
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The hook's mount effect probes the signer library and preloads its modules;
// mock the whole module so no real popup is opened.
vi.mock("@/oisy-burn/oisy-signer", () => ({
  openOisySignerSync: vi.fn(),
  getOisyAccounts: vi.fn(),
  fetchOwnedNfts: vi.fn().mockResolvedValue([]),
  isSignerAvailable: vi.fn().mockReturnValue(true),
  preloadSigner: vi.fn().mockResolvedValue(true),
}));

vi.mock("@icp-sdk/signer", () => ({ __esModule: true, default: {} }));

// The hook consumes useGameState (Move_Maker principal + move list) and
// useBurnState (one-burn-per-turn flag). Mock them so the burn gate is open:
// the signed-in player is the Move_Maker and no burn has happened this turn.
vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: { moveMaker: "player-1", turn: "White" },
    isLoading: false,
    error: null,
    moves: [
      {
        from: 12,
        to: 28,
        color: "White",
        piece: "Pawn",
        captured: null,
        capturedSquare: null,
        promotion: null,
        castle: false,
        isEnPassant: false,
      },
    ],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  }),
}));
vi.mock("@/hooks/use-burn-state", () => ({
  useBurnState: () => ({
    data: { burnOccurredThisTurn: false },
    isLoading: false,
    error: null,
  }),
}));

import { SpellKind, Team } from "@/backend";
import type { BurnAndPlayResult2 } from "@/backend";
import type { OisyNft } from "@/oisy-burn/types";
import { useOisyBurn } from "@/oisy-burn/use-oisy-burn";

function makeNft(overrides: Partial<OisyNft> = {}): OisyNft {
  return {
    id: 42n,
    name: "JALCA Game NFT #42",
    thumbnailUrl: null,
    gameNumber: 7n,
    spellName: "Minor Spell",
    ...overrides,
  };
}

function BurnHarness({ nft }: { nft: OisyNft }) {
  const oisy = useOisyBurn("player-1", true);
  return (
    <div>
      <button type="button" onClick={() => void oisy.burnOne(nft)}>
        burn
      </button>
      <span data-testid="state">
        {oisy.tokenStates[nft.id.toString()] ?? "idle"}
      </span>
      <span data-testid="result">
        {oisy.tokenResults[nft.id.toString()]?.kind ?? "none"}
      </span>
      <span data-testid="legacy-reason">
        {(() => {
          const result = oisy.tokenResults[nft.id.toString()];
          return result?.kind === "success"
            ? (result.legacyReason ?? "none")
            : "none";
        })()}
      </span>
      <span data-testid="nft-count">{oisy.nfts.length}</span>
    </div>
  );
}

function renderHarness(nft: OisyNft) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <BurnHarness nft={nft} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

/**
 * The hook resolves a spell's kind from the static spell table, which it loads
 * through an async React Query. Wait for that query to settle before clicking
 * Burn, otherwise the hook falls back to the Minor kind and the SubaoVe/Major
 * assertions would test the fallback rather than the resolution.
 */
async function waitForSpellTable(queryClient: QueryClient) {
  await waitFor(() => {
    expect(queryClient.getQueryData(["spellTable"])).toBeDefined();
  });
}

function okResult(): BurnAndPlayResult2 {
  return {
    __kind__: "ok",
    ok: {
      burn: {
        tokenId: 42n,
        spellName: "Minor Spell",
        gameNumber: 7n,
        team: Team.White,
        kind: SpellKind.Minor,
        removedSquares: [],
        insufficientMaterial: false,
        transformedSquares: [],
      },
      shieldState: { whiteShield: 0n, blackShield: 0n },
    },
  };
}

describe("useOisyBurn burn-and-play consumer seam", () => {
  beforeEach(() => {
    burnAndPlay.mockReset();
    getSpellTable.mockResolvedValue(spellTable);
    burnAndPlay.mockResolvedValue(okResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls burnAndPlay with the principal and the resolved request", async () => {
    const { queryClient } = renderHarness(makeNft());
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(burnAndPlay).toHaveBeenCalledTimes(1);
    });
    expect(burnAndPlay).toHaveBeenCalledWith("player-1", {
      tokenId: 42n,
      spellName: "Minor Spell",
      gameNumber: 7n,
      kind: "Minor",
    });
  });

  it("resolves a Subao Ve burn to the SubaoVe kind", async () => {
    const { queryClient } = renderHarness(
      makeNft({ spellName: "Subao Ve", gameNumber: 5n }),
    );
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(burnAndPlay).toHaveBeenCalledTimes(1);
    });
    expect(burnAndPlay).toHaveBeenCalledWith(
      "player-1",
      expect.objectContaining({ spellName: "Subao Ve", kind: "SubaoVe" }),
    );
  });

  it("resolves a Major burn to the Major kind", async () => {
    const { queryClient } = renderHarness(
      makeNft({ spellName: "Major Spell", gameNumber: 9n }),
    );
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(burnAndPlay).toHaveBeenCalledTimes(1);
    });
    expect(burnAndPlay).toHaveBeenCalledWith(
      "player-1",
      expect.objectContaining({ spellName: "Major Spell", kind: "Major" }),
    );
  });

  it("burns a legacy NFT (no game number) with an omitted game number", async () => {
    const { queryClient } = renderHarness(
      makeNft({ gameNumber: null, spellName: "Minor Spell" }),
    );
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(burnAndPlay).toHaveBeenCalledTimes(1);
    });
    // A legacy NFT is still burnable; the request omits the game number so the
    // backend treats it as an inert legacy burn.
    expect(burnAndPlay).toHaveBeenCalledWith("player-1", {
      tokenId: 42n,
      spellName: "Minor Spell",
      gameNumber: undefined,
      kind: "Minor",
    });
    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("success");
    });
  });

  it("carries the backend Legacy reason into the per-token result", async () => {
    // The backend classified the burn Legacy with a specific reason; the hook
    // must translate it to the user-facing text and keep it on the per-token
    // result so it is available wherever the outcome is displayed.
    burnAndPlay.mockResolvedValue({
      __kind__: "ok",
      ok: {
        burn: {
          tokenId: 42n,
          spellName: "Minor Spell",
          gameNumber: undefined,
          team: Team.White,
          kind: SpellKind.Minor,
          legacyReason: "keysAbsent",
        },
        shieldState: { whiteShield: 0n, blackShield: 0n },
      },
    });
    const { queryClient } = renderHarness(makeNft({ gameNumber: null }));
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("success");
    });
    expect(screen.getByTestId("legacy-reason")).toHaveTextContent(
      "spell keys absent",
    );
  });

  it("leaves the Legacy reason empty for a non-legacy successful burn", async () => {
    const { queryClient } = renderHarness(makeNft());
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("success");
    });
    expect(screen.getByTestId("legacy-reason")).toHaveTextContent("none");
  });

  it("surfaces an #err result as a per-token error carrying the backend reason", async () => {
    burnAndPlay.mockResolvedValue({
      __kind__: "err",
      err: "Only the current Move_Maker can burn an NFT spell",
    });
    const { queryClient } = renderHarness(makeNft());
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("error");
    });
    expect(screen.getByTestId("result")).toHaveTextContent("error");
  });

  it("removes a successfully burned token from the owned list", async () => {
    const { queryClient } = renderHarness(makeNft());
    await waitForSpellTable(queryClient);

    // The grid starts empty (fetchOwnedNfts resolves []), so the assertion is
    // that a successful burn leaves no token behind rather than that a card
    // was removed from a populated list.
    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("success");
    });
    expect(screen.getByTestId("nft-count")).toHaveTextContent("0");
  });
});
