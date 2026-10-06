// Lets plain `node` run scripts that import from src/ (Node strips the TypeScript types itself):
// resolves the "@/…" alias (same as tsconfig "paths") and extensionless relative imports ("./parser" → "./parser.ts").
//   node --import ./scripts/ts-paths.mjs scripts/some-script.mts
import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  let spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
  const local = spec.startsWith(".") || spec.startsWith("file:");
  if (local && context.parentURL && !/\.(m?[jt]s|tsx|json)$/.test(spec)) {
    const base = new URL(spec, context.parentURL).href;
    const hit = [".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find((u) => existsSync(fileURLToPath(u)));
    if (hit) spec = hit;
  }
  return next(spec, context);
}

// When loaded via --import, register this same file as the resolve hook
if (!globalThis.__tsPathsRegistered) {
  globalThis.__tsPathsRegistered = true;
  register(import.meta.url);
}
