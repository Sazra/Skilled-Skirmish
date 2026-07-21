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

/**
 * Whether an actor can currently cast a given Simple or Advanced spell.
 * Mastered bypasses the check outright (treated as no shortfall at all).
 * Otherwise, if the actor's level in the spell's magic school falls short
 * of the spell's own level, the spell is still castable as long as the
 * shortfall is at most 3 - except for Advanced spells, which additionally
 * require the actor to have at least level 1 in that school to begin with
 * (a level 3 Space spell can't be attempted on Space 0, even though the
 * shortfall would otherwise be within the leeway).
 * @param {object} spellSystem   A simple/advanced spell's system data.
 * @param {Actor} actor
 * @return {{castable: boolean, diff: number, missingLabel: string}}
 */
export function checkSimpleOrAdvancedSpellPrerequisite(spellSystem, actor) {
  if (spellSystem.mastered) {
    return { castable: true, diff: 0, missingLabel: '' };
  }

  const required = spellSystem.spellLevel;
  const actual = getActorSkillLevel(actor, spellSystem.magicSchool);
  const diff = Math.max(0, required - actual);
  const missingLabel = diff > 0
    ? `${game.i18n.localize(getSkillLabel(spellSystem.magicSchool))} ${required}`
    : '';

  if (diff === 0) return { castable: true, diff, missingLabel };
  if (diff > 3) return { castable: false, diff, missingLabel };
  if (spellSystem.spellType === 'advanced' && actual < 1) return { castable: false, diff, missingLabel };
  return { castable: true, diff, missingLabel };
}

/**
 * Item types whose manaCostReductions entries can discount an actor's
 * mana cost for a specific magic school.
 */
const MANA_COST_REDUCTION_ITEM_TYPES = ['talent', 'class', 'species', 'item', 'armor', 'weapon'];

/**
 * Sum every manaCostReductions entry across the actor's Talent/Class/
 * Species/Item/Armor/Weapon items that match a specific spellType+school
 * (e.g. combined/necromancy) - percent reductions add together, as do flat
 * ones (each flat entry's formula supports "L" for the actor's level).
 * @param {Actor} actor
 * @param {string} spellType   "simple" | "advanced" | "combined" | "systemless".
 * @param {string} school      The matching magicSchool/combinedSchool/systemlessCategory key.
 * @return {{percent: number, flat: number}}
 */
function getManaCostReduction(actor, spellType, school) {
  let percent = 0;
  let flat = 0;
  const rollData = actor.getRollData();

  for (const item of actor.items) {
    if (!MANA_COST_REDUCTION_ITEM_TYPES.includes(item.type)) continue;
    for (const entry of item.system.manaCostReductions ?? []) {
      if (entry.spellType !== spellType || entry.school !== school) continue;
      percent += entry.percent ?? 0;
      flat += evaluateSkillFormula(entry.flatFormula, rollData);
    }
  }

  return { percent, flat };
}

/**
 * The percentage mana discount from a caster's Magic Control (non-Ritual
 * spells) or Ritualism (Ritual spells) skill level - 5% per level, capped
 * at 50% (Magic Control's max level 10) or 25% (Ritualism's max level 5).
 * @param {object} spellSystem
 * @param {Actor} actor
 * @return {number}
 */
function computeMagicControlOrRitualismDiscountPercent(spellSystem, actor) {
  const isRitual = !!spellSystem.castingMethods?.ritual;
  const level = getActorSkillLevel(actor, isRitual ? 'ritualism' : 'magicControl');
  const cap = isRitual ? 25 : 50;
  return Math.min(cap, level * 5);
}

/**
 * Compute the actual mana cost an actor pays to cast a spell, factoring in:
 * - Simple/Advanced spells cast short of their magic school's required
 *   level (see checkSimpleOrAdvancedSpellPrerequisite) cost +100% per
 *   level of shortfall instead of getting any discount below.
 * - Otherwise (Simple/Advanced met, or Combined actually castable, or any
 *   Systemless spell - which has no prerequisite at all) the cost is
 *   discounted by the caster's Magic Control/Ritualism skill (see above).
 * - On top of either, every matching Talent/Class/Species/Item/Armor/
 *   Weapon manaCostReductions grant for that school always applies.
 * Only meaningful once the spell is owned by an actor - a template item
 * has no caster to derive skill levels from.
 * @param {object} spellSystem   A spell's system data.
 * @param {Actor} actor          The would-be caster.
 * @return {number}
 */
export function computeSpellManaCost(spellSystem, actor) {
  let cost = spellSystem.manaCost ?? 0;
  let discountPercent = 0;
  let school;

  if (spellSystem.spellType === 'simple' || spellSystem.spellType === 'advanced') {
    school = spellSystem.magicSchool;
    const { diff } = checkSimpleOrAdvancedSpellPrerequisite(spellSystem, actor);
    if (diff > 0) {
      cost *= 1 + diff;
    } else {
      discountPercent = computeMagicControlOrRitualismDiscountPercent(spellSystem, actor);
    }
  } else if (spellSystem.spellType === 'combined') {
    school = spellSystem.combinedSchool;
    const { castable } = checkCombinedSpellPrerequisite(spellSystem, actor);
    if (castable) discountPercent = computeMagicControlOrRitualismDiscountPercent(spellSystem, actor);
  } else {
    school = spellSystem.systemlessCategory;
    discountPercent = computeMagicControlOrRitualismDiscountPercent(spellSystem, actor);
  }

  const { percent: grantedPercent, flat: grantedFlat } = getManaCostReduction(actor, spellSystem.spellType, school);
  const totalPercent = Math.min(100, discountPercent + grantedPercent);
  cost = cost * (1 - totalPercent / 100) - grantedFlat;

  return Math.max(0, Math.round(cost));
}
