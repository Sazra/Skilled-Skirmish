import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';
import { getAbilityStatusLabel, getAbilityActionLabel } from './abilityRolls.mjs';
import { readAbility, getChargeState } from './abilityCharges.mjs';

/**
 * The status text of an ability row: for a "once" ability its charges and
 * cooldown, otherwise the usual activation status.
 * @param {Actor} actor
 * @param {Item} item   The Class/Species/Talent holding the ability.
 * @param {number|null} index
 * @param {{type: string, active: boolean, roundsRemaining: number}} entry
 * @return {string}
 */
export function getAbilityStatus(actor, item, index, entry) {
  if (entry.type !== 'once') return getAbilityStatusLabel(entry);
  const ability = item ? readAbility(item, index) : null;
  const state = ability ? getChargeState(actor, ability) : { has: false };
  const charges = state.has ? game.i18n.format('SKSK.Ability.Charges.Remaining', { current: state.current, max: state.max }) : '';
  return [charges, getAbilityStatusLabel(entry)].filter(Boolean).join(' - ');
}

/**
 * The visible state of an ability: active, on cooldown or ready.
 * @param {{type: string, active: boolean, roundsRemaining: number}} entry
 * @return {"active"|"cooldown"|"ready"}
 */
function abilityState(entry) {
  if (entry.type === 'active' && entry.active) return 'active';
  return entry.roundsRemaining > 0 ? 'cooldown' : 'ready';
}

/**
 * Every ability of the actor that can be activated ("active" or "once" type):
 * Species abilities, Class abilities already unlocked at the actor's level, and
 * Talents - in the same order as the sheet's Abilities tab.
 * @param {Actor} actor
 * @return {Array<{kind: "classSpecies"|"talent", itemId: string, index: number|null, name: string, source: string,
 *   img: string, type: string, active: boolean, statusLabel: string, actionLabel: string}>}
 */
export function getActivatableAbilities(actor) {
  const result = [];
  const actorLevel = actor.system.resources?.level?.value ?? 1;
  const hasAdvancedClass = actorHasAdvancedClass(actor);
  const isActivatable = type => type === 'active' || type === 'once';

  const add = (group, requiredLevel, entry) => result.push({ ...entry, group, requiredLevel });

  for (const item of actor.items) {
    if (item.type === 'species') {
      (item.system.abilities ?? []).forEach((ability, index) => {
        if ((!ability.name && !ability.description) || !isActivatable(ability.type)) return;
        add(0, 0, {
          kind: 'classSpecies', itemId: item.id, index, name: ability.name || item.name, source: item.name, img: item.img,
          type: ability.type, active: !!ability.active, state: abilityState(ability),
          statusLabel: getAbilityStatus(actor, item, index, ability), actionLabel: getAbilityActionLabel(ability),
        });
      });
    } else if (item.type === 'class') {
      const levels = getClassAbilityLevels(item.system.classType, hasAdvancedClass);
      (item.system.abilities ?? []).forEach((ability, index) => {
        if ((!ability.name && !ability.description) || !isActivatable(ability.type)) return;
        const requiredLevel = levels[index] ?? 1;
        if (actorLevel < requiredLevel) return;
        add(1, requiredLevel, {
          kind: 'classSpecies', itemId: item.id, index, name: ability.name || item.name, source: item.name, img: item.img,
          type: ability.type, active: !!ability.active, state: abilityState(ability),
          statusLabel: getAbilityStatus(actor, item, index, ability), actionLabel: getAbilityActionLabel(ability),
        });
      });
    } else if (item.type === 'talent' && isActivatable(item.system.abilityType)) {
      const entry = {
        type: item.system.abilityType, active: item.system.abilityActive, roundsRemaining: item.system.abilityRoundsRemaining,
      };
      add(2, 0, {
        kind: 'talent', itemId: item.id, index: null, name: item.name, source: item.name, img: item.img,
        type: entry.type, active: !!entry.active, state: abilityState(entry),
        statusLabel: getAbilityStatus(actor, item, null, entry), actionLabel: getAbilityActionLabel(entry),
      });
    }
  }
  return result.sort((a, b) => a.group - b.group || a.requiredLevel - b.requiredLevel);
}
