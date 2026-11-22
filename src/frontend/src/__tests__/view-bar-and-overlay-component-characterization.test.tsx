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

import { BoardViewOverlay } from "@/components/BoardViewOverlay";
import { ViewBar } from "@/components/ViewBar";

/**
 * Characterization of the two presentational seams the game route's
 * single-open-view mechanism is built on: ViewBar and BoardViewOverlay.
 *
 * The accepted change EXTENDS both — ViewBar gains Bet and Leaderboard
 * buttons and a wider ViewId, and the overlay is reused to host the embedded
 * Prediction Bet and Leaderboard windows. Those additions are the intentional
 * change, so this file deliberately does NOT assert the new buttons or the new
 * ViewId members. What it protects is the adjacent, working contract the route
 * relies on and the change must not disturb:
 *
 *   - ViewBar is a pure presentational control: it renders exactly the items
 *     it is given, marks the currently-open one `aria-pressed`, and reports a
 *     tap through `onSelect` without owning any open state itself;
 *   - BoardViewOverlay renders its title, a persistent close button and the
 *     INFO toggle, and swaps the body for the INFO content when INFO is
 *     pressed;
 *   - the overlay's close button reports through `onClose`.
 *
 * The route-level open/switch/close behavior is covered by
 * board-view-bar-and-overlay-cover.test.tsx; this file pins the component
 * contract underneath it.
 */

describe("ViewBar presentational contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the items it is given and marks the open one aria-pressed", () => {
    render(<ViewBar openView="vote" onSelect={() => {}} />);

    const bar = screen.getByTestId("viewbar");
    const buttons = Array.from(bar.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);

    // The open view's button is pressed; the others are not.
    const vote = screen.getByTestId("viewbar.vote.button");
    expect(vote).toHaveAttribute("aria-pressed", "true");
    for (const button of buttons) {
      if (button !== vote) {
        expect(button).toHaveAttribute("aria-pressed", "false");
      }
    }
  });

  it("reports a tap through onSelect without owning open state", () => {
    const onSelect = vi.fn();
    render(<ViewBar openView={null} onSelect={onSelect} />);

    // With no view open, every button reports unpressed.
    const bar = screen.getByTestId("viewbar");
    for (const button of Array.from(bar.querySelectorAll("button"))) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }

    fireEvent.click(screen.getByTestId("viewbar.vote.button"));
    expect(onSelect).toHaveBeenCalledWith("vote");

    // The bar does not change its own pressed state — the route owns it.
    expect(screen.getByTestId("viewbar.vote.button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("BoardViewOverlay presentational contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the title, a persistent close button and the body", () => {
    render(
      <BoardViewOverlay title="Story" onClose={() => {}}>
        <div data-ocid="overlay-body" />
      </BoardViewOverlay>,
    );

    expect(screen.getByTestId("viewoverlay.title")).toHaveTextContent("Story");
    expect(screen.getByTestId("viewoverlay.close_button")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-body")).toBeInTheDocument();
  });

  it("reports the close button through onClose", () => {
    const onClose = vi.fn();
    render(
      <BoardViewOverlay title="Vote" onClose={onClose}>
        <div data-ocid="overlay-body" />
      </BoardViewOverlay>,
    );

    fireEvent.click(screen.getByTestId("viewoverlay.close_button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("swaps the body for the INFO content when INFO is pressed", () => {
    render(
      <BoardViewOverlay
        title="Vote"
        onClose={() => {}}
        info={<div data-ocid="overlay-info" />}
      >
        <div data-ocid="overlay-body" />
      </BoardViewOverlay>,
    );

    // Body shown, INFO hidden until pressed.
    expect(screen.getByTestId("overlay-body")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-info")).not.toBeInTheDocument();

    const infoButton = screen.getByTestId("viewoverlay.info_button");
    fireEvent.click(infoButton);
    expect(screen.getByTestId("overlay-info")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-body")).not.toBeInTheDocument();

    // Pressing INFO again restores the body.
    fireEvent.click(infoButton);
    expect(screen.getByTestId("overlay-body")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-info")).not.toBeInTheDocument();
  });

  it("omits the INFO button when no info content is supplied", () => {
    render(
      <BoardViewOverlay title="Vote" onClose={() => {}}>
        <div data-ocid="overlay-body" />
      </BoardViewOverlay>,
    );

    expect(
      screen.queryByTestId("viewoverlay.info_button"),
    ).not.toBeInTheDocument();
  });
});
