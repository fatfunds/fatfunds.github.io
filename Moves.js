// =========================
// FILE: Moves.js
// Central move definitions + loadouts (modular effects)
// Supports stat scaling via roll.adds: { STR: 1, DEX: 0.5, ... }
//
// FIXES:
// - IDs are now consistent everywhere (object key === move.id)
// - Fixed Kidney Shot id casing + all references (defaults/pools)
// - Fixed Shambling Fool default "KidneyShot" typo
// - Fixed fangs move id mismatch (was key "fang" but id "fangs")
// - Normalized poison/bleed/burn data field casing to `damage`
// =========================

export const CostPool = Object.freeze({
  MP: "MP",
  SP: "SP",
});

export const Element = Object.freeze({
  Physical: "Physical",
  Fire: "Fire",
  Ice: "Ice",
  Lightning: "Lightning",
  Holy: "Holy",
  Poison: "Poison",
});

export const MoveKind = Object.freeze({
  Attack: "attack",
  Buff: "buff",
  Debuff: "debuff",
  Heal: "heal",
  Utility: "utility",
});

export const EffectType = Object.freeze({
  Damage: "damage",
  Heal: "heal",
  ApplyStatus: "apply_status",
});

export const MOVES = Object.freeze({
  // ---------------------------
  // Martial (SP)
  // ---------------------------
  strike: {
    id: "strike",
    name: "Strike",
    description: "A reliable weapon attack.",
    element: Element.Physical,
    kind: MoveKind.Attack,
    target: "enemy",
    toHitBonus: 0,
    cost: { pool: CostPool.SP, amount: 1 },
    effects: [{ type: EffectType.Damage, roll: { min: 2, max: 6, adds: { STR: 0.5 } } }],
  },

  kidneyshot: {
    id: "kidneyshot",
    name: "Kidney Shot",
    description: "A disorienting blow to the abdomen.",
    element: Element.Physical,
    kind: MoveKind.Attack,
    target: "enemy",
    toHitBonus: 0,
    cost: { pool: CostPool.SP, amount: 3 },
    effects: [{ type: EffectType.Damage, roll: { min: 4, max: 7, adds: { DEX: 1.0 } } }],
    onHit: [
      {
        type: EffectType.ApplyStatus,
        chance: 0.5, // 50% chance to stun
        status: { key: "stunned", turns: 1 },
      },
    ],
  },

  heavy: {
    id: "heavy",
    name: "Heavy Blow",
    description: "Slower swing, hits harder.",
    element: Element.Physical,
    kind: MoveKind.Attack,
    target: "enemy",
    toHitBonus: -2,
    cost: { pool: CostPool.SP, amount: 2 },
    effects: [{ type: EffectType.Damage, roll: { min: 5, max: 10, adds: { STR: 1.0 } } }],
  },

  quick: {
    id: "quick",
    name: "Quick Jab",
    description: "Fast and accurate, but lighter damage.",
    element: Element.Physical,
    kind: MoveKind.Attack,
    target: "enemy",
    toHitBonus: +2,
    cost: { pool: CostPool.SP, amount: 1 },
    effects: [{ type: EffectType.Damage, roll: { min: 4, max: 10, adds: { DEX: 1.0 } } }],
  },

  fangs: {
    id: "fangs",
    name: "Fangs",
    description: "Poison drips off these large fangs.",
    element: Element.Physical,
    kind: MoveKind.Attack,
    target: "enemy",
    toHitBonus: +1,
    cost: { pool: CostPool.SP, amount: 1 },
    effects: [{ type: EffectType.Damage, roll: { min: 4, max: 8, adds: { DEX: 1.0 } } }],
    onHit: [
      {
        type: EffectType.ApplyStatus,
        status: { key: "poison", turns: 2, data: { damage: 3 } },
      },
    ],
  },

  guard: {
    id: "guard",
    name: "Guard",
    description: "Brace to reduce the next hit (cannot miss).",
    element: Element.Physical,
    kind: MoveKind.Buff,
    target: "self",
    cost: { pool: CostPool.SP, amount: 1 },
    effects: [{ type: EffectType.ApplyStatus, status: { key: "defending", turns: 1, data: {} } }],
  },

  bleedStrike: {
    id: "bleedStrike",
    name: "Bleed Strike",
    description: "A cutting attack that causes bleeding.",
    element: Element.Physical,
    kind: MoveKind.Attack,
    target: "enemy",
    toHitBonus: 0,
    cost: { pool: CostPool.SP, amount: 3 },
    effects: [{ type: EffectType.Damage, roll: { min: 3, max: 7, adds: { STR: 0.4 } } }],
    onHit: [
      {
        type: EffectType.ApplyStatus,
        status: { key: "bleeding", turns: 3, data: { damage: 2 } }, // 2 dmg per turn
      },
    ],
  },

  // ---------------------------
  // Magic (MP)
  // ---------------------------
  firebolt: {
    id: "firebolt",
    name: "Firebolt",
    description: "A burst of flame.",
    element: Element.Fire,
    kind: MoveKind.Attack,
    target: "enemy",
    toHitBonus: +1,
    cost: { pool: CostPool.MP, amount: 2 },
    effects: [{ type: EffectType.Damage, roll: { min: 5, max: 12, adds: { INT: 0.8 } } }],
  },

  poisonRay: {
    id: "poisonRay",
    name: "Poison Ray",
    description: "A putrid green ray that rots its target.",
    element: Element.Poison,
    kind: MoveKind.Attack,
    target: "enemy",
    toHitBonus: +1,
    cost: { pool: CostPool.MP, amount: 3 },
    effects: [{ type: EffectType.Damage, roll: { min: 4, max: 8, adds: { INT: 0.8 } } }],
    onHit: [
      {
        type: EffectType.ApplyStatus,
        chance: 0.5,
        status: { key: "poison", turns: 3, data: { damage: 2 } },
      },
    ],
  },

  iceShard: {
    id: "iceShard",
    name: "Ice Shard",
    description: "Chilling magic that can slow.",
    element: Element.Ice,
    kind: MoveKind.Attack,
    target: "enemy",
    toHitBonus: 0,
    cost: { pool: CostPool.MP, amount: 2 },
    effects: [{ type: EffectType.Damage, roll: { min: 3, max: 8, adds: { INT: 0.6 } } }],
    onHit: [
      {
        type: EffectType.ApplyStatus,
        chance: 0.5,
        status: { key: "slowed", turns: 2, data: { toHitDelta: -2 } },
      },
    ],
  },

  ignite: {
    id: "ignite",
    name: "Ignite",
    description: "Set the target ablaze for a few turns.",
    element: Element.Fire,
    kind: MoveKind.Debuff,
    target: "enemy",
    toHitBonus: 0,
    cost: { pool: CostPool.MP, amount: 1 },
    effects: [
      {
        type: EffectType.ApplyStatus,
        status: { key: "burning", turns: 3, data: { damage: 3 } }, // 3 dmg per turn
      },
    ],
  },

  // ---------------------------
  // Healing / buffs (MP) — no hit roll
  // ---------------------------
  heal: {
    id: "heal",
    name: "Heal",
    description: "Restore some HP (cannot miss).",
    element: Element.Holy,
    kind: MoveKind.Heal,
    target: "self",
    cost: { pool: CostPool.MP, amount: 1 },
    effects: [{ type: EffectType.Heal, roll: { min: 6, max: 12, adds: { INT: 0.6 } } }],
  },

  wound: {
    id: "wound",
    name: "Wound",
    description: "Cripples the target, reducing their damage output.",
    element: Element.Physical,
    kind: MoveKind.Debuff,
    target: "enemy",
    toHitBonus: 0,
    cost: { pool: CostPool.SP, amount: 1 },
    effects: [
      {
        type: EffectType.ApplyStatus,
        status: { key: "wounded", turns: 3, data: { pct: 0.25 } }, // 25% less outgoing damage
      },
    ],
  },

  regen: {
    id: "regen",
    name: "Regen",
    description: "Heal over time for a few turns (cannot miss).",
    element: Element.Holy,
    kind: MoveKind.Buff,
    target: "self",
    cost: { pool: CostPool.MP, amount: 2 },
    effects: [
      {
        type: EffectType.ApplyStatus,
        status: {
          key: "regen",
          turns: 3,
          data: {
            // tick heal: 2-4 + INT*0.25
            heal: { min: 2, max: 4, adds: { INT: 0.25 } },
          },
        },
      },
    ],
  },

  fortify: {
    id: "fortify",
    name: "Fortify",
    description: "+2 AC for 2 turns (cannot miss).",
    element: Element.Physical,
    kind: MoveKind.Buff,
    target: "self",
    cost: { pool: CostPool.SP, amount: 1 },
    effects: [{ type: EffectType.ApplyStatus, status: { key: "acUp", turns: 2, data: { acDelta: +2 } } }],
  },
});

