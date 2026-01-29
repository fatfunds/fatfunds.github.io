// =========================
// FILE: character.js
// (port of Character_Gen.py) + LEVELING + CHARACTER CREATION
// =========================

import {
  DEFAULT_ATTACKS_BY_CLASS,
  DEFAULT_ABILITIES_BY_CLASS,
  getMoveById,
  getBasicMovePoolForClass,
  MoveKind,
} from "./Moves.js";

// ----- Data -----
export const PREFIXES = ["Bel", "Ash", "Mor", "Ka", "El", "Yor", "Thal", "Ren", "Ruth", "Luk", "Jer","Tim", "Jo","Jam","Bil"];
export const SUFFIXES = ["dor", "rin", "th", "mar", "ion", "vis", "ael", "en", "os", "rak","ith","mey","as","is","bor"];

// If you want to tune “how many points can they allocate at level 1”
const STARTING_STAT_POINTS = 6;

// If you want to tune “how many points per level”
const STAT_POINTS_PER_LEVEL = 2;

// Simple XP curve (quadratic-ish)
function xpToNext(level) {
  // level 1 -> 50, level 2 -> 120, level 3 -> 210 ...
  return Math.floor(30 * level * level + 20);
}

// D&D-ish modifier (keeps numbers sane)
function statMod(score) {
  return Math.floor((Number(score ?? 0) - 10) / 2);
}

