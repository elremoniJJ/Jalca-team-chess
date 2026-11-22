/**
 * Pure validation helpers for the optional ICRC-7 NFT wallet address field on
 * the login page. The field accepts exactly one ICP address form:
 *
 *   Principal — dash-separated base32-ish segments, e.g.
 *     `abcde-fghij-klmno-pqrst-uvwxy-z`. The canonical textual principal
 *     is a sequence of 5-char groups separated by `-`, optionally ending
 *     with a shorter (1-5 char) group. We match permissively so future
 *     principal encodings are not rejected.
 *
 * 64-character hex account IDs are NOT accepted: the backend mints NFTs to
 * an ICRC-7 account owner principal (principal + null subaccount), so a hex
 * account ID cannot be used for minting.
 *
 * The field is OPTIONAL: an empty string is always valid. Callers should
 * only block submit on a non-empty but malformed value.
 */

// Principal: one or more 5-char groups separated by `-`, with an optional
// trailing shorter (1-5 char) group. Case-insensitive to tolerate pasted
// principals in either casing.
const PRINCIPAL_RE = /^[a-z0-9]{5}(-[a-z0-9]{5})*(-[a-z0-9]{1,5})?$/i;

/**
 * Returns true for the empty string (optional field) and for any value
 * matching the principal textual format. Returns false for any other
 * non-empty input, including 64-character hex account IDs.
 */
export function isValidOisyAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  return PRINCIPAL_RE.test(trimmed);
}

/**
 * Returns null when the value is valid (empty or a well-formed principal),
 * or a short user-facing hint when the value is non-empty and malformed.
 */
export function formatAddressError(value: string): string | null {
  if (isValidOisyAddress(value)) return null;
  return "Enter a valid principal address";
}
