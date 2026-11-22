/**
 * PBPP (Prediction Bet / Payout) canister integration — shared wiring.
 *
 * This module owns the configurable PBPP canister principal (the settlement
 * / approval target) and the ICRC-2 approval flow that authorizes PBPP to
 * pull a player's stake into escrow via `transfer_from`.
 *
 * The `PBPP_CANISTER_PRINCIPAL` constant below is the live permanent PBPP
 * backend canister principal (oqybv-uyaaa-aaaac-bf5oq-cai). It is a
 * configurable constant so the approval always targets whatever principal is
 * configured here.
 *
 * The ICRC-2 approval reuses the established Oisy signer wallet pattern from
 * `oisy-burn/oisy-signer.ts` (SignerAgent + ICRC-25/27/49 against the OISY
 * signer endpoint). The approval is signed through the user's OISY wallet in
 * a popup, exactly like the existing `burnToken` flow.
 */

import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import type { OisyAccount } from "../oisy-burn/types";

/**
 * The configured PBPP canister principal — the settlement / approval target.
 *
 * This is the live permanent PBPP backend canister principal
 * (oqybv-uyaaa-aaaac-bf5oq-cai). The ICRC-2 approval below always targets
 * this value, so updating it here re-targets every approval without touching
 * the flow.
 */
export const PBPP_CANISTER_PRINCIPAL = "oqybv-uyaaa-aaaac-bf5oq-cai";

/**
 * The standard ICP ledger transfer fee, in e8s (0.0001 ICP = 10,000 e8s).
 *
 * When JEL pulls the pot via `icrc2_transfer_from`, the ICP ledger charges
 * this fee on top of the amount pulled. The ICRC-2 allowance must therefore
 * cover the stake PLUS this fee so the full bet can be pulled with the fee
 * covered. The bet relayed to JEL remains the plain stake amount — only the
 * allowance increases by this fee.
 */
export const ICP_TRANSFER_FEE_E8S = 10_000n;

/** Mainnet IC boundary node for the anonymous read-only agent. */
const IC_HOST = "https://icp-api.io";

/** OISY official signer endpoint (popup-based, per-action approval). */
const OISY_SIGNER_URL = "https://oisy.com/sign";

/* ------------------------------------------------------------------ */
/* Candid IDL — minimal hand-written factory for icrc2_approve         */
/* ------------------------------------------------------------------ */

/**
 * Minimal Candid IDL for the ICP ledger's `icrc2_approve` method. We
 * hand-write this rather than generating a full bindings file so the module
 * stays self-contained (mirroring the oisy-burn approach).
 *
 *  - icrc2_approve : (ApproveArgs) -> (variant { Ok : nat; Err : ... })
 *    update
 *
 * `ApproveArgs = record { from_subaccount : opt blob; spender : Account;
 *   amount : nat; expected_allowance : opt nat; expires_at : opt nat64;
 *   fee : opt nat; memo : opt blob; created_at_time : opt nat64 }`.
 * `Account = record { owner : principal; subaccount : opt blob }`.
 *
 * We only inspect the `Ok`/`Err` tag and the `nat`/text payload, so a
 * minimal variant suffices for the error surface.
 */
const AccountIDL: IDL.Type = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

const ApproveArgsIDL: IDL.Type = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  spender: AccountIDL,
  amount: IDL.Nat,
  expected_allowance: IDL.Opt(IDL.Nat),
  expires_at: IDL.Opt(IDL.Nat64),
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});

const ApproveErrorIDL: IDL.Type = IDL.Variant({
  BadFee: IDL.Record({ expected_fee: IDL.Nat }),
  InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
  AllowanceChanged: IDL.Record({ current_allowance: IDL.Nat }),
  Expired: IDL.Record({ ledger_time: IDL.Nat64 }),
  TooOld: IDL.Null,
  CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
  Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
  TemporarilyUnavailable: IDL.Null,
  GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
});

const ApproveResultIDL: IDL.Type = IDL.Variant({
  Ok: IDL.Nat,
  Err: ApproveErrorIDL,
});

