import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

mkdirSync("public", { recursive: true });

await esbuild.build({
  entryPoints: ["src/frontend/app.js"],
  outdir: "public",
  bundle: true,
  format: "esm",
  minify: false,
  sourcemap: true,
});

copyFileSync("src/frontend/index.html", "public/index.html");
copyFileSync("src/frontend/app.css", "public/app.css");

console.log("Frontend bundled successfully.");
