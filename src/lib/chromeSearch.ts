/**
 * Search provider (see searchProvider.ts): drives a real Chrome over raw
 * CDP to load google.com/search and scrape the rendered results. Opt-in
 * (CHROME_BIN), and when enabled it's the PRIMARY provider — serper and
 * serpent are its fallbacks (see brandability.ts's searchWithFallback). Tested 2026-09-29 from the dev
 * machine: the Chameleon/Lightpanda engine got Google's "unusual traffic"
 * reCAPTCHA page with and without the residential proxy, while a real
 * Chrome through the proxy got a full results page, so the browser
 * fingerprint (not the IP alone) is what matters here.
 *
 * Off unless CHROME_BIN points at a Chrome/Chromium binary. Optional
 * GOOGLE_PROXY_URL (http://user:pass@host:port — a residential proxy,
 * never committed) routes it; without one, Google will very likely
 * challenge a datacenter IP, which the retry/cooldown below absorbs.
 *
 * Headless vs headful: tested 2026-09-29, Google served its reCAPTCHA
 * ("unusual traffic") page to headless Chrome from every network tried
 * (home IP without a proxy, residential proxy, production server), while the
 * same Chrome build run headful from the same home IP got real results. So
 * CHROME_HEADFUL=1 runs it headful — on the existing DISPLAY if there is
 * one, otherwise on a private Xvfb virtual display started here (the
 * production container has no display; the image ships xvfb).
 *
 * Speed: one headless Chrome is launched lazily and kept warm (reused
 * TLS/proxy connections and cookies; closed after IDLE_MS unused), each
 * search is just a new tab, and the page is read as soon as the results
 * block exists rather than after the full load event. A failure trips a
 * COOLDOWN_MS circuit breaker (isChromeSearchAvailable) so a blocked IP
 * doesn't cost every subsequent check a slow failed attempt before the
 * API fallbacks run.
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
export const CHROME_SEARCH_TIMEOUT_MS = 30000;
const MAX_CONCURRENT = 2;
/** Warm Chrome is closed after this long with no search in flight. */
const IDLE_MS = 5 * 60 * 1000;
/** After a failed search, isChromeSearchAvailable() is false for this long,
 * doubling with each consecutive failure up to MAX_COOLDOWN_MS and reset by
 * the next success — so a persistently blocked setup costs a slow failed
 * attempt only every few minutes, not on every check. */
const COOLDOWN_MS = 60 * 1000;
const MAX_COOLDOWN_MS = 15 * 60 * 1000;
const POLL_MS = 150;
/** The proxy hands out a new exit IP per new connection, and a fair share of
 * them are already burned for Google (observed live: roughly every other
 * request got the "unusual traffic" page). A warm Chrome reuses one tunnel,
 * so on a blocked page it is closed and the search retried on a fresh
 * Chrome — i.e. a fresh IP. */
const MAX_ATTEMPTS = 2;

export function isChromeSearchEnabled(): boolean {
  return Boolean(process.env.CHROME_BIN);
}

let cooldownUntil = 0;
let consecutiveFailures = 0;
/** Enabled AND not in the post-failure cooldown — what brandability.ts
 * checks before putting Chrome first in the provider order. */
export function isChromeSearchAvailable(): boolean {
  return isChromeSearchEnabled() && Date.now() >= cooldownUntil;
}
export function resetChromeCooldown(): void {
  cooldownUntil = 0;
  consecutiveFailures = 0;
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

/** Starts a private virtual display and resolves its name (":N"). Xvfb picks
 * a free display number itself (-displayfd) and prints it on fd 1, so a
 * stale lock file from a crashed earlier run can't collide. */
function startXvfb(): Promise<{ proc: ReturnType<typeof spawn>; display: string }> {
  const proc = spawn(process.env.XVFB_BIN ?? "Xvfb", ["-screen", "0", "1280x800x24", "-nolisten", "tcp", "-displayfd", "1"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  return new Promise((resolve, reject) => {
    const fail = () => {
      clearTimeout(timer);
      proc.kill();
      reject(new ChromeSearchError("chrome_search_xvfb_failed"));
    };
    const timer = setTimeout(fail, 5000);
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => {
      out += String(d);
      const m = out.match(/^(\d+)\n/);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, display: `:${m[1]}` });
      }
    });
    proc.on("error", fail);
    proc.on("exit", fail);
  });
}

