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
 * CONFIG.SKSK.modelProperties entries selectable on a Material - those
 * whose own "sources" list includes "material" (Antimagic/Silvered are
 * Material-only; Heavy/Demanding/Draining/Shapeshifting/Infusion/Unstable/
 * Light are shared with Models - see helpers/models.mjs#
 * getModelPropertiesFor). Unlike Models, Materials aren't filtered by
 * appliesTo category - a single material applies generically across
 * Items/Armor/Weapons, not split by weapon/armor type.
 * @return {Object<string, object>} The filtered subset, same shape as
 *   CONFIG.SKSK.modelProperties.
 */
export function getMaterialProperties() {
  return Object.fromEntries(
    Object.entries(CONFIG.SKSK.modelProperties).filter(([, def]) => (def.sources ?? ['model']).includes('material'))
  );
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
 * Whether Haltbarkeit (Durability) is tracked at all - the world setting
 * (General Settings menu, see apps/general-settings-config.mjs) gating
 * every maxDurability computation (data/weapon.mjs/armor.mjs/item.mjs#
 * prepareDerivedData) and every place it's spent (helpers/actions.mjs#
 * rollWeaponItem/rollItemUsage, helpers/damageApplication.mjs#
 * applyDamageFromChat) or shown on a sheet (sheets/item-sheet.mjs).
 * @return {boolean}
 */
export function isDurabilityEnabled() {
  return game.settings.get('sksk', 'durabilityEnabled');
}

/**
 * How much of a Weapon/Armor's own fixed Material+Model(+Quality) bonus
 * still applies given its current Haltbarkeit (Durability) - 1 (no
 * reduction) whenever Durability is switched off, or the item has no
 * computed max (e.g. no Material selected) at all. Otherwise the plain
 * current/max ratio, clamped so an (abnormal) current > max never
 * amplifies the bonus. Callers apply this AFTER Herstellungsqualität's own
 * scaling and round the result UP (ceil) - e.g. a fixed bonus of 10 at 81%
 * remaining Durability becomes ceil(10 * 0.81) = 9 - see data/weapon.mjs#
 * prepareDerivedData, helpers/attackRolls.mjs#computeWeaponAttackBonus,
 * and helpers/defense.mjs#computeArmorPieceBonus.
 * @param {object} itemSystem  A Weapon/Armor's system data.
 * @return {number}
 */
export function computeDurabilityRatio(itemSystem) {
  if (!isDurabilityEnabled()) return 1;
  const max = itemSystem.maxDurability ?? 0;
  if (max <= 0) return 1;
  return Math.min(1, (itemSystem.durability?.value ?? 0) / max);
}

/**
 * The base Haltbarkeit (Durability) an Item/Armor/Weapon's material grants -
 * the referenced material's own durability, or the item's own
 * durabilityOverride if that material's value is "?" (individually
 * configurable per item, same convention as materialBonus/manaCapacity
 * above). 0 if no material is set. See data/weapon.mjs/armor.mjs/item.mjs#
 * prepareDerivedData, which multiplies this by the item's own effective
 * durabilityMultiplier (Model-sourced for Weapons/Armor, GM-override-only
 * for generic Items) and rounds up.
 * @param {object} itemSystem
 * @return {number}
 */
export function resolveMaterialDurability(itemSystem) {
  const material = getMaterial(itemSystem.material);
  if (!material) return 0;
  return material.durability === '?' ? (itemSystem.durabilityOverride ?? 0) : (Number(material.durability) || 0);
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
