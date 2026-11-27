/**
 * Triggered abilities: a "once" ability (data/abilityOnce.mjs) with a
 * `reaction` setting offers its effect at a fixed moment of combat:
 *
 * - trigger "afterAttack": a button on the card of the owner's own attack -
 *   effect "followUp" (more attacks of the same kind, e.g. Schlaghagel);
 * - trigger "afterMiss": a button on the card of a missed weapon attack -
 *   effect "forceHit" (the attack hits after all, e.g. Zielsicher);
 * - trigger "whenHit": asked before the damage of an attack that hit the owner
 *   is applied - effect "mitigate" (helpers/damageMitigation.mjs).
 *
 * The ability's own cost (AP/RP/Mana), charges and cooldown apply as for any
 * "once" ability. A button's click is handled by
 * helpers/attackRolls.mjs#handleAbilityTriggerFromChat.
 */

import { listOnceAbilities, getChargeState, changeCharges, startChargeClocks, updateAbility } from './abilityCharges.mjs';
import { payAbilityCost } from './abilityRolls.mjs';
import { isCombatActive } from './statusEffects.mjs';

/** The kinds of attack a trigger can be limited to (data/abilityOnce.mjs#reaction.kinds). */
export const ATTACK_KINDS = ['martialArts', 'meleeWeapon', 'rangedWeapon', 'spell'];

/** The effect each trigger offers as a button. */
const BUTTON_EFFECT = { afterAttack: 'followUp', afterMiss: 'forceHit' };

/**
 * The kind of an attack, from what the attack resolution knows of it.
 * @param {{comparisonType?: string, killSkillKey?: string|null, damageDice?: Array<{melee?: boolean}>}} attack
 * @return {"martialArts"|"meleeWeapon"|"rangedWeapon"|"spell"}
 */
export function classifyAttack({ comparisonType = 'armorClass', killSkillKey = null, damageDice = [] } = {}) {
  if (comparisonType === 'magicResistance') return 'spell';
  if (killSkillKey === 'martialArts') return 'martialArts';
  return damageDice.some(die => die.melee) ? 'meleeWeapon' : 'rangedWeapon';
}

/**
 * Whether an ability's trigger applies to this kind of attack (none of the
 * kinds checked = every kind).
 * @param {{kinds?: Object<string, boolean>}} reaction
 * @param {string} kind
 * @return {boolean}
 */
export function reactionMatchesKind(reaction, kind) {
  const checked = ATTACK_KINDS.filter(key => reaction.kinds?.[key]);
  return !checked.length || checked.includes(kind);
}

/**
 * The abilities of the actor with the given trigger that fit the attack kind
 * and are ready (off cooldown, a charge left if they have charges).
 * @param {Actor|null} actor
 * @param {"afterAttack"|"afterMiss"|"whenHit"} trigger
 * @param {string} kind   One of ATTACK_KINDS.
 * @return {import('./abilityCharges.mjs').AbilityDescriptor[]}
 */
export function findTriggerAbilities(actor, trigger, kind) {
  if (!actor) return [];
  return listOnceAbilities(actor).filter((ability) => {
    const reaction = ability.reaction;
    if (reaction?.trigger !== trigger || !reaction.effect || reaction.effect === 'none') return false;
    if (!reactionMatchesKind(reaction, kind)) return false;
    if (ability.roundsRemaining > 0) return false;
    const charges = getChargeState(actor, ability);
    return !charges.has || charges.current > 0;
  });
}

/**
 * The cost and charges of an ability as a short text ("5 Mana, 2/4").
 * @param {Actor} actor
 * @param {import('./abilityCharges.mjs').AbilityDescriptor} ability
 * @return {string}
 */
function describeCost(actor, ability) {
  const parts = [];
  if (ability.apCost > 0) parts.push(game.i18n.format('SKSK.AttackRoll.Trigger.CostAp', { n: ability.apCost }));
  if (ability.rpCost > 0) parts.push(game.i18n.format('SKSK.AttackRoll.Trigger.CostRp', { n: ability.rpCost }));
  if (ability.manaCost > 0) parts.push(game.i18n.format('SKSK.AttackRoll.Trigger.CostMana', { n: ability.manaCost }));
  const charges = getChargeState(actor, ability);
  if (charges.has) parts.push(game.i18n.format('SKSK.AttackRoll.Trigger.Charges', { current: charges.current, max: charges.max }));
  return parts.join(', ');
}

/**
 * The buttons of the abilities triggered on an attack card ('' if there is no
 * such ability).
 * @param {Actor|null} actor
 * @param {"afterAttack"|"afterMiss"} trigger
 * @param {string} kind   The attack's kind (classifyAttack).
 * @param {object} context   What the effect needs to run: for "followUp"
 *   {attack: "martialArts", index} or {attack: "weapon", itemUuid}; for
 *   "forceHit" {mode: "auto"|"manual", defenderUuid, args?} (see
 *   attackRolls.mjs#renderMissForceHit).
 * @return {string}
 */
export function renderTriggerButtons(actor, trigger, kind, context) {
  if (!actor) return '';
  const effect = BUTTON_EFFECT[trigger];
  return findTriggerAbilities(actor, trigger, kind)
    .filter(ability => ability.reaction.effect === effect)
    .map((ability) => {
      const cost = describeCost(actor, ability);
      const label = game.i18n.format('SKSK.AttackRoll.Trigger.Button', { name: ability.name, cost: cost ? ` (${cost})` : '' });
      const payload = { attackerUuid: actor.uuid, effect, context };
      return `<div class="sksk-roll-line"><button type="button" class="sksk-roll-hit-eval sksk-ability-trigger" data-action="abilityTrigger"
        data-ability-item="${ability.item.uuid}" data-ability-index="${ability.index ?? ''}"
        data-payload="${encodeURIComponent(JSON.stringify(payload))}">${foundry.utils.escapeHTML(label)}</button></div>`;
    })
    .join('');
}

/**
 * Use an ability for its trigger: cooldown and charge check, payment of its
 * AP/RP/Mana, one charge, the cooldown in Combat. Nothing is spent if one
 * check fails (a warning was shown).
 * @param {Actor} actor
 * @param {import('./abilityCharges.mjs').AbilityDescriptor} ability
 * @return {Promise<string[]|null>}   Extra chat lines of the payment, null if nothing was spent.
 */
export async function spendTriggerAbility(actor, ability) {
  if (ability.roundsRemaining > 0) {
    ui.notifications.warn(game.i18n.format('SKSK.Technique.OnCooldown', { name: ability.name, rounds: ability.roundsRemaining }));
    return null;
  }
  const charges = getChargeState(actor, ability);
  if (charges.has && charges.current <= 0) {
    ui.notifications.warn(game.i18n.format('SKSK.Ability.Charges.None', { name: ability.name }));
    return null;
  }
  const lines = await payAbilityCost(actor, ability.apCost, ability.rpCost, ability.manaCost);
  if (lines === null) return null;
  if (charges.has) {
    await changeCharges(actor, ability, -1);
    if (charges.used === 0) await startChargeClocks(ability);
  }
  if (isCombatActive() && ability.cooldownRounds > 0) await updateAbility(ability, { roundsRemaining: ability.cooldownRounds });
  return lines;
}
