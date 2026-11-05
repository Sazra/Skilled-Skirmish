/**
 * Elementarladungen - a small opt-in Bottom-Bar widget (see templates/
 * actor/parts/elemental-charges-bar.hbs) easing certain elemental-focused
 * classes' bookkeeping. One round "slot" per point of Willenskraft's own
 * modifier (see data/actor-base.mjs#prepareDerivedData -
 * system.elementalCharges.maxSlots), filled round-robin (left to right,
 * wrapping back to the start once full) with the magic school of each
 * Einfache-Magieschule spell this actor casts - see registerElementalCharge
 * below, called from helpers/spell-rolls.mjs#rollSpellItem.
 *
 * Each charge also carries a passive combat effect via the "Elementarist"
 * Talent ability (see helpers/elementalChargeEffects.mjs) - this module only
 * owns the slots themselves (generation, decay, display), not their
 * gameplay consequences.
 */

// 10 in-game minutes (game.time.worldTime is in seconds) without a new
// charge, and every existing one is lost - see getEffectiveElementalCharges
// below and the Elementarist ability's own "Sollte diese Kreatur für 10
// Minuten keine Ladung mehr generieren..." line.
const DECAY_SECONDS = 600;

import { isCombatActive, isActorsOwnTurn } from './statusEffects.mjs';
import { formatRollCardHeading } from './rollCard.mjs';

/**
 * @param {Actor} actor
 * @return {boolean}
 */
export function isElementalChargesEnabled(actor) {
  return !!actor.system.elementalChargesEnabled;
}

/**
 * The actor's currently-active charge slots - the raw stored array, unless
 * more than DECAY_SECONDS have passed (in game/world time) since the last
 * charge was generated, in which case every charge is treated as lost
 * (returns an all-empty array of the same length) without necessarily
 * having been written back yet (see registerElementalCharge, which performs
 * the actual write the next time it has a reason to touch the actor at
 * all). A pure, read-only check - safe to call from derived-data-style code.
 * @param {Actor} actor
 * @return {string[]}
 */
export function getEffectiveElementalChargeSlots(actor) {
  const charges = actor.system.elementalCharges;
  const slots = charges?.slots ?? [];
  const lastChargeTime = charges?.lastChargeTime ?? 0;
  // No "> 0" guard on lastChargeTime - worldTime 0 (a fresh world) is a
  // legitimate timestamp, not a sentinel for "never charged". An actor who
  // genuinely never generated a charge has an all-empty slots array anyway,
  // so decaying it here is always a harmless no-op either way.
  if ((game.time.worldTime - lastChargeTime) >= DECAY_SECONDS) {
    return slots.map(() => "");
  }
  return slots;
}

/**
 * How many currently-active charges this actor holds of each Einfache-
 * Magieschule, keyed by CONFIG.SKSK.simpleMagicSchools key - schools with 0
 * charges are simply absent from the result. See
 * helpers/elementalChargeEffects.mjs, the sole consumer.
 * @param {Actor} actor
 * @return {Object<string, number>}
 */
export function getElementalChargeCounts(actor) {
  const counts = {};
  for (const school of getEffectiveElementalChargeSlots(actor)) {
    if (!school) continue;
    counts[school] = (counts[school] ?? 0) + 1;
  }
  return counts;
}

/**
 * Fills the next slot (round-robin) with the given Einfache-Magieschule's
 * key, a no-op while the widget is off or Willenskraft's modifier is 0 or
 * below (no slots to fill at all). Starts fresh from an all-empty array
 * first if the existing charges had already decayed away (see
 * getEffectiveElementalChargeSlots) - self-healing, so stale data never
 * lingers past the next real cast - and in that case also restarts at the
 * first slot instead of continuing from the last position.
 * @param {Actor} actor
 * @param {string} magicSchool - a CONFIG.SKSK.simpleMagicSchools key.
 */
export async function registerElementalCharge(actor, magicSchool) {
  if (!isElementalChargesEnabled(actor)) return;
  const maxSlots = actor.system.elementalCharges.maxSlots;
  if (maxSlots <= 0) return;

  const current = getEffectiveElementalChargeSlots(actor);
  const slots = current.slice(0, maxSlots);
  while (slots.length < maxSlots) slots.push("");
  // With no active charge left (never charged, or all of them decayed away),
  // always start over from the first slot rather than wherever the previous
  // run stopped.
  const index = slots.some(Boolean) ? actor.system.elementalCharges.nextIndex % maxSlots : 0;
  slots[index] = magicSchool;

  await actor.update({
    'system.elementalCharges.slots': slots,
    'system.elementalCharges.nextIndex': index + 1,
    'system.elementalCharges.lastChargeTime': game.time.worldTime,
  });
}

