# URL Resolver

Cloudflare Worker that resolves redirect chains with controlled hop-following and clear stop reasons.

## Overview

This worker accepts a URL and resolves redirects manually, with safety guards and deterministic stop logic.

- Default output is compact and end-user friendly.
- Redirect traversal continues only while redirects stay on the original host.
- Destination URL not visited (unless same as input URL)

## Request API

Supported methods: `GET`, `POST`.

### GET with query param

```bash
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123"
```

Optional platform-specific upstream user-agent pool:

```bash
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123&user-agent=ios"
```

Optional comma-separated user-agent chain (tries in this order, until a valid `Location` is found):

```bash
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123&user-agent=ios,android,windows"
```

Optional flag to disable `http`/`https` `Location` scheme enforcement for user-agent retries:

```bash
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123&user-agent=ios,android&enforce-http-scheme=false"
```

Optional debug mode to resolve and include worker egress IP (will check IP via AWS API):

```bash
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123&debug=true"
```

### POST with body

Plain text:

```bash
curl -X POST "https://<your-worker>.workers.dev" \
  -H "content-type: application/json" \
  --data 'bit.ly/abc123'
```

### Input precedence and normalization

- Query param `url` is checked first.
- If not provided, POST body is used.
- If scheme is missing, `https://` is prepended.
- Optional query param `user-agent` supports: `ios`, `android`, `mac`, `windows` (case-insensitive).
- `user-agent` accepts a single type or a comma-separated ordered list (for example `?user-agent=ios,android`).
- One random User-Agent string is selected for each provided platform type in order and reused across hops for that request.
- Optional query param `enforce-http-scheme` defaults to `true`. When `true`, fallback retries continue until `Location` resolves to `http`/`https` (or the UA list is exhausted). Set `false` to allow any `Location` scheme.
- When no valid user-agent types are provided, no User-Agent header is sent upstream.
- Optional query param `debug=true` enables worker IP lookup; by default IP lookup is skipped.

## Response

Example shape:

```json
{
  "urls": {
    "input": "bit.ly/abc123",
    "normalized": "https://bit.ly/abc123",
    "destination": "https://example.com/final-page"
  },
  "user_agent": {
    "type": "android",
    "value": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
  },
  "stop_reason": "cross_domain_redirect",
  "redirects_followed": 1,
  "status": 301,
  "timing_ms": 72.5,
  "hops": [
    {
      "request": {
        "url": "https://bit.ly/abc123",
        "user_agents": [
          {
            "type": "ios",
            "value": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
            "retry_reason": "non_http_https_scheme",
            "resolved_url": "myapp://open"
          },
          {
            "type": "android",
            "value": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
          }
        ]
      },
      "next_url": "https://example.com/final-page",
      "status": 301,
      "timing_ms": 72.5,
      "response_headers": { "...": "..." }
    }
  ],
  "worker": {
    "ip": null,
    "colo": "EWR",
    "country": "US",
    "city": "Newark",
    "region": "New Jersey",
    "continent": "NA",
    "timezone": "America/New_York",
    "asn": 13335,
    "cf_ray": "..."
  }
}
```

## Resolver behavior

- Maximum hops: configurable via `MAX_HOPS` (default `10`)
- Per-hop upstream timeout: configurable via `UPSTREAM_TIMEOUT_MS` (default `8000`)
- Method used for hop fetches: `GET`
- Optional upstream user agent pool/chain via `?user-agent=<type>` or `?user-agent=<type1,type2,...>` (same type set)
- User-agent pools are pre-generated into `src/user-agent-pools.json` from Microlink's `user` list (`https://microlink.io/user-agents.json`)
- Worker egress IP lookup is only executed when `?debug=true`; otherwise `worker.ip` is `null`.
- Redirects are only followed while host remains equal to the initial normalized host
- If next host is different, that URL becomes destination and traversal stops
- If `Location` header exists and can be parsed, resolver follows it regardless of status code
- For each hop, resolver can retry with the next UA in chain when:
  - status is `200` and `Location` is missing
  - `Location` does not resolve to `http`/`https` and `enforce-http-scheme=true` (default)

### Interpreting top-level fields (verbose/full mode)

