import { getActorSkillLevel, isActorSkillUnlocked, getSkillStacks } from "./skills.mjs";

/**
 * The level-based component of a creature's "natural" material bonus -
 * present even fully unarmored, used as a floor under worn armor's own
 * bonus (see computeArmorClassComponents). Per the design spreadsheet:
 * level 1-24 scales as ceil(level/3); level 25 is a fixed 9; level 26+ is
 * a fixed 10.
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
 * light/heavy armor and shields alike.
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
 * Every armor-category skill (CONFIG.SKSK.skills.armors) currently
 * "active" on an actor via equipped gear - the worn body armor's own type
 * (lightArmor/heavyArmor, mutually exclusive - see
 * computeArmorClassComponents), plus "shield" if at least one Shield is
 * equipped. Used to grant the "hitTaken" FP trigger (see
 * helpers/skillFp.mjs) to every skill actually protecting the wearer right
 * now, not just one.
 * @param {Actor} actor
 * @return {string[]}
 */
export function getEquippedArmorSkillKeys(actor) {
  const keys = [];
  if (getEquippedArmorByType(actor, 'lightArmor').length) keys.push('lightArmor');
  else if (getEquippedArmorByType(actor, 'heavyArmor').length) keys.push('heavyArmor');
  if (getEquippedArmorByType(actor, 'shield').length) keys.push('shield');
  return keys;
}

/**
 * The shared building blocks behind computeArmorClass and
 * getArmorClassBreakdown (the tooltip shown over the AC label on the actor
 * sheet) - the single source of truth for both. AC-Boni, in order:
 * - Grund-AC: system.baseArmorClass (a plain user/Active-Effect-editable
 *   field) plus the Constitution modifier.
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
 * @return {{rows: Array<{label: string, perLevel: null, value: number}>, total: number}}
 */
function computeArmorClassComponents(actor) {
  const system = actor.system;
  const rows = [];

  const groundArmorClass = (system.baseArmorClass ?? 0) + (system.attributes?.con?.mod ?? 0);
  rows.push({ label: game.i18n.localize('SKSK.Breakdown.GroundArmorClass'), perLevel: null, value: groundArmorClass });

  const lightArmor = getEquippedArmorByType(actor, 'lightArmor')[0] ?? null;
  const heavyArmor = getEquippedArmorByType(actor, 'heavyArmor')[0] ?? null;
  const wornArmor = lightArmor ?? heavyArmor;

  let armorSkillBonus = 0;
  if (lightArmor) armorSkillBonus = Math.min(getActorSkillLevel(actor, 'lightArmor'), 5);
  else if (heavyArmor) armorSkillBonus = Math.min(getActorSkillLevel(actor, 'heavyArmor'), 6);
  rows.push({ label: game.i18n.localize('SKSK.Breakdown.ArmorSkillBonus'), perLevel: null, value: armorSkillBonus });

  const wornArmorBonus = wornArmor ? computeArmorPieceBonus(wornArmor) : 0;
  const armorBonus = Math.max(wornArmorBonus, computeNaturalMaterialBonus(actor));
  rows.push({ label: game.i18n.localize('SKSK.Breakdown.ArmorBonus'), perLevel: null, value: armorBonus });

  const shieldBonus = getEquippedArmorByType(actor, 'shield')
    .reduce((sum, shield) => sum + computeArmorPieceBonus(shield), 0);
  rows.push({ label: game.i18n.localize('SKSK.Breakdown.ShieldBonus'), perLevel: null, value: shieldBonus });

  rows.push({ label: game.i18n.localize('SKSK.GM.CustomArmorClassBonus'), perLevel: null, value: system.customArmorClassBonus ?? 0 });

  return { rows, total: Math.round(rows.reduce((sum, row) => sum + row.value, 0)) };
}

/**
 * The shared building blocks behind computeMagicResistance and
 * getMagicResistanceBreakdown (the tooltip shown over the MR label on the
 * actor sheet) - the single source of truth for both. The Aura attribute
 * value, plus (for every equipped Armor/Shield with the Antimagic
 * property) half that piece's own armor bonus (rounded down), plus
 * system.customMagicResistanceBonus, a plain user/Active-Effect-editable
 * flat bonus.
 * @param {Actor} actor
 * @return {{rows: Array<{label: string, perLevel: null, value: number}>, total: number}}
 */
