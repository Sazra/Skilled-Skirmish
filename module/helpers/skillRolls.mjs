import { getActorSkillLevel } from './skills.mjs';
import { applyD20Malus, computeDazedAttributeMalus } from './statusEffects.mjs';
import { getGenericCriticalType } from './criticalRolls.mjs';
import { postActionChatCard } from './actions.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';

/**
 * The skill's own config entry (CONFIG.SKSK.skills[category][skillKey]) if
 * it carries a skill check - i.e. has at least one attribute assigned via
 * the design spreadsheet's "Attributsnutzung" column ("Überarbeitung
 * Fertigkeiten" tab). Binary/stackable skills, and any skill marked "/"
 * there (Immunities, Absorptions, Weaknesses, Luck, Massacre, Immortal,
 * the "Verbessert X" attribute-boost skills), have no such entry and so
 * offer no roll at all.
 * @param {string} skillKey
 * @return {object|null}
 */
export function getSkillCheckDefinition(skillKey) {
  for (const category of Object.values(CONFIG.SKSK.skills)) {
    const def = category[skillKey];
    if (def) return def.attributes?.length ? def : null;
  }
  return null;
}

/**
 * Every non-empty subset of the given attributes, smallest first - used to
 * offer one button per valid combination for an "und/oder" ("combine")
 * skill check, since the player may want any subset of its attributes
 * summed together, not just one at a time.
 * @param {string[]} attributes
 * @return {string[][]}
 */
export function nonEmptyAttributeSubsets(attributes) {
  const subsets = [];
  for (let mask = 1; mask < (1 << attributes.length); mask++) {
    subsets.push(attributes.filter((_, i) => mask & (1 << i)));
  }
  subsets.sort((a, b) => a.length - b.length);
  return subsets;
}

/**
 * Which of the given attributes to blame Dazed's own malus on, if any of
 * them is one it targets (Strength/Dexterity/Constitution/Appearance) -
 * applyD20Malus is only ever called once per roll (see rollSkillCheck), so
 * Exhaustion's universal malus doesn't get double/triple-counted when a
 * "und/oder" skill combines multiple attributes.
 * @param {Actor} actor
 * @param {string[]} attributes
 * @return {string|null}
 */
function pickMalusAttribute(actor, attributes) {
  return attributes.find(a => computeDazedAttributeMalus(actor, a) !== 0) ?? attributes[0] ?? null;
}

/**
 * Roll a skill check: 1d20 + the skill's current level + the modifier(s)
 * of the chosen attribute(s). "Oder" skills (CONFIG.SKSK.skills[...]
 * .attributeMode "choice") pass a single chosen attribute; "und/oder"
 * skills ("combine") may pass several, each summed in - see
 * sheets/actor-sheet.mjs#rollSkill for where that choice is gathered.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {string[]} chosenAttributes   A non-empty subset of the skill's own .attributes.
 * @return {Promise<ChatMessage|void>}
 */
export async function rollSkillCheck(actor, skillKey, chosenAttributes) {
  const def = getSkillCheckDefinition(skillKey);
  if (!def || !chosenAttributes?.length) return;

  const level = getActorSkillLevel(actor, skillKey);
  const modTerms = chosenAttributes.map(a => `@attributes.${a}.mod`).join(' + ');
  const baseFormula = `d20 + ${level} + ${modTerms}`;
  const formula = applyD20Malus(baseFormula, actor, pickMalusAttribute(actor, chosenAttributes));

  const roll = await new Roll(formula, actor.getRollData()).evaluate();
  const criticalType = getGenericCriticalType(roll);
  const label = game.i18n.localize(def.label);

  const fpGrant = await grantSkillUsageFp(actor, skillKey, 'skillCheck');
  return postActionChatCard(actor, `[skill] ${label}`, roll, 0, formatSkillFpGrantLine(fpGrant), criticalType);
}
