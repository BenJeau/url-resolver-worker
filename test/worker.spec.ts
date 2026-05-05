import userAgentPoolsFile from "../src/user-agent-pools.json";
import { USER_AGENT_HEADER_TYPES, type UserAgentType } from "../src/user-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SELF } from "cloudflare:test";

type UpstreamHandler = (request: Request) => Response | Promise<Response>;
type ResolvePayload = {
  urls: {
    input: string;
    normalized: string;
    raw_destination: string;
    destination: string;
  };
  embedded_url_rule: string | null;
  user_agent: { type: UserAgentType; value: string | null } | null;
  stop_reason: string;
  redirects_followed: number;
  status: number;
  hops: Array<{
    type: "resolve" | "extraction";
    request?: {
      url: string;
      user_agents?: Array<{
        type: UserAgentType;
        value: string | null;
        retry_reason?:
          | "app_store_redirect"
          | "non_http_https_scheme"
          | "non_redirect_status"
          | "missing_location_header"
          | "invalid_location_header"
          | "same_url_redirect"
          | "upstream_timeout";
        resolved_url?: string | null;
      }>;
    };
    next_url: string | null | string;
    status?: number;
    rule_id?: string;
  }>;
  worker: { ip: string | null };
};

const userAgentPools = userAgentPoolsFile.pools as Record<
  Exclude<UserAgentType, "none">,
  string[]
>;

function installUpstreamMock(routes: Record<string, UpstreamHandler>) {
  const handlers = new Map<string, UpstreamHandler>(
    Object.entries(routes).map(([url, handler]) => [
      new URL(url).toString(),
      handler,
    ]),
  );

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request =
        input instanceof Request
          ? init
            ? new Request(input, init)
            : input
          : new Request(input, init);
      const normalizedUrl = new URL(request.url).toString();
      const handler = handlers.get(normalizedUrl);
      if (!handler) {
        throw new Error(
          `Unexpected upstream fetch: ${request.method} ${normalizedUrl}`,
        );
      }
      return handler(request);
    },
  );

  vi.stubGlobal("fetch", fetchMock as typeof fetch);
  return fetchMock;
}

