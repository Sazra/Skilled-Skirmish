import { getActorSkillLevel } from './skills.mjs';
import { applyD20Malus, computeDazedAttributeMalus, isActorsOwnTurn } from './statusEffects.mjs';
import { chooseGenericRollMode, evaluateD20WithMode, formatD20ModeSummaryLine } from './criticalRolls.mjs';
import {
  postActionChatCard, hasEnoughActionPoints, hasEnoughReactionPoints, spendActionPoints, spendReactionPoints,
} from './actions.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';
import { computePatronRollBonus } from './religion.mjs';
import { computeSkillRollCost } from './skillRollCost.mjs';
import { SKSKSkillRollDialog } from '../apps/skill-roll-dialog.mjs';
import { renderRerollButton, wrapRerollIcons } from './luck.mjs';
import { renderAttributeRerollButton } from './attributeReroll.mjs';

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
 * just like any bespoke one. Exported so apps/skill-roll-ap-cost-config.mjs
 * can reuse the exact same list of options for its own AP-cost fields,
 * rather than duplicating it.
 */
export const SKILL_ROLL_VARIANTS = {
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
 * A chosen variant's own "what's actually being done" chat-card
 * description key (SKSK.Skill.Variant.*Description, interpolating
 * {name}) - only the variants with an obvious in-fiction action get one
 * (Fallen's own two, Fingerfertigkeit's lock-picking/pickpocketing);
 * Fingerfertigkeit's own plain base check has no narrative action to
 * describe, so it's omitted here (falls through to no description line at
 * all, same as any skill with no variants).
 */
