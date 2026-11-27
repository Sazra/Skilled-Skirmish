import { getActorSkillLevel } from './skills.mjs';
import { computeDurabilityRatio } from './materials.mjs';
import { computeLehrenTargetBonus } from './lehren.mjs';
import { getSpellSchool } from './spells.mjs';
import { computeNaturalMaterialBonus } from './defense.mjs';
import { applyD20Malus, getStatusStacks, setStatusStacks, increaseStatusStacks, isCombatActive, isActorsOwnTurn } from './statusEffects.mjs';
import { getAttackCriticalType, getNaturalD20, resolveCheckSuccess, wrapCriticalBlock, wrapCriticalInline } from './criticalRolls.mjs';
import { offerDefenderReactions } from './reactions.mjs';
import { formatRollCardHeading } from './rollCard.mjs';
import { getEquippedArmorSkillKeys, computeSpellArmorClassBonus, computeHitBonusAgainst } from './defense.mjs';
import {
  pickFlags, BONUS_FLAG_KEYS, getDistantAttackAttributes, getEquippedArmorWithProperty, getUnmetRequirements, isHeldOneHanded,
} from './weaponProperties.mjs';
import { grantSkillUsageFp, grantSkillUsageFp as grantSkillUsageFpReal, formatSkillFpGrantLine } from './skillFp.mjs';
import {
  resolveClickDefender, renderApplyDamageButton, applyResolvedDamageEntries, halveDamageEntries, recordHitEvaluation,
} from './damageApplication.mjs';
import { checkFlanking } from './flanking.mjs';
import { recommendAttackMode } from './rollRecommendation.mjs';
import { computePatronRollBonus } from './religion.mjs';
import { getElementalAirRangeBonus } from './elementalChargeEffects.mjs';
import { renderRerollButton, wrapRerollIcons } from './luck.mjs';
import { renderAttributeRerollButton } from './attributeReroll.mjs';
import { hasRollTwiceWeapon, hasRollTwiceSpell, rollPossiblyDoubledDamage } from './damageReroll.mjs';
import { requestGmAction, registerGmRelayAction } from './gmRelay.mjs';
import { renderTriggerButtons, spendTriggerAbility, classifyAttack } from './abilityTriggers.mjs';
import { readAbility } from './abilityCharges.mjs';
import { onceAbilityCostLines } from './abilityRolls.mjs';

/**
 * Tactic level 10's own flat AC bonus (see helpers/flanking.mjs) - a
 * creature gets this specifically against an enemy it is itself flanking,
 * applied only to armorClass comparisons (never magicResistance).
 */
const FLANKING_AC_BONUS = 5;

/**
 * Präzision's own minimum Präzisionswurf result, per skill level (1-5) -
 * see maybeRollPrecision.
 */
const PRECISION_THRESHOLDS = { 1: 20, 2: 19, 3: 18, 4: 17, 5: 16 };

/**
 * The three ways an Angriffswurf's two independent d20s can resolve down to
 * the single roll that actually counts - chosen fresh on every Evaluate
 * click (see chooseAttackMode/resolveHitEvaluationFromChat), never at roll
 * time, since which one "wins" depends on a choice made only once hit
 * resolution is actually wanted.
 */
const ATTACK_MODES = [
  { id: 'neutral', label: 'SKSK.AttackRoll.ModeNeutral' },
  { id: 'advantage', label: 'SKSK.AttackRoll.ModeAdvantage' },
  { id: 'disadvantage', label: 'SKSK.AttackRoll.ModeDisadvantage' },
];

/**
 * A critical SUCCESS counts as an ordinary roll while the attack cannot hit
 * critically (a follow-up attack, e.g. Schlaghagel); a critical failure stays.
 * @param {"success"|"failure"|null} type
 * @param {boolean} noCrit
 * @return {"success"|"failure"|null}
 */
const suppressCrit = (type, noCrit) => (noCrit && type === 'success' ? null : type);

/**
 * Prompt for which of an Angriffswurf's two d20s counts - one button per
 * mode (see ATTACK_MODES), clicking one both makes the choice and resolves
 * the promise with it, matching helpers/skillRolls.mjs#chooseSkillRollVariant's
 * own one-click dialog pattern. The dialog always offers all three modes and
 * never auto-picks one - suggestedMode (see helpers/flanking.mjs, threaded
 * through the Evaluate button's own data-flanking attribute) only appends a
 * "(recommended)" hint to that one button's label.
 * @param {string|null} [suggestedMode]
 * @return {Promise<string|null>} The chosen mode's id, or null/undefined if
 *   the dialog was closed without picking one - the caller should abort.
 */
async function chooseAttackMode(suggestedMode = null) {
  const buttons = ATTACK_MODES.map(mode => ({
    action: mode.id,
    label: mode.id === suggestedMode
      ? game.i18n.format('SKSK.AttackRoll.ModeRecommended', { mode: game.i18n.localize(mode.label) })
      : game.i18n.localize(mode.label),
    callback: () => mode.id,
  }));
  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize('SKSK.AttackRoll.Evaluate') },
    content: `<p>${game.i18n.localize('SKSK.AttackRoll.ChooseModePrompt')}</p>`,
    buttons,
    rejectClose: false,
  });
}

/**
 * The highest of a set of attribute modifiers, unless every one of them is
 * equal - in which case they're all summed instead. Shared by Masterful
 * weapons and every Martial Arts attack (see computeWeaponAttackBonus/
 * computeMartialArtsAttackBonus below) - both use this exact rule.
 * @param {number[]} mods
 * @return {number}
 */
function highestOrSumIfAllTied(mods) {
  if (!mods.length) return 0;
  const highest = Math.max(...mods);
  return mods.every(mod => mod === highest) ? mods.reduce((sum, mod) => sum + mod, 0) : highest;
}

/**
 * Among a Combined spell's own combinedSkills entries, the caster's actual
 * current level in each - the highest one is added as the attack bonus,
 * and every entry tied at that same highest level is summed instead of
 * just the one (e.g. a spell requiring Fire/Water/Air, caster at
 * Fire 3/Water 3/Air 2, contributes 3+3=6, not just 3).
 * @param {object} spellSystem
 * @param {Actor} actor
 * @return {number}
 */
function computeCombinedSkillAttackBonus(spellSystem, actor) {
  const levels = (spellSystem.combinedSkills ?? []).map(entry => getActorSkillLevel(actor, entry.skill));
  if (!levels.length) return 0;
  const highest = Math.max(...levels);
  return levels.filter(level => level === highest).reduce((sum, level) => sum + level, 0);
}

/**
 * A spell's Angriffswurf (attack roll) bonus, added to both of the two
 * d20s rolled for it - depends on spellType:
 * - Simple/Advanced: Willpower modifier + the caster's level in the
 *   spell's own magicSchool + Hit Correction skill level + that school's
 *   variable bonus/malus (system.magicSchoolAttackBonus.<school>, an
 *   Active-Effect-only field).
 * - Combined: Willpower modifier + Hit Correction skill level + the
 *   spell's own combinedSchool's variable bonus/malus
 *   (system.combinedMagicSchoolAttackBonus.<school>) + the combinedSkills
 *   bonus (see computeCombinedSkillAttackBonus).
 * - Systemless: Willpower modifier + Hit Correction skill level + Magic
 *   Control skill level.
 * @param {object} spellSystem
 * @param {Actor} actor
 * @return {number}
 */
export function computeSpellAttackBonus(spellSystem, actor) {
  const wilMod = actor.system.attributes?.wil?.mod ?? 0;
  const hitCorrection = getActorSkillLevel(actor, 'hitCorrection');
  const allSpellsBonus = actor.system.spellAttackBonusAll ?? 0;

  if (spellSystem.spellType === 'simple' || spellSystem.spellType === 'advanced') {
    const schoolLevel = getActorSkillLevel(actor, spellSystem.magicSchool);
    const schoolBonus = actor.system.magicSchoolAttackBonus?.[spellSystem.magicSchool] ?? 0;
    const lehrenBonus = computeLehrenTargetBonus(actor, 'attackBonus', { skillKey: spellSystem.magicSchool, kind: 'spell' });
    const patronBonus = computePatronRollBonus(actor, spellSystem.magicSchool);
    return wilMod + schoolLevel + hitCorrection + schoolBonus + lehrenBonus + patronBonus + allSpellsBonus;
  }

  if (spellSystem.spellType === 'combined') {
    const schoolBonus = actor.system.combinedMagicSchoolAttackBonus?.[spellSystem.combinedSchool] ?? 0;
    const lehrenBonus = computeLehrenTargetBonus(actor, 'attackBonus', { skillKey: null, kind: 'spell' });
    // Any one of the combined spell's own required skills matching the
    // Patron's favored skills grants the bonus once (see
    // computePatronRollBonus - its result is either 0 or a fixed value, so
    // taking the max across every required skill never double-counts).
    const patronBonus = Math.max(0, ...(spellSystem.combinedSkills ?? []).map(entry => computePatronRollBonus(actor, entry.skill)));
    return wilMod + hitCorrection + schoolBonus + computeCombinedSkillAttackBonus(spellSystem, actor) + lehrenBonus + patronBonus + allSpellsBonus;
  }

  // Systemless.
  const lehrenBonus = computeLehrenTargetBonus(actor, 'attackBonus', { skillKey: null, kind: 'spell' });
  const patronBonus = computePatronRollBonus(actor, 'magicControl');
  return wilMod + hitCorrection + getActorSkillLevel(actor, 'magicControl') + lehrenBonus + patronBonus + allSpellsBonus;
}