export function getMoveById(id) {
  return MOVES[id] ?? null;
}

// -------------------------------------------
// LOADOUT DEFAULTS
// -------------------------------------------
export const DEFAULT_ATTACKS_BY_CLASS = Object.freeze({
  Warrior: ["strike", "heavy", "quick", "guard", "bleedStrike", "kidneyshot"],
  Cleric: ["strike", "guard", "heal", "firebolt"],
  Wizard: ["strike", "firebolt", "iceShard", "regen", "ignite"],
  "Shambling Fool": ["strike", "quick", "guard", "heavy", "kidneyshot"],
});

export const DEFAULT_ABILITIES_BY_CLASS = Object.freeze({
  Warrior: [],
  Cleric: [],
  Wizard: [],
  "Shambling Fool": [],
});

// -------------------------------------------
// BASIC MOVE POOLS (for character creation)
// Player must pick 4 basics from this pool.
// -------------------------------------------
export const BASIC_MOVE_POOL_BY_CLASS = Object.freeze({
  Warrior: ["strike", "heavy", "quick", "guard", "bleedStrike", "wound", "fortify", "kidneyshot"],
  Cleric: ["strike", "quick", "guard", "heal", "regen", "fortify", "wound", "firebolt"],
  Wizard: ["strike", "quick", "firebolt", "iceShard", "ignite", "regen"],
  "Shambling Fool": ["strike", "heavy", "quick", "guard", "wound", "kidneyshot"],
});

export function getBasicMovePoolForClass(className) {
  return (BASIC_MOVE_POOL_BY_CLASS[className] ?? []).slice();
}

// Optional helper for UI
export function listMovesByIds(ids) {
  return (ids ?? []).map((id) => getMoveById(id)).filter(Boolean);
}

export function getMoveSlots(player, kind, page = 0, pageSize = 4) {
  if (!player) return { ids: [], hasPrev: false, hasNext: false };

  const list = kind === "abilities" ? (player.abilities ?? []) : (player.attacks ?? []);

  const start = page * pageSize;
  const ids = list.slice(start, start + pageSize);

  return {
    ids,
    hasPrev: page > 0,
    hasNext: start + pageSize < list.length,
  };
}

// NOTE: "kind" here is MoveKind.* (attack/buff/heal/debuff/utility)
// "source" chooses which list to read from: attacks or abilities
export function getMovesByKind(player, kind, source = "attacks") {
  const list =
    source === "abilities"
      ? (player?.abilities ?? []).slice()
      : (player?.attacks ?? []).slice();

  return list.filter((id) => {
    const m = getMoveById(id);
    return m && m.kind === kind;
  });
}