const SKILL_ROLL_VARIANT_DESCRIPTIONS = {
  trapSet: 'SKSK.Skill.Variant.TrapSetDescription',
  trapDisarmed: 'SKSK.Skill.Variant.TrapDisarmedDescription',
  lockPicked: 'SKSK.Skill.Variant.LockPickedDescription',
  pickpocket: 'SKSK.Skill.Variant.PickpocketDescription',
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
 * Combined "which attribute(s), then which roll mode" prompt for a skill
 * with more than one possible attribute (def.attributes.length > 1 - see
 * sheets/actor-sheet.mjs#rollSkill) - both choices in ONE dialog (see
 * apps/skill-roll-dialog.mjs), instead of an attribute-choice dialog
 * immediately followed by rollSkillCheck's own separate Neutral/Vorteil/
 * Nachteil one (chooseGenericRollMode). A skill with only one fixed
 * attribute has nothing to combine this with, so it still only ever shows
 * that one mode dialog on its own, unchanged - see #rollSkill.
 *
 * An "oder" skill (attributeMode "choice") offers one option per individual
 * attribute; an "und/oder" skill ("combine") instead offers one option per
 * non-empty combination of its attributes (each summed together, see
 * nonEmptyAttributeSubsets), since the player may want any subset, not just
 * a single attribute.
 * @param {string} skillKey
 * @param {object} def   The skill's own CONFIG.SKSK.skills[...] entry.
 * @return {Promise<{attributes: string[], mode: string}|null>} null if the
 *   dialog was closed without confirming - the caller should abort.
 */
export async function chooseSkillRollAttributeAndMode(skillKey, def) {
  const isCombine = def.attributeMode === 'combine';
  const options = isCombine ? nonEmptyAttributeSubsets(def.attributes) : def.attributes.map(a => [a]);
  const attributeOptions = options.map((option, index) => ({
    index, label: option.map(a => game.i18n.localize(CONFIG.SKSK.attributes[a])).join(' + '),
  }));
  const promptKey = isCombine ? 'SKSK.Skill.CombineAttributePrompt' : 'SKSK.Skill.ChooseAttributePrompt';

  const result = await SKSKSkillRollDialog.wait(game.i18n.localize(def.label), promptKey, attributeOptions);
  if (!result) return null;
  return { attributes: options[result.index], mode: result.mode };
}

/**
 * Roll a skill check: 1d20 + the skill's current level + the modifier(s)
 * of the chosen attribute(s). Costs its own AP (on the actor's own turn)
 * or RP (off it) while a Combat is active - see helpers/skillRollCost.mjs#
 * computeSkillRollCost, waived entirely outside of Combat - aborting with
 * a warning (no roll, no cost deducted) if unaffordable. "Oder" skills
 * (CONFIG.SKSK.skills[...].attributeMode "choice") pass a single chosen
 * attribute; "und/oder" skills ("combine") may pass several, each summed
 * in - see
 * sheets/actor-sheet.mjs#rollSkill for where that choice is gathered.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {string[]} chosenAttributes   A non-empty subset of the skill's own .attributes.
 * @param {{trigger: string, label: string}|null} [variant]   See
 *   SKILL_ROLL_VARIANTS/chooseSkillRollVariant - null for the skill's own
 *   plain "skillCheck" FP and flavor.
 * @param {boolean} [ignoreSpecial]   Shift+click on the roll button (see
 *   sheets/actor-sheet.mjs#rollSkill) - excludes Spezial-Boni from every
 *   chosen attribute's modifier for this one roll (Modifikator-Boni still
 *   apply).
 * @param {string|null} [presetMode]   A roll mode already chosen alongside
 *   the attribute(s) themselves, for a skill with more than one possible
 *   attribute (see chooseSkillRollAttributeAndMode) - skips this function's
 *   own chooseGenericRollMode dialog entirely rather than asking twice. A
 *   skill with only one fixed attribute never has one, and still prompts
 *   here as before.
 * @return {Promise<ChatMessage|void>}
 */
export async function rollSkillCheck(actor, skillKey, chosenAttributes, variant = null, ignoreSpecial = false, presetMode = null) {
  const def = getSkillCheckDefinition(skillKey);
  if (!def || !chosenAttributes?.length) return;

  // Rolling a skill in Combat costs its own AP (on the actor's own turn) or
  // RP (off it) - see helpers/skillRollCost.mjs, waived entirely outside of
  // Combat (hasEnoughActionPoints/hasEnoughReactionPoints's own convention).
  // Checked before anything else so an unaffordable roll aborts up front,
  // same as every other AP/RP-costing action in the system.
  const trigger = variant?.trigger ?? 'skillCheck';
  const offTurn = !isActorsOwnTurn(actor);
  const { apCost, rpCost } = computeSkillRollCost(actor, skillKey, trigger, chosenAttributes);
  if (offTurn ? !hasEnoughReactionPoints(actor, rpCost) : !hasEnoughActionPoints(actor, apCost)) return;

  const mode = presetMode ?? await chooseGenericRollMode();
  if (!mode) return;

  const level = getActorSkillLevel(actor, skillKey) + (actor.system.skillRollBonus?.[skillKey] ?? 0)
    + computePatronRollBonus(actor, skillKey);
  const modField = ignoreSpecial ? 'modExcludingSpecial' : 'mod';
  const modTerms = chosenAttributes.map(a => `@attributes.${a}.${modField}`).join(' + ');
  const baseFormula = `d20 + ${level} + ${modTerms}`;
  const formula = applyD20Malus(baseFormula, actor, pickMalusAttribute(actor, chosenAttributes));

  const result = await evaluateD20WithMode(formula, actor.getRollData(), mode);
  const { roll, criticalType, doubleCritical } = result;
  await actor.update(offTurn ? spendReactionPoints(actor, rpCost) : spendActionPoints(actor, apCost));
  // The heading is always just the skill's own name (see rollCard.mjs#
  // formatRollCardHeading) - a chosen variant's own "what's being done"
  // sentence goes in the description instead, see below, rather than
  // parenthesized onto the heading.
  const label = game.i18n.localize(def.label);

  const fpGrant = await grantSkillUsageFp(actor, skillKey, trigger);
  const descriptionKey = variant ? SKILL_ROLL_VARIANT_DESCRIPTIONS[variant.trigger] : null;
  const descriptionHTML = descriptionKey
    ? `<div class="sksk-roll-description">${game.i18n.format(descriptionKey, { name: actor.name })}</div>`
    : '';
  let extraHTML = descriptionHTML + formatSkillFpGrantLine(fpGrant) + formatD20ModeSummaryLine(result, mode);
  // Luck's own "criticalRoll"/"doubleCriticalRoll" FP - any generic (non-
  // Angriffswurf) D20 roll's critical success/double critical, see
  // helpers/criticalRolls.mjs#evaluateD20WithMode.
  if (criticalType === 'success') {
    extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'criticalRoll'));
  }
  if (doubleCritical) {
    extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'doubleCriticalRoll'));
  }
  const rerollPayload = { formula, mode, label, attributeKeys: chosenAttributes };
  const rerollIcons = renderAttributeRerollButton(actor, chosenAttributes, rerollPayload) + renderRerollButton(actor, 'generic', rerollPayload);
  return postActionChatCard(
    actor, `[skill] ${label}`, roll, offTurn ? 0 : apCost, extraHTML, criticalType, offTurn ? rpCost : 0, wrapRerollIcons(rerollIcons)
  );
}
