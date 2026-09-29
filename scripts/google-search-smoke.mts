// Runs the real Chrome search provider (src/lib/chromeSearch.ts) against live
// Google for a few queries and prints what came back — timing, result count,
// top URLs, context, or the failure. Meant for the production container but
// runs anywhere CHROME_BIN is set:
//
//   CHROME_BIN=... [GOOGLE_PROXY_URL=...] node --experimental-strip-types scripts/google-search-smoke.mts [query ...]
//
// Each query is a real Google request (metered on a residential proxy), so
// the default is just two. CHROME_SEARCH_MODULE overrides the module path
// (used to run a copy of chromeSearch.ts placed next to this script in a
// container, where the repo layout doesn't exist).
const modPath = process.env.CHROME_SEARCH_MODULE ?? "../src/lib/chromeSearch.ts";
const { chromeSearch, shutdownChrome, isChromeSearchAvailable } = await import(modPath);

console.log(
  `CHROME_BIN=${process.env.CHROME_BIN ?? "(unset)"}  GOOGLE_PROXY_URL=${process.env.GOOGLE_PROXY_URL ? "set" : "unset"}`
);
const queries = process.argv.slice(2);
if (queries.length === 0) queries.push("fondterm", "oddago");

let failures = 0;
for (const q of queries) {
  const t = Date.now();
  try {
    const r = await chromeSearch(q, "us");
    console.log(`\n"${q}": ${Date.now() - t} ms, ${r.results.length} results`);
    for (const x of r.results.slice(0, 3)) console.log(`  - ${x.title}  <${x.url}>`);
    if (r.context) console.log("  context:", JSON.stringify(r.context).slice(0, 300));
  } catch (e) {
    failures++;
    console.log(`\n"${q}": ${Date.now() - t} ms FAILED: ${(e as Error).message}  (available now: ${isChromeSearchAvailable()})`);
  }
}
await shutdownChrome();
console.log(`\n${queries.length - failures}/${queries.length} succeeded`);
process.exit(failures ? 1 : 0);
