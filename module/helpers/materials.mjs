/**
 * The GM-configured list of materials (world setting, edited via the
 * Materials settings menu - see apps/materials-config.mjs), each shaped
 * {name, materialBonus, manaCapacity}. materialBonus/manaCapacity are
 * either a non-negative number or the literal string "?", meaning each
 * Item/Armor/Weapon using this material sets its own value instead (see
 * data/item.mjs#materialBonusOverride/manaCapacityOverride).
 * @return {Array<{name: string, materialBonus: (number|string), manaCapacity: (number|string)}>}
 */
export function getMaterials() {
  return game.settings.get('sksk', 'materials') ?? [];
}

/**
 * Look up a single material by name.
 * @param {string} name
 * @return {object|null}
 */
export function getMaterial(name) {
  if (!name) return null;
  return getMaterials().find(m => m.name === name) ?? null;
}

/**
 * The effective material bonus for an Item/Armor/Weapon - the referenced
 * material's own materialBonus, or the item's own materialBonusOverride if
 * that material's value is "?" (individually configurable per item). 0 if
 * no material is set.
 * @param {object} itemSystem  An Item/Armor/Weapon's system data.
 * @return {number}
 */
export function resolveMaterialBonus(itemSystem) {
  const material = getMaterial(itemSystem.material);
  if (!material) return 0;
  return material.materialBonus === '?' ? (itemSystem.materialBonusOverride ?? 0) : (Number(material.materialBonus) || 0);
}

/**
 * The effective mana capacity (per 0.1kg) for an Item/Armor/Weapon - the
 * referenced material's own manaCapacity, or the item's own
 * manaCapacityOverride if that material's value is "?". 0 if no material
 * is set. Not to be confused with the Mana Capacity skill.
 * @param {object} itemSystem
 * @return {number}
 */
export function resolveMaterialManaCapacity(itemSystem) {
  const material = getMaterial(itemSystem.material);
  if (!material) return 0;
  return material.manaCapacity === '?' ? (itemSystem.manaCapacityOverride ?? 0) : (Number(material.manaCapacity) || 0);
}

/**
 * Total mana capacity an Item/Armor/Weapon contributes: the material's
 * resolved mana capacity for every 0.1kg of the item's own weight (weight
 * is always in kg in SKSK) - i.e. the resolved value times 10x the weight.
 * @param {object} itemSystem
 * @return {number}
 */
export function computeTotalManaCapacity(itemSystem) {
  const manaCapacity = resolveMaterialManaCapacity(itemSystem);
  // Rounded to 2 decimals to avoid floating-point noise (e.g. 0.1 * 3).
  return Math.round(manaCapacity * (itemSystem.weight ?? 0) * 10 * 100) / 100;
}
