import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@doctobook/config", "@doctobook/shared"]
};

export default nextConfig;
