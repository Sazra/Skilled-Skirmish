import { getActorSkillLevel } from './skills.mjs';

/**
 * Item types whose chargeBonuses entries can increase a general resource's
 * max charges (CONFIG.SKSK.chargeResources) - see SKSKSpecies/SKSKClass/
 * SKSKTalent#defineSchema.
 */
const CHARGE_BONUS_ITEM_TYPES = ['species', 'class', 'talent'];

/**
 * The total flat bonus every Species/Class/Talent item grants to one
 * general resource's max charges.
 * @param {Actor} actor
 * @param {string} resource   A CONFIG.SKSK.chargeResources key.
 * @return {number}
 */
function computeChargeBonusTotal(actor, resource) {
  let total = 0;
  for (const item of actor.items) {
    if (!CHARGE_BONUS_ITEM_TYPES.includes(item.type)) continue;
    for (const entry of item.system.chargeBonuses ?? []) {
      if (entry.resource === resource) total += entry.bonus ?? 0;
    }
  }
  return total;
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
  return Math.max(0, Math.round(level + computeChargeBonusTotal(actor, 'meditation')));
}

/**
 * An actor's maximum Regeneration charges - same shape as Meditation above.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxRegenerationCharges(actor) {
  const level = actor.system.resources.level.value;
  return Math.max(0, Math.round(level + computeChargeBonusTotal(actor, 'regeneration')));
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
  const chaMod = actor.system.attributes?.cha?.mod ?? 0;
  return Math.max(0, Math.round(skillLevel + chaMod + computeChargeBonusTotal(actor, 'inspiration')));
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
  const conMod = actor.system.attributes?.con?.mod ?? 0;
  return Math.max(0, Math.round(skillLevel + conMod + computeChargeBonusTotal(actor, 'adrenalin')));
}

/**
 * An actor's maximum Luck charges - 0 (locked) until the Luck skill reaches
 * level 1; from then on, simply the actor's level. Unlike the other four
 * general resources, this one can't be increased by anything.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxLuckCharges(actor) {
  const skillLevel = getActorSkillLevel(actor, 'luck');
  if (skillLevel < 1) return 0;
  return Math.max(0, Math.round(actor.system.resources.level.value));
}
