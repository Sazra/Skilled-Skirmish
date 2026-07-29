import { getActorSkillLevel } from './skills.mjs';

/**
 * An actor's maximum Action Points - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites
 * system.actionPoints.max with this every time). A base of 3, +1 per
 * Reflexes skill level up to and including level 3 (so at most +3), plus a
 * flat, Active-Effect-driven bonus (system.actionPoints.bonus).
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxActionPoints(actor) {
  const reflexesLevel = getActorSkillLevel(actor, 'reflexes');
  const bonus = actor.system.actionPoints?.bonus ?? 0;
  return Math.max(0, Math.round(3 + Math.min(reflexesLevel, 3) + bonus));
}

/**
 * An actor's maximum Reaction Points - no longer directly user-editable
 * (see data/actor-base.mjs#prepareDerivedData, which overwrites
 * system.reactionPoints.max with this every time). A base of 1, plus 1 per
 * every 2 points of (already computed) max Action Points, rounded down,
 * plus 1 per Reflexes skill level beyond the 3rd (so at most +2, since
 * Reflexes only goes up to level 5), plus a flat, Active-Effect-driven
 * bonus (system.reactionPoints.bonus).
 * @param {Actor} actor
 * @return {number}
 */
export function computeMaxReactionPoints(actor) {
  const reflexesLevel = getActorSkillLevel(actor, 'reflexes');
  const maxActionPoints = computeMaxActionPoints(actor);
  const bonus = actor.system.reactionPoints?.bonus ?? 0;
  return Math.max(0, Math.round(1 + Math.floor(maxActionPoints / 2) + Math.max(0, reflexesLevel - 3) + bonus));
}
