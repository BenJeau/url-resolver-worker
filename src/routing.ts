/** True when the request should be handled by the resolve API, not static assets. */
export function isResolveApiRequest(request: Request, url: URL): boolean {
  if (request.method === "POST" || request.method === "OPTIONS") {
    return true;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return url.searchParams.has("url");
  }

  if (url.pathname !== "/" && url.pathname.includes(".")) {
    return false;
  }

  if (!url.searchParams.has("url")) {
    return false;
  }

  const accept = request.headers.get("Accept") ?? "";
  if (accept.includes("text/html")) {
    return false;
  }

  return true;
}
