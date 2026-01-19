// =========================
// FILE: character.js
// (port of Character_Gen.py)
// =========================

// ----- Data -----
export const PREFIXES = ["Bel", "Ash", "Mor", "Ka", "El", "Yor", "Thal", "Ren", "Ruth", "Luk", "Jer","Tim", "Jo","Jam","Bil"];
export const SUFFIXES = ["dor", "rin", "th", "mar", "ion", "vis", "ael", "en", "os", "rak","ith","mey","as","is","bor"];

export const CLASSES = {
  1: {
    class_name: "Warrior",
    base: { STR: 3, INT: 0, CHA: 1 },
    combat: { HP: 26, AC: 14, to_hit: 5, damage: [3, 10] },
  },
  2: {
    class_name: "Cleric",
    base: { STR: 1, INT: 1, CHA: 2 },
    combat: { HP: 22, AC: 13, to_hit: 4, damage: [2, 8] },
  },
  3: {
    class_name: "Wizard",
    base: { STR: 0, INT: 3, CHA: 1 },
    combat: { HP: 18, AC: 12, to_hit: 5, damage: [2, 10] },
  },
  4: {
    class_name: "Shambling Fool",
    base: { STR: 0, INT: 0, CHA: 4 },
    combat: { HP: 20, AC: 11, to_hit: 3, damage: [1, 6] },
  },
};

// ----- Helpers -----
function randInt(min, max) {
  // inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ----- API -----
export function randomName() {
  return choice(PREFIXES) + choice(SUFFIXES);
}

export function makeCharacter(nameInput, classChoice) {
  const cfg = CLASSES[classChoice] ?? CLASSES[1];
  const name = (nameInput ?? "").trim() || randomName();

  return {
    name,
    class: cfg.class_name,

    // story stats
    STR: cfg.base.STR,
    INT: cfg.base.INT,
    CHA: cfg.base.CHA,

    // combat stats
    HP: cfg.combat.HP,
    AC: cfg.combat.AC,
    to_hit: cfg.combat.to_hit,
    damage: cfg.combat.damage, // [min, max]

    // hooks for later
    status: {},      // ex: { wounded: 2 }
    inventory: [],   // ex: ["potion"]
  };
}

export function applyStatChanges(character, changes) {
  for (const [stat, delta] of Object.entries(changes)) {
    character[stat] = (character[stat] ?? 0) + delta;

    // clamp story stats like your Python
    if (stat === "STR" || stat === "INT" || stat === "CHA") {
      character[stat] = clamp(character[stat], -3, 10);
    }
  }
}
