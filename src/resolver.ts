import { env } from "cloudflare:workers";

import { NormalizedTarget } from "./request";
import { WorkerInfo } from "./worker";

type HeaderMap = Record<string, string>;

type StopReason =
  | "non_redirect_status"
  | "missing_location_header"
  | "invalid_location_header"
  | "same_url_redirect"
  | "cross_domain_redirect"
  | "max_hops_reached"
  | "upstream_timeout";

type ResolveHop = {
  index: number;
  url: string;
  host: string;
  next_url: string | null;
  status: number;
  timing_ms: number;
  response_headers?: HeaderMap;
};

type ResolveResult = {
  urls: {
    input: string;
    extended: string;
    destination: string;
  };
  stop_reason: StopReason;
  redirects_followed: number;
  status: number;
  timing_ms: number;
  worker?: WorkerInfo;
  hops: ResolveHop[];
};

function headersToObject(headers: Headers): HeaderMap {
  return Object.fromEntries(headers.entries());
}

async function fetchWithTimeout(input: RequestInfo | URL): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.UPSTREAM_TIMEOUT_MS);

  try {
    return await fetch(input, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": env.RESOLVER_USER_AGENT,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveUrl(
  url: NormalizedTarget,
): Promise<ResolveResult> {
  const startedAt = performance.now();
  const hops: ResolveHop[] = [];
  const originHost = url.target.hostname.toLowerCase();
  let current = url.target;
  let redirectsFollowed = 0;
  let status = 0;
  let stopReason: StopReason = "max_hops_reached";

  for (let i = 0; i < env.MAX_HOPS; i += 1) {
    const hopStartedAt = performance.now();
    let response: Response;

    try {
      response = await fetchWithTimeout(current.toString());
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        stopReason = "upstream_timeout";
        status = 504;
        hops.push({
          index: i + 1,
          url: current.toString(),
          host: current.hostname,
          next_url: null,
          status: 504,
          timing_ms: performance.now() - hopStartedAt,
        });
        break;
      }

      throw error;
    }

    const hopTimingMs = performance.now() - hopStartedAt;
    const location = response.headers.get("location");
    let nextUrl: string | null = null;
    if (location) {
      try {
        nextUrl = new URL(location, current).toString();
      } catch {
        nextUrl = null;
      }
    }

    status = response.status;
    hops.push({
      index: i + 1,
      url: current.toString(),
      host: current.hostname,
      next_url: nextUrl,
      status: response.status,
      timing_ms: hopTimingMs,
      response_headers: headersToObject(response.headers),
    });

    if (response.status < 300 || response.status >= 400) {
      stopReason = "non_redirect_status";
      break;
    }

    if (!location) {
      stopReason = "missing_location_header";
      break;
    }

    if (!nextUrl) {
      stopReason = "invalid_location_header";
      break;
    }

    const next = new URL(nextUrl);

    if (next.toString() === current.toString()) {
      stopReason = "same_url_redirect";
      break;
    }

    redirectsFollowed += 1;
    if (next.hostname.toLowerCase() !== originHost) {
      stopReason = "cross_domain_redirect";
      current = next;
      break;
    }

    current = next;
  }

  return {
    urls: {
      input: url.raw,
      extended: url.target.toString(),
      destination: current.toString(),
    },
    stop_reason: stopReason,
    redirects_followed: redirectsFollowed,
    status,
    timing_ms: performance.now() - startedAt,
    hops,
  };
}
