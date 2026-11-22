import { describe, expect, it } from "vitest";

import { formatAddressError, isValidOisyAddress } from "@/lib/wallet-address";

// A 64-character hex account ID — the format the request explicitly stops
// accepting. The backend mints NFTs to an ICRC-7 account owner principal, so a
// hex account ID cannot be used for minting.
const HEX_ACCOUNT_ID = "a".repeat(64);

/**
 * Cover for the wallet-address validation seam.
 *
 * The request narrows the accepted formats to exactly two: an empty value
 * (the field is optional) or a valid principal textual address. 64-character
 * hex account IDs are rejected, and the error message matches the
 * principal-only rule.
 *
 * This is the pure-function seam the login route consumes; the route-level
 * integration is covered in login-wallet-address.test.tsx.
 */
describe("wallet-address validation", () => {
  it("accepts an empty value (the field is optional)", () => {
    expect(isValidOisyAddress("")).toBe(true);
    expect(isValidOisyAddress("   ")).toBe(true);
    expect(formatAddressError("")).toBeNull();
  });

  it("accepts a valid principal textual address", () => {
    expect(isValidOisyAddress("aaaaa-aa")).toBe(true);
    expect(isValidOisyAddress("abcde-fghij-klmno-pqrst-uvwxy-z")).toBe(true);
    expect(formatAddressError("aaaaa-aa")).toBeNull();
  });

  it("rejects a 64-character hex account ID", () => {
    expect(isValidOisyAddress(HEX_ACCOUNT_ID)).toBe(false);
    expect(formatAddressError(HEX_ACCOUNT_ID)).toBe(
      "Enter a valid principal address",
    );
  });

  it("rejects other malformed values with the principal-only message", () => {
    for (const value of ["not-a-valid-address", "abc", "has spaces"]) {
      expect(isValidOisyAddress(value)).toBe(false);
      expect(formatAddressError(value)).toBe("Enter a valid principal address");
    }
  });
});
