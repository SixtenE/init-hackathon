#!/usr/bin/env node
// Smoke-test static file serving and the C++ pose-relay protocol.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(root, "server/build/game_server");
const staticDir = path.join(root, "dist");

function parse(data) {
  return JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
}

function httpBaseFromWs(wsUrl) {
  return wsUrl.replace(/^ws/i, "http").replace(/\/ws\/?$/i, "");
}

function normalizeWsUrl(url) {
  return url.endsWith("/ws") || url.endsWith("/ws/") ? url.replace(/\/$/, "") : `${url.replace(/\/$/, "")}/ws`;
}

async function connect(url) {
  const ws = new WebSocket(url);
  const pending = [];
  const waiters = [];
  ws.addEventListener("message", (event) => {
    const msg = parse(event.data);
    const index = waiters.findIndex((waiter) => waiter.predicate(msg));
    if (index >= 0) {
      waiters.splice(index, 1)[0].resolve(msg);
    } else {
      pending.push(msg);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error(`failed to connect to ${url}`)));
  });
  const waitFor = (predicate, timeoutMs = 4000) =>
    new Promise((resolve, reject) => {
      const existing = pending.findIndex(predicate);
      if (existing >= 0) {
        resolve(pending.splice(existing, 1)[0]);
        return;
      }
      const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
      waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  const hello = (name, session) => ws.send(JSON.stringify({ type: "hello", name, session }));
  return { ws, waitFor, hello };
}

function rawHttp(host, port, request) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port }, () => sock.write(request));
    const chunks = [];
    sock.on("data", (chunk) => chunks.push(chunk));
    sock.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    sock.on("error", reject);
    sock.setTimeout(4000, () => {
      sock.destroy();
      reject(new Error("raw HTTP request timed out"));
    });
  });
}