function firstResolveHop(payload: ResolvePayload) {
  return payload.hops.find((hop) => hop.type === "resolve");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("url-resolver worker", () => {
  it("returns 400 when url input is missing", async () => {
    const response = await SELF.fetch("https://resolver.test/");
    const payload = await response.json<{ error: string }>();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Provide a valid URL");
  });

  describe("request method and input source", () => {
    it("uses querystring url for GET requests", async () => {
      const fetchMock = installUpstreamMock({
        "https://from-query.test/": () => new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=from-query.test",
        { method: "GET" },
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.urls.input).toBe("from-query.test");
      expect(payload.urls.normalized).toBe("https://from-query.test/");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("uses plain text body url for POST requests", async () => {
      const fetchMock = installUpstreamMock({
        "https://from-post.test/path": () =>
          new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch("https://resolver.test/", {
        method: "POST",
        body: "from-post.test/path",
      });
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.urls.input).toBe("from-post.test/path");
      expect(payload.urls.normalized).toBe("https://from-post.test/path");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(["PATCH", "PUT", "OPTIONS", "DELETE"] as const)(
      "returns 405 for unsupported %s requests",
      async (method) => {
        const response = await SELF.fetch(
          "https://resolver.test/?url=should-not-run.test",
          { method },
        );
        const payload = await response.json<{ error: string }>();

        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, POST");
        expect(payload.error).toContain("Only GET and POST are supported");
      },
    );
  });

  describe("embedded redirect extraction", () => {
    it("extracts google /url destination before resolving", async () => {
      const fetchMock = installUpstreamMock({
        "https://destination.test/final": () =>
          new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=https%3A%2F%2Fwww.google.com%2Furl%3Fq%3Dhttps%253A%252F%252Fdestination.test%252Ffinal",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.urls.destination).toBe("https://destination.test/final");
      expect(payload.urls.raw_destination).toBe(
        "https://destination.test/final",
      );
      expect(payload.embedded_url_rule).toBe("google-url");
      expect(firstResolveHop(payload)?.request?.url).toBe(
        "https://destination.test/final",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("extracts youtube redirect destination before resolving", async () => {
      const fetchMock = installUpstreamMock({
        "https://destination.test/youtube": () =>
          new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=https%3A%2F%2Fwww.youtube.com%2Fredirect%3Fq%3Dhttps%253A%252F%252Fdestination.test%252Fyoutube",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.urls.destination).toBe("https://destination.test/youtube");
      expect(firstResolveHop(payload)?.request?.url).toBe(
        "https://destination.test/youtube",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("extracts facebook l.php destination before resolving", async () => {
      const fetchMock = installUpstreamMock({
        "https://destination.test/facebook": () =>
          new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=https%3A%2F%2Fl.facebook.com%2Fl.php%3Fu%3Dhttps%253A%252F%252Fdestination.test%252Ffacebook",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.urls.destination).toBe(
        "https://destination.test/facebook",
      );
      expect(firstResolveHop(payload)?.request?.url).toBe(
        "https://destination.test/facebook",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        "google /url with q",
        "https://www.google.com/url?q=https%3A%2F%2Fdestination.test%2Fgoogle-q",
        "https://destination.test/google-q",
      ],
      [
        "google /url with sa and q",
        "https://www.google.com/url?sa=D&q=https%3A%2F%2Fdestination.test%2Fgoogle-sa-q",
        "https://destination.test/google-sa-q",
      ],
      [
        "t.me iv redirect",
        "https://t.me/iv?url=https%3A%2F%2Fdestination.test%2Ftelegram",
        "https://destination.test/telegram",
      ],
      [
        "twitter unsafe link warning",
        "https://twitter.com/safety/unsafe_link_warning?unsafe_link=https%3A%2F%2Fdestination.test%2Ftwitter-warning",
        "https://destination.test/twitter-warning",
      ],
      [
        "facebook l.php",
        "https://l.facebook.com/l.php?u=https%3A%2F%2Fdestination.test%2Ffacebook-l",
        "https://destination.test/facebook-l",
      ],
      [
        "facebook mobile flx warn",
        "https://m.facebook.com/flx/warn/?u=https%3A%2F%2Fdestination.test%2Ffacebook-m",
        "https://destination.test/facebook-m",
      ],
      [
        "facebook web flx warn",
        "https://www.facebook.com/flx/warn/?u=https%3A%2F%2Fdestination.test%2Ffacebook-www",
        "https://destination.test/facebook-www",
      ],
      [
        "youtube redirect q",
        "https://www.youtube.com/redirect?q=https%3A%2F%2Fdestination.test%2Fyoutube-q",
        "https://destination.test/youtube-q",
      ],
      [
        "apis.google.com additnow __lu",
        "https://apis.google.com/additnow/l?applicationId=1&__ls=ogb&__lu=https%3A%2F%2Fdestination.test%2Fgoogle-additnow",
        "https://destination.test/google-additnow",
      ],
      [
        "instagram accounts login next",
        "https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.instagram.com%2Finsta%2F%3Fhl%3Den&is_from_rle",
        "https://www.instagram.com/insta/?hl=en",
      ],
    ])(
      "extracts %s destination before resolving",
      async (_label, wrappedUrl, expectedDestination) => {
        const fetchMock = installUpstreamMock({
          [expectedDestination]: () => new Response("ok", { status: 200 }),
        });

        const response = await SELF.fetch(
          `https://resolver.test/?url=${encodeURIComponent(wrappedUrl)}`,
        );
        const payload = await response.json<ResolvePayload>();

        expect(response.status).toBe(200);
        expect(payload.urls.destination).toBe(expectedDestination);
        expect(firstResolveHop(payload)?.request?.url).toBe(
          expectedDestination,
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
    );

    it("recursively unwraps nested redirect wrappers", async () => {
      const fetchMock = installUpstreamMock({
        "https://destination.test/nested": () =>
          new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=https%3A%2F%2Fwww.google.com%2Furl%3Fq%3Dhttps%253A%252F%252Fl.facebook.com%252Fl.php%253Fu%253Dhttps%25253A%25252F%25252Fdestination.test%25252Fnested",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.urls.destination).toBe("https://destination.test/nested");
      expect(payload.embedded_url_rule).toBe("facebook-lphp");
      expect(firstResolveHop(payload)?.request?.url).toBe(
        "https://destination.test/nested",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("unwraps google amp path URLs", async () => {
      const wrappedUrl =
        "https://www.google.com/amp/s/destination.test/google-amp";
      const expectedDestination = "https://destination.test/google-amp";
      const fetchMock = installUpstreamMock({
        [expectedDestination]: () => new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        `https://resolver.test/?url=${encodeURIComponent(wrappedUrl)}`,
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.urls.raw_destination).toBe(expectedDestination);
      expect(payload.urls.destination).toBe(expectedDestination);
      expect(payload.embedded_url_rule).toBe("google-amp-path");
      expect(firstResolveHop(payload)?.request?.url).toBe(expectedDestination);
      expect(payload.hops.some((hop) => hop.type === "extraction")).toBe(true);
      expect(payload.hops).toContainEqual({
        type: "extraction",
        next_url: expectedDestination,
        rule_id: "google-amp-path",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("unwraps google amp path URLs without /s/", async () => {
      const wrappedUrl =
        "https://www.google.com/amp/destination.test/google-amp-no-s";
      const expectedDestination = "https://destination.test/google-amp-no-s";
      const fetchMock = installUpstreamMock({
        [expectedDestination]: () => new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        `https://resolver.test/?url=${encodeURIComponent(wrappedUrl)}`,
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.urls.raw_destination).toBe(expectedDestination);
      expect(payload.urls.destination).toBe(expectedDestination);
      expect(payload.embedded_url_rule).toBe("google-amp-path-no-s");
      expect(firstResolveHop(payload)?.request?.url).toBe(expectedDestination);
      expect(payload.hops.some((hop) => hop.type === "extraction")).toBe(true);
      expect(payload.hops).toContainEqual({
        type: "extraction",
        next_url: expectedDestination,
        rule_id: "google-amp-path-no-s",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("extracts viglink redirect destination before resolving", async () => {
      const expectedDestination = "https://destination.test/viglink";
      const wrappedUrl = `https://redirect.viglink.com/?u=${encodeURIComponent(expectedDestination)}`;
      const fetchMock = installUpstreamMock({
        [expectedDestination]: () => new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        `https://resolver.test/?url=${encodeURIComponent(wrappedUrl)}`,
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.urls.raw_destination).toBe(expectedDestination);
      expect(payload.urls.destination).toBe(expectedDestination);
      expect(payload.embedded_url_rule).toBe("viglink-redirect");
      expect(firstResolveHop(payload)?.request?.url).toBe(expectedDestination);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("stop_reason coverage", () => {
    it("stops with non_redirect_status", async () => {
      installUpstreamMock({
        "https://ok.test/": () => new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch("https://resolver.test/?url=ok.test");
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.stop_reason).toBe("non_redirect_status");
      expect(payload.redirects_followed).toBe(0);
      expect(payload.status).toBe(200);
      expect(payload.hops).toHaveLength(1);
    });

    it("stops with missing_location_header", async () => {
      installUpstreamMock({
        "https://missing-location.test/": () =>
          new Response(null, { status: 302 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=missing-location.test",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.stop_reason).toBe("missing_location_header");
      expect(payload.redirects_followed).toBe(0);
      expect(payload.status).toBe(302);
      expect(payload.hops[0]?.next_url).toBeNull();
    });

    it("stops with invalid_location_header", async () => {
      installUpstreamMock({
        "https://invalid-location.test/": () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://[::1" },
          }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=invalid-location.test",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.stop_reason).toBe("invalid_location_header");
      expect(payload.redirects_followed).toBe(0);
      expect(payload.status).toBe(302);
      expect(payload.hops[0]?.next_url).toBeNull();
    });

    it("stops with same_url_redirect", async () => {
      installUpstreamMock({
        "https://same.test/start": () =>
          new Response(null, {
            status: 301,
            headers: { location: "https://same.test/start" },
          }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=same.test/start",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.stop_reason).toBe("same_url_redirect");
      expect(payload.redirects_followed).toBe(0);
      expect(payload.status).toBe(301);
      expect(payload.urls.destination).toBe("https://same.test/start");
    });

    it("stops with cross_domain_redirect", async () => {
      installUpstreamMock({
        "https://short.ly/start": () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://example.com/final" },
          }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=short.ly/start",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.redirects_followed).toBe(1);
      expect(payload.status).toBe(302);
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.hops).toHaveLength(1);
    });

    it("follows non-www to www redirect on the same domain", async () => {
      installUpstreamMock({
        "https://example.com/start": () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://www.example.com/final" },
          }),
        "https://www.example.com/final": () => new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=example.com/start",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.stop_reason).toBe("non_redirect_status");
      expect(payload.redirects_followed).toBe(1);
      expect(payload.status).toBe(200);
      expect(payload.urls.destination).toBe("https://www.example.com/final");
      expect(payload.hops).toHaveLength(2);
    });

    it("unwraps embedded destination after cross_domain_redirect", async () => {
      installUpstreamMock({
        "https://short.ly/start": () =>
          new Response(null, {
            status: 302,
            headers: {
              location:
                "https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fexample.com%2Ffinal&is_from_rle",
            },
          }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=short.ly/start",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.redirects_followed).toBe(1);
      expect(payload.status).toBe(302);
      expect(payload.hops).toHaveLength(2);
      expect(payload.hops[0]?.next_url).toBe(
        "https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fexample.com%2Ffinal&is_from_rle",
      );
      expect(payload.hops[0]?.type).toBe("resolve");
      expect(payload.hops[1]).toEqual({
        type: "extraction",
        next_url: "https://example.com/final",
        rule_id: "instagram-accounts-login",
      });
      expect(payload.urls.raw_destination).toBe(
        "https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fexample.com%2Ffinal&is_from_rle",
      );
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.embedded_url_rule).toBe("instagram-accounts-login");
    });

    it("stops with max_hops_reached", async () => {
      const routes: Record<string, UpstreamHandler> = {};
      let current = "https://loop.test/start";
      for (let i = 0; i < 10; i += 1) {
        const next = `https://loop.test/hop-${i + 1}`;
        routes[current] = () =>
          new Response(null, { status: 302, headers: { location: next } });
        current = next;
      }

      installUpstreamMock(routes);

      const response = await SELF.fetch(
        "https://resolver.test/?url=loop.test/start",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.stop_reason).toBe("max_hops_reached");
      expect(payload.redirects_followed).toBe(10);
      expect(payload.status).toBe(302);
      expect(payload.hops).toHaveLength(10);
      expect(payload.urls.destination).toBe("https://loop.test/hop-10");
    });

    it("stops with upstream_timeout when fetch aborts", async () => {
      installUpstreamMock({
        "https://timeout.test/": () => {
          const abortError = new Error("timed out");
          abortError.name = "AbortError";
          throw abortError;
        },
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=timeout.test",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.stop_reason).toBe("upstream_timeout");
      expect(payload.redirects_followed).toBe(0);
      expect(payload.status).toBe(504);
      expect(payload.hops).toHaveLength(1);
      expect(payload.hops[0]?.status).toBe(504);
      expect(payload.hops[0]?.next_url).toBeNull();
    });
  });

  describe("debug flag", () => {
    it("resolves worker IP when debug=true (case/whitespace tolerant)", async () => {
      const fetchMock = installUpstreamMock({
        "https://debug.test/": () => new Response("ok", { status: 200 }),
        "https://checkip.amazonaws.com/": () =>
          new Response("203.0.113.10\n", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=debug.test&debug=%20TrUe%20",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.worker.ip).toBe("203.0.113.10");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not resolve worker IP when debug is false", async () => {
      const fetchMock = installUpstreamMock({
        "https://debug-off.test/": () => new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=debug-off.test&debug=false",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.worker.ip).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("user-agent", () => {
    it.each(USER_AGENT_HEADER_TYPES)(
      "selects and reuses a %s user agent across hops",
      async (userAgentType) => {
        const requestUserAgents: Array<string | null> = [];
        installUpstreamMock({
          "https://ua.test/start": (request) => {
            requestUserAgents.push(request.headers.get("user-agent"));
            return new Response(null, {
              status: 302,
              headers: { location: "/done" },
            });
          },
          "https://ua.test/done": (request) => {
            requestUserAgents.push(request.headers.get("user-agent"));
            return new Response("ok", { status: 200 });
          },
        });

        vi.spyOn(Math, "random").mockReturnValue(0);

        const response = await SELF.fetch(
          `https://resolver.test/?url=ua.test/start&user-agent=${userAgentType.toUpperCase()}`,
        );
        const payload = await response.json<ResolvePayload>();
        const expected = userAgentPools[userAgentType][0];

        expect(response.status).toBe(200);
        expect(payload.user_agent).toEqual({
          type: userAgentType,
          value: expected,
        });
        expect(payload.hops[0]?.request.user_agents).toEqual([
          { type: userAgentType, value: expected },
        ]);
        expect(payload.hops[1]?.request.user_agents).toEqual([
          { type: userAgentType, value: expected },
        ]);
        expect(requestUserAgents).toEqual([expected, expected]);
      },
    );

    it("uses the explicit none user-agent type with no header", async () => {
      const requestUserAgents: Array<string | null> = [];
      installUpstreamMock({
        "https://ua-none.test/start": (request) => {
          requestUserAgents.push(request.headers.get("user-agent"));
          return new Response(null, {
            status: 302,
            headers: { location: "/done" },
          });
        },
        "https://ua-none.test/done": (request) => {
          requestUserAgents.push(request.headers.get("user-agent"));
          return new Response("ok", { status: 200 });
        },
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=ua-none.test/start&user-agent=none",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "none", value: null });
      expect(payload.hops[0]?.request.user_agents).toEqual([
        { type: "none", value: null },
      ]);
      expect(payload.hops[1]?.request.user_agents).toEqual([
        { type: "none", value: null },
      ]);
      expect(requestUserAgents).toEqual([null, null]);
    });

    it("tries ordered user-agent values when 200 has no location", async () => {
      const ios = userAgentPools.ios[0];
      const android = userAgentPools.android[0];
      const seenUserAgents: string[] = [];

      installUpstreamMock({
        "https://ua-chain.test/start": (request) => {
          const requestUserAgent = request.headers.get("user-agent");
          if (requestUserAgent) seenUserAgents.push(requestUserAgent);

          if (requestUserAgent === ios) {
            return new Response("landing page", { status: 200 });
          }

          if (requestUserAgent === android) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            });
          }

          throw new Error(`Unexpected user-agent: ${requestUserAgent}`);
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0);

      const response = await SELF.fetch(
        "https://resolver.test/?url=ua-chain.test/start&user-agent=ios,android",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "android", value: android });
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.hops[0]?.request.user_agents).toEqual([
        {
          type: "ios",
          value: ios,
          retry_reason: "non_redirect_status",
          resolved_url: null,
        },
        { type: "android", value: android },
      ]);
      expect(seenUserAgents).toEqual([ios, android]);
    });

    it("tries next user-agent when redirect has no location header", async () => {
      const ios = userAgentPools.ios[0];
      const android = userAgentPools.android[0];
      const seenUserAgents: string[] = [];

      installUpstreamMock({
        "https://ua-missing-location.test/start": (request) => {
          const requestUserAgent = request.headers.get("user-agent");
          if (requestUserAgent) seenUserAgents.push(requestUserAgent);

          if (requestUserAgent === ios) {
            return new Response(null, { status: 302 });
          }

          if (requestUserAgent === android) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            });
          }

          throw new Error(`Unexpected user-agent: ${requestUserAgent}`);
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0);

      const response = await SELF.fetch(
        "https://resolver.test/?url=ua-missing-location.test/start&user-agent=ios,android",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "android", value: android });
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.hops[0]?.request.user_agents).toEqual([
        {
          type: "ios",
          value: ios,
          retry_reason: "missing_location_header",
          resolved_url: null,
        },
        { type: "android", value: android },
      ]);
      expect(seenUserAgents).toEqual([ios, android]);
    });

    it("tries next user-agent when earlier attempt times out", async () => {
      const ios = userAgentPools.ios[0];
      const android = userAgentPools.android[0];
      const seenUserAgents: string[] = [];

      installUpstreamMock({
        "https://ua-timeout-chain.test/start": (request) => {
          const requestUserAgent = request.headers.get("user-agent");
          if (requestUserAgent) seenUserAgents.push(requestUserAgent);

          if (requestUserAgent === ios) {
            const abortError = new Error("timed out");
            abortError.name = "AbortError";
            throw abortError;
          }

          if (requestUserAgent === android) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            });
          }

          throw new Error(`Unexpected user-agent: ${requestUserAgent}`);
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0);

      const response = await SELF.fetch(
        "https://resolver.test/?url=ua-timeout-chain.test/start&user-agent=ios,android",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "android", value: android });
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.hops[0]?.request.user_agents).toEqual([
        {
          type: "ios",
          value: ios,
          retry_reason: "upstream_timeout",
          resolved_url: null,
        },
        { type: "android", value: android },
      ]);
      expect(seenUserAgents).toEqual([ios, android]);
    });

    it("can retry with no header as part of an ordered user-agent chain", async () => {
      const ios = userAgentPools.ios[0];
      const requestUserAgents: Array<string | null> = [];

      installUpstreamMock({
        "https://ua-chain-none.test/start": (request) => {
          const requestUserAgent = request.headers.get("user-agent");
          requestUserAgents.push(requestUserAgent);

          if (requestUserAgent === ios) {
            return new Response("landing page", { status: 200 });
          }

          if (requestUserAgent === null) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            });
          }

          throw new Error(`Unexpected user-agent: ${requestUserAgent}`);
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0);

      const response = await SELF.fetch(
        "https://resolver.test/?url=ua-chain-none.test/start&user-agent=ios,none,android",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "none", value: null });
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.hops[0]?.request.user_agents).toEqual([
        {
          type: "ios",
          value: ios,
          retry_reason: "non_redirect_status",
          resolved_url: null,
        },
        { type: "none", value: null },
      ]);
      expect(requestUserAgents).toEqual([ios, null]);
    });

    it("tries next user-agent when location scheme is not http/https", async () => {
      const ios = userAgentPools.ios[0];
      const android = userAgentPools.android[0];
      const seenUserAgents: string[] = [];

      installUpstreamMock({
        "https://scheme-chain.test/start": (request) => {
          const requestUserAgent = request.headers.get("user-agent");
          if (requestUserAgent) seenUserAgents.push(requestUserAgent);

          if (requestUserAgent === ios) {
            return new Response(null, {
              status: 302,
              headers: { location: "myapp://open" },
            });
          }

          if (requestUserAgent === android) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            });
          }

          throw new Error(`Unexpected user-agent: ${requestUserAgent}`);
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0);

      const response = await SELF.fetch(
        "https://resolver.test/?url=scheme-chain.test/start&user-agent=ios,android",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "android", value: android });
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.hops[0]?.request.user_agents).toEqual([
        {
          type: "ios",
          value: ios,
          retry_reason: "non_http_https_scheme",
          resolved_url: "myapp://open",
        },
        { type: "android", value: android },
      ]);
      expect(seenUserAgents).toEqual([ios, android]);
    });

    it("tries next user-agent when android gets redirected to Google Play", async () => {
      const ios = userAgentPools.ios[0];
      const android = userAgentPools.android[0];
      const seenUserAgents: string[] = [];

      installUpstreamMock({
        "https://store-chain-play.test/start": (request) => {
          const requestUserAgent = request.headers.get("user-agent");
          if (requestUserAgent) seenUserAgents.push(requestUserAgent);

          if (requestUserAgent === android) {
            return new Response(null, {
              status: 302,
              headers: {
                location:
                  "https://play.google.com/store/apps/details?id=com.example.app",
              },
            });
          }

          if (requestUserAgent === ios) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            });
          }

          throw new Error(`Unexpected user-agent: ${requestUserAgent}`);
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0);

      const response = await SELF.fetch(
        "https://resolver.test/?url=store-chain-play.test/start&user-agent=android,ios",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "ios", value: ios });
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.hops[0]?.request.user_agents).toEqual([
        {
          type: "android",
          value: android,
          retry_reason: "app_store_redirect",
          resolved_url:
            "https://play.google.com/store/apps/details?id=com.example.app",
        },
        { type: "ios", value: ios },
      ]);
      expect(seenUserAgents).toEqual([android, ios]);
    });

    it("tries next user-agent when ios gets redirected to Apple App Store", async () => {
      const ios = userAgentPools.ios[0];
      const android = userAgentPools.android[0];
      const seenUserAgents: string[] = [];

      installUpstreamMock({
        "https://store-chain-ios.test/start": (request) => {
          const requestUserAgent = request.headers.get("user-agent");
          if (requestUserAgent) seenUserAgents.push(requestUserAgent);

          if (requestUserAgent === ios) {
            return new Response(null, {
              status: 302,
              headers: {
                location: "https://apps.apple.com/us/app/example/id123456789",
              },
            });
          }

          if (requestUserAgent === android) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            });
          }

          throw new Error(`Unexpected user-agent: ${requestUserAgent}`);
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0);

      const response = await SELF.fetch(
        "https://resolver.test/?url=store-chain-ios.test/start&user-agent=ios,android",
      );
      const payload: ResolvePayload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "android", value: android });
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.hops[0]?.request?.user_agents).toEqual([
        {
          type: "ios",
          value: ios,
          retry_reason: "app_store_redirect",
          resolved_url: "https://apps.apple.com/us/app/example/id123456789",
        },
        { type: "android", value: android },
      ]);
      expect(seenUserAgents).toEqual([ios, android]);
    });

    it("allows non-http location schemes when enforcement is disabled", async () => {
      const ios = userAgentPools.ios[0];
      const android = userAgentPools.android[0];
      const seenUserAgents: string[] = [];

      installUpstreamMock({
        "https://scheme-optional.test/start": (request) => {
          const requestUserAgent = request.headers.get("user-agent");
          if (requestUserAgent) seenUserAgents.push(requestUserAgent);

          if (requestUserAgent === ios) {
            return new Response(null, {
              status: 302,
              headers: { location: "myapp://open" },
            });
          }

          if (requestUserAgent === android) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            });
          }

          throw new Error(`Unexpected user-agent: ${requestUserAgent}`);
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0);

      const response = await SELF.fetch(
        "https://resolver.test/?url=scheme-optional.test/start&user-agent=ios,android&enforce-http-scheme=false",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "ios", value: ios });
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.urls.destination).toBe("myapp://open");
      expect(payload.hops[0]?.request.user_agents).toEqual([
        { type: "ios", value: ios },
      ]);
      expect(seenUserAgents).toEqual([ios]);
    });

    it("follows location even when status is non-3xx", async () => {
      const ios = userAgentPools.ios[0];
      const android = userAgentPools.android[0];
      const seenUserAgents: string[] = [];

      installUpstreamMock({
        "https://status-chain.test/start": (request) => {
          const requestUserAgent = request.headers.get("user-agent");
          if (requestUserAgent) seenUserAgents.push(requestUserAgent);

          if (requestUserAgent === ios) {
            return new Response("not found", {
              status: 404,
              headers: { location: "https://example.com/final" },
            });
          }

          if (requestUserAgent === android) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/final" },
            });
          }

          throw new Error(`Unexpected user-agent: ${requestUserAgent}`);
        },
      });

      vi.spyOn(Math, "random").mockReturnValue(0);

      const response = await SELF.fetch(
        "https://resolver.test/?url=status-chain.test/start&user-agent=ios,android",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toEqual({ type: "ios", value: ios });
      expect(payload.stop_reason).toBe("cross_domain_redirect");
      expect(payload.urls.destination).toBe("https://example.com/final");
      expect(payload.hops[0]?.request.user_agents).toEqual([
        { type: "ios", value: ios },
      ]);
      expect(seenUserAgents).toEqual([ios]);
    });

    it("returns null user_agent when user-agent param is invalid", async () => {
      installUpstreamMock({
        "https://ua-invalid.test/": () => new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=ua-invalid.test&user-agent=nintendo",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toBeNull();
    });

    it("returns null user_agent when user-agent param is missing", async () => {
      installUpstreamMock({
        "https://ua-missing.test/": () => new Response("ok", { status: 200 }),
      });

      const response = await SELF.fetch(
        "https://resolver.test/?url=ua-missing.test",
      );
      const payload = await response.json<ResolvePayload>();

      expect(response.status).toBe(200);
      expect(payload.user_agent).toBeNull();
    });
  });

  it("returns 502 when upstream fetch throws non-abort errors", async () => {
    installUpstreamMock({
      "https://broken.example/": () => {
        throw new Error("upstream down");
      },
    });

    const response = await SELF.fetch(
      "https://resolver.test/?url=broken.example",
    );
    const payload = await response.json<{ error: string; details: string }>();

    expect(response.status).toBe(502);
    expect(payload.error).toBe("Failed to resolve URL");
    expect(payload.details).toContain("upstream down");
  });
});
