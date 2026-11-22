/**
 * usePbppBet — shared React hook wiring the Prediction Bet feature to the
 * backend.
 *
 * Owns the three pieces of state the Prediction Bet UI needs:
 *
 *  1. Oisy wallet connection — reuses `useOisyBurn(principal)` so the
 *     player connects their wallet with the established Oisy signer pattern
 *     (popup-based, per-action approval). The connected account is the
 *     source of the ICRC-2 approval below.
 *
 *  2. Anonymity toggle — whether the player wishes to make their username
 *     public. Defaults to public (`anonymous === false`). The preference is
 *     sent with the bet payload and persisted by the backend on the
 *     `BetSubmission.anonymous` field.
 *
 *  3. Bet submission — `submitBet(...)` calls the backend actor's
 *     `submitBet` via `getActor()` and tracks an idle/submitting/success/
 *     error state so the UI can render confirmation and processing states.
 *
 * It also exposes `approveAllowance(amount)` — the ICRC-2 approval that
 * authorizes the configured PBPP canister (a configurable placeholder, never
 * a hard-coded address) to pull the player's stake into escrow via
 * `transfer_from`. The approval is signed through the connected Oisy wallet.
 *
 * Phase 2 adds the real bet relay and settlement surface:
 *
 *  4. `checkAllowance()` — queries the backend `checkAllowance` (spender =
 *     JEL, account = the connected wallet owner) so the UI can show immediate
 *     feedback such as "you haven't approved JEL yet". This is a UX
 *     convenience; JEL remains the authoritative gate at icrc2_transfer_from.
 *
 *  5. `relayBet(...)` — relays a real bet to JEL via the backend `placeBet`
 *     method. The cross-canister call originates from JALCA's own backend
 *     principal, never the browser session. JEL's EscrowError responses map
 *     to clear user-facing feedback; success carries the ICRC Ledger block
 *     index JEL returned for the escrowed bet.
 *
 *  6. `getRealBets()` / `getSettlements()` — read the locally recorded real
 *     bets and settlements.
 *
 * This hook does NOT implement live cross-canister settlement, dispute
 * resolution, bet history, or payout history display (all excluded).
 */

import type {
  Allowance,
  BetRecord,
  EscrowError,
  GameOutcome,
  PlaceBetArgs,
  Pot,
  RealBetRecord,
  SettlementRecord,
} from "@/backend";
import type { Prediction } from "@/backend";
import { Principal } from "@icp-sdk/core/principal";
import { useCallback, useState } from "react";
import type { OisyConnectionState } from "../oisy-burn/types";
import { useOisyBurn } from "../oisy-burn/use-oisy-burn";
import { getActor } from "./backend-actor";
import {
  type ApprovalOutcome,
  type ApproveSignerInstance,
  approvePbppAllowance,
  openApproveSignerSync,
} from "./pbpp";

/**
 * The 3-way outcome a player can predict for the next game, as a local
 * variant-shaped model used by the bet-slip UI. The backend `Prediction` enum
 * (Draw | Black | White) is the wire form consumed by `submitBet`.
 */
export type PredictionChoice =
  | { Draw: null }
  | { Black: null }
  | { White: null };

/**
 * Submission lifecycle for a single bet. `idle` is the resting state;
 * `submitting` while the backend call is in flight; `success` carries the
 * persisted `BetRecord`; `error` carries a short reason.
 */
export type BetSubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; bet: BetRecord }
  | { status: "error"; message: string };

/**
 * Lifecycle for a real bet relay to JEL via the backend `placeBet` method.
 * `idle` is the resting state; `relaying` while the cross-canister call is in
 * flight; `success` carries the ICRC Ledger block index JEL returned for the
 * escrowed bet; `error` carries a short user-facing reason mapped from JEL's
 * EscrowError.
 */
export type RelayState =
  | { status: "idle" }
  | { status: "relaying" }
  | { status: "success"; blockIndex: bigint }
  | { status: "error"; message: string };

/**
 * Render a JEL EscrowError verbatim — the exact error variant JEL returned,
 * not a generic message. JEL is the authoritative gate at
 * icrc2_transfer_from, so the player sees precisely which variant rejected the
 * bet. `TransferFailed` carries the escrow canister's failure text, which is
 * rendered verbatim (e.g. `TransferFailed: InsufficientAllowance`).
 */
