import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig 의 "@/*" → "./src/*" 와 동일
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
