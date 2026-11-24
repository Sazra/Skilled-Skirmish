/**
 * Vorteil/Nachteil EMPFEHLUNGEN for the roll dialogs. Nothing here ever forces
 * or preselects a mode: the dialogs only mark the recommended button
 * "(empfohlen)", the player can always still choose Vorteil/Neutral/Nachteil.
 *
 * Every Active Effect key (system.attributeRollAdvantage.<attr>,
 * system.skillRollAdvantage.<skill>, system.weaponAttackAdvantage.<weapon>,
 * system.allRollsAdvantage, system.attackAdvantageAll,
 * system.weaponAttackAdvantageAll, system.spellAttackAdvantageAll) adds +1
 * (Vorteil) or -1 (Nachteil) to a score; flanking adds +1. The sign of the
 * summed score is the recommendation - stacked sources outweigh each other,
 * a tie (score 0) recommends nothing.
 */

/**
 * The recommendation a score stands for.
 * @param {number} score
 * @return {"advantage"|"disadvantage"|null}
 */
export function recommendationFromScore(score) {
  if (score > 0) return 'advantage';
  if (score < 0) return 'disadvantage';
  return null;
}

/**
 * Combined score of several recommendation sources.
 * @param {...number} parts
 * @return {number}
 */
function sum(...parts) {
  return parts.reduce((total, part) => total + (Number(part) || 0), 0);
}

/**
 * Score for a plain (non-attack) D20 roll.
 * @param {Actor} actor
 * @param {{attributes?: string[], skillKey?: string|null}} [options]
 *   attributes: the attribute(s) the roll uses (each one's key counts);
 *   skillKey: the skill the roll is a check of.
 * @return {number}
 */
export function getRollScore(actor, { attributes = [], skillKey = null } = {}) {
  const system = actor?.system;
  if (!system) return 0;
  return sum(
    system.allRollsAdvantage,
    ...attributes.map(key => system.attributeRollAdvantage?.[key]),
    skillKey ? system.skillRollAdvantage?.[skillKey] : 0,
  );
}

/**
 * Recommended mode for a plain D20 roll (attribute check, skill check).
 * @param {Actor} actor
 * @param {{attributes?: string[], skillKey?: string|null}} [options]
 * @return {"advantage"|"disadvantage"|null}
 */
export function recommendRollMode(actor, options = {}) {
  return recommendationFromScore(getRollScore(actor, options));
}

/**
 * Recommended mode for a saving throw / check that uses the best of several
 * tested attributes and skills - the same one the roll itself picks (highest
 * attribute modifier or skill level, the first of equals), so the
 * recommendation belongs to the option that is actually rolled.
 * @param {Actor} actor
 * @param {{testAttributes?: object, testSkills?: string[], modField?: string,
 *   getSkillLevel?: function(string): number}} options
 *   testAttributes: {attributeKey: boolean}; getSkillLevel resolves a skill's level.
 * @return {"advantage"|"disadvantage"|null}
 */
export function recommendSaveMode(actor, { testAttributes = {}, testSkills = [], modField = 'mod', getSkillLevel = () => 0 } = {}) {
  let best = null;
  for (const [attributeKey, enabled] of Object.entries(testAttributes ?? {})) {
    if (!enabled) continue;
    const value = actor?.system?.attributes?.[attributeKey]?.[modField] ?? 0;
    if (!best || value > best.value) best = { value, attributes: [attributeKey], skillKey: null };
  }
  for (const skillKey of testSkills ?? []) {
    const value = getSkillLevel(skillKey);
    if (!best || value > best.value) best = { value, attributes: [], skillKey };
  }
  return recommendRollMode(actor, best ?? {});
}

/**
 * Recommended mode for an Angriffswurf's evaluation.
 * @param {Actor|null} attacker
 * @param {{comparisonType?: string, killSkillKey?: string|null, flanking?: boolean}} [options]
 *   comparisonType "armorClass" = weapon/Martial Arts attack (killSkillKey is
 *   the weapon skill), "magicResistance" = spell attack.
 * @return {"advantage"|"disadvantage"|null}
 */
export function recommendAttackMode(attacker, { comparisonType = 'armorClass', killSkillKey = null, flanking = false } = {}) {
  const system = attacker?.system;
  let score = flanking ? 1 : 0;
  if (system) {
    score += sum(system.allRollsAdvantage, system.attackAdvantageAll);
    if (comparisonType === 'magicResistance') {
      score += sum(system.spellAttackAdvantageAll);
    } else {
      score += sum(system.weaponAttackAdvantageAll, killSkillKey ? system.weaponAttackAdvantage?.[killSkillKey] : 0);
    }
  }
  return recommendationFromScore(score);
}
