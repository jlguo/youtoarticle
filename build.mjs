import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";

mkdirSync("public", { recursive: true });

// Build Tailwind CSS
execSync(
  "./node_modules/.bin/tailwindcss -i src/frontend/tailwind.css -o public/app.css --minify",
  { stdio: "inherit" },
);

// Bundle JS
await esbuild.build({
  entryPoints: ["src/frontend/app.ts"],
  outdir: "public",
  bundle: true,
  format: "esm",
  minify: false,
  sourcemap: true,
});

copyFileSync("src/frontend/index.html", "public/index.html");

console.log("Frontend bundled successfully.");