/**
 * The attribute keys a weapon's Angriffswurf (attack roll) attribute bonus
 * draws from - its own attributeOverride if enabled (a unique variant of a
 * shared Model), otherwise its resolvedModel's own attributes list. Also
 * the attack roll's own attributeKeys for helpers/attributeReroll.mjs's
 * per-attribute Reroll switch (see renderAttackPairHTML) - any one of
 * these having its switch on unlocks that icon on this attack.
 * @param {object} weaponSystem
 * @return {string[]}
 */
export function getWeaponAttributeKeys(weaponSystem) {
  if (weaponSystem.attributeOverride?.enabled) {
    return Object.entries(weaponSystem.attributeOverride.attributes ?? {})
      .filter(([, checked]) => checked).map(([key]) => key);
  }
  return weaponSystem.resolvedModel?.attributes ?? [];
}

/**
 * The attributes a weapon attack is rolled with: the weapon's usual ones, or -
 * for an attack over more than 2m - the alternative attributes picked on its
 * Reach/Long/Very Long property (see helpers/weaponProperties.mjs#
 * getDistantAttackAttributes), if it has any.
 * @param {object} weaponSystem
 * @param {boolean} [distant=false]
 * @return {string[]}
 */
export function getWeaponAttackAttributeKeys(weaponSystem, distant = false) {
  const distantKeys = distant ? getDistantAttackAttributes(weaponSystem) : [];
  return distantKeys.length ? distantKeys : getWeaponAttributeKeys(weaponSystem);
}

/**
 * A weapon's damage type (for Resistance/Weakness/Immunity/Absorption
 * purposes - see helpers/defense.mjs#applyElementalDefense): its own
 * damageTypeOverride if enabled AND not set to "inherit", otherwise its
 * resolvedModel's own damageType if set AND not "inherit", otherwise (Bow/
 * Feuerwaffen only) its resolvedAmmunitionModel's own damageType - falling
 * back to "blunt" if nothing above resolves to a concrete type (e.g. no
 * Model selected at all). "inherit" ("Übernehmen") is Bow/Feuerwaffen
 * Models' own default damageType (see apps/models-config.mjs#
 * addWeaponModel) and a selectable override choice too (see
 * item-sheet.mjs's own rangedDamageTypeChoices) - it deliberately never
 * appears in CONFIG.SKSK.damageTypes itself, since every other damage-type
 * dropdown in the system has no Ammunition Model to inherit from.
 * @param {object} weaponSystem
 * @return {string}
 */
export function getWeaponDamageType(weaponSystem) {
  const override = weaponSystem.damageTypeOverride;
  if (override?.enabled && override.damageType !== 'inherit') return override.damageType;
  const modelDamageType = weaponSystem.resolvedModel?.damageType;
  if (modelDamageType && modelDamageType !== 'inherit') return modelDamageType;
  return weaponSystem.resolvedAmmunitionModel?.damageType ?? 'blunt';
}

/**
 * A weapon's range display for the Actions window's own weapon list (see
 * apps/actions-dialog.mjs's equippedWeapons context and
 * templates/apps/actions-dialog.hbs): a Ranged ("Fernkampf") weapon shows its own
 * normal range and its extended range - always exactly double the normal
 * one (no second stored field for it, see helpers/models.mjs), matching
 * the Ranged property's own Hint text. A melee weapon instead shows its
 * own Reach ("Reichweite") range if it has one, plus a Long/Sehr Lang
 * indicator if either of those (melee-range-doubling/tripling) properties
 * apply - these are independent of Reach (a thrown/extended-attack range),
 * so both can show together. Blank if none of these properties apply at
 * all.
 * @param {Item} weaponItem
 * @param {Actor|null} [actor]   The wielding actor, for the Elementarist
 *   ability's own Luft-Ladungen range bonus (helpers/
 *   elementalChargeEffects.mjs) - +2m per charge, Ranged weapons only (per
 *   that ability's own "Reichweite ... der Fernkampfwaffenangriffe" line,
 *   melee Reach is unaffected). Omit for a context with no specific
 *   wielder (e.g. an unequipped Item sheet preview).
 * @return {string}  E.g. "(10m)", "(Lang)", "(10m, Sehr Lang)", "(40m/80m)", or "".
 */
export function computeWeaponRangeLabel(weaponItem, actor = null) {
  const properties = weaponItem.system.effectiveProperties ?? [];
  const find = key => properties.find(p => p.property === key);

  const rangedEntry = find('ranged');
  if (rangedEntry) {
    const range = (rangedEntry.value ?? 0) + (actor ? getElementalAirRangeBonus(actor) : 0);
    return `(${range}m/${range * 2}m)`;
  }

  const parts = [];
  const reachEntry = find('reach');
  if (reachEntry) parts.push(`${reachEntry.value ?? 0}m`);
  if (find('veryLong')) parts.push(game.i18n.localize('SKSK.ModelProperty.VeryLong.Name'));
  else if (find('long')) parts.push(game.i18n.localize('SKSK.ModelProperty.Long.Name'));
  return parts.length ? `(${parts.join(', ')})` : '';
}

/**
 * A weapon's attack-bonus (and, per helpers/actions.mjs#rollWeaponItem,
 * damage-bonus) attribute contribution - Masterful uses
 * highestOrSumIfAllTied; Refined/Specialized/no property just take the
 * highest (ties don't stack), with Specialized doubling the result.
 * @param {Actor} actor
 * @param {object} weaponSystem
 * @param {{distant?: boolean}} [options]   distant: an attack over more than 2m,
 *   rolled with the Reach/Long/Very Long attributes if the weapon has any.
 * @return {number}
 */
export function computeWeaponAttributeBonus(actor, weaponSystem, { distant = false } = {}) {
  // Unmet Schwer/Fordernd/Zehrend: no attribute bonus from this weapon.
  if (getUnmetRequirements(actor, weaponSystem).length) return 0;
  const keys = getWeaponAttackAttributeKeys(weaponSystem, distant);
  const mods = keys.map(key => actor.system.attributes?.[key]?.mod ?? 0);
  if (!mods.length) return 0;

  const properties = weaponSystem.effectiveProperties ?? [];
  const has = key => properties.some(p => p.property === key);

  if (has('masterful')) return highestOrSumIfAllTied(mods);
  const highest = Math.max(...mods);
  // Specialized doubles the attribute - but loses that while a Two-Handed
  // weapon is held one-handed.
  const doubled = has('specialized') && !(has('twoHanded') && isHeldOneHanded(actor, weaponSystem));
  return doubled ? highest * 2 : highest;
}

/**
 * A weapon item's Angriffswurf (attack roll) bonus, added to both of the
 * two d20s rolled for it: its matching weapon skill + its own combined
 * Material+Model flat bonus - scaled by Herstellungsqualität, rounded down
 * (same combined-then-scaled treatment as its damage formula's flat bonus,
 * see data/weapon.mjs#prepareDerivedData), then further scaled by how worn
 * the weapon currently is (helpers/materials.mjs#computeDurabilityRatio),
 * rounded UP - plus its attribute bonus (see computeWeaponAttributeBonus).
 * @param {Actor} actor
 * @param {Item} weaponItem
 * @param {{distant?: boolean}} [options]   See computeWeaponAttributeBonus.
 * @return {number}
 */
export function computeWeaponAttackBonus(actor, weaponItem, { distant = false } = {}) {
  const system = weaponItem.system;
  const skillLevel = getActorSkillLevel(actor, system.weaponType);
  const rawItemBonus = (system.materialAttackBonus ?? 0) + (system.resolvedModel?.flatBonus ?? 0);
  const qualityItemBonus = Math.floor(rawItemBonus * system.quality / 100);
  const itemBonus = Math.ceil(qualityItemBonus * computeDurabilityRatio(system));
  const attributeBonus = computeWeaponAttributeBonus(actor, system, { distant });
  // Unmet Schwer/Fordernd/Zehrend: the skill (and what hangs on it) gives nothing either.
  const unmet = getUnmetRequirements(actor, system).length > 0;
  const lehrenBonus = unmet ? 0 : computeLehrenTargetBonus(actor, 'attackBonus', { skillKey: system.weaponType, kind: 'weapon' });
  const weaponTypeBonus = actor.system.weaponAttackBonus?.[system.weaponType] ?? 0;
  const allWeaponsBonus = actor.system.weaponAttackBonusAll ?? 0;
  const patronBonus = unmet ? 0 : computePatronRollBonus(actor, system.weaponType);
  return (unmet ? 0 : skillLevel) + itemBonus + attributeBonus + lehrenBonus + weaponTypeBonus + patronBonus + allWeaponsBonus;
}

/**
 * The attribute keys a Martial Arts attack's own attack-roll attribute
 * bonus draws from (see computeMartialArtsAttributeBonus below) - also its
 * attack roll's own attributeKeys for helpers/attributeReroll.mjs's
 * per-attribute Reroll switch (see renderAttackPairHTML), same role as
 * getWeaponAttributeKeys above.
 * @param {object} attack   An entry from actor.system.martialArtsAttacks.
 * @return {string[]}
 */
export function getMartialArtsAttributeKeys(attack) {
  return Object.entries(attack.attributes ?? {}).filter(([, checked]) => checked).map(([key]) => key);
}

/**
 * A Martial Arts attack's attribute bonus contribution - always
 * highestOrSumIfAllTied, regardless of that attack's own attributeUsage
 * (which only governs its damage roll - see helpers/actions.mjs#
 * resolveMartialArtsAttributeBonus).
 * @param {Actor} actor
 * @param {object} attack   An entry from actor.system.martialArtsAttacks.
 * @return {number}
 */
function computeMartialArtsAttributeBonus(actor, attack) {
  const mods = getMartialArtsAttributeKeys(attack).map(key => actor.system.attributes?.[key]?.mod ?? 0);
  return highestOrSumIfAllTied(mods);
}

