/**
 * Pure helpers for the EndGameModal mint-status indication.
 *
 * The backend records one `MintAttempt` per player per concluded game
 * (lib/nft.mo). Each attempt carries a `MintOutcome` union:
 *
 *   - `{ __kind__: "succeeded"; succeeded: { tokenId } }`
 *   - `{ __kind__: "skipped"; skipped: <reason> }`
 *   - `{ __kind__: "failed"; failed: <reason> }`
 *
 * The `skipped` / `failed` payloads are free-form reason strings produced by
 * the backend. This module maps each variant (and the known reason strings)
 * to plain-language text with an EXPLICIT variant-to-text mapper — never a
 * `typeof` probe — so the UI stays correct if the union gains a variant.
 *
 * The helpers are pure (no React, no JSX) so the modal file stays small and
 * the mapping is trivial to reason about and test.
 */

import type { MintAttempt, MintAttemptGroup, MintOutcome } from "../backend";

/** Visual tone for a mint-status row. */
export type MintStatusTone = "success" | "skip" | "failure";

/** A single player's mint result, already mapped to display text. */
export interface MintStatusRow {
  /** Stable key for React lists (attempt id). */
  id: string;
  /** The player's username, or a fallback when the backend left it empty. */
  username: string;
  /** Plain-language reason, e.g. "Minted successfully — token #12". */
  reason: string;
  /** Tone drives the row's color treatment. */
  tone: MintStatusTone;
}

/** Aggregate summary shown above the per-player rows. */
export interface MintStatusSummary {
  /** Total attempts recorded for the game. */
  total: number;
  /** Count of successful mints. */
  minted: number;
  /** Count of skipped attempts. */
  skipped: number;
  /** Count of failed attempts. */
  failed: number;
}

/* ------------------------------------------------------------------ */
/* Outcome -> text mapping                                             */
/* ------------------------------------------------------------------ */

/**
 * Map a backend `MintOutcome` to a plain-language reason + tone.
 *
 * The variant is discriminated on `__kind__` (an explicit switch over the
 * union), NOT a `typeof` probe. The reason strings are matched against the
 * exact literals the backend emits (lib/nft.mo) so the five required
 * outcomes render distinctly:
 *
 *   - succeeded                          -> "Minted successfully — token #N"
 *   - skipped "stale heartbeat at game conclusion"
 *                                        -> "Skipped — heartbeat was stale at game conclusion"
 *   - skipped "no wallet address supplied"
 *                                        -> "Skipped — no wallet address"
 *   - failed  "hex account IDs are not supported for minting; ..."
 *                                        -> "Failed — wallet address is a hex account ID, not a principal"
 *   - failed  "mint canister call trapped: <real trap text>"
 *                                        -> "Failed — the mint call errored: <real trap text>"
 *   - failed  other                      -> "Failed — <reason>"
 */
export function describeMintOutcome(outcome: MintOutcome): {
  reason: string;
  tone: MintStatusTone;
} {
  switch (outcome.__kind__) {
    case "succeeded":
      return {
        reason: `Minted successfully — token #${outcome.succeeded.tokenId.toString()}`,
        tone: "success",
      };
    case "skipped":
      return { reason: describeSkipReason(outcome.skipped), tone: "skip" };
    case "failed":
      return { reason: describeFailureReason(outcome.failed), tone: "failure" };
  }
}

/** Map a backend skip reason string to plain language. */
function describeSkipReason(reason: string): string {
  if (reason.includes("stale heartbeat")) {
    return "Skipped — heartbeat was stale at game conclusion";
  }
  if (reason.includes("no wallet address")) {
    return "Skipped — no wallet address";
  }
  // Unknown skip reason: surface the backend text rather than hiding it.
  return reason.trim() === "" ? "Skipped" : `Skipped — ${reason}`;
}

/** Map a backend failure reason string to plain language. */
function describeFailureReason(reason: string): string {
  if (reason.includes("hex account")) {
    return "Failed — wallet address is a hex account ID, not a principal";
  }
  if (
    reason.includes("mint canister call") ||
    reason.includes("mint trapped")
  ) {
    // The backend records the real caught error after a stable prefix
    // ("mint canister call trapped: " # e.message()). Surface that real trap
    // text instead of collapsing it to a generic message, so the error box
    // shows what actually failed. A bare prefix with no trailing text keeps
    // the generic message.
    const marker = "trapped:";
    const markerIndex = reason.indexOf(marker);
    const trapText =
      markerIndex === -1
        ? ""
        : reason.slice(markerIndex + marker.length).trim();
    return trapText === ""
      ? "Failed — the mint call errored"
      : `Failed — the mint call errored: ${trapText}`;
  }
  if (reason.includes("parse failed")) {
    return "Failed — wallet address could not be parsed";
  }
  // Unknown failure reason: surface the backend text rather than hiding it.
  return reason.trim() === "" ? "Failed" : `Failed — ${reason}`;
}

/* ------------------------------------------------------------------ */
/* Attempt -> row mapping                                              */
/* ------------------------------------------------------------------ */

/**
 * Map one backend `MintAttempt` to a display row. The username falls back to
 * a neutral label when the backend recorded an empty one (whole-pass failure
 * attempts carry an empty username).
 */
export function toMintStatusRow(attempt: MintAttempt): MintStatusRow {
  const { reason, tone } = describeMintOutcome(attempt.outcome);
  const username =
    attempt.recipientUsername.trim() === ""
      ? "Game-wide mint pass"
      : attempt.recipientUsername;
  return {
    id: attempt.id.toString(),
    username,
    reason,
    tone,
  };
}

/**
 * Select the attempt group for the given game number from the backend's
 * `getMintAttemptsByGame()` result (most recent game first). The caller passes
 * the CONCLUDED game's number (the game that just ended), not the live
 * post-increment counter, so the selected attempts are the ones stamped for
 * that concluded game. Returns an empty array when the game number is null or
 * no group matches — the caller renders the "no attempts" summary state in
 * that case.
 */
export function selectAttemptsForGame(
  groups: MintAttemptGroup[] | undefined,
  gameNumber: bigint | null,
): MintAttempt[] {
  if (!groups || gameNumber === null) return [];
  const group = groups.find((g) => g.gameNumber === gameNumber);
  return group?.attempts ?? [];
}

/** Build the aggregate summary for a set of attempts. */
export function summarizeMintAttempts(
  attempts: MintAttempt[],
): MintStatusSummary {
  let minted = 0;
  let skipped = 0;
  let failed = 0;
  for (const attempt of attempts) {
    switch (attempt.outcome.__kind__) {
      case "succeeded":
        minted += 1;
        break;
      case "skipped":
        skipped += 1;
        break;
      case "failed":
        failed += 1;
        break;
    }
  }
  return { total: attempts.length, minted, skipped, failed };
}
