import { NextResponse } from "next/server";

import {
  parseOmlxActivityPayload,
  type OmlxActivityResponse,
} from "@/lib/omlx/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OMLX_ACTIVITY_URL = "http://127.0.0.1:8000/admin/api/activity";
const MAX_RESPONSE_BYTES = 512 * 1_024;

const jsonResponse = (body: OmlxActivityResponse, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export const isTrustedOmlxActivityRequest = (request: Request) => {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
};

const extractAdminSession = (cookieHeader: string | null) => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name !== "omlx_admin_session" || !value) continue;
    if (/[^\x21-\x7e]/.test(value) || value.includes(";")) return null;
    return value;
  }
  return null;
};

const readLimitedJson = async (response: Response): Promise<unknown> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("oMLX activity response is too large.");
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("oMLX activity response is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
};

export async function GET(request: Request) {
  if (!isTrustedOmlxActivityRequest(request)) {
    return jsonResponse({ status: "unavailable", models: [] }, 403);
  }

  const session = extractAdminSession(request.headers.get("cookie"));
  if (!session) {
    return jsonResponse({ status: "login-required", models: [] }, 401);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(OMLX_ACTIVITY_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: `omlx_admin_session=${session}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return jsonResponse({ status: "login-required", models: [] }, 401);
    }
    if (!response.ok) {
      return jsonResponse({ status: "unavailable", models: [] }, 503);
    }
    const payload = await readLimitedJson(response);
    return jsonResponse({
      status: "ok",
      models: parseOmlxActivityPayload(payload),
    });
  } catch {
    return jsonResponse({ status: "unavailable", models: [] }, 503);
  } finally {
    clearTimeout(timeoutId);
  }
}