/**
 * A Martial Arts attack's Angriffswurf (attack roll) bonus, added to both
 * of the two d20s rolled for it: the Martial Arts skill level + the
 * actor's natural material bonus (no weapon Model, so no flat bonus term)
 * + its attribute bonus (see computeMartialArtsAttributeBonus).
 * @param {Actor} actor
 * @param {object} attack   An entry from actor.system.martialArtsAttacks.
 * @return {number}
 */
export function computeMartialArtsAttackBonus(actor, attack) {
  const skillLevel = getActorSkillLevel(actor, 'martialArts');
  const materialBonus = computeNaturalMaterialBonus(actor);
  const attributeBonus = computeMartialArtsAttributeBonus(actor, attack);
  const lehrenBonus = computeLehrenTargetBonus(actor, 'attackBonus', { skillKey: 'martialArts', kind: 'weapon' });
  const weaponTypeBonus = actor.system.weaponAttackBonus?.martialArts ?? 0;
  const allWeaponsBonus = actor.system.weaponAttackBonusAll ?? 0;
  const patronBonus = computePatronRollBonus(actor, 'martialArts');
  return skillLevel + materialBonus + attributeBonus + lehrenBonus + weaponTypeBonus + patronBonus + allWeaponsBonus;
}

/**
 * Roll the Angriffswurf (attack roll): two independent d20s, each with the
 * same flat bonus and the actor's current D20 malus (Exhaustion only -
 * attributeKey stays null, since no single attribute cleanly represents an
 * arbitrary weapon/spell attack the way it does for e.g. a Constitution
 * check). The two rolls are never combined into one - see
 * renderAttackPairHTML.
 * @param {number} bonus
 * @param {Actor|null} actor
 * @return {Promise<[Roll, Roll]>}
 */
export async function rollAttackPair(bonus, actor) {
  const baseFormula = bonus ? `1d20 + ${bonus}` : '1d20';
  const formula = actor ? applyD20Malus(baseFormula, actor) : baseFormula;
  const rollA = await new Roll(formula, actor?.getRollData()).evaluate();
  const rollB = await new Roll(formula, actor?.getRollData()).evaluate();
  return [rollA, rollB];
}

/**
 * The distinct die sizes (face counts) used by a damage formula, without
 * evaluating it - e.g. "1d4 + 3d6 + 2" -> [4, 6]. Used to compute a
 * critical Angriffswurf's bonus damage (see rollCriticalBonusDamage): one
 * extra die of every distinct size already present in the attack's own
 * damage formula(s), regardless of how many dice of that size the base
 * formula itself rolls.
 * @param {string} formula
 * @return {number[]}
 */
export function getDamageDieSizes(formula) {
  if (!formula) return [];
  let terms;
  try {
    terms = new Roll(String(formula)).terms;
  } catch {
    return [];
  }
  return [...new Set(terms.filter(term => term instanceof foundry.dice.terms.Die).map(term => term.faces))];
}

/**
 * Roll a critical Angriffswurf's bonus damage: one extra die of every
 * distinct size present in the attack's own damage dice (see
 * getDamageDieSizes) - a baseline that applies to every critical attack
 * roll regardless of skills - plus one further die of each size per level
 * of the Brutality skill (so up to 6 total per size, at Brutality's max
 * level of 5). Kept per damage type (rather than one merged roll) so a
 * multi-element spell (e.g. Fire+Cold) gets a separately labeled bonus
 * roll - and separately resistible/absorbable amount - for each element;
 * damage types with no dice at all are simply omitted from the result.
 * Also doubled (roll twice, take the better total - same as the attack's
 * own main damage roll, see helpers/damageReroll.mjs) whenever the
 * attacker has Tödliche Angriffe/Tödliche Magie for this kind - its own
 * ability text explicitly calls out a critical hit's bonus dice, not just
 * the main damage roll.
 * @param {Actor|null} actor
 * @param {Array<{damageType: string, dieSizes: number[]}>} damageDice
 * @param {"weapon"|"spell"} kind
 * @return {Promise<Array<{damageType: string, total: number, html: string}>>}
 */
export async function rollCriticalBonusDamage(actor, damageDice, kind) {
  const diceCount = 1 + (actor ? getActorSkillLevel(actor, 'brutality') : 0);
  const shouldDouble = kind === 'spell' ? hasRollTwiceSpell(actor) : hasRollTwiceWeapon(actor);
  const results = [];
  for (const { damageType, dieSizes } of damageDice) {
    if (!dieSizes.length) continue;
    const formula = dieSizes.map(size => `${diceCount}d${size}`).join(' + ');
    const { total, html } = await rollPossiblyDoubledDamage(formula, actor?.getRollData(), shouldDouble);
    results.push({ damageType, total, html });
  }
  return results;
}

/**
 * Attentat's (Assassination's) own bonus-damage table, per skill level -
 * irregular (die count/size don't scale by any clean formula, notably the
 * jump from 4d20 at level 4 to 8d20 at level 5), so a hardcoded lookup
 * rather than a computed one. Level 0 has no die at all, just a flat
 * bonus. See rollAssassinationBonusDamage.
 */
const ASSASSINATION_DAMAGE = {
  0: { flat: 2 },
  1: { count: 1, size: 8 },
  2: { count: 2, size: 10 },
  3: { count: 3, size: 12 },
  4: { count: 4, size: 20 },
  5: { count: 8, size: 20 },
};

/**
 * Roll Attentat's (Assassination's) own bonus damage for the actor's
 * current skill level (see ASSASSINATION_DAMAGE) - at level 0, a flat "2"
 * formula (still a real Roll, so the caller's .render()/.total handling
 * stays uniform with the dice case); otherwise that level's own dice, plus
 * assassinationBonusDice extra dice of the same size (a GM-tab, Active-
 * Effect-targetable actor field - see data/actor-base.mjs - with no effect
 * at level 0, which has no die size to extend).
 * @param {Actor} actor
 * @return {Promise<Roll>}
 */
export async function rollAssassinationBonusDamage(actor) {
  const level = getActorSkillLevel(actor, 'assassination');
  const entry = ASSASSINATION_DAMAGE[level] ?? ASSASSINATION_DAMAGE[0];
  if (!entry.size) return new Roll(String(entry.flat)).evaluate();

  const bonusDice = actor?.system.assassinationBonusDice ?? 0;
  const formula = `${entry.count + bonusDice}d${entry.size}`;
  return new Roll(formula, actor?.getRollData()).evaluate();
}

/**
 * Präzision (Fighter skill, from level 1): once an ordinary (non-critical)
 * Angriffswurf is confirmed a hit, roll one further, bonus-free
 * Präzisionswurf (1d20) - if it reaches the attacker's own Präzision
 * threshold (natural 20/19/18/17/16 for level 1-5), the attack roll
 * retroactively counts as a critical success after all. A no-op (returns
 * null) if the actor has no Präzision, or the attack roll wasn't an
 * ordinary hit to begin with (already critical, or missed outright).
 * @param {Actor|null} actor
 * @param {boolean} isOrdinaryHit
 * @return {Promise<{roll: Roll, success: boolean}|null>}
 */
export async function maybeRollPrecision(actor, isOrdinaryHit) {
  if (!actor || !isOrdinaryHit) return null;
  const level = getActorSkillLevel(actor, 'precision');
  if (level < 1) return null;
  const threshold = PRECISION_THRESHOLDS[Math.min(5, level)];
  const roll = await new Roll('1d20').evaluate();
  return { roll, success: roll.total >= threshold };
}

/**
 * Render an Angriffswurf (attack roll) pair's chat HTML: both d20s shown
 * side by side (never summed), each colored green/red if its own natural
 * die was a critical success/failure per the attacker's own thresholds
 * (see helpers/criticalRolls.mjs#getAttackCriticalType), plus a button any
 * user can click later (see resolveHitEvaluationFromChat) to resolve
 * hit/miss against a defender's Armor Class or Magic Resistance - a
 * critical success/failure there always hits/always misses regardless of
 * the totals, so each roll's critical type is stashed on the button too -
 * along with the attacker's own uuid (for Präzision/Brutality, resolved
 * only once a hit is confirmed - see resolveHitEvaluationFromChat) and the
 * attack's own per-damage-type dice (see getDamageDieSizes/
 * rollCriticalBonusDamage - Brutality's bonus damage is only ever rolled at
 * Evaluate-time now, never immediately at roll time) - plus killSkillKey
 * (the attacker's own skill to credit a Kill to, if a Präzision-promoted
 * critical here later triggers its own deferred Apply Damage button - see
 * resolveHitEvaluationFromChat), carried through unchanged from whichever
 * call site knows it.
 * Wrapped in a "sksk-attack-block"/"sksk-attack-block-end"-delimited region
 * (see helpers/luck.mjs#redoAttackPairRoll) together with its own heading
 * (damageInfo.label) and Reroll icon (helpers/luck.mjs#renderRerollButton,
 * "attack" kind) - rerolling this same D20 pair later replaces exactly
 * that region in the original chat message, leaving everything else about
 * the card (the damage roll, Apply Damage button) untouched. The end
 * marker is a real (empty) element, not an HTML comment - ChatMessage's
 * own content sanitization strips comments outright on create/update, so
 * one would silently vanish and break the later reroll's own search.
 * damageInfo.bonus/label are only ever used to build that Reroll button's
 * own payload, never the roll itself (rollA/rollB are already-rolled by
 * the time this runs).
 *
 * damageInfo.attributeKeys (see getWeaponAttributeKeys/
 * getMartialArtsAttributeKeys above, or a spell's own fixed ['wil'] - every
 * spell's attack bonus always includes its Willpower modifier, see
 * computeSpellAttackBonus) additionally renders helpers/attributeReroll.mjs's
 * free per-attribute Reroll icon (to this icon's own left, same left-to-
 * right order as the "generic" kind - see helpers/luck.mjs#
 * redoGenericD20Roll) whenever one of them has its own switch on - sharing
 * this exact same attack-pair-block-splice redo (see helpers/luck.mjs#
 * redoAttackPairRoll) with this file's own Luck-charge Reroll button, the
 * two mechanisms differing only in cost/eligibility, never in how the
 * redo itself works.
 * @param {[Roll, Roll]} rolls
 * @param {"armorClass"|"magicResistance"} comparisonType
 * @param {Actor|null} actor   The attacker, whose own critical thresholds apply.
 * @param {{damageDice?: Array<{damageType: string, dieSizes: number[]}>, killSkillKey?: string|null,
 *   flanking?: boolean, bonus?: number, label?: string, attributeKeys?: string[]}} [damageInfo]
 * @return {Promise<string>}
 */
