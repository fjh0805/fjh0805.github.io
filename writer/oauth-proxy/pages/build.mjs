import { mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "dist");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await esbuild.build({
    entryPoints: [path.join(here, "entry.js")],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: path.join(outDir, "_worker.js"),
    legalComments: "none"
});
await cp(path.join(here, "index.html"), path.join(outDir, "index.html"));
console.log(outDir);