- `status`: status code of the last attempted hop.
- `redirects_followed`: number of accepted same-host redirects.
- `redirects_followed` is always less than or equal to `hops.length`.
- `timing_ms`: total resolver duration.
- `user_agent`: object for the last successful user-agent attempt, containing `type` (`ios`, `android`, `mac`, `windows`) and header `value`; `null` when no user-agent was used.
- `worker.ip`: resolved only when `debug=true`; otherwise `null`.

## Hop queue (`hops`) and `stop_reason`

`hops` is an ordered queue of resolution attempts.

Each hop includes:

- `request.url`: upstream URL requested for that hop.
- `request.user_agents`: ordered User-Agents attempted for that hop, in first-to-last attempt order, each with:
  - `type`
  - raw header `value`
  - optional `retry_reason` when the resolver moved to the next user-agent:
    - `non_http_https_scheme`
    - `non_redirect_status`
  - optional `resolved_url` captured for retry attempts:
    - absolute URL if `Location` could be resolved (for example `myapp://open` or `https://...`)
    - `null` when retry happened without a `Location` header (for example `non_redirect_status`)

Possible `stop_reason` values:

| `stop_reason`             | Meaning                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `non_redirect_status`     | Last hop was not redirectable after UA retries (for example `200`, `404`). |
| `missing_location_header` | Hop was 3xx but had no `Location` header.                                  |
| `invalid_location_header` | `Location` existed but could not be parsed into a valid absolute URL.      |
| `same_url_redirect`       | Redirect target is exactly the same URL as the current hop.                |
| `cross_domain_redirect`   | Redirect target host differs from the original host.                       |
| `max_hops_reached`        | Reached hop limit before another terminal condition.                       |
| `upstream_timeout`        | Upstream request exceeded the per-hop timeout.                             |

## Security controls built in

- Upstream timeout to avoid hanging requests
- Optional edge authentication via Cloudflare Access (no in-code auth required)

## Configuration

The worker reads these runtime env vars from `wrangler.toml` `[vars]` (with defaults):

| Variable              | Default | Description                                                 |
| --------------------- | ------- | ----------------------------------------------------------- |
| `MAX_HOPS`            | `10`    | Max number of hops before stopping with `max_hops_reached`. |
| `UPSTREAM_TIMEOUT_MS` | `8000`  | Per-hop timeout in milliseconds before `upstream_timeout`.  |

## Error responses

- `400`: missing or invalid URL input/request
- `405`: unsupported HTTP method (only `GET` and `POST` are accepted)
- `502`: upstream resolve/fetch error

## Secure `workers.dev` with Cloudflare Access

You can protect `https://<worker>.workers.dev` at Cloudflare edge level.

### Enable Access on workers.dev route

1. Cloudflare Dashboard -> `Workers & Pages`
2. Open this Worker
3. `Settings` -> `Domains & Routes`
4. On the `workers.dev` route, enable Cloudflare Access
5. In Access policies, add `Allow` and/or `Service Auth` policies
6. Remove broad `Bypass` rules if you want strict enforcement

### Service token authentication (machine-to-machine)

Create a token in Cloudflare One:

1. `Access controls` -> `Service credentials` -> `Service Tokens`
2. Create token and copy Client ID / Client Secret

Authenticated request example:

```bash
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123" \
  -H "CF-Access-Client-Id: <CLIENT_ID>" \
  -H "CF-Access-Client-Secret: <CLIENT_SECRET>"
```

POST example:

```bash
curl -X POST "https://<your-worker>.workers.dev" \
  -H "content-type: application/json" \
  -H "CF-Access-Client-Id: <CLIENT_ID>" \
  -H "CF-Access-Client-Secret: <CLIENT_SECRET>" \
  --data 'bit.ly/abc123'
```

## Local development

```bash
npm install
npm run generate-user-agents
npm run dev
```

## Testing

Run the test suite with:

```bash
npm test
```

Run in watch mode while developing:

```bash
npm run test:watch
```

## Generate User-Agent Pools

To refresh the static user-agent pools JSON from Microlink:

```bash
npm run generate-user-agents
```

This updates `src/user-agent-pools.json`. Runtime requests read this file directly (no per-request pool generation).

## Generate Worker Types

When you add or change Worker bindings/vars (for example in `wrangler.toml`), regenerate `worker-configuration.d.ts`:

```bash
npm run generate-types
```

This keeps the `Env` types in sync with runtime config and prevents stale type errors.

## Deploy

```bash
wrangler deploy
```
