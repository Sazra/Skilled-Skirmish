import { getActorSkillLevel } from "./skills.mjs";

/**
 * The level-based component of a creature's "natural" material bonus -
 * present even fully unarmored, used as a floor under worn armor's own
 * bonus (see computeArmorClass). Per the design spreadsheet: level 1-24
 * scales as ceil(level/3); level 25 is a fixed 9; level 26+ is a fixed 10.
 * @param {number} level
 * @return {number}
 */
function levelBasedMaterialBonus(level) {
  if (level >= 26) return 10;
  if (level === 25) return 9;
  return Math.ceil(Math.max(level, 0) / 3);
}

/**
 * An actor's "natural" material bonus - no longer directly user-editable
 * (see data/actor-base.mjs#prepareDerivedData, which overwrites
 * system.naturalMaterialBonus.value with this every time). The level-based
 * component above, plus a GM-configurable flat adjustment
 * (system.naturalMaterialBonus.adjustment, positive or negative) and a
 * flat, Active-Effect-driven bonus (system.naturalMaterialBonus.bonus).
 * @param {Actor} actor
 * @return {number}
 */
export function computeNaturalMaterialBonus(actor) {
  const level = actor.system.resources.level.value;
  const naturalMaterialBonus = actor.system.naturalMaterialBonus;
  return Math.round(
    levelBasedMaterialBonus(level)
    + (naturalMaterialBonus?.adjustment ?? 0)
    + (naturalMaterialBonus?.bonus ?? 0)
  );
}

/**
 * A single equipped Armor item's own "armor bonus" - its material's bonus,
 * plus its model's flat bonus, plus the model's Hardened Value - shared by
 * light/heavy armor and shields alike (see computeArmorClass/
 * computeMagicResistance).
 * @param {Item} armorItem
 * @return {number}
 */
export function computeArmorPieceBonus(armorItem) {
  const system = armorItem.system;
  return (system.materialArmorBonus ?? 0)
    + (system.resolvedModel?.flatBonus ?? 0)
    + (system.resolvedModel?.hardenedValue ?? 0);
}

/**
 * An actor's equipped Armor items of one particular armorType
 * ("lightArmor"/"heavyArmor"/"shield").
 * @param {Actor} actor
 * @param {string} armorType
 * @return {Item[]}
 */
function getEquippedArmorByType(actor, armorType) {
  return actor.items.filter(i => i.type === 'armor' && i.system.equipped && i.system.armorType === armorType);
}

/**
 * An actor's Armor Class - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites
 * system.armorClass with this every time). Grund-AC (system.baseArmorClass,
 * a plain user/Active-Effect-editable field, plus the Constitution
 * modifier) plus AC-Boni:
 * - A skill bonus from equipped Light/Heavy Armor, 1 per skill level up to
 *   and including level 5 (Light) / level 6 (Heavy) - only one of the two
 *   can ever be equipped at once (see the updateItem hook in sksk.mjs).
 * - The worn Light/Heavy armor's own bonus (computeArmorPieceBonus), or
 *   the actor's natural material bonus if that's higher (a creature is
 *   never worse off than its own innate toughness, armored or not).
 * - Every equipped Shield's own bonus (computeArmorPieceBonus), summed -
 *   NOT floored by the natural material bonus (only worn body armor is).
 * - system.customArmorClassBonus, a plain user/Active-Effect-editable
 *   flat bonus.
 * @param {Actor} actor
 * @return {number}
 */
export function computeArmorClass(actor) {
  const system = actor.system;
  const baseArmorClass = (system.baseArmorClass ?? 0) + (system.attributes?.con?.mod ?? 0);

  const lightArmor = getEquippedArmorByType(actor, 'lightArmor')[0] ?? null;
  const heavyArmor = getEquippedArmorByType(actor, 'heavyArmor')[0] ?? null;
  const wornArmor = lightArmor ?? heavyArmor;

  let armorSkillBonus = 0;
  if (lightArmor) armorSkillBonus = Math.min(getActorSkillLevel(actor, 'lightArmor'), 5);
  else if (heavyArmor) armorSkillBonus = Math.min(getActorSkillLevel(actor, 'heavyArmor'), 6);

  const wornArmorBonus = wornArmor ? computeArmorPieceBonus(wornArmor) : 0;
  const armorBonus = Math.max(wornArmorBonus, computeNaturalMaterialBonus(actor));

  const shieldBonus = getEquippedArmorByType(actor, 'shield')
    .reduce((sum, shield) => sum + computeArmorPieceBonus(shield), 0);

  return Math.round(baseArmorClass + armorSkillBonus + armorBonus + shieldBonus + (system.customArmorClassBonus ?? 0));
}

/**
 * An actor's Magic Resistance - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites
 * system.magicResistance with this every time). The Aura attribute value,
 * plus (for every equipped Armor/Shield with the Antimagic property) half
 * that piece's own armor bonus (rounded down), plus
 * system.customMagicResistanceBonus, a plain user/Active-Effect-editable
 * flat bonus.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMagicResistance(actor) {
  const system = actor.system;
  const antimagicBonus = actor.items
    .filter(i => i.type === 'armor' && i.system.equipped
      && (i.system.effectiveProperties ?? []).some(p => p.property === 'antimagic'))
    .reduce((sum, armorItem) => sum + Math.floor(computeArmorPieceBonus(armorItem) / 2), 0);

  return Math.round((system.attributes?.aur?.value ?? 0) + antimagicBonus + (system.customMagicResistanceBonus ?? 0));
}
