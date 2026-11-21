import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';
import { addWoundValue, getStatusInstancesTotal, getStatusEffectDefinitions } from './statusEffects.mjs';

/**
 * Wounds (Wunden): every time a creature suffers a Wound, its damage is
 * rolled - 1d[life value of the first Class] + 1d[life value of the second
 * Class, once unlocked] of the creature that suffers it - and added to that
 * creature's one Wound status (see statusEffects.mjs#addWoundValue); at the
 * start of its turn it suffers the summed value (handleWoundTurnStart).
 */

/**
 * The die sizes of one Wound: the life value of the actor's first Class and,
 * once unlocked at the actor's level (same threshold as its abilities and
 * Life, see helpers/life.mjs), of its second Class - the same dice a
 * Regeneration rolls (helpers/actions.mjs#getRegenerationDieSizes).
 * @param {Actor} actor
 * @return {number[]}
 */
export function getWoundDieSizes(actor) {
  const level = actor.system.resources?.level?.value ?? 1;
  const hasAdvancedClass = actorHasAdvancedClass(actor);
  const sizes = [];
  for (const item of actor.items) {
    if (item.type !== 'class' || !item.system.life) continue;
    if (item.system.classType === 'first') {
      sizes.push(item.system.life);
    } else if (item.system.classType === 'second') {
      const [threshold] = getClassAbilityLevels('second', hasAdvancedClass);
      if (level >= threshold) sizes.push(item.system.life);
    }
  }
  return sizes;
}

/**
 * Roll the damage of one Wound for an actor. A creature without any Class
 * (e.g. most NPCs) has no life dice - its Wound then deals a flat 1.
 * @param {Actor} actor
 * @return {Promise<{total: number, formula: string, roll: Roll|null}>}
 */
export async function rollWoundDamage(actor) {
  const sizes = getWoundDieSizes(actor);
  if (!sizes.length) return { total: 1, formula: '1', roll: null };
  const formula = sizes.map(size => `1d${size}`).join(' + ');
  const roll = await new Roll(formula).evaluate();
  return { total: roll.total, formula, roll };
}

/**
 * Let an actor suffer one or more Wounds: roll the damage of each, add all
 * of it to the actor's Wound status and describe it for the chat.
 * @param {Actor} actor
 * @param {number} [count=1]
 * @return {Promise<string>}   Chat HTML (the rolls and a summary line).
 */
export async function applyWounds(actor, count = 1) {
  const times = Math.max(1, Math.floor(Number(count) || 1));
  const rolled = [];
  let html = '';
  for (let n = 0; n < times; n++) {
    const result = await rollWoundDamage(actor);
    rolled.push(result.total);
    if (result.roll) html += await result.roll.render();
    await addWoundValue(actor, result.total);
  }

  const gained = rolled.reduce((sum, value) => sum + value, 0);
  const name = getStatusEffectDefinitions().find(def => def.id === 'wound')?.name ?? 'Wound';
  const summary = game.i18n.format('SKSK.Wound.Applied', {
    name, target: actor.name, count: times, gained, total: getStatusInstancesTotal(actor, 'wound'),
  });
  return `${html}<div class="sksk-roll-line sksk-roll-status-effect">${summary}</div>`;
}
