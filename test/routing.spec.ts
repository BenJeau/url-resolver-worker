import { describe, expect, it } from "vitest";
import { isResolveApiRequest } from "../src/routing";

function req(
  path: string,
  init: { method?: string; accept?: string } = {},
): { request: Request; url: URL } {
  const url = new URL(path, "https://resolver.test");
  const headers = new Headers();
  if (init.accept !== undefined) {
    headers.set("Accept", init.accept);
  }
  const request = new Request(url, {
    method: init.method ?? "GET",
    headers,
  });
  return { request, url };
}

function isApi(path: string, init: { method?: string; accept?: string } = {}) {
  const { request, url } = req(path, init);
  return isResolveApiRequest(request, url);
}

describe("isResolveApiRequest", () => {
  it("routes POST and OPTIONS to the API", () => {
    expect(isApi("/", { method: "POST" })).toBe(true);
    expect(isApi("/", { method: "OPTIONS" })).toBe(true);
  });

  it("routes unsupported methods with ?url= to the API", () => {
    expect(
      isApi("/?url=example.com", { method: "PATCH", accept: "*/*" }),
    ).toBe(true);
  });

  it("serves static assets with file extensions", () => {
    expect(isApi("/vendor/prism/prism.min.js", { accept: "*/*" })).toBe(false);
    expect(isApi("/fonts/fonts.css", { accept: "text/css" })).toBe(false);
    expect(isApi("/favicon.svg", { accept: "image/svg+xml" })).toBe(false);
  });

  it("serves the web UI without ?url=", () => {
    expect(isApi("/", { accept: "text/html,application/xhtml+xml" })).toBe(
      false,
    );
  });

  it("routes GET /?url= API calls to the resolver", () => {
    expect(isApi("/?url=example.com", { accept: "application/json" })).toBe(
      true,
    );
    expect(isApi("/?url=example.com", { accept: "*/*" })).toBe(true);
  });

  it("serves page loads for GET /?url= when Accept includes text/html", () => {
    expect(
      isApi("/?url=example.com", { accept: "text/html,application/xhtml+xml" }),
    ).toBe(false);
  });
});
