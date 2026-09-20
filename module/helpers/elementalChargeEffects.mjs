import { getElementalChargeCounts } from './elementalCharges.mjs';

/**
 * The Elementarist ability's passive combat effects, granted by
 * Elementarladungen (see helpers/elementalCharges.mjs) - the mechanic
 * itself (generating/displaying charges) is opt-in and class-agnostic, but
 * these effects are specifically this ability's own consequence, per its
 * full text:
 *
 * "Wähle eine der einfachen Magieschulen als Spezialisierung. [...] Alle
 * Ladungen haben einen passiven Effekt. Der passive Effekt von Ladungen der
 * spezialisierten Magieschule ist verdoppelt. [...] Trickkunst: Erhöht den
 * Effekt aller anderen Ladungsarten um 1 pro Trickladung."
 *
 * Design choice (no dedicated Item type exists for "this actor is an
 * Elementarist"): every charge always grants its base per-charge effect
 * regardless of whether this actor owns any matching Talent at all (mirrors
 * the charge-generation switch itself being a generic, class-agnostic GM-
 * tab/Active-Effect opt-in - see elementalChargesEnabled) - only the
 * DOUBLING for a specialized school requires actually owning a Talent that
 * lists it, via getElementalSpecializations below.
 */

// Item types whose elementalSpecializations entries count as a
// specialization - mirrors helpers/spells.mjs#COMBINED_SCHOOL_OVERRIDE_ITEM_TYPES's
// multi-item-type union, but Talent only (see data/talent.mjs - this is
// specifically framed as "diese Fähigkeit", a personal choice, not an
// innate Species/Class trait).
const ELEMENTAL_SPECIALIZATION_ITEM_TYPES = ['talent'];

/**
 * The union of every simpleMagicSchools key this actor is specialized in,
 * across every Talent they own - taking the Elementarist Talent a second
 * time (a second Item, each with its own array) naturally raises this to up
 * to 3 without any separate "taken twice" bookkeeping, per the ability's own
 * "Sollte diese Kreatur diese Fähigkeit zweimal besitzen..." line.
 * @param {Actor} actor
 * @return {Set<string>}
 */
export function getElementalSpecializations(actor) {
  const schools = new Set();
  for (const item of actor.items) {
    if (!ELEMENTAL_SPECIALIZATION_ITEM_TYPES.includes(item.type)) continue;
    for (const school of item.system.elementalSpecializations ?? []) schools.add(school);
  }
  return schools;
}

/**
 * The total passive-effect magnitude one Elementarladungen school currently
 * grants this actor:
 * - Every charge of that school contributes baseAmountPerCharge.
 * - Trickkunst ("Trickery") charges each add their own amplification to
 *   every OTHER school's per-charge value (never to Trickery's own, since
 *   Trickery has no direct combat effect of its own to look up here) - that
 *   amplification is 1 per Trickery charge, or 2 if Trickery itself is a
 *   specialized school (its own "verdoppelt" line applies to whichever
 *   effect that charge type grants, which for Trickery IS the
 *   amplification).
 * - If `school` itself is specialized, the whole resulting per-charge value
 *   (base + Trickery amplification) is doubled.
 * @param {Actor} actor
 * @param {string} school                    A CONFIG.SKSK.simpleMagicSchools key.
 * @param {number} [baseAmountPerCharge=1]    The ability text's own flat
 *   amount per charge for this school (2 for Air's "+2m pro Ladung",
 *   1 for every other school's "+1 ... pro Ladung").
 * @return {number}
 */
export function computeElementalChargeEffectTotal(actor, school, baseAmountPerCharge = 1) {
  const counts = getElementalChargeCounts(actor);
  const count = counts[school] ?? 0;
  if (count <= 0) return 0;

  const specializations = getElementalSpecializations(actor);
  const trickeryCount = school === 'trickery' ? 0 : (counts.trickery ?? 0);
  const trickeryPerCharge = specializations.has('trickery') ? 2 : 1;
  const trickeryAmplification = trickeryCount * trickeryPerCharge;

  let perCharge = baseAmountPerCharge + trickeryAmplification;
  if (specializations.has(school)) perCharge *= 2;
  return count * perCharge;
}

/** Feuer: +1 zusätzlicher Schaden pro Ladung (jeder Schaden, nicht nur Feuerschaden). */
export function getElementalFireDamageBonus(actor) {
  return computeElementalChargeEffectTotal(actor, 'fire');
}

/** Wasser: +1 Magieresistenz pro Ladung. */
export function getElementalWaterResistanceBonus(actor) {
  return computeElementalChargeEffectTotal(actor, 'water');
}

/** Erde: +1 Rüstungsklasse pro Ladung. */
export function getElementalEarthArmorBonus(actor) {
  return computeElementalChargeEffectTotal(actor, 'earth');
}

/** Luft: +2m Reichweite (Zauber und Fernkampfwaffen) pro Ladung. */
export function getElementalAirRangeBonus(actor) {
  return computeElementalChargeEffectTotal(actor, 'air', 2);
}

/** Lebensmagie: heilt 1 Leben pro Ladung am Anfang des Zuges. */
export function getElementalLifeChargeHeal(actor) {
  return computeElementalChargeEffectTotal(actor, 'life');
}

/** Todesmagie: heilt 1 Leben pro Ladung bei zugefügtem Schaden. */
export function getElementalDeathChargeHeal(actor) {
  return computeElementalChargeEffectTotal(actor, 'death');
}

/** Himmlische Magie (Licht): +1 auf alle Würfe gegen Statuseffekte pro Ladung. */
export function getElementalLightStatusRollBonus(actor) {
  return computeElementalChargeEffectTotal(actor, 'light');
}

/** Dunkle Magie: +1 Schwierigkeit aller verursachten Rettungswürfe pro Ladung. */
export function getElementalDarkSaveDcBonus(actor) {
  return computeElementalChargeEffectTotal(actor, 'dark');
}

/** Naturmagie: stellt 1 Mana pro Ladung am Anfang des Zuges her. */
export function getElementalNatureManaGen(actor) {
  return computeElementalChargeEffectTotal(actor, 'nature');
}
