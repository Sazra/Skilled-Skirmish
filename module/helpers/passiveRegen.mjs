import {
  getStatusEffectDefinitions, getStatusStacks, applyLifeChange,
} from './statusEffects.mjs';
import { getElementalLifeChargeHeal, getElementalNatureManaGen } from './elementalChargeEffects.mjs';

/**
 * Life/Mana regeneration of the effects that heal at the start of the
 * actor's own Combat turn, counted OUTSIDE of Combat too - but less often:
 * - once per 10 minutes: custom status effects with a Life/Mana gain per
 *   stack (data: Status Effects settings) and the Active Effect target
 *   system.manaRegenTurnStart.
 * - once per full minute: the Elementarladungen's own heals (Lebensmagie
 *   Life, Naturmagie Mana, see helpers/elementalChargeEffects.mjs).
 *
 * With Calendaria the world time passing drives it (helpers/
 * calendarIntegration.mjs); without it the time of a Pause counts instead
 * (helpers/rest.mjs#applyRest). Inside Combat the normal turn-start handlers
 * (helpers/statusEffects.mjs#handleCombatTurnStart) apply them.
 */

/** Seconds per "10 minutes" tick / per "minute" tick. */
export const TEN_MINUTE_SECONDS = 600;
export const MINUTE_SECONDS = 60;

/**
 * What one tick of each cadence gives an actor.
 * @param {Actor} actor
 * @return {{tenMinute: {life: number, mana: number}, minute: {life: number, mana: number}}}
 */
export function collectRegenSources(actor) {
  let tenLife = 0;
  let tenMana = 0;
  for (const def of getStatusEffectDefinitions()) {
    if (def.predefined) continue;
    const stacks = getStatusStacks(actor, def.id);
    if (stacks <= 0) continue;
    tenLife += Math.max(0, (Number(def.lifeChangePerStack) || 0) * stacks);
    tenMana += Math.max(0, (Number(def.manaChangePerStack) || 0) * stacks);
  }
  tenMana += Math.max(0, actor.system.manaRegenTurnStart ?? 0);
  return {
    tenMinute: { life: tenLife, mana: tenMana },
    minute: { life: getElementalLifeChargeHeal(actor), mana: getElementalNatureManaGen(actor) },
  };
}

/**
 * Whether an actor has anything that would regenerate outside of Combat.
 * @param {Actor} actor
 * @return {boolean}
 */
export function hasPassiveRegen(actor) {
  const { tenMinute, minute } = collectRegenSources(actor);
  return tenMinute.life > 0 || tenMinute.mana > 0 || minute.life > 0 || minute.mana > 0;
}

/**
 * Apply the regeneration of the given number of ticks at once.
 * @param {Actor} actor
 * @param {{tenMinuteTicks?: number, minuteTicks?: number}} ticks
 * @return {Promise<string[]>}   Description lines for what was regained.
 */
export async function applyElapsedRegen(actor, { tenMinuteTicks = 0, minuteTicks = 0 } = {}) {
  const { tenMinute, minute } = collectRegenSources(actor);
  const life = tenMinute.life * Math.max(0, tenMinuteTicks) + minute.life * Math.max(0, minuteTicks);
  const mana = tenMinute.mana * Math.max(0, tenMinuteTicks) + minute.mana * Math.max(0, minuteTicks);
  const lines = [];

  if (life > 0) {
    const { lifeDelta } = await applyLifeChange(actor, life);
    if (lifeDelta > 0) lines.push(game.i18n.format('SKSK.Regen.Life', { amount: lifeDelta }));
  }
  if (mana > 0) {
    const current = actor.system.mana;
    const newValue = Math.min(current.max, current.value + mana);
    if (newValue > current.value) {
      await actor.update({ 'system.mana.value': newValue });
      lines.push(game.i18n.format('SKSK.Regen.Mana', { amount: newValue - current.value }));
    }
  }
  return lines;
}
