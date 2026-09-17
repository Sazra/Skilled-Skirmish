/**
 * Every roll this mechanic covers costs AP by default while a Combat is
 * active (see helpers/statusEffects.mjs#isCombatActive, which the actual
 * hasEnoughActionPoints/spendActionPoints calls in helpers/skillRolls.mjs#
 * rollSkillCheck and sheets/actor-sheet.mjs#onRoll already waive entirely
 * outside of Combat) - this is that default, used whenever the GM hasn't
 * configured an explicit rate of their own for a given skill/trigger or
 * attribute via the "skillRollApCost" world setting (see
 * getSkillRollApCostSettings below).
 * @type {number}
 */
export const DEFAULT_AP_COST = 2;

/**
 * The GM-configured AP-cost rates (world setting, edited via the "AP-
 * Kosten für Fertigkeits-/Attributswürfe" settings menu - see
 * apps/skill-roll-ap-cost-config.mjs), split into "skills" (keyed by skill
 * then by trigger - "skillCheck" or one of helpers/skillRolls.mjs#
 * SKILL_ROLL_VARIANTS' own trigger names - and, for a skill with more than
 * one possible attribute (CONFIG.SKSK.skills[...].attributes.length > 1,
 * e.g. Überleben), further keyed by attribute below that instead of a
 * single flat rate) and "attributes" (keyed by CONFIG.SKSK.attributes key,
 * a single flat rate each - a raw attribute check has no variants of its
 * own, see sheets/actor-sheet.mjs#onRoll).
 * @return {{skills: Object<string, Object<string, number|Object<string, number>>>, attributes: Object<string, number>}}
 */
export function getSkillRollApCostSettings() {
  return game.settings.get('sksk', 'skillRollApCost') ?? {};
}

/**
 * A skill's own GM-configured base AP cost for one of its rolls (see
 * getSkillRollApCostSettings) - DEFAULT_AP_COST if nothing's been
 * configured for that exact skill/trigger(/attribute) combination yet. A
 * skill with only one possible attribute stores a single flat rate per
 * trigger (attributeKey is ignored); a skill with more than one possible
 * attribute (see apps/skill-roll-ap-cost-config.mjs#getSkillRollFields)
 * stores one rate per attribute instead, looked up by attributeKey.
 * @param {string} skillKey
 * @param {string} trigger   "skillCheck", or one of SKILL_ROLL_VARIANTS'
 *   own trigger names for a skill that has any.
 * @param {string|null} [attributeKey]   The attribute actually chosen for
 *   this roll - only consulted for a skill with more than one possible
 *   attribute.
 * @return {number}
 */
export function getSkillRollBaseApCost(skillKey, trigger, attributeKey = null) {
  const entry = getSkillRollApCostSettings().skills?.[skillKey]?.[trigger];
  if (entry && typeof entry === 'object') {
    const stored = attributeKey ? entry[attributeKey] : undefined;
    return Number.isFinite(stored) ? stored : DEFAULT_AP_COST;
  }
  return Number.isFinite(entry) ? entry : DEFAULT_AP_COST;
}

/**
 * A raw attribute check's own GM-configured base AP cost (see
 * getSkillRollApCostSettings) - DEFAULT_AP_COST if nothing's been
 * configured for that attribute yet.
 * @param {string} attributeKey   A CONFIG.SKSK.attributes key.
 * @return {number}
 */
export function getAttributeRollBaseApCost(attributeKey) {
  const stored = getSkillRollApCostSettings().attributes?.[attributeKey];
  return Number.isFinite(stored) ? stored : DEFAULT_AP_COST;
}

/**
 * Applies a pair of already-resolved AP/RP modifiers to a base AP-cost
 * rate, floored at 0: the AP modifier shifts BOTH the AP cost and (by the
 * same amount) the RP cost an off-turn roll of the same kind would use; the
 * RP modifier then shifts RP further, on top of and independently from the
 * AP one - e.g. an effect that discounts RP without touching AP at all, or
 * vice versa.
 * @param {number} baseCost
 * @param {number} apModifier
 * @param {number} rpModifier
 * @return {{apCost: number, rpCost: number}}
 */
