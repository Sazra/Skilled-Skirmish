import { postActionChatCard } from './actions.mjs';
import { getCombatStyleName } from './combatStyles.mjs';

/**
 * Any OTHER non-"stand" Technique on this actor that's currently primed
 * (active, awaiting the next weapon/Martial Arts attack) - only one such
 * Technique may be primed at a time (mirrors Concentration's own single-
 * pending-spell rule, see data/actor-base.mjs#pendingSpell).
 * @param {Actor} actor
 * @param {string} [excludeId]
 * @return {Item|undefined}
 */
function findPrimedNonStandTechnique(actor, excludeId = null) {
  return actor.items.find(i =>
    i.type === 'technique' && i.id !== excludeId && i.system.category !== 'stand' && i.system.active
  );
}

/**
 * The combined style-bonus totals every currently-active "stand" Technique
 * of the given Kampfstil grants (see data/technique.mjs's own
 * styleAttackBonus/styleDamageBonus/styleApCostDiscount/
 * styleManaCostDiscount fields) - multiple simultaneously active stands of
 * the same style all stack.
 * @param {Actor} actor
 * @param {string} combatStyle
 * @return {{attackBonus: number, damageBonus: number, apDiscount: number, manaDiscount: number}}
 */
export function getActiveStyleBonuses(actor, combatStyle) {
  const totals = { attackBonus: 0, damageBonus: 0, apDiscount: 0, manaDiscount: 0 };
  if (!combatStyle) return totals;
  for (const other of actor.items) {
    if (other.type !== 'technique' || other.system.category !== 'stand') continue;
    if (!other.system.active || other.system.combatStyle !== combatStyle) continue;
    totals.attackBonus += other.system.styleAttackBonus ?? 0;
    totals.damageBonus += other.system.styleDamageBonus ?? 0;
    totals.apDiscount += other.system.styleApCostDiscount ?? 0;
    totals.manaDiscount += other.system.styleManaCostDiscount ?? 0;
  }
  return totals;
}

/**
 * Spend a Technique's own AP/Mana cost (discounted by any active same-style
 * stand's own styleApCostDiscount/styleManaCostDiscount, floored at 0),
 * warning (and returning false, no changes written) if either can't be
 * afforded.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<boolean>}
 */
async function payTechniqueCost(actor, item) {
  const discounts = getActiveStyleBonuses(actor, item.system.combatStyle);
  const apCost = Math.max(0, (item.system.apCost ?? 0) - discounts.apDiscount);
  const manaCost = Math.max(0, (item.system.manaCost ?? 0) - discounts.manaDiscount);

  const ap = actor.system.actionPoints.value;
  if (ap < apCost) {
    ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughAP'));
    return false;
  }
  const mana = actor.system.mana.value;
  if (mana < manaCost) {
    ui.notifications.warn(game.i18n.localize('SKSK.Technique.NotEnoughMana'));
    return false;
  }
  await actor.update({ 'system.actionPoints.value': ap - apCost, 'system.mana.value': mana - manaCost });
  return true;
}

/**
 * Create (if none exists yet) this Technique's own linked ActiveEffect,
 * initially disabled - same bind-then-toggle pattern as apps/totem-
 * dialog.mjs#onBindTotem. Returns the effect's id.
 * @param {Item} item
 * @return {Promise<string>}
 */
async function ensureLinkedEffect(item) {
  if (item.system.effectId && item.actor?.effects.get(item.system.effectId)) return item.system.effectId;
  const [effect] = await item.actor.createEmbeddedDocuments('ActiveEffect', [{
    name: item.name,
    img: item.img || 'icons/svg/aura.svg',
    origin: item.uuid,
    disabled: true,
  }]);
  await item.update({ 'system.effectId': effect.id });
  return effect.id;
}

/**
 * The Technique item sheet's/Items-list's own "Activate"/"Deactivate"
 * button - dispatches by category. See toggleStandTechnique (stand) and
 * primeConsumableTechnique (bonusDamage, or effect of either target) below.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage|void>}
 */
export async function activateTechnique(actor, item) {
  if (!actor) return;
  if (item.system.category === 'stand') return toggleStandTechnique(actor, item);
  return primeConsumableTechnique(actor, item);
}

/**
 * A "stand" (Haltung) Technique's own toggle - activates (pays cost, starts
 * durationRounds, enables its own linked ActiveEffect) or deactivates
 * (disables that effect, starts cooldownRounds) it. Ticked down every this
 * actor's own Combat turn start - see helpers/statusEffects.mjs#
 * handleTechniqueTurnStart.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage>}
 */
export async function toggleStandTechnique(actor, item) {
  const styleName = getCombatStyleName(item.system.combatStyle) || item.name;

  if (item.system.active) {
    const effect = item.system.effectId ? actor.effects.get(item.system.effectId) : null;
    if (effect) await effect.update({ disabled: true });
    await item.update({ 'system.active': false, 'system.roundsRemaining': item.system.cooldownRounds });
    return postActionChatCard(actor, game.i18n.format('SKSK.Technique.Deactivated', { name: item.name }), null, 0);
  }

  if (item.system.roundsRemaining > 0) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.OnCooldown', { name: item.name, rounds: item.system.roundsRemaining }));
  }

  if (!(await payTechniqueCost(actor, item))) return;

  const effectId = await ensureLinkedEffect(item);
  const effect = actor.effects.get(effectId);
  if (effect) await effect.update({ disabled: false });
  await item.update({ 'system.active': true, 'system.roundsRemaining': item.system.durationRounds });

  return postActionChatCard(actor, game.i18n.format('SKSK.Technique.Activated', { name: item.name, style: styleName }), null, 0);
}

