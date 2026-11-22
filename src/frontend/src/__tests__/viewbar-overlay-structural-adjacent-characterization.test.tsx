import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The view bar and overlay carry `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the ViewBar and BoardViewOverlay STRUCTURAL contract,
 * taken BEFORE the change that adds a Spells button and moves the wallet /
 * spell-burning window into the board overlay.
 *
 * The accepted request intentionally changes the bar's button SET and ORDER
 * (a sixth Spells button is inserted second) and moves the wallet window into
 * the overlay. Those are the intentional changes, so this file deliberately
 * does NOT assert the button list, its order, or which window the overlay
 * hosts. What it protects is the adjacent, working structure the change must
 * not disturb:
 *
 *   - the bar is a 3-column grid of ~44px touch targets;
 *   - the open view's button is marked aria-pressed, and only that one;
 *   - a busy bar disables every button;
 *   - the overlay pins its title and close button in the header;
 *   - the overlay renders an INFO button only when info content is supplied;
 *   - a busy overlay disables its close button.
 *
 * Both components are pure presentational controls, so they are rendered
 * directly with marker children — no route, actor or polling involved.
 */

import { BoardViewOverlay } from "@/components/BoardViewOverlay";
import { ViewBar } from "@/components/ViewBar";

describe("ViewBar structural contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a 3-column grid of small (three-button) size buttons", () => {
    render(<ViewBar openView={null} onSelect={() => {}} />);

    const bar = screen.getByTestId("viewbar");
    expect(bar.className).toContain("grid-cols-3");

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.className).toContain("text-xs");
      expect(button.className).not.toContain("min-h-[44px]");
    }
  });

  it("marks only the open view's button aria-pressed", () => {
    render(<ViewBar openView="vote" onSelect={() => {}} />);

    const pressed = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent("Vote");
  });

  it("reports the tapped view id through onSelect", () => {
    const onSelect = vi.fn();
    render(<ViewBar openView={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId("viewbar.vote.button"));
    expect(onSelect).toHaveBeenCalledWith("vote");
  });

  it("keeps the primary active-state styling on the open button only", () => {
    render(<ViewBar openView="vote" onSelect={() => {}} />);

    const open = screen.getByTestId("viewbar.vote.button");
    const closed = screen.getByTestId("viewbar.story.button");

    expect(open.className).toContain("border-primary");
    expect(open.className).toContain("bg-primary");
    expect(closed.className).not.toContain("bg-primary");
    expect(closed.className).toContain("border-border");
  });

  it("disables every button while busy", () => {
    render(<ViewBar openView={null} onSelect={() => {}} busy />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});

describe("BoardViewOverlay structural contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("pins the title and close button in the header and renders the body", () => {
    render(
      <BoardViewOverlay title="Some view" onClose={() => {}}>
        <div data-ocid="view-body" />
      </BoardViewOverlay>,
    );

    expect(screen.getByTestId("viewoverlay.title")).toHaveTextContent(
      "Some view",
    );
    expect(screen.getByTestId("viewoverlay.close_button")).toBeInTheDocument();
    expect(screen.getByTestId("view-body")).toBeInTheDocument();
  });

  it("calls onClose when the close button is pressed", () => {
    const onClose = vi.fn();
    render(
      <BoardViewOverlay title="Some view" onClose={onClose}>
        <div />
      </BoardViewOverlay>,
    );

    fireEvent.click(screen.getByTestId("viewoverlay.close_button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an INFO button only when info content is supplied", () => {
    const { unmount } = render(
      <BoardViewOverlay title="Some view" onClose={() => {}}>
        <div />
      </BoardViewOverlay>,
    );
    expect(
      screen.queryByTestId("viewoverlay.info_button"),
    ).not.toBeInTheDocument();
    unmount();

    render(
      <BoardViewOverlay
        title="Some view"
        onClose={() => {}}
        info={<div data-ocid="view-info" />}
      >
        <div data-ocid="view-body" />
      </BoardViewOverlay>,
    );
    fireEvent.click(screen.getByTestId("viewoverlay.info_button"));
    expect(screen.getByTestId("view-info")).toBeInTheDocument();
    expect(screen.queryByTestId("view-body")).not.toBeInTheDocument();
  });

  it("disables the close button while busy", () => {
    render(
      <BoardViewOverlay title="Some view" onClose={() => {}} busy>
        <div />
      </BoardViewOverlay>,
    );

    expect(screen.getByTestId("viewoverlay.close_button")).toBeDisabled();
  });
});
