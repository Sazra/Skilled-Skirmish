import {
  getSkillLabel, getActorSkillLevel, findSkillDefinition, getSkillPointThreshold, computeSkillBonusTotals,
} from './skills.mjs';

/**
 * Resistances' own special cap (the only skill category with one): pending
 * "gain" for a Resistance skill can never accumulate (combined with its
 * own already-integrated points) beyond what's needed to raise its
 * points-driven level 3 levels past wherever an equipped Species/Class/
 * Item's own skill bonus (computeSkillBonusTotals) already puts it - that
 * bonus itself doesn't count against the cap, so e.g. a Species granting
 * +5 to Fire Resistance still lets FP gain push the final displayed level
 * to 8 (5 + 3), not just 3. Mirrors getSkillLevel's own baseline-
 * subtraction math (helpers/skills.mjs) so "3 levels past the bonus" is
 * computed the exact same way the final level itself is. Doesn't touch
 * the skill's actual points at all - a GM/player can still raise or lower
 * those directly without limit, unaffected. A no-op (returns amount
 * unchanged) for every other skill category.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {number} amount   The FP amount that would otherwise be granted.
 * @return {number} The amount actually still grantable - may be less, or 0.
 */
function capResistanceGain(actor, skillKey, amount) {
  if (!(skillKey in (CONFIG.SKSK.skills.resistances ?? {}))) return amount;
  const maxLevel = findSkillDefinition(skillKey)?.maxLevel;
  const bonus = computeSkillBonusTotals(actor)[skillKey] ?? 0;
  const baseline = bonus > 0 ? getSkillPointThreshold(bonus, maxLevel) : 0;
  const maxAllowedPoints = getSkillPointThreshold(bonus + 3, maxLevel) - baseline;
  if (Number.isNaN(maxAllowedPoints)) return amount;

  const data = actor.system.skills?.[skillKey] ?? {};
  const alreadyAccumulated = (data.points ?? 0) + (data.gain ?? 0);
  const room = Math.max(0, maxAllowedPoints - alreadyAccumulated);
  return Math.min(amount, room);
}

/**
 * Every fpGainBonuses entry targeting the given skill, gathered from both
 * delivery paths: an owned item's own system.fpGainBonuses array (item.mjs/
 * weapon.mjs/armor.mjs/species.mjs/class.mjs/talent.mjs/soulPath.mjs), and
 * any active (non-disabled) ActiveEffect on the actor carrying a
 * flags.sksk.fpGainBonuses array - the latter is how a custom Status Effect
 * delivers the same bonus shape, pre-scaled by its own stack count at
 * application time (see helpers/statusEffects.mjs#setStatusStacks).
 * @param {Actor} actor
 * @param {string} skillKey
 * @return {Array<{skill: string, bonusType: string, amount: number, allowZero: boolean}>}
 */
function collectSkillFpGainBonusEntries(actor, skillKey) {
  const entries = [];
  for (const item of actor.items) {
    for (const entry of item.system.fpGainBonuses ?? []) {
      if (entry.skill === skillKey) entries.push(entry);
    }
  }
  for (const effect of actor.effects) {
    if (effect.disabled) continue;
    for (const entry of effect.getFlag('sksk', 'fpGainBonuses') ?? []) {
      if (entry.skill === skillKey) entries.push(entry);
    }
  }
  return entries;
}

/**
 * Applies every fpGainBonuses entry targeting skillKey to a base FP amount,
 * in this order:
 * 1. forceZero on ANY contributing entry short-circuits everything to 0.
 * 2. positive entries add flat, summed.
 * 3. negative entries subtract flat, in two independent groups by their own
 *    allowZero flag - the allow-zero group is subtracted first (floored at
 *    0), then the disallow-zero group (floored at 1) - each group's floor
 *    only applies if that group actually has entries, so an empty
 *    disallow-zero group never forces a floor of 1 by itself.
 * 4. multiplicative entries' (signed) percentages sum additively into one
 *    combined percentage (e.g. +50 and -20 -> +30), applied as
 *    total * (1 + combined/100), floored - the most restrictive allowZero
 *    among contributing multiplicative entries governs this step's own
 *    floor (0 if all allow zero, else 1).
 * A final Math.max(0, ...) guards against any residual negative value.
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {number} baseAmount
 * @return {number}
 */
function applySkillFpGainBonus(actor, skillKey, baseAmount) {
  const entries = collectSkillFpGainBonusEntries(actor, skillKey);
  if (!entries.length) return baseAmount;
  if (entries.some(e => e.bonusType === 'forceZero')) return 0;

  const sum = (arr) => arr.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  let total = baseAmount;

  total += sum(entries.filter(e => e.bonusType === 'positive'));

  const negAllowZero = entries.filter(e => e.bonusType === 'negative' && e.allowZero);
  const negDisallowZero = entries.filter(e => e.bonusType === 'negative' && !e.allowZero);
  if (negAllowZero.length) total = Math.max(0, total - sum(negAllowZero));
  if (negDisallowZero.length) total = Math.max(1, total - sum(negDisallowZero));

  const mult = entries.filter(e => e.bonusType === 'multiplicative');
  if (mult.length) {
    const combinedPercent = sum(mult);
    const floor = mult.some(e => !e.allowZero) ? 1 : 0;
    total = Math.max(floor, Math.floor(total * (1 + combinedPercent / 100)));
  }

  return Math.max(0, total);
}

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
 *   null if nothing was (NPC, no configured rate, floors to 0, or a
 *   Resistance already at its own level-3 gain cap - see capResistanceGain).
 */
