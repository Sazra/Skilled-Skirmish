import { getActorSkillLevel } from './skills.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';
import { postActionChatCard } from './actions.mjs';

/**
 * Massacre's own kill-count tiers (GM tab buttons, apps/skill-usage-fp-
 * config.mjs) - the design's own "kill this many people within (roughly) 10
 * minutes" thresholds; the time window itself is intentionally not tracked,
 * this is a fully manual, GM-judgment call. Each tier's FP grant depends on
 * the actor's own current Massacre skill level - the higher that level, the
 * smaller the same kill count's own reward, down to 0 past that tier's own
 * max explicit bucket (see MAX_BUCKET_LEVEL below). Tier 1500 alone is flat,
 * granting the same rate regardless of level.
 */
export const MASS_KILL_TIERS = [20, 50, 150, 500, 1500];

/**
 * The highest level bucket each tier configures a rate for - e.g. tier 20
 * only distinguishes level 0 from "level 1 and up" (bucket 1), while tier
 * 500 distinguishes levels 0-3 individually plus "level 4 and up" (bucket
 * 4). Tier 1500 isn't listed here at all - see getMassKillTrigger below.
 */
const MAX_BUCKET_LEVEL = { 20: 1, 50: 2, 150: 3, 500: 4 };

/**
 * The skillUsageFp trigger key (see apps/skill-usage-fp-config.mjs) for a
 * given tier at a given Massacre skill level - level is clamped to that
 * tier's own highest configured bucket.
 * @param {number} tier    One of MASS_KILL_TIERS.
 * @param {number} level   The granting actor's own Massacre skill level.
 * @return {string}
 */
function getMassKillTrigger(tier, level) {
  if (tier === 1500) return 'massKill1500';
  const maxLevel = MAX_BUCKET_LEVEL[tier];
  return `massKill${tier}Level${Math.min(Math.max(level, 0), maxLevel)}`;
}

/**
 * A GM-tab Mass Kill button's own click handler - grants Massacre's FP for
 * the given tier, scaled by the actor's own current Massacre skill level
 * (see getMassKillTrigger above).
 * @param {Actor} actor
 * @param {number} tier   One of MASS_KILL_TIERS.
 * @return {Promise<ChatMessage>}
 */
export async function grantMassKillFp(actor, tier) {
  const level = getActorSkillLevel(actor, 'massacre');
  const trigger = getMassKillTrigger(tier, level);
  const grant = await grantSkillUsageFp(actor, 'massacre', trigger);
  const extraHTML = formatSkillFpGrantLine(grant) || `<div class="sksk-roll-line">${game.i18n.localize('SKSK.MassKill.NoGain')}</div>`;
  return postActionChatCard(actor, game.i18n.format('SKSK.MassKill.Title', { count: tier }), null, 0, extraHTML);
}
