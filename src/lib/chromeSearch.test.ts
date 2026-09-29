// @vitest-environment jsdom
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => {
  const spawn = (...a: unknown[]) => spawnMock(...a);
  return { spawn, default: { spawn } };
});

import {
  CHROME_SEARCH_TIMEOUT_MS,
  ChromeSearchError,
  EXTRACT_SCRIPT,
  chromeSearch,
  isChromeSearchAvailable,
  isChromeSearchEnabled,
  resetChromeCooldown,
  shutdownChrome,
  startAuthForwarder,
  toSearchResponse,
} from "./chromeSearch";

const SERP = `<!doctype html><body>
<div id="center_col"><div id="rso">
  <div class="MjjYud"><a href="/goto?url=OPAQUE"><h3>Alpha Site</h3><cite>https://alpha.example › docs › intro</cite></a>
    <div data-sncf="1">Alpha snippet</div></div>
  <div class="MjjYud"><a href="/goto?url=OPAQUE2"><h3>Beta Site</h3><cite>https://beta.example › a › …</cite></a>
    <div class="VwiC3b">Beta snippet</div></div>
  <div class="MjjYud"><a href="https://direct.example/x"><h3>Direct</h3></a></div>
  <div class="MjjYud"><a href="https://direct.example/x"><h3>Dup</h3></a></div>
  <div class="MjjYud"><a href="/goto?url=NOCITE"><h3>No cite</h3></a></div>
  <div class="MjjYud"><a href="/goto?url=G"><h3>Glued</h3><cite>https://glued.example › 2021 › column...</cite></a></div>
  <div class="MjjYud"><a href="/goto?url=J"><h3>Junk</h3><cite>3.1K reactions</cite></a></div>
  <div class="related-question-pair" data-q="What is alpha?"></div>
</div></div>
<a id="fprsl">findterm</a>
<div id="botstuff"><table><tr><td><a href="/search?q=x">2</a></td></tr></table>
  <a href="/search?q=alpha+beta">alpha beta</a><a href="/search?q=alpha+beta">alpha beta</a><a href="/search?q=z">z</a></div>
<div data-attrid="title">Alpha Inc</div><div data-attrid="description">A company</div>
</body>`;

function run(html: string, path = "/search?q=x") {
  window.history.pushState({}, "", path);
  document.documentElement.innerHTML = html;
  return JSON.parse((0, eval)(EXTRACT_SCRIPT) as string);
}

describe("EXTRACT_SCRIPT", () => {
  it("reads organic results, resolving opaque hrefs from the cite breadcrumb", () => {
    const x = run(SERP);
    expect(x.blocked).toBe(false);
    expect(x.looksLikeResults).toBe(true);
    expect(x.results).toEqual([
      { title: "Alpha Site", description: "Alpha snippet", url: "https://alpha.example/docs/intro" },
      // path was ellipsized -> only the origin is trusted
      { title: "Beta Site", description: "Beta snippet", url: "https://beta.example" },
      { title: "Direct", description: "", url: "https://direct.example/x" },
      // ellipsis glued onto the last segment still means "path was cut"
      { title: "Glued", description: "", url: "https://glued.example" },
      // a cite that isn't a URL at all is dropped, not surfaced as one
    ]);
  });

  it("reads showingResultsFor, PAA, deduped related searches (not pagination) and the knowledge card", () => {
    expect(run(SERP).context).toEqual({
      showingResultsFor: "findterm",
      peopleAlsoAsk: ["What is alpha?"],
      relatedSearches: ["alpha beta"],
      knowledgeGraph: { title: "Alpha Inc", description: "A company" },
    });
  });

  it("flags Google's block pages and non-results pages", () => {
    expect(run("<body><form id='captcha-form'></form></body>").blocked).toBe(true);
    expect(run("<body></body>", "/sorry/index").blocked).toBe(true);
    expect(run("<body><p>hi</p></body>").looksLikeResults).toBe(false);
  });

  it("omits context entirely when there is none", () => {
    expect(run("<body><div id='rso'></div></body>").context).toEqual({});
  });
});

