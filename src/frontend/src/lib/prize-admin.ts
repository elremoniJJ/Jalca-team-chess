import { Principal } from "@icp-sdk/core/principal";
import { useActorState } from "./backend-actor";

/**
 * prize-admin — the frontend mirror of the hardcoded compile-time admin
 * principal, plus the provider-tolerant signed-in-principal read the
 * Leaderboard window uses for its admin and "My prize" gates.
 *
 * The backend is the security boundary: it rejects any caller other than the
 * admin principal on admin-only operations. This module exists ONLY so the
 * Leaderboard window can decide whether to render the admin panel at all — it
 * is a display gate, never an authorization check. A caller who forges this
 * value in the browser still cannot read or mutate anything the backend does
 * not already permit them.
 *
 * The literal matches the backend's compile-time admin principal exactly
 * (see the backend prize API). It is also the same principal the Story window
 * uses for its writer gate, so the two admin surfaces agree.
 */

/** The hardcoded admin principal, mirrored from the backend. */
export const ADMIN_PRINCIPAL =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae";

/**
 * Whether the given signed-in principal text is the admin principal. Returns
 * false for null/undefined (signed out) and for any other principal. This is a
 * pure string comparison — it never contacts the backend.
 */
export function isAdminPrincipal(
  principalText: string | null | undefined,
): boolean {
  return principalText === ADMIN_PRINCIPAL;
}

/**
 * The signed-in caller's principal text, or null when signed out.
 *
 * Reads through the shared `@/lib/backend-actor` seam rather than the
 * Internet Identity hook directly, so a component rendered without the
 * Internet Identity provider (for example the Leaderboard window in its
 * characterization tests) degrades to signed-out instead of throwing
 * "InternetIdentityProvider is not present". A test double that omits the
 * `principal` field also degrades to null.
 */
export function useSignedInPrincipal(): string | null {
  const { principal } = useActorState();
  return principal ?? null;
}

/* --- ICP amount parsing ------------------------------------------------- */

/** ICP has 8 decimals — 1 ICP = 100,000,000 e8s. */
const E8S_PER_ICP = 100_000_000n;

/**
 * Parse a user-typed ICP amount into whole e8s with NO floating-point
 * rounding. The input is a decimal string such as "12", "12.5" or "0.00000001";
 * it is split on the decimal point and the fractional part is padded or
 * truncated to exactly 8 digits, so the result is exact integer arithmetic.
 *
 * Returns null when the input is not a valid non-negative decimal amount with
 * at most 8 fractional digits (empty, negative, non-numeric, or too many
 * decimals). A trailing/leading-dot form such as ".5" or "5." is accepted.
 */
export function parseIcpToE8s(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const [wholePart = "", fracPart = ""] = trimmed.split(".");
  if (wholePart === "" && fracPart === "") return null;
  if (fracPart.length > 8) return null;
  const whole = wholePart === "" ? 0n : BigInt(wholePart);
  const frac = fracPart === "" ? 0n : BigInt(fracPart.padEnd(8, "0"));
  return whole * E8S_PER_ICP + frac;
}

/**
 * Format an e8s amount (8 decimals) as a readable ICP string, e.g.
 * 145_050_000_000n -> "1,450.5 ICP". Trailing zeros in the fractional part
 * are trimmed so a whole amount reads as "2 ICP". Mirrors the window's own
 * formatter so the admin preview and the player view agree.
 */
export function formatIcp(e8s: bigint): string {
  const whole = e8s / E8S_PER_ICP;
  const frac = e8s % E8S_PER_ICP;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  const wholeStr = whole.toLocaleString();
  return fracStr ? `${wholeStr}.${fracStr} ICP` : `${wholeStr} ICP`;
}

/* --- ICP recipient principal validation --------------------------------- */

/**
 * The result of validating a user-typed ICP recipient address. `ok` carries the
 * parsed principal; `error` carries the player-facing reason the address cannot
 * be paid.
 */
export type RecipientValidation =
  | { ok: true; principal: Principal }
  | { ok: false; error: string };

/**
 * The number of bytes in a canister principal. The Internet Computer reserves
 * the 10-byte principal length for canister IDs; a self-authenticating user
 * principal is 29 bytes and the anonymous principal is 1 byte. The prize
 * canister pays principals only and cannot pay a canister, so a 10-byte
 * principal is rejected locally before the claim is sent.
 */
const CANISTER_PRINCIPAL_BYTES = 10;

/**
 * Validate a user-typed ICP recipient address locally, before any backend call.
 *
 * The address must be a well-formed principal (a malformed string throws in
 * `Principal.fromText`), must not be the anonymous principal, and must not be a
 * canister principal. An exchange deposit address or a 64-character account ID
 * is not a principal and is rejected as malformed. This is a local guard only:
 * the backend remains the security boundary and re-checks ownership.
 */
export function validateRecipientPrincipal(text: string): RecipientValidation {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter the ICP principal to pay." };
  }
  let principal: Principal;
  try {
    principal = Principal.fromText(trimmed);
  } catch {
    return {
      ok: false,
      error:
        "That is not a valid principal. An exchange deposit address or a 64-character account ID will not work.",
    };
  }
  if (principal.isAnonymous()) {
    return {
      ok: false,
      error: "The anonymous principal cannot receive a prize.",
    };
  }
  if (principal.toUint8Array().length === CANISTER_PRINCIPAL_BYTES) {
    return {
      ok: false,
      error:
        "That is a canister principal. Enter your own ICP wallet principal.",
    };
  }
  return { ok: true, principal };
}
