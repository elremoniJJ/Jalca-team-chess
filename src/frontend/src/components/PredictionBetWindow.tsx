import { type Allowance, GameOutcome, Pot } from "@/backend";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Send,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useGameState } from "../hooks/use-game-state";
import {
  SPECTATOR_USERNAME_PREFIX,
  useGuestIdentity,
  useSpectator,
} from "../hooks/use-guest-identity";
import { useWindowTheme } from "../hooks/use-window-theme";
import { ICP_TRANSFER_FEE_E8S, preloadSigner } from "../lib/pbpp";
import { type PredictionChoice, usePbppBet } from "../lib/use-pbpp-bet";
import { WindowThemeDots } from "./WindowThemeDots";

/**
 * PredictionBetWindow — a collapsible window that lets a player place a real
 * prediction bet on the next game of Team Chess Online.
 *
 * The window is wired to the backend through the shared `usePbppBet(principal)`
 * hook, which owns:
 *   - Oisy wallet connection (reusing the established signer pattern),
 *   - the anonymity toggle (public username vs "Anonymous"),
 *   - the ICRC-2 allowance approval authorizing the configured PBPP canister
 *     to pull the stake into escrow via transfer_from.
 *
 * The player selects a pot (1/10/100/1000 ICP) and a prediction
 * (White/Black/Draw), connects their wallet, then presses a single "Place bet"
 * button. Place bet chains the two on-chain actions sequentially and
 * automatically: it first triggers the real icrc2_approve naming JEL as
 * spender (the wallet window opens directly from the button click), waits for
 * the approval to confirm, then automatically calls place_bet to relay the bet
 * to JEL. The fixed-amount approval (exactly the bet amount) is kept for
 * safety — the player re-approves per bet via the single button press.
 *
 * The real bet relay and outcome settlement:
 *   - An icrc2_allowance check (via the backend checkAllowance) shows
 *     immediate feedback — an amber "You haven't approved JEL yet" banner or a
 *     green "Allowance verified" pill. The approval is the real authorization;
 *     the approval_confirmed flag is only intent and is never trusted as the
 *     security gate. JEL is the authoritative gate at icrc2_transfer_from.
 *   - The "Place bet" button calls the backend placeBet method (the
 *     cross-canister call originates from JALCA's own backend principal, never
 *     the browser session). JEL's EscrowError responses map to clear
 *     user-facing feedback; success shows the ICRC Ledger block index JEL
 *     returned for the escrowed bet.
 *
 * This window does NOT implement live cross-canister settlement, dispute
 * resolution, bet history, or payout history display (all excluded).
 *
 * Collapse — matches the other collapsible windows (WalletConnectionWindow,
 * Players, Moves): a full-width header button with a chevron
 * (ChevronRight collapsed / ChevronDown expanded, both always mounted,
 * toggled via Tailwind hidden/block, size-4 text-muted-foreground
 * transition-smooth) and aria-expanded; the body is conditionally UNMOUNTED
 * when collapsed. The window self-manages its open state (it is rendered via
 * the Layout predictionBet slot, outside the PanelCollapseContext used by
 * Players/Moves), persisted to localStorage key "tco-prediction-bet-open".
 *
 * Info toggle — an info button sits beside the "Prediction Bet" heading.
 * When selected it shows the existing information content (How it works +
 * worked example); when deselected the info hides and the wired betting
 * control panel is shown in its place.
 */

/* --- Open/collapsed persistence (tco-prediction-bet-open) -------------- */

const OPEN_KEY = "tco-prediction-bet-open";
const DEFAULT_OPEN = false; // collapsed by default on first visit

function readStoredOpen(): boolean {
  if (typeof window === "undefined") return DEFAULT_OPEN;
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    if (raw === null) return DEFAULT_OPEN;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "boolean") return parsed;
  } catch {
    // Corrupt or unreadable — fall back to the default (collapsed).
  }
  return DEFAULT_OPEN;
}

function writeStoredOpen(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode, etc.) — the window
    // still works in-session via React state, just won't persist.
  }
}

/* --- Betting model ------------------------------------------------------ */

/** The four pot denominations, one row each. */
const POTS: ReadonlyArray<{ label: string; icp: number; pot: Pot }> = [
  { label: "1 ICP", icp: 1, pot: Pot.One },
  { label: "10 ICP", icp: 10, pot: Pot.Ten },
  { label: "100 ICP", icp: 100, pot: Pot.Hundred },
  { label: "1000 ICP", icp: 1000, pot: Pot.Thousand },
];

