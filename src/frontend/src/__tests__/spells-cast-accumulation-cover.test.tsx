import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted "Spells cast" ACCUMULATION change in the two team
 * spell-burning windows.
 *
 * The accepted request: the 'Spells cast' list in each team's NFT Spell
 * burning panel accumulates every cast spell for the duration of the game and
 * clears only at game start and game end — NOT on move completion. The list
 * stays split between White and Black, and each entry shows which team cast
 * the offensive spell and whether it succeeded or failed against a Subao Ve.
 *
 * What this file asserts (frontend consumer contract):
 *   - the window renders the FULL accumulated list the backend's
 *     `getBurnState` returns, in cast order, rather than only the latest cast;
 *   - a turn advance does not clear the list: the window keeps rendering the
 *     accumulated entries after the per-turn flag flips to false (the backend
 *     clears only the per-turn flags on a turn advance, not the windows);
 *   - the list clears when the backend reports empty windows (the game
 *     start/end reset), so the window shows no stale entries;
 *   - the White/Black split is preserved and each entry carries its outcome
 *     marker (tick / cross / question mark).
 *
 * The actor is a typed local mock (no real canister, no network), so this is
 * component/integration coverage of the frontend render path. The backend's
 * own `resetBurnForNewTurn` / `resetBurnForNewGame` bookkeeping is the PocketIC
 * lane's job; the game-start/end clear is not reachable in the replica. See
 * episode.coverageLimits.
 */

vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
  BurnedSpellCategory: {
    SubaoVe: "SubaoVe",
    Minor: "Minor",
    Major: "Major",
    Balls: "Balls",
  },
  SpellCastOutcome: {
    succeeded: "succeeded",
    prevented: "prevented",
    noEffect: "noEffect",
  },
}));

const {
  useGameState,
  useSpellBoardState,
  useActorState,
  useBurnState,
  useShieldResolutionSnapshot,
  useGameMeta,
} = vi.hoisted(() => ({
  useGameState: vi.fn(),
  useSpellBoardState: vi.fn(),
  useActorState: vi.fn(),
  useBurnState: vi.fn(),
  useShieldResolutionSnapshot: vi.fn(),
  useGameMeta: vi.fn(),
}));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-spell-board-state", () => ({ useSpellBoardState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));
vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot,
}));
vi.mock("@/hooks/use-game-meta", () => ({ useGameMeta }));
vi.mock("@/lib/backend-actor", () => ({ useActorState }));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the team spell windows.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

/** A burned spell entry as the backend's getBurnState returns it. */
interface BurnedSpellFixture {
  spellName: string;
  gameNumber: bigint;
  team: string;
  category: string;
  outcome: string;
}

function burnedSpell(
  spellName: string,
  gameNumber: bigint,
  team: string,
  category: string,
  outcome: string,
): BurnedSpellFixture {
  return { spellName, gameNumber, team, category, outcome };
}

/**
 * Build a burn-state snapshot. `burnOccurredThisTurn` is the per-turn flag the
 * backend clears on a turn advance; the windows are the accumulated lists.
 */
function burnStateWith(
  overrides: {
    burnOccurredThisTurn?: boolean;
    whiteMinorMajor?: BurnedSpellFixture[];
    whiteSubaoVe?: BurnedSpellFixture[];
    blackMinorMajor?: BurnedSpellFixture[];
    blackSubaoVe?: BurnedSpellFixture[];
  } = {},
) {
  return {
    data: {
      burnOccurredThisTurn: overrides.burnOccurredThisTurn ?? true,
      burnedByTeam: ["White"],
      whiteWindow: {
        minorMajorSpells: overrides.whiteMinorMajor ?? [],
        subaoVeSpells: overrides.whiteSubaoVe ?? [],
      },
      blackWindow: {
        minorMajorSpells: overrides.blackMinorMajor ?? [],
        subaoVeSpells: overrides.blackSubaoVe ?? [],
      },
    },
    isLoading: false,
    error: null,
  };
}

function renderWindow() {
  // The window body (which mounts the team spell windows) is only rendered
  // when the window is expanded. The window persists its open state under
  // "tco-wallet-connection-open" and is collapsed by default, so seed the
  // persisted open state before rendering to exercise the body.
  window.localStorage.setItem("tco-wallet-connection-open", "true");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletConnectionWindow spellUse={SpellUse.On} />
    </QueryClientProvider>,
  );
}

