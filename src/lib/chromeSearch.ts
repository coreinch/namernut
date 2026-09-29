/**
 * Third search provider (see searchProvider.ts): drives a real Chrome over
 * raw CDP to load google.com/search and scrape the rendered results —
 * opt-in, and only ever tried after serper and serpent have both failed
 * (see brandability.ts's searchWithFallback). Tested 2026-09-29 from the dev
 * machine: the Chameleon/Lightpanda engine got Google's "unusual traffic"
 * reCAPTCHA page with and without the residential proxy, while a real
 * Chrome through the proxy got a full results page, so the browser
 * fingerprint (not the IP alone) is what matters here.
 *
 * Off unless CHROME_BIN points at a Chrome/Chromium binary. Optional
 * GOOGLE_PROXY_URL (http://user:pass@host:port — a residential proxy,
 * never committed) routes it; without one, Google will very likely
 * challenge a datacenter IP. Every search launches a fresh Chrome with a
 * throwaway profile and downloads a full results page (~1MB), which is metered bandwidth on a residential
 * proxy and slow — hence the last-resort position, the small concurrency
 * cap, and the longer timeout (CHROME_SEARCH_TIMEOUT_MS) than the API
 * providers get.
 *
 * Google's markup churns, so the scrape is best-effort and structural: it
 * refuses to return an empty result list for a page that doesn't look like
 * a results page at all (a blank/blocked page must throw so the caller
 * moves on, not read as "nothing on the web matches this name").
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { SearchContext, SearchResponse, SearchResult } from "@/lib/searchProvider";

/** Longer than the API providers' 12s: launching Chrome and loading a full
 * results page through a residential proxy took ~23s in the one live run. */
export const CHROME_SEARCH_TIMEOUT_MS = 40000;
const MAX_CONCURRENT = 2;

export function isChromeSearchEnabled(): boolean {
  return Boolean(process.env.CHROME_BIN);
}

export class ChromeSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChromeSearchError";
  }
}

/** Runs inside the page (via Runtime.evaluate) — plain ES5-ish JS in a
 * string so no bundler/transpiler helper can leak into it, and so the unit
 * test can run the very same source against a jsdom document. */
export const EXTRACT_SCRIPT = `(function () {
  var doc = document;
  var blocked = /^\\/sorry\\//.test(location.pathname) || !!doc.querySelector("#captcha-form, .g-recaptcha");
  var looksLikeResults = !!doc.querySelector("#center_col, #search, #rso");
  var results = [];
  var seen = {};
  var heads = doc.querySelectorAll("a h3");
  for (var i = 0; i < heads.length; i++) {
    var h3 = heads[i];
    var a = h3.closest("a");
    if (!a) continue;
    var url = a.getAttribute("href") || "";
    // Google rewrites hrefs to opaque /goto?url=... redirects; the <cite>
    // breadcrumb ("https://host › a › b") is the readable origin. It
    // ellipsizes long paths, so only trust the path when nothing was cut.
    var cite = a.querySelector("cite");
    if (!/^https?:\\/\\//.test(url) || /^https?:\\/\\/([a-z0-9.-]+\\.)?google\\./.test(url)) {
      url = "";
      if (cite) {
        var parts = cite.textContent.split(/\\s*\\u203a\\s*/);
        var cut = parts.some(function (p) { return /(\\u2026|\\.\\.\\.)\\s*$/.test(p); });
        url = (cut ? parts[0] : parts.join("/")).replace(/\\s+/g, "");
        // Some cites are not URLs at all (social posts: "3.1K reactions").
        if (!/^https?:\\/\\/[a-z0-9.-]+\\.[a-z]{2,}(\\/|$)/i.test(url)) url = "";
      }
    }
    if (!url || seen[url]) continue;
    seen[url] = true;
    var box = h3.closest("div.MjjYud, div.g");
    var snip = box && box.querySelector("[data-sncf], div.VwiC3b");
    results.push({
      title: h3.textContent.trim(),
      description: snip ? snip.textContent.trim() : "",
      url: url
    });
  }
  var context = {};
  var fixed = doc.querySelector("#fprsl");
  if (fixed && fixed.textContent.trim()) context.showingResultsFor = fixed.textContent.trim();
  var paa = [];
  var qs = doc.querySelectorAll(".related-question-pair[data-q]");
  for (var j = 0; j < qs.length; j++) paa.push(qs[j].getAttribute("data-q"));
  if (paa.length) context.peopleAlsoAsk = paa;
  var related = [];
  var rl = doc.querySelectorAll("#botstuff a[href^='/search']");
  for (var k = 0; k < rl.length; k++) {
    var t = rl[k].textContent.trim();
    if (rl[k].closest("table, #navcnt, [role=navigation]") || t.length < 3) continue;
    if (related.indexOf(t) < 0) related.push(t);
  }
  if (related.length) context.relatedSearches = related;
  var title = doc.querySelector("[data-attrid='title']");
  var desc = doc.querySelector("[data-attrid='description']");
  if (title || desc) {
    context.knowledgeGraph = {
      title: title ? title.textContent.trim() : undefined,
      description: desc ? desc.textContent.trim() : undefined
    };
  }
  return JSON.stringify({ blocked: blocked, looksLikeResults: looksLikeResults, results: results, context: context });
})()`;

