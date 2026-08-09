import { getActorSkillLevel } from './skills.mjs';

/**
 * Totem's own list-slot count: the Totem skill's own level, adjusted by the
 * GM tab's totemSlotsBonus (added first) then totemSlotsMultiplier (applied
 * after) - floored, never negative. See data/actor-base.mjs#
 * totemSlotsBonus/totemSlotsMultiplier.
 * @param {Actor} actor
 * @return {number}
 */
export function computeTotemSlots(actor) {
  const level = getActorSkillLevel(actor, 'totem');
  const bonus = actor.system.totemSlotsBonus ?? 0;
  const multiplier = actor.system.totemSlotsMultiplier ?? 1;
  return Math.max(0, Math.floor((level + bonus) * multiplier));
}

/**
 * The actor's totems list, resized (padded with empty entries, or
 * truncated) to its current slot count - a pure read, doesn't persist
 * anything itself. apps/totem-dialog.mjs writes the resized array back on
 * every row action, so index-based updates always stay valid even after
 * the Totem skill's level or its GM-tab adjustments change.
 * @param {Actor} actor
 * @return {Array<{name: string, bound: boolean, active: boolean,
 *   effectId: string, manaCostPerRound: number}>}
 */
export function getResizedTotems(actor) {
  const slots = computeTotemSlots(actor);
  const current = actor.system.totems ?? [];
  const resized = current.slice(0, slots).map(entry => ({ ...entry }));
  while (resized.length < slots) {
    resized.push({ name: '', bound: false, active: false, effectId: '', manaCostPerRound: 0 });
  }
  return resized;
}