export async function renderAttackPairHTML([rollA, rollB], comparisonType, actor, damageInfo = {}) {
  const { damageDice = [], killSkillKey = null, flanking = false, bonus = 0, label = '', attributeKeys = [], noFp = false, isArea = false, noCrit = false } = damageInfo;
  const critA = suppressCrit(getAttackCriticalType(rollA, actor), noCrit);
  const critB = suppressCrit(getAttackCriticalType(rollB, actor), noCrit);
  const renderedA = wrapCriticalBlock(await rollA.render(), critA);
  const renderedB = wrapCriticalBlock(await rollB.render(), critB);
  // A random id, unique per rendered pair (not per attack/item) - a spell
  // with more than one Angriffswurf (system.attackRoll.count) renders more
  // than one of these blocks into the SAME chat message, so the reroll
  // button needs a way to find its OWN block again rather than always the
  // first one in the message - see helpers/luck.mjs#redoAttackPairRoll.
  const blockId = foundry.utils.randomID();
  // attributeKeys rides along on BOTH icons' own payload (not just the
  // Attribute-Reroll one) - whichever icon is actually clicked, helpers/
  // luck.mjs#redoAttackPairRoll re-renders the fresh block through this
  // same function, and needs attributeKeys again to decide whether the
  // OTHER icon still belongs on that new block too.
  // The Vorteil/Nachteil recommendation is fixed at roll time (a reroll keeps
  // it): "Bis Nutzung" effects behind it (e.g. Nachteil from Tödliche
  // Berührung) are used up by this very roll, long before Evaluate is clicked.
  const suggestedMode = damageInfo.suggestedMode !== undefined
    ? damageInfo.suggestedMode
    : (recommendAttackMode(actor, { comparisonType, killSkillKey, flanking, defender: singleTargetedActor(actor) }) ?? '');
  const rerollPayload = { blockId, bonus, comparisonType, damageDice, killSkillKey, flanking, label, attributeKeys, noFp, isArea, suggestedMode, noCrit };
  const attributeRerollHTML = renderAttributeRerollButton(actor, attributeKeys, 'attack', rerollPayload);
  const rerollHTML = renderRerollButton(actor, 'attack', rerollPayload);
  return `
    <div class="sksk-attack-block" data-block-id="${blockId}">
    <div class="sksk-roll-attack"><strong>${label}</strong>${wrapRerollIcons(attributeRerollHTML + rerollHTML)}</div>
    <div class="sksk-attack-roll-pair">
      <div class="sksk-attack-roll-single">
        ${renderedA}
      </div>
      <div class="sksk-attack-roll-single">
        ${renderedB}
      </div>
    </div>
    <button type="button" class="sksk-roll-hit-eval" data-action="resolveHitEvaluation"
      data-roll-a="${rollA.total}" data-roll-b="${rollB.total}" data-comparison-type="${comparisonType}"
      data-crit-a="${critA ?? ''}" data-crit-b="${critB ?? ''}" data-attacker-uuid="${actor?.uuid ?? ''}"
      data-damage-dice="${encodeURIComponent(JSON.stringify(damageDice))}"
      data-kill-skill="${killSkillKey ?? ''}" data-flanking="${flanking}" data-no-fp="${noFp}"
      data-attack-bonus="${bonus}" data-is-area="${isArea}" data-suggested-mode="${suggestedMode ?? ''}"
      title="${game.i18n.localize('SKSK.AttackRoll.EvaluateShiftHint')}">
      ${game.i18n.localize('SKSK.AttackRoll.Evaluate')}
    </button>
    </div><span class="sksk-attack-block-end" data-block-id="${blockId}"></span>
  `;
}

/**
 * Strip a rendered attack block's own Reroll icon (see renderRerollButton
 * above) - called alongside greyOutManualEvalButtons below whenever an
 * attack ends up auto-resolved against a real target right at roll time
 * (see autoResolveAttackForTargets): by then damage may already be
 * applied to that target's actual Life, which a reroll has no way to walk
 * back, so the button is removed outright rather than merely dimmed.
 * @param {string} html
 * @return {string}
 */
export function stripRerollButton(html) {
  return html.replace(/<span class="sksk-reroll-icons">[\s\S]*?<\/span>/, '');
}

/**
 * The shared core of an Angriffswurf's hit resolution against ONE specific
 * defender (or null, for a Shift+click forceHit with none) - given an
 * already-chosen mode (see chooseAttackMode) and the attack's own two
 * already-rolled d20s. Used by both resolveHitEvaluationFromChat (a manual
 * Evaluate click, one defender resolved from the click itself) and
 * autoResolveAttackForTargets below (one call per user-targeted token,
 * reusing the SAME rolls/mode across all of them - only this function's own
 * per-defender outcome, and the RNG it triggers along the way, actually
 * varies between calls).
 *
 * The chosen roll alone is compared against the defender's Armor Class or
 * Magic Resistance (per comparisonType) - a critical success/failure there
 * always hits/always misses regardless of the totals. An ordinary (non-
 * critical) hit additionally gives the attacker's own Präzision a chance to
 * retroactively promote it to a critical success (see maybeRollPrecision);
 * either way, a critical success here rolls Brutality's bonus damage (see
 * rollCriticalBonusDamage) - always deferred to this one moment, never at
 * roll time, since which roll even counts wasn't known until now, and (for
 * autoResolveAttackForTargets) since whether THIS defender's own comparison
 * is even an ordinary hit at all varies per defender. Independently, ANY
 * confirmed hit (crit or not) while the attacker has the Concealed status
 * rolls Attentat's (Assassination's) own bonus damage too (see
 * rollAssassinationBonusDamage), of the attack's own first damage type -
 * stacks with Brutality's bonus rather than replacing it. For a weapon/
 * Martial Arts attack specifically (killSkillKey set), this also grants the
 * attacker's Attentat skill its own "assassinationAttack" FP.
 *
 * For a weapon/Martial Arts attack (comparisonType "armorClass", not a
 * spell's "magicResistance"), this also grants the "hitTaken" FP trigger
 * (see helpers/skillFp.mjs) to every armor-category skill the defender
 * currently has equipped (body armor + Shield - see helpers/defense.mjs#
 * getEquippedArmorSkillKeys), regardless of hit or miss (suffering an
 * evaluated attack against one's own AC at all is what counts here) - both
 * skipped entirely with no defender resolved (forceHit).
 *
 * The chosen roll's own final outcome grants further FP: "attackHit"
 * (Trefferkorrektur) to the attacker on a hit, "attackDefended"
 * (Verteidigungskorrektur) to the defender on a miss, and "criticalHit"
 * (Präzision) to the attacker on a critical success - plus, independent of
 * which roll was chosen, a bonus "doubleCriticalHit" grant if BOTH raw d20s
 * were natural criticals AND the mode was Vorteil or Nachteil (never
 * Neutral, where Roll B was never really part of the attack to begin with).
 *
 * With no defender (forceHit), the attack counts as a hit unconditionally
 * UNLESS the chosen roll is itself a natural critical failure (which always
 * misses regardless of any defender's stat), and every defender-dependent
 * step above (the AC/MR comparison itself, Tactic's flanking-defense bonus,
 * the defender's own "hitTaken"/"attackDefended" FP) is skipped rather than
 * touching a null defender - everything attacker-side (Präzision,
 * Brutality, Attentat, "attackHit"/"criticalHit" FP) still runs exactly as
 * with a real defender, since none of it depends on one.
 * @param {object} context
 * @param {Actor|null} context.defender
 * @param {Actor|null} context.attacker
 * @param {string} context.mode   One of ATTACK_MODES' own ids.
 * @param {number} context.rollA
 * @param {number} context.rollB
 * @param {string|null} context.critA
 * @param {string|null} context.critB
 * @param {"armorClass"|"magicResistance"} context.comparisonType
 * @param {Array<{damageType: string, dieSizes: number[]}>} context.damageDice
 * @param {string|null} context.killSkillKey
 * @return {Promise<{hit: boolean, criticalType: string|null, line: string, fpHTML: string, title: string, stunStacks: number}>}
 */
