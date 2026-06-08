#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

const samples = [
  {
    name: "bit.ly redirect",
    url: "http://bit.ly/GVBQJS",
    expectedHost: "unshorten.it",
    optional: true,
  },
  {
    name: "is.gd redirect",
    url: "https://is.gd/jGamH3",
    expectedHost: "example.com",
    optional: false,
  },
  {
    name: "tinyurl redirect",
    url: "https://tinyurl.com/peakb",
    expectedHost: "example.com",
    optional: true,
  },
];

function parseArgs(argv) {
  let baseUrl = process.env.SMOKE_BASE_URL ?? DEFAULT_BASE_URL;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/smoke-resolve.mjs [--base-url <worker-url>]

Environment:
  SMOKE_BASE_URL   Worker base URL (default: ${DEFAULT_BASE_URL})
`);
      process.exit(0);
    }
  }
  return { baseUrl: baseUrl.replace(/\/$/, "") };
}

function destinationHost(destination) {
  try {
    return new URL(destination).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function resolveSample(baseUrl, sample) {
  const endpoint = `${baseUrl}/?url=${encodeURIComponent(sample.url)}`;
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  const host = destinationHost(payload?.urls?.destination);
  if (!host) {
    throw new Error(`Missing destination URL in response: ${JSON.stringify(payload)}`);
  }

  const expected = sample.expectedHost.replace(/^www\./, "");
  if (!host.endsWith(expected)) {
    throw new Error(
      `Expected destination host *${expected}, got ${host} (destination=${payload.urls.destination})`,
    );
  }

  if (!Array.isArray(payload.hops) || payload.hops.length === 0) {
    throw new Error("Expected at least one hop in response");
  }

  return {
    stopReason: payload.stop_reason,
    destination: payload.urls.destination,
    hops: payload.hops.length,
  };
}

async function main() {
  const { baseUrl } = parseArgs(process.argv);
  console.log(`Smoke testing resolver at ${baseUrl}`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const sample of samples) {
    process.stdout.write(`- ${sample.name} ... `);
    try {
      const result = await resolveSample(baseUrl, sample);
      passed += 1;
      console.log(
        `ok (${result.stopReason}, hops=${result.hops}, destination=${result.destination})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sample.optional) {
        skipped += 1;
        console.log(`skipped (${message})`);
      } else {
        failed += 1;
        console.log(`FAIL (${message})`);
      }
    }
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exit(1);
  }
}

await main();
