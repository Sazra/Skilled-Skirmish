import { postActionChatCard } from './actions.mjs';
import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';

/**
 * Movement types (CONFIG.SKSK.movementTypes) Dazed does NOT reduce.
 */
const DAZED_EXEMPT_MOVEMENT_TYPES = ['hovering'];

/**
 * Attributes whose checks Dazed applies a malus to.
 */
const DAZED_MALUS_ATTRIBUTES = ['str', 'dex', 'con', 'app'];

/**
 * A custom (GM-added) status effect's optional flat-per-stack modifier
 * fields, and the actual actor schema path each targets via a real
 * ActiveEffect change (see buildStatModifierChanges) - the "Reductions/
 * increases of max Life, max Mana, AP, RP, AC and MR can be user-defined"
 * requirement. Predefined effects manage their own consequences elsewhere
 * and never carry these.
 */
const CUSTOM_STAT_MODIFIER_FIELDS = {
  lifeBonus: 'system.life.bonus',
  manaBonus: 'system.mana.bonus',
  apBonus: 'system.actionPoints.bonus',
  rpBonus: 'system.reactionPoints.bonus',
  acBonus: 'system.customArmorClassBonus',
  mrBonus: 'system.customMagicResistanceBonus',
};

/**
 * A custom (GM-added) status effect's optional flat-per-stack turn-start
 * tick fields - the "damage/healing, or Mana regeneration/loss, at the
 * start of the turn" requirement for custom status effects (see
 * handleCustomTurnStart). Unlike CUSTOM_STAT_MODIFIER_FIELDS above (a
 * standing Active Effect change applied for as long as the status is
 * active), these fire once per combat turn start instead. Predefined
 * effects manage their own consequences elsewhere and never carry these.
 */
export const CUSTOM_TURN_START_FIELDS = ['lifeChangePerStack', 'manaChangePerStack'];

/**
 * The world's full list of status effect definitions - the predefined,
 * mechanically-automated ones (seeded by ensurePredefinedStatusEffects,
 * each {id, predefined: true, name, img, description}) plus any GM-added
 * custom ones (flavor-only, no automated mechanics).
 * @return {Array<{id: string, predefined: boolean, name: string, img: string, description: string}>}
 */
export function getStatusEffectDefinitions() {
  return game.settings.get('sksk', 'statusEffects') ?? [];
}

/**
 * Seed the "statusEffects" world setting with any of
 * CONFIG.SKSK.predefinedStatusEffects not already present (matched by id) -
 * safe to call every "ready" hook, and safe across future additions to the
 * predefined list (only ever adds missing ones, never touches existing
 * entries - including any the GM has since renamed/re-iconned). Callers
 * must await this before reading the setting again (e.g.
 * registerConfigStatusEffects below) - the write is a real round-trip.
 * @return {Promise<void>}
 */
export async function ensurePredefinedStatusEffects() {
  const current = game.settings.get('sksk', 'statusEffects') ?? [];
  const existingIds = new Set(current.map(e => e.id));
  const missing = CONFIG.SKSK.predefinedStatusEffects.filter(def => !existingIds.has(def.id));
  if (!missing.length) return;

  const seeded = missing.map(def => ({
    id: def.id,
    predefined: true,
    name: game.i18n.localize(def.nameKey),
    img: def.img,
    description: game.i18n.localize(def.descriptionKey),
  }));
  await game.settings.set('sksk', 'statusEffects', [...current, ...seeded]);
}

/**
 * Register every status effect definition into Foundry's own
 * CONFIG.statusEffects (id/name/img only) so they show up as normal
 * toggleable icons on the Token HUD, in addition to this system's own
 * stack-aware handling below. Safe to call every "ready" hook (only adds
 * ids not already present, e.g. Foundry's own built-ins).
 */
export function registerConfigStatusEffects() {
  const existingIds = new Set(CONFIG.statusEffects.map(e => e.id));
  for (const def of getStatusEffectDefinitions()) {
    if (existingIds.has(def.id)) continue;
    CONFIG.statusEffects.push({ id: def.id, name: def.name, img: def.img });
  }
}

