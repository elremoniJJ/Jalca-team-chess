import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted spell-table mapping of the user's original
 * hand-drawn images to Bendika (id 3), Bendika Tah (id 4) and Mayban Dadoy
 * Tron (id 6).
 *
 * Each of the three spells must render its own PNG at
 * `/assets/spells/3.png`, `/assets/spells/4.png` and `/assets/spells/6.png`
 * in its spell-table row, while the existing image mappings and the
 * unmapped-spell fallback keep working.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering — not real backend behavior. See
 * episode.coverageLimits.
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
  OpponentBoardImage: { Hairy: "Hairy", Veiny: "Veiny", Shiny: "Shiny" },
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
// submodules in jsdom. The window under test never calls the actor directly.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

/** The three spells this change maps and the asset each must render. */
const ORIGINAL_IMAGE_SPELLS = [
  { name: "Bendika", image: "/assets/spells/3.png" },
  { name: "Bendika Tah", image: "/assets/spells/4.png" },
  { name: "Mayban Dadoy Tron", image: "/assets/spells/6.png" },
] as const;

/** Existing image-mapped spells whose mapping must be unchanged. */
const EXISTING_IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Tia Lua", image: "/assets/spells/10.png" },
  { name: "Subao Ve", image: "/assets/spells/subao-ve.png" },
] as const;

/** A spell with no image mapping — must render no <img>. */
const NO_IMAGE_SPELL = "Hipsy Tan Chin";

/**
 * A spell table fixture carrying the three spells this change maps, the
 * existing image-mapped spells, and one spell with no image mapping.
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
        id: 3n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Plague",
        name: "Bendika",
        spell: "Removes all remaining enemy Pawns from the board.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 4n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Plague",
        name: "Bendika Tah",
        spell: "Removes all remaining Pawns of both colours.",
        category: { Minor: null },
        dropChance: 10n,
      },
      {
        id: 6n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Plague",
        name: "Mayban Dadoy Tron",
        spell: "Removes all remaining enemy Pawns.",
        category: { Minor: null },
        dropChance: 10n,
      },
    ],
    major: [
      {
        id: 1n,
        complexity: "Moderate",
        nftEligible: false,
        meaning: "Queen horse",
        name: "Newkai Dodan",
        spell: "Replaces the enemy Queen with an enemy Knight.",
        category: { Major: null },
        dropChance: 2n,
      },
      {
        id: 10n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Fire",
        name: "Tia Lua",
        spell: "A Lua fire spell.",
        category: { Major: null },
        dropChance: 5n,
      },
    ],
    balls: [
      {
        id: 31n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Hairy Balls",
        name: "Hairy Balls",
        spell: "An offensive Balls spell.",
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
  getActor: vi.fn().mockResolvedValue({ getSpellTable }),
}));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the spell table.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

function renderWindow() {
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

describe("WalletConnectionWindow original spell images", () => {
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

  it("renders each of the three spells' own PNG in its row", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    await openSpellTable(user);

    for (const spell of ORIGINAL_IMAGE_SPELLS) {
      const row = rowFor(container, spell.name);
      const img = row.querySelector("img");
      expect(img, `${spell.name} should render an image`).not.toBeNull();
      expect(img).toHaveAttribute("src", spell.image);
    }
  });

  it("keeps the existing image mappings and the unmapped-spell fallback", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();

    await openSpellTable(user);

    for (const spell of EXISTING_IMAGE_SPELLS) {
      const row = rowFor(container, spell.name);
      expect(row.querySelector("img")).toHaveAttribute("src", spell.image);
    }

    const row = rowFor(container, NO_IMAGE_SPELL);
    expect(within(row).getByText(NO_IMAGE_SPELL)).toBeInTheDocument();
    expect(row.querySelector("img")).toBeNull();
  });
});

/**
 * Cover for the accepted Newkai Dodan spell-table entry.
 *
 * The request enables Newkai Dodan (id 1) as an NFT-eligible spell and gives
 * it the supplied image at `/assets/spells/1.png`. The spell table reads the
 * enabled indicator from the backend's authoritative `nftEligible` flag, so an
 * enabled Newkai row shows the check mark and its own PNG.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering — not real backend behavior. The real
 * spell-table entry is exercised by the PocketIC lane when it runs. See
 * episode.coverageLimits.
 */
const { newkaiSpellTable } = vi.hoisted(() => ({
  newkaiSpellTable: {
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
    minor: [],
    major: [
      {
        id: 1n,
        complexity: "Moderate",
        nftEligible: true,
        meaning: "Queen horse",
        name: "Newkai Dodan",
        spell:
          "Turns every enemy queen into a knight. Any knight that would check your king is destroyed instead.",
        category: { Major: null },
        dropChance: 2n,
      },
    ],
    balls: [],
  },
}));

describe("WalletConnectionWindow Newkai Dodan spell-table entry", () => {
  beforeEach(() => {
    window.localStorage.clear();
    getSpellTable.mockResolvedValue(newkaiSpellTable);
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

  it("shows Newkai Dodan enabled with its own image", async () => {
    const user = userEvent.setup();
    // Seed the NFT wallet window open so its body (and the info panel) mounts
    // regardless of the collapsed-by-default first-visit state.
    window.localStorage.setItem("tco-wallet-connection-open", "true");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WalletConnectionWindow spellUse={SpellUse.On} />
      </QueryClientProvider>,
    );

    await openSpellTable(user);

    const row = rowFor(container, "Newkai Dodan");
    // The supplied image is rendered in the row.
    expect(row.querySelector("img")).toHaveAttribute(
      "src",
      "/assets/spells/1.png",
    );
    // The enabled indicator is the check mark (lucide Check), not the X.
    // The row's last cell carries the enabled state; a check icon has the
    // `lucide-check` class, the disabled X has `lucide-x`.
    expect(row.querySelector(".lucide-check")).not.toBeNull();
    expect(row.querySelector(".lucide-x")).toBeNull();
  });
});
