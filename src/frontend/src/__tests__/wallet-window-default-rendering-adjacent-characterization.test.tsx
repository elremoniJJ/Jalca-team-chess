import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adjacent characterization of the WalletConnectionWindow's DEFAULT
 * (non-embedded) rendering, taken BEFORE the change that adds an optional
 * `embedded` prop to the wallet window and moves it inside the board overlay.
 *
 * The accepted request intentionally adds an `embedded` prop that forces the
 * body open, ignores the per-window localStorage open key and skips the
 * collapsible header, chevron and per-window theme dots. That embedded path is
 * the intentional change, so this file deliberately does NOT assert anything
 * about it. What it protects is the behavior ADJACENT to the change that must
 * survive it: rendered WITHOUT the `embedded` prop, the wallet window behaves
 * exactly as today —
 *
 *   - it is a collapsible card whose header reads "NFT Spell burning";
 *   - the header carries the chevron pair and the per-window theme dots;
 *   - the header toggle flips aria-expanded and mounts/unmounts the body;
 *   - the per-window localStorage open key ("tco-wallet-connection-open")
 *     still drives the initial open state;
 *   - the INFO button still swaps the body for the window's INFO content;
 *   - the existing data-ocid markers are preserved.
 *
 * The backend actor, the burn-state hook and the Oisy burn panel are mocked;
 * this is component/integration coverage, not deployed browser E2E.
 */

// WalletConnectionWindow imports SpellComplexity/Team/SpellUse as runtime
// values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test
// environment, so mock the backend module with the enum values the component
// needs.
vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
}));

// The window body mounts TeamSpellWindow (which reads useGameState,
// useSpellBoardState, useActorState) and OisyBurnPanel (which consumes
// useOisyBurn). Mock those hooks so the test drives the collapsible-window
// behavior deterministically without a real actor or signer.
const { useGameState, useSpellBoardState, useActorState, useBurnState } =
  vi.hoisted(() => ({
    useGameState: vi.fn(),
    useSpellBoardState: vi.fn(),
    useActorState: vi.fn(),
    useBurnState: vi.fn(),
  }));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-spell-board-state", () => ({ useSpellBoardState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));
vi.mock("@/lib/backend-actor", () => ({ useActorState }));

// The window reads the active identity and the persisted wallet address. Mock
// the identity hook with every export the window and its children consume so
// the render does not depend on localStorage or a real session.
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useActiveIdentity: () => "player-1",
  useRankedSession: () => false,
  useSpectator: () => null,
  isSpectating: () => false,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  clearSpectator: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
}));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the collapsible card.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { SpellUse } from "@/backend";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

function renderWindow(spellUse: SpellUse = SpellUse.On) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletConnectionWindow spellUse={spellUse} />
    </QueryClientProvider>,
  );
}

describe("WalletConnectionWindow default (non-embedded) rendering", () => {
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
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
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
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps its collapsible header, chevron, theme dots and INFO button", () => {
    window.localStorage.setItem("tco-wallet-connection-open", "true");
    const { container } = renderWindow();

    const header = screen.getByRole("button", { name: /NFT Spell burning/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    // The chevron pair is always mounted in the header.
    expect(header.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
    // The per-window theme dots render in the header.
    expect(
      container.querySelector(
        '[data-ocid="wallet_connection_window.theme_dots"]',
      ),
    ).not.toBeNull();
    // The INFO button is present in the header.
    expect(
      container.querySelector(
        '[data-ocid="wallet_connection_window.info_button"]',
      ),
    ).not.toBeNull();
  });

  it("keeps its existing data-ocid markers", () => {
    window.localStorage.setItem("tco-wallet-connection-open", "true");
    const { container } = renderWindow();

    for (const ocid of [
      "wallet_connection_window",
      "wallet_connection_window.header",
      "wallet_connection_window.info_button",
    ]) {
      expect(container.querySelector(`[data-ocid="${ocid}"]`)).not.toBeNull();
    }
  });

  it("toggles the body open and closed via the header, flipping aria-expanded", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-wallet-connection-open", "true");
    renderWindow();

    const header = screen.getByRole("button", { name: /NFT Spell burning/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();

    // Collapse — the body unmounts and aria-expanded flips.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("oisy-burn-panel")).not.toBeInTheDocument();

    // Re-expand — the body returns.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();
  });

  it("reads the per-window localStorage open key for its initial state", () => {
    // Collapsed by default on first visit (no stored key).
    const first = renderWindow();
    expect(
      screen.getByRole("button", { name: /NFT Spell burning/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("oisy-burn-panel")).not.toBeInTheDocument();
    first.unmount();

    // A stored true opens the body on mount.
    window.localStorage.setItem("tco-wallet-connection-open", "true");
    renderWindow();
    expect(
      screen.getByRole("button", { name: /NFT Spell burning/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();
  });

  it("still swaps the body for the INFO content via the INFO button", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-wallet-connection-open", "true");
    renderWindow();

    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Toggle NFT wallet information" }),
    );
    expect(screen.getByText("Game NFT spells")).toBeInTheDocument();
    expect(screen.queryByTestId("oisy-burn-panel")).not.toBeInTheDocument();
  });
});
