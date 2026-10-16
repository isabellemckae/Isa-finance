/**
 * Content Security Policy builder (per-request nonce, set by `src/proxy.ts`).
 *
 * - Scripts: only those carrying the nonce, plus scripts they load ('strict-dynamic').
 * - Styles: 'unsafe-inline' is required for inline style attributes used by Recharts and
 *   Next.js. This is an accepted trade-off because script execution stays nonce-restricted.
 * - Plaid Link: its loader script comes from cdn.plaid.com (allowed through 'strict-dynamic'
 *   because our nonced bundle inserts it; the host is listed for older browsers), its UI
 *   runs in a cdn.plaid.com iframe, and it reports to Plaid's API hosts.
 */

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function buildCsp(nonce: string, options: { isDev: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "https://cdn.plaid.com",
      ...(options.isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", "https://sandbox.plaid.com", "https://production.plaid.com", ...(options.isDev ? ["ws:"] : [])],
    "frame-src": ["https://cdn.plaid.com"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!options.isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** Static security headers applied to every response (see also next.config.ts). */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];
