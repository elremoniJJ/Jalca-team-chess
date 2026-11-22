/**
 * CanisterCyclesGauge — the canister fuel gauge.
 *
 * A Radix Popover showing a target canister's remaining cycle balance as a
 * 10-segment ring gauge with a 90-degree gap at 6 o'clock. Lit segments
 * scale with the balance; the popover lists the balance in trillions and
 * exposes the canister id.
 *
 * Two instances are surfaced in the InformationModal footer so players can
 * see which canisters are involved in the game:
 *   - the ICRC-7 NFT minting canister (ICRC7_CANISTER_ID)
 *   - the JEL escrow ledger canister (PBPP_CANISTER_PRINCIPAL)
 *
 * The useCanisterCycles wiring is preserved intact (fetch once on mount,
 * manual refetch after a post-game NFT mint via the parent's onCyclesRefetch
 * surface).
 */

import { Fuel } from "lucide-react";
import { useState } from "react";
import { useCanisterCycles } from "../hooks/use-canister-cycles";
import { PBPP_CANISTER_PRINCIPAL } from "../lib/pbpp";
import { ICRC7_CANISTER_ID } from "../oisy-burn/oisy-signer";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * polarToCartesian — convert a polar coordinate (center + radius + angle
 * in degrees) to cartesian SVG coordinates. 0deg is 3 o'clock; angles
 * increase clockwise in SVG space. Used by the gauge to lay out its 10 arc
 * segments around a 28x28 ring.
 */
function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export interface CanisterCyclesGaugeProps {
  /** Canister whose cycle balance is displayed. */
  canisterId: string;
  /** Short label naming the canister's role in the game. */
  label: string;
  /** Stable data-ocid prefix so each gauge is independently addressable. */
  ocidPrefix: string;
}

export function CanisterCyclesGauge({
  canisterId,
  label,
  ocidPrefix,
}: CanisterCyclesGaugeProps) {
  const { cycles, isLoading: cyclesLoading } = useCanisterCycles(canisterId);
  const [copied, setCopied] = useState(false);

  return (
    <div
      data-ocid={`${ocidPrefix}.panel`}
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} cycles`}
            title={`${label} cycles`}
            data-ocid={`${ocidPrefix}.gauge_button`}
            className="relative flex items-center justify-center rounded-full border border-border bg-background p-1.5 transition-smooth hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden="true">
              {(() => {
                const litCount = cycles
                  ? Math.min(10, Math.max(0, Number(cycles / 200_000_000_000n)))
                  : 0;
                const segments = Array.from({ length: 10 }, (_, i) => i);
                return segments.map((i) => {
                  const startDeg = -45 + i * 27;
                  const endDeg = startDeg + 27;
                  const start = polarToCartesian(14, 14, 12, endDeg);
                  const end = polarToCartesian(14, 14, 12, startDeg);
                  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
                  const lit = i < litCount;
                  return (
                    <path
                      key={i}
                      d={`M ${start.x} ${start.y} A 12 12 0 ${largeArc} 0 ${end.x} ${end.y}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      className={
                        lit ? "text-primary" : "text-muted-foreground/30"
                      }
                    />
                  );
                });
              })()}
            </svg>
            <Fuel className="absolute size-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="flex flex-col items-center gap-1 text-xs">
          <span className="font-semibold text-foreground">{label}</span>
          <span>
            {cycles
              ? `${(Number(cycles) / 1e12).toFixed(3)}T cycles remaining`
              : cyclesLoading
                ? "Loading cycles..."
                : "Cycle balance unavailable"}
          </span>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(canisterId);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            aria-label={`Copy ${label} canister id`}
            className="max-w-full truncate rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-muted"
          >
            {copied ? "Copied!" : canisterId}
          </button>
        </PopoverContent>
      </Popover>

      <p className="min-w-0 font-body text-xs leading-snug text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

/** Gauge for the ICRC-7 NFT minting canister. */
export function NftMintingCanisterGauge() {
  return (
    <CanisterCyclesGauge
      canisterId={ICRC7_CANISTER_ID}
      label="NFT minting canister"
      ocidPrefix="canister_cycles"
    />
  );
}

/** Gauge for the JEL escrow ledger canister. */
export function EscrowLedgerCanisterGauge() {
  return (
    <CanisterCyclesGauge
      canisterId={PBPP_CANISTER_PRINCIPAL}
      label="Escrow ledger canister"
      ocidPrefix="escrow_cycles"
    />
  );
}

export default CanisterCyclesGauge;
