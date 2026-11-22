import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted "Spells cast" rework of the two team spell-burning
 * windows (White and Black).
 *
 * The accepted request:
 *   - removes the bottom "Shield +N / No Subao Ve burned yet" block from both
 *     windows (it duplicated the big centered Subao Ve counter);
 *   - renames the "Minor / Major spells" list to "Spells cast" and lists every
 *     spell cast other than Subao Ve;
 *   - appends a tick for a successful cast, a cross for a Subao Ve-prevented
 *     cast, and a question mark for a cast with no effect on Subao Ve that did
 *     not land on the board;
 *   - makes the list scroll and removes its empty-state text;
 *   - keeps the big centered Subao Ve counter showing the team shield total.
 *
 * The window body mounts TeamSpellWindow (which reads useBurnState and
 * useShieldResolutionSnapshot) and OisyBurnPanel (which consumes useOisyBurn).
 * The burn panel is mocked to a marker so this file stays focused on the team
 * spell windows; the real TeamSpellWindow is rendered.
 *
 * This is component/integration coverage against typed local mocks — not a
 * deployed browser journey and not real backend behavior. The backend's
 * per-spell outcome classification is exercised by the PocketIC lane; see
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

function burnStateWith(overrides: {
  whiteMinorMajor?: BurnedSpellFixture[];
  whiteSubaoVe?: BurnedSpellFixture[];
  blackMinorMajor?: BurnedSpellFixture[];
  blackSubaoVe?: BurnedSpellFixture[];
}) {
  return {
    data: {
      burnOccurredThisTurn: true,
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

describe("TeamSpellWindow Spells cast list", () => {
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

  it("titles the list 'Spells cast' in both windows", () => {
    useBurnState.mockReturnValue(burnStateWith({}));

    const { container } = renderWindow();

    expect(
      within(teamWindow(container, "white")).getByText("Spells cast"),
    ).toBeInTheDocument();
    expect(
      within(teamWindow(container, "black")).getByText("Spells cast"),
    ).toBeInTheDocument();
    // The old heading is gone from both windows.
    expect(
      within(teamWindow(container, "white")).queryByText(
        "Minor / Major spells",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(teamWindow(container, "black")).queryByText(
        "Minor / Major spells",
      ),
    ).not.toBeInTheDocument();
  });

  it("lists every cast spell other than Subao Ve, each with its outcome marker", () => {
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteMinorMajor: [
          burnedSpell("Minor Spell", 7n, "White", "Minor", "succeeded"),
          burnedSpell("Major Spell", 9n, "White", "Major", "prevented"),
          burnedSpell("Balls Spell", 4n, "White", "Balls", "noEffect"),
        ],
      }),
    );

    const { container } = renderWindow();

    const white = within(teamWindow(container, "white"));
    // Every cast spell is listed with its game number.
    expect(white.getByText("Minor Spell")).toBeInTheDocument();
    expect(white.getByText("Game 7")).toBeInTheDocument();
    expect(white.getByText("Major Spell")).toBeInTheDocument();
    expect(white.getByText("Game 9")).toBeInTheDocument();
    expect(white.getByText("Balls Spell")).toBeInTheDocument();
    expect(white.getByText("Game 4")).toBeInTheDocument();

    // Exactly one marker per item: a tick for succeeded, a cross for
    // prevented, a question mark for noEffect.
    expect(white.getByLabelText("Successful cast")).toBeInTheDocument();
    expect(white.getByLabelText("Unsuccessful cast")).toBeInTheDocument();
    expect(white.getByLabelText("No effect")).toBeInTheDocument();
  });

  it("never lists Subao Ve as an item, even if it leaks into the minor/major window", () => {
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteMinorMajor: [
          burnedSpell("Minor Spell", 7n, "White", "Minor", "succeeded"),
          // Defensive filter: a Subao Ve entry in the minor/major list must
          // never render as a list item.
          burnedSpell("Subao Ve", 5n, "White", "SubaoVe", "noEffect"),
        ],
      }),
    );

    const { container } = renderWindow();

    const white = within(teamWindow(container, "white"));
    expect(white.getByText("Minor Spell")).toBeInTheDocument();
    // "Subao Ve" is the counter label, so assert no list item carries it.
    expect(
      container.querySelector('[data-ocid="team_spell_window.white.item.2"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="team_spell_window.white.item.1"]'),
    ).toHaveTextContent("Minor Spell");
  });

  it("keeps the big centered Subao Ve counter showing the team shield total in both windows", () => {
    useBurnState.mockReturnValue(burnStateWith({}));
    useShieldResolutionSnapshot.mockReturnValue({
      data: { whiteShield: 6n, blackShield: 4n },
    });

    const { container } = renderWindow();

    const whiteShield = container.querySelector(
      '[data-ocid="team_spell_window.white.shield_total"]',
    );
    expect(whiteShield).not.toBeNull();
    expect(whiteShield).toHaveTextContent("6");

    const blackShield = container.querySelector(
      '[data-ocid="team_spell_window.black.shield_total"]',
    );
    expect(blackShield).not.toBeNull();
    expect(blackShield).toHaveTextContent("4");
  });

  it("makes the list scrollable and shows no empty-state text when it is empty", () => {
    useBurnState.mockReturnValue(burnStateWith({}));

    const { container } = renderWindow();

    for (const team of ["white", "black"] as const) {
      const list = container.querySelector(
        `[data-ocid="team_spell_window.${team}.list"]`,
      );
      expect(list).not.toBeNull();
      // The list scrolls when its contents exceed the available height.
      expect(list).toHaveClass("overflow-y-auto");
      expect(list).toHaveClass("max-h-40");
      // No empty-state text is shown when the list is empty.
      expect(
        container.querySelector(
          `[data-ocid="team_spell_window.${team}.empty_state"]`,
        ),
      ).toBeNull();
      expect(
        within(teamWindow(container, team)).queryByText(
          "No spells burned yet.",
        ),
      ).not.toBeInTheDocument();
    }
  });

  it("removes the bottom Shield +N / No Subao Ve burned yet block from both windows", () => {
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteSubaoVe: [
          burnedSpell("Subao Ve", 5n, "White", "SubaoVe", "noEffect"),
        ],
        blackSubaoVe: [
          burnedSpell("Subao Ve", 6n, "Black", "SubaoVe", "noEffect"),
        ],
      }),
    );
    useShieldResolutionSnapshot.mockReturnValue({
      data: { whiteShield: 6n, blackShield: 4n },
    });

    const { container } = renderWindow();

    for (const team of ["white", "black"] as const) {
      expect(
        container.querySelector(
          `[data-ocid="team_spell_window.${team}.defensive_number"]`,
        ),
      ).toBeNull();
      expect(
        container.querySelector(
          `[data-ocid="team_spell_window.${team}.subao_ve.item.1"]`,
        ),
      ).toBeNull();
      expect(
        within(teamWindow(container, team)).queryByText(
          "No Subao Ve burned yet",
        ),
      ).not.toBeInTheDocument();
    }
  });
});
