import { extractDebugFlag, extractUrl } from "./request";
import { resolveUrl } from "./resolver";
import { extractUserAgentType } from "./user-agent";
import { getWorkerInfo } from "./worker";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const target = await extractUrl(request, url);
    const userAgentType = extractUserAgentType(url);
    const debug = extractDebugFlag(url);
    if (!target) {
      return json(
        { error: "Provide a valid URL via '?url=' (GET) or via body (POST)." },
        400,
      );
    }

    try {
      const [workerInfo, result] = await Promise.all([
        getWorkerInfo(request, debug),
        resolveUrl(target, userAgentType),
      ]);
      result["worker"] = workerInfo;
      return json(result, 200);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown fetch error";
      return json({ error: "Failed to resolve URL", details: message }, 502);
    }
  },
} satisfies ExportedHandler<Env>;

function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data, undefined, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
