import { describe, expect, it, vi } from "vitest";

// approvePbppAllowance dynamically imports the signer modules and builds an
// actor against the ICP ledger. Mock the signer stack and the agent's
// Actor.createActor so the test captures the exact spender passed to
// icrc2_approve without opening a real OISY popup or hitting the network.
const { icrc2Approve } = vi.hoisted(() => ({
  icrc2Approve: vi.fn(),
}));

vi.mock("@icp-sdk/signer", () => ({
  Signer: class {},
}));
vi.mock("@icp-sdk/signer/web", () => ({
  PostMessageTransport: class {},
}));
vi.mock("@icp-sdk/signer/agent", () => ({
  SignerAgent: {
    create: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("@icp-sdk/core/agent", () => ({
  HttpAgent: {
    create: vi.fn().mockResolvedValue({}),
  },
  Actor: {
    createActor: vi.fn().mockReturnValue({ icrc2_approve: icrc2Approve }),
  },
}));

import {
  ICP_TRANSFER_FEE_E8S,
  PBPP_CANISTER_PRINCIPAL,
  approvePbppAllowance,
  openApproveSignerSync,
  preloadSigner,
} from "@/lib/pbpp";
import { Principal } from "@icp-sdk/core/principal";

/**
 * Characterization of the PBPP canister principal seam.
 *
 * The request updates the PBPP backend canister principal (replacing the old
 * value with a new one). The principal lives in the single configurable
 * `PBPP_CANISTER_PRINCIPAL` constant in lib/pbpp.ts, and the ICRC-2 approval
 * flow always targets that constant as the `spender` — never a hard-coded
 * address. These tests protect the seam that must remain unchanged across the
 * value change: the constant is a valid principal, and the approval flow
 * passes it verbatim as the spender so re-targeting the approval is a one-line
 * edit in the constant.
 */
describe("PBPP canister principal seam", () => {
  it("exposes a valid principal as the configurable PBPP canister constant", () => {
    // The constant must always be a parseable principal so the approval flow
    // can construct the spender account from it.
    expect(() => Principal.fromText(PBPP_CANISTER_PRINCIPAL)).not.toThrow();
    expect(PBPP_CANISTER_PRINCIPAL.length).toBeGreaterThan(0);
  });

  it("targets the JEL escrow canister principal oqybv-uyaaa-aaaac-bf5oq-cai", () => {
    // The real-bet relay and the ICRC-2 approval both target the JEL escrow
    // canister. The frontend's configurable constant must hold that exact
    // principal so the approval authorizes JEL as spender and the relayed bet
    // reaches the escrow. This pins the accepted relay target that must not
    // drift.
    expect(PBPP_CANISTER_PRINCIPAL).toBe("oqybv-uyaaa-aaaac-bf5oq-cai");
  });

  it("targets the configured PBPP principal as the spender in the ICRC-2 approval", async () => {
    icrc2Approve.mockResolvedValue({ Ok: 42n });

    // The approval flow now opens the signer synchronously inside the click
    // handler (via openApproveSignerSync) and passes the already-open signer
    // instance to approvePbppAllowance. Preload the mocked signer modules so
    // the synchronous open succeeds, then open the signer and approve.
    await preloadSigner();
    const signer = openApproveSignerSync();

    const outcome = await approvePbppAllowance(
      signer,
      { owner: "aaaaa-aa", subaccount: null },
      10n,
    );

    expect(outcome).toEqual({ ok: 42n });
    expect(icrc2Approve).toHaveBeenCalledTimes(1);
    const args = icrc2Approve.mock.calls[0][0];
    // The spender is the configured PBPP principal — the approval always
    // targets whatever the constant holds, so a value change re-targets every
    // approval without touching the flow.
    expect(args.spender.owner.toText()).toBe(PBPP_CANISTER_PRINCIPAL);
    expect(args.spender.subaccount).toEqual([]);
    // The allowance covers the plain stake PLUS the ICP transfer fee so JEL
    // can pull the full bet and still cover the ledger fee. The caller passes
    // the plain stake (10n); approvePbppAllowance adds the fee internally.
    expect(args.amount).toBe(10n + ICP_TRANSFER_FEE_E8S);
  });

  it("derives the ICRC-2 spender from the exported constant, never a hard-coded address", async () => {
    // The escrow canister principal is intentionally changing (the old value
    // is being replaced). The invariant that must survive that repoint is that
    // the approval flow derives its spender from the single exported
    // `PBPP_CANISTER_PRINCIPAL` constant — never from a hard-coded address
    // embedded in the flow. This pins the seam value-agnostically so a repoint
    // re-targets every approval without touching the flow.
    icrc2Approve.mockResolvedValue({ Ok: 42n });
    icrc2Approve.mockClear();

    await preloadSigner();
    const signer = openApproveSignerSync();

    await approvePbppAllowance(
      signer,
      { owner: "aaaaa-aa", subaccount: null },
      10n,
    );

    const args = icrc2Approve.mock.calls[0][0];
    // The spender is exactly the exported constant — the single source of
    // truth for the escrow target.
    expect(args.spender.owner.toText()).toBe(PBPP_CANISTER_PRINCIPAL);
    // The spender subaccount is the default (null), as the escrow pulls from
    // the player's default account.
    expect(args.spender.subaccount).toEqual([]);
  });

  it("approves bet + fee in e8s for a 1 ICP bet (100_010_000 e8s)", async () => {
    // The investigation confirms every natural number in the bet path is
    // expressed in e8s. For a 1 ICP bet the stake is 100_000_000 e8s and the
    // ICRC-2 approval allowance must cover the stake PLUS the 10_000 e8s
    // transfer fee = 100_010_000 e8s. This pins the exact allowance value so
    // an e8s-unit regression in the approval path fails here.
    icrc2Approve.mockResolvedValue({ Ok: 42n });
    // Clear any calls recorded by earlier tests so `calls[0]` is this test's
    // own approval call.
    icrc2Approve.mockClear();

    await preloadSigner();
    const signer = openApproveSignerSync();

    const outcome = await approvePbppAllowance(
      signer,
      { owner: "aaaaa-aa", subaccount: null },
      100_000_000n, // 1 ICP stake in e8s
    );

    expect(outcome).toEqual({ ok: 42n });
    const args = icrc2Approve.mock.calls[0][0];
    // The allowance is the plain stake plus the fee, both in e8s.
    expect(args.amount).toBe(100_010_000n);
  });
});
