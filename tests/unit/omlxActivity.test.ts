import { describe, expect, it } from "vitest";

import {
  OMLX_AGENT_NAMES,
  OMLX_MIN_RESIDENCE_MS,
  buildOmlxOfficeAgents,
  parseOmlxActivityPayload,
  reconcileOmlxResidents,
  type OmlxModelActivity,
} from "@/lib/omlx/activity";
import { AGENT_AVATAR_FEMALE_PRESETS } from "@/lib/avatars/profile";

const activity = (modelId: string): OmlxModelActivity => ({
  modelId,
  phase: "generating",
  activeRequests: 1,
  waitingRequests: 0,
  promptTokens: 120,
  generatedTokens: 24,
  tokensPerSecond: 12.5,
  elapsedSeconds: 2,
});

describe("oMLX activity parser", () => {
  it("keeps only active models and aggregates safe metrics", () => {
    const models = parseOmlxActivityPayload({
      active_models: {
        models: [
          {
            id: "idle-model",
            active_requests: 0,
            waiting_requests: 0,
            waiting: [],
            prefilling: [],
            generating: [],
            activities: [],
          },
          {
            id: "generating-model",
            active_requests: 0,
            waiting_requests: 1,
            waiting: [{ prompt_tokens: 20, elapsed_seconds: 4 }],
            prefilling: [{ total: 100, speed: 25, elapsed: 3 }],
            generating: [
              {
                prompt_tokens: 120,
                generated_tokens: 40,
                tokens_per_second: 10.5,
                elapsed_seconds: 5,
                request_id: "secret-request-id",
              },
            ],
            activities: [],
          },
        ],
      },
    });

    expect(models).toEqual([
      {
        modelId: "generating-model",
        phase: "generating",
        activeRequests: 2,
        waitingRequests: 1,
        promptTokens: 240,
        generatedTokens: 40,
        tokensPerSecond: 10.5,
        elapsedSeconds: 5,
      },
    ]);
    expect(JSON.stringify(models)).not.toContain("secret-request-id");
  });

  it("accepts waiting-only activity and normalizes invalid numbers", () => {
    const models = parseOmlxActivityPayload({
      active_models: {
        models: [
          {
            id: "queued-model",
            active_requests: -1,
            waiting_requests: 1,
            waiting: [{ prompt_tokens: "not-a-number", elapsed_seconds: 2 }],
          },
        ],
      },
    });

    expect(models[0]).toMatchObject({
      modelId: "queued-model",
      phase: "waiting",
      activeRequests: 0,
      waitingRequests: 1,
      promptTokens: 0,
      elapsedSeconds: 2,
    });
  });
});

describe("oMLX resident agents", () => {
  it("stays for 30 minutes, remains while active, and leaves after stopping", () => {
    const startedAt = 10_000;
    const first = reconcileOmlxResidents([], [activity("model-a")], startedAt);
    expect(first[0]).toMatchObject({ active: true, firstSeenAt: startedAt });

    const stopped = reconcileOmlxResidents(first, [], startedAt + 1_000);
    expect(stopped[0]).toMatchObject({ active: false, firstSeenAt: startedAt });

    const stillActive = reconcileOmlxResidents(
      stopped,
      [activity("model-a")],
      startedAt + OMLX_MIN_RESIDENCE_MS + 1,
    );
    expect(stillActive[0]).toMatchObject({
      active: true,
      firstSeenAt: startedAt,
      residentUntil:
        startedAt + OMLX_MIN_RESIDENCE_MS + 1 + OMLX_MIN_RESIDENCE_MS,
    });

    const stoppedAgain = reconcileOmlxResidents(
      stillActive,
      [],
      startedAt + OMLX_MIN_RESIDENCE_MS + 2,
    );
    expect(stoppedAgain).toHaveLength(1);

    const removed = reconcileOmlxResidents(
      stoppedAgain,
      [],
      startedAt + OMLX_MIN_RESIDENCE_MS * 2 + 2,
    );
    expect(removed).toEqual([]);
  });

  it("assigns eight unique requested names and only female presets", () => {
    const models = Array.from({ length: 8 }, (_, index) => activity(`model-${index}`));
    const residents = reconcileOmlxResidents([], models, 1_000);
    const names = residents.map((resident) => resident.name);
    const presetIds = new Set(AGENT_AVATAR_FEMALE_PRESETS.map((preset) => preset.id));

    expect(new Set(names).size).toBe(8);
    expect(names.every((name) => OMLX_AGENT_NAMES.includes(name as never))).toBe(true);
    expect(residents.every((resident) => presetIds.has(resident.presetId))).toBe(true);
    expect(buildOmlxOfficeAgents(residents)).toHaveLength(8);
  });

  it("reuses a name without failing when more than eight models are active", () => {
    const models = Array.from({ length: 9 }, (_, index) => activity(`model-${index}`));
    const residents = reconcileOmlxResidents([], models, 1_000);
    expect(residents).toHaveLength(9);
    expect(new Set(residents.map((resident) => resident.name)).size).toBe(8);
  });
});
