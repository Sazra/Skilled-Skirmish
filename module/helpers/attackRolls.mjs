import { getActorSkillLevel } from './skills.mjs';
import { computeLehrenTargetBonus } from './lehren.mjs';
import { getSpellSchool } from './spells.mjs';
import { computeNaturalMaterialBonus } from './defense.mjs';
import { applyD20Malus, getStatusStacks } from './statusEffects.mjs';
import { getAttackCriticalType, resolveCheckSuccess, wrapCriticalBlock, wrapCriticalInline, rollQuality } from './criticalRolls.mjs';
import { formatRollCardHeading } from './rollCard.mjs';
import { getEquippedArmorSkillKeys } from './defense.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';
import { resolveClickDefender, renderApplyDamageButton } from './damageApplication.mjs';
import { checkFlanking } from './flanking.mjs';

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
    return wilMod + schoolLevel + hitCorrection + schoolBonus + lehrenBonus + allSpellsBonus;
  }

  if (spellSystem.spellType === 'combined') {
    const schoolBonus = actor.system.combinedMagicSchoolAttackBonus?.[spellSystem.combinedSchool] ?? 0;
    const lehrenBonus = computeLehrenTargetBonus(actor, 'attackBonus', { skillKey: null, kind: 'spell' });
    return wilMod + hitCorrection + schoolBonus + computeCombinedSkillAttackBonus(spellSystem, actor) + lehrenBonus + allSpellsBonus;
  }

  // Systemless.
  const lehrenBonus = computeLehrenTargetBonus(actor, 'attackBonus', { skillKey: null, kind: 'spell' });
  return wilMod + hitCorrection + getActorSkillLevel(actor, 'magicControl') + lehrenBonus + allSpellsBonus;
}

/**
 * The attribute keys a weapon's Angriffswurf (attack roll) attribute bonus
 * draws from - its own attributeOverride if enabled (a unique variant of a
 * shared Model), otherwise its resolvedModel's own attributes list.
 * @param {object} weaponSystem
 * @return {string[]}
 */
function getWeaponAttributeKeys(weaponSystem) {
  if (weaponSystem.attributeOverride?.enabled) {
    return Object.entries(weaponSystem.attributeOverride.attributes ?? {})
      .filter(([, checked]) => checked).map(([key]) => key);
  }
  return weaponSystem.resolvedModel?.attributes ?? [];
}

/**
 * A weapon's damage type (for Resistance/Weakness/Immunity/Absorption
 * purposes - see helpers/defense.mjs#applyElementalDefense) - its own
 * damageTypeOverride if enabled (a unique variant of a shared Model),
 * otherwise its resolvedModel's own damageType, falling back to "blunt" if
 * neither is set (e.g. no Model selected at all).
 * @param {object} weaponSystem
 * @return {string}
 */
export function getWeaponDamageType(weaponSystem) {
  if (weaponSystem.damageTypeOverride?.enabled) return weaponSystem.damageTypeOverride.damageType;
  return weaponSystem.resolvedModel?.damageType ?? 'blunt';
}

/**
 * A weapon's attack-bonus attribute contribution - Masterful uses
 * highestOrSumIfAllTied; Refined/Specialized/no property just take the
 * highest (ties don't stack), with Specialized doubling the result.
 * @param {Actor} actor
 * @param {object} weaponSystem
 * @return {number}
 */
