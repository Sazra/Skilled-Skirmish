import { getActorSkillLevel } from './skills.mjs';
import { computeDurabilityRatio } from './materials.mjs';
import { computeLehrenTargetBonus } from './lehren.mjs';
import { getSpellSchool } from './spells.mjs';
import { computeNaturalMaterialBonus } from './defense.mjs';
import { applyD20Malus, getStatusStacks, setStatusStacks } from './statusEffects.mjs';
import { getAttackCriticalType, resolveCheckSuccess, wrapCriticalBlock, wrapCriticalInline, rollQuality } from './criticalRolls.mjs';
import { formatRollCardHeading } from './rollCard.mjs';
import { getEquippedArmorSkillKeys } from './defense.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';
import { resolveClickDefender, renderApplyDamageButton, applyResolvedDamageEntries } from './damageApplication.mjs';
import { checkFlanking } from './flanking.mjs';
import { computePatronRollBonus } from './religion.mjs';
import { getElementalAirRangeBonus } from './elementalChargeEffects.mjs';
import { renderRerollButton, wrapRerollIcons } from './luck.mjs';
import { renderAttributeRerollButton } from './attributeReroll.mjs';
import { hasRollTwiceWeapon, hasRollTwiceSpell, rollPossiblyDoubledDamage } from './damageReroll.mjs';
import { requestGmAction, registerGmRelayAction } from './gmRelay.mjs';

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
 * A weapon's range display for the Actions tab's own weapon list (see
 * sheets/actor-sheet.mjs's equippedWeapons context and templates/actor/
 * parts/general-actions.hbs): a Ranged ("Fernkampf") weapon shows its own
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
 * @return {number}
 */
