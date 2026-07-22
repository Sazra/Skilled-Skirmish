import { getActorSizeCategory } from './movement.mjs';

/**
 * Item types that count toward an actor's carried weight.
 */
const GEAR_ITEM_TYPES = ['item', 'armor', 'weapon'];

/**
 * How much of the world's configured max carry weight a creature of each
 * size category can actually carry - e.g. a tiny creature can only manage
 * a quarter of what the formula would give a medium one. Titanic has no
 * limit at all (represented as Infinity).
 */
const SIZE_CARRY_MULTIPLIERS = {
  tiny: 0.25,
  small: 0.75,
  medium: 1,
  large: 1.5,
  huge: 3,
  gigantic: 10,
  titanic: Infinity,
};

/**
 * Total weight an actor is currently carrying: every Item/Armor/Weapon's
 * own weight, times its quantity (Armor/Weapon have no quantity field -
 * treated as 1 each).
 * @param {Actor} actor
 * @return {number}
 */
export function computeCarriedWeight(actor) {
  let total = 0;
  for (const item of actor.items) {
    if (!GEAR_ITEM_TYPES.includes(item.type)) continue;
    const quantity = item.system.quantity ?? 1;
    total += (item.system.weight ?? 0) * quantity;
  }
  return total;
}

/**
 * The actor's max carry weight: the world-configured carryWeightFormula
 * (a real Roll formula evaluated against the actor's own roll data - see
 * actor-base.mjs#getRollData for what's available, e.g. "@attributes.
 * str.value", "@attributes.str.mod", "@skills.<key>", "@lvl"), scaled by
 * its size category (see SIZE_CARRY_MULTIPLIERS) - Titanic creatures have
 * no limit at all (Infinity).
 * @param {Actor} actor
 * @return {Promise<number>}
 */
export async function computeMaxCarryWeight(actor) {
  const sizeCategory = getActorSizeCategory(actor);
  const multiplier = SIZE_CARRY_MULTIPLIERS[sizeCategory] ?? 1;
  if (multiplier === Infinity) return Infinity;

  const formula = game.settings.get('sksk', 'carryWeightFormula');
  const roll = new Roll(formula, actor.getRollData());
  await roll.evaluate();
  return Math.max(0, roll.total) * multiplier;
}
