// =========================
// FILE: engine.js
// Browser-friendly engine (port of story_gen.py)
// UI-agnostic: no DOM, no console printing
// =========================

import { makeCharacter, applyStatChanges } from "./character.js";
import { listAreas, getArea } from "./locations.js";
import { generateEncounter, generateChoices } from "./encounters.js";
import { generateEnemy } from "./enemy.js";
import { runCombat } from "./combat.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function d20() {
  return randInt(1, 20);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
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
    };

    this.difficulty = 0;

    // Current encounter snapshot
    this.current = {
      area: null,
      encounter: null,
      choices: null,
      lastResolution: null, // info from last choice/combat
      pending: "idle",      // idle | awaiting_choice | resolved
    };
  }

  // ---------- Public API ----------

  /**
   * startRun({ nameInput, classChoice, areaKey })
   */
  startRun({ nameInput = "", classChoice = 1, areaKey = "roads" } = {}) {
    this.player = makeCharacter(nameInput, classChoice);

    // ensure status exists even if character.js changes
    this.player.status = this.player.status ?? {};

    this.world.area_key = areaKey;
    this.world.rep = {};
    this.world.flags = new Set();
    this.world.encounters = 0;

    this.difficulty = 0;
    this.current.lastResolution = null;

    return this.nextEncounter();
  }

  listAreas() {
    return listAreas();
  }

  travelTo(areaKey) {
    if (!getArea(areaKey)) throw new Error("Invalid areaKey: " + areaKey);
    this.world.area_key = areaKey;
    return this.nextEncounter();
  }

  /**
   * Generates a fresh encounter and two choices.
   * Returns a renderable payload for UI.
   */
  nextEncounter() {
    if (!this.player) throw new Error("No player. Call startRun() first.");

    this.tickStatuses();

    this.world.encounters += 1;
    const area = getArea(this.world.area_key);

    const encounter = generateEncounter(area, this.world);
    const choices = generateChoices(area, encounter);

    this.current.area = area;
    this.current.encounter = encounter;
    this.current.choices = choices;
    this.current.lastResolution = null;
    this.current.pending = "awaiting_choice";

    return {
      type: "encounter",
      encounterNumber: this.world.encounters,
      area: this.publicArea(area),
      player: this.publicPlayer(),
      encounter: { ...encounter },
      choices: choices.map((c, idx) => ({
        index: idx + 1,
        text: c.text,
        stat: c.stat,
        dc: c.dc,
      })),
    };
  }

  /**
   * pickChoice(1 or 2)
   * Resolves the roll, stat changes, rep changes, possible combat.
   * Returns a renderable payload for UI.
   */
  pickChoice(choiceIndex) {
    if (!this.player) throw new Error("No player. Call startRun() first.");
    if (this.current.pending !== "awaiting_choice") {
      throw new Error("No active choice to resolve. Call nextEncounter() first.");
    }

    const idx = choiceIndex === 2 ? 1 : 0;
    const picked = this.current.choices[idx];
    const area = this.current.area;
    const encounter = this.current.encounter;

    const rollResult = this.rollCheck(this.player, picked.stat, picked.dc);
    const { roll, total, success, modUsed } = rollResult;

    // Apply outcome + world effects (mirrors your Python)
    let triggerCombat = false;
    let repChange = null;
    let statusApplied = null;

    if (success) {
      applyStatChanges(this.player, picked.success);

      triggerCombat = Math.random() < (encounter.combat_bias * 0.60);

      // help the first "good" faction
      const friendly = area.factions[0];
      this.world.rep[friendly] = (this.world.rep[friendly] ?? 0) + 1;
      repChange = { faction: friendly, delta: +1 };

    } else {
      applyStatChanges(this.player, picked.fail);

      triggerCombat = Math.random() < Math.min(0.95, encounter.combat_bias + 0.25);

      // hurt the last "bad" faction
      const hostile = area.factions[area.factions.length - 1];
      this.world.rep[hostile] = (this.world.rep[hostile] ?? 0) - 1;
      repChange = { faction: hostile, delta: -1 };

      // wounded status (simple stack)
      this.player.status = this.player.status ?? {};
      this.player.status.wounded = (this.player.status.wounded ?? 0) + 1;
      statusApplied = { key: "wounded", newValue: this.player.status.wounded };
    }

    // Prepare resolution payload
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
      message: success ? picked.success_msg : picked.fail_msg,
      repChange,
      statusApplied,
      playerAfter: this.publicPlayer(),
      triggerCombat,
      combat: null,
      runEnded: false,
    };

    // Combat path
    if (triggerCombat) {
      const enemy = generateEnemy(this.player, this.difficulty, encounter.enemy_type);

      const combatResult = runCombat(this.player, enemy);

      // Scale difficulty if player wins
      if (combatResult.winnerName === this.player.name) {
        this.difficulty += 1;
      } else {
        resolution.runEnded = true;
      }

      // Attach combat payload
      resolution.combat = {
        enemy: { ...enemy, HP: Math.max(enemy.HP, 0) },
        fled: combatResult.fled,
        winnerName: combatResult.winnerName,
        turns: combatResult.turns.map(t => ({
          actor: t.actor,
          d20: t.d20,
          total: t.total,
          hit: t.hit,
          crit: t.crit,
          fumble: t.fumble,
          dmg: t.dmg,
          playerHP: t.playerHP,
          enemyHP: t.enemyHP,
        })),
      };
    }

    // Player death check (post-combat or no combat)
    if (this.player.HP <= 0) {
      resolution.runEnded = true;
    }

    this.current.lastResolution = resolution;
    this.current.pending = "resolved";

    return resolution;
  }

  /**
   * Returns a snapshot state for UI at any time.
   */
  getState() {
    return {
      player: this.publicPlayer(),
      world: {
        area_key: this.world.area_key,
        encounters: this.world.encounters,
        rep: { ...this.world.rep },
        flags: Array.from(this.world.flags),
        difficulty: this.difficulty,
      },
      current: {
        pending: this.current.pending,
        area: this.current.area ? this.publicArea(this.current.area) : null,
        encounter: this.current.encounter ? { ...this.current.encounter } : null,
        choices: this.current.choices
          ? this.current.choices.map((c, i) => ({ index: i + 1, text: c.text, stat: c.stat, dc: c.dc }))
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
      HP: this.player.HP,
      AC: this.player.AC,
      to_hit: this.player.to_hit,
      damage: this.player.damage,
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
    const status = this.player.status ?? {};
    for (const k of Object.keys(status)) {
      status[k] -= 1;
      if (status[k] <= 0) delete status[k];
    }
  }

  rollCheck(character, stat, dc) {
    let roll = d20();
    let mod = character[stat] ?? 0;

    // tiny status spice (match your Python)
    const status = character.status ?? {};
    if ((status.wounded ?? 0) > 0 && stat === "STR") {
      mod -= 1;
    }

    let total = roll + mod;

    // blessed rerolls nat 1 once
    if ((status.blessed ?? 0) > 0 && roll === 1) {
      roll = d20();
      total = roll + mod;
    }

    return { roll, total, success: total >= dc, modUsed: mod };
  }
}