function applyRollCostModifiers(baseCost, apModifier, rpModifier) {
  return {
    apCost: Math.max(0, baseCost + apModifier),
    rpCost: Math.max(0, baseCost + apModifier + rpModifier),
  };
}

/**
 * An actor's own final AP/RP cost for rolling a given skill check - see
 * applyRollCostModifiers. The modifier applied is the sum of the actor's
 * own flat "...All" accumulator (data/actor-base.mjs#
 * skillRollApCostModifierAll/skillRollRpCostModifierAll - every skill/
 * attribute roll at once) and this specific skill's own per-skill entry
 * (skillRollApCostModifier/skillRollRpCostModifier, keyed by skillKey -
 * same "per-key + flat All" convention as weaponAttackBonus/
 * weaponAttackBonusAll), so a GM can discount either one specific skill or
 * every roll at once, and both stack if both are set. Whichever of AP/RP
 * actually applies (AP on the actor's own turn, RP off it) is for the
 * caller (helpers/skillRolls.mjs#rollSkillCheck) to decide, same as every
 * other AP/RP-costing action in the system (e.g. helpers/actions.mjs#
 * rollMartialArtsAttack). For a skill with more than one possible
 * attribute, an "und/oder" ("combine") skill may have chosen more than one
 * at once (see helpers/skillRolls.mjs#nonEmptyAttributeSubsets) - the
 * highest of their individually configured BASE rates is used, so
 * combining never comes out cheaper than rolling the priciest attribute in
 * the combination alone; the per-skill modifier itself doesn't vary by
 * attribute, so this doesn't affect it.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {string} trigger
 * @param {string[]} [chosenAttributes]   The attribute(s) actually chosen
 *   for this roll (helpers/skillRolls.mjs#rollSkillCheck's own parameter of
 *   the same name) - ignored for a skill with only one possible attribute.
 * @return {{apCost: number, rpCost: number}}
 */
export function computeSkillRollCost(actor, skillKey, trigger, chosenAttributes = []) {
  const base = chosenAttributes.length
    ? Math.max(...chosenAttributes.map(attribute => getSkillRollBaseApCost(skillKey, trigger, attribute)))
    : getSkillRollBaseApCost(skillKey, trigger);
  const apModifier = (actor.system.skillRollApCostModifierAll ?? 0) + (actor.system.skillRollApCostModifier?.[skillKey] ?? 0);
  const rpModifier = (actor.system.skillRollRpCostModifierAll ?? 0) + (actor.system.skillRollRpCostModifier?.[skillKey] ?? 0);
  return applyRollCostModifiers(base, apModifier, rpModifier);
}

/**
 * An actor's own final AP/RP cost for rolling a raw attribute check (see
 * sheets/actor-sheet.mjs#onRoll) - see applyRollCostModifiers and
 * computeSkillRollCost's own identical "...All" + per-key convention;
 * shares the same flat "...All" accumulators as computeSkillRollCost
 * above (every roll of either kind at once), but its own separate per-
 * attribute fields (attributeRollApCostModifier/attributeRollRpCostModifier,
 * keyed by attributeKey), since a raw attribute check has no skill of its
 * own to key a per-skill modifier by.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {{apCost: number, rpCost: number}}
 */
export function computeAttributeRollCost(actor, attributeKey) {
  const base = getAttributeRollBaseApCost(attributeKey);
  const apModifier = (actor.system.skillRollApCostModifierAll ?? 0) + (actor.system.attributeRollApCostModifier?.[attributeKey] ?? 0);
  const rpModifier = (actor.system.skillRollRpCostModifierAll ?? 0) + (actor.system.attributeRollRpCostModifier?.[attributeKey] ?? 0);
  return applyRollCostModifiers(base, apModifier, rpModifier);
}
