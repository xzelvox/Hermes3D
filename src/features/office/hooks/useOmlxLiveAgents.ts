"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildOmlxOfficeAgents,
  reconcileOmlxResidents,
  type OmlxActivityResponse,
  type OmlxResidentAgent,
} from "@/lib/omlx/activity";

const STORAGE_KEY = "hermes3d:omlx-live-agents-enabled";
const POLL_INTERVAL_MS = 2_000;
const RETRY_INTERVAL_MS = 5_000;

export type OmlxLiveAgentsStatus =
  | "off"
  | "loading"
  | "ready"
  | "retrying"
  | "login-required"
  | "unavailable";

export const useOmlxLiveAgents = () => {
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [status, setStatus] = useState<OmlxLiveAgentsStatus>("off");
  const [residents, setResidents] = useState<OmlxResidentAgent[]>([]);

  useEffect(() => {
    try {
      setEnabledState(window.localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      setEnabledState(false);
    }
    setPreferenceLoaded(true);
  }, []);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(nextEnabled));
    } catch {
      // 保存できない環境でも、このセッション中の切り替えは維持する。
    }
  }, []);

  useEffect(() => {
    if (!preferenceLoaded) return;
    if (!enabled) {
      setStatus("off");
      setResidents([]);
      return;
    }

    let disposed = false;
    let timerId: number | null = null;
    let controller: AbortController | null = null;
    let consecutiveFailures = 0;
    setStatus("loading");

    const clearTimer = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      if (disposed || document.visibilityState !== "visible") return;
      timerId = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/omlx-activity", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as OmlxActivityResponse;
        if (disposed) return;
        if (payload.status === "login-required") {
          consecutiveFailures = 0;
          setResidents((current) =>
            current
              .filter((resident) => resident.residentUntil > Date.now())
              .map((resident) => ({ ...resident, active: false })),
          );
          setStatus("login-required");
          schedule(RETRY_INTERVAL_MS);
          return;
        }
        if (!response.ok || payload.status !== "ok" || !Array.isArray(payload.models)) {
          throw new Error("oMLX activity is unavailable.");
        }
        consecutiveFailures = 0;
        setResidents((current) =>
          reconcileOmlxResidents(current, payload.models, Date.now()),
        );
        setStatus("ready");
        schedule(POLL_INTERVAL_MS);
      } catch (error) {
        if (disposed) return;
        if (error instanceof Error && error.name === "AbortError") return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          setResidents((current) =>
            current
              .filter((resident) => resident.residentUntil > Date.now())
              .map((resident) => ({ ...resident, active: false })),
          );
          setStatus("unavailable");
        } else {
          setStatus("retrying");
        }
        schedule(RETRY_INTERVAL_MS);
      }
    };

    const handleVisibilityChange = () => {
      clearTimer();
      if (document.visibilityState !== "visible") {
        controller?.abort();
        return;
      }
      void poll();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (document.visibilityState === "visible") void poll();

    return () => {
      disposed = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, preferenceLoaded]);

  const agents = useMemo(() => buildOmlxOfficeAgents(residents), [residents]);
  const activeCount = useMemo(
    () => residents.filter((resident) => resident.active).length,
    [residents],
  );
  const statusText = !preferenceLoaded
    ? "Loading"
    : status === "off"
      ? "Off"
      : status === "loading"
        ? "Loading"
        : status === "login-required"
          ? "Login required"
          : status === "unavailable"
            ? "Unavailable"
            : status === "retrying"
              ? `Retrying · ${residents.length} visible`
              : `${activeCount} active · ${residents.length} visible`;

  return {
    activeCount,
    agents,
    enabled,
    preferenceLoaded,
    residents,
    setEnabled,
    status,
    statusText,
  };
};
