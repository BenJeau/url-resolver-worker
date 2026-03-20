import { afterEach, describe, expect, it, vi } from "vitest";
import { SELF } from "cloudflare:test";

type UpstreamHandler = (request: Request) => Response | Promise<Response>;

function installUpstreamMock(routes: Record<string, UpstreamHandler>) {
  const handlers = new Map<string, UpstreamHandler>(
    Object.entries(routes).map(([url, handler]) => [new URL(url).toString(), handler]),
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("url-resolver worker", () => {
  it("returns 400 when url input is missing", async () => {
    const response = await SELF.fetch("https://resolver.test/");
    const payload = await response.json<{
      error: string;
    }>();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Provide a valid URL");
  });

  it("follows same-host redirects and stops at cross-domain destination", async () => {
    const requestUserAgents: Array<string | null> = [];

    installUpstreamMock({
      "https://short.ly/start": (request) => {
        requestUserAgents.push(request.headers.get("user-agent"));
        return new Response(null, {
          status: 302,
          headers: { location: "/step-two" },
        });
      },
      "https://short.ly/step-two": (request) => {
        requestUserAgents.push(request.headers.get("user-agent"));
        return new Response(null, {
          status: 301,
          headers: { location: "https://example.com/final" },
        });
      },
    });

    vi.spyOn(Math, "random").mockReturnValue(0);

    const response = await SELF.fetch(
      "https://resolver.test/?url=short.ly/start&user-agent=ios",
    );
    const payload = await response.json<{
      urls: { destination: string };
      request_user_agent: string | null;
      stop_reason: string;
      redirects_followed: number;
      hops: unknown[];
    }>();

    expect(response.status).toBe(200);
    expect(payload.stop_reason).toBe("cross_domain_redirect");
    expect(payload.redirects_followed).toBe(2);
    expect(payload.urls.destination).toBe("https://example.com/final");
    expect(payload.hops).toHaveLength(2);
    expect(payload.request_user_agent).not.toBeNull();
    expect(requestUserAgents).toEqual([
      payload.request_user_agent,
      payload.request_user_agent,
    ]);
  });

  it("accepts URL from POST body", async () => {
    const fetchMock = installUpstreamMock({
      "https://example.org/path": () => new Response("ok", { status: 200 }),
    });

    const response = await SELF.fetch("https://resolver.test/", {
      method: "POST",
      body: "example.org/path",
    });
    const payload = await response.json<{
      urls: { input: string; extended: string; destination: string };
      stop_reason: string;
      redirects_followed: number;
    }>();

    expect(response.status).toBe(200);
    expect(payload.urls.input).toBe("example.org/path");
    expect(payload.urls.extended).toBe("https://example.org/path");
    expect(payload.urls.destination).toBe("https://example.org/path");
    expect(payload.stop_reason).toBe("non_redirect_status");
    expect(payload.redirects_followed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves worker IP in debug mode", async () => {
    installUpstreamMock({
      "https://checkip.amazonaws.com/": () =>
        new Response("203.0.113.10\n", { status: 200 }),
      "https://example.net/": () => new Response("ok", { status: 200 }),
    });

    const response = await SELF.fetch(
      "https://resolver.test/?url=example.net&debug=true",
    );
    const payload = await response.json<{
      worker: { ip: string | null };
    }>();

    expect(response.status).toBe(200);
    expect(payload.worker.ip).toBe("203.0.113.10");
  });

  it("returns 502 when upstream fetch throws", async () => {
    installUpstreamMock({
      "https://broken.example/": () => {
        throw new Error("upstream down");
      },
    });

    const response = await SELF.fetch("https://resolver.test/?url=broken.example");
    const payload = await response.json<{
      error: string;
      details: string;
    }>();

    expect(response.status).toBe(502);
    expect(payload.error).toBe("Failed to resolve URL");
    expect(payload.details).toContain("upstream down");
  });
});
