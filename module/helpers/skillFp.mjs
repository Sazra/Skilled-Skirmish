import { getSkillLabel } from './skills.mjs';

/**
 * The GM-configured FP-per-usage rates (world setting, edited via the
 * Skill Usage FP settings menu - see apps/skill-usage-fp-config.mjs), keyed
 * by skill then by trigger (e.g. {axe: {skillCheck: 1, weaponAttack: 2}}).
 * A rate may be fractional - floored at grant time, see grantSkillUsageFp.
 * @return {Object<string, Object<string, number>>}
 */
export function getSkillUsageFpSettings() {
  return game.settings.get('sksk', 'skillUsageFp') ?? {};
}

/**
 * A single skill's configured FP rate for one usage trigger (e.g. "axe"/
 * "weaponAttack"), 0 if unset.
 * @param {string} skillKey
 * @param {string} trigger
 * @return {number}
 */
export function getSkillFpRate(skillKey, trigger) {
  return Number(getSkillUsageFpSettings()[skillKey]?.[trigger]) || 0;
}

/**
 * Grant pending FP ("gain" - see data/actor-base.mjs, integrated into real
 * skill points on the next Anpassungs-/Genesungspause, same as
 * helpers/training.mjs) to a Character for using a skill, per the GM's
 * configured skillUsageFp rate for the given trigger - floor(rate *
 * multiplier), e.g. a per-spell-level rate times the spell's own level.
 * NPCs never generate FP this way (same restriction as Training).
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {string} trigger        E.g. "skillCheck", "weaponAttack", "hitTaken",
 *   "spellCastPerLevel", "attributeRoll" - see apps/skill-usage-fp-config.mjs.
 * @param {number} [multiplier=1]
 * @return {Promise<{label: string, amount: number}|null>} What was granted,
 *   for the caller to append a chat line with (see formatSkillFpGrantLine) -
 *   null if nothing was (NPC, no configured rate, or floors to 0).
 */
export async function grantSkillUsageFp(actor, skillKey, trigger, multiplier = 1) {
  if (!actor || actor.type !== 'character') return null;
  const amount = Math.floor(getSkillFpRate(skillKey, trigger) * multiplier);
  if (amount <= 0) return null;

  const current = actor.system.skills?.[skillKey]?.gain ?? 0;
  await actor.update({ [`system.skills.${skillKey}.gain`]: current + amount });
  return { label: game.i18n.localize(getSkillLabel(skillKey)), amount };
}

/**
 * Render a grantSkillUsageFp result as a chat-card line, matching the style
 * used for Training's own FP grants (helpers/training.mjs). Empty string if
 * nothing was granted.
 * @param {{label: string, amount: number}|null} grant
 * @return {string}
 */
export function formatSkillFpGrantLine(grant) {
  if (!grant) return '';
  return `<div class="sksk-roll-line">${game.i18n.format('SKSK.SkillFp.Gained', { skill: grant.label, amount: grant.amount })}</div>`;
}
