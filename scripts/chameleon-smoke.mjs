// Local smoke test for the Chameleon browser binary (the "lightpanda-x86_64-linux"
// nightly from chameleon-browser/chameleon-browser). Not part of `npm test`.
//
//   CHAMELEON_BIN=~/.cache/chameleon/lightpanda node scripts/chameleon-smoke.mjs [profile]
//
// Uses a local HTTP server, so no external requests are made.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const bin = process.env.CHAMELEON_BIN ?? path.join(os.homedir(), ".cache/chameleon/lightpanda");
const profile = process.argv[2] ?? "chrome116";
const PORT = 9333;

const seen = [];
const server = http.createServer((req, res) => {
  seen.push({ url: req.url, ua: req.headers["user-agent"] });
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><title>hello</title><body><p id="x">1</p>
    <script>document.getElementById("x").textContent = "js-ran:" + typeof window.chrome + ":" + navigator.languages.length;</script>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${server.address().port}/`;

let proc;
try {
  // 1. one-shot fetch
  const { stdout: dump } = await promisify(execFile)(bin, ["fetch", "--dump", "--browser", profile, site]);
  console.log("fetch dump:", dump.replace(/\s+/g, " ").slice(0, 200));
  assert.match(dump, /js-ran:object:\d+/, "page JS should run and expose window.chrome");
  console.log("UA sent:", seen[0].ua);
  assert.match(seen[0].ua ?? "", /Chrome\/116/);

  // 2. CDP server
  proc = spawn(bin, ["serve", "--browser", profile, "--port", String(PORT)], { stdio: "inherit" });
  const ws = await new Promise((resolve, reject) => {
    const t = Date.now();
    const try_ = () => {
      const s = new WebSocket(`ws://127.0.0.1:${PORT}`);
      s.onopen = () => resolve(s);
      s.onerror = () => (Date.now() - t > 5000 ? reject(new Error("CDP server did not start")) : setTimeout(try_, 100));
    };
    try_();
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) pending.get(d.id)(d);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });

  const { result: t } = await send("Target.createTarget", { url: "about:blank" });
  const { result: a } = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  await send("Page.navigate", { url: site }, a.sessionId);
  await new Promise((r) => setTimeout(r, 500));
  const ev = await send("Runtime.evaluate", { expression: "document.getElementById('x').textContent", returnByValue: true }, a.sessionId);
  console.log("CDP eval:", ev.result?.result?.value);
  assert.match(ev.result.result.value, /^js-ran:object:/);
  ws.close();
  console.log("OK");
} finally {
  proc?.kill();
  server.close();
}
