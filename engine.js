// =========================
// FILE: engine.js
// Browser-friendly engine (UI-agnostic)
// IMPORTANT: This engine does NOT auto-run combat.
// It only triggers combat and returns an enemy payload to the UI.
// =========================

import { makeCharacter, applyStatChanges } from "./Character.js";
import { listAreas, getArea } from "./location.js";

// NEW: arc + beat-based encounters
import { createArc } from "./arc.js";
import { generateBeat, generateChoices } from "./encounters.js";

import { generateEnemy, generateBoss } from "./enemy.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function d20() {
  return randInt(1, 20);
}

export class AdventureEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.player = null;

    this.world = {
      area_key: "roads",
      rep: {},          // {"Road Wardens": 2, ...}
      flags: new Set(), // {"missing_caravan", ...}
      encounters: 0,

      // NEW: persistent storyline arc for the current area
      arc: null,
    };

    this.difficulty = 0;

    this.current = {
      area: null,
      beat: null,        // NEW: beat replaces encounter
      choices: null,
      lastResolution: null,
      pending: "idle", // idle | awaiting_choice | resolved
    };
  }

  // ---------- Public API ----------

  startRun({ nameInput = "", classChoice = 1, areaKey = "roads" } = {}) {
    this.player = makeCharacter(nameInput, classChoice);

    // Ensure shape (so UI + combat won't explode if fields missing)
    this.player.status = this.player.status ?? {};
    this.player.inventory = this.player.inventory ?? ["potion"];

    // Pools (keep whatever Character.js gave, but ensure present)
    this.player.MP = Number.isFinite(Number(this.player.MP)) ? Number(this.player.MP) : 3;
    this.player.maxMP = Number.isFinite(Number(this.player.maxMP))
      ? Number(this.player.maxMP)
      : Number(this.player.MP);

    this.player.SP = Number.isFinite(Number(this.player.SP)) ? Number(this.player.SP) : 0;
    this.player.maxSP = Number.isFinite(Number(this.player.maxSP))
      ? Number(this.player.maxSP)
      : Number(this.player.SP);

    // Moves loadouts should exist (UI can overwrite after startRun)
    this.player.attacks = Array.isArray(this.player.attacks) ? this.player.attacks : [];
    this.player.abilities = Array.isArray(this.player.abilities) ? this.player.abilities : [];

    this.world.area_key = areaKey;
    this.world.rep = {};
    this.world.flags = new Set();
    this.world.encounters = 0;

    // NEW: reset arc on new run
    this.world.arc = null;

    this.difficulty = 0;

    this.current.lastResolution = null;
    this.current.pending = "idle";

    return this.nextEncounter();
  }

  listAreas() {
    return listAreas();
  }

  travelTo(areaKey) {
    if (!getArea(areaKey)) throw new Error("Invalid areaKey: " + areaKey);
    this.world.area_key = areaKey;

    // NEW: swap to a new arc when traveling
    this.world.arc = null;

    return this.nextEncounter();
  }

  nextEncounter() {
    if (!this.player) throw new Error("No player. Call startRun() first.");

    this.tickStatuses();

    this.world.encounters += 1;

    const area = getArea(this.world.area_key);

    // NEW: ensure an arc exists for this area
    if (!this.world.arc || this.world.arc.area_key !== area.key) {
      this.world.arc = createArc(area, this.world);
    }

    // NEW: generate a story beat, not a loot-y encounter
    const beat = generateBeat(area, this.world, this.world.arc);

    // NEW: choices can be beat/arc-aware
    const choices = generateChoices(area, beat, this.world.arc);

    this.current.area = area;
    this.current.beat = beat;
    this.current.choices = choices;
    this.current.lastResolution = null;
    this.current.pending = "awaiting_choice";

    return {
      type: "encounter", // keep the same type so UI doesn’t break
      encounterNumber: this.world.encounters,
      area: this.publicArea(area),
      player: this.publicPlayer(),

      // UI still expects "encounter" text; we map beat -> encounter for compatibility
      encounter: {
        text: beat.text,
        enemy_type: beat.enemy_type ?? null,
        kind: beat.kind ?? null,
        area_key: beat.area_key ?? area.key,

        // expose arc progress for UI (optional to display)
        arc: {
          antagonist: this.world.arc?.antagonist?.name ?? null,
          stepsRemaining: this.world.arc?.stepsRemaining ?? null,
          beatIndex: this.world.arc?.beatIndex ?? null,
          flags: { ...(this.world.arc?.flags ?? {}) },
        },
      },

      choices: choices.map((c, idx) => ({
        index: idx + 1,
        text: c.text,
        stat: c.stat,
        dc: c.dc,
      })),
    };
  }

  pickChoice(choiceIndex) {
    if (!this.player) throw new Error("No player. Call startRun() first.");
    if (this.current.pending !== "awaiting_choice") {
      throw new Error("No active choice to resolve. Call nextEncounter() first.");
    }

    const idx = choiceIndex === 2 ? 1 : 0;
    const picked = this.current.choices[idx];
    const area = this.current.area;
    const beat = this.current.beat;
    const arc = this.world.arc;

    const rollResult = this.rollCheck(this.player, picked.stat, picked.dc);
    const { roll, total, success, modUsed } = rollResult;

    let triggerCombat = false;
    let repChange = null;
    let statusApplied = null;

    // -----------------------------
    // Story-first resolution
    // -----------------------------

    if (success) {
      applyStatChanges(this.player, picked.success ?? {});

      // Optional hook: allow choice to mutate arc state (your choices can define on_success)
      if (typeof picked.on_success === "function") {
        try { picked.on_success(arc, area, beat, this.world, this.player); } catch {}
      }

      // Rep stays if you still want it (or remove later)
      const friendly = area.factions[0];
      this.world.rep[friendly] = (this.world.rep[friendly] ?? 0) + 1;
      repChange = { faction: friendly, delta: +1 };

    } else {
      applyStatChanges(this.player, picked.fail ?? {});

      if (typeof picked.on_fail === "function") {
        try { picked.on_fail(arc, area, beat, this.world, this.player); } catch {}
      }

      const hostile = area.factions[area.factions.length - 1];
      this.world.rep[hostile] = (this.world.rep[hostile] ?? 0) - 1;
      repChange = { faction: hostile, delta: -1 };

      // Keep your wounded status if you like the consequence loop
      const prev = this.player.status.wounded;
      const prevTurns = (prev && typeof prev === "object") ? (prev.turns ?? 0) : 0;
      this.player.status.wounded = { turns: Math.max(prevTurns, 3), dmgMult: 0.75 };
      statusApplied = { key: "wounded", turns: this.player.status.wounded.turns };
    }

    // -----------------------------
    // Combat rules (story beat driven)
    // -----------------------------
    // If beat is ambush/subboss/boss -> combat always.
    // Otherwise -> only if choice explicitly forces it (later extension).
    const beatKind = beat?.kind ?? null;

    if (picked.force_combat === true) {
      triggerCombat = true;
    } else if (beatKind === "ambush" || beatKind === "subboss" || beatKind === "boss") {
      triggerCombat = true;
    } else {
      triggerCombat = false;
    }

    const resolution = {
      type: "resolution",
      choice: {
        index: choiceIndex,
        text: picked.text,
        stat: picked.stat,
        dc: picked.dc,
      },
      roll: {
        d20: roll,
        mod: modUsed,
        total,
        success,
      },

      // Beat-aware messaging (no reward text)
      message: success ? (picked.success_msg ?? "You make progress.") : (picked.fail_msg ?? "It goes poorly."),

      repChange,
      statusApplied,
      playerAfter: this.publicPlayer(),

      triggerCombat,
      combat: null,

      runEnded: false,
    };

    if (triggerCombat) {
      const enemyType = beat?.enemy_type ?? null;
      const kind = beat?.kind ?? null;

      let enemy = null;

      if (kind === "boss") {
        // Big title + big scaling
        enemy = generateBoss(this.player, this.difficulty, area, enemyType);
      } else if (kind === "subboss") {
        // Slightly lighter than boss (tune to taste)
        const subDiff = Math.max(0, this.difficulty + 1);
        enemy = generateBoss(this.player, subDiff, area, enemyType);
        enemy.name = enemy.name.replace("(Boss)", "(Subboss)");
        enemy.isSubBoss = true;
      } else {
        // normal ambush etc
        enemy = generateEnemy(this.player, this.difficulty, enemyType);
      }

  resolution.combat = { enemy };
}

    if (this.player.HP <= 0) {
      resolution.runEnded = true;
    }

    this.current.lastResolution = resolution;
    this.current.pending = "resolved";

    return resolution;
  }

  // Called by UI after winning a fight (so difficulty scales the same way as before)
  onCombatWin() {
    this.difficulty += 1;
  }

  // Optional: called by UI after losing a fight
  onCombatLose() {
    // flags, etc later
  }

  getState() {
    return {
      player: this.publicPlayer(),
      world: {
        area_key: this.world.area_key,
        encounters: this.world.encounters,
        rep: { ...this.world.rep },
        flags: Array.from(this.world.flags),
        difficulty: this.difficulty,

        // NEW: arc state (optional for UI/debug)
        arc: this.world.arc
          ? {
              id: this.world.arc.id,
              area_key: this.world.arc.area_key,
              antagonist: this.world.arc.antagonist,
              hero: this.world.arc.hero,
              stepsRemaining: this.world.arc.stepsRemaining,
              beatIndex: this.world.arc.beatIndex,
              flags: { ...this.world.arc.flags },
              lieutenantsRemaining: this.world.arc.lieutenants?.length ?? 0,
            }
          : null,
      },
      current: {
        pending: this.current.pending,
        area: this.current.area ? this.publicArea(this.current.area) : null,
        encounter: this.current.beat
          ? {
              text: this.current.beat.text,
              enemy_type: this.current.beat.enemy_type ?? null,
              kind: this.current.beat.kind ?? null,
              area_key: this.current.beat.area_key ?? null,
            }
          : null,
        choices: this.current.choices
          ? this.current.choices.map((c, i) => ({
              index: i + 1,
              text: c.text,
              stat: c.stat,
              dc: c.dc,
            }))
          : null,
        lastResolution: this.current.lastResolution,
      },
    };
  }

  // ---------- Internal helpers ----------

  publicPlayer() {
    if (!this.player) return null;

    return {
      name: this.player.name,
      class: this.player.class,

      STR: this.player.STR,
      INT: this.player.INT,
      CHA: this.player.CHA,
      DEX: this.player.DEX,
      CON: this.player.CON,

      HP: this.player.HP,
      maxHP: this.player.maxHP ?? this.player.HP,

      AC: this.player.AC,
      to_hit: this.player.to_hit,
      damage: this.player.damage,

      MP: this.player.MP ?? 0,
      maxMP: this.player.maxMP ?? this.player.MP ?? 0,

      SP: this.player.SP ?? 0,
      maxSP: this.player.maxSP ?? this.player.SP ?? 0,

      attacks: [...(this.player.attacks ?? [])],
      abilities: [...(this.player.abilities ?? [])],

      status: { ...(this.player.status ?? {}) },
      inventory: [...(this.player.inventory ?? [])],
    };
  }

  publicArea(area) {
    return {
      key: area.key,
      name: area.name,
      description: area.description,
      factions: [...area.factions],
      combat_bias: area.combat_bias,
    };
  }

  tickStatuses() {
    if (!this.player) return;
    const status = this.player.status ?? {};

    for (const [k, v] of Object.entries(status)) {
      if (typeof v === "number") {
        status[k] = v - 1;
        if (status[k] <= 0) delete status[k];
        continue;
      }

      if (v && typeof v === "object" && typeof v.turns === "number") {
        v.turns -= 1;
        if (v.turns <= 0) delete status[k];
        continue;
      }
    }
  }

  rollCheck(character, stat, dc) {
    let roll = d20();
    const mod = character[stat] ?? 0;

    const status = character.status ?? {};
    let total = roll + mod;

    // blessed rerolls nat 1 once
    if ((status.blessed ?? 0) > 0 && roll === 1) {
      roll = d20();
      total = roll + mod;
    }

    return { roll, total, success: total >= dc, modUsed: mod };
  }
}
