import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * next-intl needs its plugin registered so Server Components can resolve
 * `i18n/request.ts` (the default path) — without it every translated route
 * throws "Couldn't find next-intl config file" at request time.
 */
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // APON reads live data from Postgres on every request; classic dynamic
  // rendering keeps Server Components + Server Actions predictable.
  cacheComponents: false,
  poweredByHeader: false,

  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      // Next injects inline bootstrap scripts; keep the policy compatible until
      // a nonce-based CSP is introduced.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self' ws: wss: https://api.cloudinary.com",
      "worker-src 'self' blob:",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  experimental: {
    // Enables `forbidden()` / `forbidden.tsx` for role-based 403 pages.
    authInterrupts: true,
    serverActions: {
      // Uploads go through a Server Action (see lib/actions/uploads.ts).
      // Largest accepted file is 8 MB (lib/uploads/policy.ts) plus form overhead.
      bodySizeLimit: "9mb",
    },
    // proxy.ts buffers request bodies; keep it above the upload limit.
    proxyClientMaxBodySize: "10mb",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      // User uploads (avatars, activity covers, venue photos).
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
    // Unsplash serves already-optimised derivatives; keep formats light.
    formats: ["image/avif", "image/webp"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
