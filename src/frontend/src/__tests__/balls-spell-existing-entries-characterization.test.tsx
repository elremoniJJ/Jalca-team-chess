import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the EXISTING Balls spells, taken BEFORE the three new
 * offensive Balls spells (Hairy Balls, Veiny Balls, Shiny Balls, ids 31-33)
 * are added to the Balls category.
 *
 * The request intentionally changes two things, which this file deliberately
 * does NOT pin:
 *   - the spell table gains three new Balls entries (ids 31-33), so the Balls
 *     list grows from five to eight and the total spell count changes;
 *   - the Balls board effect gains an opponent-board image variant for those
 *     three new spells.
 *
 * What IS protected here — the existing Balls behavior the new spells must not
 * disturb, and which no other suite exercises directly:
 *   1. The spell-table modal still renders the EXISTING five Balls spells
 *      (Sandy / Cloudy / Grassy / Fiery / Wooden Balls) with their name,
 *      meaning and effect text. The new spells are appended to the same Balls
 *      list, so the existing five must keep flowing through the modal's Balls
 *      rendering path unchanged.
 *   2. The burn-kind resolution still maps an EXISTING Balls spell name to the
 *      `Balls` kind in the `burnAndPlay` request. The three new spells are
 *      Balls-category and must resolve the same way; the existing five must
 *      keep resolving to `Balls` rather than falling through to the Minor
 *      fallback.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering and kind resolution — not real backend
 * behavior. The real `getSpellTable` query and the Balls palette effect are
 * exercised by the PocketIC lane when it runs.
 */

// The components import enum values from @/backend at runtime, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need.
vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  SpellCategory: {
    Block: "Block",
    Major: "Major",
    Minor: "Minor",
    Balls: "Balls",
  },
  SpellKind: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
  },
  LegacyReason: {
    keysAbsent: "keysAbsent",
    wrongType: "wrongType",
    keysDisagree: "keysDisagree",
    readFailed: "readFailed",
  },
  BurnedSpellCategory: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
  },
  BallsColourFamily: {
    Sandy: "Sandy",
    Cloudy: "Cloudy",
    Grassy: "Grassy",
    Fiery: "Fiery",
    Wooden: "Wooden",
  },
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// AdvicePopup -> lib/backend-actor imports createActorWithConfig from
// @caffeineai/core-infrastructure, which also fails to resolve its own
// submodules in jsdom. The surfaces under test never call the actor directly.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

/**
 * A spell table fixture carrying the EXISTING five Balls spells with their
 * real names, meanings and effect text, plus one existing Minor spell so the
 * modal's non-Balls rows are present too. The three new Balls spells are the
 * intentional change and are deliberately absent from this fixture.
 */
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 0n,
      complexity: "Easy",
      nftEligible: true,
      meaning: "Protection",
      name: "Subao Ve",
      spell: "Preemptively sets up a shield.",
      category: { Block: null },
      dropChance: 8n,
    },
    minor: [
      {
        id: 10n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fire bolt",
        name: "Tia Lua",
        spell: "Removes 1 random enemy Pawn from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
    ],
    major: [],
    balls: [
      {
        id: 26n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Sandy Balls",
        name: "Sandy Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Sandy colour family; equal or lower Power cancels it with no board effect.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 27n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Cloudy Balls",
        name: "Cloudy Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Cloudy colour family; equal or lower Power cancels it with no board effect.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 28n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Grassy Balls",
        name: "Grassy Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Grassy colour family; equal or lower Power cancels it with no board effect.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 29n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Fiery Balls",
        name: "Fiery Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Fiery colour family; equal or lower Power cancels it with no board effect.",
        category: { Balls: null },
        dropChance: 0n,
      },
      {
        id: 30n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Wooden Balls",
        name: "Wooden Balls",
        spell:
          "An offensive Balls spell. Resolves against the defending team's shield using the Subao Ve rule: it fires only when its Power strictly exceeds the shield, zeroing the shield and painting the caster's board with the Wooden colour family; equal or lower Power cancels it with no board effect.",
        category: { Balls: null },
        dropChance: 0n,
      },
    ],
  },
}));

const { getSpellTable, useActorState, useGameState, useBurnState } = vi.hoisted(
  () => ({
    getSpellTable: vi.fn(),
    useActorState: vi.fn(),
    useGameState: vi.fn(),
    useBurnState: vi.fn(),
  }),
);

vi.mock("@/lib/backend-actor", () => ({
  useActorState,
  getActor: vi.fn().mockResolvedValue({ getSpellTable, burnAndPlay }),
}));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock
// it to a marker so the window test stays focused on the spell table.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

