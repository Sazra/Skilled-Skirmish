/**
 * Beschwörung's (Summoning) own list-slot count: the Willpower modifier,
 * adjusted by the GM tab's summonSlotsBonus (added first) then
 * summonSlotsMultiplier (applied after) - floored, never negative. See
 * data/actor-base.mjs#summonSlotsBonus/summonSlotsMultiplier.
 * @param {Actor} actor
 * @return {number}
 */
export function computeSummonSlots(actor) {
  const wilMod = actor.system.attributes?.wil?.baseMod ?? 0;
  const bonus = actor.system.summonSlotsBonus ?? 0;
  const multiplier = actor.system.summonSlotsMultiplier ?? 1;
  return Math.max(0, Math.floor((wilMod + bonus) * multiplier));
}

/**
 * The actor's summons list, resized (padded with empty entries, or
 * truncated) to its current slot count - a pure read, doesn't persist
 * anything itself. apps/summoning-dialog.mjs writes the resized array back
 * on every row action, so index-based updates always stay valid even after
 * the Willpower modifier or its GM-tab adjustments change.
 * @param {Actor} actor
 * @return {Array<{name: string, level: number, summoned: boolean}>}
 */
export function getResizedSummons(actor) {
  const slots = computeSummonSlots(actor);
  const current = actor.system.summons ?? [];
  const resized = current.slice(0, slots).map(entry => ({ ...entry }));
  while (resized.length < slots) resized.push({ name: '', level: 1, summoned: false });
  return resized;
}

/**
 * How many of the actor's summon slots are currently active (summoned) -
 * used by helpers/rest.mjs#applyRest to scale Summoning's "summonExistenceDay"
 * FP grant on a qualifying Pause, one grant per active slot.
 * @param {Actor} actor
 * @return {number}
 */
export function countActiveSummons(actor) {
  return (actor.system.summons ?? []).filter(entry => entry.summoned).length;
}
