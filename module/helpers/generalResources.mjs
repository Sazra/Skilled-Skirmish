import { getActorSkillLevel } from './skills.mjs';

/**
 * Item types whose chargeBonuses entries can increase a general resource's
 * max charges (CONFIG.SKSK.chargeResources) - see SKSKSpecies/SKSKClass/
 * SKSKTalent#defineSchema.
 */
const CHARGE_BONUS_ITEM_TYPES = ['species', 'class', 'talent'];

/**
 * Every Species/Class/Talent chargeBonuses entry for one general resource,
 * summed up by kind: flat entries add up as plain amounts, multiplicative
 * ones as one combined percentage (several of them add together, same
 * convention as FP gain bonuses - see helpers/skillFp.mjs).
 * @param {Actor} actor
 * @param {string} resource   A CONFIG.SKSK.chargeResources key.
 * @return {{flat: number, percent: number}}
 */
function collectChargeBonuses(actor, resource) {
  let flat = 0;
  let percent = 0;
  for (const item of actor.items) {
    if (!CHARGE_BONUS_ITEM_TYPES.includes(item.type)) continue;
    for (const entry of item.system.chargeBonuses ?? []) {
      if (entry.resource !== resource) continue;
      if (entry.bonusType === 'multiplicative') percent += entry.bonus ?? 0;
      else flat += entry.bonus ?? 0;
    }
  }
  return { flat, percent };
}

/**
 * A resource's max charges: its base value plus every flat chargeBonuses
 * entry, then scaled by the combined multiplicative percentage (50 = +50%,
 * 100 = doubled), rounded to whole charges and never below 0.
 * @param {Actor} actor
 * @param {string} resource   A CONFIG.SKSK.chargeResources key.
 * @param {number} base       The resource's own base amount before any bonus.
 * @return {number}
 */
function computeMaxCharges(actor, resource, base) {
  const { flat, percent } = collectChargeBonuses(actor, resource);
  return Math.max(0, Math.round((base + flat) * (1 + percent / 100)));
}

/**
 * An actor's maximum Meditation charges - no longer directly user-editable
 * (see data/actor-base.mjs#prepareDerivedData, which overwrites
 * system.meditationCharges.max with this every time). Every creature has
 * charges equal to its level, plus any Species/Class/Talent chargeBonuses.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxMeditationCharges(actor) {
  const level = actor.system.resources.level.value;
  return computeMaxCharges(actor, 'meditation', level);
}

/**
 * An actor's maximum Regeneration charges - same shape as Meditation above.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxRegenerationCharges(actor) {
  const level = actor.system.resources.level.value;
  return computeMaxCharges(actor, 'regeneration', level);
}

/**
 * An actor's maximum Inspiration charges - 0 (locked) until the Inspiration
 * skill reaches level 1; from then on, that skill's level plus the
 * Charisma modifier, plus any Species/Class/Talent chargeBonuses.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxInspirationCharges(actor) {
  const skillLevel = getActorSkillLevel(actor, 'inspiration');
  if (skillLevel < 1) return 0;
  const chaMod = actor.system.attributes?.cha?.baseMod ?? 0;
  return computeMaxCharges(actor, 'inspiration', skillLevel + chaMod);
}

/**
 * An actor's maximum Adrenalin charges - 0 (locked) until the Adrenalin
 * skill reaches level 1; from then on, that skill's level plus the
 * Constitution modifier, plus any Species/Class/Talent chargeBonuses.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxAdrenalinCharges(actor) {
  const skillLevel = getActorSkillLevel(actor, 'adrenalin');
  if (skillLevel < 1) return 0;
  const conMod = actor.system.attributes?.con?.baseMod ?? 0;
  return computeMaxCharges(actor, 'adrenalin', skillLevel + conMod);
}

/**
 * An actor's maximum Luck charges - 0 (locked) until the Luck skill reaches
 * level 1; from then on, that skill's level plus any Species/Class/Talent
 * chargeBonuses.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxLuckCharges(actor) {
  const skillLevel = getActorSkillLevel(actor, 'luck');
  if (skillLevel < 1) return 0;
  return computeMaxCharges(actor, 'luck', skillLevel);
}
