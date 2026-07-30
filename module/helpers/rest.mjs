import { getActorSkillLevel } from './skills.mjs';
import { postActionChatCard, getRegenerationDieSizes } from './actions.mjs';
import { getStatusStacks, decreaseStatusStacks, getAdrenalinDamage, reduceAdrenalinDamage } from './statusEffects.mjs';

/**
 * A time segment - the atomic unit "spending time" is measured in.
 * @type {number}
 */
export const SEGMENT_MINUTES = 30;

/**
 * The minimum segment counts for each Pause tier, per the design
 * spreadsheet - Erholungspause (>= 1h), Anpassungspause (>= 8h, sleeping),
 * Genesungspause (>= 16h, doesn't need to be contiguous). Each tier's
 * effects include every lower tier's, plus its own extra ones - see
 * applyRest below.
 */
const TIER_THRESHOLDS = { genesung: 32, anpassung: 16, erholung: 2 };

/**
 * Which Pause tier a given segment count qualifies for (the highest one it
 * meets), or null if it's too short for any tier.
 * @param {number} segments
 * @return {"erholung"|"anpassung"|"genesung"|null}
 */
export function determineRestTier(segments) {
  if (segments >= TIER_THRESHOLDS.genesung) return 'genesung';
  if (segments >= TIER_THRESHOLDS.anpassung) return 'anpassung';
  if (segments >= TIER_THRESHOLDS.erholung) return 'erholung';
  return null;
}

/**
 * An actor's passive Mana regeneration per time segment (not yet doubled by
 * an Erholungspause-or-higher tier - see applyRest): Aura modifier + Mana
 * Regeneration skill level + Source Bound skill level.
 * @param {Actor} actor
 * @return {number}
 */
export function computePassiveManaRegenPerSegment(actor) {
  const auraMod = actor.system.attributes?.aur?.mod ?? 0;
  return auraMod + getActorSkillLevel(actor, 'manaRegeneration') + getActorSkillLevel(actor, 'sourceBound');
}

/**
 * The max number of Regeneration charges that can be spent healing
 * Exhaustion levels at the given tier - Anpassungspause allows exactly 1;
 * Genesungspause allows as many as the Constitution modifier (at least 1).
 * 0 below Anpassungspause (the effect isn't unlocked at all).
 * @param {Actor} actor
 * @param {"erholung"|"anpassung"|"genesung"|null} tier
 * @return {number}
 */
function computeExhaustionChargeMax(actor, tier) {
  if (tier === 'genesung') return Math.max(1, actor.system.attributes?.con?.mod ?? 0);
  if (tier === 'anpassung') return 1;
  return 0;
}

/**
 * A live preview of what confirming the current Rest dialog state would do
 * - used to render the dialog's read-only summary lines/input maximums
 * without touching the actor. Mirrors applyRest's own logic; keep the two
 * in sync.
 * @param {Actor} actor
 * @param {{segments: number, isBreak: boolean}} state
 * @return {object}
 */
export function computeRestPreview(actor, state) {
  const segments = Math.max(1, Number(state.segments) || 1);
  const tier = state.isBreak ? determineRestTier(segments) : null;

  const baseRate = computePassiveManaRegenPerSegment(actor);
  const manaGain = segments * baseRate * (tier ? 2 : 1);

  const medLevel = getActorSkillLevel(actor, 'meditation');
  const meditationRestore = tier === 'genesung' ? (2 + medLevel * 2) : tier === 'anpassung' ? (medLevel + 1) : 0;

  const conMod = actor.system.attributes?.con?.mod ?? 0;
  const level = actor.system.resources.level.value;
  const regenerationRestore = tier === 'genesung' ? Math.min(1 + conMod, level) : 0;

  const skillIntegrationUnlocked = tier === 'anpassung' || tier === 'genesung';
  const skillIntegrationCount = skillIntegrationUnlocked
    ? Object.values(actor.system.skills).filter(s => (s.gain ?? 0) > 0).length
    : 0;

  const adrenalinCharges = actor.system.adrenalinCharges;
  const adrenalinChargesRestore = skillIntegrationUnlocked
    ? Math.max(0, adrenalinCharges.max - adrenalinCharges.value)
    : 0;

  // Any qualifying Pause resets Adrenalin's used count (driving its future
  // (uses-1)d4 rolls) to 0 - but its Adrenalin Damage status (the max-Life
  // damage already dealt) is a separate thing, only ever REDUCED (not
  // fully healed), and only at Anpassungspause/Genesungspause - see
  // applyRest.
  const adrenalinUsedCountToReset = tier ? actor.system.adrenalinUsedCount : 0;
  const adrenalinDamageToReduce = skillIntegrationUnlocked
    ? Math.min(getAdrenalinDamage(actor), tier === 'genesung' ? Math.max(level, conMod) : conMod)
    : 0;

  return {
    segments,
    hours: segments * SEGMENT_MINUTES / 60,
    tier,
    tierLabelKey: tier ? `SKSK.Rest.Tier.${tier}` : null,
    manaGain,
    availableRegenerationCharges: actor.system.regenerationCharges.value,
    availableMeditationCharges: actor.system.meditationCharges.value,
    healingUnlocked: !!tier && segments >= 8,
    skillIntegrationUnlocked,
    skillIntegrationCount,
    exhaustionMax: computeExhaustionChargeMax(actor, tier),
    meditationRestore,
    regenerationRestoreUnlocked: tier === 'genesung',
    regenerationRestore,
    negativeLifeHealUnlocked: tier === 'genesung',
    adrenalinChargesRestore,
    adrenalinUsedCountToReset,
    adrenalinDamageToReduce,
  };
}