async function waitForHealth(httpBase, timeoutMs = 8000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const health = await fetch(`${httpBase}/health`);
      const healthText = await health.text();
      if (health.status === 200 && healthText === "OK") return;
      lastError = new Error(`health check failed: ${health.status} ${healthText}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`server at ${httpBase} did not become healthy`);
}

async function ensureServer() {
  if (process.env.GAME_WS_URL) {
    const url = normalizeWsUrl(process.env.GAME_WS_URL);
    return { url, httpBase: httpBaseFromWs(url), child: null };
  }

  const port = Number(process.env.GAME_TEST_PORT || 18080);
  const url = `ws://127.0.0.1:${port}/ws`;
  const httpBase = `http://127.0.0.1:${port}`;

  try {
    await waitForHealth(httpBase, 400);
    return { url, httpBase, child: null };
  } catch {
    /* start a local instance */
  }

  if (!existsSync(binary)) {
    throw new Error(`missing ${binary}; run pnpm server:build first`);
  }

  const child = spawn(binary, [String(port)], {
    cwd: root,
    env: { ...process.env, GAME_STATIC_DIR: staticDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const exitError = new Promise((_, reject) => {
    child.on("exit", (code, signal) => {
      if (code || signal) reject(new Error(`game_server exited early (${code ?? signal})`));
    });
  });
  await Promise.race([waitForHealth(httpBase), exitError]);
  return { url, httpBase, child };
}

async function testStaticFiles(httpBase) {
  if (!existsSync(staticDir)) {
    throw new Error(`missing ${staticDir}; run pnpm build first so the server can serve the Vite app`);
  }

  const indexRes = await fetch(`${httpBase}/`);
  const indexType = indexRes.headers.get("content-type") ?? "";
  const indexHtml = await indexRes.text();
  if (!indexRes.ok) throw new Error(`GET / failed: ${indexRes.status}`);
  if (!indexType.includes("text/html")) throw new Error(`GET / content-type ${indexType}`);
  if (!indexHtml.includes('<div id="root">')) throw new Error("GET / did not return the Vite index.html");

  const spaRes = await fetch(`${httpBase}/this-route-does-not-exist`);
  const spaHtml = await spaRes.text();
  if (!spaRes.ok) throw new Error(`SPA fallback failed: ${spaRes.status}`);
  if (!spaHtml.includes('<div id="root">')) throw new Error("SPA fallback did not return index.html");

  const favicon = await fetch(`${httpBase}/favicon.svg`);
  if (!favicon.ok) throw new Error(`GET /favicon.svg failed: ${favicon.status}`);
  const faviconType = favicon.headers.get("content-type") ?? "";
  if (!faviconType.includes("image/svg")) throw new Error(`favicon content-type ${faviconType}`);

  const model = await fetch(`${httpBase}/models/airbus-a320.glb`);
  if (!model.ok) throw new Error(`GET /models/airbus-a320.glb failed: ${model.status}`);
  const modelType = model.headers.get("content-type") ?? "";
  if (!modelType.includes("model/gltf-binary") && !modelType.includes("octet-stream")) {
    throw new Error(`glb content-type ${modelType}`);
  }
  const modelBytes = Buffer.from(await model.arrayBuffer());
  if (modelBytes.byteLength < 1024) throw new Error("glb response was too small");

  const assetMatch = indexHtml.match(/src="(\/assets\/[^"]+\.js)"/);
  if (!assetMatch) throw new Error("index.html did not reference a hashed /assets/*.js bundle");
  const assetRes = await fetch(`${httpBase}${assetMatch[1]}`);
  if (!assetRes.ok) throw new Error(`GET ${assetMatch[1]} failed: ${assetRes.status}`);
  const cacheControl = assetRes.headers.get("cache-control") ?? "";
  if (!cacheControl.includes("immutable")) throw new Error(`asset cache-control ${cacheControl}`);

  const missingAsset = await fetch(`${httpBase}/assets/definitely-missing.js`);
  if (missingAsset.status !== 404) throw new Error(`missing JS should 404, got ${missingAsset.status}`);

  const wsHttp = await fetch(`${httpBase}/ws`);
  if (wsHttp.status !== 426) throw new Error(`GET /ws without upgrade should 426, got ${wsHttp.status}`);

  const parsed = new URL(httpBase);
  const traversal = await rawHttp(
    parsed.hostname,
    Number(parsed.port),
    "GET /%2e%2e/package.json HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
  );
  if (traversal.includes("cmake_minimum_required") || traversal.includes('"name": "init-hacka"')) {
    throw new Error("path traversal leaked a file outside dist");
  }
  if (!traversal.startsWith("HTTP/1.1 400") && !traversal.startsWith("HTTP/1.1 403") && !traversal.startsWith("HTTP/1.1 404")) {
    throw new Error(`path traversal should be rejected, got ${traversal.split("\r\n", 1)[0]}`);
  }
}

async function testProtocol(url) {
  const a = await connect(url);
  a.hello("Test-Pilot", "test-a");
  const welcome = await a.waitFor((msg) => msg.type === "welcome");
  if (!Number.isInteger(welcome.id)) throw new Error("welcome missing id");
  if (!Array.isArray(welcome.players)) throw new Error("welcome missing players");

  a.ws.send(
    JSON.stringify({
      type: "pose",
      seq: 1,
      spawn: 1,
      x: 12.5,
      y: -40.25,
      z: 88,
      qx: 0,
      qy: 0.1,
      qz: 0,
      qw: 0.995,
      vx: 1,
      vy: 2,
      vz: 16.5,
      throttle: 0.8,
      airspeed: 16.7,
      verticalSpeed: 2,
      angleOfAttack: 0.12,
      grounded: false,
      crashed: false,
    }),
  );

  const airborne = await a.waitFor(
    (msg) =>
      msg.type === "state" &&
      Array.isArray(msg.players) &&
      msg.players.some(
        (p) =>
          p.id === welcome.id &&
          p.name === "Test-Pilot" &&
          p.grounded === false &&
          Math.abs(p.x - 12.5) < 0.01 &&
          Math.abs(p.y + 40.25) < 0.01 &&
          Math.abs(p.z - 88) < 0.01 &&
          Math.abs(p.vz - 16.5) < 0.01 &&
          p.airspeed > 16,
      ),
    4000,
  );
  const me = airborne.players.find((p) => p.id === welcome.id);
  if (me.y === undefined || me.qw === undefined) throw new Error("state missing pose");

  const b = await connect(url);
  b.hello("Chase-1", "test-b");
  const welcomeB = await b.waitFor((msg) => msg.type === "welcome");
  if (!Number.isInteger(welcomeB.id)) throw new Error("second welcome missing id");
  if (!welcomeB.players.some((p) => p.id === welcome.id && p.name === "Test-Pilot" && Math.abs(p.z - 88) < 0.01)) {
    throw new Error("welcome did not include the existing pilot");
  }

  const join = await a.waitFor(
    (msg) => msg.type === "join" && msg.player && msg.player.id === welcomeB.id && msg.player.name === "Chase-1",
  );
  if (!join.player) throw new Error("join missing player");

  const both = await b.waitFor(
    (msg) =>
      msg.type === "state" &&
      msg.players.some((p) => p.id === welcome.id && Math.abs(p.z - 88) < 0.01 && p.name === "Test-Pilot"),
    4000,
  );
  if (!both.players.some((p) => p.id === welcomeB.id)) {
    throw new Error("second player not visible in snapshot");
  }

  a.ws.send(
    JSON.stringify({
      type: "pose",
      seq: 2,
      spawn: 1,
      x: 0,
      y: -58,
      z: 3,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      throttle: 0,
      airspeed: 0,
      verticalSpeed: 0,
      angleOfAttack: 0,
      grounded: true,
      crashed: false,
    }),
  );

  await b.waitFor(
    (msg) =>
      msg.type === "state" &&
      msg.players.some((p) => p.id === welcome.id && Math.abs(p.z - 3) < 0.01 && p.grounded === true),
    4000,
  );

  a.ws.close();
  const leave = await b.waitFor((msg) => msg.type === "leave" && msg.id === welcome.id);
  if (leave.id !== welcome.id) throw new Error("leave missing id");

  b.ws.close();
  return { playerA: welcome.id, playerB: welcomeB.id, airspeed: me.airspeed, altitude: me.y, grounded: me.grounded };
}

async function main() {
  const { url, httpBase, child } = await ensureServer();
  const cleanup = () => {
    if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });

  try {
    const health = await fetch(`${httpBase}/health`);
    const healthText = await health.text();
    if (health.status !== 200 || healthText !== "OK") {
      throw new Error(`health check failed: ${health.status} ${healthText}`);
    }

    await testStaticFiles(httpBase);
    const protocol = await testProtocol(url);
    console.log("static + protocol tests passed", {
      playerA: protocol.playerA,
      playerB: protocol.playerB,
      airspeed: protocol.airspeed.toFixed(2),
      altitude: protocol.altitude.toFixed(2),
      grounded: protocol.grounded,
    });
  } finally {
    cleanup();
    if (child) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