async function evaluateHitAgainstDefender({
  defender, attacker, mode, rollA, rollB, critA, critB, comparisonType, damageDice, killSkillKey, noFp = false, autoHit = false,
}) {
  // Hasserfüllte Macht (Gezielter/Maximaler Hass): no attack roll - the spell
  // hits, never critically (nothing was rolled).
  if (autoHit) {
    return {
      hit: true, criticalType: null, fpHTML: '', stunStacks: 0, usedEffectIds: [],
      title: defender
        ? game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: defender.name })
        : game.i18n.localize('SKSK.AttackRoll.EvaluationTitleNoDefender'),
      line: `<div class="sksk-roll-line">${game.i18n.localize('SKSK.Metamagic.Hateful.AutoHitLine')}</div>`,
    };
  }
  // An extra attack granted by a spell's Überladen (see data/spell.mjs#
  // overcharge.effect) gives no FP of its own.
  const grantSkillUsageFp = noFp ? async () => null : grantSkillUsageFpReal;
  let chosenTotal = rollA;
  let criticalType = critA;
  let labelKey = 'RollA';
  if (mode !== 'neutral') {
    // Both pair rolls carry the exact same modifier (see rollAttackPair),
    // so comparing their totals is comparing their natural d20s - Vorteil
    // keeps the higher one, Nachteil the lower one (a tie keeps Roll A),
    // exactly what "2d20kh1"/"2d20kl1" would have kept. The critical type
    // then simply follows whichever d20 was kept.
    const pickB = mode === 'advantage' ? rollB > rollA : rollB < rollA;
    if (pickB) { chosenTotal = rollB; criticalType = critB; labelKey = 'RollB'; }
  }

  const statLabel = game.i18n.localize(comparisonType === 'magicResistance' ? 'SKSK.Resource.MR' : 'SKSK.Resource.AC');

  // Tactic level 10 (see helpers/flanking.mjs): the defender gets a flat AC
  // bonus specifically against an attacker it is itself flanking - checked
  // from the defender's own side, symmetric to the attacker's own flanking
  // bonus above. AC-only, never applies to a magicResistance comparison.
  // Not applicable at all with no defender resolved (forceHit).
  const defenderFlanks = !!defender && comparisonType === 'armorClass' && attacker
    && getActorSkillLevel(defender, 'tactic') >= 10 && checkFlanking(defender, attacker).flanking;
  // Magiestörend (Antimagic): an attack with such a weapon ignores the AC
  // bonuses the defender has from spells.
  const ignoredSpellAc = defender && comparisonType === 'armorClass' && damageDice.some(d => d.antimagic)
    ? Math.max(0, computeSpellArmorClassBonus(defender))
    : 0;
  // Markierung: the defender carries a Trefferbonus for attackers (e.g.
  // Ionisierender Funken) - the attack counts as that much higher.
  const marked = defender ? computeHitBonusAgainst(defender, damageDice.map(d => d.damageType)) : { bonus: 0, effectIds: [] };
  const statValue = defender
    ? (comparisonType === 'magicResistance' ? defender.system.magicResistance : defender.system.armorClass)
      + (defenderFlanks ? FLANKING_AC_BONUS : 0) - ignoredSpellAc - marked.bonus
    : null;

  // With no defender to compare against (forceHit), the attack counts as a
  // hit unconditionally - except a natural critical failure, which always
  // misses regardless of any target's stat, same as with a real defender.
  // The roll must EXCEED AC/MR (at least +1), unlike a saving throw against a
  // DC, where meeting it is enough.
  const hit = defender ? resolveCheckSuccess(chosenTotal, statValue + 1, criticalType) : criticalType !== 'failure';
  let extraHTML = defenderFlanks
    ? `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.FlankingDefenseBonus', { bonus: FLANKING_AC_BONUS, defender: defender.name })}</div>`
    : '';
  if (!defender) {
    extraHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.NoDefenderForcedHit')}</div>`;
  }
  if (ignoredSpellAc > 0) {
    extraHTML += `<div class="sksk-roll-line">${game.i18n.format('SKSK.WeaponProperty.AntimagicIgnoresSpellAc', { bonus: ignoredSpellAc })}</div>`;
  }
  if (marked.bonus) {
    extraHTML += `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.MarkedHitBonus', { defender: defender.name, bonus: marked.bonus })}</div>`;
  }

  if (criticalType === null && hit) {
    const precision = await maybeRollPrecision(attacker, true);
    if (precision) {
      const precisionRendered = wrapCriticalBlock(await precision.roll.render(), precision.success ? 'success' : null);
      extraHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.PrecisionRoll')}</div>${precisionRendered}`;
      if (precision.success) criticalType = 'success';
    }
  }

  // Schwachstellenlos (Flawless): a critical hit against its wearer still
  // hits automatically, but none of the on-critical effects happen (Brutal
  // bonus damage, Betäubend, ...).
  const critEffectsBlocked = criticalType === 'success' && !!defender && getEquippedArmorWithProperty(defender, 'flawless').length > 0;
  if (critEffectsBlocked) {
    extraHTML += `<div class="sksk-roll-line">${game.i18n.format('SKSK.WeaponProperty.FlawlessBlocksCrit', { defender: defender.name })}</div>`;
  }

  if (criticalType === 'success' && !critEffectsBlocked) {
    const bonusResults = await rollCriticalBonusDamage(attacker, damageDice, comparisonType === 'magicResistance' ? 'spell' : 'weapon');
    if (bonusResults.length) {
      let bonusTotal = 0;
      const bonusEntries = [];
      for (const { damageType, total, html } of bonusResults) {
        const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damageType] ?? damageType);
        extraHTML += `<div class="sksk-roll-line"><strong>${typeLabel} ${game.i18n.localize('SKSK.AttackRoll.CriticalBonusDamage')}</strong></div>${html}`;
        bonusEntries.push({
          damageType, amount: total,
          ...(damageDice.some(d => d.damageType === damageType && d.ignoresBarrier) ? { ignoresBarrier: true } : {}),
          ...pickFlags(damageDice.find(d => d.damageType === damageType), BONUS_FLAG_KEYS),
        });
        bonusTotal += total;
      }
      extraHTML += renderApplyDamageButton(attacker, bonusEntries, killSkillKey);
      extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(attacker, 'brutality', 'criticalBonusDamagePoint', bonusTotal));
    }
  }

  // Attentat (Assassination): any confirmed hit (not just a critical one)
  // while the attacker is Concealed adds bonus damage of the attack's own
  // first damage type - independent of, and stacking with, Brutality's
  // crit-only bonus above. For a weapon/Martial Arts attack specifically
  // (killSkillKey set - spells never carry one), this also grants the
  // Fingerfertigkeit skill's own "assassinationAttack" FP, alongside the
  // weapon skill's "weaponAttack" already granted unconditionally at roll
  // time - see helpers/actions.mjs.
  if (hit && damageDice.length && attacker && getStatusStacks(attacker, 'concealed') > 0) {
    const assassinationType = damageDice[0].damageType;
    const assassinationRoll = await rollAssassinationBonusDamage(attacker);
    const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[assassinationType] ?? assassinationType);
    extraHTML += `<div class="sksk-roll-line"><strong>${typeLabel} ${game.i18n.localize('SKSK.AttackRoll.AssassinationDamage')}</strong></div>${await assassinationRoll.render()}`;
    extraHTML += renderApplyDamageButton(attacker, [{
      damageType: assassinationType, amount: assassinationRoll.total, ...(damageDice[0].ignoresBarrier ? { ignoresBarrier: true } : {}),
      ...pickFlags(damageDice[0], BONUS_FLAG_KEYS),
    }], killSkillKey);
    if (killSkillKey) {
      extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(attacker, 'assassination', 'assassinationAttack'));
    }
  }

  // Tarnung (Concealment) breaks automatically once the attacker attacks
  // from it - checked AFTER Attentat's own bonus above, which always uses
  // the PRE-break Concealed status (the attack itself, not this outcome) -
  // unless the attacker's own "concealmentNeverBreaksOnAttack" GM-tab
  // switch is on (never breaks at all, overriding the other switch too),
  // or "concealmentBreaksOnlyOnHit" is on (only breaks on a confirmed hit -
  // a miss leaves it standing). See data/actor-base.mjs. A no-op if the
  // attacker isn't Concealed to begin with.
  // Versteckt (Concealed weapon): the attack does not remove Tarnung by itself.
  const keepsConcealment = damageDice.some(d => d.keepsConcealment);
  if (attacker && getStatusStacks(attacker, 'concealed') > 0 && !attacker.system.concealmentNeverBreaksOnAttack && !keepsConcealment
    && (hit || !attacker.system.concealmentBreaksOnlyOnHit)) {
    await setStatusStacks(attacker, 'concealed', 0);
    extraHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.ConcealmentBroken')}</div>`;
  } else if (keepsConcealment && hit && attacker && getStatusStacks(attacker, 'concealed') > 0) {
    // Only a recommendation - the GM decides.
    extraHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.WeaponProperty.ConcealedRecommendation')}</div>`;
  }

  if (hit) {
    extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(attacker, 'hitCorrection', 'attackHit'));
  } else {
    extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(defender, 'defenseCorrection', 'attackDefended'));
  }
  if (criticalType === 'success') {
    extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(attacker, 'precision', 'criticalHit'));
  }

  const outcomeKey = criticalType === 'success' ? 'SKSK.AttackRoll.CriticalHit'
    : criticalType === 'failure' ? 'SKSK.AttackRoll.CriticalMiss'
    : hit ? 'SKSK.AttackRoll.Hit' : 'SKSK.AttackRoll.Miss';
  const outcome = wrapCriticalInline(game.i18n.localize(outcomeKey), criticalType);
  const modeLabel = game.i18n.localize(ATTACK_MODES.find(m => m.id === mode).label);
  const rollLabel = `${game.i18n.localize(`SKSK.AttackRoll.${labelKey}`)} (${modeLabel})`;
  const line = defender
    ? `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.EvaluationLine', {
        label: rollLabel, total: chosenTotal, statLabel, statValue, outcome,
      })}</div>${extraHTML}`
    : `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.EvaluationLineNoDefender', {
        label: rollLabel, total: chosenTotal, outcome,
      })}</div>${extraHTML}`;

  let fpHTML = '';
  if (defender && comparisonType === 'armorClass') {
    for (const skillKey of getEquippedArmorSkillKeys(defender)) {
      fpHTML += formatSkillFpGrantLine(await grantSkillUsageFp(defender, skillKey, 'hitTaken'));
    }
  }
  if (mode !== 'neutral' && critA === 'success' && critB === 'success') {
    fpHTML += formatSkillFpGrantLine(await grantSkillUsageFp(attacker, 'precision', 'doubleCriticalHit'));
  }

  const title = defender
    ? game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: defender.name })
    : game.i18n.localize('SKSK.AttackRoll.EvaluationTitleNoDefender');

  // Betäubend (Stunning): a critical hit gives Benommenheit stacks - applied by
  // the caller, which knows whether it may write to the defender itself.
  const stunStacks = hit && criticalType === 'success' && !critEffectsBlocked
    ? (damageDice.find(d => d.stunStacks)?.stunStacks ?? 0)
    : 0;

  return { hit, criticalType, line, fpHTML, title, stunStacks, usedEffectIds: marked.effectIds };
}