export async function grantSkillUsageFp(actor, skillKey, trigger, multiplier = 1) {
  if (!actor || actor.type !== 'character') return null;
  let amount = Math.floor(getSkillFpRate(skillKey, trigger) * multiplier);
  if (amount <= 0) return null;

  amount = applySkillFpGainBonus(actor, skillKey, amount);
  if (amount <= 0) return null;

  // Once Seelenstärke reaches its own max level (5), it has nowhere left
  // to put further FP - redirected into its own "Seelenmacht" (Soul
  // Power) pool instead (data/actor-base.mjs#soulPower), at the same
  // amount, regardless of which trigger granted it (meditationUsedInCombat
  // today, potentially others later). Never applies to soulPowerTraded
  // itself (see tradeSoulPowerForFp below) - that trigger is only ever
  // reachable below level 5 to begin with (the trade button hides once
  // level 5 is hit), but excluded explicitly rather than relying on that
  // alone, since redirecting a Seelenmacht->FP trade straight back into
  // Seelenmacht would be a nonsensical no-op loop.
  if (skillKey === 'soulforce' && trigger !== 'soulPowerTraded' && getActorSkillLevel(actor, 'soulforce') >= 5) {
    const currentPower = actor.system.soulPower.value;
    await actor.update({ 'system.soulPower.value': currentPower + amount });
    return { label: game.i18n.localize('SKSK.Resource.SoulPower'), amount };
  }

  amount = capResistanceGain(actor, skillKey, amount);
  if (amount <= 0) return null;

  const current = actor.system.skills?.[skillKey]?.gain ?? 0;
  await actor.update({ [`system.skills.${skillKey}.gain`]: current + amount });
  return { label: game.i18n.localize(getSkillLabel(skillKey)), amount };
}

/**
 * Seelenmacht's own trade-in: while the GM tab's own soulPowerMechanicEnabled
 * switch is on and Seelenstärke hasn't reached its own max level (5) yet
 * (data/actor-base.mjs), converts the actor's ENTIRE current Seelenmacht
 * (Soul Power) pool into Seelenstärke's own pending FP, at the GM-
 * configured "soulPowerTraded" rate (apps/skill-usage-fp-config.mjs) -
 * i.e. floor(rate * poolAmount), same "per-unit rate times an amount"
 * shape grantSkillUsageFp's own multiplier already uses elsewhere (e.g. a
 * per-spell-level rate times the spell's own level). The pool is only
 * ever cleared if FP was actually granted - an unconfigured (0) rate
 * leaves it untouched rather than destroying it for nothing. Once
 * Seelenstärke is at level 5, its own FP converts INTO Seelenmacht
 * instead (see grantSkillUsageFp) - trading no longer makes sense there,
 * so this becomes a no-op (the sheet's own trade button hides too).
 * @param {Actor} actor
 * @return {Promise<{label: string, amount: number}|null>}
 */
export async function tradeSoulPowerForFp(actor) {
  if (!actor || actor.type !== 'character') return null;
  if (!actor.system.soulPowerMechanicEnabled) return null;
  if (getActorSkillLevel(actor, 'soulforce') >= 5) return null;

  const pool = actor.system.soulPower.value;
  if (pool <= 0) return null;

  const grant = await grantSkillUsageFp(actor, 'soulforce', 'soulPowerTraded', pool);
  if (!grant) return null;

  await actor.update({ 'system.soulPower.value': 0 });
  return grant;
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
 * Render a grantSkillUsageFp result as a chat-card line - a permanent no-op.
 * FP gains are only ever surfaced in chat for Training (helpers/
 * training.mjs builds its own lines directly, with its own localization key,
 * never through this function), everywhere else FP is granted silently (the
 * underlying grantSkillUsageFp/grantFlatSkillFp call this wraps still runs
 * and still updates the skill's pending FP - only the chat-card line is
 * suppressed). Kept as a function (rather than deleting every call site) so
 * the many callers building "does this grant produce a line?" HTML don't
 * all need editing individually.
 * @param {{label: string, amount: number}|null} grant
 * @return {string}
 */
export function formatSkillFpGrantLine(grant) {
  return '';
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
  let flatAmount = Math.floor(Number(amount) || 0);
  if (flatAmount <= 0) return null;

  flatAmount = applySkillFpGainBonus(actor, skillKey, flatAmount);
  flatAmount = capResistanceGain(actor, skillKey, flatAmount);
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
