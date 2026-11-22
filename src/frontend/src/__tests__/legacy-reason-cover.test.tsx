import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted Legacy-reason behavior.
 *
 * The request makes a failed/trapped/empty metadata read retry before any
 * Legacy classification, and gives a Legacy classification a specific reason
 * that is surfaced to the user. This file pins the frontend half of that
 * contract:
 *   - `legacyReasonText` maps each backend `LegacyReason` variant to its own
 *     distinct, human-readable reason text (never the raw variant token);
 *   - the burn-and-play toast renders that specific reason for a Legacy burn
 *     instead of the generic wording, and the four causes read differently;
 *   - a resolved (fired/cancelled) burn still renders its shield math and no
 *     Legacy wording, so the reason path does not leak into non-legacy burns.
 *
 * The backend retry/classification itself is not observable here — the
 * frontend suite mocks the actor. The PocketIC lane cannot reach a successful
 * burn because the external ICRC-7 collection canister is absent from the
 * replica, so the retry-before-Legacy behavior is covered by the source
 * contract in burn-classification-adjacent-characterization.test.ts and by
 * episode.coverageLimits.
 */

import {
  type BurnAndPlayResult,
  LegacyReason,
  SpellKind,
  SpellResolutionOutcome,
  Team,
} from "@/backend";
import { BurnPlayToast } from "@/components/BurnPlayToast";
import type { BurnPlayToastEntry } from "@/components/BurnPlayToast";
import { legacyReasonText } from "@/oisy-burn/types";

/** The four accepted Legacy causes and their distinct user-facing text. */
const REASON_TEXT: Array<{ reason: LegacyReason; text: string }> = [
  { reason: LegacyReason.readFailed, text: "metadata read failed" },
  { reason: LegacyReason.keysAbsent, text: "spell keys absent" },
  { reason: LegacyReason.wrongType, text: "key value wrong type" },
  { reason: LegacyReason.keysDisagree, text: "the two keys disagree" },
];

function legacyResult(reason: LegacyReason): BurnAndPlayResult {
  return {
    tokenId: 42n,
    spellName: "Minor Spell",
    gameNumber: undefined,
    team: Team.White,
    kind: SpellKind.Minor,
    resolution: undefined,
    legacyReason: reason,
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

describe("legacyReasonText", () => {
  it.each(REASON_TEXT)(
    "maps $reason to the distinct text '$text'",
    ({ reason, text }) => {
      expect(legacyReasonText(reason)).toBe(text);
    },
  );

  it("returns null when no reason is present", () => {
    expect(legacyReasonText(null)).toBeNull();
    expect(legacyReasonText(undefined)).toBeNull();
  });

  it("never returns the raw backend variant token", () => {
    for (const { reason } of REASON_TEXT) {
      expect(legacyReasonText(reason)).not.toBe(reason);
    }
  });
});

describe("burn-and-play toast Legacy reason", () => {
  it.each(REASON_TEXT)(
    "renders the specific reason '$text' for a $reason Legacy burn",
    ({ reason, text }) => {
      render(
        <BurnPlayToast
          toasts={[entry("burn-1", legacyResult(reason))]}
          onClose={vi.fn()}
        />,
      );

      // The detail line carries the specific reason, not the generic wording.
      expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
      expect(
        screen.queryByText(/burned inert, no shield effect/),
      ).not.toBeInTheDocument();
    },
  );

  it("renders a distinct reason text for each of the four causes", () => {
    const rendered = REASON_TEXT.map(({ reason }) => {
      const { unmount } = render(
        <BurnPlayToast
          toasts={[entry("burn-1", legacyResult(reason))]}
          onClose={vi.fn()}
        />,
      );
      const detail = screen.getByText(/Legacy NFT · White/).textContent ?? "";
      unmount();
      return detail;
    });

    // Every cause produces a different detail line, so the user can tell them
    // apart rather than seeing one generic Legacy message.
    expect(new Set(rendered).size).toBe(REASON_TEXT.length);
  });

  it("falls back to the generic Legacy wording when no reason is present", () => {
    const noReason = legacyResult(LegacyReason.keysAbsent);
    noReason.legacyReason = undefined;
    render(
      <BurnPlayToast toasts={[entry("burn-1", noReason)]} onClose={vi.fn()} />,
    );

    expect(
      screen.getByText(/Legacy NFT — burned inert, no shield effect\./),
    ).toBeInTheDocument();
  });

  it("does not render Legacy wording for a resolved burn", () => {
    const fired: BurnAndPlayResult = {
      tokenId: 42n,
      spellName: "Minor Spell",
      gameNumber: 7n,
      team: Team.White,
      kind: SpellKind.Minor,
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
    render(
      <BurnPlayToast toasts={[entry("burn-1", fired)]} onClose={vi.fn()} />,
    );

    expect(
      screen.getByText(/Fired on the board — 5 vs Black shield 4 → 0\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Legacy/i)).not.toBeInTheDocument();
  });
});