/**
 * A status effect definition's current display name (GM-editable, so never
 * hardcoded/localized directly outside of the seed step above).
 * @param {string} id
 * @return {string}
 */
function getStatusEffectName(id) {
  return getStatusEffectDefinitions().find(d => d.id === id)?.name || id;
}

/**
 * The clamped result of applying `delta` to a resource's current value -
 * healing/gain clamps at `max` (never exceeds it); damage/loss only floors
 * at 0, without an upper clamp. A plain clamp(value + delta, 0, max) would
 * be wrong for damage whenever `max` has shrunk below the resource's
 * current value since it was last clamped (e.g. Cauterization/Adrenalin/
 * Schaden am maximalen Leben reducing max Life via an Active Effect, or
 * anything reducing max Mana) - it would incorrectly snap the value up to
 * that lower max as a side effect of unrelated damage, rather than simply
 * reducing it further.
 * @param {number} value
 * @param {number} max
 * @param {number} delta
 * @return {number}
 */
function clampResourceChange(value, max, delta) {
  return delta > 0 ? Math.max(0, Math.min(max, value + delta)) : Math.max(0, value + delta);
}

/**
 * Directly apply a Life change (damage or healing) to system.life.value,
 * clamped via clampResourceChange - every turn-start effect that affects
 * current Life (Poison, Frostbite, Wound, custom Life ticks) goes through
 * this rather than only narrating the amount in chat. Damage that would
 * take Life below 0 doesn't just get floored away - whatever's left over
 * once Life hits 0 carries through onto system.negativeLife.value instead
 * (clamped at its own max), regardless of which of the above dealt it.
 * Healing never interacts with Negative Life here (Rest already handles
 * healing it directly, on its own tiers).
 * @param {Actor} actor
 * @param {number} delta   Positive to heal, negative to damage.
 * @return {Promise<{lifeDelta: number, negativeLifeDelta: number}>} The
 *   amounts actually applied to each (may differ from delta once clamped);
 *   negativeLifeDelta is positive when Negative Life worsens.
 */
async function applyLifeChange(actor, delta) {
  if (!delta) return { lifeDelta: 0, negativeLifeDelta: 0 };
  const life = actor.system.life;
  const newLifeValue = clampResourceChange(life.value, life.max, delta);
  const lifeDelta = newLifeValue - life.value;

  const updates = {};
  if (lifeDelta) updates['system.life.value'] = newLifeValue;

  let negativeLifeDelta = 0;
  if (delta < 0) {
    const overflow = -delta + lifeDelta; // damage magnitude Life itself couldn't absorb
    if (overflow > 0) {
      const negativeLife = actor.system.negativeLife;
      const newNegativeLifeValue = Math.min(negativeLife.max, negativeLife.value + overflow);
      negativeLifeDelta = newNegativeLifeValue - negativeLife.value;
      if (negativeLifeDelta) updates['system.negativeLife.value'] = newNegativeLifeValue;
    }
  }

  if (Object.keys(updates).length) await actor.update(updates);
  return { lifeDelta, negativeLifeDelta };
}

/**
 * The extra chat line noting Negative Life overflow (see applyLifeChange),
 * or '' if none occurred - shared by every turn-start Life-damage handler
 * below.
 * @param {number} negativeLifeDelta
 * @return {string}
 */
function negativeLifeOverflowHTML(negativeLifeDelta) {
  if (!negativeLifeDelta) return '';
  return `<div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.NegativeLifeOverflow', { amount: negativeLifeDelta })}</div>`;
}

/**
 * Real ActiveEffect "changes" (key/mode/value) for a custom (GM-added,
 * non-predefined) status effect's optional flat stat modifiers - each
 * configured per-stack amount is multiplied by the current stack count.
 * @param {object|undefined} def
 * @param {number} stacks
 * @return {Array<object>}
 */
function buildStatModifierChanges(def, stacks) {
  if (!def || def.predefined) return [];
  const changes = [];
  for (const [field, key] of Object.entries(CUSTOM_STAT_MODIFIER_FIELDS)) {
    const perStack = Number(def[field]) || 0;
    if (!perStack) continue;
    changes.push({ key, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(perStack * stacks) });
  }
  return changes;
}

