import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      ...(process.env.ALLOW_INDEXING !== "true" ? [{key:"X-Robots-Tag",value:"noindex, nofollow"}] : []),
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
  // Resolve the "@/..." imports explicitly so the build doesn't depend on how tsconfig paths are read.
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, "@": path.join(root, "src") };
    return config;
  },
};
export default nextConfig;