function renderWindow() {
  // Seed the NFT wallet window open so its body (and the info panel) mounts
  // regardless of the collapsed-by-default first-visit state.
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

/** Open the info panel, then the spell table modal. */
async function openSpellTable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /Toggle NFT wallet information/i }),
  );
  await user.click(
    screen.getByRole("button", { name: /Spell names and effects/i }),
  );
  return screen.findByRole("dialog");
}

/** The row whose text contains the given spell name. The modal is portaled to
 * document.body, so rows are queried there rather than in the render
 * container. */
function rowFor(_container: HTMLElement, name: string): HTMLElement {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
  );
  const row = rows.find((r) => r.textContent?.includes(name));
  if (row === undefined) throw new Error(`no spell table row for ${name}`);
  return row;
}

describe("existing Balls spells in the spell table modal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    getSpellTable.mockResolvedValue(spellTable);
    useActorState.mockReturnValue({
      actor: { getSpellTable },
      isLoading: false,
      error: null,
      retry: () => {},
    });
    useGameState.mockReturnValue({
      data: { moveMaker: "player-1", turn: "White" },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders all five existing Balls spells with their name, meaning and effect", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    const dialog = await openSpellTable(user);

    // Each existing Balls spell renders as its own row, with its name and
    // meaning both present. The new spells are appended to this same list, so
    // the existing five must keep rendering.
    for (const name of [
      "Sandy Balls",
      "Cloudy Balls",
      "Grassy Balls",
      "Fiery Balls",
      "Wooden Balls",
    ]) {
      const row = rowFor(container, name);
      // The Balls spells' name and meaning are the same string, so both the
      // name and meaning cells match; the row must carry at least one.
      expect(within(row).getAllByText(name).length).toBeGreaterThan(0);
      // The effect text names the family the spell paints, so the row's
      // function cell is the spell's real description rather than a blank.
      expect(row).toHaveTextContent("painting the caster's board with the");
    }

    // The Balls rows are appended after the existing Block / Minor / Major
    // rows, preserving the modal's established ordering. The modal is portaled
    // to document.body, so the rows are queried there rather than in the
    // render container.
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
    );
    expect(rows[0]).toHaveTextContent("Subao Ve");
    expect(rows[1]).toHaveTextContent("Tia Lua");
    expect(rows[2]).toHaveTextContent("Sandy Balls");
    expect(rows[6]).toHaveTextContent("Wooden Balls");
    expect(within(dialog).getAllByText("Sandy Balls").length).toBeGreaterThan(
      0,
    );
  });
});

/**
 * Cover for the accepted change that shortens the three image Balls spells'
 * effect text to the short "Places <name> on the squares of the opponent."
 * wording, and that each names only itself (never the grouped form
 * "Hairy/Shiny/Veiny Balls").
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering of the table — not real backend
 * behavior. The real `getSpellTable` query is exercised by the PocketIC lane.
 */
const { ballsSpellTable } = vi.hoisted(() => ({
  ballsSpellTable: {
    block: null,
    minor: [],
    major: [],
    balls: [
      {
        id: 31n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Hairy Balls",
        name: "Hairy Balls",
        spell: "Places Hairy Balls on the squares of the opponent.",
        category: { Balls: null },
        dropChance: 0n,
        magicCategory: "Hex",
        level: "Skilled",
      },
      {
        id: 32n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Veiny Balls",
        name: "Veiny Balls",
        spell: "Places Veiny Balls on the squares of the opponent.",
        category: { Balls: null },
        dropChance: 0n,
        magicCategory: "Hex",
        level: "Advanced",
      },
      {
        id: 33n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Shiny Balls",
        name: "Shiny Balls",
        spell: "Places Shiny Balls on the squares of the opponent.",
        category: { Balls: null },
        dropChance: 0n,
        magicCategory: "Hex",
        level: "Basic",
      },
    ],
  },
}));

