// =========================
// FILE: Combat.js
// Step-based "FF-lite" turn combat (ENGINE ONLY)
// Modular move effects + stat-based rolls (adds) + MAX HP clamp
// + Centralized status behavior via STATUS_DEFS
// + Element matrix (strong/weak/neutral) via ELEMENT_MATRIX + resist/affinity
// + Enemy uses moves like player (max 4) with simple AI (buff early, heal <50%, attack often)
// =========================

import { getMoveById, EffectType } from "./Moves.js";

// -----------------------------
// ELEMENT MATRIX
// -----------------------------
const Element = Object.freeze({
  Physical: "Physical",
  Fire: "Fire",
  Ice: "Ice",
  Lightning: "Lightning",
  Holy: "Holy",
  Poison: "Poison",
});

const Mult = Object.freeze({
  Weak: 0.5,
  Neutral: 1.0,
  Strong: 1.5,
  Immune: 0.0,
});

// attackerElement -> defenderAffinity -> multiplier
const ELEMENT_MATRIX = Object.freeze({
  [Element.Physical]: { default: Mult.Neutral },

  [Element.Fire]: {
    [Element.Ice]: Mult.Strong,
    [Element.Fire]: Mult.Weak,
    default: Mult.Neutral,
  },

  [Element.Ice]: {
    [Element.Fire]: Mult.Weak,
    [Element.Ice]: Mult.Weak,
    default: Mult.Neutral,
  },

  [Element.Lightning]: {
    [Element.Ice]: Mult.Strong,
    [Element.Lightning]: Mult.Weak,
    default: Mult.Neutral,
  },

  [Element.Holy]: {
    [Element.Poison]: Mult.Strong,
    [Element.Holy]: Mult.Weak,
    default: Mult.Neutral,
  },

  [Element.Poison]: {
    [Element.Holy]: Mult.Weak,
    [Element.Poison]: Mult.Weak,
    default: Mult.Neutral,
  },
});