interface CdpReply {
  result?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  error?: unknown;
}
interface Browser {
  proc: ReturnType<typeof spawn>;
  send: (method: string, params?: object, sessionId?: string) => Promise<CdpReply>;
  ua: string;
  close: () => void;
}

let browserPromise: Promise<Browser> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let exitHookInstalled = false;

async function launchBrowser(): Promise<Browser> {
  const chromeBin = process.env.CHROME_BIN;
  if (!chromeBin) throw new ChromeSearchError("chrome_search_disabled");

  const headful = process.env.CHROME_HEADFUL === "1";
  let display = process.env.DISPLAY;
  const xvfb = headful && !display ? await startXvfb() : undefined;
  if (xvfb) display = xvfb.display;

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "namernut-chrome-"));
  const args = [
    // Port 0 + DevToolsActivePort file: no port collisions between
    // concurrent processes / dev-server reloads.
    "--remote-debugging-port=0",
    `--user-data-dir=${userDir}`,
    ...(headful ? ["--window-size=1280,800"] : ["--headless=new"]),
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
  const proc = spawn(chromeBin, [...args, "about:blank"], {
    stdio: "ignore",
    env: display ? { ...process.env, DISPLAY: display } : process.env,
  });
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once("exit", () => {
      void browserPromise?.then((b) => b.proc.kill()).catch(() => {});
    });
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (browserPromise === thisBrowser) browserPromise = undefined;
    proc.kill();
    xvfb?.proc.kill();
    forwarder?.close();
    // Chrome may still be flushing into its profile for a moment after the
    // kill (ENOTEMPTY), and cleanup failing must never mask a search
    // outcome — retry in the background and ignore errors.
    fs.promises.rm(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  };
  proc.on?.("exit", close);
  const thisBrowser: Promise<Browser> = (async () => {
    try {
      let endpoint: string | undefined;
      for (let i = 0; i < 100 && !endpoint; i++) {
        try {
          const [port, wsPath] = fs.readFileSync(path.join(userDir, "DevToolsActivePort"), "utf8").split("\n");
          if (port && wsPath) endpoint = `ws://127.0.0.1:${port}${wsPath}`;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      if (!endpoint) throw new ChromeSearchError("chrome_search_launch_failed");

      const ws = new WebSocket(endpoint);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new ChromeSearchError("chrome_search_launch_failed"));
      });
      let id = 0;
      const pending = new Map<number, (d: CdpReply) => void>();
      ws.onmessage = (m) => {
        const d = JSON.parse(String(m.data));
        if (d.id) pending.get(d.id)?.(d);
      };
      ws.onclose = () => {
        pending.forEach((cb) => cb({ error: "closed" }));
        close();
      };
      const send = (method: string, params: object = {}, sessionId?: string) =>
        new Promise<CdpReply>((resolve) => {
          const i = ++id;
          pending.set(i, (d) => {
            pending.delete(i);
            resolve(d);
          });
          ws.send(JSON.stringify({ id: i, method, params, sessionId }));
        });
      // Headless advertises itself in the UA ("HeadlessChrome/143").
      const version = await send("Browser.getVersion");
      const ua = String(version.result?.userAgent ?? "").replace("HeadlessChrome", "Chrome");
      return { proc, send, ua, close };
    } catch (err) {
      close();
      throw err;
    }
  })();
  browserPromise = thisBrowser;
  return thisBrowser;
}

/** Exposed for tests and graceful shutdown. */
export async function shutdownChrome(): Promise<void> {
  const b = await browserPromise?.catch(() => undefined);
  b?.close();
}

// Bit 0 = not there yet; 1 = blocked; 2 = results block present (and the
// document parsed past "loading", so the bottom-of-page blocks exist too);
// 3 = fully loaded with no results block (zero-result / odd page).
const READY_SCRIPT = `(function () {
  if (location.href === "about:blank") return 0;
  if (/^\\/sorry\\//.test(location.pathname) || document.querySelector("#captcha-form, .g-recaptcha")) return 1;
  if (document.readyState !== "loading" && document.querySelector("#rso a h3")) return 2;
  if (document.readyState === "complete") return 3;
  return 0;
})()`;

