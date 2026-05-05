export type EmbeddedCandidateSource =
  | {
      type: "query_param";
      keys: string[];
    }
  | {
      type: "path_prefix";
      prefix: string;
    };

export type EmbeddedHostMatcher = {
  equals?: string[];
  suffix?: string[];
  includes?: string[];
  regex?: RegExp;
};

export type EmbeddedPathMatcher = {
  equals?: string[];
  startsWith?: string[];
};

export type EmbeddedRedirectRule = {
  id: string;
  host?: EmbeddedHostMatcher;
  path?: EmbeddedPathMatcher;
  candidate_sources: EmbeddedCandidateSource[];
};

export const embeddedRedirectRules: EmbeddedRedirectRule[] = [
  {
    id: "google-url",
    host: { includes: ["google."] },
    path: { equals: ["/url"] },
    candidate_sources: [{ type: "query_param", keys: ["url", "q"] }],
  },
  {
    id: "google-additnow",
    host: { equals: ["apis.google.com"] },
    path: { equals: ["/additnow/l"] },
    candidate_sources: [{ type: "query_param", keys: ["__lu"] }],
  },
  {
    id: "google-adurl",
    host: { includes: ["google."] },
    candidate_sources: [{ type: "query_param", keys: ["adurl"] }],
  },
  {
    id: "google-amp-path",
    host: { includes: ["google."] },
    path: { startsWith: ["/amp/s/"] },
    candidate_sources: [{ type: "path_prefix", prefix: "/amp/s/" }],
  },
  {
    id: "google-amp-path-no-s",
    host: { includes: ["google."] },
    path: { startsWith: ["/amp/"] },
    candidate_sources: [{ type: "path_prefix", prefix: "/amp/" }],
  },
  {
    id: "youtube-redirect",
    host: { suffix: ["youtube.com"] },
    path: { startsWith: ["/redirect"] },
    candidate_sources: [{ type: "query_param", keys: ["q", "url"] }],
  },
  {
    id: "facebook-lphp",
    host: { regex: /^l[a-z]?\.facebook\.com$/ },
    path: { equals: ["/l.php"] },
    candidate_sources: [{ type: "query_param", keys: ["u"] }],
  },
  {
    id: "facebook-flx-warn",
    host: { equals: ["m.facebook.com", "www.facebook.com"] },
    path: { equals: ["/flx/warn", "/flx/warn/"] },
    candidate_sources: [{ type: "query_param", keys: ["u"] }],
  },
  {
    id: "telegram-iv",
    host: { equals: ["t.me"] },
    path: { equals: ["/iv"] },
    candidate_sources: [{ type: "query_param", keys: ["url"] }],
  },
  {
    id: "instagram-linkshim",
    host: { equals: ["l.instagram.com"] },
    candidate_sources: [{ type: "query_param", keys: ["u"] }],
  },
  {
    id: "instagram-accounts-login",
    host: { suffix: ["instagram.com"] },
    path: { startsWith: ["/accounts/login"] },
    candidate_sources: [{ type: "query_param", keys: ["next"] }],
  },
  {
    id: "duckduckgo-l",
    host: { equals: ["duckduckgo.com"] },
    path: { startsWith: ["/l/"] },
    candidate_sources: [{ type: "query_param", keys: ["uddg"] }],
  },
  {
    id: "reddit-out",
    host: { equals: ["out.reddit.com", "click.redditmail.com"] },
    candidate_sources: [{ type: "query_param", keys: ["url"] }],
  },
  {
    id: "linkedin-redir",
    host: { suffix: ["linkedin.com"] },
    path: { startsWith: ["/redir/redirect"] },
    candidate_sources: [{ type: "query_param", keys: ["url"] }],
  },
  {
    id: "twitter-redirect",
    host: { suffix: ["twitter.com", "x.com"] },
    path: { equals: ["/i/redirect"] },
    candidate_sources: [{ type: "query_param", keys: ["url"] }],
  },
  {
    id: "twitter-unsafe-link-warning",
    host: { suffix: ["twitter.com", "x.com"] },
    path: { equals: ["/safety/unsafe_link_warning"] },
    candidate_sources: [{ type: "query_param", keys: ["unsafe_link"] }],
  },
  {
    id: "viglink-redirect",
    host: { equals: ["redirect.viglink.com"] },
    path: { startsWith: ["/"] },
    candidate_sources: [{ type: "query_param", keys: ["u"] }],
  },
];
