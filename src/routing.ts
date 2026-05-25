/** True when the request should be handled by the resolve API, not static assets. */
export function isResolveApiRequest(request: Request, url: URL): boolean {
  if (request.method === "POST" || request.method === "OPTIONS") {
    return true;
  }

  const accept = request.headers.get("Accept") ?? "";
  if (accept.includes("text/html")) {
    return false;
  }

  return true;
}