/**
 * An actor's ActiveEffect backing one status id, if any - the single
 * source of truth for that status's presence/stack count (see
 * getStatusStacks/setStatusStacks below), rather than a separate schema
 * counter, per the system's "use Foundry's own Effects system" design.
 * @param {Actor} actor
 * @param {string} id
 * @return {ActiveEffect|null}
 */
export function getStatusEffect(actor, id) {
  return actor.effects.find(e => e.statuses.has(id)) ?? null;
}

/**
 * An actor's current stack count for a status id - 0 if absent or
 * disabled (a disabled effect doesn't apply, so it doesn't count).
 * @param {Actor} actor
 * @param {string} id
 * @return {number}
 */
export function getStatusStacks(actor, id) {
  const effect = getStatusEffect(actor, id);
  if (!effect || effect.disabled) return 0;
  return effect.getFlag('sksk', 'stacks') ?? 1;
}

/**
 * Set an actor's stack count for a status id to an exact value - creates,
 * updates, or (at 0) deletes the backing ActiveEffect as needed, keeping
 * its name in sync (e.g. "Dazed (3)"). Exhaustion's own special case (life/
 * negative life set to 0 at stack 10, since the character dies) lives here
 * so every path that changes exhaustion (Rest healing, manual GM edits,
 * this function's own callers) triggers it uniformly.
 * @param {Actor} actor
 * @param {string} id
 * @param {number} stacks
 * @return {Promise<void>}
 */
export async function setStatusStacks(actor, id, stacks) {
  let clamped = Math.max(0, Math.round(stacks));
  if (id === 'exhaustion') clamped = Math.min(clamped, 10);
  const effect = getStatusEffect(actor, id);

  if (clamped <= 0) {
    if (effect) await effect.delete();
    return;
  }

  const def = getStatusEffectDefinitions().find(d => d.id === id);
  const name = `${def?.name || id} (${clamped})`;
  const changes = buildStatModifierChanges(def, clamped);

  if (effect) {
    await effect.update({ name, disabled: false, changes, 'flags.sksk.stacks': clamped });
  } else {
    await actor.createEmbeddedDocuments('ActiveEffect', [{
      name, img: def?.img || 'icons/svg/aura.svg', statuses: [id],
      origin: actor.uuid, flags: { sksk: { stacks: clamped } }, changes,
    }]);
  }

  if (id === 'exhaustion' && clamped >= 10) {
    await actor.update({ 'system.life.value': 0, 'system.negativeLife.value': 0 });
  }
}

/**
 * Increase a status's stack count - for a Poison severity (CONFIG.SKSK.
 * poisonSeverities), this also (re)synchronizes its shared recheck timer,
 * per the design spreadsheet ("a new stack resets the time until the
 * saving throw").
 * @param {Actor} actor
 * @param {string} id
 * @param {number} [amount]
 * @return {Promise<void>}
 */
export async function increaseStatusStacks(actor, id, amount = 1) {
  await setStatusStacks(actor, id, getStatusStacks(actor, id) + amount);

  const poisonDef = CONFIG.SKSK.poisonSeverities[id];
  if (poisonDef && poisonDef.intervalRounds > 1) {
    const effect = getStatusEffect(actor, id);
    const round = game.combat?.round ?? 0;
    await effect?.setFlag('sksk', 'nextCheckRound', round + poisonDef.intervalRounds);
  }
}

/**
 * Decrease a status's stack count (floored at 0, deleting the backing
 * effect once it reaches 0).
 * @param {Actor} actor
 * @param {string} id
 * @param {number} [amount]
 * @return {Promise<void>}
 */
export async function decreaseStatusStacks(actor, id, amount = 1) {
  await setStatusStacks(actor, id, getStatusStacks(actor, id) - amount);
}

