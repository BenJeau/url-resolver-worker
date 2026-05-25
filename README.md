# URL Resolver

Cloudflare Worker that resolves redirect chains with controlled hop-following and clear stop reasons.

## Overview

This worker accepts a URL and resolves redirects manually, with safety guards and deterministic stop logic.

- Default output is compact and end-user friendly.
- Redirect traversal continues only while redirects stay on the original host.
- Destination URL not visited (unless same as input URL)

## Web UI

A static browser playground lives in [`web/`](web/). Open [`web/index.html`](web/index.html) via a local static server (for example `npx serve web`) to resolve URLs interactively against a worker endpoint.

The UI includes:

- Request form (URL, user-agent chain, flags, method, endpoint)
- Copyable cURL for the current request
- Redirect hop timeline with status/timing and expandable hop details
- Local resolve history (stored in the browser; shareable via URL query params)
- Full JSON modal and a reasons/rules glossary

All fonts and syntax-highlighting assets are bundled under `web/` — no external CDN dependencies at runtime.

## Request API

Supported methods: `GET`, `POST`.

### GET with query param

```bash
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123"
```

Query parameters (all optional except `url` on GET):

| Parameter               | Default  | Description                                                                                                                                                                                                  |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`                   | —        | Target URL to resolve. Required for GET; use POST body for POST. Scheme-less values get `https://` prepended.                                                                                                |
| `user-agent`            | _(none)_ | Comma-separated ordered UA chain. Values: `ios`, `android`, `macos`, `windows`, `none` (case-insensitive). One random string per type is selected and reused across hops. `none` sends no `User-Agent` header. |
| `enforce-http-scheme`   | `true`   | When `true`, UA retries continue until `Location` resolves to `http`/`https`. Set `false` to allow any scheme.                                                                                               |
| `stop-on-cross-domain`  | `true`   | When `true`, stop at cross-domain redirects outside the built-in shortener / `CONTINUE_HOP_DOMAINS` set. Set `false` to follow redirects to any host until another stop condition.                           |
| `extract-response-body` | `false`  | Set `true` to include raw response body text in each `type=resolve` hop under `response.body`.                                                                                                               |
| `debug`                 | `false`  | Set `true` to resolve and include worker egress IP in `worker.ip`.                                                                                                                                           |

Examples:

