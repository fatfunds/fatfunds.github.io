// =========================
// FILE: arc.js
// Creates a multi-beat storyline ("chapter") for an area.
// No rewards/level ups. Just evolving beats -> subboss -> boss.
// =========================

import { weightedPick } from "./location.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

// Weighted pick, but avoid a forbidden value if possible.
function weightedPickNot(weighted, forbidden) {
  const filtered = (weighted ?? []).filter(([item]) => item !== forbidden);
  if (filtered.length > 0) return weightedPick(filtered);
  return weightedPick(weighted);
}

// Bias selection toward "boss-ish" types when they exist in the area pool.
function pickBossType(area) {
  const pool = area.enemies ?? [];

  // If you have any "leader-ish" enemies in the pool, prefer them.
  // (You can expand this list over time as you add enemies.)
  const bossish = new Set([
    "Cult Acolyte",
    "Bandit",
    "Skeleton",
    "Zombie",
  ]);

  const bossishWeighted = pool.filter(([t]) => bossish.has(t));
  if (bossishWeighted.length > 0) {
    // Mild bias: pick from bossish 70% of the time
    if (Math.random() < 0.70) return weightedPick(bossishWeighted);
  }

  // Otherwise default to normal weighted pick
  return weightedPick(pool);
}

// Make a slightly less-generic lieutenant label.
function makeLieutenantName(area, type) {
  const flavors = {
    marsh: ["Reed-Stalker", "Fog-Caller", "Bog-Herald", "Swamp-Crier"],
    roads: ["Toll-Enforcer", "Knife-Runner", "Badge-Forger", "Road-Hound"],
    chapel: ["Ash-Deacon", "Crypt-Warden", "Candle-Eater", "Bell-Watcher"],
  };

  const list = flavors[area.key] ?? ["Lieutenant", "Enforcer", "Runner", "Watcher"];
  return `${choice(list)} (${type})`;
}

export function createArc(area, world) {
  // Use authored villain/hero names when available
  const villainName =
    (area.villains && area.villains.length)
      ? choice(area.villains)
      : `${weightedPick(area.enemies)} Leader`;

  const heroName =
    (area.heroes && area.heroes.length)
      ? choice(area.heroes)
      : null;

  // Boss type: avoid goofy "viper boss" by biasing toward boss-ish types
  const bossType = pickBossType(area);

  // Lieutenants: 1–3, avoid being the boss type if possible.
  const lieutenantCount = randInt(1, 3);

  const lieutenants = [];
  const usedTypes = new Set([bossType]);

  for (let i = 0; i < lieutenantCount; i++) {
    // Prefer a type not already used (but fall back if pool is tiny)
    let t = weightedPickNot(area.enemies, bossType);

    // Try a couple times to avoid duplicates if we can
    let tries = 5;
    while (usedTypes.has(t) && tries-- > 0) {
      t = weightedPickNot(area.enemies, bossType);
    }
    usedTypes.add(t);

    lieutenants.push({
      id: `${area.key}-lt-${i}-${randInt(1000, 9999)}`,
      type: t,
      name: makeLieutenantName(area, t),
    });
  }

  // Steps until boss:
  // Base 3–6, plus a small bump for extra lieutenants so arcs feel like arcs.
  const stepsRemaining = randInt(3, 6) + Math.max(0, lieutenantCount - 1);

  return {
    id: `${area.key}-${Date.now()}-${randInt(1000, 9999)}`,
    area_key: area.key,

    antagonist: {
      name: villainName, // e.g. "The Bog Prophet"
      type: bossType,    // e.g. "Cult Acolyte"
    },

    hero: heroName ? { name: heroName } : null,

    lieutenants,
    stepsRemaining,
    beatIndex: 0,

    completed: false,
    outcome: null, // "won" | "lost" | "fled" (later)

    // flags that make the storyline evolve
    flags: {
      hasClue: false,
      foundTrail: false,
      sawRitual: false,
      freedNPC: false,
      lairLocated: false,
      warnedByHero: false,
    },
  };
}
