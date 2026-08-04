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
 * Item types whose manaCostReductions/apCostReductions entries can
 * discount an actor's mana/AP cost for a specific magic school.
 */
const COST_REDUCTION_ITEM_TYPES = ['talent', 'class', 'species', 'item', 'armor', 'weapon'];

/**
 * The magicSchool/combinedSchool/systemlessCategory key that identifies a
 * spell's "school" regardless of its spellType, for cost-reduction lookups.
 * @param {object} spellSystem
 * @return {string}
 */
export function getSpellSchool(spellSystem) {
  if (spellSystem.spellType === 'simple' || spellSystem.spellType === 'advanced') return spellSystem.magicSchool;
  if (spellSystem.spellType === 'combined') return spellSystem.combinedSchool;
  return spellSystem.systemlessCategory;
}

/**
 * Whether a spell currently qualifies for the "prerequisites met" discount
 * bucket (as opposed to being uncastable, or - Simple/Advanced only -
 * castable purely via the level-shortfall leeway, which gets a surcharge
 * instead of a discount - see computeSpellManaCost). Mastered spells and
 * Systemless spells (which have no prerequisite at all) always qualify.
 * @param {object} spellSystem
 * @param {Actor} actor
 * @return {boolean}
 */
function isSpellDiscountEligible(spellSystem, actor) {
  if (spellSystem.spellType === 'simple' || spellSystem.spellType === 'advanced') {
    return checkSimpleOrAdvancedSpellPrerequisite(spellSystem, actor).diff === 0;
  }
  if (spellSystem.spellType === 'combined') {
    return checkCombinedSpellPrerequisite(spellSystem, actor).castable;
  }
  return true;
}

/**
 * Sum every manaCostReductions entry across the actor's Talent/Class/
 * Species/Item/Armor/Weapon items that match a specific spellType+school
 * (e.g. combined/necromancy) - percent reductions add together, as do flat
 * ones (each flat entry's formula supports "L" for the actor's level).
 * allowBelowOne is true if ANY matching entry has that switch enabled.
 * @param {Actor} actor
 * @param {string} spellType   "simple" | "advanced" | "combined" | "systemless".
 * @param {string} school      The matching magicSchool/combinedSchool/systemlessCategory key.
 * @return {{percent: number, flat: number, allowBelowOne: boolean}}
 */
function getManaCostReduction(actor, spellType, school) {
  let percent = 0;
  let flat = 0;
  let allowBelowOne = false;
  const rollData = actor.getRollData();

  for (const item of actor.items) {
    if (!COST_REDUCTION_ITEM_TYPES.includes(item.type)) continue;
    for (const entry of item.system.manaCostReductions ?? []) {
      if (entry.spellType !== spellType || entry.school !== school) continue;
      percent += entry.percent ?? 0;
      flat += evaluateSkillFormula(entry.flatFormula, rollData);
      if (entry.allowBelowOne) allowBelowOne = true;
    }
  }

  return { percent, flat, allowBelowOne };
}

/**
 * Sum every apCostReductions entry across the actor's Talent/Class/
 * Species/Item/Armor/Weapon items that match a specific spellType+school -
 * each entry's flatFormula supports "L" for the actor's level.
 * @param {Actor} actor
 * @param {string} spellType
 * @param {string} school
 * @return {number}
 */
function getApCostReduction(actor, spellType, school) {
  let flat = 0;
  const rollData = actor.getRollData();

  for (const item of actor.items) {
    if (!COST_REDUCTION_ITEM_TYPES.includes(item.type)) continue;
    for (const entry of item.system.apCostReductions ?? []) {
      if (entry.spellType !== spellType || entry.school !== school) continue;
      flat += evaluateSkillFormula(entry.flatFormula, rollData);
    }
  }

  return flat;
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
 * How many hours a "Ritual" casting-method spell counts as having taken,
 * for Ritualism's own "hours spent" FP (see helpers/skillFp.mjs -
 * grantSkillUsageFp(actor, 'ritualism', 'ritualHour', ...), called once the
 * spell actually resolves - see helpers/spell-rolls.mjs#
 * renderSpellEffectParts). Always at least 1 hour, even for the plain "ap"
 * unit (no explicit time at all) or a "minutes" value under 60 - per the
 * design, a Ritual is never worth less than an hour's FP. Chant Shortening/
 * apCostReductions never apply here - those are flat AP discounts, not
 * meaningful against a time unit.
 * @param {object} spellSystem
 * @return {number}
 */
