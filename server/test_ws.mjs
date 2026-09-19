#!/usr/bin/env node
// Smoke-test the C++ pose-relay protocol against a running instance.

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
  const hello = (name, session) => ws.send(JSON.stringify({ type: "hello", name, session }));
  return { ws, waitFor, hello };
}

async function main() {
  const health = await fetch(url.replace("ws://", "http://").replace("wss://", "https://") + "/health");
  const healthText = await health.text();
  if (health.status !== 200 || healthText !== "OK") {
    throw new Error(`health check failed: ${health.status} ${healthText}`);
  }

  const a = await connect();
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

  const b = await connect();
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
  console.log("protocol test passed", {
    playerA: welcome.id,
    playerB: welcomeB.id,
    airspeed: me.airspeed.toFixed(2),
    altitude: me.y.toFixed(2),
    grounded: me.grounded,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
