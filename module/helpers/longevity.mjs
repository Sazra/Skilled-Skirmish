import { computePermanentMaxLife } from './life.mjs';
import { computePermanentMaxMana } from './mana.mjs';
import { getMainSpeciesItem } from './movement.mjs';

// 1 year = 12 months = 60 weeks = 360 days; 1 month = 5 weeks = 30 days;
// 1 week = 6 days.
const DAYS_PER_UNIT = { year: 360, month: 30, week: 6, day: 1 };

/**
 * The main Species' own baseLongevity (years, converted to days) -
 * deliberately WITHOUT any Sub-Species multiplier (see
 * computeSubMultiplierProduct below) - this is the "fresh" value
 * system.longevity.mainBaselineDays gets reset to whenever the main
 * Species' baseLongevity changes or it's replaced outright. 0 if there's
 * no main Species at all.
 * @param {Actor} actor
 * @return {number}
 */
export function computeMainSpeciesBaseDays(actor) {
  const mainSpecies = getMainSpeciesItem(actor);
  if (!mainSpecies || mainSpecies.system.speciesType !== 'main') return 0;
  return mainSpecies.system.baseLongevity * DAYS_PER_UNIT.year;
}

/**
 * The product of every Sub-Species item's own baseLongevityMultiplier on
 * the actor (initial 1 each, so a Sub-Species with no explicit value
 * leaves it unchanged; multiple Sub-Species combine multiplicatively).
 * Always computed fresh, never itself stored - see deriveDaysFromPercent.
 * @param {Actor} actor
 * @return {number}
 */
export function computeSubMultiplierProduct(actor) {
  return actor.items
    .filter(i => i.type === 'species' && i.system.speciesType === 'sub')
    .reduce((product, sub) => product * (sub.system.baseLongevityMultiplier ?? 1), 1);
}

/**
 * A character's base Lebenszeit (Longevity) in days, fully fresh from
 * their current Species setup: main Species' own baseLongevity times every
 * Sub-Species' own baseLongevityMultiplier. Only used as a one-off
 * convenience (e.g. the very first time a Character ever gains a main
 * Species, when mainBaselineDays itself is still un-grown) - NOT used by
 * the ongoing growth/adjustment logic, which tracks mainBaselineDays and
 * the Sub-Species product separately (see computeMainSpeciesBaseDays/
 * computeSubMultiplierProduct and sksk.mjs's own Species hooks).
 * @param {Actor} actor
 * @return {number}
 */
export function computeBaseLongevityDays(actor) {
  return computeMainSpeciesBaseDays(actor) * computeSubMultiplierProduct(actor);
}

/**
 * A total day count broken down into whole years/months/weeks/days for
 * display (see templates/actor/parts/character.hbs) - each unit is
 * whatever remains after the larger ones have taken their share.
 * @param {number} totalDays
 * @return {{years: number, months: number, weeks: number, days: number}}
 */
export function daysToBreakdown(totalDays) {
  let remaining = Math.max(0, Math.trunc(totalDays));
  const years = Math.floor(remaining / DAYS_PER_UNIT.year);
  remaining -= years * DAYS_PER_UNIT.year;
  const months = Math.floor(remaining / DAYS_PER_UNIT.month);
  remaining -= months * DAYS_PER_UNIT.month;
  const weeks = Math.floor(remaining / DAYS_PER_UNIT.week);
  remaining -= weeks * DAYS_PER_UNIT.week;
  return { years, months, weeks, days: remaining };
}

/**
 * The "permanent progression" max Life + max Mana total Lebenszeit
 * (Longevity) growth is measured against - see computePermanentMaxLife/
 * computePermanentMaxMana (helpers/life.mjs/mana.mjs) for exactly what
 * counts (and, notably, what doesn't: equipment, Active Effects, Lehren).
 * @param {Actor} actor
 * @return {number}
 */
export function computePermanentLifeManaTotal(actor) {
  return computePermanentMaxLife(actor) + computePermanentMaxMana(actor);
}

/**
 * The current days value implied by the stored percent against the
 * current baseline (mainBaselineDays × the fresh Sub-Species multiplier
 * product) - used whenever a Species-related change should re-derive days
 * from the PRESERVED percent instead of the other way around (see
 * sksk.mjs's own Species hooks and recalculateDaysFromBaseline below).
 * @param {Actor} actor
 * @return {number}
 */
export function deriveDaysFromPercent(actor) {
  const { mainBaselineDays, percent } = actor.system.longevity;
  return Math.round(mainBaselineDays * computeSubMultiplierProduct(actor) * percent / 100);
}

/**
 * Re-derives and persists days from the actor's current mainBaselineDays/
 * percent against the freshly computed Sub-Species multiplier product -
 * used whenever a Sub-Species is gained, loses/changes its own
 * baseLongevityMultiplier, or is removed (see sksk.mjs's own Sub-Species
 * hooks): mainBaselineDays and percent are both left untouched, only days
 * moves to reflect the new multiplier.
 * @param {Actor} actor
 */
