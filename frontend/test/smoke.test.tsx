import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function SmokeComponent() {
  return <button type="button">Frontend test setup works</button>;
}

describe("frontend test setup", () => {
  it("renders a component in jsdom", () => {
    render(<SmokeComponent />);
    expect(screen.getByRole("button", { name: "Frontend test setup works" })).toBeInTheDocument();
  });
});
