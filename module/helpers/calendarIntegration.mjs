import { countActiveSummons } from './summoning.mjs';
import { grantSkillUsageFp } from './skillFp.mjs';

/**
 * Whether the optional "Calendaria" module (github.com/Sayshal/calendaria)
 * is installed and active in this world - the base gate every other export
 * here relies on, so every caller safely no-ops when it's missing. Calendaria
 * doesn't register a game.modules.get('calendaria').api like most modules
 * do; it only installs a global CALENDARIA namespace (see its own scripts/
 * api.mjs#createGlobalNamespace), checked here instead.
 * @return {boolean}
 */
export function isCalendariaActive() {
  return !!(game.modules.get('calendaria')?.active && globalThis.CALENDARIA?.api);
}

/**
 * Whether this world has opted into automatic daily settlement of
 * Beschwörung's "Tag der Beschwörungs-Existenz" and Manakapazität/
 * -regeneration's "Tagesabrechnung" FP (see settleDailyAccumulators) on
 * every real Calendaria day change, instead of only at the next manually
 * confirmed Anpassungs-/Genesungspause (helpers/rest.mjs#applyRest). Always
 * false while Calendaria itself isn't active, so callers can check this
 * alone without also calling isCalendariaActive() first.
 * @return {boolean}
 */
export function isCalendariaDailySettlementEnabled() {
  return isCalendariaActive() && !!game.settings.get('sksk', 'calendariaDailySettlementEnabled');
}

/**
 * Grant one Character's pending "gain" FP (not real skill points yet - an
 * Anpassungs-/Genesungspause is still needed to integrate it, same as every
 * other skillFp trigger) for however many calendar days just elapsed:
 * Beschwörung's "summonExistenceDay" scaled by both its active summon-slot
 * count and the day count, and a flat settlement of its Manakapazität/
 * -regeneration accumulators (reset to 0 either way, even if the configured
 * rate is 0 - mirrors applyRest's own unconditional reset).
 * @param {Actor} actor
 * @param {number} days
 * @return {Promise<void>}
 */
export async function settleDailyAccumulators(actor, days) {
  if (actor.type !== 'character' || days <= 0) return;

  const activeSummons = countActiveSummons(actor);
  if (activeSummons > 0) {
    await grantSkillUsageFp(actor, 'summoning', 'summonExistenceDay', activeSummons * days);
  }

  const updates = {};
  const manaCapacityAccumulator = actor.system.manaCapacityAccumulator ?? 0;
  if (manaCapacityAccumulator > 0) {
    await grantSkillUsageFp(actor, 'manaCapacity', 'dailyManaSpent', manaCapacityAccumulator);
    updates['system.manaCapacityAccumulator'] = 0;
  }
  const manaRegenerationAccumulator = actor.system.manaRegenerationAccumulator ?? 0;
  if (manaRegenerationAccumulator > 0) {
    await grantSkillUsageFp(actor, 'manaRegeneration', 'dailyManaSpent', manaRegenerationAccumulator);
    updates['system.manaRegenerationAccumulator'] = 0;
  }
  if (Object.keys(updates).length) await actor.update(updates);
}

/**
 * Run settleDailyAccumulators across every Character actor in the world
 * that actually has something to settle, then post one GM-whispered summary
 * chat message - one combined message rather than one chat card per actor
 * (which would spam the log on a table with many Characters, unlike
 * helpers/rest.mjs#applyRest's single-actor dialog confirm).
 * @param {number} days
 * @return {Promise<void>}
 */
async function settleDailyAccumulatorsForAllActors(days) {
  let settledCount = 0;
  for (const actor of game.actors) {
    if (actor.type !== 'character') continue;
    const hasSummons = countActiveSummons(actor) > 0;
    const hasAccumulator = (actor.system.manaCapacityAccumulator ?? 0) > 0 || (actor.system.manaRegenerationAccumulator ?? 0) > 0;
    if (!hasSummons && !hasAccumulator) continue;
    await settleDailyAccumulators(actor, days);
    settledCount++;
  }
  if (settledCount > 0) {
    ChatMessage.create({
      content: `<p>${game.i18n.format('SKSK.Calendar.DailySettlementSummary', { days, count: settledCount })}</p>`,
      whisper: ChatMessage.getWhisperRecipients('GM'),
    });
  }
}

/**
 * Wire this system's optional Calendaria integration up - safe to call
 * unconditionally (from the system's own 'ready' hook, see sksk.mjs) even
 * when Calendaria isn't installed, since the hook it listens for then simply
 * never fires. Re-checks isCalendariaDailySettlementEnabled on every fire
 * (not just once here), so toggling the world setting takes effect
 * immediately without a reload.
 *
 * Only the current table's active GM ever runs the settlement - Hooks fire
 * on every connected client, and only one of them should actually write to
 * every actor in the world.
 */
export function registerCalendariaIntegration() {
  Hooks.on('calendaria.dayChange', async ({ previous, current }) => {
    if (game.user.id !== game.users.activeGM?.id) return;
    if (!isCalendariaDailySettlementEnabled()) return;

    // The hook's own previous/current are Calendaria's INTERNAL component
    // shape (0-indexed month, "dayOfMonth") - its public daysBetween API
    // expects the public shape (1-indexed "month"/"day") instead, since it
    // re-converts internally (see Calendaria's own scripts/api.mjs#
    // toInternal) - passing the internal shape straight through would
    // silently double-shift both by one.
    const toPublicDate = (components) => ({ year: components.year, month: components.month + 1, day: components.dayOfMonth + 1 });
    const days = Math.max(0, Math.round(globalThis.CALENDARIA.api.daysBetween(toPublicDate(previous), toPublicDate(current))));
    if (days > 0) await settleDailyAccumulatorsForAllActors(days);
  });
}