export function placeBetErrorMessage(err: EscrowError): string {
  switch (err.__kind__) {
    case "Unauthorized":
      return "Unauthorized — you are not authorized to place this bet.";
    case "NoApproval":
      return "NoApproval — you haven't approved the escrow canister as spender yet. Approve the stake first.";
    case "InsufficientAllowance":
      return "InsufficientAllowance — your approved allowance does not cover this stake.";
    case "TransferFailed":
      return `TransferFailed: ${err.TransferFailed}`;
    case "InvalidTier":
      return "InvalidTier — that pot tier is not a valid bet denomination.";
    case "NoActiveGame":
      return "NoActiveGame — there is no active game to bet on right now.";
  }
}

export interface UsePbppBet {
  /** Oisy wallet connection state (reused from useOisyBurn). */
  connection: OisyConnectionState;
  /** Connect the player's Oisy wallet (opens the signer popup). */
  connect: () => Promise<void>;
  /** Disconnect the Oisy wallet (clears local connection state). */
  disconnect: () => void;
  /** Whether the Oisy signer library is available (false → fallback UI). */
  signerAvailable: boolean;
  /**
   * Whether the player's bet is anonymous. `false` (default) means the
   * username is made public; `true` means the player appears as
   * "Anonymous" in payout history.
   */
  anonymous: boolean;
  /** Set the anonymity preference. */
  setAnonymous: (value: boolean) => void;
  /** Submission lifecycle for the most recent bet. */
  submitState: BetSubmitState;
  /**
   * Submit a bet to the backend. `playerPrincipal` is the player's
   * pseudo-principal; `displayUsername` is the name shown unless
   * `anonymous` is true. Resolves when the bet is persisted.
   */
  submitBet: (
    pot: Pot,
    prediction: Prediction,
    playerPrincipal: string,
    displayUsername: string,
    anonymous: boolean,
  ) => Promise<void> /**
   * Request an ICRC-2 approval (allowance) from the connected Oisy wallet,
   * authorizing the configured PBPP canister to pull `amount` ICP into
   * escrow via `transfer_from`. Resolves to the approval outcome.
   */;
  approveAllowance: (amount: bigint) => Promise<ApprovalOutcome>;
  /**
   * Check the player's ledger allowance via the backend `checkAllowance`
   * (spender = JEL, account = the connected wallet owner). Returns the
   * current `Allowance`, or null when no wallet is connected. This is a UX
   * convenience — JEL remains the authoritative gate at icrc2_transfer_from.
   */
  checkAllowance: () => Promise<Allowance | null>;
  /** Lifecycle for the most recent real bet relay. */
  relayState: RelayState;
  /**
   * Relay a real bet to JEL via the backend `placeBet` method. The
   * cross-canister call originates from JALCA's own backend principal, never
   * the browser session. `playerPrincipal` is the connected wallet owner
   * principal; `potTier` is the numeric pot denomination (1/10/100/1000);
   * `amountE8s` is the stake in e8s; `outcome` is the 3-way result. Resolves
   * once JEL returns the ICRC Ledger block index for the escrowed bet or an
   * EscrowError.
   */
  relayBet: (
    username: string,
    anonymous: boolean,
    potTier: bigint,
    amountE8s: bigint,
    outcome: GameOutcome,
  ) => Promise<void>;
  /** Fetch all locally recorded real bets (with JEL bet_ids) in relay order. */
  getRealBets: () => Promise<RealBetRecord[]>;
  /** Fetch all locally recorded settlements in report order. */
  getSettlements: () => Promise<SettlementRecord[]>;
}

