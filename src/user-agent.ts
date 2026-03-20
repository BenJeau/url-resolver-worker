import userAgentPoolsFile from "./user-agent-pools.json";

export const USER_AGENT_TYPES = ["ios", "android", "mac", "windows"] as const;
export type UserAgentType = (typeof USER_AGENT_TYPES)[number];

const USER_AGENT_TYPE_SET: ReadonlySet<string> = new Set(USER_AGENT_TYPES);

function normalizeUserAgentType(raw: string | null): UserAgentType | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!USER_AGENT_TYPE_SET.has(normalized)) return null;
  return normalized as UserAgentType;
}

export function extractUserAgentType(url: URL): UserAgentType | null {
  return normalizeUserAgentType(url.searchParams.get("user-agent"));
}

export function selectRandomUserAgent(
  userAgentType: UserAgentType | null,
): string | null {
  if (!userAgentType) return null;
  const candidates = userAgentPoolsFile.pools[userAgentType];
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}