const icpLedgerIdlFactory: IDL.InterfaceFactory = () =>
  IDL.Service({
    icrc2_approve: IDL.Func([ApproveArgsIDL], [ApproveResultIDL], []),
  });

/* ------------------------------------------------------------------ */
/* Signer — dynamic import with graceful fallback                      */
/* ------------------------------------------------------------------ */

interface SignerModule {
  Signer: new (config: { transport: unknown }) => unknown;
}

interface SignerWebModule {
  PostMessageTransport: new (config: {
    url: string;
    windowFeatures?: string;
  }) => unknown;
}

interface SignerAgentModule {
  SignerAgent: {
    create: (config: {
      signer: unknown;
      account: Principal;
      agent?: HttpAgent;
    }) => Promise<unknown>;
  };
}

let signerAvailability: "unknown" | "available" | "unavailable" = "unknown";
let signerLoadError: string | null = null;

async function tryLoadSigner(): Promise<{
  signer: SignerModule | null;
  web: SignerWebModule | null;
  agent: SignerAgentModule | null;
}> {
  if (signerAvailability === "unavailable") {
    return { signer: null, web: null, agent: null };
  }
  try {
    const [signer, web, agent] = await Promise.all([
      import("@icp-sdk/signer"),
      import("@icp-sdk/signer/web"),
      import("@icp-sdk/signer/agent"),
    ]);
    signerAvailability = "available";
    return {
      signer: signer as SignerModule,
      web: web as SignerWebModule,
      agent: agent as SignerAgentModule,
    };
  } catch (e) {
    signerAvailability = "unavailable";
    signerLoadError =
      e instanceof Error ? e.message : "Signer library could not be loaded.";
    return { signer: null, web: null, agent: null };
  }
}

/**
 * Cached signer modules. Populated by `preloadSigner()` (called on mount,
 * outside any click handler) so the synchronous `openApproveSignerSync()`
 * can construct the `PostMessageTransport` + `Signer` from cached modules
 * WITHOUT any preceding `await` — keeping the popup's `window.open` call
 * inside the click handler's user-activation call stack.
 *
 * `null` means "not yet preloaded" (or preload failed); the cached shape is
 * the resolved module triple from `tryLoadSigner()`.
 */
let cachedSignerModules: {
  signer: SignerModule;
  web: SignerWebModule;
  agent: SignerAgentModule;
} | null = null;

/**
 * Preload the signer modules on mount (or any time outside a click handler)
 * so the subsequent synchronous `openApproveSignerSync()` can construct the
 * `PostMessageTransport` + `Signer` from cached modules with NO preceding
 * `await`.
 *
 * The OISY signer popup error ("Signer window should not be opened outside
 * of click handler") is caused by an `await` between the click and
 * `window.open` — the browser's user-activation token expires across
 * microtask boundaries. Preloading the dynamic-import modules ahead of time
 * means the click handler's synchronous path can open the popup immediately,
 * preserving the user-activation token.
 *
 * Safe to call multiple times; the cache is populated once and reused.
 * Resolves to `true` if the modules are available, `false` otherwise.
 */
export async function preloadSigner(): Promise<boolean> {
  if (cachedSignerModules) return true;
  const { signer, web, agent } = await tryLoadSigner();
  if (signer && web && agent) {
    cachedSignerModules = { signer, web, agent };
    return true;
  }
  return false;
}

/**
 * The signer instance type returned by `openApproveSignerSync()`. Opaque to
 * callers — they pass it back to `approvePbppAllowance()`.
 */
export type ApproveSignerInstance = {
  // Opaque to callers — passed back to approvePbppAllowance.
  readonly __signer: unique symbol;
};

/**
 * Synchronously open the OISY signer popup and construct the `Signer`
 * instance. MUST be called as the first synchronous statement inside a click
 * handler (no preceding `await`) so `window.open` runs inside the click's
 * user-activation call stack.
 *
 * Requires `preloadSigner()` to have resolved successfully beforehand
 * (typically called in a mount effect). If the modules are not cached,
 * throws a clear error — the hook surfaces it as an approval error.
 *
 * Returns the constructed `Signer` instance; the caller passes it to
 * `approvePbppAllowance()` to run the ICRC-2 approval over the already-open
 * channel.
 */
