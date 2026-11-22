import type { NextConfig } from "next";

const config: NextConfig = {
  // Database drivers are loaded at runtime, never bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Migrations are read from disk at startup, so serverless deployments must ship them.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
};
export default config;
