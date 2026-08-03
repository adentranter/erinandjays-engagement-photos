import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Images are served through our own sharp-backed route handler,
  // so the built-in optimizer isn't needed.
  images: { unoptimized: true },
};

export default nextConfig;
