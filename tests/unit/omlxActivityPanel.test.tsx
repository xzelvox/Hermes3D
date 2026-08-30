import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OmlxActivityPanel } from "@/features/office/components/OmlxActivityPanel";
import type { OmlxResidentAgent } from "@/lib/omlx/activity";

const resident: OmlxResidentAgent = {
  id: "omlx:GLM-5.3-Flash-MLX-8bit",
  name: "RUKA",
  presetId: "long-dress",
  modelId: "GLM-5.3-Flash-MLX-8bit",
  phase: "generating",
  active: true,
  activeRequests: 1,
  waitingRequests: 2,
  promptTokens: 1_234,
  generatedTokens: 567,
  tokensPerSecond: 22.25,
  elapsedSeconds: 65,
  firstSeenAt: Date.now(),
  lastSeenAt: Date.now(),
  residentUntil: Date.now() + 30 * 60 * 1_000,
};

describe("OmlxActivityPanel", () => {
  afterEach(() => cleanup());

  it("shows only the approved activity details", () => {
    render(<OmlxActivityPanel resident={resident} onClose={() => {}} />);
    expect(screen.getByText("RUKA")).toBeInTheDocument();
    expect(screen.getByText("GLM-5.3-Flash-MLX-8bit")).toBeInTheDocument();
    expect(screen.getByText("Generating")).toBeInTheDocument();
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("567")).toBeInTheDocument();
    expect(screen.getByText("22.3")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("prompt text");
  });

  it("shows resident state and closes from the close button", () => {
    const onClose = vi.fn();
    render(
      <OmlxActivityPanel
        resident={{ ...resident, active: false }}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("30 min resident")).toBeInTheDocument();
    expect(screen.getByText(/Model activity has stopped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close oMLX activity" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
