import { describe, expect, it } from "vitest";

import { RecipientRole, Team } from "@/backend";
import type { MintAttempt, MintAttemptGroup, MintOutcome } from "@/backend";
import {
  describeMintOutcome,
  selectAttemptsForGame,
  summarizeMintAttempts,
  toMintStatusRow,
} from "@/components/mint-status-helpers";

/**
 * Characterization taken BEFORE the token-id collision-retry change.
 *
 * The request changes the BACKEND game-end mint path: the requested token id
 * is derived from the collection canister's authoritative state, a mint that
 * the collection rejects with an already-existing token id retries with the
 * next candidate id, and the local counter is no longer sent as the requested
 * id. The frontend is intentionally unchanged by that fix.
 *
 * This file protects the frontend behavior ADJACENT to the change that must
 * survive it: the pure outcome -> display-text contract in
 * `components/mint-status-helpers.ts`. The backend records one `MintAttempt`
 * per player per concluded game, and the game conclusion modal renders each
 * attempt through these helpers. The fix must not change how any outcome
 * renders:
 *
 *   - a mint that succeeds (including one that succeeds after one or more
 *     collision retries) is a `succeeded` outcome and must render as
 *     "Minted successfully — token #<canister-returned id>";
 *   - the skip reasons (no wallet / stale heartbeat) must render unchanged;
 *   - the failure reasons (hex account id / mint call error / parse failure)
 *     must render unchanged;
 *   - the aggregate summary must keep counting each variant distinctly.
 *
 * The helpers are pure (no React, no actor, no network), so this is a
 * deterministic unit characterization of the consumer seam the fix feeds.
 * The backend mint path itself is NOT exercised here — the external ICRC-7
 * collection canister is absent from the PocketIC replica, so the real mint
 * cannot run in this dispatch. See episode.coverageLimits.
 */

/** Build a MintOutcome fixture for each variant. */
function succeeded(tokenId: bigint): MintOutcome {
  return { __kind__: "succeeded", succeeded: { tokenId } };
}
function skipped(reason: string): MintOutcome {
  return { __kind__: "skipped", skipped: reason };
}
function failed(reason: string): MintOutcome {
  return { __kind__: "failed", failed: reason };
}

/** Build a MintAttempt fixture with the given outcome. */
function makeAttempt(
  id: bigint,
  username: string,
  outcome: MintOutcome,
): MintAttempt {
  return {
    id,
    gameNumber: 7n,
    recipientWalletAddress: "aaaaa-aa",
    recipientUsername: username,
    recipientTeam: Team.White,
    recipientRole: RecipientRole.Winner,
    outcome,
    attemptedAt: 1_000_000_000n,
  };
}

describe("describeMintOutcome — outcome to plain-language mapping", () => {
  it("renders a succeeded outcome with the canister-returned token id", () => {
    // The fix reports a mint that succeeded after collision retries as
    // `succeeded` carrying the canister-returned token id. That outcome must
    // render as a success with that exact id — not as a failure.
    const { reason, tone } = describeMintOutcome(succeeded(42n));
    expect(reason).toBe("Minted successfully — token #42");
    expect(tone).toBe("success");
  });

  it("renders a succeeded outcome with a large token id verbatim", () => {
    // Token ids are Nat (bigint); the rendered text must not truncate or
    // reformat a large id.
    const { reason } = describeMintOutcome(succeeded(123456789012345n));
    expect(reason).toBe("Minted successfully — token #123456789012345");
  });

  it("renders the no-wallet skip reason", () => {
    const { reason, tone } = describeMintOutcome(
      skipped("no wallet address supplied"),
    );
    expect(reason).toBe("Skipped — no wallet address");
    expect(tone).toBe("skip");
  });

  it("renders the stale-heartbeat skip reason", () => {
    const { reason, tone } = describeMintOutcome(
      skipped("stale heartbeat at game conclusion"),
    );
    expect(reason).toBe("Skipped — heartbeat was stale at game conclusion");
    expect(tone).toBe("skip");
  });

  it("renders the hex-account-id failure reason", () => {
    const { reason, tone } = describeMintOutcome(
      failed(
        "hex account IDs are not supported for minting; please use your principal textual address",
      ),
    );
    expect(reason).toBe(
      "Failed — wallet address is a hex account ID, not a principal",
    );
    expect(tone).toBe("failure");
  });

  it("renders the mint-call-error failure reason", () => {
    const { reason, tone } = describeMintOutcome(
      failed("mint canister call trapped"),
    );
    expect(reason).toBe("Failed — the mint call errored");
    expect(tone).toBe("failure");
  });

  it("renders the wallet-parse failure reason", () => {
    const { reason, tone } = describeMintOutcome(
      failed("wallet address parse failed"),
    );
    expect(reason).toBe("Failed — wallet address could not be parsed");
    expect(tone).toBe("failure");
  });

  it("surfaces an unknown skip reason rather than hiding it", () => {
    const { reason, tone } = describeMintOutcome(skipped("some new reason"));
    expect(reason).toBe("Skipped — some new reason");
    expect(tone).toBe("skip");
  });

  it("surfaces an unknown failure reason rather than hiding it", () => {
    const { reason, tone } = describeMintOutcome(failed("some new failure"));
    expect(reason).toBe("Failed — some new failure");
    expect(tone).toBe("failure");
  });
});