export function openApproveSignerSync(): ApproveSignerInstance {
  const mods = cachedSignerModules;
  if (!mods) {
    throw new Error(
      signerLoadError ??
        "Oisy signer modules not preloaded. Call preloadSigner() on mount before approving.",
    );
  }
  const transport = new mods.web.PostMessageTransport({
    url: OISY_SIGNER_URL,
    windowFeatures: "width=500,height=700,noopener,noreferrer",
  });
  return new mods.signer.Signer({ transport }) as ApproveSignerInstance;
}

/* ------------------------------------------------------------------ */
/* ICRC-2 approval — authorize PBPP to pull the stake via transfer_from */
/* ------------------------------------------------------------------ */

/**
 * Result of an ICRC-2 approval. `ok` carries the approval block index;
 * `err` carries the ledger error reason as a short string.
 */
export type ApprovalOutcome = { ok: bigint } | { err: string };

/**
 * Request an ICRC-2 approval (allowance) from the connected Oisy wallet,
 * authorizing the configured PBPP canister to pull `amount` ICP from the
 * player's account via `transfer_from`.
 *
 * The approval is signed through the user's OISY wallet via the
 * `SignerAgent`, so the user approves the allowance in an OISY popup
 * (per-action approval, mirroring the existing `burnToken` flow).
 *
 * `signer` is the `Signer` instance returned by `openApproveSignerSync()`,
 * which the caller MUST have opened synchronously as the first statement in
 * the click handler so the popup's `window.open` runs inside the click's
 * user-activation call stack. The approval then travels over the already-open
 * postMessage channel, so awaiting here is safe.
 *
 * `account` is the connected OISY account that holds the ICP; the
 * `from_subaccount` is the account's subaccount (or null for the default).
 * The `spender` is the configured PBPP canister principal — never a
 * hard-coded address.
 *
 * The allowance is set to `amount + ICP_TRANSFER_FEE_E8S` so JEL can pull the
 * full `amount` via `icrc2_transfer_from` and still cover the ledger transfer
 * fee. The caller passes the plain stake as `amount`; the fee is added here.
 */
export async function approvePbppAllowance(
  signer: ApproveSignerInstance,
  account: OisyAccount,
  amount: bigint,
): Promise<ApprovalOutcome> {
  const mods = cachedSignerModules;
  if (!mods) {
    return {
      err:
        signerLoadError ??
        "Oisy signer library (@icp-sdk/signer) is not available.",
    };
  }
  try {
    const httpAgent = await HttpAgent.create({ host: IC_HOST });
    const signerAgent = await mods.agent.SignerAgent.create({
      signer,
      account: Principal.fromText(account.owner),
      agent: httpAgent,
    });
    const actor = Actor.createActor(icpLedgerIdlFactory, {
      agent: signerAgent as unknown as HttpAgent,
      canisterId: Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai"), // ICP ledger
    });
    const fromSubaccount =
      account.subaccount && account.subaccount.length > 0
        ? [Array.from(account.subaccount)]
        : [];
    const result = (await actor.icrc2_approve({
      from_subaccount: fromSubaccount,
      spender: {
        owner: Principal.fromText(PBPP_CANISTER_PRINCIPAL),
        subaccount: [],
      },
      amount: amount + ICP_TRANSFER_FEE_E8S,
      expected_allowance: [],
      expires_at: [],
      fee: [],
      memo: [],
      created_at_time: [],
    })) as { Ok: bigint } | { Err: Record<string, unknown> };
    if ("Ok" in result) {
      return { ok: result.Ok };
    }
    const err = result.Err;
    const reason =
      (err.GenericError as { message?: string } | undefined)?.message ??
      Object.keys(err)[0] ??
      "Approval rejected.";
    return { err: reason };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Approval failed.";
    return { err: msg };
  }
}
