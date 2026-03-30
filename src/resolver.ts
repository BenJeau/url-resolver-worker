import { env } from "cloudflare:workers";

import { NormalizedTarget } from "./request";
import {
  selectRandomUserAgents,
  SelectedUserAgent,
  UserAgentType,
} from "./user-agent";
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

type UserAgentRetryReason =
  | "app_store_redirect"
  | "non_http_https_scheme"
  | "non_redirect_status";

type AttemptedUserAgent = SelectedUserAgent & {
  retry_reason?: UserAgentRetryReason;
  resolved_url?: string | null;
};

type UserAgentRetryDetails = {
  reason: UserAgentRetryReason;
  resolved_url: string | null;
};

type ResolveHop = {
  request: {
    url: string;
    user_agents?: AttemptedUserAgent[];
  };
  next_url: string | null;
  status: number;
  timing_ms: number;
  response_headers?: HeaderMap;
};

type ResolveResult = {
  urls: {
    input: string;
    normalized: string;
    destination: string;
  };
  user_agent: SelectedUserAgent | null;
  stop_reason: StopReason;
  redirects_followed: number;
  status: number;
  timing_ms: number;
  worker?: WorkerInfo;
  hops: ResolveHop[];
};

const APP_STORE_HOSTNAMES = new Set([
  "play.google.com",
  "market.android.com",
  "apps.apple.com",
  "itunes.apple.com",
]);
const MOBILE_USER_AGENTS = new Set(["ios", "android"]);

function headersToObject(headers: Headers): HeaderMap {
  return Object.fromEntries(headers.entries());
}

function resolveLocationUrl(rawLocation: string, base: URL): URL | null {
  try {
    return new URL(rawLocation, base);
  } catch {
    return null;
  }
}

function isHttpOrHttps(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function isMobileUserAgentType(userAgentType: UserAgentType): boolean {
  return MOBILE_USER_AGENTS.has(userAgentType);
}

function isAppStoreRedirectUrl(url: URL): boolean {
  if (!isHttpOrHttps(url)) return false;
  return APP_STORE_HOSTNAMES.has(url.hostname.toLowerCase());
}

function getUserAgentRetryReason(
  response: Response,
  currentUrl: URL,
  userAgentType: UserAgentType | undefined,
  enforceHttpScheme: boolean,
): UserAgentRetryDetails | null {
  const location = response.headers.get("location");

  if (location) {
    const parsedLocation = resolveLocationUrl(location, currentUrl);
    const resolvedUrl = parsedLocation?.toString() ?? null;

    if (
      parsedLocation &&
      userAgentType &&
      isMobileUserAgentType(userAgentType) &&
      isAppStoreRedirectUrl(parsedLocation)
    ) {
      return {
        reason: "app_store_redirect",
        resolved_url: resolvedUrl,
      };
    }

    if (enforceHttpScheme) {
      if (!parsedLocation || !isHttpOrHttps(parsedLocation)) {
        return {
          reason: "non_http_https_scheme",
          resolved_url: resolvedUrl,
        };
      }
    }
    return null;
  }

  if (response.status === 200) {
    return { reason: "non_redirect_status", resolved_url: null };
  }
  return null;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  userAgent: string | null,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.UPSTREAM_TIMEOUT_MS);

  try {
    return await fetch(input, {
      method: "GET",
      redirect: "manual",
      headers: userAgent ? { "user-agent": userAgent } : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveUrl(
  url: NormalizedTarget,
  userAgentTypes: UserAgentType[],
  enforceHttpScheme = true,
): Promise<ResolveResult> {
  const startedAt = performance.now();
  const hops: ResolveHop[] = [];
  const originHost = url.target.hostname.toLowerCase();
  const selectedUserAgents = selectRandomUserAgents(userAgentTypes);
  const userAgentsToTry: Array<SelectedUserAgent | null> =
    selectedUserAgents.length > 0 ? selectedUserAgents : [null];
  let current = url.target;
  let redirectsFollowed = 0;
  let status = 0;
  let userAgent: SelectedUserAgent | null = null;
  let stopReason: StopReason = "max_hops_reached";

  for (let i = 0; i < env.MAX_HOPS; i += 1) {
    const hopStartedAt = performance.now();
    let response: Response | null = null;
    const attemptedUserAgents: AttemptedUserAgent[] = [];

    for (let attempt = 0; attempt < userAgentsToTry.length; attempt += 1) {
      const candidateUserAgent = userAgentsToTry[attempt];
      const attemptedUserAgent: AttemptedUserAgent | null = candidateUserAgent
        ? { type: candidateUserAgent.type, value: candidateUserAgent.value }
        : null;
      if (attemptedUserAgent) attemptedUserAgents.push(attemptedUserAgent);

      try {
        const candidateResponse = await fetchWithTimeout(
          current.toString(),
          candidateUserAgent?.value ?? null,
        );
        const retryDetails =
          attempt < userAgentsToTry.length - 1
            ? getUserAgentRetryReason(
                candidateResponse,
                current,
                candidateUserAgent?.type,
                enforceHttpScheme,
              )
            : null;

        if (retryDetails) {
          if (attemptedUserAgent) {
            attemptedUserAgent.retry_reason = retryDetails.reason;
            attemptedUserAgent.resolved_url = retryDetails.resolved_url;
          }
          continue;
        }

        response = candidateResponse;
        userAgent = candidateUserAgent
          ? { type: candidateUserAgent.type, value: candidateUserAgent.value }
          : null;
        break;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          stopReason = "upstream_timeout";
          status = 504;
          userAgent = candidateUserAgent
            ? { type: candidateUserAgent.type, value: candidateUserAgent.value }
            : null;
          hops.push({
            request: {
              url: current.toString(),
              user_agents:
                attemptedUserAgents.length > 0
                  ? attemptedUserAgents
                  : undefined,
            },
            next_url: null,
            status: 504,
            timing_ms: performance.now() - hopStartedAt,
          });
          break;
        }
        throw error;
      }
    }

    if (stopReason === "upstream_timeout") {
      break;
    }

    if (!response) {
      throw new Error(
        "No upstream response available after user-agent attempts",
      );
    }

    const hopTimingMs = performance.now() - hopStartedAt;
    const location = response.headers.get("location");
    const nextUrl = location
      ? (resolveLocationUrl(location, current)?.toString() ?? null)
      : null;

    status = response.status;
    hops.push({
      request: {
        url: current.toString(),
        user_agents:
          attemptedUserAgents.length > 0 ? attemptedUserAgents : undefined,
      },
      next_url: nextUrl,
      status: response.status,
      timing_ms: hopTimingMs,
      response_headers: headersToObject(response.headers),
    });

    if (!location) {
      if (response.status >= 300 && response.status < 400) {
        stopReason = "missing_location_header";
      } else {
        stopReason = "non_redirect_status";
      }
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
      normalized: url.target.toString(),
      destination: current.toString(),
    },
    user_agent: userAgent,
    stop_reason: stopReason,
    redirects_followed: redirectsFollowed,
    status,
    timing_ms: performance.now() - startedAt,
    hops,
  };
}