describe("toMintStatusRow — attempt to display row", () => {
  it("maps a succeeded attempt to a success row with the token id", () => {
    const row = toMintStatusRow(makeAttempt(3n, "Ada", succeeded(12n)));
    expect(row).toEqual({
      id: "3",
      username: "Ada",
      reason: "Minted successfully — token #12",
      tone: "success",
    });
  });

  it("falls back to a neutral label for a whole-pass attempt with no username", () => {
    const row = toMintStatusRow(
      makeAttempt(0n, "", failed("mint pass failed")),
    );
    expect(row.username).toBe("Game-wide mint pass");
    expect(row.reason).toBe("Failed — mint pass failed");
    expect(row.tone).toBe("failure");
  });
});

describe("summarizeMintAttempts — aggregate counts", () => {
  it("counts each outcome variant distinctly", () => {
    const attempts: MintAttempt[] = [
      makeAttempt(0n, "Ada", succeeded(12n)),
      makeAttempt(1n, "Grace", skipped("stale heartbeat at game conclusion")),
      makeAttempt(2n, "Bob", skipped("no wallet address supplied")),
      makeAttempt(3n, "Cara", failed("hex account ids are not supported")),
      makeAttempt(4n, "Dan", failed("mint canister call trapped")),
    ];
    expect(summarizeMintAttempts(attempts)).toEqual({
      total: 5,
      minted: 1,
      skipped: 2,
      failed: 2,
    });
  });

  it("returns zeroed counts for an empty attempt list", () => {
    expect(summarizeMintAttempts([])).toEqual({
      total: 0,
      minted: 0,
      skipped: 0,
      failed: 0,
    });
  });
});

describe("selectAttemptsForGame — current-game selection", () => {
  it("selects the group matching the modal's game number", () => {
    const groups: MintAttemptGroup[] = [
      {
        gameNumber: 8n,
        attempts: [
          makeAttempt(1n, "Grace", failed("mint canister call trapped")),
        ],
      },
      {
        gameNumber: 7n,
        attempts: [makeAttempt(0n, "Ada", succeeded(12n))],
      },
    ];
    const selected = selectAttemptsForGame(groups, 7n);
    expect(selected).toHaveLength(1);
    expect(selected[0].recipientUsername).toBe("Ada");
  });

  it("returns an empty list when no group matches the game number", () => {
    const groups: MintAttemptGroup[] = [
      { gameNumber: 6n, attempts: [makeAttempt(0n, "Ada", succeeded(3n))] },
    ];
    expect(selectAttemptsForGame(groups, 7n)).toEqual([]);
  });

  it("returns an empty list when the game number is null or groups are absent", () => {
    expect(selectAttemptsForGame(undefined, 7n)).toEqual([]);
    expect(selectAttemptsForGame([], null)).toEqual([]);
  });
});
