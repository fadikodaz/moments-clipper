import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The old example pages are gone; anyone with an old link lands on their projects.
  redirects() {
    return ["/clips", "/clips/:path*", "/narration", "/schedule"].map((source) => ({ source, destination: "/projects", permanent: false }));
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
