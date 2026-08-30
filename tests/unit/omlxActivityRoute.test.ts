import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/omlx-activity/route";

const originalFetch = globalThis.fetch;

const request = (headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:3000/api/omlx-activity", { headers });

describe("oMLX activity route", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("requires only the oMLX admin session cookie", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      status: "login-required",
      models: [],
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects cross-site and mismatched-origin requests", async () => {
    const crossSite = await GET(
      request({
        cookie: "omlx_admin_session=session",
        "sec-fetch-site": "cross-site",
      }),
    );
    const wrongOrigin = await GET(
      request({
        cookie: "omlx_admin_session=session",
        origin: "http://localhost:3000",
      }),
    );
    expect(crossSite.status).toBe(403);
    expect(wrongOrigin.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("allows missing browser security headers and forwards no unrelated cookies", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active_models: {
            models: [
              {
                id: "model-a",
                active_requests: 1,
                waiting_requests: 0,
                activities: [{ elapsed_seconds: 3 }],
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await GET(
      request({
        cookie: "other=secret; omlx_admin_session=session-token; another=value",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "ok",
      models: [{ modelId: "model-a", phase: "active" }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/admin/api/activity",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Cookie: "omlx_admin_session=session-token",
        },
      }),
    );
  });

  it("maps upstream authentication failures without exposing the body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("private upstream detail", { status: 401 }),
    );
    const response = await GET(
      request({ cookie: "omlx_admin_session=expired-session" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      status: "login-required",
      models: [],
    });
  });

  it("rejects oversized upstream responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(513 * 1_024) },
      }),
    );
    const response = await GET(
      request({ cookie: "omlx_admin_session=session" }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable", models: [] });
  });

  it("times out an unresponsive upstream request", async () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch).mockImplementationOnce((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
    );
    const responsePromise = GET(
      request({ cookie: "omlx_admin_session=session" }),
    );
    await vi.advanceTimersByTimeAsync(3_001);
    const response = await responsePromise;
    expect(response.status).toBe(503);
  });
});