/**
 * Apply "spending time" (optionally as a Pause) to an actor, per the design
 * spreadsheet, and post a chat summary. Mirrors computeRestPreview's own
 * tier/amount logic; keep the two in sync.
 *
 * Any qualifying tier (Erholungspause or higher) resets Adrenalin's own
 * used count (the "lifetime uses" driving its (uses-1)d4 formula) back to
 * 0. This is deliberately separate from its accumulated Adrenalin Damage
 * status effect (see helpers/statusEffects.mjs#applyAdrenalinDamage/
 * reduceAdrenalinDamage) - the max-Life damage already dealt - which is
 * only ever REDUCED (not fully healed), and only at Anpassungspause/
 * Genesungspause (see below).
 *
 * Every tier includes the lower tiers' effects:
 * - Erholungspause (>= 2 segments): doubles passive Mana regen for the
 *   whole duration; from 8 segments (4h) on, up to as many currently-held
 *   Regeneration charges as chosen can each roll a Regeneration to heal
 *   Life (summed into one roll).
 * - Anpassungspause (>= 16 segments, sleeping): integrates every skill's
 *   pending "gain" into its real points; up to 1 Regeneration charge can
 *   heal 1 Exhaustion level; restores Meditation charges/Meditation
 *   skill level + 1; refills Adrenalin charges to max; reduces Adrenalin
 *   Damage by the Constitution modifier.
 * - Genesungspause (>= 32 segments, not required to be contiguous):
 *   restores Meditation charges/(2 + Meditation skill level * 2) instead
 *   (replacing, not stacking with, Anpassungspause's own restore);
 *   restores Regeneration charges/min(1 + Constitution modifier, level);
 *   the Life-healing Regeneration rolls above also heal that much
 *   Negative Life; up to (Constitution modifier, at least 1) Regeneration
 *   charges can instead heal that many Exhaustion levels; reduces
 *   Adrenalin Damage by whichever is higher between Character level and
 *   Constitution modifier instead (replacing, not stacking with,
 *   Anpassungspause's own reduction).
 *
 * @param {Actor} actor
 * @param {{segments: number, isBreak: boolean, regenForHealing?: number, regenForExhaustion?: number}} options
 * @return {Promise<ChatMessage>}
 */
