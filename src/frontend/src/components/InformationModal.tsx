/**
 * InformationModal — full-screen "how the chess app works" overlay.
 *
 * Opened from the Information ('i') button in the BoardToolbar. Follows the
 * app's primary large-modal pattern (EndGameModal): a centered card over a
 * semi-transparent blurred backdrop, with a pinned header, a scrollable body,
 * and a pinned footer.
 *
 * Unlike the EndGameModal (which lingers on a terminal game state), this is a
 * dismissible informational dialog, so it renders an X close button in the
 * header and a "Got it" button in the footer. Escape closes it too.
 *
 * The body explains how the app works in the exact order specified:
 *   1. One chess game at a time; players randomly assigned to White/Black.
 *   2. Two game settings voted on by players (standard/random opening, and
 *      whether NFT spells may be used).
 *   3. A brief description of each toolbar button.
 *   4. Random Move_Maker assignment; the voted turn clock or team timeout.
 *   5. Playing a move requires 3 clicks (select piece, then double-click the
 *      destination square to select and confirm).
 *   6. Voting to kick a teammate to the opposing team (any player may vote,
 *      more than half of the team's active members must agree, votes from idle
 *      members and players who have left do not count, cleared each game).
 *   7. Placing a prediction bet on the outcome before a game, held in escrow
 *      by JEL and settled with a 1.5% platform fee.
 *   8. Connecting an Oisy wallet to earn an NFT spell each game and to burn
 *      NFTs to cast spells when the game setting allows and the player is the
 *      Move_Maker.
 */

import { X } from "lucide-react";
import { useEffect } from "react";
import { TurnDuration } from "../backend";
import {
  EscrowLedgerCanisterGauge,
  NftMintingCanisterGauge,
} from "./CanisterCyclesGauge";

export interface InformationModalProps {
  /** Close handler — wired to the BoardToolbar's open state. */
  onClose: () => void;
  /** The turn length currently in effect for the game, so the "Move Maker &
   * the Clock" section states the live value instead of a hardcoded one.
   * Defaults to the 2-minute default when the caller does not supply it. */
  turnDuration?: TurnDuration;
}

/**
 * Human-readable label for a turn-duration value, matching the wording used by
 * the Vote panel's "Turn time" toggle group.
 */
function turnDurationLabel(value: TurnDuration): string {
  switch (value) {
    case TurnDuration.NinetySeconds:
      return "1.5 minutes";
    case TurnDuration.OneMinute:
      return "1 minute";
    default:
      return "2 minutes";
  }
}

/* ------------------------------------------------------------------ */
/* Toolbar button descriptions (item 3)                                */
/* ------------------------------------------------------------------ */

interface ButtonDescription {
  label: string;
  description: string;
}

const BUTTON_DESCRIPTIONS: ButtonDescription[] = [
  {
    label: "Game #",
    description:
      "Shows the current game number and its settings — the opening in play and whether NFT spells are enabled.",
  },
  {
    label: "Coords",
    description:
      "Toggles the a–h / 1–8 coordinate labels around the edge of the board.",
  },
  {
    label: "Flip",
    description:
      "Reverses the board orientation so you can view the position from either side.",
  },
  {
    label: "Game mode",
    description:
      "Choose how you play: Just for Fun, Exercise Game, or Drinking Game. Selecting one deselects the others. Extra challenges appear when a piece is captured.",
  },
  {
    label: "Theme",
    description:
      "Opens the palette to pick one of six color themes for the whole app.",
  },
  {
    label: "i",
    description: "Opens this help screen explaining how the chess app works.",
  },
  {
    label: "Logout",
    description: "Ends your session and returns you to the login screen.",
  },
];

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-primary">
      {children}
    </h3>
  );
}

