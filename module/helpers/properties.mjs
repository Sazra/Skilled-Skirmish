import { getMaterial } from "./materials.mjs";

/**
 * Merge one source's own selected properties (a Material or a Weapon/Armor
 * Model, both shaped {properties: string[], <key>Requirement, <key>Range, ...})
 * into an accumulating Map<propertyKey, {value, formula, attributes}>. A
 * property can carry coupled parameters (see CONFIG.SKSK.modelProperties):
 * - hasRequirement/hasRange/hasApCost/hasLevel: one number ("value"),
 * - hasFormula: a formula/dice string ("formula", e.g. Spiky's retaliation),
 * - hasAttributes: attribute keys ("attributes", e.g. the attributes Reach/
 *   Long/Very Long attacks over more than 2m are rolled with).
 * When two sources grant the same property, the higher value wins - both
 * represent "at least this much" - and a non-blank formula/attribute list
 * of the later source replaces the earlier one's.
 * @param {Map<string, object>} map
 * @param {object|null} source
 */
function mergeSourceProperties(map, source) {
  for (const key of source?.properties ?? []) {
    const def = CONFIG.SKSK.modelProperties[key];
    let value;
    if (def?.hasRequirement) value = Number(source[`${key}Requirement`]) || 0;
    else if (def?.hasRange) value = Number(source[`${key}Range`]) || 0;
    else if (def?.hasApCost) value = Number(source[`${key}ApCost`]) || 0;
    else if (def?.hasLevel) value = Number(source[`${key}Level`]) || 0;
    const formula = def?.hasFormula ? String(source[`${key}Formula`] ?? '').trim() : undefined;
    const attributes = def?.hasAttributes ? [...(source[`${key}Attributes`] ?? [])] : undefined;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { value, formula, attributes });
      continue;
    }
    if ((value ?? 0) > (existing.value ?? 0)) existing.value = value;
    if (formula) existing.formula = formula;
    if (attributes?.length) existing.attributes = attributes;
  }
}

/**
 * The submitted values of every coupled "Level" (hasLevel) and "Formula"
 * (hasFormula) parameter of one Model/Material form entry, keyed the way
 * mergeSourceProperties reads them back ("<key>Level", "<key>Formula") - so
 * the Models/Materials config apps persist them without listing every
 * property by hand.
 * @param {object} formEntry   One expanded "weaponModels.<i>"/"armorModels.<i>"/"materials.<i>" entry.
 * @return {object}
 */
export function collectPropertyParams(formEntry) {
  const params = {};
  for (const [key, def] of Object.entries(CONFIG.SKSK.modelProperties)) {
    if (def.hasLevel) params[`${key}Level`] = Number(formEntry[`${key}Level`]) || 0;
    if (def.hasFormula) params[`${key}Formula`] = String(formEntry[`${key}Formula`] ?? '').trim();
  }
  return params;
}

/**
 * The final set of properties a Weapon/Armor effectively has: its
 * material's own properties, its model's own properties, then its own
 * propertyOverrides layered on top - "remove" drops a property regardless
 * of where it came from, "add" grants one with its own value/formula/
 * attributes, even if neither the item's material nor model normally has it
 * (e.g. a bespoke weapon crafted to be throwable, gaining Throwable plus a
 * Range value).
 * @param {object} itemSystem  A Weapon/Armor's system data.
 * @param {object|null} model  The item's resolved Weapon/Armor Model (see
 *   helpers/models.mjs#getWeaponModel/getArmorModel), or null if unset.
 * @return {Array<{property: string, value: (number|undefined), formula: (string|undefined), attributes: (string[]|undefined)}>}
 */
export function computeEffectiveProperties(itemSystem, model) {
  const map = new Map();
  mergeSourceProperties(map, getMaterial(itemSystem.material));
  mergeSourceProperties(map, model);
  for (const entry of itemSystem.propertyOverrides ?? []) {
    if (!entry.property) continue;
    if (entry.mode === 'remove') {
      map.delete(entry.property);
      continue;
    }
    const def = CONFIG.SKSK.modelProperties[entry.property];
    map.set(entry.property, {
      value: Number(entry.value) || 0,
      formula: def?.hasFormula ? String(entry.formula ?? '').trim() : undefined,
      attributes: def?.hasAttributes ? [...(entry.attributes ?? [])] : undefined,
    });
  }
  return Array.from(map, ([property, entry]) => ({ property, value: entry.value, formula: entry.formula, attributes: entry.attributes }));
}
