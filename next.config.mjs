import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  distDir: process.env.NEXT_DIST_DIR ?? (phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next"),
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  experimental: {
    typedRoutes: false,
    serverComponentsExternalPackages: ["geoip-lite", "pdfmake"],
    outputFileTracingExcludes: {
      "/*": [
        ".agents/**/*",
        ".codex/**/*",
        ".git/**/*",
        ".vs/**/*",
        ".next/**/*",
        ".next-*",
        ".next-*/**/*",
        ".next-dev/**/*",
        ".next-e2e/**/*",
        ".postgres-data/**/*",
        "backups/**/*",
        "resources/**/*",
        "test-results/**/*",
        ".tmp-*.log",
        "dev-*.log",
        "*.log"
      ]
    }
  }
});

export default nextConfig;