function SectionBody({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 font-body text-sm leading-relaxed text-foreground">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function InformationModal({
  onClose,
  turnDuration = TurnDuration.TwoMinutes,
}: InformationModalProps) {
  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      data-ocid="information.dialog"
      className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      // biome-ignore lint/a11y/useSemanticElements: overlay requires div for absolute positioning
      role="dialog"
      aria-modal="true"
      aria-labelledby="information-title"
    >
      <div className="relative flex max-h-[88vh] min-h-0 w-[min(92vw,42rem)] flex-col overflow-hidden rounded-2xl border-4 border-primary bg-card shadow-2xl">
        {/* Header band — pinned, never scrolls. Holds the title and an X
         * close button (this is a dismissible informational dialog, unlike
         * the terminal EndGameModal). */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-primary/10 px-5 py-3">
          <h2
            id="information-title"
            className="font-display text-lg font-bold text-primary"
          >
            How the Chess App Works
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-ocid="information.close_button"
            aria-label="Close information"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-smooth"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body — the ONLY scrollable region. flex-1 min-h-0 lets it shrink
         * within the constrained card so the pinned header and footer are
         * never pushed out of the viewport. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            {/* 1. One game at a time, random teams */}
            <section data-ocid="information.section.game">
              <SectionTitle>One Game at a Time</SectionTitle>
              <SectionBody>
                There is just one chess game running at any moment, and every
                player joins the same board. When a game begins, players are
                randomly assigned to the White and Black teams.
              </SectionBody>
            </section>

            {/* 2. Two voted game settings */}
            <section data-ocid="information.section.settings">
              <SectionTitle>Voting on the Next Game</SectionTitle>
              <SectionBody>
                Each game has two settings, and players vote on how the next
                game will start and progress. You vote between a{" "}
                <span className="font-semibold">standard opening</span> or a{" "}
                <span className="font-semibold">random opening</span>, and you
                vote on whether{" "}
                <span className="font-semibold">NFT spells</span> can be used or
                not. The winning choices shape the next game.
              </SectionBody>
            </section>

            {/* 3. Toolbar buttons */}
            <section data-ocid="information.section.buttons">
              <SectionTitle>The Buttons</SectionTitle>
              <ul className="mt-1 flex flex-col gap-2">
                {BUTTON_DESCRIPTIONS.map((b, i) => (
                  <li
                    key={b.label}
                    data-ocid={`information.button.${i + 1}`}
                    className="flex items-start gap-3 rounded-md px-2 py-1.5 odd:bg-muted/40"
                  >
                    <span className="mt-0.5 shrink-0 rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                      {b.label}
                    </span>
                    <span className="min-w-0 font-body text-sm text-foreground">
                      {b.description}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* 4. Move_Maker + the current turn clock */}
            <section data-ocid="information.section.move_maker">
              <SectionTitle>Move Maker &amp; the Clock</SectionTitle>
              <SectionBody>
                The game randomly assigns one player as the{" "}
                <span className="font-semibold">Move_Maker</span>. The
                Move_Maker has {turnDurationLabel(turnDuration)} to make a move
                — if the clock runs out, the team is timed out.
              </SectionBody>
            </section>

            {/* 5. Three-click move */}
            <section data-ocid="information.section.move">
              <SectionTitle>Playing a Move</SectionTitle>
              <SectionBody>
                Playing a move takes three clicks: first select the piece you
                want to move, then double-click the destination square to select
                and confirm it.
              </SectionBody>
            </section>

            {/* 6. Kicking a teammate */}
            <section data-ocid="information.section.kick">
              <SectionTitle>Kicking a Teammate</SectionTitle>
              <SectionBody>
                Any player on a team can vote to kick one of their own players
                to the opposing team. A player is moved to the other team when
                more than half of the team's active members have voted to kick
                them. Votes from idle members and from players who have left do
                not count. The players list shows a{" "}
                <span className="font-semibold">kick?</span> button beside each
                player, plus the number of kicks and who kicked whom. If a
                kicker leaves or is kicked, their vote is withdrawn. All kicks
                are erased at the end of every game. A Move_Maker can be kicked
                too — the role passes to another player. Being kicked does not
                affect any prediction bet you placed before the game started.
              </SectionBody>
            </section>

            {/* 7. Prediction betting */}
            <section data-ocid="information.section.prediction">
              <SectionTitle>Prediction Betting</SectionTitle>
              <SectionBody>
                Before a game, you can place a prediction bet on the outcome —{" "}
                <span className="font-semibold">White</span>,{" "}
                <span className="font-semibold">Black</span>, or{" "}
                <span className="font-semibold">Draw</span> — choosing a pot of
                1, 10, 100, or 1000 ICP. Connect your wallet and approve the
                stake, and your bet is held in escrow by JEL, the JALCA Escrow
                Ledger. When the game ends, JEL settles the pot: a{" "}
                <span className="font-semibold">1.5% platform fee</span> is
                taken, and the remaining 98.5% is split equally among the
                players in that pot who predicted correctly. If nobody in the
                pot predicted the correct outcome, the remaining 98.5% is
                returned equally to everyone in the pot, and the 1.5% fee still
                applies. The ICP ledger also charges a 0.0001 ICP network
                transfer fee per transfer — paid once when you place a bet and
                deducted from each payout you receive — which goes to the
                network, not the platform. If a game times out after 2 hours
                without a result, each player gets their stake back minus only
                that 0.0001 ICP network fee, with no platform fee charged. Very
                small pots where the fee would be less than the network fee do
                not incur the platform fee.
              </SectionBody>
            </section>

            {/* 8. Oisy wallet + NFT spells */}
            <section data-ocid="information.section.wallet">
              <SectionTitle>Oisy Wallet &amp; NFT Spells</SectionTitle>
              <SectionBody>
                Connect your Oisy wallet to earn an NFT spell at the end of
                every game. When the game setting allows it, you can burn NFTs
                to cast a spell — as long as you are the Move_Maker and you want
                to cast one.
              </SectionBody>
            </section>
          </div>
        </div>

        {/* Footer — pinned, never scrolls. Holds the "Got it" dismiss button
         * and, at the very bottom of the modal, the canister fuel gauges for
         * the two canisters involved in the game: the ICRC-7 NFT minting
         * canister and the JEL escrow ledger canister. */}
        <div className="shrink-0 border-t border-border bg-primary/5 px-5 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                data-ocid="information.got_it_button"
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 font-body text-sm font-semibold text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-smooth"
              >
                Got it
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <NftMintingCanisterGauge />
              <EscrowLedgerCanisterGauge />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InformationModal;