describe("toSearchResponse", () => {
  const base = { blocked: false, looksLikeResults: true, results: [], context: {} };
  it("throws for a blocked page and for a page that isn't a results page (never an empty 'nothing found')", () => {
    expect(() => toSearchResponse({ ...base, blocked: true })).toThrow("chrome_search_blocked");
    expect(() => toSearchResponse({ ...base, looksLikeResults: false })).toThrow("chrome_search_not_a_results_page");
  });
  it("omits context when empty and includes it otherwise", () => {
    expect(toSearchResponse(base)).toEqual({ results: [] });
    expect(toSearchResponse({ ...base, context: { showingResultsFor: "a" } })).toEqual({
      results: [],
      context: { showingResultsFor: "a" },
    });
  });
});

describe("isChromeSearchEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is on only when CHROME_BIN is set", () => {
    vi.stubEnv("CHROME_BIN", "");
    expect(isChromeSearchEnabled()).toBe(false);
    vi.stubEnv("CHROME_BIN", "/x/chrome");
    expect(isChromeSearchEnabled()).toBe(true);
  });
});

/** Minimal CDP peer standing in for Chrome's browser-level websocket. */
class FakeWebSocket {
  static sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  static extract: unknown = "";
  static extractQueue: unknown[] = []; // consumed one per EXTRACT_SCRIPT call, then falls back to `extract`
  static ready = 2;
  static navError: string | undefined;
  static failOpen = false;
  static dieOnEvaluate = 0; // how many evaluate calls kill the socket
  static holdNavigate = false;
  static held: Array<() => void> = [];
  static reset() {
    FakeWebSocket.sent = [];
    FakeWebSocket.extract = JSON.stringify({
      blocked: false,
      looksLikeResults: true,
      results: [{ title: "t", description: "d", url: "https://u.example" }],
      context: {},
    });
    FakeWebSocket.extractQueue = [];
    FakeWebSocket.ready = 2;
    FakeWebSocket.navError = undefined;
    FakeWebSocket.failOpen = false;
    FakeWebSocket.dieOnEvaluate = 0;
    FakeWebSocket.holdNavigate = false;
    FakeWebSocket.held = [];
  }
  onopen?: () => void;
  onerror?: () => void;
  onclose?: () => void;
  onmessage?: (m: { data: string }) => void;
  constructor(public url: string) {
    queueMicrotask(() => (FakeWebSocket.failOpen ? this.onerror?.() : this.onopen?.()));
  }
  send(raw: string) {
    const { id, method, params } = JSON.parse(raw);
    FakeWebSocket.sent.push({ method, params });
    const reply = (result: unknown) => this.onmessage?.({ data: JSON.stringify({ id, result }) });
    if (method === "Browser.getVersion") reply({ userAgent: "Mozilla/5.0 HeadlessChrome/143.0.0.0 Safari/537.36" });
    else if (method === "Target.createTarget") reply({ targetId: "t" });
    else if (method === "Target.attachToTarget") reply({ sessionId: "s" });
    else if (method === "Page.navigate") {
      const go = () => reply(FakeWebSocket.navError ? { errorText: FakeWebSocket.navError } : {});
      if (FakeWebSocket.holdNavigate) FakeWebSocket.held.push(go);
      else go();
    } else if (method === "Runtime.evaluate") {
      if (FakeWebSocket.dieOnEvaluate > 0) {
        FakeWebSocket.dieOnEvaluate--;
        return void this.onclose?.();
      }
      const e = params.expression as string;
      const value =
        e === EXTRACT_SCRIPT
          ? FakeWebSocket.extractQueue.length > 0
            ? FakeWebSocket.extractQueue.shift()
            : FakeWebSocket.extract
          : FakeWebSocket.ready;
      reply({ result: { value } });
    } else reply({});
  }
  close() {}
}

const killMock = vi.fn();
let procHandlers: Record<string, () => void> = {};
let writeEndpoint = true;

let xvfbMode: "ok" | "silent" | "error" | "exit" = "ok";
const xvfbKill = vi.fn();
/** Stands in for the Xvfb child: prints its display number on stdout. */
function fakeXvfb() {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const stdoutHandlers: Array<(d: Buffer) => void> = [];
  queueMicrotask(() => {
    if (xvfbMode === "ok") {
      stdoutHandlers.forEach((h) => h(Buffer.from("9")));
      stdoutHandlers.forEach((h) => h(Buffer.from("9\n"))); // number arrives in pieces
    } else if (xvfbMode === "error") handlers.error?.(new Error("ENOENT"));
    else if (xvfbMode === "exit") handlers.exit?.(1);
  });
  return {
    kill: xvfbKill,
    on: (ev: string, cb: (...a: unknown[]) => void) => (handlers[ev] = cb),
    stdout: { on: (_: string, cb: (d: Buffer) => void) => stdoutHandlers.push(cb) },
  };
}