/**
 * Create a new, independent instance of a multi-instance status effect
 * (Wound/Schaden am maximalen Leben) - unlike every other status effect,
 * each occurrence keeps its own value rather than sharing one "stacks"
 * counter, so several can coexist and each is removed individually (via
 * the normal Effects tab). Schaden am maximalen Leben's instance directly
 * reduces max Life via a real ActiveEffect change (system.life.bonus, ADD
 * mode) - Foundry's own effect-application pipeline then automatically
 * cascades into max Negative Life too, once Tenacity's buffer is
 * exhausted (see helpers/life.mjs#computeMaxNegativeLife).
 * @param {Actor} actor
 * @param {string} id   "wound" or "maxLifeDamage".
 * @param {number} value
 * @return {Promise<ActiveEffect>}
 */
export async function addStatusInstance(actor, id, value) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  const def = getStatusEffectDefinitions().find(d => d.id === id);
  const name = `${def?.name || id} (${amount})`;
  const changes = id === 'maxLifeDamage'
    ? [{ key: 'system.life.bonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(-amount) }]
    : [];
  const [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [{
    name, img: def?.img || 'icons/svg/aura.svg', statuses: [id],
    origin: actor.uuid, flags: { sksk: { value: amount } }, changes,
  }]);
  return effect;
}

/**
 * Every independent instance of a multi-instance status effect currently
 * on the actor (see addStatusInstance).
 * @param {Actor} actor
 * @param {string} id
 * @return {ActiveEffect[]}
 */
export function getStatusInstances(actor, id) {
  return actor.effects.filter(e => e.statuses.has(id) && !e.disabled);
}

/**
 * The summed value of every instance of a multi-instance status effect -
 * Wound's own per-turn damage, or Schaden am maximalen Leben's total (for
 * display; the actual max-Life reduction is automatic via each instance's
 * own ActiveEffect change, not this sum).
 * @param {Actor} actor
 * @param {string} id
 * @return {number}
 */
export function getStatusInstancesTotal(actor, id) {
  return getStatusInstances(actor, id).reduce((sum, e) => sum + (e.getFlag('sksk', 'value') ?? 0), 0);
}

/**
 * Apply (or merge into an existing) Cauterization - unlike every other
 * status effect, a second application doesn't create a separate instance
 * or bump a shared stack count; it merges into the existing one's value
 * instead. Like Adrenalin/Schaden am maximalen Leben, its value reduces
 * max Life via a real ActiveEffect change (system.life.bonus) - not
 * Negative Life (an earlier description of this had a typo).
 * @param {Actor} actor
 * @param {number} value
 * @return {Promise<void>}
 */
export async function applyCauterization(actor, value) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  if (!amount) return;

  const effect = getStatusEffect(actor, 'cauterization');
  const def = getStatusEffectDefinitions().find(d => d.id === 'cauterization');
  const newTotal = (effect?.getFlag('sksk', 'value') ?? 0) + amount;
  const name = `${def?.name || 'cauterization'} (${newTotal})`;
  const changes = [{ key: 'system.life.bonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(-newTotal) }];

  if (effect) {
    await effect.update({ name, changes, 'flags.sksk.value': newTotal });
  } else {
    await actor.createEmbeddedDocuments('ActiveEffect', [{
      name, img: def?.img || 'icons/svg/aura.svg', statuses: ['cauterization'],
      origin: actor.uuid, flags: { sksk: { value: newTotal } }, changes,
    }]);
  }
}

/**
 * Apply one stack of Frostbite - capped at (Constitution modifier + 4); a
 * stack that would exceed the cap applies 1 Dazed stack instead.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
export async function applyFrostbiteStack(actor) {
  const conMod = actor.system.attributes?.con?.mod ?? 0;
  const cap = conMod + 4;
  const current = getStatusStacks(actor, 'frostbite');
  if (current >= cap) {
    await increaseStatusStacks(actor, 'dazed', 1);
  } else {
    await increaseStatusStacks(actor, 'frostbite', 1);
  }
}

/**
 * The flat Cold damage Frostbite deals each round (regardless of its own
 * stack count, like Poison's damage dice) - double the first Class's own
 * flat life value, plus the second Class's (once unlocked, same threshold
 * as Life/Regeneration - see helpers/life.mjs/actions.mjs).
 * @param {Actor} actor
 * @return {number}
 */
function computeFrostbiteDamage(actor) {
  const level = actor.system.resources?.level?.value ?? 1;
  const hasAdvancedClass = actorHasAdvancedClass(actor);
  let total = 0;
  for (const item of actor.items) {
    if (item.type !== 'class' || !item.system.life) continue;
    if (item.system.classType === 'first') {
      total += 2 * item.system.life;
    } else if (item.system.classType === 'second') {
      const [threshold] = getClassAbilityLevels('second', hasAdvancedClass);
      if (level >= threshold) total += item.system.life;
    }
  }
  return total;
}

/**
 * Whether the actor may currently use a weapon attack (incl. Martial Arts
 * Attacks) - blocked while Prone or Restrained.
 * @param {Actor} actor
 * @return {boolean}
 */
export function canUseWeaponAttack(actor) {
  return getStatusStacks(actor, 'prone') <= 0 && getStatusStacks(actor, 'restrained') <= 0;
}

/**
 * Whether the actor may currently cast a spell with the Movement casting
 * method (system.castingMethods.movement) - blocked while Prone or
 * Restrained.
 * @param {Actor} actor
 * @return {boolean}
 */
export function canCastMovementSpell(actor) {
  return getStatusStacks(actor, 'prone') <= 0 && getStatusStacks(actor, 'restrained') <= 0;
}

/**
 * Whether the actor may currently use the Move action - blocked only
 * while Restrained (a Prone creature can still move, e.g. crawl).
 * @param {Actor} actor
 * @return {boolean}
 */
export function canMove(actor) {
  return getStatusStacks(actor, 'restrained') <= 0;
}

/**
 * Apply Restrained with its own escape-check configuration - unlike a
 * plain stack count, this status carries a difficulty and a timing choice
 * (an AP cost the restrained creature can spend any time to attempt an
 * escape, or an automatic check at the start or end of its own Combat
 * turn), so applying/editing it goes through its own function rather than
 * increaseStatusStacks.
 * @param {Actor} actor
 * @param {{dc: number, timing: ("apCost"|"start"|"end"), apCost: number}} config
 * @return {Promise<void>}
 */
export async function setRestrainedConfig(actor, config) {
  const def = getStatusEffectDefinitions().find(d => d.id === 'restrained');
  const flags = {
    sksk: {
      stacks: 1,
      dc: Math.max(0, Math.round(Number(config.dc) || 0)),
      timing: ['apCost', 'start', 'end'].includes(config.timing) ? config.timing : 'start',
      apCost: Math.max(0, Math.round(Number(config.apCost) || 0)),
    },
  };
  const effect = getStatusEffect(actor, 'restrained');
  if (effect) {
    await effect.update({ name: def?.name || 'restrained', img: def?.img, flags });
  } else {
    await actor.createEmbeddedDocuments('ActiveEffect', [{
      name: def?.name || 'restrained', img: def?.img || 'icons/svg/aura.svg',
      statuses: ['restrained'], origin: actor.uuid, flags,
    }]);
  }
}

/**
 * Roll Restrained's escape check (Strength) against its own configured
 * DC - success removes the status entirely (matching Poison's "a passed
 * check cures it" convention); failure leaves it in place. Used both by
 * the automatic start/end-of-turn timings and (with an AP cost gate
 * first) the player-triggered one - see attemptRestrainedEscapeManual.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
export async function attemptRestrainedEscape(actor) {
  const effect = getStatusEffect(actor, 'restrained');
  if (!effect) return;

  const dc = effect.getFlag('sksk', 'dc') ?? 0;
  const strMod = actor.system.attributes?.str?.mod ?? 0;
  const formula = applyD20Malus(`1d20 + ${strMod}`, actor, 'str');
  const roll = await new Roll(formula, actor.getRollData()).evaluate();
  const success = roll.total >= dc;

  if (success) await setStatusStacks(actor, 'restrained', 0);

  const outcome = game.i18n.localize(success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure');
  const extraHTML = `<div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.RestrainedCheck', { dc })}: ${outcome}</div>`;
  await postActionChatCard(actor, getStatusEffectName('restrained'), roll, 0, extraHTML);
}

/**
 * Player-triggered escape attempt (Restrained's "apCost" timing) - spends
 * its configured AP cost first (if any), aborting if the actor can't
 * afford it.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
export async function attemptRestrainedEscapeManual(actor) {
  const effect = getStatusEffect(actor, 'restrained');
  if (!effect) return;

  const apCost = effect.getFlag('sksk', 'apCost') ?? 0;
  if (apCost > 0) {
    const ap = actor.system.actionPoints.value;
    if (ap < apCost) return ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughAP'));
    await actor.update({ 'system.actionPoints.value': ap - apCost });
  }
  await attemptRestrainedEscape(actor);
}

/**
 * Exhaustion's own D20 malus - -1 per level (level 10 adds no further
 * malus on top of level 9's, since a creature reaching level 10 dies
 * outright - see setStatusStacks), applying to every D20 roll.
 * @param {Actor} actor
 * @return {number}
 */
export function computeExhaustionD20Malus(actor) {
  const stacks = getStatusStacks(actor, 'exhaustion');
  return stacks > 0 ? -Math.min(stacks, 9) : 0;
}

/**
 * Dazed's own D20 malus on Strength/Dexterity/Constitution/Appearance
 * checks specifically - -1 per stack, capped at that attribute's own
 * modifier + 5.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {number}
 */
export function computeDazedAttributeMalus(actor, attributeKey) {
  if (!DAZED_MALUS_ATTRIBUTES.includes(attributeKey)) return 0;
  const stacks = getStatusStacks(actor, 'dazed');
  if (stacks <= 0) return 0;
  const mod = actor.system.attributes?.[attributeKey]?.mod ?? 0;
  return -Math.min(stacks, mod + 5);
}

/**
 * The total flat malus (always <= 0) any D20 roll for this actor should
 * carry - Exhaustion's universal malus, plus Dazed's attribute-specific
 * one when attributeKey is one of Str/Dex/Con/App.
 * @param {Actor} actor
 * @param {string|null} [attributeKey]
 * @return {number}
 */
export function computeD20Malus(actor, attributeKey = null) {
  return computeExhaustionD20Malus(actor) + (attributeKey ? computeDazedAttributeMalus(actor, attributeKey) : 0);
}

/**
 * Append this actor's current D20 malus (if any) to a roll formula.
 * @param {string} formula
 * @param {Actor} actor
 * @param {string|null} [attributeKey]
 * @return {string}
 */
export function applyD20Malus(formula, actor, attributeKey = null) {
  const malus = computeD20Malus(actor, attributeKey);
  if (!malus) return formula;
  return `${formula} ${malus < 0 ? '-' : '+'} ${Math.abs(malus)}`;
}

/**
 * Reduce a computeMovementSpeeds() result for Dazed - every movement type
 * except Hovering drops by 1 per stack, floored at half of that type's own
 * (already-computed) speed. Called as the final step of
 * helpers/movement.mjs#computeMovementSpeeds.
 * @param {Actor} actor
 * @param {Object<string, number>} speeds
 * @return {Object<string, number>}
 */
export function applyDazedMovementReduction(actor, speeds) {
  const stacks = getStatusStacks(actor, 'dazed');
  if (stacks <= 0) return speeds;

  const reduced = { ...speeds };
  for (const key of Object.keys(reduced)) {
    if (DAZED_EXEMPT_MOVEMENT_TYPES.includes(key)) continue;
    const original = reduced[key];
    reduced[key] = Math.max(Math.floor(original / 2), original - stacks);
  }
  return reduced;
}

/**
 * Dazed's own combat-turn-start handling: deduct AP equal to its stacks
 * (at most however much keeps at least 2 AP left), removing that many
 * stacks - repeating on however many of the creature's later turns it
 * takes to work off entirely.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
async function handleDazedTurnStart(actor) {
  const stacks = getStatusStacks(actor, 'dazed');
  if (stacks <= 0) return;

  const ap = actor.system.actionPoints.value;
  const deduct = Math.min(stacks, Math.max(0, ap - 2));
  if (deduct <= 0) return;

  await actor.update({ 'system.actionPoints.value': ap - deduct });
  await setStatusStacks(actor, 'dazed', stacks - deduct);

  const extraHTML = `<div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.DazedApDrained', { amount: deduct })}</div>`;
  await postActionChatCard(actor, getStatusEffectName('dazed'), null, 0, extraHTML);
}

/**
 * Poison's own combat-turn-start handling: for every Poison severity
 * currently active on the actor, roll its damage die and apply it directly
 * to system.life.value (clamped to [0, max]), then run an automatic
 * Constitution check against its DC once its own recheck timer allows
 * (every round for Mild; every 3/5/10 rounds, first triggering that many
 * rounds after being poisoned, for Medium/Severe/Deadly). A passed check
 * cures that severity entirely; a failed one just reschedules the next
 * recheck (Mild has none to reschedule - it always triggers).
 * @param {Actor} actor
 * @param {number} round
 * @return {Promise<void>}
 */
async function handlePoisonTurnStart(actor, round) {
  for (const [severityId, def] of Object.entries(CONFIG.SKSK.poisonSeverities)) {
    const effect = getStatusEffect(actor, severityId);
    if (!effect) continue;

    const nextCheckRound = effect.getFlag('sksk', 'nextCheckRound') ?? round;
    const triggers = def.intervalRounds <= 1 || round >= nextCheckRound;
    if (!triggers) continue;

    const damageRoll = await new Roll(`1d${def.damageDie}`, actor.getRollData()).evaluate();
    const { negativeLifeDelta } = await applyLifeChange(actor, -damageRoll.total);
    const conMod = actor.system.attributes?.con?.mod ?? 0;
    const checkFormula = applyD20Malus(`1d20 + ${conMod}`, actor, 'con');
    const checkRoll = await new Roll(checkFormula, actor.getRollData()).evaluate();
    const success = checkRoll.total >= def.dc;

    if (success) {
      await setStatusStacks(actor, severityId, 0);
    } else if (def.intervalRounds > 1) {
      await effect.setFlag('sksk', 'nextCheckRound', round + def.intervalRounds);
    }

    const checkRendered = await checkRoll.render();
    const outcome = game.i18n.localize(success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure');
    const extraHTML = `
      ${negativeLifeOverflowHTML(negativeLifeDelta)}
      <div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.PoisonCheck', { dc: def.dc })}: ${outcome}</div>
      ${checkRendered}
    `;
    await postActionChatCard(actor, getStatusEffectName(severityId), damageRoll, 0, extraHTML);
  }
}

/**
 * Frostbite's own combat-turn-start handling: a flat Cold damage tick,
 * applied directly to system.life.value (clamped to [0, max]), regardless
 * of its own stack count - see computeFrostbiteDamage.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
async function handleFrostbiteTurnStart(actor) {
  if (getStatusStacks(actor, 'frostbite') <= 0) return;
  const damage = computeFrostbiteDamage(actor);
  const { negativeLifeDelta } = await applyLifeChange(actor, -damage);
  const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes.cold);
  const extraHTML = `
    <div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.FrostbiteDamage', { amount: damage, type: typeLabel })}</div>
    ${negativeLifeOverflowHTML(negativeLifeDelta)}
  `;
  await postActionChatCard(actor, getStatusEffectName('frostbite'), null, 0, extraHTML);
}

/**
 * Wound's own combat-turn-start handling: the summed damage value of
 * every Wound instance currently on the actor, applied directly to
 * system.life.value (clamped to [0, max]).
 * @param {Actor} actor
 * @return {Promise<void>}
 */
async function handleWoundTurnStart(actor) {
  const total = getStatusInstancesTotal(actor, 'wound');
  if (!total) return;
  const { negativeLifeDelta } = await applyLifeChange(actor, -total);
  const extraHTML = `
    <div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.WoundDamage', { amount: total })}</div>
    ${negativeLifeOverflowHTML(negativeLifeDelta)}
  `;
  await postActionChatCard(actor, getStatusEffectName('wound'), null, 0, extraHTML);
}

/**
 * Custom (GM-added) status effects' own combat-turn-start handling: for
 * every custom definition carrying a non-zero lifeChangePerStack and/or
 * manaChangePerStack, scaled by the actor's current stack count for that
 * status (see CUSTOM_TURN_START_FIELDS). Life change is applied directly
 * to system.life.value (clamped to [0, max]) via applyLifeChange, matching
 * every other Life-affecting status effect in this system (Wound,
 * Frostbite, Poison). Mana change is likewise applied directly to
 * system.mana.value (clamped to [0, max]), matching Mana's other automatic
 * regeneration paths (Meditation, Rest).
 * @param {Actor} actor
 * @return {Promise<void>}
 */
async function handleCustomTurnStart(actor) {
  for (const def of getStatusEffectDefinitions()) {
    if (def.predefined) continue;
    const stacks = getStatusStacks(actor, def.id);
    if (stacks <= 0) continue;

    const lifeChange = (Number(def.lifeChangePerStack) || 0) * stacks;
    if (lifeChange) {
      const { lifeDelta, negativeLifeDelta } = await applyLifeChange(actor, lifeChange);
      const total = lifeDelta - negativeLifeDelta;
      if (total) {
        const key = total > 0 ? 'SKSK.StatusEffect.CustomLifeHealing' : 'SKSK.StatusEffect.CustomLifeDamage';
        const extraHTML = `
          <div class="sksk-roll-line">${game.i18n.format(key, { amount: Math.abs(total) })}</div>
          ${negativeLifeOverflowHTML(negativeLifeDelta)}
        `;
        await postActionChatCard(actor, getStatusEffectName(def.id), null, 0, extraHTML);
      }
    }

    const manaChange = (Number(def.manaChangePerStack) || 0) * stacks;
    if (manaChange) {
      const mana = actor.system.mana;
      const newValue = clampResourceChange(mana.value, mana.max, manaChange);
      const applied = newValue - mana.value;
      if (applied) {
        await actor.update({ 'system.mana.value': newValue });
        const key = manaChange > 0 ? 'SKSK.StatusEffect.CustomManaGain' : 'SKSK.StatusEffect.CustomManaLoss';
        const extraHTML = `<div class="sksk-roll-line">${game.i18n.format(key, { amount: Math.abs(applied) })}</div>`;
        await postActionChatCard(actor, getStatusEffectName(def.id), null, 0, extraHTML);
      }
    }
  }
}

/**
 * Restrained's own combat-turn-start/end handling: an automatic escape
 * check, only when its own configured timing matches.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
async function handleRestrainedTurnStart(actor) {
  const effect = getStatusEffect(actor, 'restrained');
  if (!effect || effect.getFlag('sksk', 'timing') !== 'start') return;
  await attemptRestrainedEscape(actor);
}

async function handleRestrainedTurnEnd(actor) {
  const effect = getStatusEffect(actor, 'restrained');
  if (!effect || effect.getFlag('sksk', 'timing') !== 'end') return;
  await attemptRestrainedEscape(actor);
}

/**
 * Called once for whichever actor's Combat turn is beginning (see the
 * "combatTurnChange" hook in sksk.mjs) - runs Dazed's AP drain, every active
 * Poison severity's damage/check cycle, Frostbite's damage tick, Wound's
 * summed damage, custom status effects' own Life/Mana turn-start ticks, and
 * Restrained's automatic escape check (if timed to "start").
 * @param {Actor} actor
 * @param {number} round
 * @return {Promise<void>}
 */
export async function handleCombatTurnStart(actor, round) {
  await handleDazedTurnStart(actor);
  await handlePoisonTurnStart(actor, round);
  await handleFrostbiteTurnStart(actor);
  await handleWoundTurnStart(actor);
  await handleCustomTurnStart(actor);
  await handleRestrainedTurnStart(actor);
}

/**
 * Called once for whichever actor's Combat turn is ending (the OUTGOING
 * combatant, right before the "combatTurn" hook's own turn advances) -
 * runs Restrained's automatic escape check (if timed to "end").
 * @param {Actor} actor
 * @return {Promise<void>}
 */
export async function handleCombatTurnEnd(actor) {
  await handleRestrainedTurnEnd(actor);
}
