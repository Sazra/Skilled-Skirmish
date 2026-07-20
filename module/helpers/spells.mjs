import { evaluateBonusFormula, getActorSkillLevel } from './skills.mjs';

/**
 * Compute a spell saving throw's total value for a given caster: its flat
 * base plus every attribute- and skill-based bonus, each independently
 * scaled by its own formula (where "@value" is the chosen attribute's
 * value/modifier, or the chosen skill's current level).
 * @param {object} savingThrow   An entry from SKSKSpell#savingThrows.
 * @param {Actor} actor          The actor casting the spell.
 * @return {number}
 */
export function computeSavingThrowValue(savingThrow, actor) {
  let total = savingThrow.baseValue ?? 0;

  for (const entry of savingThrow.attributeBonuses ?? []) {
    const attribute = actor.system.attributes?.[entry.attribute];
    if (!attribute) continue;
    const raw = entry.useModifier ? attribute.mod : attribute.value;
    total += evaluateBonusFormula(entry.formula, raw);
  }

  for (const entry of savingThrow.skillBonuses ?? []) {
    const level = getActorSkillLevel(actor, entry.skill);
    total += evaluateBonusFormula(entry.formula, level);
  }

  return total;
}