/** The 3-way outcome choices for a bet. */
const OUTCOMES: ReadonlyArray<{ label: string; prediction: PredictionChoice }> =
  [
    { label: "White", prediction: { White: null } },
    { label: "Black", prediction: { Black: null } },
    { label: "Draw", prediction: { Draw: null } },
  ];

/** ICP has 8 decimals — 1 ICP = 100,000,000 e8s. */
const E8S_PER_ICP = 100_000_000n;

/**
 * Format an e8s amount (8 decimals) as a readable ICP string, e.g.
 * 145_050_000_000n -> "1,450.50 ICP".
 */
function formatIcp(e8s: bigint): string {
  const whole = e8s / E8S_PER_ICP;
  const frac = e8s % E8S_PER_ICP;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  const wholeStr = whole.toLocaleString();
  return fracStr ? `${wholeStr}.${fracStr} ICP` : `${wholeStr} ICP`;
}

/**
 * Map the local 3-way `PredictionChoice` variant to the backend `GameOutcome`
 * enum used by `placeBet`.
 */
function predictionToOutcome(prediction: PredictionChoice): GameOutcome {
  if ("White" in prediction) return GameOutcome.white;
  if ("Black" in prediction) return GameOutcome.black;
  return GameOutcome.draw;
}

/** Human-readable label for a `GameOutcome` enum value. */
function outcomeLabel(outcome: GameOutcome): string {
  switch (outcome) {
    case GameOutcome.white:
      return "White";
    case GameOutcome.black:
      return "Black";
    case GameOutcome.draw:
      return "Draw";
    default:
      return "Unknown";
  }
}

/* --- Wired betting control panel --------------------------------------- */