/**
 * The team windows carry `data-ocid` markers, not `data-testid`, so scope the
 * assertions through the rendered container rather than screen.getByTestId.
 */
function teamWindow(
  container: HTMLElement,
  team: "white" | "black",
): HTMLElement {
  const el = container.querySelector(`[data-ocid="team_spell_window.${team}"]`);
  if (el === null) throw new Error(`team_spell_window.${team} not rendered`);
  return el as HTMLElement;
}

describe("TeamSpellWindow Spells cast accumulation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGameState.mockReturnValue({
      data: { moveMaker: "player-1", turn: "White" },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useSpellBoardState.mockReturnValue({
      spellContext: undefined,
      isLoading: false,
    });
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: null,
      retry: () => {},
    });
    useShieldResolutionSnapshot.mockReturnValue({ data: undefined });
    useGameMeta.mockReturnValue({
      gameNumber: 10n,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the full accumulated list, not only the latest cast", () => {
    // Three spells cast across the game by White. The window must list all
    // three in cast order, not just the most recent one.
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteMinorMajor: [
          burnedSpell("First Spell", 10n, "White", "Minor", "succeeded"),
          burnedSpell("Second Spell", 10n, "White", "Major", "prevented"),
          burnedSpell("Third Spell", 10n, "White", "Balls", "noEffect"),
        ],
      }),
    );

    const { container } = renderWindow();

    const white = within(teamWindow(container, "white"));
    expect(white.getByText("First Spell")).toBeInTheDocument();
    expect(white.getByText("Second Spell")).toBeInTheDocument();
    expect(white.getByText("Third Spell")).toBeInTheDocument();

    // The list keeps its cast order: item 1 is the first cast, item 3 the last.
    expect(
      container.querySelector('[data-ocid="team_spell_window.white.item.1"]'),
    ).toHaveTextContent("First Spell");
    expect(
      container.querySelector('[data-ocid="team_spell_window.white.item.3"]'),
    ).toHaveTextContent("Third Spell");
  });

  it("keeps the accumulated list after a turn advance clears the per-turn flag", () => {
    // A turn advance flips `burnOccurredThisTurn` to false but must NOT clear
    // the team windows: the accumulated casts stay listed for the rest of the
    // game.
    useBurnState.mockReturnValue(
      burnStateWith({
        burnOccurredThisTurn: false,
        whiteMinorMajor: [
          burnedSpell("Kept Spell", 10n, "White", "Minor", "succeeded"),
        ],
      }),
    );

    const { container } = renderWindow();

    const white = within(teamWindow(container, "white"));
    expect(white.getByText("Kept Spell")).toBeInTheDocument();
    expect(white.getByText("Game 10")).toBeInTheDocument();
  });

  it("clears the list when the backend reports empty windows at a game boundary", () => {
    // At game start / game end the backend clears both windows. The window
    // must render no stale entries from the previous game.
    useBurnState.mockReturnValue(
      burnStateWith({
        burnOccurredThisTurn: false,
        whiteMinorMajor: [],
        blackMinorMajor: [],
      }),
    );

    const { container } = renderWindow();

    for (const team of ["white", "black"] as const) {
      expect(
        container.querySelector(
          `[data-ocid="team_spell_window.${team}.item.1"]`,
        ),
      ).toBeNull();
    }
  });

  it("keeps the White/Black split and each entry's outcome marker", () => {
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteMinorMajor: [
          burnedSpell("White Cast", 10n, "White", "Minor", "succeeded"),
        ],
        blackMinorMajor: [
          burnedSpell("Black Cast", 10n, "Black", "Major", "prevented"),
        ],
      }),
    );

    const { container } = renderWindow();

    const white = within(teamWindow(container, "white"));
    expect(white.getByText("White Cast")).toBeInTheDocument();
    expect(white.queryByText("Black Cast")).not.toBeInTheDocument();
    expect(white.getByLabelText("Successful cast")).toBeInTheDocument();

    const black = within(teamWindow(container, "black"));
    expect(black.getByText("Black Cast")).toBeInTheDocument();
    expect(black.queryByText("White Cast")).not.toBeInTheDocument();
    expect(black.getByLabelText("Unsuccessful cast")).toBeInTheDocument();
  });
});
