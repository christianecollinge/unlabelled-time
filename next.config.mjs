import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone server output for a small Docker image (Cloud Run).
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname),
  devIndicators: false,
  // The in-process Postgres is for development and tests only: keep it out of
  // the server bundle and out of the production image.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingExcludes: { "*": ["node_modules/@electric-sql/**"] },
  // One privacy policy and one set of terms cover every Unlabelled tool, on the Unlabelled website.
  async redirects() {
    return [
      { source: "/privacy", destination: "https://unlabelled.cc/privacy", permanent: false },
      { source: "/terms", destination: "https://unlabelled.cc/terms", permanent: false },
    ];
  },
};
export default nextConfig;