export async function applyRest(actor, options) {
  const segments = Math.max(1, Number(options.segments) || 1);
  const isBreak = !!options.isBreak;
  const regenForHealing = Math.max(0, Number(options.regenForHealing) || 0);
  const regenForExhaustion = Math.max(0, Number(options.regenForExhaustion) || 0);

  const tier = isBreak ? determineRestTier(segments) : null;
  if (isBreak && !tier) ui.notifications.warn(game.i18n.localize('SKSK.Rest.TooShort'));

  const updates = {};
  const lines = [];
  let healingRoll = null;

  const baseRate = computePassiveManaRegenPerSegment(actor);
  const manaGain = segments * baseRate * (tier ? 2 : 1);
  const mana = actor.system.mana;
  const newMana = Math.min(mana.max, mana.value + manaGain);
  if (newMana !== mana.value) {
    updates['system.mana.value'] = newMana;
    lines.push(game.i18n.format('SKSK.Rest.ManaGained', { amount: newMana - mana.value }));
  }

  let regenerationCharges = actor.system.regenerationCharges.value;
  let meditationCharges = actor.system.meditationCharges.value;

  if (tier) {
    // Any qualifying Pause resets Adrenalin's used count - see the doc
    // comment above. Its Adrenalin Damage status is handled separately,
    // below, only at Anpassungspause/Genesungspause.
    const adrenalinUsedCount = actor.system.adrenalinUsedCount;
    if (adrenalinUsedCount > 0) {
      updates['system.adrenalinUsedCount'] = 0;
      lines.push(game.i18n.format('SKSK.Rest.AdrenalinUsedCountReset', { amount: adrenalinUsedCount }));
    }

    if (segments >= 8 && regenForHealing > 0) {
      const spend = Math.min(regenForHealing, regenerationCharges);
      if (spend > 0) {
        const conMod = actor.system.attributes?.con?.mod ?? 0;
        const healthLevel = getActorSkillLevel(actor, 'health');
        const dieSizes = getRegenerationDieSizes(actor);
        const singlePart = [...dieSizes.map(size => `1d${size}`), conMod, healthLevel].join(' + ');
        const formula = Array(spend).fill(`(${singlePart})`).join(' + ');
        healingRoll = await new Roll(formula, actor.getRollData()).evaluate();

        regenerationCharges -= spend;
        const life = actor.system.life;
        const newLife = Math.min(life.max, life.value + healingRoll.total);
        updates['system.life.value'] = newLife;
        lines.push(game.i18n.format('SKSK.Rest.LifeGained', { amount: newLife - life.value }));

        if (tier === 'genesung') {
          const negativeLife = actor.system.negativeLife;
          const newNegativeLife = Math.max(0, negativeLife.value - healingRoll.total);
          if (newNegativeLife !== negativeLife.value) {
            updates['system.negativeLife.value'] = newNegativeLife;
            lines.push(game.i18n.format('SKSK.Rest.NegativeLifeHealed', { amount: negativeLife.value - newNegativeLife }));
          }
        }
      }
    }

    if (tier === 'anpassung' || tier === 'genesung') {
      let integratedCount = 0;
      for (const [key, skillData] of Object.entries(actor.system.skills)) {
        if ((skillData.gain ?? 0) > 0) {
          updates[`system.skills.${key}.points`] = (skillData.points ?? 0) + skillData.gain;
          updates[`system.skills.${key}.gain`] = 0;
          integratedCount++;
        }
      }
      if (integratedCount > 0) lines.push(game.i18n.format('SKSK.Rest.SkillsIntegrated', { count: integratedCount }));

      const exhaustionMax = computeExhaustionChargeMax(actor, tier);
      const currentExhaustion = getStatusStacks(actor, 'exhaustion');
      const exhaustionSpend = Math.min(regenForExhaustion, exhaustionMax, regenerationCharges, currentExhaustion);
      if (exhaustionSpend > 0) {
        regenerationCharges -= exhaustionSpend;
        await decreaseStatusStacks(actor, 'exhaustion', exhaustionSpend);
        lines.push(game.i18n.format('SKSK.Rest.ExhaustionHealed', { amount: exhaustionSpend }));
      }

      const medLevel = getActorSkillLevel(actor, 'meditation');
      const meditationRestore = tier === 'genesung' ? (2 + medLevel * 2) : (medLevel + 1);
      const newMeditationCharges = Math.min(actor.system.meditationCharges.max, meditationCharges + meditationRestore);
      if (newMeditationCharges !== meditationCharges) {
        lines.push(game.i18n.format('SKSK.Rest.MeditationRestored', { amount: newMeditationCharges - meditationCharges }));
      }
      meditationCharges = newMeditationCharges;

      // Adrenalin charges refill to max at Anpassungspause or higher (the
      // used-count reset above applies at every tier, including
      // Erholungspause). Adrenalin Damage - the max-Life damage already
      // dealt - is instead only REDUCED here, by the Constitution
      // modifier at Anpassungspause, or by whichever is higher between
      // Character level and Constitution modifier at Genesungspause
      // (replacing, not stacking with, Anpassungspause's own reduction).
      const adrenalinCharges = actor.system.adrenalinCharges;
      if (adrenalinCharges.value !== adrenalinCharges.max) {
        updates['system.adrenalinCharges.value'] = adrenalinCharges.max;
        lines.push(game.i18n.format('SKSK.Rest.AdrenalinChargesRestored', { amount: adrenalinCharges.max - adrenalinCharges.value }));
      }

      const conMod = actor.system.attributes?.con?.mod ?? 0;
      const level = actor.system.resources.level.value;
      const adrenalinDamageReduction = tier === 'genesung' ? Math.max(level, conMod) : conMod;
      const adrenalinDamageReduced = await reduceAdrenalinDamage(actor, adrenalinDamageReduction);
      if (adrenalinDamageReduced > 0) {
        lines.push(game.i18n.format('SKSK.Rest.AdrenalinDamageReduced', { amount: adrenalinDamageReduced }));
      }
    }

    if (tier === 'genesung') {
      const conMod = actor.system.attributes?.con?.mod ?? 0;
      const level = actor.system.resources.level.value;
      const regenerationRestore = Math.min(1 + conMod, level);
      const newRegenerationCharges = Math.min(actor.system.regenerationCharges.max, regenerationCharges + regenerationRestore);
      if (newRegenerationCharges !== regenerationCharges) {
        lines.push(game.i18n.format('SKSK.Rest.RegenerationRestored', { amount: newRegenerationCharges - regenerationCharges }));
      }
      regenerationCharges = newRegenerationCharges;
    }
  }

  updates['system.regenerationCharges.value'] = regenerationCharges;
  updates['system.meditationCharges.value'] = meditationCharges;
  await actor.update(updates);

  const title = tier ? game.i18n.localize(`SKSK.Rest.Tier.${tier}`) : game.i18n.localize('SKSK.Rest.PlainTime');
  const extraHTML = lines.map(line => `<div class="sksk-roll-line">${line}</div>`).join('');
  return postActionChatCard(actor, title, healingRoll, 0, extraHTML);
}
