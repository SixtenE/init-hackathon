# Projected HUD

Branch: `codex/hud-projected`

Run `pnpm dev` and scroll down to the flight scene. The HUD appears when flight starts. W/S adjusts throttle, A/D banks, Space/Shift changes pitch. After a crash, click **Fly again**. Multiplayer is optional; local flight works without the server.

Live physics telemetry drives all instruments at 20 Hz. Speed uses the existing simulation's world-to-knots scale; height is feet above the flat ground (AGL). THR is throttle position, not N1 or percent thrust. Heading uses +Z as north. The attitude display is aircraft referenced; the chase camera moves independently, so its horizon is not a conformal projection over the scenery.

All three branches share the same snapshot of the original working tree, including the scene edits that were uncommitted when these experiments started. Original checkout and index remain unchanged.

Validation: `pnpm build`, `pnpm lint`, and `node --experimental-strip-types scripts/hud-telemetry.test.mjs`.
