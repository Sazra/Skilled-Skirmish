import { postActionChatCard } from './actions.mjs';

/**
 * Movement types (CONFIG.SKSK.movementTypes) Dazed does NOT reduce.
 */
const DAZED_EXEMPT_MOVEMENT_TYPES = ['hovering'];

/**
 * Attributes whose checks Dazed applies a malus to.
 */
const DAZED_MALUS_ATTRIBUTES = ['str', 'dex', 'con', 'app'];

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

  if (effect) {
    await effect.update({ name, disabled: false, 'flags.sksk.stacks': clamped });
  } else {
    await actor.createEmbeddedDocuments('ActiveEffect', [{
      name, img: def?.img || 'icons/svg/aura.svg', statuses: [id],
      origin: actor.uuid, flags: { sksk: { stacks: clamped } },
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
 * currently active on the actor, roll its damage die (narrated only, like
 * every other damage source in this system - not applied to Life
 * automatically) and an automatic Constitution check against its DC once
 * its own recheck timer allows (every round for Mild; every 3/5/10 rounds,
 * first triggering that many rounds after being poisoned, for Medium/
 * Severe/Deadly). A passed check cures that severity entirely; a failed
 * one just reschedules the next recheck (Mild has none to reschedule - it
 * always triggers).
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
      <div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.PoisonCheck', { dc: def.dc })}: ${outcome}</div>
      ${checkRendered}
    `;
    await postActionChatCard(actor, getStatusEffectName(severityId), damageRoll, 0, extraHTML);
  }
}

/**
 * Called once for whichever actor's Combat turn is beginning (see the
 * "combatTurn" hook in sksk.mjs) - runs Dazed's AP drain and every active
 * Poison severity's damage/check cycle.
 * @param {Actor} actor
 * @param {number} round
 * @return {Promise<void>}
 */
export async function handleCombatTurnStart(actor, round) {
  await handleDazedTurnStart(actor);
  await handlePoisonTurnStart(actor, round);
}
