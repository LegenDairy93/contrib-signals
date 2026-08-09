import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "github-pages",
  base: "/forkyssey/",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../../../web",
    emptyOutDir: true,
  },
});