export function computeWeaponAttributeBonus(actor, weaponSystem) {
  const keys = getWeaponAttributeKeys(weaponSystem);
  const mods = keys.map(key => actor.system.attributes?.[key]?.mod ?? 0);
  if (!mods.length) return 0;

  const properties = weaponSystem.effectiveProperties ?? [];
  const has = key => properties.some(p => p.property === key);

  if (has('masterful')) return highestOrSumIfAllTied(mods);
  const highest = Math.max(...mods);
  return has('specialized') ? highest * 2 : highest;
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
 * @return {number}
 */
export function computeWeaponAttackBonus(actor, weaponItem) {
  const system = weaponItem.system;
  const skillLevel = getActorSkillLevel(actor, system.weaponType);
  const rawItemBonus = (system.materialAttackBonus ?? 0) + (system.resolvedModel?.flatBonus ?? 0);
  const qualityItemBonus = Math.floor(rawItemBonus * system.quality / 100);
  const itemBonus = Math.ceil(qualityItemBonus * computeDurabilityRatio(system));
  const attributeBonus = computeWeaponAttributeBonus(actor, system);
  const lehrenBonus = computeLehrenTargetBonus(actor, 'attackBonus', { skillKey: system.weaponType, kind: 'weapon' });
  const weaponTypeBonus = actor.system.weaponAttackBonus?.[system.weaponType] ?? 0;
  const allWeaponsBonus = actor.system.weaponAttackBonusAll ?? 0;
  const patronBonus = computePatronRollBonus(actor, system.weaponType);
  return skillLevel + itemBonus + attributeBonus + lehrenBonus + weaponTypeBonus + patronBonus + allWeaponsBonus;
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
  const { damageDice = [], killSkillKey = null, flanking = false, bonus = 0, label = '', attributeKeys = [] } = damageInfo;
  const critA = getAttackCriticalType(rollA, actor);
  const critB = getAttackCriticalType(rollB, actor);
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
  const rerollPayload = { blockId, bonus, comparisonType, damageDice, killSkillKey, flanking, label, attributeKeys };
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
      data-kill-skill="${killSkillKey ?? ''}" data-flanking="${flanking}"
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
 * @return {Promise<{hit: boolean, criticalType: string|null, line: string, fpHTML: string, title: string}>}
 */
async function evaluateHitAgainstDefender({
  defender, attacker, mode, rollA, rollB, critA, critB, comparisonType, damageDice, killSkillKey,
}) {
  let chosenTotal = rollA;
  let criticalType = critA;
  let labelKey = 'RollA';
  if (mode !== 'neutral') {
    const qualityA = rollQuality(rollA, critA);
    const qualityB = rollQuality(rollB, critB);
    const pickB = mode === 'advantage' ? qualityB > qualityA : qualityB < qualityA;
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
  const statValue = defender
    ? (comparisonType === 'magicResistance' ? defender.system.magicResistance : defender.system.armorClass)
      + (defenderFlanks ? FLANKING_AC_BONUS : 0)
    : null;

  // With no defender to compare against (forceHit), the attack counts as a
  // hit unconditionally - except a natural critical failure, which always
  // misses regardless of any target's stat, same as with a real defender.
  const hit = defender ? resolveCheckSuccess(chosenTotal, statValue, criticalType) : criticalType !== 'failure';
  let extraHTML = defenderFlanks
    ? `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.FlankingDefenseBonus', { bonus: FLANKING_AC_BONUS, defender: defender.name })}</div>`
    : '';
  if (!defender) {
    extraHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.NoDefenderForcedHit')}</div>`;
  }

  if (criticalType === null && hit) {
    const precision = await maybeRollPrecision(attacker, true);
    if (precision) {
      const precisionRendered = wrapCriticalBlock(await precision.roll.render(), precision.success ? 'success' : null);
      extraHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.PrecisionRoll')}</div>${precisionRendered}`;
      if (precision.success) criticalType = 'success';
    }
  }

  if (criticalType === 'success') {
    const bonusResults = await rollCriticalBonusDamage(attacker, damageDice, comparisonType === 'magicResistance' ? 'spell' : 'weapon');
    if (bonusResults.length) {
      let bonusTotal = 0;
      const bonusEntries = [];
      for (const { damageType, total, html } of bonusResults) {
        const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damageType] ?? damageType);
        extraHTML += `<div class="sksk-roll-line"><strong>${typeLabel} ${game.i18n.localize('SKSK.AttackRoll.CriticalBonusDamage')}</strong></div>${html}`;
        bonusEntries.push({ damageType, amount: total });
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
    extraHTML += renderApplyDamageButton(attacker, [{ damageType: assassinationType, amount: assassinationRoll.total }], killSkillKey);
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
  if (attacker && getStatusStacks(attacker, 'concealed') > 0 && !attacker.system.concealmentNeverBreaksOnAttack
    && (hit || !attacker.system.concealmentBreaksOnlyOnHit)) {
    await setStatusStacks(attacker, 'concealed', 0);
    extraHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.ConcealmentBroken')}</div>`;
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

  return { hit, criticalType, line, fpHTML, title };
}

/**
 * Handle a click on an Angriffswurf's "Evaluate" button: resolves the
 * defender (see helpers/damageApplication.mjs#resolveClickDefender), then
 * prompts for which of the attack's two already-rolled d20s actually counts
 * (see chooseAttackMode) - Neutral always picks Roll A, Vorteil/Nachteil
 * pick whichever of the two ranks better/worse (see rollQuality). Aborts
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
  const defender = resolveClickDefender();
  if (!defender && !forceHit) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const mode = await chooseAttackMode(button.dataset.flanking === 'true' ? 'advantage' : null);
  if (!mode) return;

  const attacker = button.dataset.attackerUuid ? await fromUuid(button.dataset.attackerUuid) : null;
  const damageDice = JSON.parse(decodeURIComponent(button.dataset.damageDice || '[]'));
  const killSkillKey = button.dataset.killSkill || null;

  const { line, fpHTML, title } = await evaluateHitAgainstDefender({
    defender, attacker, mode,
    rollA: Number(button.dataset.rollA), rollB: Number(button.dataset.rollB),
    critA: button.dataset.critA || null, critB: button.dataset.critB || null,
    comparisonType: button.dataset.comparisonType, damageDice, killSkillKey,
  });

  const content = `<div class="sksk-chat-card sksk-action-card">`
    + formatRollCardHeading(title) + line + fpHTML
    + `</div>`;

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender ?? attacker }),
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
 * Halves a set of already-rolled {damageType, amount} entries, rounded
 * down, dropping any that floor to 0 - Spells' own "still deals half
 * damage on a miss, unless Verbesserte Magieresistenz" rule (see
 * autoResolveAttackForTargets below).
 * @param {Array<{damageType: string, amount: number}>} entries
 * @return {Array<{damageType: string, amount: number}>}
 */
function halveDamageEntries(entries) {
  return entries.map(entry => ({ ...entry, amount: Math.floor(entry.amount / 2) })).filter(entry => entry.amount > 0);
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
 * @param {{damageEntries?: Array<{damageType: string, amount: number}>, damageDice?: Array<{damageType: string, dieSizes: number[]}>, killSkillKey?: string|null, flanking?: boolean, techniqueItemUuid?: string|null}} [options]
 * @return {Promise<string>}
 */
export async function autoResolveAttackForTargets([rollA, rollB], comparisonType, attacker, options = {}) {
  const { damageEntries = [], damageDice = [], killSkillKey = null, flanking = false, techniqueItemUuid = null } = options;
  const defenders = getOtherTargetedActors(attacker);
  if (!defenders.length) return '';

  const mode = await chooseAttackMode(flanking ? 'advantage' : null);
  if (!mode) return '';

  const critA = getAttackCriticalType(rollA, attacker);
  const critB = getAttackCriticalType(rollB, attacker);

  const blocks = [];
  for (const defender of defenders) {
    if (!defender.isOwner) {
      requestGmAction('autoResolveHit', {
        defenderUuid: defender.uuid, attackerUuid: attacker?.uuid ?? null, mode,
        rollA: rollA.total, rollB: rollB.total, critA, critB,
        comparisonType, damageDice, killSkillKey, damageEntries, techniqueItemUuid,
      });
      continue;
    }
    const { title, line, fpHTML, damageHTML } = await resolveAndApplyOneAttack(defender, attacker, {
      mode, rollA: rollA.total, rollB: rollB.total, critA, critB, comparisonType, damageDice, killSkillKey, damageEntries, techniqueItemUuid,
    });
    blocks.push(formatRollCardHeading(title) + line + fpHTML + damageHTML);
  }

  return blocks.length ? `<div class="sksk-auto-resolved">${blocks.join('')}</div>` : '';
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
 * @return {Promise<{title: string, line: string, fpHTML: string, damageHTML: string}>}
 */
async function resolveAndApplyOneAttack(defender, attacker, args) {
  const { mode, rollA, rollB, critA, critB, comparisonType, damageDice, killSkillKey, damageEntries, techniqueItemUuid } = args;
  const { hit, line, fpHTML, title } = await evaluateHitAgainstDefender({
    defender, attacker, mode, rollA, rollB, critA, critB, comparisonType, damageDice, killSkillKey,
  });

  let damageHTML = '';
  if (hit) {
    if (damageEntries.length || techniqueItemUuid) {
      const { lines } = await applyResolvedDamageEntries(defender, attacker, damageEntries, killSkillKey, techniqueItemUuid);
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

  return { title, line, fpHTML, damageHTML };
}

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

  const { title, line, fpHTML, damageHTML } = await resolveAndApplyOneAttack(defender, attacker, data);

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: title,
    content: `<div class="sksk-chat-card sksk-action-card sksk-auto-resolved">${formatRollCardHeading(title)}${line}${fpHTML}${damageHTML}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
registerGmRelayAction('autoResolveHit', handleAutoResolveHitRelay);