function computeMagicResistanceComponents(actor) {
  const system = actor.system;
  const rows = [];

  rows.push({ label: game.i18n.localize('SKSK.Attribute.Aur.long'), perLevel: null, value: system.attributes?.aur?.value ?? 0 });

  const antimagicItems = actor.items.filter(i => i.type === 'armor' && i.system.equipped
    && (i.system.effectiveProperties ?? []).some(p => p.property === 'antimagic'));
  for (const item of antimagicItems) {
    rows.push({
      label: game.i18n.format('SKSK.Breakdown.AntimagicBonus', { name: item.name }),
      perLevel: null, value: Math.floor(computeArmorPieceBonus(item) / 2),
    });
  }

  rows.push({ label: game.i18n.localize('SKSK.GM.CustomMagicResistanceBonus'), perLevel: null, value: system.customMagicResistanceBonus ?? 0 });

  return { rows, total: Math.round(rows.reduce((sum, row) => sum + row.value, 0)) };
}

/**
 * An actor's Armor Class - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites
 * system.armorClass with this every time). See computeArmorClassComponents.
 * @param {Actor} actor
 * @return {number}
 */
export function computeArmorClass(actor) {
  return computeArmorClassComponents(actor).total;
}

/**
 * An actor's Magic Resistance - no longer directly user-editable (see
 * data/actor-base.mjs#prepareDerivedData, which overwrites
 * system.magicResistance with this every time). See
 * computeMagicResistanceComponents.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMagicResistance(actor) {
  return computeMagicResistanceComponents(actor).total;
}

/**
 * The itemized breakdown shown in the tooltip over the AC label on the
 * actor sheet - see helpers/tooltips.mjs#renderBreakdownHtml.
 * @param {Actor} actor
 * @return {{rows: Array, total: number}}
 */
export function getArmorClassBreakdown(actor) {
  return computeArmorClassComponents(actor);
}

/**
 * The itemized breakdown shown in the tooltip over the MR label on the
 * actor sheet - see helpers/tooltips.mjs#renderBreakdownHtml.
 * @param {Actor} actor
 * @return {{rows: Array, total: number}}
 */
export function getMagicResistanceBreakdown(actor) {
  return computeMagicResistanceComponents(actor);
}

/**
 * How a given amount of one element's damage is modified by the
 * defender's Resistance/Weakness/Immunity/Absorption skills for that same
 * element (CONFIG.SKSK.damageTypes key + "Resistance"/"Weakness"/
 * "Immunity"/"Absorption") - mirrors (and shares helpers with) the Skills
 * tab's own Resistance-row display logic (see sheets/actor-sheet.mjs#
 * _prepareSkills), so the sheet and real damage math never disagree:
 * - Absorption (binary): the entire amount is converted into healing
 *   outright - highest priority, blocks both Immunity and Weakness/
 *   Resistance from mattering at all.
 * - Otherwise Immunity (binary): the damage is prevented entirely (0) -
 *   also blocks Weakness/Resistance.
 * - Otherwise Resistance (level 0-10, -10%/level capped at -99% at level
 *   10) and Weakness (stackable, +100%/stack) net together on the same
 *   amount: floor(amount * (1 + weaknessStacks - resistancePercent/100)),
 *   floored at 0.
 * @param {Actor} actor
 * @param {string} damageType   A CONFIG.SKSK.damageTypes key.
 * @param {number} amount       Positive raw damage before defenses.
 * @return {{amount: number, healing: boolean}}
 */
export function applyElementalDefense(actor, damageType, amount) {
  if (amount <= 0) return { amount: 0, healing: false };

  if (isActorSkillUnlocked(actor, `${damageType}Absorption`)) return { amount, healing: true };
  if (isActorSkillUnlocked(actor, `${damageType}Immunity`)) return { amount: 0, healing: false };

  const resistancePercent = Math.min(99, getActorSkillLevel(actor, `${damageType}Resistance`) * 10);
  const weaknessStacks = getSkillStacks(actor, `${damageType}Weakness`);
  const netFraction = 1 + weaknessStacks - resistancePercent / 100;
  return { amount: Math.max(0, Math.floor(amount * netFraction)), healing: false };
}