/**
 * Use up the defender's "Bis Nutzung" markers an attack just got its hit
 * bonus from (see defense.mjs#computeHitBonusAgainst). Deleted right away
 * where the defender can be written to, otherwise by the active GM.
 * @param {Actor|null} defender
 * @param {string[]} effectIds
 * @param {boolean} [direct=false]   The caller already runs where it can write.
 * @return {Promise<string>}   The chat lines.
 */
async function consumeMarkerEffects(defender, effectIds, direct = false) {
  if (!defender || !effectIds?.length) return '';
  const names = effectIds.map(id => defender.effects.get(id)?.name).filter(Boolean);
  if (direct || defender.isOwner) {
    await defender.deleteEmbeddedDocuments('ActiveEffect', effectIds.filter(id => defender.effects.has(id)));
  } else if (!requestGmAction('removeEffects', { defenderUuid: defender.uuid, effectIds })) {
    return '';
  }
  return names
    .map(name => `<div class="sksk-roll-line sksk-roll-effect-consumed">${game.i18n.format('SKSK.Roll.EffectConsumed', { name: foundry.utils.escapeHTML(name) })}</div>`)
    .join('');
}
registerGmRelayAction('removeEffects', async (data) => {
  const defender = await fromUuid(data.defenderUuid);
  if (!defender) return;
  const ids = (data.effectIds ?? []).filter(id => defender.effects.has(id));
  if (ids.length) await defender.deleteEmbeddedDocuments('ActiveEffect', ids);
});

/**
 * Handle a click on an Angriffswurf's "Evaluate" button: resolves the
 * defender (see helpers/damageApplication.mjs#resolveClickDefender), then
 * prompts for which of the attack's two already-rolled d20s actually counts
 * (see chooseAttackMode) - Neutral always picks Roll A, Vorteil/Nachteil
 * keep the higher/lower one (the "2d20kh1"/"2d20kl1" rule). Aborts
 * silently (no chat message) if either no defender could be resolved (a
 * Shift+click/forceHit bypasses that particular block, see
 * evaluateHitAgainstDefender's own doc comment) or the mode dialog was
 * closed without a choice. The actual resolution against that one defender
 * is evaluateHitAgainstDefender above - shared with autoResolveAttackForTargets
 * below, which instead loops it over every user-targeted token.
 * @param {HTMLElement} button
 * @param {boolean} [forceHit=false]   Shift+click - see
 *   evaluateHitAgainstDefender's own doc comment.
 * @return {Promise<ChatMessage|void>}
 */
export async function resolveHitEvaluationFromChat(button, forceHit = false) {
  const attacker = button.dataset.attackerUuid ? await fromUuid(button.dataset.attackerUuid) : null;
  const defender = resolveClickDefender(attacker);
  if (!defender && !forceHit) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  // The recommendation fixed at roll time (see renderAttackPairHTML), if any.
  const mode = await chooseAttackMode(button.dataset.suggestedMode !== undefined
    ? (button.dataset.suggestedMode || null)
    : recommendAttackMode(attacker, {
      comparisonType: button.dataset.comparisonType, killSkillKey: button.dataset.killSkill || null,
      flanking: button.dataset.flanking === 'true', defender,
    }));
  if (!mode) return;

  const damageDice = JSON.parse(decodeURIComponent(button.dataset.damageDice || '[]'));
  const killSkillKey = button.dataset.killSkill || null;

  // Entwaffnend/Umleitung: the defender may react before the hit is evaluated.
  let evalDefender = defender;
  let rollA = Number(button.dataset.rollA);
  let rollB = Number(button.dataset.rollB);
  let critA = button.dataset.critA || null;
  let critB = button.dataset.critB || null;
  let reactionHTML = '';
  if (defender) {
    const reaction = await offerDefenderReactions({
      defender, attacker, comparisonType: button.dataset.comparisonType, damageDice, isArea: button.dataset.isArea === 'true',
    });
    reactionHTML = reaction.html;
    if (reaction.kind === 'failed') {
      const failTitle = game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: defender.name });
      return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: defender }),
        flavor: failTitle,
        content: `<div class="sksk-chat-card sksk-action-card">${formatRollCardHeading(failTitle)}${reactionHTML}<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.WeaponProperty.DisarmAttackFails')}</strong></div></div>`,
      });
    }
    if (reaction.kind === 'redirect') {
      const redirected = await rollRedirectedPair(Number(button.dataset.attackBonus) || 0, attacker);
      evalDefender = reaction.target;
      ({ rollA, rollB, critA, critB } = redirected);
      reactionHTML += redirected.html;
    }
  }

  const { hit, line, fpHTML, title, stunStacks, usedEffectIds } = await evaluateHitAgainstDefender({
    defender: evalDefender, attacker, mode,
    rollA, rollB, critA, critB,
    comparisonType: button.dataset.comparisonType, damageDice, killSkillKey,
    noFp: button.dataset.noFp === 'true',
  });
  const markerHTML = await consumeMarkerEffects(evalDefender, usedEffectIds);

  // Remember the outcome on the roll's own message, so that message's Apply
  // Damage button can deal a missed spell's half damage - see
  // damageApplication.mjs#applyDamageFromChat.
  if (evalDefender) {
    const messageId = button.closest('[data-message-id]')?.dataset.messageId;
    await recordHitEvaluation(messageId ? game.messages.get(messageId) : null, evalDefender.uuid, button.dataset.comparisonType, hit);
  }

  const stunHTML = stunStacks && evalDefender ? await applyCritStun(evalDefender, stunStacks) : '';

  // A missed weapon attack may be turned into a hit (Zielsicher, see helpers/abilityTriggers.mjs).
  const forceHitHTML = !hit && button.dataset.comparisonType === 'armorClass'
    ? renderTriggerButtons(attacker, 'afterMiss', classifyAttack({ comparisonType: 'armorClass', killSkillKey, damageDice }), {
      mode: 'manual', defenderUuid: evalDefender?.uuid ?? null,
    })
    : '';

  const content = `<div class="sksk-chat-card sksk-action-card">`
    + formatRollCardHeading(title) + reactionHTML + line + fpHTML + stunHTML + markerHTML + forceHitHTML
    + `</div>`;

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: evalDefender ?? attacker }),
    flavor: title,
    content,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * Every OTHER token the current user has targeted with Foundry's own
 * targeting tool (game.user.targets) - the attacker's own token (if it
 * happens to be targeted too) is excluded, as is any target with no
 * assigned Actor at all; de-duplicated, since the same Actor can be
 * represented by more than one Token on the scene. Ownership is NOT
 * filtered here (unlike an earlier version of this function) -
 * autoResolveAttackForTargets below branches per-defender instead,
 * relaying an unowned one to the GM (helpers/gmRelay.mjs) rather than
 * dropping it outright.
 * @param {Actor|null} attacker
 * @return {Actor[]}
 */
function getOtherTargetedActors(attacker) {
  const seen = new Set();
  const actors = [];
  for (const token of game.user.targets ?? []) {
    const targetActor = token.actor;
    if (!targetActor || targetActor === attacker || seen.has(targetActor.uuid)) continue;
    seen.add(targetActor.uuid);
    actors.push(targetActor);
  }
  return actors;
}

/**
 * The one other actor the user targets, or null for none/several (the
 * defender's own recommendation only counts when it is unambiguous).
 * @param {Actor|null} attacker
 * @return {Actor|null}
 */
function singleTargetedActor(attacker) {
  const targeted = getOtherTargetedActors(attacker);
  return targeted.length === 1 ? targeted[0] : null;
}

/**
 * Visually dims an already-rendered Evaluate/Apply Damage button's own
 * HTML fragment - a plain substitution on both buttons' own fixed, static
 * class names (renderAttackPairHTML above / helpers/damageApplication.mjs#
 * renderApplyDamageButton - never anything derived from user input), used
 * once autoResolveAttackForTargets has already resolved the SAME attack
 * against every targeted token, so a GM can tell at a glance these buttons
 * are now only needed to manually resolve against some OTHER/further
 * defender - still fully clickable, never actually disabled.
 * @param {string} html
 * @return {string}
 */
export function greyOutManualEvalButtons(html) {
  return html
    .replace('class="sksk-roll-hit-eval"', 'class="sksk-roll-hit-eval sksk-manual-eval-dimmed"')
    .replace('class="sksk-apply-damage"', 'class="sksk-apply-damage sksk-manual-eval-dimmed"');
}

