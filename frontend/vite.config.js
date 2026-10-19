import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import fs from "node:fs";
import path from "node:path";

function copyMediaPipeRuntime() {
  let publicDir;
  let packageDir;

  const copyRuntime = () => {
    const destination = path.join(publicDir, "mediapipe");
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(
      path.join(packageDir, "vision_bundle.cjs"),
      path.join(destination, "vision_bundle.js"),
    );
    fs.cpSync(
      path.join(packageDir, "wasm"),
      path.join(destination, "wasm"),
      { recursive: true },
    );
  };

  return {
    name: "copy-mediapipe-runtime",
    configResolved(config) {
      publicDir = config.publicDir;
      packageDir = path.resolve(config.root, "node_modules/@mediapipe/tasks-vision");
      if (!fs.existsSync(path.join(packageDir, "vision_bundle.cjs"))) {
        throw new Error("MediaPipe vision_bundle.cjs not found. Run npm install in frontend first.");
      }
      copyRuntime();
    },
    configureServer() {
      copyRuntime();
    },
  };
}

export default defineConfig({
  plugins: [react(), basicSsl(), copyMediaPipeRuntime()],
});
