import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js (via unpdf) resolves its worker with a dynamic import annotated
  // `webpackIgnore`, which Turbopack does not honour. Keeping these packages
  // external means Node requires them at runtime instead of bundling them.
  serverExternalPackages: ["unpdf", "pdfjs-dist"],

  // Next regenerates AGENTS.md / CLAUDE.md on every dev run; this repo is a
  // deliverable, and the README is the documentation.
  agentRules: false,
};

export default nextConfig;
