// =========================
// FILE: adventure-ui.js
// Hooks AdventureEngine -> HUD + Battle UI
// =========================

import { AdventureEngine } from "./engine.js";
import { CombatController } from "./Combat.js";

const game = new AdventureEngine();
let combat = null; // CombatController when in battle

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function addLog(text, dim = false) {
  const log = $("hud-log");
  if (!log) return;

  const line = document.createElement("div");
  line.className = "log-line" + (dim ? " dim" : "");
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  const log = $("hud-log");
  if (log) log.innerHTML = "";
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// ---------- HUD render ----------
function renderPlayer(p) {
  if (!p) {
    setText("s-name", "—");
    setText("s-class", "—");
    setText("s-hp", "—");
    setText("s-ac", "—");
    setText("s-tohit", "—");
    setText("s-dmg", "—");
    setText("s-str", "—");
    setText("s-int", "—");
    setText("s-cha", "—");
    setText("s-status", "—");
    return;
  }

  setText("s-name", p.name);
  setText("s-class", p.class);
  setText("s-hp", String(p.HP));
  setText("s-ac", String(p.AC));
  setText("s-tohit", `+${p.to_hit}`);
  setText("s-dmg", `${p.damage[0]}-${p.damage[1]}`);
  setText("s-str", String(p.STR));
  setText("s-int", String(p.INT));
  setText("s-cha", String(p.CHA));

  const statusKeys = Object.keys(p.status ?? {});
  setText(
    "s-status",
    statusKeys.length ? statusKeys.map((k) => `${k}(${p.status[k]})`).join(", ") : "—"
  );
}

function renderLocation(area) {
  if (!area) {
    setText("hud-area", " —");
    setText("loc-name", "—");
    setText("loc-desc", "—");
    return;
  }

  setText("hud-area", ` ${area.name}`);
  setText("loc-name", area.name);
  setText("loc-desc", area.description);
}

function setChoicesVisible(visible) {
  const wrap = $("hud-choices");
  if (!wrap) return;
  wrap.hidden = !visible;
}

function renderChoices(choices) {
  if (!choices || choices.length < 2) {
    setChoicesVisible(false);
    return;
  }

  setChoicesVisible(true);

  const c1 = choices[0];
  const c2 = choices[1];

  const b1 = $("choice-1");
  const b2 = $("choice-2");

  if (b1) b1.textContent = `1) ${c1.text}  [${c1.stat} DC ${c1.dc}]`;
  if (b2) b2.textContent = `2) ${c2.text}  [${c2.stat} DC ${c2.dc}]`;

  if (b1) b1.dataset.choice = "1";
  if (b2) b2.dataset.choice = "2";
}

function renderEncounterPayload(payload) {
  setText("hud-encounters", String(payload.encounterNumber));
  renderLocation(payload.area);
  renderPlayer(payload.player);

  addLog(`Encounter #${payload.encounterNumber} — ${payload.area.name}`, true);
  addLog(payload.encounter.text);

  renderChoices(payload.choices);
}

function renderResolutionPayload(payload) {
  const r = payload.roll;
  addLog(`You chose: ${payload.choice.text}`, true);
  addLog(
    `${payload.choice.stat} check: d20=${r.d20} + ${r.mod} = ${r.total} vs DC ${payload.choice.dc} → ${
      r.success ? "SUCCESS" : "FAIL"
    }`
  );
  addLog(payload.message);

  if (payload.repChange) {
    addLog(
      `Reputation: ${payload.repChange.faction} ${payload.repChange.delta > 0 ? "+" : ""}${
        payload.repChange.delta
      }`,
      true
    );
  }
  if (payload.statusApplied) {
    addLog(`Status: ${payload.statusApplied.key} now ${payload.statusApplied.newValue}`, true);
  }

  const state = game.getState();
  renderPlayer(state.player);

  if (payload.triggerCombat && payload.combat) {
    beginCombatFromResolution(payload.combat.enemy);
    return;
  }

  if (payload.runEnded) {
    addLog("Run ended. Click Start Run to play again.", true);
    setChoicesVisible(false);
    return;
  }

  addLog("—", true);
  const next = game.nextEncounter();
  renderEncounterPayload(next);
}

// ---------- Battle UI helpers ----------
function showBattleUI(show) {
  const panel = $("battle-panel");
  if (!panel) return;

  panel.classList.toggle("hidden", !show);
  panel.setAttribute("aria-hidden", show ? "false" : "true");

  // Optional: dim/lock the HUD input during combat
  if ($("hud-input")) $("hud-input").disabled = show;
  if ($("hud-send")) $("hud-send").disabled = show;
}

function setHPBar(fillId, current, max) {
  const el = $(fillId);
  if (!el) return;

  const pct = max <= 0 ? 0 : clamp01(current / max);
  el.style.width = `${Math.round(pct * 100)}%`;
  el.classList.remove("hp-good", "hp-warn", "hp-bad");
  if (pct >= 0.60) el.classList.add("hp-good");
  else if (pct >= 0.30) el.classList.add("hp-warn");
  else el.classList.add("hp-bad");
}


function setBattleText(text) {
  setText("battle-text", text);
}

function setCombatButtonsEnabled(enabled) {
  if ($("cmd-attack")) $("cmd-attack").disabled = !enabled;
  if ($("cmd-skill")) $("cmd-skill").disabled = !enabled;
  if ($("cmd-item")) $("cmd-item").disabled = !enabled;
  if ($("cmd-run")) $("cmd-run").disabled = !enabled;
}

function anyAnimBusy() {
  return spriteBusy.player || spriteBusy.enemy;
}

// ---------- Floating combat text ----------
function showFloatingText(who, text, cls = "") {
  const wrap = who === "player" ? $("player-wrap") : $("enemy-wrap");
  if (!wrap) return;

  const el = document.createElement("div");
  el.className = `floating-text ${cls}`.trim();
  el.textContent = text;

  wrap.appendChild(el);
  window.setTimeout(() => el.remove(), 900);
}

// ---------- Sprite config ----------
const SPRITES = {
  player: {
    Warrior: {
      idle: { img: "Assets/warrior-idle.png", w: 144, h: 96, frames: 16, speed: "1s" },
      attack: { img: "Assets/warrior-single swing 1.png", w: 144, h: 96, frames: 11, speed: "1s" },
      hurt: { img: "Assets/warrior-hurt.png", w: 144, h: 96, frames: 8, speed: "1s" },
      death: { img: "Assets/warrior-death.png", w: 144, h: 96, frames: 19, speed: "1s" },
    },
    Cleric: {
      idle: { img: "Assets/cleric-idle.png", w: 160, h: 160, frames: 13, speed: "1s" },
      attack: { img: "Assets/cleric-atk.png", w: 160, h: 160, frames: 36, speed: "1s" },
      hurt: { img: "Assets/cleric-hurt.png", w: 160, h: 160, frames: 9, speed: "1s" },
      death: { img: "Assets/cleric-death.png", w: 160, h: 160, frames: 19, speed: "1s" },
    },
    Wizard: {
      idle: { img: "Assets/old_wizard-idle.png", w: 160, h: 160, frames: 10, speed: "1s" },
      attack: { img: "Assets/old_wizard-atk.png", w: 160, h: 160, frames: 21, speed: "1s" },
      hurt: { img: "Assets/old_wizard-hurt.png", w: 160, h: 160, frames: 9, speed: "1s" },
      death: { img: "Assets/old_wizard-death.png", w: 160, h: 160, frames: 12, speed: "1s" },
    },
    "Shambling Fool": {
      idle: { img: "Assets/fool_idle.png", w: 64, h: 64, frames: 6, speed: ".7s" },
      attack: { img: "Assets/fool_attack.png", w: 64, h: 64, frames: 6, speed: ".6s" },
      hurt: { img: "Assets/fool_hurt.png", w: 64, h: 64, frames: 4, speed: ".3s" },
      death: { img: "Assets/fool_death.png", w: 64, h: 64, frames: 6, speed: ".9s" },
    },
  },

  enemy: {
    Goblin: {
      idle: { img: "Assets/goblin-idle.png", w: 160, h: 128, frames: 6, speed: "1s" },
      attack: { img: "Assets/goblin-atk1.png", w: 160, h: 128, frames: 11, speed: "1s" },
      hurt: { img: "Assets/goblin-hurt.png", w: 160, h: 128, frames: 8, speed: "1s" },
      death: { img: "Assets/goblin-death.png", w: 160, h: 128, frames: 10, speed: "1s" },
    },
    "Cult Acolyte": {
      idle: { img: "Assets/cultist-idle.png", w: 220, h: 220, frames: 8, speed: "1s" },
      attack: { img: "Assets/cultist-atk.png", w: 220, h: 220, frames: 16, speed: "1s" },
      hurt: { img: "Assets/cultist-hurt.png", w: 220, h: 220, frames: 8, speed: "1s" },
      death: { img: "Assets/cultist-death.png", w: 220, h: 220, frames: 13, speed: "1s" },
    },
    Skeleton: {
      idle: { img: "Assets/skeleton-variation1-idle.png", w: 128, h: 128, frames: 7, speed: "1s" },
      attack: { img: "Assets/skeleton-variation1-attack.png", w: 128, h: 128, frames: 17, speed: "1s" },
      hurt: { img: "Assets/skeleton-variation1-hurt.png", w: 128, h: 128, frames: 11, speed: "1s" },
      death: { img: "Assets/skeleton-variation1-death.png", w: 128, h: 128, frames: 13, speed: "1s" },
    },
    Viper: {
      idle: { img: "Assets/viper-idle.png", w: 96, h: 96, frames: 8, speed: "1s" },
      attack: { img: "Assets/viper-attack.png", w: 96, h: 96, frames: 9, speed: "1s" },
      hurt: { img: "Assets/viper-hurt.png", w: 96, h: 96, frames: 6, speed: "1s" },
      death: { img: "Assets/viper-death.png", w: 96, h: 96, frames: 9, speed: "1s" },
    },
    Bandit: {
      idle: { img: "Assets/bandit-idle.png", w: 128, h: 96, frames: 8, speed: "1s" },
      attack: { img: "Assets/bandit-atk.png", w: 128, h: 96, frames: 21, speed: "1s" },
      hurt: { img: "Assets/bandit-hurt.png", w: 128, h: 96, frames: 11, speed: "1s" },
      death: { img: "Assets/bandit-death.png", w: 128, h: 96, frames: 16, speed: "1s" },
    },
    Zombie: {
      idle: { img: "Assets/zombie-idle.png", w: 96, h: 96, frames: 8, speed: "1s" },
      attack: { img: "Assets/zombie-atk.png", w: 96, h: 96, frames: 18, speed: "1s" },
      hurt: { img: "Assets/zombie-hurt.png", w: 96, h: 96, frames: 9, speed: "1s" },
      death: { img: "Assets/zombie-death.png", w: 96, h: 96, frames: 12, speed: "1s" },
    },
  },
};

function getAnim(who, playerClass, enemyType, animName) {
  if (who === "player") {
    const set = SPRITES.player[playerClass] ?? SPRITES.player.Warrior;
    return set[animName] ?? set.idle;
  } else {
    const set = SPRITES.enemy[enemyType] ?? SPRITES.enemy.Goblin;
    return set[animName] ?? set.idle;
  }
}

// Track timeouts so animations don’t fight each other
const spriteTimers = { player: null, enemy: null };
const spriteLocked = { player: false, enemy: false };
const spriteBusy = { player: false, enemy: false };

// --------- JS-controlled sprite sheet animation (no drift) ---------
function restartAnim(el) {
  el.style.animationName = "none";
  void el.offsetHeight;
}

function parseSpeedToMs(speed) {
  const s = typeof speed === "string" ? speed.trim() : "1s";
  const num = parseFloat(s);
  if (!Number.isFinite(num)) return 350;
  if (s.endsWith("ms")) return Math.max(1, Math.round(num));
  return Math.max(1, Math.round(num * 1000));
}

function applySheet(el, anim, opts = {}) {
  if (!el || !anim) return;

  const { loop = true, holdLast = false } = opts;

  el.style.backgroundPosition = "0px 0px";
  el.style.backgroundImage = `url("${anim.img}")`;
  el.style.setProperty("--w", `${anim.w}px`);
  el.style.setProperty("--h", `${anim.h}px`);

  // expose size to wrapper too (for floating text positioning)
  const wrap = el.closest("#player-wrap, #enemy-wrap");
  if (wrap) {
    wrap.style.setProperty("--w", `${anim.w}px`);
    wrap.style.setProperty("--h", `${anim.h}px`);
  }

  el.style.setProperty("--frames", String(anim.frames));
  el.style.setProperty("--speed", anim.speed);

  const frames = Math.max(1, Number(anim.frames) || 1);
  el.style.backgroundSize = `${anim.w * frames}px ${anim.h}px`;

  restartAnim(el);
  el.style.animationName = "sheetAnim";
  el.style.animationDuration = anim.speed;
  el.style.animationTimingFunction = `steps(${frames})`;
  el.style.animationIterationCount = loop ? "infinite" : "1";
  el.style.animationFillMode = "none";
  el.style.animationPlayState = "running";

  if (!loop && holdLast) {
    const ms = parseSpeedToMs(anim.speed);
    window.setTimeout(() => {
      el.style.animationName = "none";
      el.style.backgroundPosition = `${-anim.w * (frames - 1)}px 0px`;
    }, ms);
  }
}

function animMs(who, playerClass, enemyType, animName) {
  const anim = getAnim(who, playerClass, enemyType, animName);
  return parseSpeedToMs(anim?.speed ?? "0.35s");
}

function setSpriteIdle(playerClass, enemyType) {
  spriteLocked.player = false;
  spriteLocked.enemy = false;

  applySheet($("player-sprite"), getAnim("player", playerClass, enemyType, "idle"), { loop: true });
  applySheet($("enemy-sprite"), getAnim("enemy", playerClass, enemyType, "idle"), { loop: true });
}

function playSpriteAnim(who, animName, playerClass, enemyType, _holdMsIgnored = 0, opts = {}) {
  const { returnToIdle = true, lock = false, force = false } = opts;

  const el = who === "player" ? $("player-sprite") : $("enemy-sprite");
  if (!el) return;

  if (spriteLocked[who] && !force) return;
  if (spriteBusy[who] && !force) return;

  if (spriteTimers[who]) window.clearTimeout(spriteTimers[who]);

  const isIdle = animName === "idle";
  const isDeath = animName === "death";

  applySheet(el, getAnim(who, playerClass, enemyType, animName), {
    loop: isIdle,
    holdLast: isDeath || lock,
  });

  if (lock) {
    spriteLocked[who] = true;
    spriteBusy[who] = true;
    spriteTimers[who] = null;
    return;
  }

  spriteBusy[who] = true;
  const durationMs = animMs(who, playerClass, enemyType, animName);

  spriteTimers[who] = window.setTimeout(() => {
    spriteBusy[who] = false;
    spriteTimers[who] = null;

    if (!returnToIdle) return;
    if (spriteLocked[who]) return;

    applySheet(el, getAnim(who, playerClass, enemyType, "idle"), { loop: true });
  }, durationMs);
}

// ---------- Combat flow ----------
let combatMax = { playerHP: 1, enemyHP: 1 };
let combatEnemyType = "Goblin";
let combatPlayerClass = "Warrior";
let combatInputLocked = false;

// Feel knobs (tweak these)
const HIT_FRACTION = 0.55;       // impact moment inside attack anim
const TURN_BEAT_MS = 300;        // pause after player finishes before enemy starts
const POST_ENEMY_BEAT_MS = 250;  // pause after enemy finishes before player can act

function beginCombatFromResolution(enemyObj) {
  const state = game.getState();
  if (!state.player) return;

  setChoicesVisible(false);

  combat = new CombatController(state.player, enemyObj);
  const pub = combat.getPublicState();

  combatMax.playerHP = pub.player.HP;
  combatMax.enemyHP = pub.enemy.HP;

  combatEnemyType = enemyObj.type ?? "Goblin";
  combatPlayerClass = pub.player?.class ?? "Warrior";

  setText("player-name", pub.player.name);
  setText("enemy-name", pub.enemy.name);

  setHPBar("player-hp", pub.player.HP, combatMax.playerHP);
  setHPBar("enemy-hp", pub.enemy.HP, combatMax.enemyHP);

  setSpriteIdle(combatPlayerClass, combatEnemyType);

  setBattleText(`A wild ${enemyObj.type ?? "enemy"} appears!`);
  showBattleUI(true);

  combatInputLocked = false;
  setCombatButtonsEnabled(pub.turn === "player");

  addLog(`Combat begins: ${pub.enemy.name}`, true);
}

function endCombatAndReturnToStory(result) {
  setCombatButtonsEnabled(false);
  combatInputLocked = false;

  const s = game.getState();
  renderPlayer(s.player);

  if (result.winner === "fled") {
    showBattleUI(false);
    addLog("You escaped!", true);
    const next = game.nextEncounter();
    renderEncounterPayload(next);
    combat = null;
    return;
  }

  if (result.winner === "player") {
    playSpriteAnim("enemy", "death", combatPlayerClass, combatEnemyType, 0, { lock: true, returnToIdle: false });
    setBattleText(`${combat.enemy.name} falls!`);

    window.setTimeout(() => {
      showBattleUI(false);
      addLog("You won the fight!", true);
      const next = game.nextEncounter();
      renderEncounterPayload(next);
      combat = null;
    }, 900);

    return;
  }

  playSpriteAnim("player", "death", combatPlayerClass, combatEnemyType, 0, { lock: true, returnToIdle: false });
  setBattleText("You collapse...");

  window.setTimeout(() => {
    showBattleUI(false);
    addLog("You were defeated. Type 'start' to try again.", true);
    setChoicesVisible(false);
    combat = null;
  }, 900);
}

function applyBarsFromState(state) {
  setHPBar("player-hp", state.player.HP, combatMax.playerHP);
  setHPBar("enemy-hp", state.enemy.HP, combatMax.enemyHP);
}

// Convert combat log into text (NO hurt anim here — we time impact separately)
function printCombatLog(entries) {
  for (const e of entries) {
    if (e.type === "player_attack") {
      setBattleText(`You attack! ${e.hit ? `Hit for ${e.dmg}.` : "Miss!"}`);
      addLog(`You attack: d20=${e.roll} total=${e.total} ${e.hit ? `HIT (${e.dmg})` : "MISS"}`, true);
    } else if (e.type === "enemy_attack") {
      setBattleText(`${combat.enemy.name} attacks! ${e.hit ? `Hit for ${e.dmg}.` : "Miss!"}`);
      addLog(`Enemy attack: d20=${e.roll} total=${e.total} ${e.hit ? `HIT (${e.dmg})` : "MISS"}`, true);
    } else if (e.type === "player_defend") {
      setBattleText("You defend!");
      addLog(e.text, true);
    } else if (e.type === "player_spell") {
      setBattleText(`${e.spell}! ${e.hit ? `Deals ${e.dmg}.` : "Fails!"}`);
      addLog(`Spell ${e.spell}: ${e.hit ? `HIT (${e.dmg})` : "MISS"} (MP ${e.mpLeft})`, true);
    } else if (e.type === "player_item") {
      setBattleText(`You use a Potion (+${e.heal} HP).`);
      addLog(`Potion heals ${e.heal}.`, true);
    } else if (e.type === "player_flee") {
      setBattleText(e.success ? "You got away!" : "Can't escape!");
      addLog(`Flee: ${e.total} vs DC ${e.dc} → ${e.success ? "SUCCESS" : "FAIL"}`, true);
    } else if (e.type === "enemy_taunt") {
      setBattleText(e.text);
      addLog(e.text, true);
    } else if (e.type === "player_spell_fail" || e.type === "player_item_fail") {
      setBattleText(e.text);
      addLog(e.text, true);
    }
  }
}

function schedulePlayerImpact(entries, impactMs, impactState) {
  const p = entries.find((x) => x.type === "player_attack" || x.type === "player_spell");
  if (!p) return;

  window.setTimeout(() => {
    if (!combat) return;

    // update HP bars exactly at impact moment
    applyBarsFromState(impactState);

    if (p.hit) playSpriteAnim("enemy", "hurt", combatPlayerClass, combatEnemyType, 0);
    else showFloatingText("enemy", "MISS", "miss");
  }, impactMs);
}

function scheduleEnemyImpact(entries, impactMs, impactState) {
  const e = entries.find((x) => x.type === "enemy_attack");
  if (!e) return;

  window.setTimeout(() => {
    if (!combat) return;

    // update HP bars exactly at impact moment
    applyBarsFromState(impactState);

    if (e.hit) playSpriteAnim("player", "hurt", combatPlayerClass, combatEnemyType, 0);
    else showFloatingText("player", "MISS", "miss");
  }, impactMs);
}


// Combat inputs (phased turn timing)
function runCombatAction(actionKey, arg = "") {
  if (!combat) return;
  if (combatInputLocked) return;
  if (anyAnimBusy()) return;

  const pub = combat.getPublicState();
  if (!pub.active) return;
  if (pub.turn !== "player") return;

  combatInputLocked = true;
  setCombatButtonsEnabled(false);

  // Gesture anim choices (until you add defend/item/flee anims)
  const playerAnimName =
    actionKey === "attack" || actionKey === "spell" ? "attack" :
    actionKey === "defend" || actionKey === "item" || actionKey === "flee" ? "attack" :
    "idle";

  const playerAnimDuration =
    playerAnimName !== "idle"
      ? animMs("player", combatPlayerClass, combatEnemyType, playerAnimName)
      : 250;

  if (playerAnimName !== "idle") {
    playSpriteAnim("player", playerAnimName, combatPlayerClass, combatEnemyType, 0);
  }

  // --- PLAYER ENGINE STEP (player only) ---
  const playerResult = combat.actPlayer(actionKey, arg);
  const playerEntries = playerResult.log;

  // Log immediately, bars at impact moment
  printCombatLog(playerEntries);

  // Determine if there is an actual "impact" (attack/spell) or just instant (item/defend/flee)
  const playerImpactMs = Math.floor(playerAnimDuration * HIT_FRACTION);
  const playerHasImpact = playerEntries.some(
    (x) => x.type === "player_attack" || x.type === "player_spell"
  );

  if (playerHasImpact) {
    schedulePlayerImpact(playerEntries, playerImpactMs, playerResult.state);
  } else {
    // If no attack impact, update bars right after the gesture a bit
    window.setTimeout(() => {
      if (!combat) return;
      applyBarsFromState(playerResult.state);
    }, Math.min(160, playerAnimDuration));
  }

  // If player ended combat (killed enemy or fled)
  if (playerResult.ended) {
    window.setTimeout(
      () => endCombatAndReturnToStory(playerResult),
      Math.max(150, playerAnimDuration)
    );
    return;
  }

  // --- ENEMY PHASE (after player anim + beat) ---
  window.setTimeout(() => {
    if (!combat) return;

    const enemyResult = combat.actEnemy();
    const enemyEntries = enemyResult.log;

    const didEnemyAttack = enemyEntries.some((x) => x.type === "enemy_attack");
    const didEnemyTaunt = enemyEntries.some((x) => x.type === "enemy_taunt");

    if (didEnemyAttack) {
      playSpriteAnim("enemy", "attack", combatPlayerClass, combatEnemyType, 0);
    } else if (didEnemyTaunt) {
      // tiny tell so it doesn't feel frozen
      playSpriteAnim("enemy", "hurt", combatPlayerClass, combatEnemyType, 0, { returnToIdle: true });
    }

    // Log now; bars at impact
    printCombatLog(enemyEntries);

    const enemyAnimDuration = didEnemyAttack
      ? animMs("enemy", combatPlayerClass, combatEnemyType, "attack")
      : 450;

    const enemyImpactMs = Math.floor(enemyAnimDuration * HIT_FRACTION);
    if (didEnemyAttack) {
      scheduleEnemyImpact(enemyEntries, enemyImpactMs, enemyResult.state);
    } else {
      window.setTimeout(() => {
        if (!combat) return;
        applyBarsFromState(enemyResult.state);
      }, 120);
    }

    if (enemyResult.ended) {
      window.setTimeout(
        () => endCombatAndReturnToStory(enemyResult),
        Math.max(150, enemyAnimDuration)
      );
      return;
    }

    // Unlock after enemy anim + beat
    window.setTimeout(() => {
      combatInputLocked = false;
      const s = combat?.getPublicState();
      if (combat && s?.active && s.turn === "player") setCombatButtonsEnabled(true);
    }, enemyAnimDuration + POST_ENEMY_BEAT_MS);
  }, playerAnimDuration + TURN_BEAT_MS);
}

// Safe default
setCombatButtonsEnabled(false);

// ---------- Command handling ----------
function handleCommand(raw) {
  const cmd = raw.trim();
  if (!cmd) return;

  addLog(`> ${cmd}`, true);
  const lower = cmd.toLowerCase();

  // ✅ ALWAYS allow reset (even during combat)
  if (lower === "reset") {
    game.reset();
    combat = null;
    combatInputLocked = false;

    clearLog();
    renderPlayer(null);
    renderLocation(null);
    setText("hud-encounters", "0");
    setChoicesVisible(false);
    showBattleUI(false);
    setCombatButtonsEnabled(false);

    addLog("Reset complete. Type “start” to begin.", true);
    return;
  }

  // ✅ ALWAYS allow start (even during combat)
  if (lower.startsWith("start")) {
    // If combat was up, close it
    combat = null;
    combatInputLocked = false;
    showBattleUI(false);
    setCombatButtonsEnabled(false);
    setChoicesVisible(false);

    clearLog();

    const parts = lower.split(/\s+/);
    let classChoice = parts[1] ? Number(parts[1]) : NaN;
    if (!Number.isFinite(classChoice) || classChoice < 1 || classChoice > 4) {
      classChoice = Math.floor(Math.random() * 4) + 1;
    }

    addLog(`Starting new run… (Class ${classChoice})`, true);

    const payload = game.startRun({ nameInput: "", classChoice, areaKey: "roads" });
    renderEncounterPayload(payload);
    return;
  }

  // If in combat, route combat commands (AFTER start/reset)
  if (combat && combat.getPublicState().active) {
    if (lower === "attack") return runCombatAction("attack");
    if (lower === "defend") return runCombatAction("defend");
    if (lower === "run" || lower === "flee") return runCombatAction("flee");

    if (lower.startsWith("spell")) {
      const parts = lower.split(/\s+/);
      return runCombatAction("spell", parts[1] || "fire");
    }
    if (lower.startsWith("item")) {
      const parts = lower.split(/\s+/);
      return runCombatAction("item", parts[1] || "potion");
    }

    addLog("Combat commands: attack, defend, spell fire|ice, item potion, run", true);
    return;
  }

  // Story commands
  if (lower === "help") {
    addLog("Commands: start [1-4], stats, areas, travel <roads|chapel|marsh>, reset");
    addLog("During combat: attack, defend, spell fire|ice, item potion, run");
    return;
  }

  if (lower === "stats") {
    const s = game.getState();
    addLog(
      `Stats: HP ${s.player?.HP ?? "—"} | AC ${s.player?.AC ?? "—"} | STR ${s.player?.STR ?? "—"} | INT ${
        s.player?.INT ?? "—"
      } | CHA ${s.player?.CHA ?? "—"}`,
      true
    );
    return;
  }

  if (lower === "areas") {
    const areas = game.listAreas();
    addLog("Areas: " + areas.map((a) => a.key).join(", "));
    return;
  }

  if (lower.startsWith("travel ")) {
    const key = lower.split(/\s+/)[1];
    try {
      const payload = game.travelTo(key);
      renderEncounterPayload(payload);
    } catch {
      addLog(`Unknown area: ${key}. Try: roads, chapel, marsh`);
    }
    return;
  }

  addLog("Unknown command. Type 'help'.", true);
}

// ---------- Wire up events ----------
document.addEventListener("DOMContentLoaded", () => {
  // Buttons
  $("btn-start")?.addEventListener("click", () => handleCommand("start"));
  $("btn-reset")?.addEventListener("click", () => handleCommand("reset"));

  $("hud-send")?.addEventListener("click", () => handleCommand($("hud-input")?.value ?? ""));
  $("hud-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCommand($("hud-input")?.value ?? "");
  });

  // Choice buttons (story)
  $("choice-1")?.addEventListener("click", () => {
    try {
      const payload = game.pickChoice(1);
      renderResolutionPayload(payload);
    } catch {
      addLog("No active encounter. Type 'start'.", true);
    }
  });

  $("choice-2")?.addEventListener("click", () => {
    try {
      const payload = game.pickChoice(2);
      renderResolutionPayload(payload);
    } catch {
      addLog("No active encounter. Type 'start'.", true);
    }
  });

  // Battle command buttons
  $("cmd-attack")?.addEventListener("click", () => runCombatAction("attack"));
  $("cmd-skill")?.addEventListener("click", () => runCombatAction("spell", "fire"));
  $("cmd-item")?.addEventListener("click", () => runCombatAction("item", "potion"));
  $("cmd-run")?.addEventListener("click", () => runCombatAction("flee"));

  // Initial UI defaults
  renderPlayer(null);
  renderLocation(null);
  setChoicesVisible(false);
  showBattleUI(false);
  setCombatButtonsEnabled(false);
});
