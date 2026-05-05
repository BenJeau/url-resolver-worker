import {
  EmbeddedCandidateSource,
  EmbeddedHostMatcher,
  EmbeddedPathMatcher,
  EmbeddedRedirectRule,
  embeddedRedirectRules,
} from "./embedded-url-rules";

const MAX_EXTRACTION_DEPTH = 10;
export type EmbeddedExtractionResult = {
  destination: URL;
  ruleId: string | null;
  hops: Array<{ next_url: string; rule_id: string }>;
};

function endsWithHostname(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function isHttpOrHttps(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function decodeRecursively(value: string): string {
  let current = value;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function parseEmbeddedCandidate(candidate: string): URL | null {
  const decoded = decodeRecursively(candidate.trim());
  if (decoded.length === 0) return null;

  const tryParse = (input: string): URL | null => {
    try {
      const parsed = new URL(input);
      return isHttpOrHttps(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(decoded);
  if (direct) return direct;

  if (!decoded.includes("://")) {
    return tryParse(`https://${decoded}`);
  }

  return null;
}

function matchesHost(
  hostname: string,
  matcher: EmbeddedHostMatcher | undefined,
): boolean {
  if (!matcher) return true;
  if (matcher.equals && !matcher.equals.includes(hostname)) return false;
  if (
    matcher.includes &&
    !matcher.includes.some((value) => hostname.includes(value))
  ) {
    return false;
  }
  if (
    matcher.suffix &&
    !matcher.suffix.some((suffix) => endsWithHostname(hostname, suffix))
  ) {
    return false;
  }
  if (matcher.regex && !matcher.regex.test(hostname)) return false;
  return true;
}

function matchesPath(
  pathname: string,
  matcher: EmbeddedPathMatcher | undefined,
): boolean {
  if (!matcher) return true;
  if (matcher.equals && !matcher.equals.includes(pathname)) return false;
  if (
    matcher.startsWith &&
    !matcher.startsWith.some((prefix) => pathname.startsWith(prefix))
  ) {
    return false;
  }
  return true;
}

function extractBySource(
  url: URL,
  source: EmbeddedCandidateSource,
): string | null {
  if (source.type === "query_param") {
    for (const key of source.keys) {
      const value = url.searchParams.get(key);
      if (value) return value;
    }
    return null;
  }

  if (source.type === "path_prefix") {
    if (!url.pathname.startsWith(source.prefix)) return null;
    return url.pathname.slice(source.prefix.length);
  }

  return null;
}

function extractCandidateByRule(
  url: URL,
  rule: EmbeddedRedirectRule,
): URL | null {
  const hostname = url.hostname.toLowerCase();

  if (!matchesHost(hostname, rule.host)) return null;
  if (!matchesPath(url.pathname, rule.path)) return null;

  for (const source of rule.candidate_sources) {
    const candidate = extractBySource(url, source);
    if (!candidate) continue;
    const parsed = parseEmbeddedCandidate(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function extractOnce(url: URL): { destination: URL; ruleId: string } | null {
  for (const rule of embeddedRedirectRules) {
    const parsed = extractCandidateByRule(url, rule);
    if (parsed) {
      return { destination: parsed, ruleId: rule.id };
    }
  }
  return null;
}

export function extractEmbeddedDestination(url: URL): EmbeddedExtractionResult {
  let current = url;
  let ruleId: string | null = null;
  const hops: Array<{ next_url: string; rule_id: string }> = [];
  const seen = new Set<string>([current.toString()]);

  for (let i = 0; i < MAX_EXTRACTION_DEPTH; i += 1) {
    const extracted = extractOnce(current);
    if (!extracted) break;

    const next = extracted.destination.toString();
    if (seen.has(next)) break;
    seen.add(next);
    current = extracted.destination;
    ruleId = extracted.ruleId;
    hops.push({ next_url: next, rule_id: extracted.ruleId });
  }

  return { destination: current, ruleId, hops };
}