/**
 * A "bonusDamage" or "effect" Technique's own priming toggle - primes
 * (pays cost, no duration - consumed by this actor's own next weapon/
 * Martial Arts attack, see helpers/actions.mjs) or cancels priming early
 * (no refund, no cooldown started - nothing was actually used). Only one
 * non-"stand" Technique may be primed at a time.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage|void>}
 */
export async function primeConsumableTechnique(actor, item) {
  if (item.system.active) {
    await item.update({ 'system.active': false, 'system.roundsRemaining': 0 });
    return postActionChatCard(actor, game.i18n.format('SKSK.Technique.PrimeCancelled', { name: item.name }), null, 0);
  }

  if (item.system.roundsRemaining > 0) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.OnCooldown', { name: item.name, rounds: item.system.roundsRemaining }));
  }

  const conflicting = findPrimedNonStandTechnique(actor, item.id);
  if (conflicting) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.AlreadyPrimed', { name: conflicting.name }));
  }

  if (!(await payTechniqueCost(actor, item))) return;

  if (item.system.category === 'effect' && item.system.effectTarget === 'attackTarget') {
    await ensureLinkedEffect(item);
  }

  await item.update({ 'system.active': true, 'system.roundsRemaining': 0 });
  return postActionChatCard(actor, game.i18n.format('SKSK.Technique.Primed', { name: item.name }), null, 0);
}

/**
 * Whether a Technique's own "active" flag represents a genuine duration-
 * ticking buff (stand, or an "effect" targeting its own wielder) rather
 * than a "primed, awaiting the next attack" marker - see data/technique.mjs
 * and helpers/statusEffects.mjs#techniqueHasDuration (kept in sync).
 * @param {Item} item
 * @return {boolean}
 */
export function techniqueHasDuration(item) {
  return item.system.category === 'stand' || (item.system.category === 'effect' && item.system.effectTarget === 'self');
}

/**
 * A short localized status label for a Technique item - "Active (N rounds
 * left)"/"Primed"/"Cooldown (N rounds left)"/"Ready" - shared by the Item
 * sheet's own status line and the actor sheet's Actions-tab Techniques list.
 * @param {Item} item
 * @return {string}
 */
export function getTechniqueStatusLabel(item) {
  if (item.system.active) {
    return techniqueHasDuration(item)
      ? game.i18n.format('SKSK.Technique.StatusActive', { rounds: item.system.roundsRemaining })
      : game.i18n.localize('SKSK.Technique.StatusPrimed');
  }
  return item.system.roundsRemaining > 0
    ? game.i18n.format('SKSK.Technique.StatusCooldown', { rounds: item.system.roundsRemaining })
    : game.i18n.localize('SKSK.Technique.StatusReady');
}

/**
 * The localization key for a Technique item's own Activate/Deactivate/
 * Prime/Cancel button label - shared by the Item sheet's own button and
 * apps/technique-dialog.mjs's list row.
 * @param {Item} item
 * @return {string}
 */
export function getTechniqueActionLabel(item) {
  if (item.system.active) {
    return techniqueHasDuration(item) ? 'SKSK.Technique.Deactivate' : 'SKSK.Technique.CancelPrime';
  }
  if (item.system.category === 'bonusDamage') return 'SKSK.Technique.Prime';
  if (item.system.category === 'effect' && item.system.effectTarget === 'attackTarget') return 'SKSK.Technique.Prime';
  return 'SKSK.Technique.Activate';
}

/**
 * Whether a Technique item currently has (or could have) a linked
 * ActiveEffect worth an "Edit Effect" button - stand, effect-self (both
 * duration-based), and effect-attackTarget (primed, but still carries its
 * own linked effect - see ensureLinkedEffect) all qualify; bonusDamage
 * never does.
 * @param {Item} item
 * @return {boolean}
 */
export function techniqueShowsEffectButton(item) {
  return techniqueHasDuration(item) || (item.system.category === 'effect' && item.system.effectTarget === 'attackTarget');
}

/**
 * Consume whichever "bonusDamage"/"effect" Technique this actor currently
 * has primed (if any) - called from a weapon/Martial Arts attack roll (see
 * helpers/actions.mjs). Clears the primed state and starts its own
 * cooldownRounds either way. Returns null if nothing was primed.
 * @param {Actor} actor
 * @return {Promise<{item: Item, styleAttackBonus: number, bonusDamageMode: string|null, bonusDamageAmount: number, styleDamageBonus: number, effectTarget: string|null, effectId: string|null}|null>}
 */
export async function consumePrimedTechnique(actor) {
  const item = findPrimedNonStandTechnique(actor);
  if (!item) return null;

  const bonuses = getActiveStyleBonuses(actor, item.system.combatStyle);
  await item.update({ 'system.active': false, 'system.roundsRemaining': item.system.cooldownRounds });

  return {
    item,
    styleAttackBonus: bonuses.attackBonus,
    bonusDamageMode: item.system.category === 'bonusDamage' ? item.system.bonusDamageMode : null,
    bonusDamageAmount: item.system.category === 'bonusDamage' ? item.system.bonusDamageAmount : 0,
    styleDamageBonus: bonuses.damageBonus,
    effectTarget: item.system.category === 'effect' ? item.system.effectTarget : null,
    effectId: item.system.category === 'effect' ? item.system.effectId : null,
  };
}