export function computeRitualHours(spellSystem) {
  const value = spellSystem.apCost ?? 1;
  switch (spellSystem.apCostUnit) {
    case 'minutes': return Math.max(1, Math.ceil(value / 60));
    case 'hours': return Math.max(1, value);
    case 'days': return Math.max(1, value * 24);
    default: return 1; // 'ap' - no explicit time, always the 1-hour floor.
  }
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
 *   Weapon manaCostReductions grant for that school always applies - flat
 *   first, then percent (e.g. a base cost of 10 with a flat -4 and a 50%
 *   discount becomes (10-4)*0.5 = 3, not (10*0.5)-4 = 1).
 * The result is always rounded down and floored at 1 - unless a flat
 * reduction that actually applied has its allowBelowOne switch on, in
 * which case it can go as low as 0 (never negative).
 * Only meaningful once the spell is owned by an actor - a template item
 * has no caster to derive skill levels from.
 * @param {object} spellSystem   A spell's system data.
 * @param {Actor} actor          The would-be caster.
 * @return {{cost: number, increased: boolean}}   increased is true only
 *   when the level-shortfall surcharge applied (regardless of whether
 *   other discounts brought the final number back below the base cost) -
 *   the UI uses it to flag the cost in red.
 */
export function computeSpellManaCost(spellSystem, actor) {
  let cost = spellSystem.manaCost ?? 0;
  let discountPercent = 0;
  let increased = false;

  if (spellSystem.spellType === 'simple' || spellSystem.spellType === 'advanced') {
    const { diff } = checkSimpleOrAdvancedSpellPrerequisite(spellSystem, actor);
    if (diff > 0) {
      cost *= 1 + diff;
      increased = true;
    }
  }
  if (!increased && isSpellDiscountEligible(spellSystem, actor)) {
    discountPercent = computeMagicControlOrRitualismDiscountPercent(spellSystem, actor);
  }

  const school = getSpellSchool(spellSystem);
  const { percent: grantedPercent, flat: grantedFlat, allowBelowOne } =
    getManaCostReduction(actor, spellSystem.spellType, school);
  const totalPercent = Math.min(100, discountPercent + grantedPercent);

  // Flat reductions apply first, then percentage ones.
  cost = (cost - grantedFlat) * (1 - totalPercent / 100);
  cost = Math.floor(cost);
  cost = allowBelowOne ? Math.max(0, cost) : Math.max(1, cost);

  return { cost, increased };
}

/**
 * Compute the actual AP cost an actor pays to cast a spell. AP costs can
 * only ever be reduced (never increased): a spell must be Mastered or have
 * its prerequisites met/overridden (see isSpellDiscountEligible - the same
 * condition gating the Magic Control/Ritualism mana discount) for any
 * reduction to apply at all. When it does:
 * - Every matching Talent/Class/Species/Item/Armor/Weapon apCostReductions
 *   grant for that school applies first (flat, "L" supported).
 * - The caster's Chant Shortening skill level then reduces it further, but
 *   only while the cost is still above 2 - Chant Shortening alone can never
 *   push it below 2 (so it can only ever reach 1 if the earlier flat
 *   reductions already got it there first).
 * AP cost is never allowed below 1, from any combination of sources.
 * @param {object} spellSystem
 * @param {Actor} actor
 * @return {number}
 */
export function computeSpellApCost(spellSystem, actor) {
  let apCost = spellSystem.apCost ?? 1;

  if (isSpellDiscountEligible(spellSystem, actor)) {
    const school = getSpellSchool(spellSystem);
    apCost -= getApCostReduction(actor, spellSystem.spellType, school);

    if (apCost > 2) {
      const chantShorteningLevel = getActorSkillLevel(actor, 'chantShortening');
      apCost = Math.max(2, apCost - chantShorteningLevel);
    }
  }

  return Math.max(1, Math.floor(apCost));
}
