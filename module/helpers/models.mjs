/**
 * The GM-configured list of Weapon Models (world setting, edited via the
 * Models settings menu - see apps/models-config.mjs), each shaped
 * {name, weaponType, diceFormula, flatBonus, attributes, properties}.
 * weaponType is a key from CONFIG.SKSK.skills.weapons; attributes/
 * properties are arrays of keys (CONFIG.SKSK.attributes /
 * CONFIG.SKSK.modelProperties respectively).
 * @return {Array<object>}
 */
export function getWeaponModels() {
  return game.settings.get('sksk', 'weaponModels') ?? [];
}

/**
 * The GM-configured list of Armor Models, each shaped {name, armorType,
 * flatBonus, attributes, properties, hardenedValue}. armorType is one of
 * "lightArmor"/"heavyArmor"/"shield".
 * @return {Array<object>}
 */
export function getArmorModels() {
  return game.settings.get('sksk', 'armorModels') ?? [];
}

/**
 * CONFIG.SKSK.modelProperties entries applicable to at least one of the
 * given categories (e.g. "weapon", or "lightArmor"/"heavyArmor"/"shield").
 * @param {string[]} categories
 * @return {Object<string, object>} The filtered subset, same shape as
 *   CONFIG.SKSK.modelProperties.
 */
export function getModelPropertiesFor(categories) {
  return Object.fromEntries(
    Object.entries(CONFIG.SKSK.modelProperties).filter(
      ([, def]) => def.appliesTo.some(category => categories.includes(category))
    )
  );
}
