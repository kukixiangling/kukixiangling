#!/usr/bin/env node
/**
 * goku-contributions
 * ---------------------------------------------------------------
 * Goku plants himself at a single pivot point and fires a
 * Kamehameha that swivels and extends out to hit each contribution
 * square individually — like a turret, not a moving snake. Each
 * square shatters on impact, then respawns in its real GitHub
 * color a little later.
 *
 * Usage:
 *   node src/generate.js <github-username> [outfile.svg]
 *
 * No API token required — contribution counts come from the public
 * (unofficial) endpoint: https://github-contributions-api.jogruber.de
 * ---------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const sprites = require("./sprites.json");

const USERNAME = process.argv[2];
const OUT = process.argv[3] || "dist/goku-contributions.svg";
const THEME = process.env.GOKU_THEME || "dark"; // "dark" | "light"

if (!USERNAME) {
  console.error("Usage: node src/generate.js <github-username> [outfile.svg]");
  process.exit(1);
}

// ---------- Layout constants (mirrors GitHub's real grid geometry) ----------
const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const COLS = 53; // weeks
const ROWS = 7; // days
const MARGIN_LEFT = 70; // extra room on the left for Goku himself
const MARGIN_TOP = 40;
const MARGIN_RIGHT = 20;
const MARGIN_BOTTOM = 20;

const WIDTH = MARGIN_LEFT + COLS * STEP + MARGIN_RIGHT;
const HEIGHT = MARGIN_TOP + ROWS * STEP + MARGIN_BOTTOM;

const PALETTE = {
  dark: {
    bg: "#0d1117",
    text: "#c9d1d9",
    empty: "#161b22",
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
  },
  light: {
    bg: "#ffffff",
    text: "#24292f",
    empty: "#ebedf0",
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  },
}[THEME];

// ---------- 1. Fetch contribution data ----------
async function fetchContributions(username) {
  const url = `https://github-contributions-api.jogruber.de/v4/${username}?y=last`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch contributions for "${username}": ${res.status}`);
  }
  const json = await res.json();
  return json.contributions;
}

function buildGrid(contributions) {
  const byDate = new Map(contributions.map((c) => [c.date, c]));
  const today = new Date(contributions[contributions.length - 1].date);
  const end = new Date(today);
  const endDow = end.getDay();
  const start = new Date(end);
  start.setDate(end.getDate() - endDow - (COLS - 1) * 7);

  const grid = [];
  for (let week = 0; week < COLS; week++) {
    for (let day = 0; day < ROWS; day++) {
      const d = new Date(start);
      d.setDate(start.getDate() + week * 7 + day);
      const key = d.toISOString().slice(0, 10);
      const rec = byDate.get(key);
      grid.push({
        week,
        day,
        date: key,
        count: rec ? rec.count : 0,
        level: rec ? rec.level : 0,
      });
    }
  }
  return grid;
}

// ---------- 2. Pivot point + per-cell targeting order ----------
// Goku stands fixed at the left edge, vertically centered on the grid.
// He swivels his beam to each cell in simple reading order (week by
// week, top to bottom within each week) rather than physically moving.
const PIVOT_X = MARGIN_LEFT - 24;
const PIVOT_Y = MARGIN_TOP + (ROWS * STEP) / 2 - CELL / 2;

function cellXY(cell) {
  const x = MARGIN_LEFT + cell.week * STEP;
  const y = MARGIN_TOP + cell.day * STEP;
  return { x, y };
}

function buildTargetOrder(grid) {
  // Only cells with real contributions get attacked — empty days are
  // left alone as plain background squares, not blasted for no reason.
  const contributed = grid.filter((cell) => cell.count > 0);
  // week-major, day-minor = natural left-to-right reading order
  return contributed.sort((a, b) => (a.week - b.week) || (a.day - b.day));
}

// ---------- 3. Timing: one "shot" per cell ----------
const HIT_GROW = 0.045; // beam extending out
const HIT_HOLD = 0.05; // beam holds at full length (impact)
const HIT_SHRINK = 0.035; // beam retracting
const HIT_GAP = 0.02; // brief pause between shots (Goku re-charges)
const RESPAWN_DELAY = 6; // seconds after impact before a cell respawns

function computeTimeline(order) {
  let t = 0;
  const shots = order.map((cell) => {
    const { x, y } = cellXY(cell);
    const tx = x + CELL / 2;
    const ty = y + CELL / 2;
    const dx = tx - PIVOT_X;
    const dy = ty - PIVOT_Y;
    const dist = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    const t0 = t; // beam starts extending
    const t1 = t0 + HIT_GROW; // impact (fully extended)
    const t2 = t1 + HIT_HOLD; // start retracting
    const t3 = t2 + HIT_SHRINK; // fully retracted
    t = t3 + HIT_GAP;

    return { cell, angle, dist, t0, t1, t2, t3 };
  });
  return { shots, totalDuration: t + 0.4 };
}

function pct(t, total) {
  return Math.min(1, Math.max(0, t / total)).toFixed(4);
}

// ---------- 4. SVG assembly ----------
function buildEmptyCellsSVG(grid, shotCellSet) {
  // Plain, unanimated squares for days with no contributions — Goku
  // leaves these alone entirely.
  return grid
    .filter((cell) => !shotCellSet.has(`${cell.week}-${cell.day}`))
    .map((cell) => {
      const { x, y } = cellXY(cell);
      const color = PALETTE.levels[cell.level];
      return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}"/>`;
    })
    .join("\n");
}

function buildCellsSVG(shots, loopDuration) {
  return shots
    .map((shot) => {
      const { cell } = shot;
      const { x, y } = cellXY(cell);
      const color = PALETTE.levels[cell.level];
      const cx = x + CELL / 2;
      const cy = y + CELL / 2;

      const destroyAt = shot.t1; // impact moment
      const rawRespawn = destroyAt + RESPAWN_DELAY;
      const respawnAt = Math.min(rawRespawn, loopDuration - 0.4);

      return `
  <g transform="translate(${cx},${cy})">
    <rect x="${-CELL / 2}" y="${-CELL / 2}" width="${CELL}" height="${CELL}" rx="2" fill="${color}">
      <animate attributeName="opacity"
        values="1;1;0;0;1;1" keyTimes="0;${pct(destroyAt, loopDuration)};${pct(destroyAt + 0.1, loopDuration)};${pct(respawnAt, loopDuration)};${pct(respawnAt + 0.16, loopDuration)};1"
        dur="${loopDuration}s" repeatCount="indefinite" calcMode="discrete"/>
    </rect>
    <g opacity="0">
      <animate attributeName="opacity"
        values="0;0;1;0;0" keyTimes="0;${pct(destroyAt, loopDuration)};${pct(destroyAt + 0.02, loopDuration)};${pct(destroyAt + 0.2, loopDuration)};1"
        dur="${loopDuration}s" repeatCount="indefinite" calcMode="discrete"/>
      <rect x="-1" y="-7" width="2" height="4" fill="#7ee8fa"/>
      <rect x="4" y="-1" width="4" height="2" fill="#7ee8fa"/>
      <rect x="-1" y="4" width="2" height="4" fill="#7ee8fa"/>
      <rect x="-8" y="-1" width="4" height="2" fill="#7ee8fa"/>
    </g>
  </g>`;
    })
    .join("\n");
}

// Beam: a single element pivoting at Goku's hand, rotating to face each
// target in turn and extending/retracting to that target's distance.
function buildBeamSVG(shots, loopDuration) {
  if (shots.length === 0) {
    // no contributions to attack — Goku just stands there, beam-less
    return "";
  }
  const angleVals = [];
  const lenVals = [];
  const keyTimes = [];

  shots.forEach((s) => {
    angleVals.push(s.angle, s.angle, s.angle, s.angle);
    lenVals.push(0, s.dist, s.dist, 0);
    keyTimes.push(
      pct(s.t0, loopDuration),
      pct(s.t1, loopDuration),
      pct(s.t2, loopDuration),
      pct(s.t3, loopDuration)
    );
  });
  angleVals.push(shots[shots.length - 1].angle);
  lenVals.push(0);
  keyTimes.push("1");

  const beamH = 8;

  return `
  <defs>
    <linearGradient id="beamGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="15%" stop-color="#8be9ff"/>
      <stop offset="100%" stop-color="#2fd9ff" stop-opacity="0.55"/>
    </linearGradient>
    <radialGradient id="ballGrad" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#9df3ff"/>
      <stop offset="100%" stop-color="#22c7f2"/>
    </radialGradient>
  </defs>
  <g transform="translate(${PIVOT_X},${PIVOT_Y})">
    <g>
      <animateTransform attributeName="transform" type="rotate"
        values="${angleVals.join(";")}" keyTimes="${keyTimes.join(";")}"
        dur="${loopDuration}s" repeatCount="indefinite" calcMode="discrete"/>
      <rect x="0" y="${-beamH / 2}" height="${beamH}" width="0" fill="url(#beamGrad)" opacity="0.95">
        <animate attributeName="width" values="${lenVals.join(";")}" keyTimes="${keyTimes.join(";")}"
          dur="${loopDuration}s" repeatCount="indefinite" calcMode="linear"/>
      </rect>
      <rect x="0" y="${-beamH * 0.22}" height="${beamH * 0.44}" width="0" fill="#eafeff" opacity="0.9">
        <animate attributeName="width" values="${lenVals.join(";")}" keyTimes="${keyTimes.join(";")}"
          dur="${loopDuration}s" repeatCount="indefinite" calcMode="linear"/>
      </rect>
      <circle cy="0" r="6" fill="url(#ballGrad)">
        <animate attributeName="cx" values="${lenVals.join(";")}" keyTimes="${keyTimes.join(";")}"
          dur="${loopDuration}s" repeatCount="indefinite" calcMode="linear"/>
      </circle>
    </g>
  </g>`;
}

// Goku himself never moves — he's planted at the pivot. Only the
// charge/fire sprite layers cross-fade, synced to each shot's active
// window (extending + holding = firing; the short gap between shots
// = charging back up).
function buildGokuSVG(shots, loopDuration) {
  const HAND_X_OFFSET = 88; // approx hand-tip x inside the ~90-110px sprite art
  const HAND_Y_OFFSET = 46; // approx hand height inside the sprite art
  const SPRITE_SCALE = 0.34;

  const anchorX = PIVOT_X - HAND_X_OFFSET * SPRITE_SCALE;
  const anchorY = PIVOT_Y - HAND_Y_OFFSET * SPRITE_SCALE;

  let rawEvents = [[0, "charge"]];
  shots.forEach((s) => {
    rawEvents.push([s.t0, "fire"], [s.t2, "charge"]);
  });
  rawEvents.push([loopDuration, "charge"]);
  rawEvents.sort((a, b) => a[0] - b[0]);

  const events = [];
  for (const ev of rawEvents) {
    if (events.length && ev[0] - events[events.length - 1][0] < 0.001) {
      events[events.length - 1] = ev;
    } else {
      events.push(ev);
    }
  }

  const chargeVals = events.map(([, s]) => (s === "charge" ? 1 : 0)).join(";");
  const fireVals = events.map(([, s]) => (s === "fire" ? 1 : 0)).join(";");
  const eventTimes = events.map(([t]) => pct(t, loopDuration)).join(";");

  return `
  <g transform="translate(${anchorX},${anchorY}) scale(${SPRITE_SCALE})" transform-origin="0 0">
    <g opacity="0">
      <image href="data:image/png;base64,${sprites.GOKU_CHARGE.data}" width="${sprites.GOKU_CHARGE.w}" height="${sprites.GOKU_CHARGE.h}"/>
      <animate attributeName="opacity" values="${chargeVals}" keyTimes="${eventTimes}" dur="${loopDuration}s" repeatCount="indefinite" calcMode="discrete"/>
    </g>
    <g opacity="0">
      <image href="data:image/png;base64,${sprites.GOKU_FIRE.data}" width="${sprites.GOKU_FIRE.w}" height="${sprites.GOKU_FIRE.h}"/>
      <animate attributeName="opacity" values="${fireVals}" keyTimes="${eventTimes}" dur="${loopDuration}s" repeatCount="indefinite" calcMode="discrete"/>
    </g>
  </g>`;
}

function buildBackground() {
  return `<rect width="${WIDTH}" height="${HEIGHT}" fill="${PALETTE.bg}"/>`;
}

function buildLabel(username) {
  return `<text x="${MARGIN_LEFT}" y="24" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" fill="${PALETTE.text}">${username}'s contributions — Kamehameha edition</text>`;
}

function buildSVG({ username, grid, shots, loopDuration }) {
  const shotCellSet = new Set(shots.map((s) => `${s.cell.week}-${s.cell.day}`));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <style>
    text { user-select: none; }
    image { image-rendering: pixelated; image-rendering: -moz-crisp-edges; image-rendering: crisp-edges; }
  </style>
  ${buildBackground()}
  ${buildLabel(username)}
  ${buildEmptyCellsSVG(grid, shotCellSet)}
  ${buildCellsSVG(shots, loopDuration)}
  ${buildBeamSVG(shots, loopDuration)}
  ${buildGokuSVG(shots, loopDuration)}
</svg>`;
}

// ---------- main ----------
(async () => {
  console.log(`Fetching contributions for ${USERNAME}...`);
  const contributions = await fetchContributions(USERNAME);
  const grid = buildGrid(contributions);
  const order = buildTargetOrder(grid);
  const { shots, totalDuration } = computeTimeline(order);

  const svg = buildSVG({ username: USERNAME, grid, shots, loopDuration: Number(totalDuration.toFixed(2)) });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, svg, "utf8");
  console.log(`Wrote ${OUT} (${(svg.length / 1024).toFixed(1)} KB, loop = ${totalDuration.toFixed(1)}s, ${shots.length} shots)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
