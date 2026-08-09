import { getActorSkillLevel, isActorSkillUnlocked, getSkillLabel } from './skills.mjs';

/**
 * Sum of the Aura value granted by every Species item (main and sub) an
 * actor holds - see data/species.mjs#aura. Written back to
 * system.attributes.aur.rawValue whenever a Species item is added (see
 * sksk.mjs's "createItem" hook), rather than recomputed on every data
 * preparation, since Aura otherwise stays a normal user-editable attribute.
 * @param {Actor} actor
 * @return {number}
 */
export function computeSpeciesAura(actor) {
  return actor.items
    .filter(i => i.type === 'species')
    .reduce((sum, i) => sum + (i.system.aura ?? 0), 0);
}

/**
 * The bonus a single attribute's own roll gets from the "Verbessert X"
 * skills (CONFIG.SKSK.skills.attribute/special) - these have no skill
 * check of their own (see helpers/skillRolls.mjs#getSkillCheckDefinition),
 * but instead improve that one attribute's "reiner" roll directly, not any
 * skill check that merely uses the attribute as one of its modifiers:
 * - Each "Unbegrenzte X" skill (CONFIG.SKSK.unlimitedAttributeSkills) adds
 *   its own level to that one attribute only.
 * - Corpus Immortalis ("Verbessert alle Attribute") adds its own level to
 *   every attribute at once, the same way.
 * - Umlimitiert ("Verbessert alle Attributswürfe um 2") is binary, not
 *   levelled - a flat +2 to every attribute at once while active.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {number}
 */
export function computeUnlimitedAttributeBonus(actor, attributeKey) {
  let bonus = 0;

  const perAttributeSkill = CONFIG.SKSK.unlimitedAttributeSkills[attributeKey];
  if (perAttributeSkill) bonus += getActorSkillLevel(actor, perAttributeSkill);

  bonus += getActorSkillLevel(actor, 'corpusImmortalis');

  if (isActorSkillUnlocked(actor, 'unlimited')) bonus += 2;

  return bonus;
}

/**
 * An attribute's natural maximum score, before any Species/Class/Talent
 * adjustment: 20 + 1 per level of its own "Unbegrenzte X" skill + 5 if
 * Umlimitiert is active. Deliberately does NOT include Corpus Immortalis
 * (unlike computeUnlimitedAttributeBonus's roll bonus above) - the design
 * sheet's max-increase formula only names the per-attribute skill and
 * Umlimitiert.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {number}
 */
export function computeAttributeNaturalMax(actor, attributeKey) {
  let max = 20;

  const perAttributeSkill = CONFIG.SKSK.unlimitedAttributeSkills[attributeKey];
  if (perAttributeSkill) max += getActorSkillLevel(actor, perAttributeSkill);

  if (isActorSkillUnlocked(actor, 'unlimited')) max += 5;

  return max;
}

/**
 * An attribute's effective maximum score: computeAttributeNaturalMax,
 * adjusted by every Species/Class/Talent item's attributeMaxModifiers
 * entry for this attribute - every add/subtract entry across all matching
 * items applies first, then every multiply/divide entry scales the
 * result (mirrors computeSpellManaCost's flat-then-percent order).
 * Floored to whole numbers and never allowed below 1.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {number}
 */
export function computeAttributeMax(actor, attributeKey) {
  let max = computeAttributeNaturalMax(actor, attributeKey);

  const modifiers = [];
  for (const item of actor.items) {
    if (!['species', 'class', 'talent'].includes(item.type)) continue;
    for (const entry of item.system.attributeMaxModifiers ?? []) {
      if (entry.attribute === attributeKey) modifiers.push(entry);
    }
  }

  for (const mod of modifiers) {
    if (mod.operation === 'add') max += mod.value;
    else if (mod.operation === 'subtract') max -= mod.value;
  }
  for (const mod of modifiers) {
    if (mod.operation === 'multiply') max *= mod.value;
    else if (mod.operation === 'divide' && mod.value) max /= mod.value;
  }

  return Math.max(1, Math.floor(max));
}

/**
 * Formula breakdown for computeUnlimitedAttributeBonus - see
 * helpers/tooltips.mjs#renderBreakdownHtml, shown on hover over the
 * attribute in attributes.hbs rather than inline.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {{rows: Array, total: number}}
 */
export function getAttributeUnlimitedBonusBreakdown(actor, attributeKey) {
  const rows = [];

  const perAttributeSkill = CONFIG.SKSK.unlimitedAttributeSkills[attributeKey];
  if (perAttributeSkill) {
    const level = getActorSkillLevel(actor, perAttributeSkill);
    if (level) rows.push({ label: game.i18n.localize(getSkillLabel(perAttributeSkill)), perLevel: null, value: level });
  }

  const corpusLevel = getActorSkillLevel(actor, 'corpusImmortalis');
  if (corpusLevel) {
    rows.push({ label: game.i18n.localize(getSkillLabel('corpusImmortalis')), perLevel: null, value: corpusLevel });
  }

  if (isActorSkillUnlocked(actor, 'unlimited')) {
    rows.push({ label: game.i18n.localize(getSkillLabel('unlimited')), perLevel: null, value: 2 });
  }

  return { rows, total: computeUnlimitedAttributeBonus(actor, attributeKey) };
}

/**
 * Formula breakdown for computeAttributeMax - see helpers/tooltips.mjs#
 * renderBreakdownHtml, shown on hover over the attribute in attributes.hbs
 * rather than inline. Species/Class/Talent modifier rows show their own
 * operation as a signed/prefixed string (e.g. "+3", "×2") since a bare
 * number would misread a multiply/divide entry as a flat addition.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {{rows: Array, total: number}}
 */
export function getAttributeMaxBreakdown(actor, attributeKey) {
  const rows = [{ label: game.i18n.localize('SKSK.Breakdown.NaturalBase'), perLevel: null, value: 20 }];

  const perAttributeSkill = CONFIG.SKSK.unlimitedAttributeSkills[attributeKey];
  if (perAttributeSkill) {
    const level = getActorSkillLevel(actor, perAttributeSkill);
    if (level) rows.push({ label: game.i18n.localize(getSkillLabel(perAttributeSkill)), perLevel: null, value: level });
  }

  if (isActorSkillUnlocked(actor, 'unlimited')) {
    rows.push({ label: game.i18n.localize(getSkillLabel('unlimited')), perLevel: null, value: 5 });
  }

  const operationPrefixes = { add: '+', subtract: '-', multiply: '×', divide: '÷' };
  for (const item of actor.items) {
    if (!['species', 'class', 'talent'].includes(item.type)) continue;
    for (const entry of item.system.attributeMaxModifiers ?? []) {
      if (entry.attribute !== attributeKey) continue;
      const prefix = operationPrefixes[entry.operation] ?? '';
      rows.push({ label: item.name, perLevel: null, value: `${prefix}${entry.value}` });
    }
  }

  return { rows, total: computeAttributeMax(actor, attributeKey) };
}

/**
 * Passive Perception, shown as a clickable field in the sheet header (see
 * sheets/actor-sheet.mjs#_prepareGeneral) - the raw Perception attribute
 * value plus half the actor's Observation skill level, rounded down.
 * Clicking it grants Observation's own "passiveDetection" FP (see
 * sheets/actor-sheet.mjs#_grantPassivePerceptionFp).
 * @param {Actor} actor
 * @return {number}
 */
export function computePassivePerception(actor) {
  const perceptionValue = actor.system.attributes?.per?.value ?? 0;
  return perceptionValue + Math.floor(getActorSkillLevel(actor, 'observation') / 2);
}