/**
 * Convenience auto-resolution for a just-rolled Angriffswurf: if the
 * current user has one or more OTHER tokens targeted (see
 * getOtherTargetedActors), immediately resolves the SAME already-rolled
 * roll pair against each of them in turn - no manual Evaluate/Apply Damage
 * click needed - and returns the combined result HTML the caller should
 * append to its own card (right after its own Evaluate button and damage
 * roll/Apply Damage button, which stay in place regardless - see
 * greyOutManualEvalButtons above), or "" if nothing was auto-resolved (no
 * targets, or the mode dialog below was dismissed), in which case the
 * caller's own manual buttons remain the ONLY way to resolve this attack,
 * entirely unaffected.
 *
 * The attack MODE (Neutral/Vorteil/Nachteil - see chooseAttackMode) is
 * chosen only ONCE for the whole attack, exactly like a manual Evaluate
 * click - not re-asked per target, since it's the same two already-rolled
 * d20s throughout; a suggested mode (from flanking) applies the same way.
 *
 * Everything else, though, runs freshly PER target via
 * evaluateHitAgainstDefender above: hit/miss against that target's own
 * AC/MR, Präzision's retroactive crit promotion, Brutality's and
 * Attentat's own bonus damage (each may or may not trigger depending on
 * whether THIS target's own comparison was a hit).
 *
 * The already-rolled base damageEntries (the very ones the sibling Apply
 * Damage button carries) are applied automatically too (via helpers/
 * damageApplication.mjs#applyResolvedDamageEntries), gated on that
 * target's own hit/miss: a weapon/Martial Arts attack (comparisonType
 * "armorClass") that misses deals nothing, same as a manual Apply Damage
 * click always required the GM's own hit/miss judgment to skip; a SPELL
 * (comparisonType "magicResistance") that misses instead still deals HALF
 * that damage (see halveDamageEntries) UNLESS the target's own "Verbesserte
 * Magieresistenz" switch (system.improvedMagicResistance - GM tab, Active-
 * Effect-targetable, see data/actor-base.mjs) is on, in which case it
 * blocks the attack entirely instead, same as a weapon/Martial Arts miss. A
 * linked Technique effect (techniqueItemUuid) only ever applies on an
 * actual hit, never on a miss (halved-damage or fully-resisted alike).
 *
 * A target the clicking user doesn't actually own (the ordinary case: a
 * player targeting a GM-owned NPC) is never resolved directly here - the
 * writes below (Life, Durability, FP, flanking-defense state, ...) would
 * otherwise be rejected outright by the server. Such a target is instead
 * relayed to the currently active GM (helpers/gmRelay.mjs#requestGmAction)
 * to resolve with their own full permissions - see resolveAndApplyOneAttack/
 * handleAutoResolveHitRelay below, shared by both paths. That resolution
 * then posts its OWN separate chat card a moment later (a network round
 * trip away, on the GM's own client) rather than joining this function's
 * own returned HTML, which only ever covers targets resolved immediately,
 * inline. If no GM is connected at all, that target is silently skipped
 * instead, leaving Evaluate Hit/Apply Damage on the resulting roll card as
 * the only way to resolve it, exactly as before this relay existed.
 * @param {[Roll, Roll]} rolls
 * @param {"armorClass"|"magicResistance"} comparisonType
 * @param {Actor|null} attacker
 * @param {{damageEntries?: Array<{damageType: string, amount: number}>, damageDice?: Array<{damageType: string, dieSizes: number[]}>, killSkillKey?: string|null, flanking?: boolean, techniqueItemUuid?: string|null, wounds?: number}} [options]
 * @return {Promise<string>}
 */
export async function autoResolveAttackForTargets(rolls, comparisonType, attacker, options = {}) {
  const { damageEntries = [], damageDice = [], killSkillKey = null, flanking = false, techniqueItemUuid = null, noFp = false, wounds = 0, isArea = false, autoHit = false, noCrit = false } = options;
  // autoHit (Hasserfüllte Macht): nothing was rolled - rolls may be null.
  const [rollA, rollB] = rolls ?? [null, null];
  const defenders = getOtherTargetedActors(attacker);
  if (!defenders.length) return '';

  const mode = autoHit ? 'neutral' : await chooseAttackMode(recommendAttackMode(attacker, { comparisonType, killSkillKey, flanking, defender: defenders.length === 1 ? defenders[0] : null }));
  if (!mode) return '';

  const critA = autoHit ? null : suppressCrit(getAttackCriticalType(rollA, attacker), noCrit);
  const critB = autoHit ? null : suppressCrit(getAttackCriticalType(rollB, attacker), noCrit);
  // The attack's own modifier (both d20s carry the same one) - a redirected attack rolls anew with it.
  const attackBonus = autoHit ? 0 : rollA.total - (getNaturalD20(rollA) ?? 0);

  const blocks = [];
  let relayedCount = 0;
  for (const defender of defenders) {
    if (!defender.isOwner) {
      relayedCount += requestGmAction('autoResolveHit', {
        defenderUuid: defender.uuid, attackerUuid: attacker?.uuid ?? null, mode,
        rollA: rollA?.total ?? 0, rollB: rollB?.total ?? 0, critA, critB,
        comparisonType, damageDice, killSkillKey, damageEntries, techniqueItemUuid, noFp, wounds, attackBonus, isArea, autoHit,
      }) ? 1 : 0;
      continue;
    }
    const resolveArgs = {
      mode, rollA: rollA?.total ?? 0, rollB: rollB?.total ?? 0, critA, critB, comparisonType, damageDice, killSkillKey, damageEntries, techniqueItemUuid, noFp, wounds, attackBonus, isArea, autoHit,
    };
    const result = await resolveAndApplyOneAttack(defender, attacker, resolveArgs);
    blocks.push(formatRollCardHeading(result.title) + result.line + result.fpHTML + result.damageHTML + renderMissForceHit(attacker, result, resolveArgs));
  }

  if (!blocks.length && !relayedCount) return '';
  // A target relayed to the GM (see requestGmAction above) has nothing to
  // show inline YET - its own result arrives a moment later, as the GM's
  // own separate chat card - but the caller still needs a truthy return
  // here to grey out its manual Evaluate Hit/Apply Damage buttons (see
  // helpers/actions.mjs#rollWeaponItem/rollMartialArtsAttack, helpers/
  // spell-rolls.mjs's own attack loop) exactly as it would for an inline
  // resolution; skipping that step would leave those buttons clickable
  // even though a relayed resolution already applied this exact damage,
  // inviting a duplicate application on a second click.
  const relayNote = relayedCount
    ? `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.AutoResolveRelayed')}</div>`
    : '';
  return `<div class="sksk-auto-resolved">${relayNote}${blocks.join('')}</div>`;
}

/**
 * The shared per-defender core of autoResolveAttackForTargets above -
 * resolve hit/miss (evaluateHitAgainstDefender) and apply whatever
 * damage that outcome calls for, returning the rendered pieces rather
 * than a single joined string so the inline caller above can still wrap
 * them the same way it always has. Also reused, with the exact same
 * arguments (rollA/rollB already reduced to their own totals, everything
 * else already plain data), by handleAutoResolveHitRelay below when a GM
 * runs this on a player's behalf for a target that player doesn't own.
 * @param {Actor} defender
 * @param {Actor|null} attacker
 * @param {object} args   Everything evaluateHitAgainstDefender needs, plus
 *   damageEntries/techniqueItemUuid - see autoResolveAttackForTargets'
 *   own options param for their shapes.
 * @return {Promise<{title: string, line: string, fpHTML: string, damageHTML: string, hit?: boolean, hitDefender?: Actor}>}
 *   hit/hitDefender: the outcome and who was finally attacked (a redirected
 *   attack has another target); absent if a reaction ended the attack early.
 */
async function resolveAndApplyOneAttack(defender, attacker, args) {
  const {
    mode, rollA, rollB, critA, critB, comparisonType, damageDice, killSkillKey, damageEntries, techniqueItemUuid,
    noFp = false, wounds = 0, attackBonus = 0, isArea = false, noReactions = false, autoHit = false,
  } = args;

  // Entwaffnend/Umleitung: the defender may react before the hit is evaluated.
  let reactionHTML = '';
  // An auto-hit (Hasserfüllte Macht) "can't be averted": no defender reaction.
  if (!noReactions && !autoHit) {
    const reaction = await offerDefenderReactions({ defender, attacker, comparisonType, damageDice, isArea });
    reactionHTML = reaction.html;
    if (reaction.kind === 'failed') {
      return {
        title: game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: defender.name }),
        line: reactionHTML + `<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.WeaponProperty.DisarmAttackFails')}</strong></div>`,
        fpHTML: '', damageHTML: '',
      };
    }
    if (reaction.kind === 'redirect') {
      const redirected = await rollRedirectedPair(attackBonus, attacker);
      const redirectArgs = {
        ...args, defenderUuid: reaction.target.uuid, attackerUuid: attacker?.uuid ?? null,
        rollA: redirected.rollA, rollB: redirected.rollB, critA: redirected.critA, critB: redirected.critB, noReactions: true,
      };
      if (!reaction.target.isOwner) {
        // The new target can't be written to here - the GM resolves it (own card).
        const relayed = requestGmAction('autoResolveHit', redirectArgs);
        const note = relayed ? `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.AutoResolveRelayed')}</div>` : '';
        return {
          title: game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: reaction.target.name }),
          line: reactionHTML + redirected.html + note, fpHTML: '', damageHTML: '',
        };
      }
      const inner = await resolveAndApplyOneAttack(reaction.target, attacker, redirectArgs);
      return { ...inner, line: reactionHTML + redirected.html + inner.line };
    }
  }

  const { hit, line: evaluationLine, fpHTML, title, stunStacks, usedEffectIds } = await evaluateHitAgainstDefender({
    defender, attacker, mode, rollA, rollB, critA, critB, comparisonType, damageDice, killSkillKey, noFp, autoHit,
  });
  const line = reactionHTML + evaluationLine + await consumeMarkerEffects(defender, usedEffectIds, true);

  let damageHTML = '';
  // This runs where the defender can be written to (the owner, or the GM via the relay).
  if (stunStacks) damageHTML += await applyCritStun(defender, stunStacks, true);
  if (hit) {
    if (damageEntries.length || techniqueItemUuid || wounds) {
      const { lines } = await applyResolvedDamageEntries(defender, attacker, damageEntries, killSkillKey, techniqueItemUuid, wounds);
      damageHTML = lines.join('');
    }
  } else if (comparisonType === 'magicResistance' && !defender.system.improvedMagicResistance) {
    const halved = halveDamageEntries(damageEntries);
    if (halved.length) {
      damageHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.SpellMissHalfDamage')}</div>`;
      const { lines } = await applyResolvedDamageEntries(defender, attacker, halved, killSkillKey, null);
      damageHTML += lines.join('');
    }
  } else if (comparisonType === 'magicResistance') {
    damageHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.SpellMissResisted')}</div>`;
  }

  return { title, line, fpHTML, damageHTML, hit, hitDefender: defender };
}

