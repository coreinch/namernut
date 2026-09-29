// Dump the rendered HTML of a URL using a real (Chrome for Testing) browser over raw CDP.
//
//   node scripts/chrome-fetch.mjs <url> [--proxy http://user:pass@host:port] [--out file.html] [--headful]
//   node scripts/chrome-fetch.mjs --selftest        # local server, no external requests
//
// CHROME_BIN overrides the binary (default: newest Chrome in ~/.cache/puppeteer/chrome).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const root = path.join(os.homedir(), ".cache/puppeteer/chrome");
  const dirs = fs.readdirSync(root).sort((a, b) => parseInt(b.split("-")[1]) - parseInt(a.split("-")[1]));
  return path.join(root, dirs[0], "chrome-linux64/chrome");
}

// Local CONNECT forwarder that adds Proxy-Authorization, so Chrome never has to answer an auth challenge.
function startAuthForwarder(upstream) {
  const u = new URL(upstream);
  const auth = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
  const server = http.createServer((_, res) => { res.statusCode = 405; res.end(); });
  server.on("connect", (req, client, head) => {
    const up = net.connect(Number(u.port) || 80, u.hostname, () => {
      up.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      up.off("data", onData);
      if (/^HTTP\/1\.[01] 200/.test(buf.toString("latin1", 0, 15))) {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) up.write(head);
        const rest = buf.subarray(end + 4);
        if (rest.length) client.write(rest);
        up.pipe(client); client.pipe(up);
      } else { client.end(buf.subarray(0, end + 4)); up.destroy(); }
    };
    up.on("data", onData);
    up.on("error", () => client.destroy());
    client.on("error", () => up.destroy());
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function fetchHtml(url, { proxy, headful } = {}) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-fetch-"));
  const cli = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    "--no-first-run", "--no-default-browser-check", "--no-sandbox",
    ...(headful ? [] : ["--headless=new"]),
  ];
  let forwarder;
  if (proxy) {
    if (new URL(proxy).username) {
      forwarder = await startAuthForwarder(proxy);
      cli.push(`--proxy-server=http://127.0.0.1:${forwarder.address().port}`);
    } else cli.push(`--proxy-server=${proxy}`);
  }
  const proc = spawn(findChrome(), [...cli, "about:blank"], { stdio: "ignore" });
  try {
    let wsUrl;
    for (let i = 0; i < 100 && !wsUrl; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; }
      catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert(wsUrl, "Chrome did not start");
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id) pending.get(d.id)?.(d);
      else listeners.forEach((l) => l(d));
    };
    const send = (method, params = {}, sessionId) =>
      new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

    const { result: t } = await send("Target.createTarget", { url: "about:blank" });
    const { result: a } = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    const sid = a.sessionId;
    const realUa = (await send("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true }, sid)).result.result.value;
    await send("Network.setUserAgentOverride", { userAgent: realUa.replace("HeadlessChrome", "Chrome") }, sid);
    await send("Page.enable", {}, sid);
    const loaded = new Promise((r) => listeners.push((d) => d.method === "Page.loadEventFired" && r()));
    const nav = await send("Page.navigate", { url }, sid);
    if (nav.result?.errorText) console.error("navigate error:", nav.result.errorText);
    await Promise.race([loaded, new Promise((r) => setTimeout(r, 30000))]);
    // let late scripts / redirects settle: wait for a real document at the target (not about:blank)
    for (let i = 0; i < 40; i++) {
      const r = await send("Runtime.evaluate", { expression: "location.href !== 'about:blank' && document.readyState === 'complete' && document.body?.innerText.length > 0", returnByValue: true }, sid);
      if (r.result?.result?.value) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1000));
    const ua = await send("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true }, sid);
    const html = await send("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true }, sid);
    ws.close();
    return { html: html.result.result.value, ua: ua.result.result.value };
  } finally {
    proc.kill();
    forwarder?.close();
    fs.promises.rm(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
}

if (flag("--selftest")) {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>hello</title><p id="x">1</p><script>document.getElementById("x").textContent="js-ran:"+typeof window.chrome</script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { html, ua } = await fetchHtml(`http://127.0.0.1:${server.address().port}/`);
    console.log("UA:", ua);
    assert.match(html, /js-ran:object/);
    console.log("OK");
  } finally { server.close(); }
} else {
  const url = args.find((a) => /^https?:/.test(a));
  if (!url) { console.error("usage: chrome-fetch.mjs <url> [--proxy URL] [--out file] [--headful] | --selftest"); process.exit(2); }
  const { html, ua } = await fetchHtml(url, { proxy: opt("--proxy"), headful: flag("--headful") });
  console.error("UA:", ua, `(${html.length} bytes)`);
  if (opt("--out")) fs.writeFileSync(opt("--out"), html); else process.stdout.write(html);
}
