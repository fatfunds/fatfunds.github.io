// =========================
// FILE: character.js
// (port of Character_Gen.py)
// =========================

import { DEFAULT_ATTACKS_BY_CLASS, DEFAULT_ABILITIES_BY_CLASS } from "./Moves.js";

// ----- Data -----
export const PREFIXES = ["Bel", "Ash", "Mor", "Ka", "El", "Yor", "Thal", "Ren", "Ruth", "Luk", "Jer","Tim", "Jo","Jam","Bil"];
export const SUFFIXES = ["dor", "rin", "th", "mar", "ion", "vis", "ael", "en", "os", "rak","ith","mey","as","is","bor"];

export const CLASSES = {
  1: {
    class_name: "Warrior",
    base: { STR: 3, INT: 0, CHA: 0, CON: 2, DEX: 1 },
    combat: { HP: 26, AC: 14, SP: 10, MP: 1, to_hit: 5, damage: [3, 10] },
  },
  2: {
    class_name: "Cleric",
    base: { STR: 1, INT: 1, CHA: 2, CON: 2, DEX: 0 },
    combat: { HP: 22, AC: 13, MP: 8, SP: 5, to_hit: 4, damage: [2, 8] },
  },
  3: {
    class_name: "Wizard",
    base: { STR: 1, INT: 1, CHA: 2, CON: 2, DEX: 0 },
    combat: { HP: 18, AC: 12, MP: 10, SP: 3, to_hit: 5, damage: [2, 10] },
  },
  4: {
    class_name: "Shambling Fool",
    base: { STR: 1, INT: 1, CHA: 2, CON: 2, DEX: 4 },
    combat: { HP: 20, AC: 11, SP: 5, MP: 2, to_hit: 3, damage: [1, 6] },
  },
};

// ----- Helpers -----
function randInt(min, max) {
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

  const cls = cfg.class_name;

  // resources (CURRENT + MAX)
  const maxMP = Number(cfg.combat.MP ?? 0);
  const maxSP = Number(cfg.combat.SP ?? 0);

  // HP (CURRENT + MAX)
  const maxHP = Number(cfg.combat.HP ?? 10);

  // default loadouts
  const attacks = (DEFAULT_ATTACKS_BY_CLASS[cls] ?? []).slice();
  const abilities = (DEFAULT_ABILITIES_BY_CLASS[cls] ?? []).slice();

  return {
    name,
    class: cls,

    // story stats
    STR: cfg.base.STR,
    INT: cfg.base.INT,
    CHA: cfg.base.CHA,
    CON: cfg.base.CON,
    DEX: cfg.base.DEX,

    // combat stats
    maxHP: cfg.combat.HP,
    HP: cfg.combat.HP,
    AC: cfg.combat.AC,
    to_hit: cfg.combat.to_hit,
    damage: cfg.combat.damage, // [min, max]
    maxMP,
    MP: maxMP,
    maxSP,
    SP: maxSP,

    // loadouts (IMPORTANT: actually assign them)
    attacks,
    abilities,

    status: {},
    inventory: [],
  };
}

export function applyStatChanges(character, changes) {
  for (const [stat, delta] of Object.entries(changes)) {
    character[stat] = (character[stat] ?? 0) + delta;

    if (stat === "STR" || stat === "INT" || stat === "CHA" || stat === "CON" || stat === "DEX") {
      character[stat] = clamp(character[stat], -3, 20);
    }
  }

  // Clamp resources
  if (typeof character.maxMP === "number") character.MP = clamp(character.MP ?? 0, 0, character.maxMP);
  if (typeof character.maxSP === "number") character.SP = clamp(character.SP ?? 0, 0, character.maxSP);

  // Clamp HP (never exceed maxHP)
  if (typeof character.maxHP === "number") character.HP = clamp(character.HP ?? 0, 0, character.maxHP);
}
