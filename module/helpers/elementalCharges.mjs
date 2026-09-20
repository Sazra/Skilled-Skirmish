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
 * lingers past the next real cast.
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
  const index = actor.system.elementalCharges.nextIndex % maxSlots;
  slots[index] = magicSchool;

  await actor.update({
    'system.elementalCharges.slots': slots,
    'system.elementalCharges.nextIndex': index + 1,
    'system.elementalCharges.lastChargeTime': game.time.worldTime,
  });
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
