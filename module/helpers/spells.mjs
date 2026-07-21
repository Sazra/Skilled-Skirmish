import { evaluateBonusFormula, evaluateSkillFormula, getActorSkillLevel, getSkillLabel } from './skills.mjs';

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

/**
 * Item types whose combinedSchoolOverrides entries can grant an actor
 * casting access to a combined magic school.
 */
const COMBINED_SCHOOL_OVERRIDE_ITEM_TYPES = ['class', 'species', 'talent'];

/**
 * Compute a single combinedSchoolOverride entry's granted max level for a
 * given caster: its base (baseFormula, where "L" stands for the actor's
 * level) plus every attribute- and skill-based bonus, scaled the same way
 * a saving throw's bonuses are. Only this one entry's value - see
 * getCombinedSchoolOverrideLevel for the actor-wide max across every item.
 * @param {object} override   An entry from a Class/Species/Talent's
 *                             combinedSchoolOverrides.
 * @param {Actor} actor        The actor this override belongs to.
 * @return {number}
 */
export function computeCombinedSchoolOverrideLevel(override, actor) {
  const base = evaluateSkillFormula(override.baseFormula, actor.getRollData());
  return base + sumBonuses(override.attributeBonuses, override.skillBonuses, actor);
}

/**
 * The highest spell level an actor is granted permission to cast in a given
 * combined magic school, bypassing that school's spells' own combinedSkills
 * prerequisite entirely - e.g. a Priest of Light casting Miracles up to
 * their Light skill's level, regardless of what any individual Miracle
 * spell's own combinedSkills demands. Every matching override across every
 * Class/Species/Talent item on the actor is evaluated; the actor gets the
 * highest of them.
 * @param {Actor} actor
 * @param {string} combinedSchool   A key from CONFIG.SKSK.combinedMagicSchools.
 * @return {number|null}   The granted max level, or null if nothing grants one.
 */
export function getCombinedSchoolOverrideLevel(actor, combinedSchool) {
  let best = null;
  for (const item of actor.items) {
    if (!COMBINED_SCHOOL_OVERRIDE_ITEM_TYPES.includes(item.type)) continue;
    for (const override of item.system.combinedSchoolOverrides ?? []) {
      if (override.combinedSchool !== combinedSchool) continue;
      const level = computeCombinedSchoolOverrideLevel(override, actor);
      if (best === null || level > best) best = level;
    }
  }
  return best;
}

/**
 * Whether an actor can currently cast a given combined spell: a Mastered
 * spell bypasses every prerequisite outright; otherwise either some
 * override grants that school's casting up to (at least) the spell's own
 * level, or the spell's own combinedSkills requirement is fully met (every
 * listed skill at least at its required level). A spell with no
 * combinedSkills entries at all has no prerequisite either way.
 * @param {object} spellSystem   A combined spell's system data.
 * @param {Actor} actor
 * @return {{castable: boolean, overrideLevel: number|null, missingLabel: string}}
 */
export function checkCombinedSpellPrerequisite(spellSystem, actor) {
  if (spellSystem.mastered) {
    return { castable: true, overrideLevel: null, missingLabel: '' };
  }

  const overrideLevel = getCombinedSchoolOverrideLevel(actor, spellSystem.combinedSchool);
  if (overrideLevel !== null && spellSystem.spellLevel <= overrideLevel) {
    return { castable: true, overrideLevel, missingLabel: '' };
  }

  const missing = (spellSystem.combinedSkills ?? []).filter(
    entry => getActorSkillLevel(actor, entry.skill) < entry.level
  );
  const missingLabel = missing
    .map(entry => `${game.i18n.localize(getSkillLabel(entry.skill))} ${entry.level}`)
    .join(', ');
  return { castable: missing.length === 0, overrideLevel, missingLabel };
}
