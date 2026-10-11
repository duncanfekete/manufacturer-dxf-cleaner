import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { repositoryPlugin } from "./server/repository.mjs";
export default defineConfig({
  plugins: [react(), repositoryPlugin()],
  server: { port: 5173, strictPort: true },
});
