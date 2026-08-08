/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyIdChip } from "../src/CopyIdChip";

afterEach(cleanup);

describe("CopyIdChip", () => {
  it("renders nothing without an id", () => {
    const { container } = render(<CopyIdChip id={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("copies the full id when clicked", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <CopyIdChip id="application-1234567890abcdef" label="Application" />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy Application application-1234567890abcdef",
      }),
    );
    expect(writeText).toHaveBeenCalledWith("application-1234567890abcdef");
    expect(await screen.findByText("Copied")).toBeVisible();
  });
});
