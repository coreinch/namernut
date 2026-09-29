// Dump the rendered HTML of a URL using a real (Chrome for Testing) browser over raw CDP.
//
//   node scripts/chrome-fetch.mjs <url> [--proxy http://user:pass@host:port] [--out file.html] [--headful]
//   node scripts/chrome-fetch.mjs --selftest        # local server, no external requests
//
// CHROME_BIN overrides the binary (default: newest Chrome in ~/.cache/puppeteer/chrome).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
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

async function fetchHtml(url, { proxy, headful } = {}) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-fetch-"));
  const cli = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    "--no-first-run", "--no-default-browser-check", "--no-sandbox",
    ...(headful ? [] : ["--headless=new"]),
  ];
  let creds;
  if (proxy) {
    const u = new URL(proxy);
    cli.push(`--proxy-server=${u.protocol}//${u.host}`);
    if (u.username) creds = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
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
    if (creds) {
      await send("Fetch.enable", { handleAuthRequests: true }, sid);
      listeners.push((d) => {
        if (d.method === "Fetch.authRequired")
          send("Fetch.continueWithAuth", { requestId: d.params.requestId, authChallengeResponse: { response: "ProvideCredentials", ...creds } }, sid);
        else if (d.method === "Fetch.requestPaused")
          send("Fetch.continueRequest", { requestId: d.params.requestId }, sid);
      });
    }
    await send("Page.enable", {}, sid);
    const loaded = new Promise((r) => listeners.push((d) => d.method === "Page.loadEventFired" && r()));
    await send("Page.navigate", { url }, sid);
    await Promise.race([loaded, new Promise((r) => setTimeout(r, 30000))]);
    await new Promise((r) => setTimeout(r, 1500)); // let late scripts / redirects settle
    const ua = await send("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true }, sid);
    const html = await send("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true }, sid);
    ws.close();
    return { html: html.result.result.value, ua: ua.result.result.value };
  } finally {
    proc.kill();
    fs.rmSync(userDir, { recursive: true, force: true });
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
