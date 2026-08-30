import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOmlxLiveAgents } from "@/features/office/hooks/useOmlxLiveAgents";

const originalFetch = globalThis.fetch;

const okResponse = (models: unknown[] = []) =>
  new Response(JSON.stringify({ status: "ok", models }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const activeModel = {
  modelId: "GLM-5.3-Flash-MLX-8bit",
  phase: "generating",
  activeRequests: 1,
  waitingRequests: 0,
  promptTokens: 500,
  generatedTokens: 50,
  tokensPerSecond: 20,
  elapsedSeconds: 2.5,
};

const setVisibility = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
};

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useOmlxLiveAgents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    window.localStorage.removeItem("hermes3d:omlx-live-agents-enabled");
    setVisibility("visible");
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("is off by default and starts polling immediately when enabled", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(okResponse([activeModel]));
    const { result } = renderHook(() => useOmlxLiveAgents());
    await flushPromises();

    expect(result.current.enabled).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    act(() => result.current.setEnabled(true));
    await flushPromises();
    expect(window.localStorage.getItem("hermes3d:omlx-live-agents-enabled")).toBe(
      "true",
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.activeCount).toBe(1);
    expect(result.current.residents[0]?.modelId).toBe(activeModel.modelId);

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("marks the source unavailable without breaking the 30 minute stay", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okResponse([activeModel]))
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValueOnce(new Error("third"));
    const { result } = renderHook(() => useOmlxLiveAgents());
    await flushPromises();
    act(() => result.current.setEnabled(true));
    await flushPromises();
    expect(result.current.residents).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.status).toBe("retrying");
    expect(result.current.residents).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.residents).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.status).toBe("unavailable");
    expect(result.current.residents).toHaveLength(1);
    expect(result.current.residents[0]?.active).toBe(false);

    vi.setSystemTime(30 * 60 * 1_000 + 1);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.residents).toEqual([]);
  });

  it("aborts an in-flight request while hidden and polls on visibility restore", async () => {
    window.localStorage.setItem("hermes3d:omlx-live-agents-enabled", "true");
    let firstSignal: AbortSignal | null = null;
    vi.mocked(globalThis.fetch)
      .mockImplementationOnce((_url, init) => {
        firstSignal = init?.signal ?? null;
        return new Promise<Response>(() => {});
      })
      .mockResolvedValueOnce(okResponse([activeModel]));

    const { result } = renderHook(() => useOmlxLiveAgents());
    await flushPromises();
    expect(result.current.enabled).toBe(true);
    expect(firstSignal).not.toBeNull();
    expect((firstSignal as unknown as AbortSignal).aborted).toBe(false);

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((firstSignal as unknown as AbortSignal).aborted).toBe(true);

    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushPromises();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.activeCount).toBe(1);
  });

  it("keeps a resident avatar when the oMLX login expires", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okResponse([activeModel]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: "login-required", models: [] }),
          { status: 401 },
        ),
      );
    const { result } = renderHook(() => useOmlxLiveAgents());
    await flushPromises();
    act(() => result.current.setEnabled(true));
    await flushPromises();

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.status).toBe("login-required");
    expect(result.current.residents).toHaveLength(1);
    expect(result.current.residents[0]?.active).toBe(false);
  });

  it("clears agents immediately when the option is disabled", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(okResponse([activeModel]));
    const { result } = renderHook(() => useOmlxLiveAgents());
    await flushPromises();
    act(() => result.current.setEnabled(true));
    await flushPromises();
    expect(result.current.residents).toHaveLength(1);

    act(() => result.current.setEnabled(false));
    await flushPromises();
    expect(result.current.status).toBe("off");
    expect(result.current.residents).toEqual([]);
  });
});
