module {
  // The single named ledger-fee constant used everywhere a ledger fee is
  // needed. 10_000 e8s (0.0001 ICP) is the ICP ledger's standard transfer fee.
  //
  // This is the one place to read the fee from. When the fee becomes available
  // from the ledger at runtime (for example via the ledger's `icrc1_fee`
  // query), replace this constant with that read here and every caller picks
  // it up unchanged.
  public let ledgerFeeE8s : Nat = 10_000;
};