describe("the three image Balls spells' effect text", () => {
  beforeEach(() => {
    window.localStorage.clear();
    getSpellTable.mockResolvedValue(ballsSpellTable);
    useActorState.mockReturnValue({
      actor: { getSpellTable },
      isLoading: false,
      error: null,
      retry: () => {},
    });
    useGameState.mockReturnValue({
      data: { moveMaker: "player-1", turn: "White" },
      isLoading: false,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders each Balls spell's exact short effect text", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    await openSpellTable(user);

    const expected: Array<[string, string]> = [
      ["Hairy Balls", "Places Hairy Balls on the squares of the opponent."],
      ["Shiny Balls", "Places Shiny Balls on the squares of the opponent."],
      ["Veiny Balls", "Places Veiny Balls on the squares of the opponent."],
    ];
    for (const [name, effect] of expected) {
      const row = rowFor(container, name);
      expect(row).toHaveTextContent(effect);
    }
  });

  it("never groups the three Balls spells as 'Hairy/Shiny/Veiny Balls'", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    await openSpellTable(user);

    for (const name of ["Hairy Balls", "Shiny Balls", "Veiny Balls"]) {
      const row = rowFor(container, name);
      expect(row).not.toHaveTextContent("Hairy/Shiny/Veiny Balls");
    }
  });
});

/**
 * The burn-kind resolution seam for the EXISTING Balls spells. The three new
 * spells are Balls-category and must resolve to the `Balls` kind; the existing
 * five must keep resolving the same way rather than falling through to the
 * Minor fallback.
 */
const { burnAndPlay } = vi.hoisted(() => ({ burnAndPlay: vi.fn() }));

vi.mock("@/oisy-burn/oisy-signer", () => ({
  openOisySignerSync: vi.fn(),
  getOisyAccounts: vi.fn(),
  fetchOwnedNfts: vi.fn().mockResolvedValue([]),
  isSignerAvailable: vi.fn().mockReturnValue(true),
  preloadSigner: vi.fn().mockResolvedValue(true),
}));

vi.mock("@icp-sdk/signer", () => ({ __esModule: true, default: {} }));

import type { OisyNft } from "@/oisy-burn/types";
import { useOisyBurn } from "@/oisy-burn/use-oisy-burn";

function makeNft(overrides: Partial<OisyNft> = {}): OisyNft {
  return {
    id: 42n,
    name: "JALCA Game NFT #42",
    thumbnailUrl: null,
    gameNumber: 7n,
    spellName: "Sandy Balls",
    ...overrides,
  };
}

function BurnHarness({ nft }: { nft: OisyNft }) {
  const oisy = useOisyBurn("player-1", true);
  return (
    <button type="button" onClick={() => void oisy.burnOne(nft)}>
      burn
    </button>
  );
}

function renderBurnHarness(nft: OisyNft) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <BurnHarness nft={nft} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

async function waitForSpellTable(queryClient: QueryClient) {
  await waitFor(() => {
    expect(queryClient.getQueryData(["spellTable"])).toBeDefined();
  });
}

describe("existing Balls spell-kind resolution", () => {
  beforeEach(() => {
    burnAndPlay.mockReset();
    getSpellTable.mockResolvedValue(spellTable);
    useActorState.mockReturnValue({
      actor: { getSpellTable },
      isLoading: false,
      error: null,
      retry: () => {},
    });
    useGameState.mockReturnValue({
      data: { moveMaker: "player-1", turn: "White" },
      isLoading: false,
      error: null,
      moves: [
        {
          from: 12,
          to: 28,
          color: "White",
          piece: "Pawn",
          captured: null,
          capturedSquare: null,
          promotion: null,
          castle: false,
          isEnPassant: false,
        },
      ],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
    });
    burnAndPlay.mockResolvedValue({
      __kind__: "ok",
      ok: {
        burn: {
          tokenId: 42n,
          spellName: "Sandy Balls",
          gameNumber: 7n,
          team: "White",
          kind: "Balls",
        },
        shieldState: { whiteShield: 0n, blackShield: 0n },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("resolves an existing Balls spell to the Balls kind", async () => {
    const { queryClient } = renderBurnHarness(makeNft());
    await waitForSpellTable(queryClient);

    screen.getByRole("button", { name: "burn" }).click();

    await waitFor(() => {
      expect(burnAndPlay).toHaveBeenCalledTimes(1);
    });
    // The Balls kind is what drives the backend's offensive shield math and
    // the Balls palette branch; a fall-through to Minor would misroute it.
    expect(burnAndPlay).toHaveBeenCalledWith(
      "player-1",
      expect.objectContaining({ spellName: "Sandy Balls", kind: "Balls" }),
    );
  });

  it("resolves each existing Balls spell name to the Balls kind", async () => {
    for (const spellName of [
      "Cloudy Balls",
      "Grassy Balls",
      "Fiery Balls",
      "Wooden Balls",
    ]) {
      burnAndPlay.mockClear();
      const { queryClient, unmount } = renderBurnHarness(
        makeNft({ spellName }),
      );
      await waitForSpellTable(queryClient);

      screen.getByRole("button", { name: "burn" }).click();

      await waitFor(() => {
        expect(burnAndPlay).toHaveBeenCalledTimes(1);
      });
      expect(burnAndPlay).toHaveBeenCalledWith(
        "player-1",
        expect.objectContaining({ spellName, kind: "Balls" }),
      );
      unmount();
    }
  });
});
