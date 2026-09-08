/**
 * Copies the pdf.js worker that react-pdf pins into public/ so the browser can
 * load it from a stable URL.
 *
 * Why not bundle it: pdf.js loads its worker through a dynamic import annotated
 * with `webpackIgnore`, which Turbopack does not honour (vercel/next.js#65406).
 * Serving the worker as a static asset and pointing `workerSrc` at it sidesteps
 * the bundler entirely.
 *
 * react-pdf depends on an exact pdfjs-dist version, so we resolve the file
 * through react-pdf's own dependency rather than declaring pdfjs-dist ourselves.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

try {
  const pdfjsEntry = require.resolve("pdfjs-dist/package.json");
  const workerSrc = join(dirname(pdfjsEntry), "build", "pdf.worker.min.mjs");
  const publicDir = join(process.cwd(), "public");

  mkdirSync(publicDir, { recursive: true });
  copyFileSync(workerSrc, join(publicDir, "pdf.worker.min.mjs"));
  console.log("[copy-pdf-worker] public/pdf.worker.min.mjs updated");
} catch (error) {
  // Never fail the install over this - the viewer surfaces a clear error if the
  // worker is missing, and a broken postinstall would block `npm install`
  // entirely (including on Vercel).
  console.warn(
    "[copy-pdf-worker] could not copy the pdf.js worker:",
    error instanceof Error ? error.message : error,
  );
}