```bash
# User-agent chain with scheme enforcement disabled
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123&user-agent=ios,android&enforce-http-scheme=false"

# Follow redirects across domains to the end URL
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123&stop-on-cross-domain=false"

# Verbose hop bodies and worker IP
curl "https://<your-worker>.workers.dev?url=bit.ly/abc123&extract-response-body=true&debug=true"
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
- See the [query parameters](#get-with-query-param) table for optional flags and defaults.
- The worker includes a built-in URL shortener domain list (generated into `src/url-shortener-domains.json`) and continues across those domains automatically unless `stop-on-cross-domain=false`.

## Response

Example shape:

```json
{
  "urls": {
    "input": "bit.ly/abc123",
    "normalized": "https://bit.ly/abc123",
    "raw_destination": "https://example.com/final-page",
    "destination": "https://example.com/final-page"
  },
  "embedded_url_rule": "google-url",
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
      "type": "resolve",
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
      "response": {
        "headers": { "...": "..." },
        "body": "..."
      }
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
- Optional upstream user agent pool/chain via `?user-agent=<type>` or `?user-agent=<type1,type2,...>` where type is one of `ios`, `android`, `macos`, `windows`, `none`
- User-agent pools are pre-generated into `src/user-agent-pools.json` from Microlink's `user` list (`https://microlink.io/user-agents.json`)
- URL shortener continue domains are pre-generated into `src/url-shortener-domains.json` from HaGeZi's list (`https://raw.githubusercontent.com/hagezi/dns-blocklists/refs/heads/main/wildcard/urlshortener-onlydomains.txt`)
- Worker egress IP lookup is only executed when `?debug=true`; otherwise `worker.ip` is `null`.
- Redirects are only followed while host remains equal to the initial normalized host, unless `stop-on-cross-domain=false`
- Exception: when a redirect target host matches the built-in shortener domain set (or `CONTINUE_HOP_DOMAINS` env var values), hop resolution continues even with the default `stop-on-cross-domain=true`
- If next host is different and cross-domain stopping is enabled, that URL becomes destination and traversal stops
- Final `urls.destination` is always passed through embedded URL extraction
- `urls.raw_destination` captures the URL before that final extraction pass
- `embedded_url_rule` is the ID of the embedded URL rule that most directly produced `urls.destination`; `null` when no embedded rule was applied
- If `Location` header exists and can be parsed, resolver follows it regardless of status code
- For each hop, resolver can retry with the next UA in chain when:
  - status is `200` and `Location` is missing
  - active UA is `ios` or `android` and `Location` resolves to App Store / Play Store link
  - `Location` does not resolve to `http`/`https` and `enforce-http-scheme=true` (default)

### Embedded redirect wrappers

Before hop resolution starts, known wrapper URLs are unwrapped recursively (up to a bounded depth). Supported examples include:

- `google.com/url?q=NESTED_URL`
- `google.com/url?sa=D&q=NESTED_URL`
- `google.com/amp/s/NESTED_URL_WITHOUT_SCHEME`
- `google.com/amp/NESTED_URL_WITHOUT_SCHEME`
- `t.me/iv?url=NESTED_URL`
- `twitter.com/safety/unsafe_link_warning?unsafe_link=NESTED_URL`
- `l.facebook.com/l.php?u=NESTED_URL`
- `m.facebook.com/flx/warn/?u=NESTED_URL`
- `www.facebook.com/flx/warn/?u=NESTED_URL`
- `youtube.com/redirect?q=NESTED_URL`
- `apis.google.com/additnow/l?applicationId=1&__ls=ogb&__lu=NESTED_URL`
- `redirect.viglink.com/?u=NESTED_URL`

### Interpreting top-level fields (verbose/full mode)

- `status`: status code of the last attempted hop.
- `redirects_followed`: number of accepted same-host redirects.
- `redirects_followed` is always less than or equal to `hops.length`.
- `timing_ms`: total resolver duration.
- `embedded_url_rule`: ID of the embedded wrapper rule used to derive the final destination, or `null` if none matched.
- `user_agent`: object for the last successful user-agent attempt, containing `type` (`ios`, `android`, `macos`, `windows`, `none`) and header `value` (`string` for platform pools, `null` for `none`); `null` when no user-agent parameter was valid/provided.
- `worker.ip`: resolved only when `debug=true`; otherwise `null`.

## Hop queue (`hops`) and `stop_reason`

`hops` is an ordered queue that can contain:

- `type=resolve`: upstream request/redirect attempts.
- `type=extraction`: embedded-wrapper unwrapping steps.

Each hop includes:

- For `type=resolve`:
  - `request.url`: upstream URL requested for that hop.
  - `next_url`: resolved `Location` URL (or `null`).
  - `status`: upstream response status for the hop.
  - `response.headers`: upstream response headers for the hop.
  - `response.body`: raw response body text (only present when `extract-response-body=true`).
  - `request.user_agents`: ordered User-Agents attempted for that hop, in first-to-last attempt order, each with:
    - `type`
    - raw header `value` (`null` for `type=none`)
    - optional `retry_reason` when the resolver moved to the next user-agent:
      - `app_store_redirect`
      - `non_http_https_scheme`
      - `non_redirect_status`
      - optional `resolved_url` captured for retry attempts:
      - absolute URL if `Location` could be resolved (for example `myapp://open` or `https://...`)
      - `null` when retry happened without a `Location` header (for example `non_redirect_status`)
- For `type=extraction`:
  - `next_url`: URL after applying one extraction rule step.
  - `rule_id`: embedded extraction rule ID applied for that step (list of rules is in [`src/embedded-url-rules.ts`](src/embedded-url-rules.ts))

Possible `stop_reason` values:

| `stop_reason`             | Meaning                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `non_redirect_status`     | Last hop was not redirectable after UA retries (for example `200`, `404`).                                                        |
| `missing_location_header` | Hop was 3xx but had no `Location` header.                                                                                         |
| `invalid_location_header` | `Location` existed but could not be parsed into a valid absolute URL.                                                             |
| `same_url_redirect`       | Redirect target is exactly the same URL as the current hop.                                                                       |
| `cross_domain_redirect`   | Redirect target host differs from the original host and is not in the continue-domain set (`stop-on-cross-domain=true`, default). |
| `max_hops_reached`        | Reached hop limit before another terminal condition.                                                                              |
| `upstream_timeout`        | Upstream request exceeded the per-hop timeout.                                                                                    |

## Security controls built in

- Upstream timeout to avoid hanging requests
- Optional edge authentication via Cloudflare Access (no in-code auth required)

## Configuration

The worker reads these runtime env vars from `wrangler.toml` `[vars]` (with defaults):

| Variable               | Default | Description                                                                              |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `MAX_HOPS`             | `10`    | Max number of hops before stopping with `max_hops_reached`.                              |
| `UPSTREAM_TIMEOUT_MS`  | `8000`  | Per-hop timeout in milliseconds before `upstream_timeout`.                               |
| `CONTINUE_HOP_DOMAINS` | `""`    | Optional comma-separated custom domains to continue across after cross-domain redirects. |
| `CORS_ORIGINS`         | `""`    | Optional. See [CORS](#cors) below.                                                       |

## CORS

By default the worker sends no CORS headers. Set `CORS_ORIGINS` in `wrangler.toml` (or as a Cloudflare secret/var) to enable cross-origin access from other workers or pages:

```toml
# Allow any origin — useful for public APIs
CORS_ORIGINS = "*"

# Allow specific origins (comma-separated)
CORS_ORIGINS = "https://my-page.pages.dev,https://other-worker.workers.dev"
```

When an origin is permitted the worker adds the following headers to every response:

```
Access-Control-Allow-Origin: <origin>   (or * for wildcard)
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 86400
Vary: Origin                            (only for explicit origin lists)
```

`OPTIONS` preflight requests return `204 No Content` with the same CORS headers when the requesting origin is allowed. When `CORS_ORIGINS` is empty or the origin is not in the list, `OPTIONS` falls through to the normal `405` response.

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
npm run generate-url-shortener-domains
npm run dev
```

To run the web UI locally:

```bash
npx serve web
```

Then open the served URL in your browser and point the **API endpoint** field at your worker (`http://127.0.0.1:8787` when using `npm run dev`, or your deployed worker URL).

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

## Generate URL Shortener Continue Domains

To refresh the static shortener domain JSON from HaGeZi's list:

```bash
npm run generate-url-shortener-domains
```

This updates `src/url-shortener-domains.json`. Runtime requests read this file directly (no per-request list fetch).

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

## License

This project is licensed under the terms of the [MIT License](LICENSE)
