import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same as "@/*" → "./src/*" in tsconfig
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
