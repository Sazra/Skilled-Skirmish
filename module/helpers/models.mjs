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
 * Look up a single Weapon/Armor Model by name.
 * @param {string} name
 * @return {object|null}
 */
export function getWeaponModel(name) {
  if (!name) return null;
  return getWeaponModels().find(m => m.name === name) ?? null;
}

/** @param {string} name @return {object|null} */
export function getArmorModel(name) {
  if (!name) return null;
  return getArmorModels().find(m => m.name === name) ?? null;
}

/**
 * Whether a CONFIG.SKSK.modelProperties entry can be granted via a Model -
 * true unless its own "sources" list is set and excludes "model" (most
 * properties are Model-only and don't set "sources" at all).
 * @param {object} def
 * @return {boolean}
 */
function isModelSource(def) {
  return (def.sources ?? ['model']).includes('model');
}

/**
 * CONFIG.SKSK.modelProperties entries applicable to at least one of the
 * given categories (e.g. "weapon", or "lightArmor"/"heavyArmor"/"shield")
 * AND selectable on a Model (excludes Material-only properties like
 * Antimagic/Silvered - see helpers/materials.mjs#getMaterialProperties).
 * @param {string[]} categories
 * @return {Object<string, object>} The filtered subset, same shape as
 *   CONFIG.SKSK.modelProperties.
 */
export function getModelPropertiesFor(categories) {
  return Object.fromEntries(
    Object.entries(CONFIG.SKSK.modelProperties).filter(
      ([, def]) => def.appliesTo.some(category => categories.includes(category)) && isModelSource(def)
    )
  );
}

/**
 * CONFIG.SKSK.modelProperties entries applicable to at least one of the
 * given categories, regardless of their usual "sources" - used for a
 * Weapon/Armor's own manual property overrides (helpers/properties.mjs),
 * which can add/remove ANY property that makes sense for that item's
 * category even if it's not normally granted by a Model or Material there.
 * @param {string[]} categories
 * @return {Object<string, object>}
 */
export function getOverridablePropertiesFor(categories) {
  return Object.fromEntries(
    Object.entries(CONFIG.SKSK.modelProperties).filter(
      ([, def]) => def.appliesTo.some(category => categories.includes(category))
    )
  );
}