/**
 * Actively consume one charge (click on it in the bar): empties that slot -
 * the charge's passive effect (see helpers/elementalChargeEffects.mjs) is
 * gone with it - and posts a chat line. Costs the AP configured for that
 * school (data/actor-base.mjs#elementalChargeApCost), paid like an
 * ability's: only while a combat is running, as RP when it is not the
 * actor's own turn; nothing is spent or removed if that can't be afforded.
 * Asks for confirmation first unless skipConfirm (Shift+click).
 * @param {Actor} actor
 * @param {number} slotIndex
 * @param {boolean} [skipConfirm=false]
 * @return {Promise<boolean>}   Whether a charge was consumed.
 */
export async function consumeElementalCharge(actor, slotIndex, skipConfirm = false) {
  const slots = getEffectiveElementalChargeSlots(actor).slice();
  const school = slots[slotIndex];
  if (!school) return false;

  const cost = actor.system.elementalChargeApCost?.[school] ?? 0;
  const schoolLabel = game.i18n.localize(CONFIG.SKSK.simpleMagicSchools[school] ?? school);
  const combatActive = isCombatActive();
  const offTurn = !isActorsOwnTurn(actor);
  const pays = combatActive && cost > 0;

  if (pays) {
    if (offTurn ? actor.system.reactionPoints.value < cost : actor.system.actionPoints.value < cost) {
      ui.notifications.warn(game.i18n.localize(offTurn ? 'SKSK.Action.NotEnoughRP' : 'SKSK.Action.NotEnoughAP'));
      return false;
    }
  }

  if (!skipConfirm) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('SKSK.ElementalCharges.ConsumeTitle') },
      content: `<p>${game.i18n.format('SKSK.ElementalCharges.ConsumeConfirm', { school: schoolLabel, cost })}</p>`,
      rejectClose: false,
    });
    if (!confirmed) return false;
  }

  slots[slotIndex] = "";
  const update = { 'system.elementalCharges.slots': slots };
  if (pays) {
    if (offTurn) update['system.reactionPoints.value'] = actor.system.reactionPoints.value - cost;
    else update['system.actionPoints.value'] = actor.system.actionPoints.value - cost;
  }
  await actor.update(update);

  const costLine = pays
    ? `<div class="sksk-roll-${offTurn ? 'rp' : 'ap'}-cost"><strong>${game.i18n.localize(offTurn ? 'SKSK.Spell.RPCost' : 'SKSK.Spell.APCost')}:</strong> ${cost}</div>`
    : '';
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sksk-chat-card sksk-action-card">${formatRollCardHeading(game.i18n.format('SKSK.ElementalCharges.ConsumedHeading', { school: schoolLabel }))}${costLine}</div>`,
  });
  return true;
}

/**
 * Builds the Bottom-Bar's own per-slot display data (localized 3-letter
 * abbreviation + full label + a per-school CSS class for its color) - see
 * sheets/actor-sheet.mjs#_prepareContext.
 * @param {Actor} actor
 * @return {Array<{school: string, cssClass: string, abbr: string, label: string}>}
 */
export function prepareElementalChargeSlots(actor) {
  const maxSlots = actor.system.elementalCharges?.maxSlots ?? 0;
  const slots = getEffectiveElementalChargeSlots(actor);
  const result = [];
  for (let i = 0; i < maxSlots; i++) {
    const school = slots[i] || "";
    if (!school) {
      result.push({ school: "", cssClass: "", abbr: "", label: "" });
      continue;
    }
    const capitalized = school.charAt(0).toUpperCase() + school.slice(1);
    result.push({
      school,
      cssClass: `elemental-charge-slot-${school}`,
      abbr: game.i18n.localize(`SKSK.ElementalCharges.SchoolAbbr.${capitalized}`),
      label: game.i18n.localize(CONFIG.SKSK.simpleMagicSchools[school] ?? school),
    });
  }
  return result;
}
