import { getActorSkillLevel } from './skills.mjs';
import { applyD20Malus, computeDazedAttributeMalus } from './statusEffects.mjs';
import { chooseGenericRollMode, evaluateD20WithMode, formatD20ModeSummaryLine } from './criticalRolls.mjs';
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
 * Skills whose skill check can be used for more than one narrative purpose
 * - same roll (1d20 + level + attribute modifier(s), unaffected), but a
 * different flavor label and FP trigger depending on what the player says
 * they're doing with it. See chooseSkillRollVariant/rollSkillCheck below.
 * A variant's own "trigger" is looked up in the skillUsageFp world setting
 * exactly like any other (see helpers/skillFp.mjs) - "skillCheck" itself
 * is a valid variant trigger (Fingerfertigkeit's own base roll), used here
 * just like any bespoke one.
 */
const SKILL_ROLL_VARIANTS = {
  // Fallen: setting a trap and disarming one are the same roll, but never
  // its own plain "skillCheck" FP - see apps/skill-usage-fp-config.mjs.
  traps: [
    { trigger: 'trapSet', label: 'SKSK.Skill.Variant.TrapSet' },
    { trigger: 'trapDisarmed', label: 'SKSK.Skill.Variant.TrapDisarmed' },
  ],
  // Fingerfertigkeit: the base roll (its own "skillCheck" FP) is still one
  // of the offered variants, alongside lock-picking and pickpocketing.
  sleightOfHand: [
    { trigger: 'skillCheck', label: 'SKSK.Skill.Variant.SleightOfHandBase' },
    { trigger: 'lockPicked', label: 'SKSK.Skill.Variant.LockPicked' },
    { trigger: 'pickpocket', label: 'SKSK.Skill.Variant.Pickpocket' },
  ],
};

/**
 * Prompt for which variant of a skill's roll is being made, if that skill
 * has any defined (see SKILL_ROLL_VARIANTS) - one button per variant,
 * clicking one both makes the choice and resolves the promise with it,
 * matching the attribute-choice dialog's own one-click pattern (see
 * sheets/actor-sheet.mjs#rollSkill).
 * @param {string} skillKey
 * @param {object} def   The skill's own CONFIG.SKSK.skills[...] entry.
 * @return {Promise<{chosen: boolean, variant: object|null}>} chosen is
 *   false if the skill has variants but the dialog was closed without
 *   picking one (the caller should abort); variant is null both when the
 *   skill has no variants at all (roll proceeds as its own plain
 *   "skillCheck") and when chosen is false.
 */
export async function chooseSkillRollVariant(skillKey, def) {
  const variants = SKILL_ROLL_VARIANTS[skillKey];
  if (!variants) return { chosen: true, variant: null };

  const buttons = variants.map((variant, index) => ({
    action: `variant${index}`,
    label: game.i18n.localize(variant.label),
    callback: () => variant,
  }));
  const variant = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(def.label) },
    content: `<p>${game.i18n.localize('SKSK.Skill.ChooseVariantPrompt')}</p>`,
    buttons,
    rejectClose: false,
  });
  return variant ? { chosen: true, variant } : { chosen: false, variant: null };
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
 * @param {{trigger: string, label: string}|null} [variant]   See
 *   SKILL_ROLL_VARIANTS/chooseSkillRollVariant - null for the skill's own
 *   plain "skillCheck" FP and flavor.
 * @return {Promise<ChatMessage|void>}
 */
export async function rollSkillCheck(actor, skillKey, chosenAttributes, variant = null) {
  const def = getSkillCheckDefinition(skillKey);
  if (!def || !chosenAttributes?.length) return;

  const mode = await chooseGenericRollMode();
  if (!mode) return;

  const level = getActorSkillLevel(actor, skillKey);
  const modTerms = chosenAttributes.map(a => `@attributes.${a}.mod`).join(' + ');
  const baseFormula = `d20 + ${level} + ${modTerms}`;
  const formula = applyD20Malus(baseFormula, actor, pickMalusAttribute(actor, chosenAttributes));

  const result = await evaluateD20WithMode(formula, actor.getRollData(), mode);
  const { roll, criticalType, doubleCritical } = result;
  const label = variant ? `${game.i18n.localize(def.label)} (${game.i18n.localize(variant.label)})` : game.i18n.localize(def.label);

  const fpGrant = await grantSkillUsageFp(actor, skillKey, variant?.trigger ?? 'skillCheck');
  let extraHTML = formatSkillFpGrantLine(fpGrant) + formatD20ModeSummaryLine(result, mode);
  // Luck's own "criticalRoll"/"doubleCriticalRoll" FP - any generic (non-
  // Angriffswurf) D20 roll's critical success/double critical, see
  // helpers/criticalRolls.mjs#evaluateD20WithMode.
  if (criticalType === 'success') {
    extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'criticalRoll'));
  }
  if (doubleCritical) {
    extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'doubleCriticalRoll'));
  }
  return postActionChatCard(actor, `[skill] ${label}`, roll, 0, extraHTML, criticalType);
}
