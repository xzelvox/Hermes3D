import type { OfficeAgent } from "@/features/retro-office/core/types";
import {
  AGENT_AVATAR_FEMALE_PRESETS,
  applyAgentAvatarFemalePreset,
  createDefaultAgentAvatarProfile,
} from "@/lib/avatars/profile";

export const OMLX_AGENT_PREFIX = "omlx:";
export const OMLX_MIN_RESIDENCE_MS = 30 * 60 * 1_000;

export const OMLX_AGENT_NAMES = [
  "LEESEO",
  "RUKA",
  "PHARITA",
  "ASA",
  "AHYEON",
  "RAMI",
  "RORA",
  "CHIQUITA",
] as const;

export type OmlxActivityPhase =
  | "waiting"
  | "prefilling"
  | "generating"
  | "active";

export type OmlxModelActivity = {
  modelId: string;
  phase: OmlxActivityPhase;
  activeRequests: number;
  waitingRequests: number;
  promptTokens: number;
  generatedTokens: number;
  tokensPerSecond: number;
  elapsedSeconds: number;
};

export type OmlxActivityResponse = {
  status: "ok" | "login-required" | "unavailable";
  models: OmlxModelActivity[];
};

export type OmlxResidentAgent = OmlxModelActivity & {
  id: string;
  name: string;
  presetId: string;
  active: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  residentUntil: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const toSafeNumber = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(number, Number.MAX_SAFE_INTEGER);
};

const asRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const sumField = (items: Record<string, unknown>[], field: string) =>
  items.reduce((total, item) => total + toSafeNumber(item[field]), 0);

const maxField = (items: Record<string, unknown>[], fields: string[]) =>
  items.reduce(
    (maximum, item) =>
      Math.max(maximum, ...fields.map((field) => toSafeNumber(item[field]))),
    0,
  );

export const parseOmlxActivityPayload = (payload: unknown): OmlxModelActivity[] => {
  if (!isRecord(payload) || !isRecord(payload.active_models)) return [];
  const models = asRecords(payload.active_models.models);
  const parsed: OmlxModelActivity[] = [];

  for (const model of models) {
    const modelId = typeof model.id === "string" ? model.id.trim() : "";
    if (!modelId || modelId.length > 512) continue;

    const waiting = asRecords(model.waiting);
    const prefilling = asRecords(model.prefilling);
    const generating = asRecords(model.generating);
    const activities = asRecords(model.activities);
    const reportedActive = toSafeNumber(model.active_requests);
    const waitingRequests = Math.max(
      toSafeNumber(model.waiting_requests),
      waiting.length,
    );
    const activeRequests = Math.max(
      reportedActive,
      prefilling.length + generating.length + activities.length,
    );
    if (
      activeRequests === 0 &&
      waitingRequests === 0 &&
      prefilling.length === 0 &&
      generating.length === 0 &&
      activities.length === 0
    ) {
      continue;
    }

    const phase: OmlxActivityPhase =
      generating.length > 0
        ? "generating"
        : prefilling.length > 0
          ? "prefilling"
          : waitingRequests > 0
            ? "waiting"
            : "active";
    const promptTokens =
      sumField(waiting, "prompt_tokens") +
      sumField(prefilling, "total") +
      sumField(generating, "prompt_tokens") +
      sumField(activities, "prompt_tokens");
    const generatedTokens =
      sumField(generating, "generated_tokens") +
      sumField(activities, "generated_tokens");
    const tokensPerSecond =
      sumField(generating, "tokens_per_second") +
      sumField(activities, "tokens_per_second") +
      (phase === "prefilling" ? sumField(prefilling, "speed") : 0);
    const elapsedSeconds = Math.max(
      maxField(waiting, ["elapsed_seconds"]),
      maxField(prefilling, ["elapsed", "elapsed_seconds"]),
      maxField(generating, ["elapsed_seconds"]),
      maxField(activities, ["elapsed_seconds"]),
    );

    parsed.push({
      modelId,
      phase,
      activeRequests,
      waitingRequests,
      promptTokens,
      generatedTokens,
      tokensPerSecond,
      elapsedSeconds,
    });
  }

  return parsed.sort((left, right) => left.modelId.localeCompare(right.modelId));
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pickAvailableName = (modelId: string, usedNames: Set<string>) => {
  const start = hashString(`name:${modelId}`) % OMLX_AGENT_NAMES.length;
  for (let offset = 0; offset < OMLX_AGENT_NAMES.length; offset += 1) {
    const name = OMLX_AGENT_NAMES[(start + offset) % OMLX_AGENT_NAMES.length];
    if (!usedNames.has(name)) return name;
  }
  return OMLX_AGENT_NAMES[start];
};

const pickPresetId = (modelId: string) =>
  AGENT_AVATAR_FEMALE_PRESETS[
    hashString(`avatar:${modelId}`) % AGENT_AVATAR_FEMALE_PRESETS.length
  ].id;

export const reconcileOmlxResidents = (
  previous: OmlxResidentAgent[],
  activeModels: OmlxModelActivity[],
  now: number,
): OmlxResidentAgent[] => {
  const activeByModelId = new Map(
    activeModels.map((model) => [model.modelId, model] as const),
  );
  const next: OmlxResidentAgent[] = [];

  for (const resident of previous) {
    const activity = activeByModelId.get(resident.modelId);
    if (activity) {
      next.push({
        ...resident,
        ...activity,
        active: true,
        lastSeenAt: now,
        residentUntil: resident.active
          ? resident.residentUntil
          : now + OMLX_MIN_RESIDENCE_MS,
      });
      activeByModelId.delete(resident.modelId);
    } else if (resident.residentUntil > now) {
      next.push({ ...resident, active: false });
    }
  }

  const usedNames = new Set(next.map((resident) => resident.name));
  for (const activity of [...activeByModelId.values()].sort((left, right) =>
    left.modelId.localeCompare(right.modelId),
  )) {
    const name = pickAvailableName(activity.modelId, usedNames);
    usedNames.add(name);
    next.push({
      ...activity,
      id: `${OMLX_AGENT_PREFIX}${activity.modelId}`,
      name,
      presetId: pickPresetId(activity.modelId),
      active: true,
      firstSeenAt: now,
      lastSeenAt: now,
      residentUntil: now + OMLX_MIN_RESIDENCE_MS,
    });
  }

  return next.sort((left, right) => left.id.localeCompare(right.id));
};

export const isOmlxOfficeAgentId = (agentId: string) =>
  agentId.startsWith(OMLX_AGENT_PREFIX);

export const buildOmlxOfficeAgents = (
  residents: OmlxResidentAgent[],
): OfficeAgent[] =>
  residents.map((resident) => {
    const profile = applyAgentAvatarFemalePreset(
      createDefaultAgentAvatarProfile(resident.id),
      resident.presetId,
    );
    const color = `#${hashString(resident.id)
      .toString(16)
      .padStart(8, "0")
      .slice(-6)}`;
    return {
      id: resident.id,
      name: resident.name,
      subtitle: resident.active ? resident.modelId : "oMLX resident",
      status: resident.active ? "working" : "idle",
      color,
      item: "laptop",
      avatarProfile: profile,
    };
  });
