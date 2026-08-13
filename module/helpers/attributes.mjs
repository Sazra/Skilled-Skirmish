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
 * Base-tier attribute bonus (see data/actor-base.mjs#prepareDerivedData) -
 * a genuine, permanent stat increase, folded straight into "baseValue" the
 * same as an NPC's dynamic skill-threshold bonus, unlike
 * computeUnlimitedAttributeBonus's roll-only bonus above. Two sources:
 * every Species/Talent item's own attributeBonuses entries (data/species.mjs,
 * data/talent.mjs - Class has no such field; a Talent's own list uses the
 * full attribute choice list, unlike Species which excludes Aura - it
 * already has its own dedicated "aura" field, so this can affect Aura too),
 * plus system.attributeBonuses.<key>.base - written only by custom Status
 * Effects' own baseAttributeBonuses rows (see helpers/statusEffects.mjs#
 * buildStatModifierChanges), a real per-stack Active Effect change.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {number}
 */
export function computeBaseAttributeBonus(actor, attributeKey) {
  let bonus = actor.system.attributeBonuses?.[attributeKey]?.base ?? 0;
  for (const item of actor.items) {
    if (!['species', 'talent'].includes(item.type)) continue;
    for (const entry of item.system.attributeBonuses ?? []) {
      if (entry.attribute === attributeKey) bonus += entry.bonus ?? 0;
    }
  }
  return bonus;
}

/**
 * Formula breakdown for computeBaseAttributeBonus - see helpers/tooltips.mjs
 * #renderBreakdownHtml, shown on hover over the attribute in attributes.hbs.
 * The Status-Effect-sourced portion has no per-source itemization available
 * (it's a plain Active-Effect-summed number), so it's shown as one
 * "flatBonus" line, the same convention Life/Mana/AC/MR's own breakdowns
 * already use for their Effects-tab contributions.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {{rows: Array, flatBonus: number, total: number}}
 */
export function getAttributeBaseBonusBreakdown(actor, attributeKey) {
  const rows = [];
  for (const item of actor.items) {
    if (!['species', 'talent'].includes(item.type)) continue;
    for (const entry of item.system.attributeBonuses ?? []) {
      if (entry.attribute !== attributeKey || !entry.bonus) continue;
      rows.push({ label: item.name, perLevel: null, value: entry.bonus });
    }
  }
  const flatBonus = actor.system.attributeBonuses?.[attributeKey]?.base ?? 0;
  return { rows, flatBonus, total: computeBaseAttributeBonus(actor, attributeKey) };
}

/**
 * Spezial-tier attribute bonus (see data/actor-base.mjs#prepareDerivedData)
 * - folds into "value" (so it reaches AC/MR) but never into "baseValue", so
 * it never inflates a resource max (Life/Mana/AP/RP/Adrenalin/etc, which all
 * read baseValue/baseMod instead). Delivered entirely via real Active
 * Effects: Item/Armor/Weapon/Technique/Spell's own native "Effects" tab, or
 * a custom Status Effect's specialAttributeBonuses rows (see
 * helpers/statusEffects.mjs#buildStatModifierChanges) - both just add into
 * system.attributeBonuses.<key>.special, so there's nothing left to sum
 * here beyond reading that one field.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {number}
 */
export function computeSpecialAttributeBonus(actor, attributeKey) {
  return actor.system.attributeBonuses?.[attributeKey]?.special ?? 0;
}

/**
 * Formula breakdown for computeSpecialAttributeBonus - see
 * getAttributeBaseBonusBreakdown above for the "flatBonus, no itemization"
 * reasoning (identical here, since this tier is purely Active-Effect-driven).
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {{rows: Array, flatBonus: number, total: number}}
 */
export function getAttributeSpecialBonusBreakdown(actor, attributeKey) {
  const flatBonus = computeSpecialAttributeBonus(actor, attributeKey);
  return { rows: [], flatBonus, total: flatBonus };
}

/**
 * Modifikator-tier attribute bonus (see data/actor-base.mjs#
 * prepareDerivedData) - never touches baseValue/value at all, only added
 * directly onto "mod"/"modExcludingSpecial". Same delivery mechanism and
 * sources as computeSpecialAttributeBonus above, targeting
 * system.attributeBonuses.<key>.modifier instead.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {number}
 */
export function computeModifierAttributeBonus(actor, attributeKey) {
  return actor.system.attributeBonuses?.[attributeKey]?.modifier ?? 0;
}

/**
 * Formula breakdown for computeModifierAttributeBonus - see
 * getAttributeSpecialBonusBreakdown above.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {{rows: Array, flatBonus: number, total: number}}
 */
export function getAttributeModifierBonusBreakdown(actor, attributeKey) {
  const flatBonus = computeModifierAttributeBonus(actor, attributeKey);
  return { rows: [], flatBonus, total: flatBonus };
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
 * sheets/actor-sheet.mjs#_prepareGeneral) - the raw Perception attribute's
 * baseValue (Base-tier only - passive values exclude Spezial-Boni, see
 * data/actor-base.mjs#prepareDerivedData) plus half the actor's Observation
 * skill level, rounded down. Clicking it grants Observation's own
 * "passiveDetection" FP (see sheets/actor-sheet.mjs#_grantPassivePerceptionFp).
 * @param {Actor} actor
 * @return {number}
 */
export function computePassivePerception(actor) {
  const perceptionValue = actor.system.attributes?.per?.baseValue ?? 0;
  return perceptionValue + Math.floor(getActorSkillLevel(actor, 'observation') / 2);
}
