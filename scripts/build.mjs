import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

function copyStatic() {
  mkdirSync(join(dist, "popup"), { recursive: true });
  mkdirSync(join(dist, "assets", "icons"), { recursive: true });
  mkdirSync(join(dist, "content"), { recursive: true });

  cpSync(join(root, "src/popup/popup.html"), join(dist, "popup/popup.html"));
  cpSync(join(root, "src/popup/popup.css"), join(dist, "popup/popup.css"));
  cpSync(join(root, "src/content/float.css"), join(dist, "content/float.css"));
  cpSync(join(root, "assets/icons"), join(dist, "assets/icons"), { recursive: true });

  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));
}

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  copyStatic();

  const common = {
    bundle: true,
    format: "iife",
    target: ["chrome110"],
    sourcemap: true,
    logLevel: "info",
  };

  const contexts = await Promise.all([
    esbuild.context({
      ...common,
      entryPoints: [join(root, "src/background/service-worker.ts")],
      outfile: join(dist, "background/service-worker.js"),
      platform: "browser",
    }),
    esbuild.context({
      ...common,
      entryPoints: [join(root, "src/content/content.ts")],
      outfile: join(dist, "content/content.js"),
      platform: "browser",
    }),
    esbuild.context({
      ...common,
      entryPoints: [join(root, "src/popup/popup.ts")],
      outfile: join(dist, "popup/popup.js"),
      platform: "browser",
    }),
  ]);

  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes…");
  } else {
    await Promise.all(contexts.map(async (ctx) => {
      await ctx.rebuild();
      await ctx.dispose();
    }));
    console.log("Build complete → dist/");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
