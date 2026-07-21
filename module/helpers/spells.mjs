import { evaluateBonusFormula, getActorSkillLevel } from './skills.mjs';

/**
 * Sum a set of attribute- and skill-based bonuses for a given caster, each
 * independently scaled by its own formula (where "@value" is the chosen
 * attribute's value/modifier, or the chosen skill's current level). Shared
 * by saving throws (added to a flat base) and damage (added to a rolled
 * formula) - the bonus shape and scaling rules are identical either way.
 * @param {Array<object>} attributeBonuses
 * @param {Array<object>} skillBonuses
 * @param {Actor} actor
 * @return {number}
 */
function sumBonuses(attributeBonuses, skillBonuses, actor) {
  let total = 0;

  for (const entry of attributeBonuses ?? []) {
    const attribute = actor.system.attributes?.[entry.attribute];
    if (!attribute) continue;
    const raw = entry.useModifier ? attribute.mod : attribute.value;
    total += evaluateBonusFormula(entry.formula, raw);
  }

  for (const entry of skillBonuses ?? []) {
    const level = getActorSkillLevel(actor, entry.skill);
    total += evaluateBonusFormula(entry.formula, level);
  }

  return total;
}

/**
 * Compute a spell saving throw's total value for a given caster: its flat
 * base plus every attribute- and skill-based bonus.
 * @param {object} savingThrow   An entry from SKSKSpell#savingThrows.
 * @param {Actor} actor          The actor casting the spell.
 * @return {number}
 */
export function computeSavingThrowValue(savingThrow, actor) {
  return (savingThrow.baseValue ?? 0) + sumBonuses(savingThrow.attributeBonuses, savingThrow.skillBonuses, actor);
}

/**
 * Compute a damage entry's total scaling bonus for a given caster - the
 * flat number to add to the damage formula's own roll once actual damage
 * rolling is implemented.
 * @param {object} damage   An entry from SKSKSpell#damages.
 * @param {Actor} actor     The actor casting the spell.
 * @return {number}
 */
export function computeDamageBonus(damage, actor) {
  return sumBonuses(damage.attributeBonuses, damage.skillBonuses, actor);
}
