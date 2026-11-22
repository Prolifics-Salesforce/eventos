import type { NextConfig } from "next";

const config: NextConfig = {
  // Database drivers are loaded at runtime, never bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};
export default config;
