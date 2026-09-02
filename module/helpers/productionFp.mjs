import { grantSkillUsageFp } from './skillFp.mjs';

/**
 * Alchemy's own "Essenzen im Brauprozess verarbeitet" trigger - the
 * configured per-essence rate (skillUsageFp world setting) scaled by both
 * how many essences were processed and the brew's own quality (a
 * percentage, unbounded above 100 for exceptional results - e.g. 5 essences
 * at 120% quality grants 6x the configured per-essence rate).
 * @param {Actor} actor
 * @param {number} essenceCount
 * @param {number} qualityPercent
 * @return {Promise<{skillKey: string, trigger: string, amount: number, capped: boolean}|null>}
 */
export async function grantAlchemyFp(actor, essenceCount, qualityPercent) {
  return grantSkillUsageFp(actor, 'alchemy', 'essenceProcessed', essenceCount * (qualityPercent / 100));
}

/**
 * Herstellung's (Crafting's) own "Gegenstand hergestellt" trigger, scaled by
 * the crafted item's own quality - always one item at a time, no separate
 * count field.
 * @param {Actor} actor
 * @param {number} qualityPercent
 * @return {Promise<{skillKey: string, trigger: string, amount: number, capped: boolean}|null>}
 */
export async function grantCraftingFp(actor, qualityPercent) {
  return grantSkillUsageFp(actor, 'crafting', 'itemCrafted', qualityPercent / 100);
}

/**
 * Kochen's (Cooking's) own "Gericht gekocht" trigger, scaled by the dish's
 * own quality - always one dish at a time, no separate count field.
 * @param {Actor} actor
 * @param {number} qualityPercent
 * @return {Promise<{skillKey: string, trigger: string, amount: number, capped: boolean}|null>}
 */
export async function grantCookingFp(actor, qualityPercent) {
  return grantSkillUsageFp(actor, 'cooking', 'dishCooked', qualityPercent / 100);
}

/**
 * Verzauberung's (Enchanting's) own two-in-one grant: the enchantment's own
 * quality scales "enchantmentLevel" FP (Verzauberung), while the ritual's
 * own duration (hours) scales "ritualHour" FP (Ritualist) - the same
 * trigger a Ritual-casting-method spell already grants via
 * helpers/spells.mjs#computeRitualHours (see helpers/spell-rolls.mjs),
 * reused here for a manually-adjudicated enchanting session rather than an
 * actual spell cast. The Ritualist grant is skipped entirely (not even
 * attempted) when hours is 0 - most enchantments won't involve a ritual at
 * all.
 * @param {Actor} actor
 * @param {number} qualityPercent
 * @param {number} hours
 * @return {Promise<{enchanting: object|null, ritualism: object|null}>}
 */
export async function grantEnchantingFp(actor, qualityPercent, hours) {
  const enchanting = await grantSkillUsageFp(actor, 'enchanting', 'enchantmentLevel', qualityPercent / 100);
  const ritualism = hours > 0 ? await grantSkillUsageFp(actor, 'ritualism', 'ritualHour', hours) : null;
  return { enchanting, ritualism };
}

/**
 * PREPARATION ONLY - not yet wired to any UI. Parses a JSON blob a future
 * external crafting-simulation tool might export, normalizing it into the
 * same {essences, quality, hours} shape this module's own grant functions
 * expect, so a future "paste to import" affordance in apps/production-fp-
 * dialog.mjs can fill the dialog's fields (or grant directly) without
 * further parsing work of its own. Missing sections are simply omitted from
 * the result; malformed JSON returns null rather than throwing, so a future
 * caller can show a plain "couldn't read that" warning instead of crashing.
 * @param {string} text
 * @return {{alchemy?: {essences: number, quality: number}, crafting?: {quality: number}, cooking?: {quality: number}, enchanting?: {quality: number, hours: number}}|null}
 */
export function parseProductionFpImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const result = {};
  if (data.alchemy) {
    result.alchemy = { essences: Number(data.alchemy.essences) || 0, quality: Number(data.alchemy.quality) || 0 };
  }
  if (data.crafting) result.crafting = { quality: Number(data.crafting.quality) || 0 };
  if (data.cooking) result.cooking = { quality: Number(data.cooking.quality) || 0 };
  if (data.enchanting) {
    result.enchanting = { quality: Number(data.enchanting.quality) || 0, hours: Number(data.enchanting.hours) || 0 };
  }
  return result;
}
