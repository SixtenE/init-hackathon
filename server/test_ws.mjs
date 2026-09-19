#!/usr/bin/env node
// Smoke-test the C++ game server protocol against a running instance.

const url = process.env.GAME_WS_URL || "ws://127.0.0.1:8080";

function parse(data) {
  return JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
}

async function connect() {
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
  return { ws, waitFor };
}

async function main() {
  const health = await fetch(url.replace("ws://", "http://").replace("wss://", "https://") + "/health");
  const healthText = await health.text();
  if (health.status !== 200 || healthText !== "OK") {
    throw new Error(`health check failed: ${health.status} ${healthText}`);
  }

  const a = await connect();
  const welcome = await a.waitFor((msg) => msg.type === "welcome");
  if (!Number.isInteger(welcome.id)) throw new Error("welcome missing id");
  a.ws.send(JSON.stringify({ type: "hello", name: "Test-Pilot" }));
  a.ws.send(JSON.stringify({ type: "input", seq: 1, throttle: 1, turn: 0, pitch: 0 }));

  const moving = await a.waitFor(
    (msg) =>
      msg.type === "state" &&
      Array.isArray(msg.players) &&
      msg.players.some((p) => p.id === welcome.id && p.name === "Test-Pilot" && p.airspeed > 1),
    8000,
  );
  const me = moving.players.find((p) => p.id === welcome.id);
  if (me.y === undefined || me.qw === undefined) throw new Error("state missing pose");

  const b = await connect();
  const welcomeB = await b.waitFor((msg) => msg.type === "welcome");
  const both = await a.waitFor(
    (msg) => msg.type === "state" && msg.players.length >= 2,
    4000,
  );
  if (!both.players.some((p) => p.id === welcomeB.id)) {
    throw new Error("second player not visible to first client");
  }

  a.ws.send(JSON.stringify({ type: "reset" }));
  await a.waitFor(
    (msg) =>
      msg.type === "state" &&
      msg.players.some((p) => p.id === welcome.id && p.throttle < 0.05 && Math.abs(p.z) < 2),
    4000,
  );

  a.ws.close();
  b.ws.close();
  console.log("protocol test passed", {
    playerA: welcome.id,
    playerB: welcomeB.id,
    airspeed: me.airspeed.toFixed(2),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
