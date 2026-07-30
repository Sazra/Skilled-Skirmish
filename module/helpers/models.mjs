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
 * Enforce a Weapon Model/weapon Item's own attribute-selection rule for
 * its Angriffswurf (attack roll) attribute bonus (see helpers/
 * attackRolls.mjs#computeWeaponAttackBonus): normally only one attribute
 * may be selected at a time (same as the Specialized property's own
 * behavior, just without its doubling) - Refined and Masterful are the
 * only two properties that allow multiple. Diffing the newly-submitted
 * selection against the previously-stored one identifies whichever single
 * checkbox the user just clicked, so checking a new attribute correctly
 * deselects whichever was checked before (per-request behavior, not just
 * a hard cap) - falls back to keeping the first if nothing looks "newly
 * checked" (e.g. Specialized/no-property just got toggled on while
 * several were already selected).
 * @param {string[]} attributes    The newly-submitted selection.
 * @param {string[]} properties    That same Model/weapon's own effective
 *   properties (property keys only).
 * @param {string[]} previousAttributes   The selection before this change.
 * @return {string[]}
 */
export function clampSingleAttributeSelection(attributes, properties, previousAttributes) {
  if (properties.includes('refined') || properties.includes('masterful')) return attributes;
  if (attributes.length <= 1) return attributes;
  const newlyChecked = attributes.filter(key => !previousAttributes.includes(key));
  return newlyChecked.length ? [newlyChecked[newlyChecked.length - 1]] : [attributes[0]];
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
