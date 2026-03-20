export type WorkerInfo = {
  ip: string | null;
  colo: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  continent: string | null;
  timezone: string | null;
  asn: number | null;
  cf_ray: string | null;
};

async function getWorkerIp(): Promise<string | null> {
  try {
    const response = await fetch("https://checkip.amazonaws.com");
    if (!response.ok) return null;
    const body = (await response.text()).trim();
    return body.length > 0 ? body : null;
  } catch {
    return null;
  }
}

export async function getWorkerInfo(
  request: Request,
  resolveIp = false,
): Promise<WorkerInfo> {
  const cf = request.cf;
  return {
    ip: resolveIp ? await getWorkerIp() : null,
    colo: cf?.colo as string | null,
    country: cf?.country as string | null,
    city: cf?.city as string | null,
    region: cf?.region as string | null,
    continent: cf?.continent as string | null,
    timezone: cf?.timezone as string | null,
    asn: cf?.asn as number | null,
    cf_ray: request.headers.get("cf-ray"),
  };
}