interface Extracted {
  blocked: boolean;
  looksLikeResults: boolean;
  results: SearchResult[];
  context: SearchContext;
}

export function toSearchResponse(x: Extracted): SearchResponse {
  if (x.blocked) throw new ChromeSearchError("chrome_search_blocked");
  if (!x.looksLikeResults) throw new ChromeSearchError("chrome_search_not_a_results_page");
  return Object.keys(x.context).length > 0 ? { results: x.results, context: x.context } : { results: x.results };
}

/** Local CONNECT forwarder that adds Proxy-Authorization itself: answering
 * the proxy's auth challenge over CDP failed with
 * ERR_INVALID_AUTH_CREDENTIALS for google.com (worked for other hosts), so
 * Chrome is pointed at this credential-less local hop instead. */
export function startAuthForwarder(upstream: string): Promise<http.Server> {
  const u = new URL(upstream);
  const auth = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
  const server = http.createServer((_, res) => {
    res.statusCode = 405;
    res.end();
  });
  server.on("connect", (req, client, head) => {
    const up = net.connect(Number(u.port) || 80, u.hostname, () => {
      up.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      up.off("data", onData);
      if (/^HTTP\/1\.[01] 200/.test(buf.toString("latin1", 0, 15))) {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) up.write(head);
        const rest = buf.subarray(end + 4);
        if (rest.length) client.write(rest);
        up.pipe(client);
        client.pipe(up);
      } else {
        client.end(buf.subarray(0, end + 4));
        up.destroy();
      }
    };
    up.on("data", onData);
    up.on("error", () => client.destroy());
    client.on("error", () => up.destroy());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let active = 0;
const waiting: Array<() => void> = [];
async function acquire(signal?: AbortSignal): Promise<void> {
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => resolve();
      waiting.push(wake);
      signal?.addEventListener(
        "abort",
        () => {
          const i = waiting.indexOf(wake);
          if (i >= 0) waiting.splice(i, 1);
          reject(signal.reason);
        },
        { once: true }
      );
    });
  }
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}

