import shortenerDomainsFile from "./url-shortener-domains.json";

const BUILTIN_SHORTENER_DOMAINS = new Set(shortenerDomainsFile.domains);

export function createContinueDomains(
  customDomains: string | null | undefined,
): Set<string> {
  const parsedCustomDomains = customDomains?.split(",") ?? [];
  return new Set([...BUILTIN_SHORTENER_DOMAINS, ...parsedCustomDomains]);
}
