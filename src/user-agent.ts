import userAgentPoolsFile from "./user-agent-pools.json";

export const USER_AGENT_TYPES = ["ios", "android", "mac", "windows"] as const;
export type UserAgentType = (typeof USER_AGENT_TYPES)[number];
export type SelectedUserAgent = { type: UserAgentType; value: string };

const USER_AGENT_TYPE_SET: ReadonlySet<string> = new Set(USER_AGENT_TYPES);

function normalizeUserAgentType(raw: string): UserAgentType | null {
  const normalized = raw.trim().toLowerCase();
  if (!USER_AGENT_TYPE_SET.has(normalized)) return null;
  return normalized as UserAgentType;
}

export function extractUserAgentTypes(url: URL): UserAgentType[] {
  const raw = url.searchParams.get("user-agent");
  const normalized = raw?.split(",").map(normalizeUserAgentType) ?? [];
  return normalized.filter((type) => type !== null);
}

function selectRandomUserAgent(
  userAgentType: UserAgentType | null,
): SelectedUserAgent | null {
  if (!userAgentType) return null;
  const candidates = userAgentPoolsFile.pools[userAgentType];
  return {
    value: candidates[Math.floor(Math.random() * candidates.length)],
    type: userAgentType,
  };
}

export function selectRandomUserAgents(
  userAgentTypes: UserAgentType[],
): SelectedUserAgent[] {
  return userAgentTypes
    .map(selectRandomUserAgent)
    .filter((userAgent) => userAgent !== null);
}
