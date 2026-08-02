import { getSkillLabel, getActorSkillLevel } from './skills.mjs';

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
 * Render a grantSkillUsageFp result as plain (unwrapped) text - for
 * callers that build their own list of plain-text lines and wrap each in
 * "sksk-roll-line" themselves (e.g. helpers/rest.mjs#applyRest), unlike
 * formatSkillFpGrantLine below which wraps it itself. Empty string if
 * nothing was granted.
 * @param {{label: string, amount: number}|null} grant
 * @return {string}
 */
export function formatSkillFpGrantText(grant) {
  if (!grant) return '';
  return game.i18n.format('SKSK.SkillFp.Gained', { skill: grant.label, amount: grant.amount });
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
  return `<div class="sksk-roll-line">${formatSkillFpGrantText(grant)}</div>`;
}

/**
 * Grant a flat, pre-determined amount of pending FP to a Character for
 * using a skill - unlike grantSkillUsageFp, this isn't scaled by any GM-
 * configured rate (there is none to look up); the amount is decided
 * entirely by the caller, e.g. Mana Core's own per-item/per-spell
 * "manaCoreFpGrant" field (see data/spell.mjs, data/item.mjs). Floored,
 * Character-only, same as grantSkillUsageFp.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {number} amount
 * @return {Promise<{label: string, amount: number}|null>}
 */
export async function grantFlatSkillFp(actor, skillKey, amount) {
  if (!actor || actor.type !== 'character') return null;
  const flatAmount = Math.floor(Number(amount) || 0);
  if (flatAmount <= 0) return null;

  const current = actor.system.skills?.[skillKey]?.gain ?? 0;
  await actor.update({ [`system.skills.${skillKey}.gain`]: current + flatAmount });
  return { label: game.i18n.localize(getSkillLabel(skillKey)), amount: flatAmount };
}

/**
 * Reflexe's own "Reflexaktion" FP trigger: once per Combat turn, the first
 * time a Character with Reflexes at level 1+ has spent at least 4 AP that
 * turn (tracked against system.actionPoints.max as the turn's starting
 * baseline - AP is always refilled to max at turn start, see
 * helpers/statusEffects.mjs#handleActionPointsTurnStart, which also resets
 * system.reflexActionGranted back to false there). Safe to call after
 * every AP-spending action; a no-op once already granted this turn.
 * @param {Actor} actor
 * @return {Promise<{label: string, amount: number}|null>}
 */
export async function checkReflexActionTrigger(actor) {
  if (!actor || actor.type !== 'character') return null;
  if (actor.system.reflexActionGranted) return null;
  if (getActorSkillLevel(actor, 'reflexes') < 1) return null;

  const ap = actor.system.actionPoints;
  const spent = ap.max - ap.value;
  if (spent < 4) return null;

  const grant = await grantSkillUsageFp(actor, 'reflexes', 'reflexActionUsed');
  if (!grant) return null;
  await actor.update({ 'system.reflexActionGranted': true });
  return grant;
}