async function scrape(url: string, signal?: AbortSignal): Promise<{ data: Extracted; browser: Browser }> {
  signal?.throwIfAborted();
  const browser = await (browserPromise ?? launchBrowser());
  if (idleTimer) clearTimeout(idleTimer);
  const { send } = browser;
  const call = async (method: string, params?: object, sessionId?: string) => {
    const r = await send(method, params, sessionId);
    if (r.error === "closed") throw new ChromeSearchError("chrome_search_browser_died");
    return r;
  };

  let targetId: string | undefined;
  try {
    const created = await call("Target.createTarget", { url: "about:blank" });
    targetId = created.result?.targetId as string;
    const attached = await call("Target.attachToTarget", { targetId, flatten: true });
    const sid = attached.result?.sessionId as string;
    const evaluate = async (expression: string) =>
      (await call("Runtime.evaluate", { expression, returnByValue: true }, sid)).result?.result?.value;

    await call("Network.enable", {}, sid);
    // Deliberately no Network.setBlockedURLs to save proxy bandwidth: with
    // images/fonts/media blocked, live requests got Google's bot challenge.
    await call("Network.setUserAgentOverride", { userAgent: browser.ua }, sid);
    const nav = await call("Page.navigate", { url }, sid);
    if (nav.result?.errorText) throw new ChromeSearchError(`chrome_search_nav_${nav.result.errorText}`);

    const deadline = Date.now() + CHROME_SEARCH_TIMEOUT_MS;
    let state = 0;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      state = Number(await evaluate(READY_SCRIPT)) || 0;
      if (state) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (!state) throw new ChromeSearchError("chrome_search_timeout");
    // Late-inserted blocks (PAA answers, related searches) settle shortly after.
    if (state === 2) await new Promise((r) => setTimeout(r, 250));
    const json = await evaluate(EXTRACT_SCRIPT);
    if (typeof json !== "string") throw new ChromeSearchError("chrome_search_extract_failed");
    return { data: JSON.parse(json) as Extracted, browser };
  } finally {
    if (targetId) void send("Target.closeTarget", { targetId });
    if (active <= 1 && waiting.length === 0) {
      idleTimer = setTimeout(browser.close, IDLE_MS);
      idleTimer.unref?.();
    }
  }
}

/** `region` is Google's `gl` param; `hl=en` pins the UI language so the
 * "Showing results for" / related-search text is always English regardless
 * of where the proxy exits (the same query came back in Ukrainian through
 * a Ukrainian exit IP without it). */
export async function chromeSearch(query: string, region: string, signal?: AbortSignal): Promise<SearchResponse> {
  if (!isChromeSearchEnabled()) throw new ChromeSearchError("chrome_search_disabled");
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${encodeURIComponent(region)}&hl=en`;
  await acquire(signal);
  try {
    let lastErr: unknown;
    let response: SearchResponse | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { data, browser } = await scrape(url, signal);
        try {
          response = toSearchResponse(data);
          break;
        } catch (err) {
          // Blocked: this Chrome's tunnel has a burned exit IP — drop it.
          if ((err as Error).message === "chrome_search_blocked") browser.close();
          throw err;
        }
      } catch (err) {
        lastErr = err;
        const retryable = ["chrome_search_blocked", "chrome_search_browser_died"].includes((err as Error).message);
        if (signal?.aborted || !retryable) break;
      }
    }
    if (!response) throw lastErr;
    consecutiveFailures = 0;
    return response;
  } catch (err) {
    // A caller-side cancellation says nothing about Chrome's health.
    if (!signal?.aborted) {
      consecutiveFailures++;
      cooldownUntil = Date.now() + Math.min(COOLDOWN_MS * 2 ** (consecutiveFailures - 1), MAX_COOLDOWN_MS);
    }
    throw err;
  } finally {
    release();
  }
}
