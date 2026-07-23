import { getMaterial } from "./materials.mjs";

/**
 * Merge one source's own selected properties (a Material or a Weapon/Armor
 * Model, both shaped {properties: string[], <key>Requirement, <key>Range})
 * into an accumulating Map<propertyKey, number|undefined>. When two
 * sources grant the same property with a coupled value (e.g. both a
 * material and a model impose a Heavy requirement), the higher value wins
 * - both represent "at least this much".
 * @param {Map<string, number|undefined>} map
 * @param {object|null} source
 */
function mergeSourceProperties(map, source) {
  for (const key of source?.properties ?? []) {
    const def = CONFIG.SKSK.modelProperties[key];
    let value;
    if (def?.hasRequirement) value = Number(source[`${key}Requirement`]) || 0;
    else if (def?.hasRange) value = Number(source[`${key}Range`]) || 0;
    const existing = map.get(key);
    if (existing === undefined || (value ?? 0) > (existing ?? 0)) map.set(key, value);
  }
}

/**
 * The final set of properties a Weapon/Armor effectively has: its
 * material's own properties, its model's own properties, then its own
 * propertyOverrides layered on top - "remove" drops a property regardless
 * of where it came from, "add" grants one with its own value, even if
 * neither the item's material nor model normally has it (e.g. a bespoke
 * weapon crafted to be throwable, gaining Throwable plus a Range value).
 * @param {object} itemSystem  A Weapon/Armor's system data.
 * @param {object|null} model  The item's resolved Weapon/Armor Model (see
 *   helpers/models.mjs#getWeaponModel/getArmorModel), or null if unset.
 * @return {Array<{property: string, value: (number|undefined)}>}
 */
export function computeEffectiveProperties(itemSystem, model) {
  const map = new Map();
  mergeSourceProperties(map, getMaterial(itemSystem.material));
  mergeSourceProperties(map, model);
  for (const entry of itemSystem.propertyOverrides ?? []) {
    if (!entry.property) continue;
    if (entry.mode === 'remove') map.delete(entry.property);
    else map.set(entry.property, Number(entry.value) || 0);
  }
  return Array.from(map, ([property, value]) => ({ property, value }));
}
