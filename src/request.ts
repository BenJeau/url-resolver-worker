export type NormalizedTarget = {
  raw: string;
  target: URL;
};

function normalizeTarget(raw: string): NormalizedTarget | null {
  const normalized =
    raw.startsWith("http://") || raw.startsWith("https://")
      ? raw
      : `https://${raw}`;
  const target = new URL(normalized);
  return { raw, target };
}

export async function extractUrl(
  request: Request,
  url: URL,
): Promise<NormalizedTarget | null> {
  let extractedUrl = null;
  if (request.method === "POST") {
    extractedUrl = await request.text();
  } else {
    extractedUrl = url.searchParams.get("url");
  }
  if (!extractedUrl) return null;
  return normalizeTarget(extractedUrl.trim());
}

export function extractDebugFlag(url: URL): boolean {
  const rawDebug = url.searchParams.get("debug");
  return rawDebug?.trim().toLowerCase() === "true";
}

export function extractEnforceHttpSchemeFlag(url: URL): boolean {
  const rawEnforce = url.searchParams.get("enforce-http-scheme");
  return rawEnforce?.trim().toLowerCase() !== "false";
}