export function usePbppBet(principal: string): UsePbppBet {
  // Reuse the established Oisy signer connection pattern. The connected
  // account (when present) is the source of the ICRC-2 approval. The PBPP
  // bet feature only reuses the wallet CONNECTION (connect/disconnect/
  // signer availability) — it is not gated by the NFT spells setting, so
  // spellUseEnabled is passed as true.
  const { connection, connect, disconnect, signerAvailable } = useOisyBurn(
    principal,
    true,
  );

  // Anonymity preference — default public (username shown).
  const [anonymous, setAnonymous] = useState<boolean>(false);

  // Submission lifecycle for the most recent bet.
  const [submitState, setSubmitState] = useState<BetSubmitState>({
    status: "idle",
  });

  // Lifecycle for the most recent real bet relay.
  const [relayState, setRelayState] = useState<RelayState>({
    status: "idle",
  });

  const submitBet = useCallback(
    async (
      pot: Pot,
      prediction: Prediction,
      playerPrincipal: string,
      displayUsername: string,
      anonymousFlag: boolean,
    ) => {
      setSubmitState({ status: "submitting" });
      try {
        const actor = await getActor();
        const bet = await actor.submitBet(
          pot,
          prediction,
          playerPrincipal,
          displayUsername,
          anonymousFlag,
        );
        setSubmitState({ status: "success", bet });
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Your bet could not be submitted.";
        setSubmitState({ status: "error", message: msg });
      }
    },
    [],
  );

  const approveAllowance = useCallback(
    async (amount: bigint): Promise<ApprovalOutcome> => {
      if (connection.status !== "connected") {
        return { err: "Connect your Oisy wallet before approving the stake." };
      }
      // FIRST synchronous statement — open the OISY signer popup before any
      // await so window.open runs inside the click handler's user-activation
      // call stack (the signer-js requirement). The signer modules were
      // preloaded on mount via preloadSigner(), so openApproveSignerSync()
      // constructs the PostMessageTransport + Signer from the cache with NO
      // preceding await.
      let signer: ApproveSignerInstance;
      try {
        signer = openApproveSignerSync();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Approval failed.";
        return { err: msg };
      }
      // Popup is now open — the approval travels over the open postMessage
      // channel rather than triggering a new window.open, so awaiting here is
      // safe (the user-activation token is no longer needed).
      return approvePbppAllowance(signer, connection.account, amount);
    },
    [connection],
  );

  const checkAllowance = useCallback(async (): Promise<Allowance | null> => {
    if (connection.status !== "connected") return null;
    try {
      const actor = await getActor();
      return await actor.checkAllowance(
        Principal.fromText(connection.account.owner),
      );
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Your allowance could not be checked.";
      setRelayState({ status: "error", message: msg });
      return null;
    }
  }, [connection]);

  const relayBet = useCallback(
    async (
      username: string,
      anonymousFlag: boolean,
      potTier: bigint,
      amountE8s: bigint,
      outcome: GameOutcome,
    ) => {
      if (connection.status !== "connected") {
        setRelayState({
          status: "error",
          message: "Connect your Oisy wallet to relay a real bet.",
        });
        return;
      }
      setRelayState({ status: "relaying" });
      try {
        const actor = await getActor();
        // Record-shaped Candid argument. `amount_e8s` is the bet only — the
        // ICRC-2 approval separately covers the bet plus the transfer fee.
        const args: PlaceBetArgs = {
          player: Principal.fromText(connection.account.owner),
          username,
          anonymous: anonymousFlag,
          pot_tier: potTier,
          amount_e8s: amountE8s,
          outcome,
          wallet_address: connection.account.owner,
        };
        const result = await actor.placeBet(args);
        if (result.__kind__ === "ok") {
          // The ok payload is the ICRC Ledger block index (a nat).
          setRelayState({ status: "success", blockIndex: result.ok });
        } else {
          setRelayState({
            status: "error",
            message: placeBetErrorMessage(result.err),
          });
        }
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : "Your real bet could not be relayed.";
        setRelayState({ status: "error", message: msg });
      }
    },
    [connection],
  );

  const getRealBets = useCallback(async (): Promise<RealBetRecord[]> => {
    try {
      const actor = await getActor();
      return await actor.getRealBets();
    } catch {
      return [];
    }
  }, []);

  const getSettlements = useCallback(async (): Promise<SettlementRecord[]> => {
    try {
      const actor = await getActor();
      return await actor.getSettlements();
    } catch {
      return [];
    }
  }, []);

  return {
    connection,
    connect,
    disconnect,
    signerAvailable,
    anonymous,
    setAnonymous,
    submitState,
    submitBet,
    approveAllowance,
    checkAllowance,
    relayState,
    relayBet,
    getRealBets,
    getSettlements,
  };
}
