// =========================
// FILE: adventure-ui.js
// Hooks AdventureEngine -> your HUD elements
// =========================

import { AdventureEngine } from "./engine.js";

const game = new AdventureEngine();

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
    statusKeys.length ? statusKeys.map(k => `${k}(${p.status[k]})`).join(", ") : "—"
  );
}

function renderLocation(area) {
  if (!area) {
    setText("hud-area", "📍 —");
    setText("loc-name", "—");
    setText("loc-desc", "—");
    return;
  }

  setText("hud-area", `📍 ${area.name}`);
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

  // store choice numbers for click handlers
  b1.dataset.choice = "1";
  b2.dataset.choice = "2";
}

function renderEncounterPayload(payload) {
  // payload.type === "encounter"
  setText("hud-encounters", String(payload.encounterNumber));
  renderLocation(payload.area);
  renderPlayer(payload.player);

  addLog(`Encounter #${payload.encounterNumber} — ${payload.area.name}`, true);
  addLog(payload.encounter.text);

  renderChoices(payload.choices);
}

function renderResolutionPayload(payload) {
  // payload.type === "resolution"
  const r = payload.roll;
  addLog(`You chose: ${payload.choice.text}`, true);
  addLog(`${payload.choice.stat} check: d20=${r.d20} + ${r.mod} = ${r.total} vs DC ${payload.choice.dc} → ${r.success ? "SUCCESS" : "FAIL"}`);
  addLog(payload.message);

  if (payload.repChange) {
    addLog(`Reputation: ${payload.repChange.faction} ${payload.repChange.delta > 0 ? "+" : ""}${payload.repChange.delta}`, true);
  }
  if (payload.statusApplied) {
    addLog(`Status: ${payload.statusApplied.key} now ${payload.statusApplied.newValue}`, true);
  }

  if (payload.combat) {
    addLog(`⚔ Combat starts vs ${payload.combat.enemy.name}!`, true);

    // Print combat turns
    for (const t of payload.combat.turns) {
      if (t.actor === "player") {
        addLog(`You roll ${t.d20} → ${t.total} ${t.hit ? "HIT" : "MISS"}${t.crit ? " (CRIT!)" : ""}${t.fumble ? " (FUMBLE)" : ""} for ${t.dmg}. Enemy HP: ${t.enemyHP}`);
      } else {
        addLog(`Enemy rolls ${t.d20} → ${t.total} ${t.hit ? "HIT" : "MISS"}${t.crit ? " (CRIT!)" : ""}${t.fumble ? " (FUMBLE)" : ""} for ${t.dmg}. Your HP: ${t.playerHP}`);
      }
    }

    if (payload.combat.fled) {
      addLog(`Enemy fled!`, true);
    }
    addLog(`Winner: ${payload.combat.winnerName}`, true);
  }

  // Update stats after resolution
  const state = game.getState();
  renderPlayer(state.player);

  if (payload.runEnded) {
    addLog("☠ Run ended. Click Start Run to play again.", true);
    setChoicesVisible(false);
  } else {
    // Automatically go to the next encounter after resolving
    addLog("—", true);
    const next = game.nextEncounter();
    renderEncounterPayload(next);
  }
}

// ---------- Command handling ----------
function handleCommand(raw) {
  const cmd = raw.trim();
  if (!cmd) return;

  addLog(`> ${cmd}`, true);

  const lower = cmd.toLowerCase();

  if (lower === "help") {
    addLog("Commands: start, stats, areas, travel <roads|chapel|marsh>, reset");
    return;
  }

  if (lower === "start") {
    clearLog();
    addLog("Starting new run…", true);
    const payload = game.startRun({ nameInput: "", classChoice: 3, areaKey: "roads" });
    renderEncounterPayload(payload);
    return;
  }

  if (lower === "stats") {
    const s = game.getState();
    addLog(`Stats: HP ${s.player?.HP ?? "—"} | AC ${s.player?.AC ?? "—"} | STR ${s.player?.STR ?? "—"} | INT ${s.player?.INT ?? "—"} | CHA ${s.player?.CHA ?? "—"}`, true);
    return;
  }

  if (lower === "areas") {
    const areas = game.listAreas();
    addLog("Areas: " + areas.map(a => a.key).join(", "));
    return;
  }

  if (lower.startsWith("travel ")) {
    const key = lower.split(/\s+/)[1];
    try {
      const payload = game.travelTo(key);
      renderEncounterPayload(payload);
    } catch (e) {
      addLog(`Unknown area: ${key}. Try: roads, chapel, marsh`);
    }
    return;
  }

  if (lower === "reset") {
    game.reset();
    clearLog();
    renderPlayer(null);
    renderLocation(null);
    setText("hud-encounters", "0");
    setChoicesVisible(false);
    addLog("Reset complete. Type “start” to begin.", true);
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

  // Choice buttons
  $("choice-1")?.addEventListener("click", () => {
    try {
      const payload = game.pickChoice(1);
      renderResolutionPayload(payload);
    } catch (e) {
      addLog("No active encounter. Type 'start'.", true);
    }
  });

  $("choice-2")?.addEventListener("click", () => {
    try {
      const payload = game.pickChoice(2);
      renderResolutionPayload(payload);
    } catch (e) {
      addLog("No active encounter. Type 'start'.", true);
    }
  });

  // Initial UI defaults
  renderPlayer(null);
  renderLocation(null);
  setChoicesVisible(false);
});
