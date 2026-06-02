import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strip "X-Powered-By" header
  poweredByHeader: false,

  // Enable gzip/brotli compression
  compress: true,

  // Optimize barrel imports for large packages (avoids importing entire lib)
  experimental: {
    optimizePackageImports: ["lightweight-charts"],
  },

  // Security & performance headers
  async headers() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.stockpulse.tw";
    // Derive wss:// counterpart for WebSocket connections
    const wsUrl = apiUrl.replace(/^https?:\/\//, "wss://").replace(/^http:\/\//, "ws://");

    const csp = [
      "default-src 'self'",
      // 'unsafe-inline' is required for the theme-detection script injected via
      // dangerouslySetInnerHTML in layout.tsx. Remove it once that moves to a
      // nonce-based or hash-based inline script.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // News thumbnails and chart images come from external CDNs
      "img-src 'self' data: https:",
      // API calls + WebSocket quotes feed
      `connect-src 'self' ${apiUrl} ${wsUrl}`,
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          // Content Security Policy — last-line defence against XSS
          { key: "Content-Security-Policy", value: csp },
          // Clickjacking protection
          { key: "X-Frame-Options",         value: "SAMEORIGIN" },
          // MIME-type sniffing protection
          { key: "X-Content-Type-Options",  value: "nosniff" },
          // Enable DNS prefetching for faster external resource load
          { key: "X-DNS-Prefetch-Control",  value: "on" },
          // Referrer policy
          { key: "Referrer-Policy",         value: "strict-origin-when-cross-origin" },
          // Permissions policy: restrict unneeded browser features
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Strict HTTPS (1 year; add '; preload' and submit to hstspreload.org when ready)
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
      // Long-cache for hashed static assets
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },

  // Rewrites: proxy /api/* → FastAPI backend in dev
  // (Production: handled by Vercel rewrites or Nginx)
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return process.env.NODE_ENV === "development"
      ? [
          {
            source: "/api/:path*",
            destination: `${apiBase}/api/:path*`,
          },
        ]
      : [];
  },
};

export default nextConfig;