function computeWeaponAttributeBonus(actor, weaponSystem) {
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
 * two d20s rolled for it: its matching weapon skill + its material's
 * attack bonus + its resolved Model's flat bonus + its attribute bonus
 * (see computeWeaponAttributeBonus).
 * @param {Actor} actor
 * @param {Item} weaponItem
 * @return {number}
 */
export function computeWeaponAttackBonus(actor, weaponItem) {
  const system = weaponItem.system;
  const skillLevel = getActorSkillLevel(actor, system.weaponType);
  const materialBonus = system.materialAttackBonus ?? 0;
  const modelFlat = system.resolvedModel?.flatBonus ?? 0;
  const attributeBonus = computeWeaponAttributeBonus(actor, system);
  const lehrenBonus = computeLehrenTargetBonus(actor, 'attackBonus', { skillKey: system.weaponType, kind: 'weapon' });
  const weaponTypeBonus = actor.system.weaponAttackBonus?.[system.weaponType] ?? 0;
  const allWeaponsBonus = actor.system.weaponAttackBonusAll ?? 0;
  return skillLevel + materialBonus + modelFlat + attributeBonus + lehrenBonus + weaponTypeBonus + allWeaponsBonus;
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
  const keys = Object.entries(attack.attributes ?? {}).filter(([, checked]) => checked).map(([key]) => key);
  const mods = keys.map(key => actor.system.attributes?.[key]?.mod ?? 0);
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
  return skillLevel + materialBonus + attributeBonus + lehrenBonus + weaponTypeBonus + allWeaponsBonus;
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
 * @param {Actor|null} actor
 * @param {Array<{damageType: string, dieSizes: number[]}>} damageDice
 * @return {Promise<Array<{damageType: string, roll: Roll}>>}
 */
export async function rollCriticalBonusDamage(actor, damageDice) {
  const diceCount = 1 + (actor ? getActorSkillLevel(actor, 'brutality') : 0);
  const results = [];
  for (const { damageType, dieSizes } of damageDice) {
    if (!dieSizes.length) continue;
    const formula = dieSizes.map(size => `${diceCount}d${size}`).join(' + ');
    const roll = await new Roll(formula, actor?.getRollData()).evaluate();
    results.push({ damageType, roll });
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
 * @param {[Roll, Roll]} rolls
 * @param {"armorClass"|"magicResistance"} comparisonType
 * @param {Actor|null} actor   The attacker, whose own critical thresholds apply.
 * @param {{damageDice?: Array<{damageType: string, dieSizes: number[]}>, killSkillKey?: string|null, flanking?: boolean}} [damageInfo]
 * @return {Promise<string>}
 */
export async function renderAttackPairHTML([rollA, rollB], comparisonType, actor, damageInfo = {}) {
  const { damageDice = [], killSkillKey = null, flanking = false } = damageInfo;
  const critA = getAttackCriticalType(rollA, actor);
  const critB = getAttackCriticalType(rollB, actor);
  const renderedA = wrapCriticalBlock(await rollA.render(), critA);
  const renderedB = wrapCriticalBlock(await rollB.render(), critB);
  return `
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
      data-kill-skill="${killSkillKey ?? ''}" data-flanking="${flanking}">
      ${game.i18n.localize('SKSK.AttackRoll.Evaluate')}
    </button>
  `;
}

/**
 * Handle a click on an Angriffswurf's "Evaluate" button: resolves the
 * defender (see helpers/damageApplication.mjs#resolveClickDefender), then
 * prompts for which of the attack's two already-rolled d20s actually counts
 * (see chooseAttackMode) - Neutral always picks Roll A, Vorteil/Nachteil
 * pick whichever of the two ranks better/worse (see rollQuality). Aborts
 * silently (no chat message) if either no defender could be resolved or the
 * mode dialog was closed without a choice.
 *
 * The chosen roll alone is compared against the defender's Armor Class or
 * Magic Resistance (per the button's own data-comparison-type) - a critical
 * success/failure there always hits/always misses regardless of the total.
 * An ordinary (non-critical) hit additionally gives the attacker's own
 * Präzision a chance to retroactively promote it to a critical success (see
 * maybeRollPrecision); either way, a critical success here rolls Brutality's
 * bonus damage (see rollCriticalBonusDamage) - always deferred to this one
 * moment, never at roll time, since which roll even counts wasn't known
 * until now. Independently, ANY confirmed hit (crit or not) while the
 * attacker has the Concealed status rolls Attentat's (Assassination's) own
 * bonus damage too (see rollAssassinationBonusDamage), of the attack's own
 * first damage type - stacks with Brutality's bonus rather than replacing it.
 * For a weapon/Martial Arts attack specifically (killSkillKey set), this also
 * grants the attacker's Attentat skill its own "assassinationAttack" FP.
 *
 * For a weapon/Martial Arts attack (comparisonType "armorClass", not a
 * spell's "magicResistance"), this also grants the "hitTaken" FP trigger
 * (see helpers/skillFp.mjs) to every armor-category skill the defender
 * currently has equipped (body armor + Shield - see helpers/defense.mjs#
 * getEquippedArmorSkillKeys), regardless of hit or miss (suffering an
 * evaluated attack against one's own AC at all is what counts here).
 *
 * The chosen roll's own final outcome grants further FP: "attackHit"
 * (Trefferkorrektur) to the attacker on a hit, "attackDefended"
 * (Verteidigungskorrektur) to the defender on a miss, and "criticalHit"
 * (Präzision) to the attacker on a critical success - plus, independent of
 * which roll was chosen, a bonus "doubleCriticalHit" grant if BOTH raw d20s
 * were natural criticals AND the mode was Vorteil or Nachteil (never
 * Neutral, where Roll B was never really part of the attack to begin with).
 * @param {HTMLElement} button
 * @return {Promise<ChatMessage|void>}
 */
export async function resolveHitEvaluationFromChat(button) {
  const defender = resolveClickDefender();
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const mode = await chooseAttackMode(button.dataset.flanking === 'true' ? 'advantage' : null);
  if (!mode) return;

  const attacker = button.dataset.attackerUuid ? await fromUuid(button.dataset.attackerUuid) : null;
  const damageDice = JSON.parse(decodeURIComponent(button.dataset.damageDice || '[]'));
  const killSkillKey = button.dataset.killSkill || null;

  const rollA = Number(button.dataset.rollA);
  const rollB = Number(button.dataset.rollB);
  const critA = button.dataset.critA || null;
  const critB = button.dataset.critB || null;

  let chosenTotal = rollA;
  let criticalType = critA;
  let labelKey = 'RollA';
  if (mode !== 'neutral') {
    const qualityA = rollQuality(rollA, critA);
    const qualityB = rollQuality(rollB, critB);
    const pickB = mode === 'advantage' ? qualityB > qualityA : qualityB < qualityA;
    if (pickB) { chosenTotal = rollB; criticalType = critB; labelKey = 'RollB'; }
  }

  const comparisonType = button.dataset.comparisonType;
  const statLabel = game.i18n.localize(comparisonType === 'magicResistance' ? 'SKSK.Resource.MR' : 'SKSK.Resource.AC');

  // Tactic level 10 (see helpers/flanking.mjs): the defender gets a flat AC
  // bonus specifically against an attacker it is itself flanking - checked
  // from the defender's own side, symmetric to the attacker's own flanking
  // bonus above. AC-only, never applies to a magicResistance comparison.
  const defenderFlanks = comparisonType === 'armorClass' && attacker
    && getActorSkillLevel(defender, 'tactic') >= 10 && checkFlanking(defender, attacker).flanking;
  const statValue = (comparisonType === 'magicResistance' ? defender.system.magicResistance : defender.system.armorClass)
    + (defenderFlanks ? FLANKING_AC_BONUS : 0);

  const hit = resolveCheckSuccess(chosenTotal, statValue, criticalType);
  let extraHTML = defenderFlanks
    ? `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.FlankingDefenseBonus', { bonus: FLANKING_AC_BONUS, defender: defender.name })}</div>`
    : '';

  if (criticalType === null && hit) {
    const precision = await maybeRollPrecision(attacker, true);
    if (precision) {
      const precisionRendered = wrapCriticalBlock(await precision.roll.render(), precision.success ? 'success' : null);
      extraHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.PrecisionRoll')}</div>${precisionRendered}`;
      if (precision.success) criticalType = 'success';
    }
  }

  if (criticalType === 'success') {
    const bonusResults = await rollCriticalBonusDamage(attacker, damageDice);
    if (bonusResults.length) {
      let bonusTotal = 0;
      const bonusEntries = [];
      for (const { damageType, roll } of bonusResults) {
        const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damageType] ?? damageType);
        extraHTML += `<div class="sksk-roll-line"><strong>${typeLabel} ${game.i18n.localize('SKSK.AttackRoll.CriticalBonusDamage')}</strong></div>${await roll.render()}`;
        bonusEntries.push({ damageType, amount: roll.total });
        bonusTotal += roll.total;
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
  const line = `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.EvaluationLine', {
    label: rollLabel, total: chosenTotal, statLabel, statValue, outcome,
  })}</div>${extraHTML}`;

  let fpHTML = '';
  if (comparisonType === 'armorClass') {
    for (const skillKey of getEquippedArmorSkillKeys(defender)) {
      fpHTML += formatSkillFpGrantLine(await grantSkillUsageFp(defender, skillKey, 'hitTaken'));
    }
  }
  if (mode !== 'neutral' && critA === 'success' && critB === 'success') {
    fpHTML += formatSkillFpGrantLine(await grantSkillUsageFp(attacker, 'precision', 'doubleCriticalHit'));
  }

  const title = game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: defender.name });
  const content = `<div class="sksk-chat-card sksk-action-card">`
    + formatRollCardHeading(title) + line + fpHTML
    + `</div>`;

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: title,
    content,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
