import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@jamroom/ui", "@jamroom/shared-types"],
};

export default nextConfig;
