import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/hagezi/dns-blocklists/refs/heads/main/wildcard/urlshortener-onlydomains.txt";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(scriptDir, "../src/url-shortener-domains.json");

function normalizeDomain(rawDomain) {
  const trimmed = rawDomain.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  return trimmed;
}

function parseDomains(payload) {
  const domains = [];
  const seen = new Set();
  const lines = payload.split(/\r?\n/);

  for (const line of lines) {
    const domain = normalizeDomain(line);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }

  return { domains, totalLines: lines.length };
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${SOURCE_URL} (${response.status})`);
  }

  const body = await response.text();
  const { domains, totalLines } = parseDomains(body);
  const payload = {
    source_url: SOURCE_URL,
    source_last_modified: response.headers.get("last-modified"),
    generated_at: new Date().toISOString(),
    total_source_lines: totalLines,
    total_domains: domains.length,
    domains,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outputPath}`);
  console.log(`domains=${domains.length}`);
}

await main();
