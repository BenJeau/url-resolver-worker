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
): Promise<NormalizedTarget | null> {
  let extractedUrl = null;
  if (request.method === "POST") {
    extractedUrl = await request.text();
  } else {
    extractedUrl = new URL(request.url).searchParams.get("url");
  }
  if (!extractedUrl) return null;
  return normalizeTarget(extractedUrl.trim());
}
