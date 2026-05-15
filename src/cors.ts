/**
 * Returns CORS response headers if the request origin is permitted by the
 * configured `corsOrigins` value, or `null` when CORS should not be applied.
 *
 * `corsOrigins` can be:
 *   - empty / falsy  → CORS disabled, returns null
 *   - `"*"`          → wildcard; allows any origin
 *   - comma-separated list of origins, e.g. `"https://a.example,https://b.example"`
 *
 * When the wildcard is used, `Access-Control-Allow-Origin: *` is returned (no
 * `Vary` header needed). For an explicit list, the matching origin is reflected
 * back and `Vary: Origin` is added so intermediate caches work correctly.
 */
export function getCorsHeaders(
  request: Request,
  corsOrigins: string | null | undefined,
): Record<string, string> | null {
  if (!corsOrigins?.trim()) return null;

  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) return null;

  const allowed = corsOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const isWildcard = allowed.includes("*");

  if (!isWildcard && !allowed.includes(requestOrigin)) return null;

  return {
    "access-control-allow-origin": isWildcard ? "*" : requestOrigin,
    "access-control-allow-methods": "GET, POST",
    "access-control-allow-headers": "Content-Type",
    "access-control-max-age": "86400",
    ...(isWildcard ? {} : { vary: "Origin" }),
  };
}
