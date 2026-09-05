import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optional local isolation when OneDrive holds reparse points in old .next output.
  // Normal production/CI builds retain the standard directory.
  distDir: process.env.BENTAN_ISOLATED_BUILD === "true" ? ".next-staff-test" : ".next",
};

export default nextConfig;