// -----------------------------
// HELPERS
// -----------------------------
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function d20() {
  return randInt(1, 20);
}
function rollDamage([min, max]) {
  return randInt(min, max);
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ------------------------------------------------------------
// STATUS DEFINITIONS (single source of truth)
// ------------------------------------------------------------
const STATUS_DEFS = {
  regen: {
    onTick(entity, ctrl, who, eff, entries) {
      if (!eff.heal) return;
      const rolled = ctrl._rollScaledRange(entity, eff.heal);
      const actual = ctrl._heal(entity, rolled);
      if (actual > 0) {
        entries.push({ type: "status_tick", who, key: "regen", kind: "heal", amount: actual });
      }
    },
  },

  poison: {
    onTick(entity, ctrl, who, eff, entries) {
      if (typeof eff.damage !== "number") return;
      entity.HP -= eff.damage;
      entries.push({ type: "status_tick", who, key: "poison", kind: "damage", amount: eff.damage });
    },
  },

  bleeding: {
    onTick(entity, ctrl, who, eff, entries) {
      const dmg = Number(eff.damage ?? 0);
      if (dmg <= 0) return;
      entity.HP -= dmg;
      entries.push({ type: "status_tick", who, key: "bleeding", kind: "damage", amount: dmg });
    },
  },

  burning: {
    onTick(entity, ctrl, who, eff, entries) {
      const dmg = Number(eff.damage ?? 0);
      if (dmg <= 0) return;
      entity.HP -= dmg;
      entries.push({ type: "status_tick", who, key: "burning", kind: "damage", amount: dmg });
    },
  },

  wounded: {
    modifyOutgoingDamage(amount, eff) {
      let dmg = Math.max(0, Number(amount ?? 0));

      if (typeof eff.pct === "number") {
        dmg = Math.floor(dmg * (1 - eff.pct));
      }
      if (typeof eff.flat === "number") {
        dmg = dmg - eff.flat;
      }

      return Math.max(0, dmg);
    },
  },

  defending: {
    modifyIncomingDamage(amount, eff) {
      const pct = typeof eff.pct === "number" ? eff.pct : 0.5; // default 50%
      return Math.max(0, Math.floor(Number(amount ?? 0) * (1 - pct)));
    },
    consumeOnHit: true,
  },

  acUp: {
    modifyAC(baseAC, eff) {
      const d = typeof eff.acDelta === "number" ? eff.acDelta : 0;
      return Number(baseAC ?? 10) + d;
    },
  },

  slowed: {
    modifyToHit(baseDelta, eff) {
      const d = typeof eff.toHitDelta === "number" ? eff.toHitDelta : 0;
      return Number(baseDelta ?? 0) + d;
    },
  },

  stunned: {
    blocksAction: true,
    onTick(entity, ctrl, who, eff, entries) {
      entries.push({ type: "status_tick", who, key: "stunned", kind: "control_lock", amount: 0 });
    },
  },

  frozen: {
    blocksAction: true,
    onTick(entity, ctrl, who, eff, entries) {
      entries.push({ type: "status_tick", who, key: "frozen", kind: "control_lock", amount: 0 });
    },
  },

  enchant: {},
  wellFed: {},
};

export class CombatController {
  constructor(playerRef, enemy) {
    this.player = playerRef;
    this.enemy = enemy;

    this.turn = "player";
    this.ended = false;
    this.winner = null;

    // status bags
    this.player.status = this.player.status ?? {};
    this.enemy.status = this.enemy.status ?? {};

    // PLAYER pools: ensure max and clamp
    this.player.maxMP = toNum(this.player.maxMP ?? this.player.MP ?? 0, 0);
    this.player.maxSP = toNum(this.player.maxSP ?? this.player.SP ?? 0, 0);
    this.player.MP = clamp(toNum(this.player.MP ?? this.player.maxMP ?? 0, 0), 0, this.player.maxMP);
    this.player.SP = clamp(toNum(this.player.SP ?? this.player.maxSP ?? 0, 0), 0, this.player.maxSP);

    // ENEMY pools: ensure max and clamp (so enemies behave like characters)
    this.enemy.maxMP = toNum(this.enemy.maxMP ?? this.enemy.MP ?? 0, 0);
    this.enemy.maxSP = toNum(this.enemy.maxSP ?? this.enemy.SP ?? 0, 0);
    this.enemy.MP = clamp(toNum(this.enemy.MP ?? this.enemy.maxMP ?? 0, 0), 0, this.enemy.maxMP);
    this.enemy.SP = clamp(toNum(this.enemy.SP ?? this.enemy.maxSP ?? 0, 0), 0, this.enemy.maxSP);

    // Ensure maxHP exists
    this.player.maxHP = Number(this.player.maxHP ?? this.player.HP ?? 1);
    this.enemy.maxHP = Number(this.enemy.maxHP ?? this.enemy.HP ?? 1);

    this.player.inventory = this.player.inventory ?? ["potion"];

    // enemy move loadout (max 4 by design)
    this.enemy.moves = Array.isArray(this.enemy.moves) ? this.enemy.moves.slice(0, 4) : [];

    // AI memory (buff timing etc.)
    this.enemy.ai = this.enemy.ai ?? { turns: 0, lastBuffTurn: -999 };

    this.log = [];
  }

  // -----------------------------
  // HP clamp helpers
  // -----------------------------
  _clampHP(entity) {
    const maxHP = Number(entity.maxHP ?? entity.HP ?? 1);
    entity.maxHP = maxHP;
    entity.HP = clamp(Number(entity.HP ?? 0), 0, maxHP);
  }

  _heal(entity, amount) {
    const before = Number(entity.HP ?? 0);
    this._clampHP(entity);
    entity.HP = clamp(before + Number(amount ?? 0), 0, entity.maxHP);
    return entity.HP - before;
  }

  // -----------------------------
  // ELEMENT HELPERS
  // -----------------------------
  _getElementOverride(entity) {
    const ench = entity?.status?.enchant;
    const el = ench?.element;
    return typeof el === "string" && el.length ? el : null;
  }

  _resolveDamageElement(caster, moveElement, fallback = Element.Physical) {
    return this._getElementOverride(caster) ?? moveElement ?? fallback;
  }

  _getElementMultiplier(attacker, target, element) {
    const el = String(element ?? Element.Physical);

    // 1) direct per-element resist table wins
    const table = target?.resist;
    if (table && typeof table === "object" && table[el] != null) {
      const m = Number(table[el]);
      return Number.isFinite(m) ? m : 1.0;
    }

    // 2) otherwise: affinity + matrix
    const def = String(target?.affinity ?? "");
    const row = ELEMENT_MATRIX?.[el];

    if (row && def && row[def] != null) return Number(row[def]);
    if (row && row.default != null) return Number(row.default);

    return 1.0;
  }

  _elementTag(mult) {
    if (mult === 0) return "Immune";
    if (mult < 1) return "Resisted";
    if (mult > 1) return "Weak!";
    return "";
  }

  // -----------------------------
  // STATUS HELPERS
  // -----------------------------
  _hasBlockingStatus(entity) {
    const st = entity?.status ?? {};
    for (const [key] of Object.entries(st)) {
      const def = STATUS_DEFS[key];
      if (def?.blocksAction) return key;
    }
    return null;
  }

  _modifyOutgoingDamage(attacker, baseDmg) {
    let dmg = Math.max(0, Number(baseDmg ?? 0));
    const st = attacker?.status ?? {};

    for (const [key, eff] of Object.entries(st)) {
      const def = STATUS_DEFS[key];
      if (def?.modifyOutgoingDamage) dmg = def.modifyOutgoingDamage(dmg, eff);
    }

    return Math.max(0, dmg);
  }

  _modifyIncomingDamage(target, baseDmg) {
    let dmg = Math.max(0, Number(baseDmg ?? 0));
    const st = target?.status ?? {};

    for (const [key, eff] of Object.entries(st)) {
      const def = STATUS_DEFS[key];
      if (def?.modifyIncomingDamage) dmg = def.modifyIncomingDamage(dmg, eff);
    }

    return Math.max(0, dmg);
  }

  _consumeOnHit(target) {
    const st = target?.status ?? {};
    for (const [key] of Object.entries(st)) {
      const def = STATUS_DEFS[key];
      if (def?.consumeOnHit) delete st[key];
    }
  }

  // -----------------------------
  // ENEMY AI HELPERS
  // -----------------------------
  _canAffordMove(caster, move) {
    const pool = String(move?.cost?.pool ?? "").toUpperCase();
    const amt = Number(move?.cost?.amount ?? 0);
    if (!pool || amt <= 0) return true;

    if (pool === "MP") return Number(caster.MP ?? 0) >= amt;
    if (pool === "SP") return Number(caster.SP ?? 0) >= amt;
    return true;
  }

  _pickWeighted(pairs) {
    // pairs: [[item, weight], ...]
    const total = pairs.reduce((s, [, w]) => s + Math.max(0, Number(w ?? 0)), 0);
    if (total <= 0) return pairs[0]?.[0] ?? null;

    let r = Math.random() * total;
    for (const [item, w] of pairs) {
      r -= Math.max(0, Number(w ?? 0));
      if (r <= 0) return item;
    }
    return pairs[pairs.length - 1]?.[0] ?? null;
  }

  // -----------------------------
  // PUBLIC STATE
  // -----------------------------
  getPublicState() {
    this._clampHP(this.player);
    this._clampHP(this.enemy);

    return {
      active: !this.ended,
      turn: this.turn,
      player: {
        name: this.player.name,
        class: this.player.class,
        HP: this.player.HP,
        maxHP: this.player.maxHP,
        AC: this.player.AC,
        to_hit: this.player.to_hit,
        damage: this.player.damage,
        STR: this.player.STR,
        INT: this.player.INT,
        CHA: this.player.CHA,
        CON: this.player.CON,
        DEX: this.player.DEX,
        MP: this.player.MP,
        maxMP: this.player.maxMP,
        SP: this.player.SP,
        maxSP: this.player.maxSP,
        status: { ...(this.player.status ?? {}) },
        inventory: [...(this.player.inventory ?? [])],
      },
      enemy: {
        name: this.enemy.name,
        HP: this.enemy.HP,
        maxHP: this.enemy.maxHP,
        AC: this.enemy.AC,
        to_hit: this.enemy.to_hit,
        damage: this.enemy.damage,
        // mimic player stats if present
        STR: this.enemy.STR ?? 0,
        INT: this.enemy.INT ?? 0,
        CHA: this.enemy.CHA ?? 0,
        CON: this.enemy.CON ?? 0,
        DEX: this.enemy.DEX ?? 0,
        MP: this.enemy.MP ?? 0,
        maxMP: this.enemy.maxMP ?? 0,
        SP: this.enemy.SP ?? 0,
        maxSP: this.enemy.maxSP ?? 0,
        moves: [...(this.enemy.moves ?? [])],
        status: { ...(this.enemy.status ?? {}) },
        affinity: this.enemy.affinity ?? null,
        resist: { ...(this.enemy.resist ?? {}) },
      },
      actions: this.turn === "player" ? ["attack", "move", "defend", "item", "flee"] : [],
    };
  }

  // ------------------------------------------------------------
  // TURN FLOW
  // ------------------------------------------------------------
  actPlayer(actionKey, arg = "") {
    this.log = [];

    if (this.ended) return this._result({ ok: false, error: "Combat already ended." });
    if (this.turn !== "player") return this._result({ ok: false, error: "Not your turn." });

    this.log.push(...this._tickStatuses(this.player, "player"));
    this._clampHP(this.player);

    if (this.player.HP <= 0) {
      this._end("enemy");
      return this._result({ ok: true });
    }

    const blockedBy = this._hasBlockingStatus(this.player);
    if (blockedBy) {
      this.log.push({ type: "status_blocked", who: "player", key: blockedBy, text: "You can't act!" });
      this.turn = "enemy";
      return this._result({ ok: true });
    }

    const a = (actionKey || "").toLowerCase().trim();
    const b = (arg || "").trim();

    if (a === "attack") this._playerAttack();
    else if (a === "move") this._useMove("player", b);
    else if (a === "defend") this._playerDefend();
    else if (a === "item") this._playerItem(b || "potion");
    else if (a === "flee") this._playerFlee();
    else return this._result({ ok: false, error: `Unknown combat action: ${actionKey}` });

    if (this.ended) return this._result({ ok: true });

    this.turn = "enemy";
    return this._result({ ok: true });
  }

  actEnemy() {
    this.log = [];

    if (this.ended) return this._result({ ok: false, error: "Combat already ended." });
    if (this.turn !== "enemy") return this._result({ ok: false, error: "Not enemy turn." });

    this.log.push(...this._tickStatuses(this.enemy, "enemy"));
    this._clampHP(this.enemy);

    if (this.enemy.HP <= 0) {
      this._end("player");
      return this._result({ ok: true });
    }

    const blockedBy = this._hasBlockingStatus(this.enemy);
    if (blockedBy) {
      this.log.push({ type: "status_blocked", who: "enemy", key: blockedBy, text: `${this.enemy.name} can't act!` });
      this.turn = "player";
      return this._result({ ok: true });
    }

    this._enemyTurn();
    if (!this.ended) this.turn = "player";

    return this._result({ ok: true });
  }

  // ------------------------------------------------------------
  // STAT HELPERS
  // ------------------------------------------------------------
  _getStat(entity, stat) {
    stat = String(stat ?? "").toUpperCase();
    if (stat === "STR") return Number(entity.STR ?? 0);
    if (stat === "INT") return Number(entity.INT ?? 0);
    if (stat === "CHA") return Number(entity.CHA ?? 0);
    if (stat === "CON") return Number(entity.CON ?? 0);
    if (stat === "DEX") return Number(entity.DEX ?? 0);
    return 0;
  }

  _rollScaledRange(entity, cfg) {
    const min = Number(cfg?.min ?? 0);
    const max = Number(cfg?.max ?? 0);
    let amount = randInt(min, max);

    // old format
    if (cfg?.stat && cfg?.scale != null) {
      const statVal = this._getStat(entity, cfg.stat);
      amount += Math.floor(statVal * Number(cfg.scale));
    }

    // new format
    const adds = cfg?.adds;
    if (adds && typeof adds === "object") {
      for (const [stat, mult] of Object.entries(adds)) {
        const statVal = this._getStat(entity, stat);
        amount += Math.floor(statVal * Number(mult));
      }
    }

    return Math.max(0, amount);
  }

  _getEffectiveAC(entity) {
    let ac = Number(entity.AC ?? 10);
    const st = entity.status ?? {};

    for (const [key, eff] of Object.entries(st)) {
      if (!eff) continue;
      const def = STATUS_DEFS[key];

      if (def?.modifyAC) ac = def.modifyAC(ac, eff);
      else if (typeof eff.acDelta === "number") ac += eff.acDelta;
    }

    return ac;
  }

  _getToHitDelta(entity) {
    let delta = 0;
    const st = entity.status ?? {};

    for (const [key, eff] of Object.entries(st)) {
      if (!eff) continue;
      const def = STATUS_DEFS[key];

      if (def?.modifyToHit) delta = def.modifyToHit(delta, eff);
      else if (typeof eff.toHitDelta === "number") delta += eff.toHitDelta;
    }

    return delta;
  }

  // ------------------------------------------------------------
  // STATUS SYSTEM
  // ------------------------------------------------------------
  _tickStatuses(entity, who) {
    entity.status = entity.status ?? {};
    const st = entity.status;
    const entries = [];

    for (const [key, eff] of Object.entries(st)) {
      if (!eff || typeof eff.turns !== "number") continue;

      const def = STATUS_DEFS[key];
      def?.onTick?.(entity, this, who, eff, entries);

      const persistent = eff.persistent === true || eff.turns === Infinity;
      if (!persistent) {
        eff.turns -= 1;
        if (eff.turns <= 0) {
          delete st[key];
          entries.push({ type: "status_end", who, key });
        }
      }
    }

    this._clampHP(entity);
    return entries;
  }

  _applyStatus(target, key, turns, data) {
    target.status = target.status ?? {};
    const eff = { turns: Number(turns ?? 1) };
    if (data && typeof data === "object") Object.assign(eff, data);
    target.status[key] = eff;
  }

  // ------------------------------------------------------------
  // BASIC ATTACK
  // ------------------------------------------------------------
  _playerAttack() {
    const roll = d20();
    const total = roll + Number(this.player.to_hit ?? 0) + this._getToHitDelta(this.player);

    const crit = roll === 20;
    const fumble = roll === 1;

    const enemyAC = this._getEffectiveAC(this.enemy);
    const hit = !fumble && (crit || total >= enemyAC);

    let dmg = 0;
    let element = this._resolveDamageElement(this.player, Element.Physical, Element.Physical);
    let mult = 1.0;
    let tag = "";

    if (hit) {
      dmg = rollDamage(this.player.damage);
      if (crit) dmg += rollDamage(this.player.damage);

      dmg = this._modifyOutgoingDamage(this.player, dmg);
      dmg = this._modifyIncomingDamage(this.enemy, dmg);

      mult = this._getElementMultiplier(this.player, this.enemy, element);
      dmg = Math.max(0, Math.floor(dmg * mult));
      tag = this._elementTag(mult);

      this.enemy.HP -= dmg;
      this._consumeOnHit(this.enemy);
      this._clampHP(this.enemy);
    }

    this.log.push({
      type: "player_attack",
      roll,
      total,
      hit,
      crit,
      fumble,
      dmg,
      element,
      mult,
      tag,
      enemyHP: this.enemy.HP,
    });

    if (this.enemy.HP <= 0) this._end("player");
  }

  // ------------------------------------------------------------
  // COST
  // ------------------------------------------------------------
  _payMoveCost(caster, move) {
    const pool = String(move?.cost?.pool ?? "").toUpperCase();
    const amt = Number(move?.cost?.amount ?? 0);
    if (!pool || amt <= 0) return { ok: true };

    if (pool === "MP") {
      const cur = Number(caster.MP ?? 0);
      if (cur < amt) return { ok: false, text: `Not enough MP for ${move.name}!` };
      caster.MP = cur - amt;
      return { ok: true };
    }

    if (pool === "SP") {
      const cur = Number(caster.SP ?? 0);
      if (cur < amt) return { ok: false, text: `Not enough SP for ${move.name}!` };
      caster.SP = cur - amt;
      return { ok: true };
    }

    return { ok: true };
  }

  // ------------------------------------------------------------
  // MODULAR MOVE EXECUTION
  // ------------------------------------------------------------
  _shouldRollToHit(move) {
    const tgt = String(move?.target ?? "enemy").toLowerCase();
    if (tgt !== "enemy") return false;

    const effs = Array.isArray(move?.effects) ? move.effects : [];
    return effs.some((e) => e?.type === EffectType.Damage);
  }

  _rollToHit(caster, target, move) {
    const roll = d20();
    const crit = roll === 20;
    const fumble = roll === 1;

    const toHitBonus = Number(move?.toHitBonus ?? 0);
    const casterToHit = Number(caster.to_hit ?? 0);
    const statusToHit = this._getToHitDelta(caster);

    const total = roll + casterToHit + toHitBonus + statusToHit;

    const targetAC = this._getEffectiveAC(target);
    const hit = !fumble && (crit || total >= targetAC);

    return { roll, total, hit, crit, fumble };
  }

  _applyEffect(by, caster, target, move, eff, crit = false) {
    const entries = [];
    if (!eff || typeof eff !== "object") return entries;

    if (eff.type === EffectType.Damage) {
      const base = this._rollScaledRange(caster, eff.roll);
      const raw = crit ? base + this._rollScaledRange(caster, eff.roll) : base;

      const out = this._modifyOutgoingDamage(caster, raw);
      let final = this._modifyIncomingDamage(target, out);

      const element = this._resolveDamageElement(caster, move.element, Element.Physical);
      const mult = this._getElementMultiplier(caster, target, element);
      final = Math.max(0, Math.floor(final * mult));

      target.HP -= final;
      this._consumeOnHit(target);
      this._clampHP(target);

      entries.push({
        type: "move_effect",
        by,
        effect: "damage",
        name: move.name,
        moveId: move.id,
        target: target === caster ? "self" : "enemy",
        amount: final,
        element,
        mult,
        tag: this._elementTag(mult),
      });

      return entries;
    }

    if (eff.type === EffectType.Heal) {
      const rolled = this._rollScaledRange(caster, eff.roll);
      const actual = this._heal(target, rolled);

      entries.push({
        type: "move_effect",
        by,
        effect: "heal",
        name: move.name,
        moveId: move.id,
        target: target === caster ? "self" : "enemy",
        amount: actual,
      });

      return entries;
    }

    if (eff.type === EffectType.ApplyStatus) {
      const st = eff.status;
      const key = String(st?.key ?? "status");
      const turns = st?.turns === Infinity ? Infinity : Number(st?.turns ?? 1);
      const data = st?.data ?? {};

      this._applyStatus(target, key, turns, data);

      entries.push({
        type: "move_effect",
        by,
        effect: "status",
        name: move.name,
        moveId: move.id,
        target: target === caster ? "self" : "enemy",
        key,
        turns,
      });

      return entries;
    }

    return entries;
  }

  _useMove(by, moveId) {
    const caster = by === "enemy" ? this.enemy : this.player;
    const other = by === "enemy" ? this.player : this.enemy;

    const move = getMoveById(moveId);

    if (!move) {
      this.log.push({
        type: by === "enemy" ? "enemy_move_fail" : "player_move_fail",
        text: `Unknown move: ${moveId}`,
      });
      return;
    }

    // Pay cost (PLAYER + ENEMY)
    const costRes = this._payMoveCost(caster, move);
    if (!costRes.ok) {
      this.log.push({
        type: by === "enemy" ? "enemy_move_fail" : "player_move_fail",
        text: costRes.text,
      });
      return;
    }

    const target = String(move.target ?? "enemy").toLowerCase() === "self" ? caster : other;

    const needsRoll = this._shouldRollToHit(move);
    let rollInfo = null;

    if (needsRoll) {
      rollInfo = this._rollToHit(caster, other, move);

      this.log.push({
        type: by === "enemy" ? "enemy_move" : "player_move",
        id: move.id,
        name: move.name,
        kind: move.kind,
        element: move.element || "none",
        roll: rollInfo.roll,
        total: rollInfo.total,
        hit: rollInfo.hit,
        crit: rollInfo.crit,
        fumble: rollInfo.fumble,
        mpLeft: caster.MP ?? 0,
        spLeft: caster.SP ?? 0,
        desc: move.description || "",
      });

      if (!rollInfo.hit) return;
    } else {
      this.log.push({
        type: by === "enemy" ? "enemy_move" : "player_move",
        id: move.id,
        name: move.name,
        kind: move.kind,
        element: move.element || "none",
        mpLeft: caster.MP ?? 0,
        spLeft: caster.SP ?? 0,
        desc: move.description || "",
      });
    }

    const crit = rollInfo?.crit === true;

    for (const eff of (move.effects ?? [])) {
      this.log.push(...this._applyEffect(by, caster, target, move, eff, crit));
    }

    for (const eff of (move.onHit ?? [])) {
      this.log.push(...this._applyEffect(by, caster, target, move, eff, false));
    }

    if (this.enemy.HP <= 0) this._end("player");
    if (this.player.HP <= 0) this._end("enemy");
  }

  // ------------------------------------------------------------
  // DEFEND / ITEM / FLEE
  // ------------------------------------------------------------
  _playerDefend() {
    this.player.status.defending = { turns: 1 };
    this.log.push({ type: "player_defend", text: "You brace for impact (Defend)." });
  }

  _playerItem(itemName) {
    const inv = this.player.inventory ?? [];
    const idx = inv.findIndex((x) => x.toLowerCase() === itemName.toLowerCase());
    if (idx === -1) {
      this.log.push({ type: "player_item_fail", text: `No item: ${itemName}` });
      return;
    }

    if (itemName.toLowerCase() === "potion") {
      inv.splice(idx, 1);

      const rolled = randInt(8, 12);
      const actual = this._heal(this.player, rolled);

      this.log.push({ type: "player_item", item: "Potion", heal: actual, playerHP: this.player.HP });
      return;
    }

    this.log.push({ type: "player_item_fail", text: `Item not usable yet: ${itemName}` });
  }

  _playerFlee() {
    const dc = 12 + Math.floor((this.enemy.AC ?? 10) / 5);
    const roll = d20();
    const total = roll + (this.player.CHA ?? 0);
    const success = total >= dc;

    this.log.push({ type: "player_flee", roll, total, dc, success });
    if (success) this._end("fled");
  }

  // ------------------------------------------------------------
  // ENEMY AI TURN (uses moves like player)
  // ------------------------------------------------------------
  _enemyTurn() {
    if (this.ended) return;

    // AI memory
    this.enemy.ai = this.enemy.ai ?? { turns: 0, lastBuffTurn: -999 };
    this.enemy.ai.turns += 1;

    const turnIndex = this.enemy.ai.turns;
    const hpPct = Number(this.enemy.HP ?? 0) / Math.max(1, Number(this.enemy.maxHP ?? 1));

    // Small flavor chance
    if (Math.random() < 0.10) {
      this.log.push({ type: "enemy_taunt", text: `${this.enemy.name} watches for an opening…` });
      return;
    }

    // Build candidate moves from loadout (max 4)
    const ids = Array.isArray(this.enemy.moves) ? this.enemy.moves.slice(0, 4) : [];
    const all = ids.map(getMoveById).filter(Boolean);

    // Only moves they can afford
    const usable = all.filter((m) => this._canAffordMove(this.enemy, m));

    // Categorize
    const heals = usable.filter((m) =>
      m.kind === "heal" || (m.effects ?? []).some((e) => e?.type === EffectType.Heal)
    );

    const buffs = usable.filter((m) =>
      m.kind === "buff" && String(m.target ?? "").toLowerCase() === "self"
    );

    const attacks = usable.filter((m) =>
      m.kind === "attack" && String(m.target ?? "").toLowerCase() === "enemy"
    );

    const debuffs = usable.filter((m) =>
      m.kind === "debuff" && String(m.target ?? "").toLowerCase() === "enemy"
    );

    const utility = usable.filter((m) => m.kind === "utility");

    // 1) Heal if HP < 50% AND they actually have a heal move
    if (hpPct < 0.5 && heals.length > 0) {
      const chosen = this._pickWeighted(heals.map((m) => [m, 1]));
      this._useMove("enemy", chosen.id);
      return;
    }

    // 2) Buff logic: more likely on turn 1, or if they haven't buffed in 0-2 turns
    if (buffs.length > 0) {
      const sinceBuff = turnIndex - (this.enemy.ai.lastBuffTurn ?? -999);
      const wantBuffWindow = randInt(0, 2); // your requested 0–2 window

      const buffChance = (turnIndex === 1) ? 0.75 : 0.40;
      const shouldBuff = (turnIndex === 1 || sinceBuff >= wantBuffWindow) && Math.random() < buffChance;

      if (shouldBuff) {
        const chosen = this._pickWeighted(buffs.map((m) => [m, 1 + Number(m.cost?.amount ?? 0) * 0.15]));
        this.enemy.ai.lastBuffTurn = turnIndex;
        this._useMove("enemy", chosen.id);
        return;
      }
    }

    // 3) Otherwise: mostly attack, sometimes debuff/utility
    const buckets = [];
    if (attacks.length > 0) buckets.push(["attack", 8]);
    if (debuffs.length > 0) buckets.push(["debuff", 3]);
    if (utility.length > 0) buckets.push(["utility", 1]);

    const pick = this._pickWeighted(buckets);

    if (pick === "debuff") {
      const chosen = this._pickWeighted(debuffs.map((m) => [m, 1]));
      this._useMove("enemy", chosen.id);
      return;
    }

    if (pick === "utility") {
      const chosen = this._pickWeighted(utility.map((m) => [m, 1]));
      this._useMove("enemy", chosen.id);
      return;
    }

    if (pick === "attack") {
      // slight preference for "special" moves (higher cost)
      const chosen = this._pickWeighted(attacks.map((m) => [m, 1 + Number(m.cost?.amount ?? 0) * 0.35]));
      this._useMove("enemy", chosen.id);
      return;
    }

    // 4) Fallback: if no usable moves, do basic attack
    this._enemyBasicAttack();
  }

  _enemyBasicAttack() {
    const roll = d20();
    const baseToHit = Number(this.enemy.to_hit ?? 0);
    const toHit = baseToHit + this._getToHitDelta(this.enemy);

    const total = roll + toHit;
    const crit = roll === 20;
    const fumble = roll === 1;

    const playerAC = this._getEffectiveAC(this.player);
    const hit = !fumble && (crit || total >= playerAC);

    let dmg = 0;
    let element = this._resolveDamageElement(this.enemy, Element.Physical, Element.Physical);
    let mult = 1.0;
    let tag = "";

    if (hit) {
      dmg = rollDamage(this.enemy.damage);
      if (crit) dmg += rollDamage(this.enemy.damage);

      dmg = this._modifyOutgoingDamage(this.enemy, dmg);
      dmg = this._modifyIncomingDamage(this.player, dmg);

      mult = this._getElementMultiplier(this.enemy, this.player, element);
      dmg = Math.max(0, Math.floor(dmg * mult));
      tag = this._elementTag(mult);

      this.player.HP -= dmg;
      this._consumeOnHit(this.player);
      this._clampHP(this.player);
    }

    this.log.push({
      type: "enemy_attack",
      roll,
      total,
      hit,
      crit,
      fumble,
      dmg,
      element,
      mult,
      tag,
      playerHP: this.player.HP,
    });

    if (this.player.HP <= 0) this._end("enemy");
  }

  // ------------------------------------------------------------
  // END / RESULT
  // ------------------------------------------------------------
  _end(winner) {
    this.ended = true;
    this.winner = winner;
    this.log.push({ type: "combat_end", winner });
  }

  _result(extra = {}) {
    return {
      ...extra,
      log: [...this.log],
      state: this.getPublicState(),
      ended: this.ended,
      winner: this.winner,
    };
  }
}
