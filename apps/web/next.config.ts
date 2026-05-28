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
    return [
      {
        source: "/:path*",
        headers: [
          // Clickjacking protection
          { key: "X-Frame-Options",       value: "SAMEORIGIN" },
          // MIME-type sniffing protection
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Enable DNS prefetching for faster external resource load
          { key: "X-DNS-Prefetch-Control", value: "on" },
          // Referrer policy
          { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
          // Permissions policy: restrict unneeded browser features
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Strict HTTPS (1 year; preload for production)
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
