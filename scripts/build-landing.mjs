// Publish the dashboard (at /) and the ClinRadar launch page (at /site/) as static files, using the dashboard's
// embedded data and browser storage. The Node/SQLite server and private working directories are not static assets.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const output = new URL("dist/landing/", root);
const entryTag = '<html lang="en">';
const staticTag = '<html lang="en" data-regchain-mode="static">';

// Mark a page as standalone so HTTPS hosting does not send requests to the Node server.
async function standalone(source, target) {
  const html = await readFile(source, "utf8");
  if (!html.includes(entryTag)) throw new Error(`The <html> tag in ${source.pathname} changed; update the landing build.`);
  await writeFile(target, html.replace(entryTag, staticTag));
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await standalone(new URL("RegChain-AI-Dashboard.html", root), new URL("index.html", output));
await cp(new URL("sites/clinradar/", root), new URL("site/", output), { recursive: true });
await standalone(new URL("sites/clinradar/index.html", root), new URL("site/index.html", output));
console.log("Built dist/landing: the dashboard at / and the launch page at /site/ (standalone mode).");
