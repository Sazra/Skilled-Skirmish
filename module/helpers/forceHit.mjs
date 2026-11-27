/**
 * "Treffer erzwingen" (Zielsicher): a "once" ability with charges and the
 * forceHit switch lets its owner spend one charge to turn the miss of a
 * weapon/Martial Arts attack into a hit that cannot be averted. The miss card
 * then carries a button (renderForceHitButton); the click is handled by
 * helpers/attackRolls.mjs#handleForceHitFromChat.
 */

import { listChargeAbilities, getChargeState } from './abilityCharges.mjs';

/**
 * The first forceHit ability of the actor that still has a charge.
 * @param {Actor|null} actor
 * @return {import('./abilityCharges.mjs').AbilityDescriptor|null}
 */
export function findForceHitAbility(actor) {
  if (!actor) return null;
  return listChargeAbilities(actor).find(ability => ability.forceHit && getChargeState(actor, ability).current > 0) ?? null;
}

/**
 * The button for a missed attack, or '' if the attacker has no such ability
 * (or no charge left).
 * @param {Actor|null} attacker
 * @param {{kind: "auto"|"manual", attackerUuid: string|null, defenderUuid: string|null, args?: object}} payload
 *   "auto": the attack was resolved right away, args are the resolution's
 *   arguments (see attackRolls.mjs#resolveAndApplyOneAttack); "manual": the
 *   Evaluate button was used, the damage is applied by hand.
 * @return {string}
 */
export function renderForceHitButton(attacker, payload) {
  const ability = findForceHitAbility(attacker);
  if (!ability) return '';
  const state = getChargeState(attacker, ability);
  const label = game.i18n.format('SKSK.AttackRoll.ForceHit.Button', { name: ability.name, current: state.current, max: state.max });
  return `<div class="sksk-roll-line"><button type="button" class="sksk-roll-hit-eval sksk-force-hit" data-action="forceHit"
    data-ability-item="${ability.item.uuid}" data-ability-index="${ability.index ?? ''}"
    data-payload="${encodeURIComponent(JSON.stringify(payload))}">${foundry.utils.escapeHTML(label)}</button></div>`;
}