export const CLASSES = {
  1: {
    class_name: "Warrior",
    base: { STR: 3, INT: 0, CHA: 0, CON: 2, DEX: 1 },
    combat: { HP: 26, AC: 14, SP: 10, MP: 1, to_hit: 5, damage: [3, 10] },
    growth: { HP: 6, MP: 0, SP: 2 }, // per level baseline growth
  },
  2: {
    class_name: "Cleric",
    base: { STR: 1, INT: 1, CHA: 2, CON: 2, DEX: 0 },
    combat: { HP: 22, AC: 13, MP: 8, SP: 5, to_hit: 4, damage: [2, 8] },
    growth: { HP: 5, MP: 2, SP: 1 },
  },
  3: {
    class_name: "Wizard",
    base: { STR: 1, INT: 1, CHA: 2, CON: 2, DEX: 0 },
    combat: { HP: 18, AC: 12, MP: 10, SP: 3, to_hit: 5, damage: [2, 10] },
    growth: { HP: 4, MP: 3, SP: 1 },
  },
  4: {
    class_name: "Shambling Fool",
    base: { STR: 1, INT: 1, CHA: 2, CON: 2, DEX: 4 },
    combat: { HP: 20, AC: 11, SP: 5, MP: 2, to_hit: 3, damage: [1, 6] },
    growth: { HP: 5, MP: 1, SP: 2 },
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

function isCoreStat(s) {
  return s === "STR" || s === "INT" || s === "CHA" || s === "CON" || s === "DEX";
}

// Recompute derived combat stats from base combat + allocated stats + level.
// Keeps your original “feel” but makes stats matter.
function recomputeDerived(character) {
  const cfg = getClassCfg(character.class);

  const level = Number(character.level ?? 1);

  // Core stats (your system uses small numbers; we’ll still let them influence)
  const STR = Number(character.STR ?? 0);
  const INT = Number(character.INT ?? 0);
  const CHA = Number(character.CHA ?? 0);
  const CON = Number(character.CON ?? 0);
  const DEX = Number(character.DEX ?? 0);

  // ---- Max resources ----
  // Baseline + level growth + a little stat influence
  const baseHP = Number(cfg.combat.HP ?? 10);
  const baseMP = Number(cfg.combat.MP ?? 0);
  const baseSP = Number(cfg.combat.SP ?? 0);

  const hpGrowth = Number(cfg.growth?.HP ?? 4);
  const mpGrowth = Number(cfg.growth?.MP ?? 1);
  const spGrowth = Number(cfg.growth?.SP ?? 1);

  // Small bonuses from stats (tune anytime)
  const hpBonus = Math.max(0, CON); // keeps your small-number stat scale meaningful
  const mpBonus = Math.max(0, INT + CHA);
  const spBonus = Math.max(0, STR + DEX);

  const maxHP = baseHP + (level - 1) * hpGrowth + hpBonus;
  const maxMP = baseMP + (level - 1) * mpGrowth + Math.floor(mpBonus / 2);
  const maxSP = baseSP + (level - 1) * spGrowth + Math.floor(spBonus / 2);

  character.maxHP = Math.max(1, Math.floor(maxHP));
  character.maxMP = Math.max(0, Math.floor(maxMP));
  character.maxSP = Math.max(0, Math.floor(maxSP));

  // ---- AC ----
  // Baseline AC + DEX influence
  const baseAC = Number(cfg.combat.AC ?? 10);
  character.AC = Math.floor(baseAC + Math.floor(DEX / 2));

  // ---- to_hit ----
  // Baseline + level (tiny) + STR/DEX (tiny)
  const baseToHit = Number(cfg.combat.to_hit ?? 0);
  character.to_hit = Math.floor(baseToHit + Math.floor((level - 1) / 2) + Math.floor((STR + DEX) / 4));

  // ---- damage range ----
  // Baseline range + STR scaling
  const baseDmg = cfg.combat.damage ?? [1, 4];
  const bMin = Number(baseDmg[0] ?? 1);
  const bMax = Number(baseDmg[1] ?? 4);

  const dmgBonus = Math.floor(STR / 2);
  const minD = Math.max(1, bMin + Math.floor(dmgBonus / 2));
  const maxD = Math.max(minD, bMax + dmgBonus);

  character.damage = [minD, maxD];

  // Clamp current resources to new maximums
  character.HP = clamp(Number(character.HP ?? character.maxHP), 0, character.maxHP);
  character.MP = clamp(Number(character.MP ?? character.maxMP), 0, character.maxMP);
  character.SP = clamp(Number(character.SP ?? character.maxSP), 0, character.maxSP);
}

function getClassCfg(className) {
  // find by name
  const cfg = Object.values(CLASSES).find((c) => c.class_name === className);
  // fallback
  return cfg ?? CLASSES[1];
}

// ----- API -----
export function randomName() {
  return choice(PREFIXES) + choice(SUFFIXES);
}

/**
 * Creates a "draft" character for your creation screen:
 * - base stats set
 * - has unspent stat points
 * - moves are NOT finalized until chooseBasicMoves()
 */
export function makeCharacterDraft(nameInput, classChoice) {
  const cfg = CLASSES[classChoice] ?? CLASSES[1];
  const name = (nameInput ?? "").trim() || randomName();
  const cls = cfg.class_name;

  // Start with defaults, but creation will override attacks with 4 chosen basics
  const attacksDefault = (DEFAULT_ATTACKS_BY_CLASS[cls] ?? []).slice();
  const abilitiesDefault = (DEFAULT_ABILITIES_BY_CLASS[cls] ?? []).slice();

  const c = {
    name,
    class: cls,

    // progression
    level: 1,
    xp: 0,
    xpToNext: xpToNext(1),

    // stat allocation
    unspentStatPoints: STARTING_STAT_POINTS,

    // story stats
    STR: cfg.base.STR,
    INT: cfg.base.INT,
    CHA: cfg.base.CHA,
    CON: cfg.base.CON,
    DEX: cfg.base.DEX,

    // combat baseline (derived gets computed)
    maxHP: cfg.combat.HP,
    HP: cfg.combat.HP,
    AC: cfg.combat.AC,
    to_hit: cfg.combat.to_hit,
    damage: cfg.combat.damage,
    maxMP: Number(cfg.combat.MP ?? 0),
    MP: Number(cfg.combat.MP ?? 0),
    maxSP: Number(cfg.combat.SP ?? 0),
    SP: Number(cfg.combat.SP ?? 0),

    // loadouts
    attacks: attacksDefault,
    abilities: abilitiesDefault,

    status: {},
    inventory: [],
  };

  recomputeDerived(c);
  return c;
}

export function makeCharacter(nameInput, classChoice, opts = {}) {
  const cfg = CLASSES[classChoice] ?? CLASSES[1];
  const name = (nameInput ?? "").trim() || randomName();
  const cls = cfg.class_name;

  const maxMP = Number(cfg.combat.MP ?? 0);
  const maxSP = Number(cfg.combat.SP ?? 0);
  const maxHP = Number(cfg.combat.HP ?? 10);

  const pool = (DEFAULT_ATTACKS_BY_CLASS[cls] ?? []).slice();

  // chosenAttacks should be 4 ids from the pool
  let attacks = Array.isArray(opts.chosenAttacks) ? opts.chosenAttacks.slice() : null;

  // validate: only allow moves from that class pool
  if (attacks) attacks = attacks.filter((id) => pool.includes(id));

  // if invalid or not exactly 4, fall back to first 4 defaults
  if (!attacks || attacks.length !== 4) attacks = pool.slice(0, 4);

  const abilities = (DEFAULT_ABILITIES_BY_CLASS[cls] ?? []).slice();

  return {
    name,
    class: cls,

    STR: cfg.base.STR,
    INT: cfg.base.INT,
    CHA: cfg.base.CHA,
    CON: cfg.base.CON,
    DEX: cfg.base.DEX,

    maxHP,
    HP: maxHP,
    AC: cfg.combat.AC,
    to_hit: cfg.combat.to_hit,
    damage: cfg.combat.damage,

    maxMP, MP: maxMP,
    maxSP, SP: maxSP,

    // IMPORTANT: final chosen loadout saved here
    attacks,
    abilities,

    status: {},
    inventory: [],

    // optional: track the full pool for UI
    movePool: pool,
  };
}


/**
 * Spend stat points on core stats during creation or leveling.
 * allocations example: { STR: +2, CON: +1 }
 */
export function allocateStatPoints(character, allocations) {
  if (!character || typeof allocations !== "object" || !allocations) return;

  let spend = 0;
  for (const [stat, delta] of Object.entries(allocations)) {
    if (!isCoreStat(stat)) continue;
    const d = Number(delta ?? 0);
    if (!Number.isFinite(d) || d <= 0) continue;
    spend += d;
  }

  character.unspentStatPoints = Number(character.unspentStatPoints ?? 0);
  if (spend <= 0) return;
  if (spend > character.unspentStatPoints) return; // reject if they overspend

  for (const [stat, delta] of Object.entries(allocations)) {
    if (!isCoreStat(stat)) continue;
    const d = Number(delta ?? 0);
    if (!Number.isFinite(d) || d <= 0) continue;

    character[stat] = clamp(Number(character[stat] ?? 0) + d, -3, 20);
  }

  character.unspentStatPoints -= spend;
  recomputeDerived(character);
}



export function chooseBasicMoves(character, moveIds) {
  if (!character) return false;
  if (!Array.isArray(moveIds)) return false;

  const unique = [...new Set(moveIds.map(String))];
  if (unique.length !== 4) return false;

  const poolIds = getBasicMovePoolForClass(character.class);
  const pool = new Set(poolIds);
  if (!pool.size) return false;

  const pickedMoves = [];
  for (const id of unique) {
    if (!pool.has(id)) return false;
    const m = getMoveById(id);
    if (!m) return false;
    pickedMoves.push(m);
  }

  // Split
  let pickedAttacks = pickedMoves
    .filter(m => m.kind === MoveKind.Attack)
    .map(m => m.id);

  const pickedAbilities = pickedMoves
    .filter(m => m.kind !== MoveKind.Attack)
    .map(m => m.id);

  // Ensure at least 1 attack (so combat works)
  if (pickedAttacks.length === 0) return false;

  // PAD attacks up to 4 using class defaults (so UI Attack menu always has 4)
  const defaults = (DEFAULT_ATTACKS_BY_CLASS[character.class] ?? []).slice();
  for (const id of defaults) {
    if (pickedAttacks.length >= 4) break;
    if (!pickedAttacks.includes(id)) pickedAttacks.push(id);
  }

  // If still not 4, last resort: pull any attack from the class basic pool
  if (pickedAttacks.length < 4) {
    for (const id of poolIds) {
      if (pickedAttacks.length >= 4) break;
      const m = getMoveById(id);
      if (m?.kind === MoveKind.Attack && !pickedAttacks.includes(id)) {
        pickedAttacks.push(id);
      }
    }
  }

  // Hard cap to 4
  pickedAttacks = pickedAttacks.slice(0, 4);

  character.attacks = pickedAttacks;
  character.abilities = pickedAbilities;

  return true;
}




/**
 * XP gain (call this after combat or events).
 * Auto-levels as many times as needed.
 */
export function gainXP(character, amount) {
  if (!character) return;
  const add = Number(amount ?? 0);
  if (!Number.isFinite(add) || add <= 0) return;

  character.xp = Number(character.xp ?? 0) + add;

  // Level up while we can
  while (character.xp >= Number(character.xpToNext ?? xpToNext(character.level ?? 1))) {
    character.xp -= Number(character.xpToNext ?? 0);
    levelUp(character);
  }
}

/**
 * Level up:
 * - level +1
 * - stat points +STAT_POINTS_PER_LEVEL
 * - refresh HP/MP/SP to new max (you can change to partial refill if you want)
 */
export function levelUp(character) {
  if (!character) return;

  character.level = Math.max(1, Math.floor(Number(character.level ?? 1) + 1));
  character.unspentStatPoints = Number(character.unspentStatPoints ?? 0) + STAT_POINTS_PER_LEVEL;

  // Update derived stats to reflect new level/max values
  recomputeDerived(character);

  // Full refill on level (feels good in a small RPG)
  character.HP = character.maxHP;
  character.MP = character.maxMP;
  character.SP = character.maxSP;

  character.xpToNext = xpToNext(character.level);
}

/**
 * Existing helper, upgraded:
 * - clamps core stats
 * - clamps HP/MP/SP
 * - recomputes derived combat stats when core stats change
 */
export function applyStatChanges(character, changes) {
  if (!character || !changes) return;

  let touchedCore = false;

  for (const [stat, delta] of Object.entries(changes)) {
    const d = Number(delta ?? 0);
    if (!Number.isFinite(d)) continue;

    character[stat] = (Number(character[stat] ?? 0) + d);

    if (isCoreStat(stat)) {
      character[stat] = clamp(character[stat], -3, 20);
      touchedCore = true;
    }
  }

  if (touchedCore) recomputeDerived(character);

  // Clamp resources even if no core stats changed
  if (typeof character.maxMP === "number") character.MP = clamp(character.MP ?? 0, 0, character.maxMP);
  if (typeof character.maxSP === "number") character.SP = clamp(character.SP ?? 0, 0, character.maxSP);
  if (typeof character.maxHP === "number") character.HP = clamp(character.HP ?? 0, 0, character.maxHP);
}