function BettingPanel({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const principal = useGuestIdentity();
  // Spectator state — a stable per-spectator suffix when watching, else null.
  const spectatorSuffix = useSpectator();
  const isSpectator = spectatorSuffix !== null;
  // The player's username comes from the live game roster (players list).
  const { data: gameState } = useGameState(principal);
  const currentPlayer = gameState?.players.find(
    (p) => p.principal === principal,
  );
  // A spectator is not on the roster, so their bet username is formed from
  // the fixed spectator prefix plus their stable per-spectator suffix. The
  // prefix is a non-typable marker the login page cannot produce and the
  // backend's uniqueUsername collision handling cannot manufacture.
  const displayUsername = isSpectator
    ? `${SPECTATOR_USERNAME_PREFIX}${spectatorSuffix}`
    : (currentPlayer?.username ?? "Player");

  const {
    connection,
    connect,
    disconnect,
    signerAvailable,
    anonymous,
    setAnonymous,
    approveAllowance,
    checkAllowance,
    relayState,
    relayBet,
  } = usePbppBet(principal);

  // Local selection state for the bet being composed.
  const [selectedPot, setSelectedPot] = useState<Pot>(Pot.One);
  const [selectedPrediction, setSelectedPrediction] =
    useState<PredictionChoice>({
      White: null,
    });
  // Ledger allowance (spender = JEL, account = wallet owner) from the backend
  // checkAllowance convenience check. null until the first check resolves.
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [checkingAllowance, setCheckingAllowance] = useState(false);
  // Combined "Place bet" flow — chains the ICRC-2 approval then the real bet
  // relay. `placingPhase` distinguishes the two on-chain steps for feedback.
  const [placingPhase, setPlacingPhase] = useState<
    "approving" | "relaying" | null
  >(null);
  const [placeError, setPlaceError] = useState<string | null>(null);

  // Preload the OISY signer modules on mount (outside any click handler) so
  // the synchronous openApproveSignerSync() inside approveAllowance can
  // construct the PostMessageTransport + Signer from cached modules with NO
  // preceding await — preserving the browser's user-activation token so the
  // OISY popup opens without the "Signer window should not be opened outside
  // of click handler" error.
  useEffect(() => {
    void preloadSigner();
  }, []);

  const selectedPotMeta = POTS.find((p) => p.pot === selectedPot) ?? POTS[0];
  const stakeE8s = BigInt(selectedPotMeta.icp) * E8S_PER_ICP;
  // The ICRC-2 transfer fee in ICP (0.0001 ICP), derived from the shared
  // constant so the displayed figure stays consistent with the allowance math.
  const transferFeeIcp = Number(ICP_TRANSFER_FEE_E8S) / Number(E8S_PER_ICP);

  const connected = connection.status === "connected";

  // Whether the ledger allowance covers the current stake. The approval is the
  // real authorization; the approval_confirmed flag is only intent and is
  // never trusted as the security gate.
  const allowanceCoversStake =
    allowance !== null && allowance.allowance >= stakeE8s;
  const allowanceChecked = allowance !== null;

  // Check the ledger allowance (spender = JEL, account = wallet owner) when
  // the wallet connects, so the UI can show immediate feedback ("you haven't
  // approved JEL yet" / "Allowance verified"). This is a UX convenience — JEL
  // remains the authoritative gate at icrc2_transfer_from. The allowance is
  // compared against the current stake during render, so a pot change updates
  // the feedback without re-querying the ledger.
  useEffect(() => {
    if (!connected) {
      setAllowance(null);
      setCheckingAllowance(false);
      return;
    }
    let cancelled = false;
    setCheckingAllowance(true);
    void checkAllowance().then((a) => {
      if (cancelled) return;
      setAllowance(a);
      setCheckingAllowance(false);
    });
    return () => {
      cancelled = true;
    };
  }, [connected, checkAllowance]);

  const handleConnect = async () => {
    setPlaceError(null);
    await connect();
  };

  // Place bet — chains the two on-chain actions sequentially and
  // automatically: first the real icrc2_approve naming JEL as spender (the
  // wallet window opens directly from this button click — approveAllowance
  // opens the OISY popup synchronously as its first statement, preserving the
  // browser's user-activation token), waits for the approval to confirm, then
  // automatically calls place_bet to relay the bet to JEL. The fixed-amount
  // approval (exactly the bet amount) is kept for safety — the player
  // re-approves per bet via this single button press.
  const handlePlaceBet = async () => {
    if (!connected) return;
    setPlaceError(null);
    setPlacingPhase("approving");
    try {
      const outcome = await approveAllowance(stakeE8s);
      if ("err" in outcome) {
        setPlaceError(`Approval failed: ${outcome.err}`);
        return;
      }
      setPlacingPhase("relaying");
      await relayBet(
        displayUsername,
        anonymous,
        BigInt(selectedPotMeta.icp),
        stakeE8s,
        predictionToOutcome(selectedPrediction),
      );
    } finally {
      setPlacingPhase(null);
    }
  };

  const placing = placingPhase !== null;

  // Report the in-progress bet placement to the host (the board view overlay)
  // so it can lock its close button, Escape and the other view buttons while
  // the on-chain approval + relay is running. The callback is optional; when
  // absent (the standalone collapsible window) nothing is reported. The
  // effect also clears the flag on unmount so a view closed mid-placement
  // never leaves the host stuck busy.
  useEffect(() => {
    if (!onBusyChange) return;
    onBusyChange(placing);
    return () => onBusyChange(false);
  }, [placing, onBusyChange]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-foreground">
        Place your prediction for the next game. Select a pot, choose an
        outcome, connect your wallet, then press Place bet — it approves the
        stake and relays your real bet to JEL in one step.
      </p>

      {/* Spectator note — a spectator can still bet, but is not eligible for
       * NFTs. */}
      {isSpectator && (
        <p
          data-ocid="prediction_bet.spectator_note"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          Spectators can bet, but aren't eligible for NFTs.
        </p>
      )}

      {/* Pot selection — one row per denomination. */}
      <fieldset aria-label="Bet pot" className="flex flex-col gap-2">
        <legend className="window-heading text-xs font-semibold uppercase tracking-wide">
          Pot
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {POTS.map((pot, potIndex) => {
            const active = pot.pot === selectedPot;
            return (
              <button
                key={pot.pot}
                type="button"
                data-ocid={`prediction_bet.pot.${potIndex + 1}`}
                aria-pressed={active}
                onClick={() => {
                  setSelectedPot(pot.pot);
                }}
                className={`inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted/40 text-foreground hover:bg-muted/60"
                }`}
              >
                {pot.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Prediction selection — 3-way White / Black / Draw. */}
      <fieldset aria-label="Prediction" className="flex flex-col gap-2">
        <legend className="window-heading text-xs font-semibold uppercase tracking-wide">
          Prediction
        </legend>
        <div className="flex items-center overflow-hidden rounded-md border border-border">
          {OUTCOMES.map((outcome, outcomeIndex) => {
            const active =
              JSON.stringify(outcome.prediction) ===
              JSON.stringify(selectedPrediction);
            return (
              <button
                key={outcome.label}
                type="button"
                data-ocid={`prediction_bet.outcome.${outcomeIndex + 1}`}
                aria-pressed={active}
                onClick={() => {
                  setSelectedPrediction(outcome.prediction);
                }}
                className={`flex-1 px-2.5 py-2 text-xs font-medium transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {outcome.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Anonymity toggle — public username vs "Anonymous". */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-foreground">
            Make my username public
          </span>
          <span className="text-xs text-muted-foreground">
            {anonymous
              ? "You will appear as “Anonymous” in payout history."
              : `You will appear as “${displayUsername}”.`}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          data-ocid="prediction_bet.anonymity_toggle"
          aria-checked={!anonymous}
          aria-label="Make my username public"
          onClick={() => setAnonymous(!anonymous)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            anonymous ? "border-border bg-muted" : "border-primary bg-primary"
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block size-4 rounded-full bg-background shadow transition-transform ${
              anonymous ? "translate-x-1" : "translate-x-6"
            }`}
          />
        </button>
      </div>

      {/* Wallet connection + Place bet. */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Wallet
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="text-sm font-semibold text-foreground">
              {connected ? "Wallet connected" : "Connect your wallet"}
            </span>
          </div>
          {connected ? (
            <button
              type="button"
              data-ocid="prediction_bet.disconnect_button"
              onClick={disconnect}
              className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              data-ocid="prediction_bet.connect_button"
              onClick={handleConnect}
              disabled={connection.status === "connecting" || !signerAvailable}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {connection.status === "connecting" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Wallet className="size-3.5" aria-hidden="true" />
              )}
              {connection.status === "connecting" ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>

        {connection.status === "error" ? (
          <p
            data-ocid="prediction_bet.connection_error"
            className="text-xs text-destructive"
          >
            {connection.message}
          </p>
        ) : null}
        {!signerAvailable ? (
          <p className="text-xs text-muted-foreground">
            The Oisy signer is not available in this environment, so wallet
            connection is disabled.
          </p>
        ) : null}

        {connected ? (
          <div className="flex flex-col gap-2 border-t border-border pt-2">
            {/* Allowance feedback — informational UX convenience. JEL remains
             * the authoritative gate at icrc2_transfer_from. */}
            {checkingAllowance ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Checking your JEL allowance…
              </div>
            ) : allowanceChecked && !allowanceCoversStake ? (
              <div
                data-ocid="prediction_bet.allowance_warning"
                className="approval-warning flex items-center gap-2 rounded-md px-3 py-2"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold">
                  You haven't approved JEL yet — Place bet will approve your{" "}
                  {selectedPotMeta.label} stake first.
                </span>
              </div>
            ) : allowanceCoversStake ? (
              <div
                data-ocid="prediction_bet.allowance_verified"
                className="approval-verified flex items-center gap-2 rounded-md px-3 py-2"
              >
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold">
                  Allowance verified
                </span>
              </div>
            ) : null}

            {/* Approval breakdown — what the ICRC-2 approval covers. States
             * the bet amount, the transfer fee, and that the fee is for the
             * Internet Computer ICRC network transfer. The fee figure is
             * derived from ICP_TRANSFER_FEE_E8S so it stays consistent with
             * the actual allowance math (stake + fee). */}
            <div
              data-ocid="prediction_bet.approval_breakdown"
              className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs"
            >
              <p className="font-semibold text-foreground">
                Approving {selectedPotMeta.label} plus the transfer fee
              </p>
              <p className="text-muted-foreground">
                {selectedPotMeta.label} for your bet +{" "}
                {transferFeeIcp.toFixed(4)} ICP to cover the Internet Computer
                ICRC network transfer fee.
              </p>
            </div>

            {/* Place bet — chains approve → relay in one press. */}
            <button
              type="button"
              data-ocid="prediction_bet.place_bet_button"
              onClick={handlePlaceBet}
              disabled={placing || relayState.status === "relaying"}
              className="approval-relay inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {placing ? (
                <span className="approval-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              {placingPhase === "approving"
                ? "Approving stake…"
                : placingPhase === "relaying"
                  ? "Placing bet…"
                  : `Place ${selectedPotMeta.label} bet`}
            </button>

            {placeError ? (
              <p
                data-ocid="prediction_bet.place_error"
                className="text-xs text-destructive"
              >
                {placeError}
              </p>
            ) : null}

            {relayState.status === "success" ? (
              <div
                data-ocid="prediction_bet.relay_success"
                className="approval-relay rounded-md px-3 py-2"
              >
                <p className="text-xs font-semibold">Real bet placed</p>
                <p className="mt-0.5 text-xs opacity-90">
                  {anonymous ? "Anonymous" : displayUsername} —{" "}
                  {formatIcp(stakeE8s)} on{" "}
                  {outcomeLabel(predictionToOutcome(selectedPrediction))}.
                  Escrowed in ledger block{" "}
                  <span className="break-all">
                    {relayState.blockIndex.toString()}
                  </span>
                  .
                </p>
              </div>
            ) : null}
            {relayState.status === "error" ? (
              <p
                data-ocid="prediction_bet.relay_error"
                className="text-xs text-destructive"
              >
                {relayState.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* --- Interactive betting-flow walkthrough ------------------------------ */

/**
 * The authoritative betting + settlement flow, rendered as an interactive
 * step-by-step walkthrough. Each stage has a short rail label, a title, a
 * body, and a mono "rule" line. The rule lines state the key mechanics inline
 * and always use e8s numbers wherever a natural number refers to an amount
 * (1 ICP = 100_000_000 e8s, fee 10_000 e8s, approval 100_010_000 e8s).
 */
const FLOW_STAGES: ReadonlyArray<{
  id: string;
  label: string;
  title: string;
  body: string;
  rule: string;
}> = [
  {
    id: "select",
    label: "Select pot & outcome",
    title: "Pick your bet",
    body: "Choose a pot tier (1, 10, 100, or 1000 ICP), predict White, Black, or Draw, and decide whether your username is public or anonymous.",
    rule: "1 ICP = 100_000_000 e8s",
  },
  {
    id: "connect",
    label: "Connect wallet",
    title: "Connect your ICP wallet",
    body: "Connect your Oisy ICP wallet. Your wallet is where the stake is pulled from and where any winnings are returned.",
    rule: "Stake pulled from your wallet",
  },
  {
    id: "approve",
    label: "Approve JEL as spender",
    title: "Approve JEL for bet + fee",
    body: "Approve JEL as the spender for your bet plus the transfer fee. This authorizes JEL to pull the stake into escrow via icrc2_transfer_from.",
    rule: "Approval = bet + fee, e.g. 100_000_000 + 10_000 = 100_010_000 e8s",
  },
  {
    id: "verify",
    label: "JALCA verifies & relays",
    title: "JALCA verifies allowance, then relays",
    body: "JALCA verifies your allowance is in place, then calls place_bet on JEL. JALCA never moves ICP itself — it only relays the bet.",
    rule: "JALCA never moves ICP itself",
  },
  {
    id: "pull",
    label: "JEL pulls the bet",
    title: "JEL authenticates, checks, and pulls",
    body: "JEL authenticates the caller, checks the allowance, and pulls the bet via icrc2_transfer_from into pot escrow. The incoming transfer fee is paid by the player.",
    rule: "Incoming transfer fee paid by the player",
  },
  {
    id: "record",
    label: "Bet recorded",
    title: "Bet recorded into next-game pots",
    body: "Your bet is recorded into the next-game pots. There are two pot sets: the next-game pots are mutable (accepting bets) and the current-game pots are locked once play begins. Bets always target the next game (one-game offset).",
    rule: "Bets always for the next game",
  },
  {
    id: "settle",
    label: "Settlement",
    title: "JEL settles the locked round",
    body: "When the game ends, JEL receives report_outcome and settles the locked round: a 1.5% platform fee is taken from the pot, and the remaining 98.5% is split equally among the winning bettors in that pot. If nobody predicted the correct outcome, the remaining 98.5% is returned equally to everyone in the pot — the 1.5% fee still applies. Next-game pots are then locked.",
    rule: "1.5% platform fee; 98.5% split equally among winners",
  },
  {
    id: "refund",
    label: "Auto-refund",
    title: "2-hour auto-refund path",
    body: "If a round is not settled within 2 hours, each player gets their stake back minus only the 0.0001 ICP network transfer fee. No platform fee is charged on timeout refunds. Outgoing fees are paid by JEL from pot escrow.",
    rule: "2-hour auto-refund; no platform fee, only the 0.0001 ICP network fee",
  },
];

/**
 * Interactive step-by-step walkthrough of how a bet is placed and settled.
 * Highlights each stage as the user reads it, with next/back progression.
 * The step rail flips between vertical (portrait) and horizontal (landscape)
 * entirely via the .flow-rail @media (orientation: ...) rules, so this
 * component renders one markup shape for both orientations.
 */
function BetFlowWalkthrough() {
  const [active, setActive] = useState(0);
  const total = FLOW_STAGES.length;
  const current = FLOW_STAGES[active];

  const goNext = () => setActive((i) => Math.min(i + 1, total - 1));
  const goBack = () => setActive((i) => Math.max(i - 1, 0));

  return (
    <div data-ocid="prediction_bet.flow_walkthrough" className="flow-card">
      <h3 className="flow-title">How your bet is placed</h3>

      {/* Progress bar — position through the stages. */}
      <div className="flow-progress" aria-hidden="true">
        <div
          className="flow-progress-fill"
          style={{ width: `${((active + 1) / total) * 100}%` }}
        />
      </div>

      {/* Step rail — one markup shape for both orientations. */}
      <ol className="flow-rail">
        {FLOW_STAGES.map((stage, index) => {
          const state =
            index < active ? "done" : index === active ? "active" : "upcoming";
          return (
            <li
              key={stage.id}
              data-state={state}
              data-ocid={`prediction_bet.flow_step.${index + 1}`}
              className="flow-step"
            >
              <span className="flow-step-dot" aria-hidden="true">
                {index < active ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="flow-step-label">{stage.label}</span>
              {index < total - 1 ? (
                <span
                  className="flow-connector"
                  data-state={index < active ? "done" : "upcoming"}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Active stage detail — re-animates on stage change via key. */}
      <div className="flow-body" key={active}>
        <p className="font-semibold text-foreground">{current.title}</p>
        <p className="mt-1 text-muted-foreground">{current.body}</p>
        <p className="flow-body-rule">{current.rule}</p>
      </div>

      {/* Next/back progression. */}
      <div className="flow-controls">
        <button
          type="button"
          data-variant="ghost"
          data-ocid="prediction_bet.flow_back"
          onClick={goBack}
          disabled={active === 0}
          className="flow-btn"
        >
          Back
        </button>
        <span className="flow-counter" aria-live="polite">
          {active + 1} / {total}
        </span>
        <button
          type="button"
          data-ocid="prediction_bet.flow_next"
          onClick={goNext}
          disabled={active === total - 1}
          className="flow-btn"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* --- Information content (How it works + worked example) --------------- */

/**
 * The Prediction Bet window's INFO content. Exported so the board view
 * overlay's INFO button can reach it when the window is embedded.
 */
export function PredictionBetInfoContent() {
  return <InfoContent />;
}

function InfoContent() {
  return (
    <div className="flex flex-col gap-3">
      {/* Support note — short and sweet. Sits ABOVE the explanation text so
       * players see, before anything else, that prediction betting is what
       * funds the site and where they can track support received so far. */}
      <p
        data-ocid="prediction_bet.support_note"
        className="support-note rounded-md px-3 py-2 text-xs leading-relaxed"
      >
        Prediction betting is what funds this website — your support is much
        appreciated. Visit{" "}
        <a
          href="https://jalca-escrow-ledger.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="support-note-link font-semibold underline underline-offset-2 transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          jalca-escrow-ledger.xyz
        </a>{" "}
        to see how much support has been received so far.
      </p>

      {/* Desired outcome — the plain-language goal of the real feature. */}
      <p className="text-sm leading-relaxed text-foreground">
        Prediction betting lets players put real ICP on the line by predicting
        how a game of Team Chess Online will end. When the game finishes, the
        correct predictions are paid out from the staked pots.
      </p>

      {/* Interactive betting-flow walkthrough — step through how a bet is
       * placed and settled, highlighting each stage as the user reads it. */}
      <BetFlowWalkthrough />

      {/* Feature requirements — readable documentation of what the real
       * feature is designed to do. Purely descriptive; nothing here is
       * interactive. */}
      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          How it works
        </h3>
        <ul className="flex flex-col gap-1.5 text-sm text-foreground">
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              Players bet on the result of the NEXT game, not the current one
              being played, and no more bets can be placed once the current game
              is concluded.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              The four pots are the bet denominations — 1 ICP, 10 ICP, 100 ICP,
              and 1000 ICP. Players bet by selecting the pot size they want to
              enter, choosing their prediction (White, Black, Draw), and then
              pressing a confirm button which sends their specified amount of
              ICP to the escrow canister, to await the result of the next game.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              A 1.5% platform fee is taken from each pot when it settles. The
              remaining 98.5% is split equally among the winning bettors in that
              pot — not in proportion to how much each person staked.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              If nobody in a pot predicted the correct outcome, the remaining
              98.5% is returned equally to everyone in that pot, and the 1.5%
              platform fee still applies.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              The ICP ledger charges a 0.0001 ICP network transfer fee per
              transfer. It is paid once when you place a bet, and it is deducted
              from each payout you receive. This fee goes to the network, not to
              the platform.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              If a game times out after 2 hours without a result, each player
              gets their stake back minus only the 0.0001 ICP network fee — no
              platform fee is charged on timeout refunds.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              Very small pots where the fee would be less than the network fee
              do not incur the platform fee.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              Each pot settles independently, so a correct prediction pays out
              from its own pot.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span>
              The outcome is a 3-way result: White win, Black win, or Draw.
            </span>
          </li>
        </ul>
      </div>

      {/* Worked example — a concrete walkthrough of how the four pots pay
       * out after a game. Uses a single outcome (White wins) so the reader
       * can follow how each pot settles independently among its own
       * entrants, with a 1.5% platform fee taken from every pot and the
       * remaining 98.5% split equally among the winners. */}
      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Worked example
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          Say the next game ends in a{" "}
          <span className="font-semibold">White win</span>. Each pot settles on
          its own, paying out only to the players in that pot who predicted
          White. A 1.5% platform fee is taken from the pot, and the remaining
          98.5% is split equally among the winners — each winner also pays the
          small 0.0001 ICP network fee on their payout.
        </p>

        {/* Simple single-pot example — the plainest version of the maths. */}
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
          <p className="font-semibold">Simple example — a 10 ICP pot</p>
          <p className="mt-1">
            In a pot of 10 ICP, the 1.5% platform fee is 0.15 ICP, and the
            remaining 9.85 ICP is shared among the winners (each winner also
            pays the small 0.0001 ICP network fee).
          </p>
        </div>

        {/* Per-pot breakdown — one row per pot showing who bet, the outcome,
         * and the payout. Each pot is independent, so the maths is shown
         * separately for each. */}
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs font-semibold text-foreground">
              1 ICP pot — 5 players
            </p>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
              <li>
                Alice → White, Bob → White, Carol → Black, Dave → Draw, Eve →
                White
              </li>
              <li>
                Pot: 5 ICP. Fee: 1.5% (0.075 ICP). Alice, Bob and Eve win and
                split the remaining 4.925 ICP equally — about 1.6417 ICP each,
                less the 0.0001 ICP network fee.
              </li>
            </ul>
          </div>

          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs font-semibold text-foreground">
              10 ICP pot — 4 players
            </p>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
              <li>Frank → Black, Grace → Draw, Heidi → Black, Ivan → Draw</li>
              <li>
                Pot: 40 ICP. Fee: 1.5% (0.6 ICP). No one predicted White, so no
                one wins — the remaining 39.4 ICP is returned equally to all
                four players: 9.85 ICP each, less the 0.0001 ICP network fee.
              </li>
            </ul>
          </div>

          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs font-semibold text-foreground">
              100 ICP pot — 6 players
            </p>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
              <li>
                Jack → White, Kim → White, Leo → Black, Mia → White, Noah →
                Draw, Olivia → White
              </li>
              <li>
                Pot: 600 ICP. Fee: 1.5% (9 ICP). Jack, Kim, Mia and Olivia win
                and split the remaining 591 ICP equally — 147.75 ICP each, less
                the 0.0001 ICP network fee.
              </li>
            </ul>
          </div>

          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs font-semibold text-foreground">
              1000 ICP pot — 2 players
            </p>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
              <li>Peter → White, Quinn → Black</li>
              <li>
                Pot: 2000 ICP. Fee: 1.5% (30 ICP). Peter wins and takes the
                remaining 1970 ICP, less the 0.0001 ICP network fee.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- Component --------------------------------------------------------- */

export function PredictionBetWindow({
  embedded = false,
  onBusyChange,
}: {
  /** When true, render the body as if open with no collapsible header,
   * chevron or per-window theme dots, and ignore the per-window localStorage
   * open key. Used when the window is hosted inside the board view overlay.
   * Absent (false) keeps today's collapsible behavior exactly. */
  embedded?: boolean;
  /** Optional callback reporting whether a bet placement is in progress, so
   * the host overlay can lock its close button and view switching. */
  onBusyChange?: (busy: boolean) => void;
} = {}) {
  const [open, setOpen] = useState<boolean>(() => readStoredOpen());
  // Info toggle — when true the information content shows; when false the
  // wired betting control panel shows in its place.
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const { windowTheme, setWindowTheme, rootRef } = useWindowTheme(
    "prediction_bet_window",
  );

  // Persist React state → localStorage whenever it changes. The embedded path
  // never reads or writes the per-window open key: it is always rendered open
  // and must not disturb the standalone window's remembered state.
  useEffect(() => {
    if (embedded) return;
    writeStoredOpen(open);
  }, [open, embedded]);

  // The embedded path is always open; the standalone path follows its own
  // collapsible state.
  const isOpen = embedded || open;

  return (
    <div
      ref={rootRef}
      data-ocid="prediction_bet_window"
      className="flex w-full flex-col bg-card overflow-hidden"
    >
      {/* Header — three-part flex row: left shrink-0 toggle button, centred
       * per-window theme dots, right shrink-0 info button. The dots stay
       * centred and never overlap either side. The embedded path skips the
       * whole header (no toggle, chevron or theme dots). */}
      {!embedded ? (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            data-ocid="prediction_bet_window.header"
            aria-expanded={open}
            aria-controls="prediction-bet-window-body"
            className="flex min-w-0 shrink-0 items-center gap-1.5 px-4 py-3 text-left transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ChevronRight
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                open ? "hidden" : "block"
              }`}
              aria-hidden="true"
            />
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                open ? "block" : "hidden"
              }`}
              aria-hidden="true"
            />
            <span className="window-heading text-sm font-semibold">
              Prediction Bet
            </span>
          </button>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Prediction Bet"
            ocidPrefix="prediction_bet_window"
          />

          {/* Info button — sits beside the heading. Toggles the information
           * content: selected → info shows; deselected → info hides and the
           * wired betting control panel shows in its place. */}
          <button
            type="button"
            onClick={() => setShowInfo((current) => !current)}
            data-ocid="prediction_bet_window.info_button"
            aria-pressed={showInfo}
            aria-label="Toggle prediction bet information"
            className={`flex shrink-0 items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
              showInfo ? "text-accent" : "text-muted-foreground"
            }`}
          >
            <Info className="size-4" aria-hidden="true" />
            Info
          </button>
        </div>
      ) : null}

      {/* Body — conditionally UNMOUNTED when collapsed (same approach as the
       * other collapsible windows). When expanded, shows either the
       * information content (info button selected) or the wired betting
       * control panel (info button deselected). The embedded path always
       * renders the body and shows the wired betting panel (the overlay's own
       * INFO button reaches the info content). */}
      {isOpen ? (
        <div
          id="prediction-bet-window-body"
          className="flex w-full flex-col gap-3 px-4 py-3"
        >
          {showInfo ? (
            <InfoContent />
          ) : (
            <BettingPanel onBusyChange={onBusyChange} />
          )}

          {/* Permanent live-payments mention — always shown when the window
           * is expanded so players can track live pots. */}
          <p
            data-ocid="prediction_bet.live_payments_mention"
            className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          >
            Visit{" "}
            <a
              href="https://jalca-escrow-ledger.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground underline underline-offset-2 transition-smooth hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              jalca-escrow-ledger.xyz
            </a>{" "}
            to see live payments.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default PredictionBetWindow;