/**
 * The "afterMiss" buttons (Zielsicher) for a missed weapon attack resolved by
 * resolveAndApplyOneAttack ('' for a hit, an auto-hit, a spell or an attacker
 * without such an ability).
 * @param {Actor|null} attacker
 * @param {{hit?: boolean, hitDefender?: Actor}} result
 * @param {object} args   The resolveAndApplyOneAttack arguments of that attack.
 * @return {string}
 */
function renderMissForceHit(attacker, result, args) {
  if (!attacker || result.hit !== false || args.autoHit || args.comparisonType !== 'armorClass' || !result.hitDefender) return '';
  return renderTriggerButtons(attacker, 'afterMiss', classifyAttack(args), { mode: 'auto', defenderUuid: result.hitDefender.uuid, args });
}

/**
 * The click on the button of a triggered ability on an attack card (see
 * helpers/abilityTriggers.mjs): pays the ability, then runs its effect -
 * "forceHit" (Zielsicher): resolves the missed attack again as a hit that
 * cannot be averted (an attack that was resolved right away - the damage is
 * applied) or just states the hit (an Evaluate click - the damage is applied
 * by hand); "followUp" (Schlaghagel): rolls the configured number of further
 * attacks of the same kind.
 * @param {HTMLElement} button
 * @return {Promise<void>}
 */
export async function handleAbilityTriggerFromChat(button) {
  if (button.disabled) return;
  const payload = JSON.parse(decodeURIComponent(button.dataset.payload || '{}'));
  const attacker = payload.attackerUuid ? await fromUuid(payload.attackerUuid) : null;
  if (!attacker) return;
  if (!attacker.isOwner) return void ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.Trigger.NotOwner'));

  const item = await fromUuid(button.dataset.abilityItem);
  const indexText = button.dataset.abilityIndex;
  const ability = item ? readAbility(item, indexText === '' ? null : Number(indexText)) : null;
  if (!ability) return;
  button.disabled = true;
  const paidLines = await spendTriggerAbility(attacker, ability);
  if (paidLines === null) {
    button.disabled = false;
    return;
  }

  const context = payload.context ?? {};
  const costHTML = onceAbilityCostLines(ability, isCombatActive() && !isActorsOwnTurn(attacker)).join('') + paidLines.join('');
  const usedLine = `<div class="sksk-roll-line"><strong>${foundry.utils.escapeHTML(game.i18n.format('SKSK.AttackRoll.Trigger.Used', { name: ability.name, attacker: attacker.name }))}</strong></div>`;
  const postCard = (title, content, actor) => {
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: title,
      content: `<div class="sksk-chat-card sksk-action-card">${formatRollCardHeading(title)}${content}</div>`,
    };
    ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
    return ChatMessage.create(messageData);
  };

  if (payload.effect === 'followUp') {
    await postCard(ability.name, costHTML + usedLine, attacker);
    const { rollMartialArtsAttack, rollWeaponItem } = await import('./actions.mjs');
    const options = { followUp: ability.name, free: !!ability.reaction.followUpFree, noCrit: !!ability.reaction.followUpNoCrit };
    for (let i = 0; i < Math.max(1, ability.reaction.followUpCount ?? 1); i++) {
      if (context.attack === 'martialArts') {
        await rollMartialArtsAttack(attacker, context.index, options);
      } else {
        const weapon = await fromUuid(context.itemUuid);
        if (weapon) await rollWeaponItem(weapon, options);
      }
    }
  } else if (payload.effect === 'forceHit') {
    const defender = context.defenderUuid ? await fromUuid(context.defenderUuid) : null;
    if (context.mode === 'auto' && defender) {
      const forcedArgs = { ...context.args, defenderUuid: defender.uuid, attackerUuid: attacker.uuid, autoHit: true, noReactions: true };
      if (defender.isOwner) {
        const result = await resolveAndApplyOneAttack(defender, attacker, forcedArgs);
        await postCard(result.title, costHTML + usedLine + result.line + result.fpHTML + result.damageHTML, defender);
      } else {
        // The GM resolves it (own card, see handleAutoResolveHitRelay).
        const relayed = requestGmAction('autoResolveHit', forcedArgs);
        const note = relayed
          ? `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.AutoResolveRelayed')}</div>`
          : `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.NoPermissionToApply')}</div>`;
        await postCard(game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: defender.name }), costHTML + usedLine + note, defender);
      }
    } else {
      const title = defender
        ? game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: defender.name })
        : game.i18n.localize('SKSK.AttackRoll.EvaluationTitleNoDefender');
      await postCard(title, costHTML + usedLine + `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.Trigger.ManualNote')}</div>`, defender ?? attacker);
    }
  }

  // The button is spent: swap it for a note, on the stored message too if the user may edit it.
  const spent = `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.Trigger.Spent')}</div>`;
  const message = game.messages.get(button.closest('[data-message-id]')?.dataset.messageId ?? '');
  const content = message?.content ?? '';
  const at = content.indexOf(`data-payload="${button.dataset.payload}"`);
  const start = at < 0 ? -1 : content.lastIndexOf('<div class="sksk-roll-line"><button', at);
  const endTag = '</button></div>';
  const end = at < 0 ? -1 : content.indexOf(endTag, at);
  if (message?.isOwner && start >= 0 && end >= 0) {
    await message.update({ content: content.slice(0, start) + spent + content.slice(end + endTag.length) });
  } else {
    button.closest('.sksk-roll-line')?.replaceWith(Object.assign(document.createElement('div'), { className: 'sksk-roll-line', textContent: game.i18n.localize('SKSK.AttackRoll.Trigger.Spent') }));
  }
}

/**
 * Umleitung (Redirection): the redirected attack gets a new attack roll - two
 * d20s with the same modifier as the original one - against its new target.
 * @param {number} bonus   The attack's modifier.
 * @param {Actor|null} attacker
 * @return {Promise<{html: string, rollA: number, rollB: number, critA: string|null, critB: string|null}>}
 */
async function rollRedirectedPair(bonus, attacker) {
  const [a, b] = await rollAttackPair(bonus, attacker);
  const critA = getAttackCriticalType(a, attacker);
  const critB = getAttackCriticalType(b, attacker);
  const html = `<div class="sksk-roll-line">${game.i18n.localize('SKSK.WeaponProperty.RedirectNewRoll')}</div>`
    + `<div class="sksk-attack-roll-pair"><div class="sksk-attack-roll-single">${wrapCriticalBlock(await a.render(), critA)}</div>`
    + `<div class="sksk-attack-roll-single">${wrapCriticalBlock(await b.render(), critB)}</div></div>`;
  return { html, rollA: a.total, rollB: b.total, critA, critB };
}

/**
 * Betäubend (Stunning): give the defender its Benommenheit stacks after a
 * critical hit. Applied right away if the current user may write to the
 * defender (or `direct` says the caller already runs where it can), otherwise
 * handed to the active GM.
 * @param {Actor} defender
 * @param {number} stacks
 * @param {boolean} [direct=false]
 * @return {Promise<string>}   The chat line.
 */
async function applyCritStun(defender, stacks, direct = false) {
  if (direct || defender.isOwner) {
    await increaseStatusStacks(defender, 'dazed', stacks);
  } else if (!requestGmAction('addStatusStacks', { defenderUuid: defender.uuid, statusId: 'dazed', stacks })) {
    return `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.NoPermissionToApply')}</div>`;
  }
  return `<div class="sksk-roll-line sksk-roll-status-effect">${game.i18n.format('SKSK.WeaponProperty.StunningApplied', { defender: defender.name, stacks })}</div>`;
}
registerGmRelayAction('addStatusStacks', async (data) => {
  const defender = await fromUuid(data.defenderUuid);
  if (defender) await increaseStatusStacks(defender, data.statusId, data.stacks);
});

/**
 * GM-side handler (helpers/gmRelay.mjs#registerGmRelayAction) for the
 * "autoResolveHit" action - resolves defender/attacker fresh from their
 * own uuids (only plain data survives the socket hop, see
 * autoResolveAttackForTargets' own relay call), runs the exact same
 * resolveAndApplyOneAttack core with the GM's own full permissions, and
 * posts its own separate chat card - there's no shared card left to
 * splice into by the time this fires, unlike the inline case.
 * @param {object} data   The exact payload autoResolveAttackForTargets'
 *   own requestGmAction call sends.
 * @return {Promise<void>}
 */
async function handleAutoResolveHitRelay(data) {
  const defender = await fromUuid(data.defenderUuid);
  if (!defender) return;
  const attacker = data.attackerUuid ? await fromUuid(data.attackerUuid) : null;

  const result = await resolveAndApplyOneAttack(defender, attacker, data);
  const { title, line, fpHTML, damageHTML } = result;

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: title,
    content: `<div class="sksk-chat-card sksk-action-card sksk-auto-resolved">${formatRollCardHeading(title)}${line}${fpHTML}${damageHTML}${renderMissForceHit(attacker, result, data)}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
registerGmRelayAction('autoResolveHit', handleAutoResolveHitRelay);
