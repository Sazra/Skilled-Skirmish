import { applyDazedMovementReduction } from './statusEffects.mjs';

/**
 * Item types whose movementBonuses entries can grant an actor a bonus to
 * one specific movement type, or to all of them at once.
 */
const MOVEMENT_BONUS_ITEM_TYPES = ['talent', 'class', 'species', 'item', 'armor', 'weapon'];

/**
 * The minimum speed an "unlocked" movement type is floored to, based on the
 * actor's size category (CONFIG.SKSK.sizeCategories) - only Species items
 * can unlock a movement type (see SKSKSpecies#defineSchema). "flying" holds
 * the minimum for both the "flying" and "hovering" types; every other
 * unlocked type uses "general". Per the design spreadsheet.
 * @type {Object<string, {general: number, flying: number}>}
 */
const SIZE_MOVEMENT_MINIMUMS = {
  tiny: { general: 6, flying: 20 },
  small: { general: 8, flying: 16 },
  medium: { general: 10, flying: 10 },
  large: { general: 14, flying: 14 },
  huge: { general: 18, flying: 18 },
  gigantic: { general: 24, flying: 24 },
  titanic: { general: 30, flying: 30 },
};

/**
 * Compute an actor's effective speed for every movement type
 * (CONFIG.SKSK.movementTypes): the base value entered on the actor,
 * replaced by any Species "override"-mode entry, plus every "bonus"-mode
 * movementBonuses entry across their Talent/Class/Species/Item/Armor/Weapon
 * items - an entry with movementType "all" applies to every type at once,
 * in addition to any type-specific entries. Finally, any movement type a
 * Species has "unlocked" is floored to a size-based minimum (see
 * SIZE_MOVEMENT_MINIMUMS above).
 * @param {Actor} actor
 * @return {Object<string, number>}   Final speed per movement type key.
 */
export function computeMovementSpeeds(actor) {
  const speeds = {};
  for (const key of Object.keys(CONFIG.SKSK.movementTypes)) {
    speeds[key] = actor.system.movement?.[key] ?? 0;
  }

  const bonusEntries = [];
  const unlockedTypes = new Set();

  for (const item of actor.items) {
    if (!MOVEMENT_BONUS_ITEM_TYPES.includes(item.type)) continue;
    for (const entry of item.system.movementBonuses ?? []) {
      if (item.type === 'species' && entry.mode === 'override') {
        const bonus = entry.bonus ?? 0;
        if (entry.movementType === 'all') {
          for (const key of Object.keys(speeds)) speeds[key] = bonus;
        } else if (entry.movementType in speeds) {
          speeds[entry.movementType] = bonus;
        }
      } else {
        bonusEntries.push(entry);
      }

      if (item.type === 'species' && entry.unlocked) {
        if (entry.movementType === 'all') {
          for (const key of Object.keys(speeds)) unlockedTypes.add(key);
        } else if (entry.movementType in speeds) {
          unlockedTypes.add(entry.movementType);
        }
      }
    }
  }

  for (const entry of bonusEntries) {
    const bonus = entry.bonus ?? 0;
    if (entry.movementType === 'all') {
      for (const key of Object.keys(speeds)) speeds[key] += bonus;
    } else if (entry.movementType in speeds) {
      speeds[entry.movementType] += bonus;
    }
  }

  if (unlockedTypes.size) {
    const minimums = SIZE_MOVEMENT_MINIMUMS[getActorSizeCategory(actor)] ?? SIZE_MOVEMENT_MINIMUMS.medium;
    for (const type of unlockedTypes) {
      const minimum = (type === 'flying' || type === 'hovering') ? minimums.flying : minimums.general;
      speeds[type] = Math.max(speeds[type], minimum);
    }
  }

  // Dazed reduces every type but Hovering, floored at half of what's
  // already been computed above - see helpers/statusEffects.mjs.
  return applyDazedMovementReduction(actor, speeds);
}

/**
 * An actor's main Species item (the one whose sizeCategory/Aura actually
 * count) - the one explicitly flagged speciesType "main", or, failing that,
 * whichever Species item happens to be present first (covers an actor with
 * only a single, technically-"sub" Species item). Sub-species never affect
 * size. Used both to resolve the actor's own size category below and by
 * the createItem/updateItem hooks in sksk.mjs that keep system.sizeCategory
 * in sync whenever this item (or its own sizeCategory) changes.
 * @param {Actor} actor
 * @return {Item|undefined}
 */
export function getMainSpeciesItem(actor) {
  return actor.items.find(i => i.type === 'species' && i.system.speciesType === 'main')
    ?? actor.items.find(i => i.type === 'species');
}

/**
 * An actor's size category (CONFIG.SKSK.sizeCategories) - a normal,
 * user-editable field (system.sizeCategory, edited on the General tab's
 * Charakter/Daten sub-section - see templates/actor/parts/character.hbs),
 * "medium" if blank. Kept in sync with the actor's main Species item by the
 * createItem/updateItem hooks in sksk.mjs (mirroring how system.attributes.
 * aur.rawValue is kept in sync with every Species item's own Aura) rather
 * than derived fresh on every read, so a GM can still hand-edit it
 * afterward for an individual exception - exactly like Aura - without that
 * being silently overwritten by anything other than an actual Species
 * change.
 * @param {Actor} actor
 * @return {string}
 */
export function getActorSizeCategory(actor) {
  return actor.system.sizeCategory || 'medium';
}
