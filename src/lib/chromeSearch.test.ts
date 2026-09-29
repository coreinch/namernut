// @vitest-environment jsdom
import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => {
  const spawn = (...a: unknown[]) => spawnMock(...a);
  return { spawn, default: { spawn } };
});

import {
  ChromeSearchError,
  EXTRACT_SCRIPT,
  chromeSearch,
  isChromeSearchEnabled,
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

/** Minimal CDP peer standing in for Chrome's websocket. */
class FakeWebSocket {
  static sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  static evalResult: unknown = "";
  static navError: string | undefined;
  onopen?: () => void;
  onerror?: () => void;
  onclose?: () => void;
  onmessage?: (m: { data: string }) => void;
  constructor() {
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    const { id, method, params } = JSON.parse(raw);
    FakeWebSocket.sent.push({ method, params });
    const reply = (result: unknown) => this.onmessage?.({ data: JSON.stringify({ id, result }) });
    if (method === "Target.createTarget") reply({ targetId: "t" });
    else if (method === "Target.attachToTarget") reply({ sessionId: "s" });
    else if (method === "Page.navigate") {
      reply(FakeWebSocket.navError ? { errorText: FakeWebSocket.navError } : {});
      this.onmessage?.({ data: JSON.stringify({ method: "Page.loadEventFired" }) });
    } else if (method === "Runtime.evaluate") {
      const e = params.expression as string;
      reply({ result: { value: e === "navigator.userAgent" ? "HeadlessChrome/143" : e === EXTRACT_SCRIPT ? FakeWebSocket.evalResult : true } });
    } else reply({});
  }
  close() {}
}

describe("chromeSearch", () => {
  const killMock = vi.fn();
  beforeEach(() => {
    FakeWebSocket.sent = [];
    FakeWebSocket.navError = undefined;
    FakeWebSocket.evalResult = JSON.stringify({ blocked: false, looksLikeResults: true, results: [{ title: "t", description: "d", url: "https://u.example" }], context: {} });
    spawnMock.mockReset().mockReturnValue({ kill: killMock });
    killMock.mockReset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ webSocketDebuggerUrl: "ws://x" }) }));
    vi.stubEnv("CHROME_BIN", "/x/chrome");
    vi.stubEnv("GOOGLE_PROXY_URL", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws when disabled", async () => {
    vi.stubEnv("CHROME_BIN", "");
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_disabled");
  });

  it("launches headless Chrome, pins gl/hl, de-headlesses the UA, and returns results", async () => {
    await expect(chromeSearch("a b", "gb")).resolves.toEqual({
      results: [{ title: "t", description: "d", url: "https://u.example" }],
    });
    const [bin, args] = spawnMock.mock.calls[0];
    expect(bin).toBe("/x/chrome");
    expect(args).toContain("--headless=new");
    expect(args.some((a: string) => a.startsWith("--proxy-server"))).toBe(false);
    const nav = FakeWebSocket.sent.find((m) => m.method === "Page.navigate")!;
    expect(nav.params.url).toBe("https://www.google.com/search?q=a%20b&gl=gb&hl=en");
    expect(FakeWebSocket.sent.find((m) => m.method === "Network.setUserAgentOverride")!.params.userAgent).toBe("Chrome/143");
    // Blocking images/fonts to save proxy bandwidth got the live request
    // served Google's bot challenge, so nothing may be blocked.
    expect(FakeWebSocket.sent.some((m) => m.method === "Network.setBlockedURLs")).toBe(false);
    expect(killMock).toHaveBeenCalled();
  });

  it("passes an unauthenticated proxy straight to Chrome", async () => {
    vi.stubEnv("GOOGLE_PROXY_URL", "http://proxy.example:8080");
    await chromeSearch("q", "us");
    expect(spawnMock.mock.calls[0][1]).toContain("--proxy-server=http://proxy.example:8080");
  });

  it("routes an authenticated proxy through a local credential-adding forwarder", async () => {
    vi.stubEnv("GOOGLE_PROXY_URL", "http://user:pw@proxy.example:8080");
    await chromeSearch("q", "us");
    const flag = spawnMock.mock.calls[0][1].find((a: string) => a.startsWith("--proxy-server="));
    expect(flag).toMatch(/^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/);
    expect(flag).not.toContain("pw");
  });

  it("throws on navigation errors, blocked pages and unreadable extractions — and still kills Chrome", async () => {
    FakeWebSocket.navError = "net::ERR_X";
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_nav_net::ERR_X");
    FakeWebSocket.navError = undefined;
    FakeWebSocket.evalResult = JSON.stringify({ blocked: true, looksLikeResults: false, results: [], context: {} });
    await expect(chromeSearch("q", "us")).rejects.toBeInstanceOf(ChromeSearchError);
    FakeWebSocket.evalResult = undefined;
    await expect(chromeSearch("q", "us")).rejects.toThrow("chrome_search_extract_failed");
    expect(killMock).toHaveBeenCalledTimes(3);
  });

  it("rejects without launching when the signal is already aborted", async () => {
    await expect(chromeSearch("q", "us", AbortSignal.abort())).rejects.toBeTruthy();
    expect(spawnMock).not.toHaveBeenCalled();
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("runs at most two Chromes at once, queues the rest, and lets a queued search be cancelled", async () => {
    vi.stubEnv("CHROME_BIN", "/x/chrome");
    vi.stubEnv("GOOGLE_PROXY_URL", "");
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    spawnMock.mockReset().mockImplementation(() => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return { kill: () => {} };
    });
    // Hold each scrape open at the /json/version poll until released.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () => new Promise((resolve) => releases.push(() => resolve({ json: async () => ({ webSocketDebuggerUrl: "ws://x" }) })))
      )
    );
    vi.stubGlobal("WebSocket", FakeWebSocket);
    FakeWebSocket.sent = [];
    FakeWebSocket.navError = undefined;
    FakeWebSocket.evalResult = JSON.stringify({ blocked: false, looksLikeResults: true, results: [], context: {} });

    const a = chromeSearch("a", "us");
    const b = chromeSearch("b", "us");
    const controller = new AbortController();
    const c = chromeSearch("c", "us", controller.signal);
    const d = chromeSearch("d", "us");
    await new Promise((r) => setTimeout(r, 20));
    expect(spawnMock).toHaveBeenCalledTimes(2); // c and d are queued
    controller.abort();
    await expect(c).rejects.toBeTruthy(); // cancelled while still queued
    releases.splice(0).forEach((r) => r());
    await Promise.all([a, b]);
    await new Promise((r) => setTimeout(r, 20));
    releases.splice(0).forEach((r) => r()); // d gets its slot once a/b finished
    await d;
    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
