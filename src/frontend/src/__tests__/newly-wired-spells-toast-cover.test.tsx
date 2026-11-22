import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the burn-and-play toast contract of the seven spells wired into
 * the board-effect path by this request:
 *   - Bendika (id 3) removes all remaining enemy Pawns;
 *   - Bendika Tah (id 4) removes all remaining Pawns of both colours;
 *   - Mayban Dadoy Tron (id 6) removes all remaining enemy Rooks;
 *   - Chila Cao (id 15) removes 1 random enemy Knight;
 *   - Handom Zitie Zumuc (id 16) removes 1 random enemy Bishop;
 *   - Bamburgh (id 17) removes 1 random enemy Rook;
 *   - Bouvet Hondao (id 18) permanently blocks one empty centre square.
 *
 * The request states the burn-and-play toast text and its shield math must not
 * change. The generic toast contract is pinned in burn-play-toast.test.tsx;
 * this file pins it for THESE seven spell names specifically, because they are
 * the ones whose board effect now fires: a fired removal/block spell must
 * still render the same headline ("<name> — <kind>") and the same
 * "Fired on the board — value vs <defender> shield before → after." line, and
 * a shield-cancelled burn of the same spell must still render the same
 * "Cancelled — ..." line with no board-effect wording. A regression that
 * special-cased the new spells in the toast (e.g. an effect summary) would
 * fail here.
 *
 * These are pure component contracts with no actor or network access. The
 * backend removal/block itself is not observable here; see
 * episode.coverageLimits.
 */

import {
  type BurnAndPlayResult,
  SpellKind,
  SpellResolutionOutcome,
  Team,
} from "@/backend";
import { BurnPlayToast } from "@/components/BurnPlayToast";
import type { BurnPlayToastEntry } from "@/components/BurnPlayToast";

/** The seven newly-wired spells with their burn kind and token id. */
const NEWLY_WIRED_SPELLS: Array<{
  name: string;
  kind: SpellKind;
  tokenId: bigint;
}> = [
  { name: "Bendika", kind: SpellKind.Major, tokenId: 3n },
  { name: "Bendika Tah", kind: SpellKind.Major, tokenId: 4n },
  { name: "Mayban Dadoy Tron", kind: SpellKind.Major, tokenId: 6n },
  { name: "Chila Cao", kind: SpellKind.Minor, tokenId: 15n },
  { name: "Handom Zitie Zumuc", kind: SpellKind.Minor, tokenId: 16n },
  { name: "Bamburgh", kind: SpellKind.Minor, tokenId: 17n },
  { name: "Bouvet Hondao", kind: SpellKind.Minor, tokenId: 18n },
];

function firedResult(
  name: string,
  kind: SpellKind,
  tokenId: bigint,
): BurnAndPlayResult {
  return {
    tokenId,
    spellName: name,
    gameNumber: 7n,
    team: Team.White,
    kind,
    resolution: {
      attacker: Team.White,
      defender: Team.Black,
      spellValue: 5n,
      shieldBefore: 4n,
      shieldAfter: 0n,
      outcome: SpellResolutionOutcome.fired,
      firesOnBoard: true,
    },
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
  };
}

function cancelledResult(
  name: string,
  kind: SpellKind,
  tokenId: bigint,
): BurnAndPlayResult {
  return {
    tokenId,
    spellName: name,
    gameNumber: 7n,
    team: Team.White,
    kind,
    resolution: {
      attacker: Team.White,
      defender: Team.Black,
      spellValue: 2n,
      shieldBefore: 6n,
      shieldAfter: 4n,
      outcome: SpellResolutionOutcome.cancelled,
      firesOnBoard: false,
    },
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
  };
}

function entry(id: string, result: BurnAndPlayResult): BurnPlayToastEntry {
  return { id, result };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("burn-and-play toast for the newly-wired spells", () => {
  it("renders the same headline and fired shield math for every newly-wired spell", () => {
    for (const spell of NEWLY_WIRED_SPELLS) {
      const { unmount } = render(
        <BurnPlayToast
          toasts={[
            entry(
              `burn-${spell.name}`,
              firedResult(spell.name, spell.kind, spell.tokenId),
            ),
          ]}
          onClose={vi.fn()}
        />,
      );

      // The headline is the spell name plus its kind label, unchanged.
      expect(
        screen.getByText(`${spell.name} — ${spell.kind}`),
      ).toBeInTheDocument();
      // The fired resolution line is the same shield math as any other spell.
      expect(
        screen.getByText(/Fired on the board — 5 vs Black shield 4 → 0\./),
      ).toBeInTheDocument();
      // No per-spell effect summary is added to the toast.
      expect(screen.queryByText(/removed/i)).not.toBeInTheDocument();

      unmount();
    }
  });

  it("renders the same cancelled shield math for every newly-wired spell", () => {
    for (const spell of NEWLY_WIRED_SPELLS) {
      const { unmount } = render(
        <BurnPlayToast
          toasts={[
            entry(
              `burn-${spell.name}`,
              cancelledResult(spell.name, spell.kind, spell.tokenId),
            ),
          ]}
          onClose={vi.fn()}
        />,
      );

      // A shield-cancelled burn of a newly-wired spell reads exactly like any
      // other cancelled spell: the same math, no board-effect wording.
      expect(
        screen.getByText(/Cancelled — 2 vs Black shield 6 → 4\./),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Fired on the board/)).not.toBeInTheDocument();

      unmount();
    }
  });

  it("names the burned NFT and its spell for a newly-wired spell", () => {
    render(
      <BurnPlayToast
        toasts={[entry("burn-1", firedResult("Bendika", SpellKind.Major, 3n))]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Bendika — Major")).toBeInTheDocument();
    expect(screen.getByText(/NFT #3/)).toBeInTheDocument();
    expect(screen.getByText("Burned & played")).toBeInTheDocument();
  });
});