async function scrape(url: string, signal?: AbortSignal): Promise<Extracted> {
  const chromeBin = process.env.CHROME_BIN;
  if (!chromeBin) throw new ChromeSearchError("chrome_search_disabled");
  signal?.throwIfAborted();

  const port = 9400 + Math.floor(Math.random() * 500);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "namernut-chrome-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--mute-audio",
  ];
  let forwarder: http.Server | undefined;
  const proxy = process.env.GOOGLE_PROXY_URL;
  if (proxy) {
    if (new URL(proxy).username) {
      forwarder = await startAuthForwarder(proxy);
      args.push(`--proxy-server=http://127.0.0.1:${(forwarder.address() as net.AddressInfo).port}`);
    } else {
      args.push(`--proxy-server=${proxy}`);
    }
  }
  const proc = spawn(chromeBin, [...args, "about:blank"], { stdio: "ignore" });
  const onAbort = () => proc.kill();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let wsUrl: string | undefined;
    for (let i = 0; i < 100 && !wsUrl; i++) {
      signal?.throwIfAborted();
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        wsUrl = ((await res.json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!wsUrl) throw new ChromeSearchError("chrome_search_launch_failed");

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new ChromeSearchError("chrome_search_launch_failed"));
    });
    let id = 0;
    const pending = new Map<number, (d: { result?: any; error?: unknown }) => void>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    const listeners: Array<(d: { method?: string }) => void> = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id) pending.get(d.id)?.(d);
      else listeners.forEach((l) => l(d));
    };
    ws.onclose = () => pending.forEach((cb) => cb({ error: "closed" }));
    const send = (method: string, params: object = {}, sessionId?: string) =>
      new Promise<{ result?: any; error?: unknown }>((resolve) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const i = ++id;
        pending.set(i, resolve);
        ws.send(JSON.stringify({ id: i, method, params, sessionId }));
      });
    const evaluate = async (sid: string, expression: string) =>
      (await send("Runtime.evaluate", { expression, returnByValue: true }, sid)).result?.result?.value;

    try {
      const { result: t } = await send("Target.createTarget", { url: "about:blank" });
      const { result: a } = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
      const sid: string = a.sessionId;
      // Headless advertises itself in the UA ("HeadlessChrome/143").
      const ua = (await evaluate(sid, "navigator.userAgent")) as string;
      await send("Network.enable", {}, sid);
      // Deliberately no Network.setBlockedURLs to save proxy bandwidth: with
      // images/fonts/media blocked, live requests got Google's bot challenge.
      await send("Network.setUserAgentOverride", { userAgent: ua.replace("HeadlessChrome", "Chrome") }, sid);
      await send("Page.enable", {}, sid);
      const loaded = new Promise<void>((resolve) => listeners.push((d) => d.method === "Page.loadEventFired" && resolve()));
      const nav = await send("Page.navigate", { url }, sid);
      if (nav.result?.errorText) throw new ChromeSearchError(`chrome_search_nav_${nav.result.errorText}`);
      await loaded;
      // Wait for the real document (not the initial about:blank).
      for (let i = 0; i < 20; i++) {
        signal?.throwIfAborted();
        if (await evaluate(sid, "location.href !== 'about:blank' && document.readyState === 'complete' && !!document.body && document.body.innerText.length > 0")) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await new Promise((r) => setTimeout(r, 500)); // late-inserted blocks (PAA, related)
      const json = await evaluate(sid, EXTRACT_SCRIPT);
      if (typeof json !== "string") throw new ChromeSearchError("chrome_search_extract_failed");
      return JSON.parse(json) as Extracted;
    } finally {
      ws.close();
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    proc.kill();
    forwarder?.close();
    // Chrome may still be flushing into its profile for a moment after the
    // kill (ENOTEMPTY), and cleanup failing must never mask the search
    // outcome — retry in the background and ignore errors.
    fs.promises.rm(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
}

/** `region` is Google's `gl` param; `hl=en` pins the UI language so the
 * "Showing results for" / related-search text is always English regardless
 * of where the proxy exits (the same query came back in Ukrainian through
 * a Ukrainian exit IP without it). */
export async function chromeSearch(query: string, region: string, signal?: AbortSignal): Promise<SearchResponse> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${encodeURIComponent(region)}&hl=en`;
  await acquire(signal);
  try {
    return toSearchResponse(await scrape(url, signal));
  } finally {
    release();
  }
}
