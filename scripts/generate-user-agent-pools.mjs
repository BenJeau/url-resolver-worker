import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://microlink.io/user-agents.json";
const IOS_PATTERN = /iPhone|iPad|iPod/i;
const ANDROID_PATTERN = /Android/i;
const MAC_PATTERN = /Macintosh|Mac OS X/i;
const WINDOWS_PATTERN = /Windows NT/i;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(scriptDir, "../src/user-agent-pools.json");

function addUnique(list, seen, userAgent) {
  if (seen.has(userAgent)) return;
  seen.add(userAgent);
  list.push(userAgent);
}

function buildPools(userAgents) {
  const pools = {
    ios: [],
    android: [],
    macos: [],
    windows: [],
  };

  const seenByType = {
    ios: new Set(),
    android: new Set(),
    macos: new Set(),
    windows: new Set(),
  };

  for (const value of userAgents) {
    if (typeof value !== "string") continue;
    const userAgent = value.trim();
    if (!userAgent) continue;

    const isIos = IOS_PATTERN.test(userAgent);
    const isAndroid = ANDROID_PATTERN.test(userAgent);
    const isMac = MAC_PATTERN.test(userAgent);
    const isWindows = WINDOWS_PATTERN.test(userAgent);

    if (isIos) addUnique(pools.ios, seenByType.ios, userAgent);
    if (isAndroid) addUnique(pools.android, seenByType.android, userAgent);
    if (isWindows) addUnique(pools.windows, seenByType.windows, userAgent);
    if (isMac && !isIos) addUnique(pools.macos, seenByType.macos, userAgent);
  }

  return pools;
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${SOURCE_URL} (${response.status})`);
  }

  const source = await response.json();
  if (!source || typeof source !== "object") {
    throw new Error("Invalid response payload from Microlink");
  }

  const userAgents = Array.isArray(source.user) ? source.user : [];
  const pools = buildPools(userAgents);

  const payload = {
    source_url: SOURCE_URL,
    source_updated_at:
      typeof source.updatedAt === "number" ? source.updatedAt : null,
    generated_at: new Date().toISOString(),
    total_source_user_agents: userAgents.length,
    pools,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outputPath}`);
  console.log(
    `ios=${pools.ios.length} android=${pools.android.length} macos=${pools.macos.length} windows=${pools.windows.length}`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Failed to generate user-agent pools",
  );
  process.exit(1);
});
