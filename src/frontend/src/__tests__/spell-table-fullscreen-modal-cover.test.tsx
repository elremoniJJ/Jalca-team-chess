import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted FULL-SCREEN spell-table modal.
 *
 * The accepted request moves the spell list out of the board-sized overlay
 * window into a full-screen modal portaled to the page body. This file pins the
 * observable consequences of that move, which the existing spell-table tests do
 * not assert:
 *   - the modal is portaled to `document.body`, not nested inside the window;
 *   - its overlay is `fixed inset-0` (covers the whole viewport) rather than
 *     clipped to the board-sized overlay;
 *   - it has a pinned header (title + close button), a scrollable body, and a
 *     pinned footer (dismiss button);
 *   - it closes via the close button, the dismiss button, and the Escape key.
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
  SpellKind: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  BurnedSpellCategory: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
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
// submodules in jsdom. The window under test never calls the actor directly.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

/**
 * A spell table fixture with one entry per category (Block + Minor + Major +
 * Balls) so the modal renders a stable, non-empty list. Each entry carries a
 * magic category and level so the category line is exercised.
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
        magicCategory: "Necromancy",
        level: "Basic",
      },
    ],
    major: [
      {
        id: 3n,
        complexity: "Easy",
        nftEligible: true,
        meaning: "Plague",
        name: "Bendika",
        spell: "Removes all remaining enemy Pawns from the board.",
        category: { Major: null },
        dropChance: 2n,
        magicCategory: "Necromancy",
        level: "Mastery",
      },
    ],
    balls: [
      {
        id: 26n,
        complexity: "Easy",
        nftEligible: false,
        meaning: "Sandy Balls",
        name: "Sandy Balls",
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

describe("full-screen spell table modal", () => {
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

  it("portals the modal to document.body, outside the window container", async () => {
    const user = userEvent.setup();
    const { container } = renderWindow();
    const dialog = await openSpellTable(user);

    // The dialog is a direct child of document.body (portaled), not nested
    // inside the render container that holds the window.
    expect(dialog.parentElement).toBe(document.body);
    expect(container.contains(dialog)).toBe(false);
  });

  it("covers the whole viewport with a fixed inset-0 overlay", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    // The overlay is fixed to the viewport and spans all four edges, so it is
    // not clipped to the board-sized overlay.
    expect(dialog.className).toMatch(/\bfixed\b/);
    expect(dialog.className).toMatch(/\binset-0\b/);
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("has a pinned header with the title and a close button", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    // The title is the accepted label.
    expect(
      within(dialog).getByRole("heading", { name: "Spell names and effects" }),
    ).toBeInTheDocument();
    // The header close button is present and labelled.
    expect(
      within(dialog).getByRole("button", { name: /Close spell table/i }),
    ).toBeInTheDocument();
  });

  it("has a scrollable body and a pinned footer with a dismiss button", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    // The body is the scrollable region.
    const body = dialog.querySelector<HTMLElement>(
      "[data-ocid='spell_table.dialog'] .overflow-y-auto",
    );
    expect(body).not.toBeNull();

    // The footer dismiss button is present.
    expect(
      within(dialog).getByRole("button", { name: /Got it/i }),
    ).toBeInTheDocument();
  });

  it("closes via the close button", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    await user.click(
      within(dialog).getByRole("button", { name: /Close spell table/i }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes via the dismiss button", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    await user.click(within(dialog).getByRole("button", { name: /Got it/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes via the Escape key", async () => {
    const user = userEvent.setup();
    renderWindow();
    await openSpellTable(user);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows each spell's category and level on one line beneath its name", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    // The accepted format joins the magic category and level with a middle
    // dot: "Necromancy · Basic" for Tia Lua and "Necromancy · Mastery" for
    // Bendika. A regression that drops the separator or a field fails here.
    expect(within(dialog).getByText("Necromancy · Basic")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Necromancy · Mastery"),
    ).toBeInTheDocument();
  });

  it("omits the category line for a spell with no category or level", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    // Subao Ve carries neither a magic category nor a level, so its row shows
    // no category line at all — never a bare separator.
    const subaoRow = Array.from(
      dialog.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
    ).find((row) => row.textContent?.includes("Subao Ve"));
    expect(subaoRow).toBeDefined();
    expect(subaoRow?.textContent).not.toContain("·");
  });

  it("shows one spell per row, each with a narrow left and wider right column", async () => {
    const user = userEvent.setup();
    renderWindow();
    const dialog = await openSpellTable(user);

    // The accepted layout is one spell per row: four spells render as four
    // sibling rows, not two columns of two.
    const rows = Array.from(
      dialog.querySelectorAll<HTMLElement>("[data-ocid^='spell_table.row.']"),
    );
    expect(rows.length).toBe(4);

    // Each row's inner grid has exactly two tracks, the left narrower than the
    // right (grid-cols-[1fr_2fr]).
    const rowGrid = rows[0].querySelector<HTMLElement>(".grid");
    expect(rowGrid).not.toBeNull();
    const match = rowGrid?.className.match(/grid-cols-\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const tracks = (match?.[1] ?? "").split("_");
    expect(tracks).toHaveLength(2);
    const frValue = (track: string | undefined): number =>
      Number.parseFloat(track?.match(/([\d.]+)fr/)?.[1] ?? "0");
    expect(frValue(tracks[0])).toBeGreaterThan(0);
    expect(frValue(tracks[1])).toBe(frValue(tracks[0]) * 2);
  });
});