const sent = (m: string) => FakeWebSocket.sent.filter((x) => x.method === m);
const spawnArgs = (i = 0) => spawnMock.mock.calls[i][1] as string[];

/** With fake timers the polling/settle sleeps never fire on their own. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const guarded = p.finally(() => (done = true));
  guarded.catch(() => {});
  for (let i = 0; i < 400 && !done; i++) await vi.advanceTimersByTimeAsync(250);
  return guarded;
}

describe("chromeSearch", () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    procHandlers = {};
    writeEndpoint = true;
    killMock.mockReset();
    xvfbMode = "ok";
    xvfbKill.mockReset();
    spawnMock.mockReset().mockImplementation((bin: string, args: string[]) => {
      if (bin === "Xvfb") return fakeXvfb();
      const dir = args.find((a) => a.startsWith("--user-data-dir="))!.split("=")[1];
      if (writeEndpoint) fs.writeFileSync(path.join(dir, "DevToolsActivePort"), "12345\n/devtools/browser/abc\n");
      return { kill: killMock, on: (ev: string, cb: () => void) => (procHandlers[ev] = cb) };
    });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubEnv("CHROME_BIN", "/x/chrome");
    vi.stubEnv("GOOGLE_PROXY_URL", "");
    vi.stubEnv("CHROME_HEADFUL", "");
    resetChromeCooldown();
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await shutdownChrome();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws when disabled", async () => {
    vi.stubEnv("CHROME_BIN", "");
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_disabled");
    expect(isChromeSearchAvailable()).toBe(false);
  });

  it("runs headless by default", async () => {
    await chromeSearch("q", "us");
    expect(spawnArgs()).toContain("--headless=new");
    expect(spawnArgs()).not.toContain("--window-size=1280,800");
  });

  it("CHROME_HEADFUL=1 runs headful on the existing DISPLAY without starting Xvfb", async () => {
    vi.stubEnv("CHROME_HEADFUL", "1");
    vi.stubEnv("DISPLAY", ":0");
    await chromeSearch("q", "us");
    expect(spawnArgs()).not.toContain("--headless=new");
    expect(spawnArgs()).toContain("--window-size=1280,800");
    expect(spawnMock.mock.calls.map((c) => c[0])).toEqual(["/x/chrome"]);
    expect(spawnMock.mock.calls[0][2].env.DISPLAY).toBe(":0");
  });

  it("CHROME_HEADFUL=1 without a DISPLAY starts a private Xvfb, points Chrome at it, and stops it with Chrome", async () => {
    vi.stubEnv("CHROME_HEADFUL", "1");
    vi.stubEnv("DISPLAY", "");
    await chromeSearch("q", "us");
    const [xvfbCall, chromeCall] = spawnMock.mock.calls;
    expect(xvfbCall[0]).toBe("Xvfb");
    expect(xvfbCall[1]).toEqual(expect.arrayContaining(["-displayfd", "1", "-nolisten", "tcp"]));
    expect(chromeCall[0]).toBe("/x/chrome");
    expect(chromeCall[1]).not.toContain("--headless=new");
    expect(chromeCall[2].env.DISPLAY).toBe(":99");
    await chromeSearch("q2", "us");
    expect(spawnMock).toHaveBeenCalledTimes(2); // Xvfb + Chrome, both stay warm
    expect(xvfbKill).not.toHaveBeenCalled();
    await shutdownChrome();
    expect(xvfbKill).toHaveBeenCalled();
  });

  it("fails cleanly when Xvfb can't start, errors out, or never reports a display", async () => {
    vi.stubEnv("CHROME_HEADFUL", "1");
    vi.stubEnv("DISPLAY", "");
    xvfbMode = "error";
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_xvfb_failed");
    xvfbMode = "exit";
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_xvfb_failed");
    xvfbMode = "silent";
    vi.useFakeTimers();
    await expect(settle(chromeSearch("q", "us"))).rejects.toThrow("chrome_search_xvfb_failed");
    expect(xvfbKill).toHaveBeenCalled();
    expect(spawnMock.mock.calls.every((c) => c[0] === "Xvfb")).toBe(true); // Chrome never launched
  });

  it("launches headless Chrome once, keeps it warm across searches, and opens/closes one tab per search", async () => {
    const expected = { results: [{ title: "t", description: "d", url: "https://u.example" }] };
    await expect(chromeSearch("a b", "gb")).resolves.toEqual(expected);
    await expect(chromeSearch("c", "us")).resolves.toEqual(expected);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const args = spawnArgs();
    expect(spawnMock.mock.calls[0][0]).toBe("/x/chrome");
    expect(args).toContain("--headless=new");
    expect(args).toContain("--remote-debugging-port=0");
    expect(args.some((a) => a.startsWith("--proxy-server"))).toBe(false);
    expect(FakeWebSocket.sent.map((m) => m.method).filter((m) => m === "Browser.getVersion")).toHaveLength(1);
    expect(sent("Page.navigate").map((m) => m.params.url)).toEqual([
      "https://www.google.com/search?q=a%20b&gl=gb&hl=en",
      "https://www.google.com/search?q=c&gl=us&hl=en",
    ]);
    // de-headlessed UA, applied per tab
    expect(sent("Network.setUserAgentOverride")[0].params.userAgent).toBe("Mozilla/5.0 Chrome/143.0.0.0 Safari/537.36");
    // Blocking images/fonts to save proxy bandwidth got live requests served
    // Google's bot challenge, so nothing may be blocked.
    expect(sent("Network.setBlockedURLs")).toHaveLength(0);
    expect(sent("Target.closeTarget")).toHaveLength(2);
  });

  it("reads the page as soon as results exist, and also handles a fully-loaded page with no results block", async () => {
    FakeWebSocket.ready = 3;
    await expect(chromeSearch("q", "us")).resolves.toBeTruthy();
  });

  it("passes an unauthenticated proxy straight to Chrome", async () => {
    vi.stubEnv("GOOGLE_PROXY_URL", "http://proxy.example:8080");
    await chromeSearch("q", "us");
    expect(spawnArgs()).toContain("--proxy-server=http://proxy.example:8080");
  });

  it("routes an authenticated proxy through a local credential-adding forwarder", async () => {
    vi.stubEnv("GOOGLE_PROXY_URL", "http://user:pw@proxy.example:8080");
    await chromeSearch("q", "us");
    const flag = spawnArgs().find((a) => a.startsWith("--proxy-server="));
    expect(flag).toMatch(/^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/);
    expect(flag).not.toContain("pw");
  });

  it("throws on navigation errors, blocked pages and unreadable extractions, and trips the cooldown", async () => {
    FakeWebSocket.navError = "net::ERR_X";
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_nav_net::ERR_X");
    expect(isChromeSearchAvailable()).toBe(false);
    resetChromeCooldown();
    expect(isChromeSearchAvailable()).toBe(true);

    FakeWebSocket.navError = undefined;
    FakeWebSocket.extract = JSON.stringify({ blocked: true, looksLikeResults: false, results: [], context: {} });
    await expect(chromeSearch("q", "us")).rejects.toBeInstanceOf(ChromeSearchError);
    FakeWebSocket.extract = undefined;
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_extract_failed");
    expect(isChromeSearchAvailable()).toBe(false);
  });

  it("gives up with chrome_search_timeout when the page never becomes ready", async () => {
    FakeWebSocket.ready = 0;
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(0).mockReturnValue(CHROME_SEARCH_TIMEOUT_MS + 1);
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_timeout");
  });

  it("doesn't trip the cooldown when the caller cancelled", async () => {
    const controller = new AbortController();
    FakeWebSocket.ready = 0;
    const p = chromeSearch("q", "us", controller.signal);
    p.catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await expect(p).rejects.toBeTruthy();
    expect(isChromeSearchAvailable()).toBe(true);
  });

  it("rejects without launching when the signal is already aborted", async () => {
    await expect(chromeSearch("q", "us", AbortSignal.abort())).rejects.toBeTruthy();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("fails cleanly, killing Chrome, when the debugging endpoint never appears", async () => {
    vi.useFakeTimers();
    writeEndpoint = false;
    await expect(settle(chromeSearch("q", "us"))).rejects.toThrow("chrome_search_launch_failed");
    expect(killMock).toHaveBeenCalled();
  });

  it("fails cleanly when the websocket can't be opened", async () => {
    FakeWebSocket.failOpen = true;
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_launch_failed");
    expect(killMock).toHaveBeenCalled();
  });

  it("retries on a fresh Chrome (fresh proxy exit IP) when the page is blocked, then keeps the good one warm", async () => {
    const blocked = JSON.stringify({ blocked: true, looksLikeResults: false, results: [], context: {} });
    FakeWebSocket.extractQueue = [blocked];
    await expect(chromeSearch("q", "us")).resolves.toBeTruthy();
    expect(spawnMock).toHaveBeenCalledTimes(2); // one burned Chrome, one good
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(isChromeSearchAvailable()).toBe(true);
    await chromeSearch("q2", "us");
    expect(spawnMock).toHaveBeenCalledTimes(2); // the good one stayed warm
  });

  it("gives up after two blocked attempts and trips the cooldown", async () => {
    FakeWebSocket.extract = JSON.stringify({ blocked: true, looksLikeResults: false, results: [], context: {} });
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_blocked");
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(isChromeSearchAvailable()).toBe(false);
  });

  it("doubles the cooldown with each consecutive failure and resets it on success", async () => {
    FakeWebSocket.navError = "net::ERR_X";
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await expect(chromeSearch("q", "us")).rejects.toThrow();
    now.mockReturnValue(1_000_000 + 60_000 - 1);
    expect(isChromeSearchAvailable()).toBe(false);
    now.mockReturnValue(1_000_000 + 60_000);
    expect(isChromeSearchAvailable()).toBe(true); // 1st failure: 60s
    await expect(chromeSearch("q", "us")).rejects.toThrow();
    now.mockReturnValue(1_000_000 + 60_000 + 119_999);
    expect(isChromeSearchAvailable()).toBe(false);
    now.mockReturnValue(1_000_000 + 60_000 + 120_000);
    expect(isChromeSearchAvailable()).toBe(true); // 2nd failure: 120s
    FakeWebSocket.navError = undefined;
    await chromeSearch("q", "us"); // success resets the streak
    FakeWebSocket.navError = "net::ERR_X";
    await expect(chromeSearch("q", "us")).rejects.toThrow();
    now.mockReturnValue(1_000_000 + 60_000 + 120_000 + 60_000);
    expect(isChromeSearchAvailable()).toBe(true); // back to 60s, not 240s
  });

  it("doesn't retry errors that a fresh Chrome wouldn't fix", async () => {
    FakeWebSocket.navError = "net::ERR_X";
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_nav_net::ERR_X");
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("relaunches after Chrome dies mid-search (socket closes) and after the process exits", async () => {
    FakeWebSocket.dieOnEvaluate = 1;
    await expect(chromeSearch("q", "us")).resolves.toBeTruthy(); // retried on a new Chrome
    expect(killMock).toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(2);

    procHandlers.exit(); // process crashed between searches
    await chromeSearch("q", "us");
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  it("throws browser_died when every attempt's Chrome dies", async () => {
    FakeWebSocket.dieOnEvaluate = 99;
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_browser_died");
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("closes the warm Chrome after it has been idle", async () => {
    vi.useFakeTimers();
    await settle(chromeSearch("q", "us"));
    expect(killMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    expect(killMock).toHaveBeenCalled();
  });
});

describe("startAuthForwarder", () => {
  const servers: Array<{ close: () => void }> = [];
  afterEach(() => servers.splice(0).forEach((s) => s.close()));

  /** A fake upstream proxy: records the CONNECT request, answers with `reply`. */
  async function upstream(reply: string) {
    const seen: string[] = [];
    const srv = net.createServer((sock) => {
      sock.once("data", (d) => {
        seen.push(d.toString());
        // reply + a first tunneled byte in the same chunk, then echo
        sock.write(reply);
        sock.on("data", (x) => sock.write(x));
      });
      sock.on("error", () => {});
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    servers.push(srv);
    return { seen, port: (srv.address() as net.AddressInfo).port };
  }

  function connectVia(fwd: http.Server, onHead: (status: number, socket: net.Socket, head: Buffer) => void) {
    const req = http.request({
      host: "127.0.0.1",
      port: (fwd.address() as net.AddressInfo).port,
      method: "CONNECT",
      path: "target.example:443",
    });
    req.on("connect", (res, socket, head) => {
      socket.on("error", () => {});
      onHead(res.statusCode ?? 0, socket, head);
    });
    req.on("error", () => {});
    req.end();
  }

  it("adds Proxy-Authorization upstream, then tunnels bytes both ways", async () => {
    const up = await upstream("HTTP/1.1 200 Connection Established\r\n\r\nhello");
    const fwd = await startAuthForwarder(`http://us%40er:p%3Aw@127.0.0.1:${up.port}`);
    servers.push(fwd);
    const got = await new Promise<string>((resolve) =>
      connectVia(fwd, (status, socket, head) => {
        expect(status).toBe(200);
        socket.write("ping");
        let acc = head.toString();
        socket.on("data", (d) => {
          acc += d.toString();
          if (acc.includes("ping")) resolve(acc);
        });
      })
    );
    expect(got).toContain("hello");
    expect(got).toContain("ping");
    const expected = Buffer.from("us@er:p:w").toString("base64");
    expect(up.seen[0]).toContain("CONNECT target.example:443 HTTP/1.1");
    expect(up.seen[0]).toContain(`Proxy-Authorization: Basic ${expected}`);
  });

  it("relays the upstream's refusal to the client instead of tunneling", async () => {
    const up = await upstream("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
    const fwd = await startAuthForwarder(`http://u:p@127.0.0.1:${up.port}`);
    servers.push(fwd);
    const status = await new Promise<number>((resolve) => connectVia(fwd, (s) => resolve(s)));
    expect(status).toBe(407);
  });

  it("answers plain (non-CONNECT) requests with 405", async () => {
    const fwd = await startAuthForwarder("http://u:p@127.0.0.1:1");
    servers.push(fwd);
    const status = await new Promise<number>((resolve) =>
      http.get({ host: "127.0.0.1", port: (fwd.address() as net.AddressInfo).port, path: "/" }, (res) => resolve(res.statusCode ?? 0))
    );
    expect(status).toBe(405);
  });

  it("drops the client when the upstream can't be reached", async () => {
    const fwd = await startAuthForwarder("http://u:p@127.0.0.1:1"); // nothing listens on port 1
    servers.push(fwd);
    const closed = await new Promise<boolean>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: (fwd.address() as net.AddressInfo).port, method: "CONNECT", path: "x:443" });
      req.on("connect", () => resolve(false));
      req.on("error", () => resolve(true));
      req.end();
    });
    expect(closed).toBe(true);
  });
});

