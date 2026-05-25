import {
  extractDebugFlag,
  extractEnforceHttpSchemeFlag,
  extractExtractResponseBodyFlag,
  extractUrl,
} from "./request";
import { createContinueDomains } from "./continue-hop-domains";
import { getCorsHeaders } from "./cors";
import { resolveUrl } from "./resolver";
import { isResolveApiRequest } from "./routing";
import { extractUserAgentTypes } from "./user-agent";
import { getWorkerInfo } from "./worker";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!isResolveApiRequest(request, url)) {
      return env.ASSETS.fetch(request);
    }

    return handleResolve(request, url, env);
  },
} satisfies ExportedHandler<Env>;

async function handleResolve(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env.CORS_ORIGINS);
  let invalidMethod = false;

  if (request.method === "OPTIONS") {
    if (corsHeaders) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    invalidMethod = true;
  } else if (request.method !== "GET" && request.method !== "POST") {
    invalidMethod = true;
  }

  if (invalidMethod) {
    return json(
      {
        error:
          "Only GET and POST are supported. Use '?url=' for GET or plain text body for POST.",
      },
      405,
      { allow: "GET, POST", ...corsHeaders },
    );
  }

  const target = await extractUrl(request, url);
  const userAgentTypes = extractUserAgentTypes(url);
  const debug = extractDebugFlag(url);
  const enforceHttpScheme = extractEnforceHttpSchemeFlag(url);
  const extractResponseBody = extractExtractResponseBodyFlag(url);
  const continueDomains = createContinueDomains(env.CONTINUE_HOP_DOMAINS);
  if (!target) {
    return json(
      { error: "Provide a valid URL via '?url=' (GET) or via body (POST)." },
      400,
      corsHeaders ?? {},
    );
  }

  try {
    const [workerInfo, result] = await Promise.all([
      getWorkerInfo(request, debug),
      resolveUrl(
        target,
        userAgentTypes,
        enforceHttpScheme,
        continueDomains,
        extractResponseBody,
      ),
    ]);
    result["worker"] = workerInfo;
    return json(result, 200, corsHeaders ?? {});
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown fetch error";
    return json(
      { error: "Failed to resolve URL", details: message },
      502,
      corsHeaders ?? {},
    );
  }
}

function json<T>(
  data: T,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(data, undefined, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}
