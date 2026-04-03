import * as esbuild from "esbuild";

const common = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: "es2020",
};

await esbuild.build({
  ...common,
  entryPoints: ["src/index.js"],
  outfile: "dist/talkdom.min.js",
  format: "iife",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/websocket.js"],
  outfile: "dist/talkdom-ws.min.js",
  format: "iife",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/index.js"],
  outfile: "dist/talkdom.esm.js",
  format: "esm",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/websocket.js"],
  outfile: "dist/talkdom-ws.esm.js",
  format: "esm",
});

console.log("Build complete.");
