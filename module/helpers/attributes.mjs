import { getActorSkillLevel, isActorSkillUnlocked } from './skills.mjs';

/**
 * Sum of the Aura value granted by every Species item (main and sub) an
 * actor holds - see data/species.mjs#aura. Written back to
 * system.attributes.aur.value whenever a Species item is added (see
 * sksk.mjs's "createItem" hook), rather than recomputed on every data
 * preparation, since Aura otherwise stays a normal user-editable attribute.
 * @param {Actor} actor
 * @return {number}
 */
export function computeSpeciesAura(actor) {
  return actor.items
    .filter(i => i.type === 'species')
    .reduce((sum, i) => sum + (i.system.aura ?? 0), 0);
}

/**
 * The bonus a single attribute's own roll gets from the "Verbessert X"
 * skills (CONFIG.SKSK.skills.attribute/special) - these have no skill
 * check of their own (see helpers/skillRolls.mjs#getSkillCheckDefinition),
 * but instead improve that one attribute's "reiner" roll directly, not any
 * skill check that merely uses the attribute as one of its modifiers:
 * - Each "Unbegrenzte X" skill (CONFIG.SKSK.unlimitedAttributeSkills) adds
 *   its own level to that one attribute only.
 * - Corpus Immortalis ("Verbessert alle Attribute") adds its own level to
 *   every attribute at once, the same way.
 * - Umlimitiert ("Verbessert alle Attributswürfe um 2") is binary, not
 *   levelled - a flat +2 to every attribute at once while active.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {number}
 */
export function computeUnlimitedAttributeBonus(actor, attributeKey) {
  let bonus = 0;

  const perAttributeSkill = CONFIG.SKSK.unlimitedAttributeSkills[attributeKey];
  if (perAttributeSkill) bonus += getActorSkillLevel(actor, perAttributeSkill);

  bonus += getActorSkillLevel(actor, 'corpusImmortalis');

  if (isActorSkillUnlocked(actor, 'unlimited')) bonus += 2;

  return bonus;
}