export async function recalculateDaysFromBaseline(actor) {
  await actor.update({ 'system.longevity.days': deriveDaysFromPercent(actor) });
}

/**
 * GM-Tab "Lebenszeit zurücksetzen" button (sheets/actor-sheet.mjs#
 * adjustLongevity's sibling action) - resets Longevity back to a fresh
 * 100%: mainBaselineDays is reset to the main Species' own current
 * baseLongevity (same fresh computation as a Species-change event, see
 * computeMainSpeciesBaseDays), days is set to that times the current
 * Sub-Species multiplier product, percent is reset to 100, and
 * baselineTotal is re-seeded to the actor's current permanent max
 * Life+Mana total so the next automatic-growth check measures forward
 * from this reset rather than replaying whatever had already accrued.
 * @param {Actor} actor
 */
export async function resetLongevityToFull(actor) {
  const mainBaselineDays = computeMainSpeciesBaseDays(actor);
  await actor.update({
    'system.longevity.mainBaselineDays': mainBaselineDays,
    'system.longevity.percent': 100,
    'system.longevity.days': Math.round(mainBaselineDays * computeSubMultiplierProduct(actor)),
    'system.longevity.baselineTotal': computePermanentLifeManaTotal(actor),
  });
}

/**
 * Lazily detects a permanent increase in max Life+Mana and grows Lebenszeit
 * (Longevity) by it - called on every sheet render (see sheets/actor-sheet.mjs
 * #_onRender), same lazy "compare current computed state against a
 * persisted baseline" pattern as helpers/attributeBonuses.mjs#
 * applyPendingAutoGrants, since (like that system) there's no single "max
 * Life/Mana changed" event to hook: skill points, attribute rawValue and
 * Character level are all independently, directly editable.
 *
 * A no-op until system.longevity.initialized is true - that's set the
 * first time a Character ever gains a main Species (sksk.mjs's own
 * createItem hook, which also seeds mainBaselineDays/days/baselineTotal at
 * that point), not here; growth only ever measures an increase past that
 * established baseline. From then on, every render compares the freshly
 * computed permanent total against the stored baselineTotal; any increase
 * grows mainBaselineDays by floor(delta * 0.01 * mainBaselineDays)
 * (rounded down independently each time - the baseline is always advanced
 * to the current total, even when that rounds down to 0, so a too-small-
 * to-matter increase is never "saved up" to combine with a later one).
 * percent is deliberately left untouched by this - only days moves (via
 * deriveDaysFromPercent), so the percentage of Lebenszeit "remaining"
 * reads the same before and after a growth event, even though both the
 * baseline and the absolute days grew.
 * @param {Actor} actor
 */
export async function applyPendingLongevityGrowth(actor) {
  if (actor.type !== 'character') return;

  const longevity = actor.system.longevity;
  if (!longevity.initialized) return;

  const currentTotal = computePermanentLifeManaTotal(actor);
  const delta = currentTotal - longevity.baselineTotal;
  if (delta <= 0) return;

  const daysToAdd = Math.floor(delta * 0.01 * longevity.mainBaselineDays);
  const newMainBaselineDays = longevity.mainBaselineDays + daysToAdd;
  await actor.update({
    'system.longevity.mainBaselineDays': newMainBaselineDays,
    'system.longevity.days': Math.round(newMainBaselineDays * computeSubMultiplierProduct(actor) * longevity.percent / 100),
    'system.longevity.baselineTotal': currentTotal,
  });
}

/**
 * Applies a manual ±N adjustment (from the Lebenszeit sub-tab's own
 * Year/Month/Week/Day buttons) to the actor's current Longevity, converted
 * to days via DAYS_PER_UNIT and clamped to never go below 0. Unlike
 * automatic growth or a Species change, a manual adjustment is what
 * RECOMPUTES percent (from the new days against the current baseline)
 * rather than preserving it - see data/actor-base.mjs#longevity.
 * @param {Actor} actor
 * @param {"year"|"month"|"week"|"day"} unit
 * @param {number} amount  Signed - negative to subtract.
 */
export async function adjustLongevity(actor, unit, amount) {
  const longevity = actor.system.longevity;
  const deltaDays = DAYS_PER_UNIT[unit] * amount;
  const newDays = Math.max(0, (longevity.days ?? 0) + deltaDays);
  const baseline = longevity.mainBaselineDays * computeSubMultiplierProduct(actor);
  const newPercent = baseline > 0 ? (newDays / baseline) * 100 : longevity.percent;
  await actor.update({ 'system.longevity.days': newDays, 'system.longevity.percent': newPercent });
}
