// =========================
// FILE: encounters.js
// (port of Encounter.py)
// =========================

import { weightedPick } from "./location.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

export const HOOKS = [
  "You hear",
  "You notice",
  "You stumble upon",
  "A traveler warns you about",
  "A sudden shout draws you toward",
];

export const COMPLICATIONS = [
  "and someone innocent is caught in the middle",
  "but the ground here is unstable",
  "and time is running out",
  "but the enemy is not what they seem",
  "and the weather turns nasty",
];

export const TWISTS = [
  "One of them recognizes your face.",
  "A hidden passage opens nearby.",
  "You spot fresh tracks leading away from the scene.",
  "The real threat is watching from a distance.",
  "Something valuable glints half-buried in the dirt.",
];

export const REWARDS = [
  "a small purse of coin",
  "a strange rune charm",
  "a healing draught",
  "a map fragment",
  "a sealed letter",
];

export function generateEncounter(area, world) {
  const enemyType = weightedPick(area.enemies);

  // rep seasoning
  const rep = world.rep ?? {};
  const bestRep = Math.max(...area.factions.map(f => rep[f] ?? 0), 0);
  const worstRep = Math.min(...area.factions.map(f => rep[f] ?? 0), 0);

  let repLine = "";
  if (bestRep >= 3) repLine = " Locals greet you like you belong here.";
  else if (worstRep <= -3) repLine = " You feel eyes on you—unfriendly ones.";

  const text =
    `${choice(HOOKS)} trouble near ${choice(area.landmarks)}. ` +
    `Rumor says ${choice(area.hooks)}. ` +
    `Signs point to ${enemyType.toLowerCase()} activity ${choice(COMPLICATIONS)}. ` +
    `${choice(TWISTS)}${repLine}`;

  return {
    text,
    enemy_type: enemyType,
    combat_bias: area.combat_bias,
    reward_hint: choice(REWARDS),
    area_key: area.key,
  };
}

export function generateChoices(area, encounter) {
  // Themed options by area key (same idea as your Python)
  let options;
  if (area.key === "chapel") {
    options = [
      ["Study the signs and interpret the omen.", "INT", 12],
      ["Speak a steady prayer and calm the moment.", "CHA", 11],
      ["Force your way past the obstruction.", "STR", 12],
    ];
  } else if (area.key === "roads") {
    options = [
      ["Stand tall and confront the threat.", "STR", 11],
      ["Talk fast and keep it civil.", "CHA", 12],
      ["Scan the scene for lies and angles.", "INT", 11],
    ];
  } else {
    options = [
      ["Move carefully and read the terrain.", "INT", 11],
      ["Hack through and push onward.", "STR", 12],
      ["Bluff with confidence and keep distance.", "CHA", 12],
    ];
  }

  // pick 2 distinct
  const i = randInt(0, options.length - 1);
  let j = randInt(0, options.length - 1);
  while (j === i) j = randInt(0, options.length - 1);

  function mk(text, stat, dc) {
    return {
      text,
      stat,
      dc,
      success: { [stat]: +1 },
      fail: { [stat]: -1 },
      success_msg: `You handle it cleanly—and spot ${encounter.reward_hint}.`,
      fail_msg: "It backfires and the situation escalates.",
    };
  }

  return [mk(...options[i]), mk(...options[j])];
}
