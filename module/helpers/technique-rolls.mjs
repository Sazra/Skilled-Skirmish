import { getCombatStyleName } from './combatStyles.mjs';
import { resolveClickDefender, applyTechniqueEffectBundle } from './damageApplication.mjs';
import { applyD20Malus } from './statusEffects.mjs';
import {
  resolveCheckSuccess, wrapCriticalBlock, wrapCriticalInline,
  chooseGenericRollMode, evaluateD20WithMode, formatD20ModeSummaryLine,
} from './criticalRolls.mjs';
import { getActorSkillLevel, getSkillLabel } from './skills.mjs';
import { formatRollCardHeading } from './rollCard.mjs';

/**
 * Any OTHER Technique on this actor that currently occupies the shared
 * "next weapon/Martial Arts attack or spell cast" slot - only "attackBonus"
 * and "effect"/"attackTarget" ever do (both are consumed by that next
 * attack/cast, see consumePrimedTechnique below), so only one of THOSE two
 * may be primed at a time (mirrors Concentration's own single-pending-spell
 * rule, see data/actor-base.mjs#pendingSpell). "stand", "effect"/"self" (an
 * unlimited number may be simultaneously active, see toggleSelfEffectTechnique)
 * and "effect"/"direct" (never primed at all, applied immediately, see
 * activateDirectEffectTechnique) never compete for this slot.
 * @param {Actor} actor
 * @param {string} [excludeId]
 * @return {Item|undefined}
 */
