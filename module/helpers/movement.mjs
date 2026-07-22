/**
 * Item types whose movementBonuses entries can grant an actor a bonus to
 * one specific movement type, or to all of them at once.
 */
const MOVEMENT_BONUS_ITEM_TYPES = ['talent', 'class', 'species', 'item', 'armor', 'weapon'];

/**
 * Compute an actor's effective speed for every movement type
 * (CONFIG.SKSK.movementTypes): the base value entered on the actor plus
 * every matching movementBonuses entry across their Talent/Class/Species/
 * Item/Armor/Weapon items - an entry with movementType "all" adds to
 * every type at once, in addition to any type-specific entries.
 * @param {Actor} actor
 * @return {Object<string, number>}   Final speed per movement type key.
 */
export function computeMovementSpeeds(actor) {
  const speeds = {};
  for (const key of Object.keys(CONFIG.SKSK.movementTypes)) {
    speeds[key] = actor.system.movement?.[key] ?? 0;
  }

  for (const item of actor.items) {
    if (!MOVEMENT_BONUS_ITEM_TYPES.includes(item.type)) continue;
    for (const entry of item.system.movementBonuses ?? []) {
      const bonus = entry.bonus ?? 0;
      if (entry.movementType === 'all') {
        for (const key of Object.keys(speeds)) speeds[key] += bonus;
      } else if (entry.movementType in speeds) {
        speeds[entry.movementType] += bonus;
      }
    }
  }

  return speeds;
}

/**
 * An actor's size category (CONFIG.SKSK.sizeCategories): the actor's own
 * override (system.sizeCategory, editable in the sheet header - e.g. an
 * individual smaller than typical for its species) if set, otherwise
 * derived from their main Species item (sub-species don't affect it), or
 * "medium" if neither is set.
 * @param {Actor} actor
 * @return {string}
 */
export function getActorSizeCategory(actor) {
  if (actor.system.sizeCategory) return actor.system.sizeCategory;

  const mainSpecies = actor.items.find(i => i.type === 'species' && i.system.speciesType === 'main')
    ?? actor.items.find(i => i.type === 'species');
  return mainSpecies?.system.sizeCategory ?? 'medium';
}