describe("chromeSearch concurrency", () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    killMock.mockReset();
    spawnMock.mockReset().mockImplementation((_bin: string, args: string[]) => {
      const dir = args.find((a) => a.startsWith("--user-data-dir="))!.split("=")[1];
      fs.writeFileSync(path.join(dir, "DevToolsActivePort"), "12345\n/devtools/browser/abc\n");
      return { kill: killMock, on: () => {} };
    });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubEnv("CHROME_BIN", "/x/chrome");
    vi.stubEnv("GOOGLE_PROXY_URL", "");
    resetChromeCooldown();
  });
  afterEach(async () => {
    await shutdownChrome();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shares one Chrome, runs at most two tabs at once, queues the rest, and lets a queued search be cancelled", async () => {
    FakeWebSocket.holdNavigate = true;
    const a = chromeSearch("a", "us");
    const b = chromeSearch("b", "us");
    const controller = new AbortController();
    const c = chromeSearch("c", "us", controller.signal);
    const d = chromeSearch("d", "us");
    await vi.waitFor(() => expect(FakeWebSocket.held).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(sent("Page.navigate")).toHaveLength(2); // c and d are queued
    controller.abort();
    await expect(c).rejects.toBeTruthy(); // cancelled while still queued
    FakeWebSocket.holdNavigate = false;
    FakeWebSocket.held.splice(0).forEach((go) => go());
    await Promise.all([a, b, d]);
    expect(sent("Page.navigate")).toHaveLength(3);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