function findPendingAttackSlotTechnique(actor, excludeId = null) {
  return actor.items.find(i =>
    i.type === 'technique' && i.id !== excludeId && i.system.active
    && (i.system.category === 'attackBonus' || (i.system.category === 'effect' && i.system.effectTarget === 'attackTarget'))
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
 * Build and post a Technique's own action chat card (prime/cancel/activate/
 * deactivate/direct-apply) - shared by every activation path below so they
 * all render identically: the Kampfstil's own name (12px) above the
 * heading, whenever one is set; the heading showing only the Technique's
 * own name (see helpers/rollCard.mjs#formatRollCardHeading, unlike every
 * other card type this doesn't fold a whole sentence into the heading);
 * a status line (12px, e.g. "Vorbereitet"/"Aktiviert") plus the resolved
 * target's own name, but only when that's someone OTHER than the acting
 * actor (stand/self-effect/priming never pass a defender - there's no
 * target other than the actor itself, or none resolved yet); the
 * Technique's own description, if any; then whatever roll/button/
 * application HTML the caller supplies.
 * @param {Actor} actor
 * @param {Item} item
 * @param {string} statusText   Already-localized (e.g. "Vorbereitet").
 * @param {Actor|null} [defender]
 * @param {string} [extraHTML]
 * @return {Promise<ChatMessage>}
 */
async function postTechniqueActionCard(actor, item, statusText, defender = null, extraHTML = '') {
  const styleName = getCombatStyleName(item.system.combatStyle);
  const parts = [];
  if (styleName) parts.push(`<div class="sksk-technique-style-line">${styleName}</div>`);
  parts.push(formatRollCardHeading(item.name));

  const targetSuffix = defender && defender !== actor
    ? ` – ${game.i18n.format('SKSK.Technique.TargetLabel', { target: defender.name })}`
    : '';
  parts.push(`<div class="sksk-technique-status-line">${statusText}${targetSuffix}</div>`);

  if (item.system.description) {
    const descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      item.system.description ?? '', { relativeTo: item, secrets: item.isOwner }
    );
    parts.push(`<div class="sksk-roll-description">${descriptionHTML}</div>`);
  }

  if (extraHTML) parts.push(extraHTML);

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: item.name,
    content: `<div class="sksk-chat-card sksk-action-card">${parts.join('')}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * The Technique item sheet's/Items-list's own "Activate"/"Deactivate"
 * button - dispatches by category. See toggleStandTechnique (stand) and
 * primeConsumableTechnique (attackBonus, or effect of either target) below.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage|void>}
 */
export async function activateTechnique(actor, item) {
  if (!actor) return;
  if (item.system.category === 'stand') return toggleStandTechnique(actor, item);
  if (item.system.category === 'effect' && item.system.effectTarget === 'self') return toggleSelfEffectTechnique(actor, item);
  if (item.system.category === 'effect' && item.system.effectTarget === 'direct') {
    return activateDirectEffectTechnique(actor, item);
  }
  return primeConsumableTechnique(actor, item);
}

/**
 * Shared toggle body for any duration-ticking Technique (stand, or
 * effect-self - see techniqueHasDuration) - activates (pays cost, starts
 * durationRounds, enables its own linked ActiveEffect) or deactivates
 * (disables that effect, starts cooldownRounds) it. Ticked down every this
 * actor's own Combat turn start - see helpers/statusEffects.mjs#
 * handleTechniqueTurnStart.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage>}
 */
async function toggleDurationTechnique(actor, item) {
  if (item.system.active) {
    const effect = item.system.effectId ? actor.effects.get(item.system.effectId) : null;
    if (effect) await effect.update({ disabled: true });
    await item.update({ 'system.active': false, 'system.roundsRemaining': item.system.cooldownRounds });
    return postTechniqueActionCard(actor, item, game.i18n.localize('SKSK.Technique.StatusLine.Deactivated'));
  }

  if (item.system.roundsRemaining > 0) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.OnCooldown', { name: item.name, rounds: item.system.roundsRemaining }));
  }

  if (!(await payTechniqueCost(actor, item))) return;

  const effectId = await ensureLinkedEffect(item);
  const effect = actor.effects.get(effectId);
  if (effect) await effect.update({ disabled: false });
  await item.update({ 'system.active': true, 'system.roundsRemaining': item.system.durationRounds });

  return postTechniqueActionCard(actor, item, game.i18n.localize('SKSK.Technique.StatusLine.Activated'));
}

/**
 * A "stand" (Haltung) Technique's own toggle - see toggleDurationTechnique
 * above for the shared activation/deactivation body. Only one Stand may be
 * active at a time (across the whole actor, regardless of Kampfstil) -
 * activating a second one is blocked until the first is manually
 * deactivated, mirroring findPendingAttackSlotTechnique's own warn-and-abort
 * convention rather than silently swapping them.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage|void>}
 */
export async function toggleStandTechnique(actor, item) {
  if (!item.system.active) {
    const other = actor.items.find(i =>
      i.type === 'technique' && i.id !== item.id && i.system.category === 'stand' && i.system.active
    );
    if (other) {
      return ui.notifications.warn(game.i18n.format('SKSK.Technique.OtherStandActive', { name: other.name }));
    }
  }
  return toggleDurationTechnique(actor, item);
}

/**
 * An "effect" Technique's own effectTarget "self" toggle - a self buff with
 * duration, applied unconditionally, no saving throw (see data/
 * technique.mjs). Unlike Stand, an unlimited number of different Self-
 * Effect Techniques may be simultaneously active - see toggleDurationTechnique
 * above for the shared activation/deactivation body.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage|void>}
 */
export async function toggleSelfEffectTechnique(actor, item) {
  return toggleDurationTechnique(actor, item);
}

/**
 * An "attackBonus" or "effect"/"attackTarget" Technique's own priming
 * toggle - primes (pays cost, no duration - consumed by this actor's own
 * next weapon/Martial Arts attack or spell cast, see helpers/actions.mjs/
 * helpers/spell-rolls.mjs) or cancels priming early (no refund, no cooldown
 * started - nothing was actually used). Only one of these two ever shares
 * the "next attack" slot at a time - see findPendingAttackSlotTechnique.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage|void>}
 */
export async function primeConsumableTechnique(actor, item) {
  if (item.system.active) {
    await item.update({ 'system.active': false, 'system.roundsRemaining': 0 });
    return postTechniqueActionCard(actor, item, game.i18n.localize('SKSK.Technique.StatusLine.Cancelled'));
  }

  if (item.system.roundsRemaining > 0) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.OnCooldown', { name: item.name, rounds: item.system.roundsRemaining }));
  }

  const conflicting = findPendingAttackSlotTechnique(actor, item.id);
  if (conflicting) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.AlreadyPrimed', { name: conflicting.name }));
  }

  if (!(await payTechniqueCost(actor, item))) return;

  if (item.system.category === 'effect' && item.system.effectTarget === 'attackTarget') {
    await ensureLinkedEffect(item);
  }

  await item.update({ 'system.active': true, 'system.roundsRemaining': 0 });
  return postTechniqueActionCard(actor, item, game.i18n.localize('SKSK.Technique.StatusLine.Primed'));
}

/**
 * An "effect" Technique's own effectTarget "direct" activation - unlike
 * "attackTarget" (primed, consumed by the next attack/cast), this applies
 * right away: pays cost, resolves a defender the same way Evaluate Hit/Apply
 * Damage do (helpers/damageApplication.mjs#resolveClickDefender, shown in
 * this card's own status line), then either renders its saving-throw button
 * (see renderTechniqueSavingThrowHTML below - clicking it later rolls
 * against whoever resolveClickDefender resolves to AT THAT TIME, same as
 * "attackTarget", and only applies the effect(s) on a failed save) or
 * applies its effect(s) unconditionally right here (see helpers/
 * damageApplication.mjs#applyTechniqueEffectBundle) - never primes
 * (system.active stays false), only starts its own cooldownRounds. Aborts
 * (no cost paid) if no defender can be resolved.
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage|void>}
 */
export async function activateDirectEffectTechnique(actor, item) {
  if (item.system.roundsRemaining > 0) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.OnCooldown', { name: item.name, rounds: item.system.roundsRemaining }));
  }

  const defender = resolveClickDefender();
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  if (!(await payTechniqueCost(actor, item))) return;

  await ensureLinkedEffect(item);
  await item.update({ 'system.roundsRemaining': item.system.cooldownRounds });

  const statusText = game.i18n.localize('SKSK.Technique.StatusLine.Activated');
  if (item.system.effectSavingThrowEnabled) {
    const buttonHTML = renderTechniqueSavingThrowHTML({ item, effectTarget: 'direct', effectSavingThrowEnabled: true });
    return postTechniqueActionCard(actor, item, statusText, defender, buttonHTML);
  }

  const appliedHTML = await applyTechniqueEffectBundle(item.uuid, defender);
  return postTechniqueActionCard(actor, item, statusText, defender, appliedHTML);
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
  if (item.system.category === 'attackBonus') return 'SKSK.Technique.Prime';
  if (item.system.category === 'effect' && item.system.effectTarget === 'attackTarget') return 'SKSK.Technique.Prime';
  return 'SKSK.Technique.Activate';
}

/**
 * Whether a Technique item currently has (or could have) a linked
 * ActiveEffect worth an "Edit Effect" button - stand, effect-self (both
 * duration-based), effect-attackTarget (primed, but still carries its own
 * linked effect - see ensureLinkedEffect), and effect-direct (applied
 * immediately, but still carries its own linked effect the same way) all
 * qualify; attackBonus never does.
 * @param {Item} item
 * @return {boolean}
 */
export function techniqueShowsEffectButton(item) {
  return techniqueHasDuration(item)
    || (item.system.category === 'effect' && (item.system.effectTarget === 'attackTarget' || item.system.effectTarget === 'direct'));
}

/**
 * Whether an "attackBonus" Technique is applicable to the given attack
 * context - see data/technique.mjs#applicableToWeapon/applicableToMartialArts/
 * applicableToSpell. Always true for any other category (only "attackBonus"
 * is ever restricted this way) or when no contextType was given.
 * @param {Item} item
 * @param {"weapon"|"martialArts"|"spell"|null} contextType
 * @return {boolean}
 */
function isTechniqueApplicableToContext(item, contextType) {
  if (item.system.category !== 'attackBonus' || !contextType) return true;
  if (contextType === 'weapon') return item.system.applicableToWeapon;
  if (contextType === 'martialArts') return item.system.applicableToMartialArts;
  if (contextType === 'spell') return item.system.applicableToSpell;
  return true;
}

/**
 * Consume whichever "attackBonus"/"effect" Technique this actor currently
 * has primed (if any) - called from a weapon/Martial Arts attack roll (see
 * helpers/actions.mjs#rollWeaponItem/rollMartialArtsAttack) or a spell's own
 * effect resolution (see helpers/spell-rolls.mjs#renderSpellEffectParts, for
 * both an immediate cast and a later AP-debt/ritual-minutes payoff). Clears
 * the primed state and starts its own cooldownRounds either way. Returns
 * null if nothing was primed, or if an "attackBonus" Technique is primed but
 * not applicable to contextType (see isTechniqueApplicableToContext above) -
 * in that case it's left untouched, still primed, awaiting a matching attack.
 * @param {Actor} actor
 * @param {"weapon"|"martialArts"|"spell"|null} [contextType]   Which kind of
 *   attack/cast is consuming it - only ever gates "attackBonus" Techniques
 *   (see data/technique.mjs#applicableToWeapon et al.); "effect" Techniques
 *   remain applicable to any attack/cast type regardless.
 * @return {Promise<{item: Item, styleAttackBonus: number, hitBonusAmount: number, bonusDamageMode: string|null, bonusDamageAmount: number, bonusDamageFormula: string, diceIncreaseMode: string|null, diceIncreaseAmount: number, styleDamageBonus: number, effectTarget: string|null, effectId: string|null, effectHasStatusEffects: boolean, effectSavingThrowEnabled: boolean}|null>}
 */
export async function consumePrimedTechnique(actor, contextType = null) {
  const item = findPendingAttackSlotTechnique(actor);
  if (!item) return null;
  if (!isTechniqueApplicableToContext(item, contextType)) return null;

  const bonuses = getActiveStyleBonuses(actor, item.system.combatStyle);
  const isAttackBonus = item.system.category === 'attackBonus';
  const isEffect = item.system.category === 'effect';
  await item.update({ 'system.active': false, 'system.roundsRemaining': item.system.cooldownRounds });

  return {
    item,
    styleAttackBonus: bonuses.attackBonus,
    hitBonusAmount: isAttackBonus ? (item.system.hitBonusAmount ?? 0) : 0,
    bonusDamageMode: isAttackBonus ? item.system.bonusDamageMode : null,
    bonusDamageAmount: isAttackBonus ? item.system.bonusDamageAmount : 0,
    bonusDamageFormula: isAttackBonus ? item.system.bonusDamageFormula : '',
    diceIncreaseMode: isAttackBonus ? item.system.diceIncreaseMode : null,
    diceIncreaseAmount: isAttackBonus ? item.system.diceIncreaseAmount : 0,
    styleDamageBonus: bonuses.damageBonus,
    effectTarget: isEffect ? item.system.effectTarget : null,
    effectId: isEffect ? item.system.effectId : null,
    effectHasStatusEffects: isEffect && (item.system.effectStatusEffects?.length ?? 0) > 0,
    effectSavingThrowEnabled: isEffect && item.system.effectSavingThrowEnabled,
  };
}

/**
 * Transform a base damage formula's own FIRST die term by a consumed
 * "attackBonus" Technique's own Schadenswürfelerhöhung (dice increase) -
 * "additive" rolls diceIncreaseAmount more dice of that same size,
 * "multiplicative" multiplies that term's own die count by diceIncreaseAmount
 * (rounded, floored at 0). Must run BEFORE the formula is evaluated - unlike
 * applyTechniqueBonusDamage below, which adjusts an already-rolled total. A
 * no-op (returns formula unchanged) if nothing was consumed, it wasn't an
 * "attackBonus" one, diceIncreaseMode is "none", or the formula has no dice
 * term to scale (e.g. a flat number).
 * @param {string} formula
 * @param {{item: Item, diceIncreaseMode: string|null, diceIncreaseAmount: number}|null} technique
 * @return {string}
 */
export function applyTechniqueDiceIncrease(formula, technique) {
  if (!technique || technique.item.system.category !== 'attackBonus') return formula;
  if (!technique.diceIncreaseMode || technique.diceIncreaseMode === 'none' || !formula) return formula;

  let roll;
  try {
    roll = new Roll(String(formula));
  } catch {
    return formula;
  }
  const dieTerm = roll.terms.find(term => term instanceof foundry.dice.terms.Die);
  if (!dieTerm) return formula;

  const newCount = technique.diceIncreaseMode === 'multiplicative'
    ? Math.round(dieTerm.number * technique.diceIncreaseAmount)
    : dieTerm.number + technique.diceIncreaseAmount;
  const pattern = new RegExp(`${dieTerm.number}d${dieTerm.faces}`, 'i');
  return formula.replace(pattern, `${Math.max(0, newCount)}d${dieTerm.faces}`);
}

/**
 * Apply a consumed "attackBonus" Technique's own Bonusschaden (see
 * consumePrimedTechnique above) to an already-rolled damage total - "flat"
 * mode adds bonusDamageAmount, "multiply" mode multiplies by it (rounded),
 * "formula" mode rolls bonusDamageFormula fresh and adds its own total; any
 * active same-Kampfstil stand's own styleDamageBonus is always added flat on
 * top regardless of mode (including "none"). Returns the unmodified total
 * and no chat line if nothing was consumed (technique is null) or it wasn't
 * an "attackBonus" one - "effect" Techniques are handled separately (see
 * getTechniqueEffectPayload/renderTechniqueSavingThrowHTML below), never
 * through this function.
 * @param {number} total
 * @param {{item: Item, bonusDamageMode: string|null, bonusDamageAmount: number, bonusDamageFormula: string, styleDamageBonus: number}|null} technique
 * @param {object} [rollData]   For evaluating a "formula" mode's own roll.
 * @return {Promise<{total: number, line: string}>}
 */
export async function applyTechniqueBonusDamage(total, technique, rollData = {}) {
  if (!technique || technique.item.system.category !== 'attackBonus') return { total, line: '' };

  let adjusted = total;
  if (technique.bonusDamageMode === 'multiply') {
    adjusted = Math.round(adjusted * technique.bonusDamageAmount);
  } else if (technique.bonusDamageMode === 'flat') {
    adjusted += technique.bonusDamageAmount;
  } else if (technique.bonusDamageMode === 'formula' && technique.bonusDamageFormula) {
    const bonusRoll = await new Roll(technique.bonusDamageFormula, rollData).evaluate();
    adjusted += bonusRoll.total;
  }
  adjusted += technique.styleDamageBonus ?? 0;

  const line = `<div class="sksk-roll-line">${game.i18n.format('SKSK.Technique.Consumed', { name: technique.item.name })}</div>`;
  return { total: adjusted, line };
}

/**
 * The {itemUuid} payload renderApplyDamageButton (see helpers/
 * damageApplication.mjs) needs to also apply a consumed "effect"/
 * "attackTarget" Technique's own effect(s) (linked ActiveEffect and/or
 * predefined status effects - see helpers/damageApplication.mjs#
 * applyTechniqueEffectBundle) to whoever that button ends up resolving as
 * the defender - null whenever there's nothing to apply, or that Technique's
 * own saving throw is enabled instead (handled by
 * renderTechniqueSavingThrowHTML below, its own dedicated button, rendered
 * separately - the two are mutually exclusive per consumption). Also null
 * for anything else consumed (attackBonus, effect/self - the latter is
 * applied to the caster/attacker itself at prime time instead, via
 * toggleStandTechnique's own duration-based sibling path, not here).
 * @param {{item: Item, effectTarget: string|null, effectId: string|null, effectHasStatusEffects: boolean, effectSavingThrowEnabled: boolean}|null} technique
 * @return {{itemUuid: string}|null}
 */
export function getTechniqueEffectPayload(technique) {
  if (!technique || technique.effectTarget !== 'attackTarget') return null;
  if (technique.effectSavingThrowEnabled) return null;
  if (!technique.effectId && !technique.effectHasStatusEffects) return null;
  return { itemUuid: technique.item.uuid };
}

/**
 * Render a consumed "effect"/"attackTarget" (or just-activated "effect"/
 * "direct") Technique's own saving-throw gate - a single centered button
 * (mirrors helpers/attackRolls.mjs#renderAttackPairHTML's own "Evaluate"
 * button styling) that both rolls the resolved defender's saving throw AND
 * (on a failed save) immediately applies the technique's effect(s) to them,
 * all in one click - see rollTechniqueEffectSaveFromChat below, which
 * re-resolves the defender itself at click time (helpers/
 * damageApplication.mjs#resolveClickDefender), independent of whoever it
 * resolved to earlier. Empty string whenever this Technique's own saving
 * throw isn't enabled (see getTechniqueEffectPayload above for the
 * unconditional-apply sibling path in that case) or nothing relevant was
 * consumed/activated.
 * @param {{item: Item, effectTarget: string|null, effectSavingThrowEnabled: boolean}|null} technique
 * @return {string}
 */
export function renderTechniqueSavingThrowHTML(technique) {
  if (!technique || (technique.effectTarget !== 'attackTarget' && technique.effectTarget !== 'direct')) return '';
  if (!technique.effectSavingThrowEnabled) return '';
  const dc = technique.item.system.effectSavingThrowBaseValue ?? 10;
  return `<button type="button" class="sksk-roll-hit-eval" data-action="rollTechniqueEffectSave"
    data-item-uuid="${technique.item.uuid}">
    ${game.i18n.format('SKSK.Technique.RollSavingThrow', { dc })}
  </button>`;
}

/**
 * Handle a click on an "effect" Technique's own saving-throw button (see
 * renderTechniqueSavingThrowHTML above): resolves a defender the same way
 * Evaluate Hit/Apply Damage do (helpers/damageApplication.mjs#
 * resolveClickDefender), rolls 1d20 plus their own best applicable
 * attribute modifier or skill level (per the Technique's own
 * effectSavingThrowTestAttributes/effectSavingThrowTestSkills - same "best
 * of everything tested" rule as helpers/spell-rolls.mjs#
 * rollSavingThrowFromChat) against effectSavingThrowBaseValue, and - unlike
 * Spell's own saving throws, which never auto-gate anything - immediately
 * applies the Technique's own effect(s) (see helpers/damageApplication.mjs#
 * applyTechniqueEffectBundle) to that defender if, and only if, the save was
 * FAILED (a successful save resists the effect entirely).
 * @param {string} itemUuid
 * @return {Promise<ChatMessage|void>}
 */
export async function rollTechniqueEffectSaveFromChat(itemUuid) {
  const item = await fromUuid(itemUuid);
  if (!item) return;

  const defender = resolveClickDefender();
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const mode = await chooseGenericRollMode();
  if (!mode) return;

  const system = item.system;
  let best = null;
  for (const [attributeKey, enabled] of Object.entries(system.effectSavingThrowTestAttributes ?? {})) {
    if (!enabled) continue;
    const mod = defender.system.attributes?.[attributeKey]?.mod ?? 0;
    if (!best || mod > best.value) {
      best = { label: game.i18n.localize(CONFIG.SKSK.attributeAbbreviations[attributeKey]).toUpperCase(), value: mod, attributeKey };
    }
  }
  for (const skillKey of system.effectSavingThrowTestSkills ?? []) {
    const level = getActorSkillLevel(defender, skillKey);
    if (!best || level > best.value) {
      best = { label: game.i18n.localize(getSkillLabel(skillKey)), value: level, attributeKey: null };
    }
  }
  best ??= { label: '', value: 0, attributeKey: null };

  const dc = system.effectSavingThrowBaseValue ?? 10;
  const formula = applyD20Malus(`1d20 + ${best.value}`, defender, best.attributeKey);
  const result = await evaluateD20WithMode(formula, defender.getRollData(), mode);
  const { roll, criticalType } = result;
  const success = resolveCheckSuccess(roll.total, dc, criticalType);

  const appliedHTML = success ? '' : await applyTechniqueEffectBundle(itemUuid, defender);

  const outcomeKey = criticalType === 'success' ? 'SKSK.Spell.Roll.CriticalSuccess'
    : criticalType === 'failure' ? 'SKSK.Spell.Roll.CriticalFailure'
    : success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure';
  const outcome = wrapCriticalInline(game.i18n.localize(outcomeKey), criticalType);
  const line = `<div class="sksk-roll-line">${game.i18n.format('SKSK.Technique.SavingThrowLine', {
    defender: defender.name, label: best.label, dc, outcome,
  })}</div>`;

  const content = `<div class="sksk-chat-card sksk-action-card">${formatRollCardHeading(item.name)}`
    + line + wrapCriticalBlock(await roll.render(), criticalType) + formatD20ModeSummaryLine(result, mode) + appliedHTML
    + `</div>`;
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: item.name,
    content,
    rolls: [roll],
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
