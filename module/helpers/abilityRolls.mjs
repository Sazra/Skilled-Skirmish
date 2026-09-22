import { postActionChatCard } from './actions.mjs';
import { isCombatActive, isActorsOwnTurn } from './statusEffects.mjs';
import { getManaAlternativeResources, computeManaAlternativeCoverage, payWithManaAlternative } from './customResources.mjs';

/**
 * A Class/Species/Talent "Fähigkeit"'s own AP-/RP-/Mana-costed activation -
 * mirrors helpers/soulPathRolls.mjs#togglePathAbility and helpers/
 * technique-rolls.mjs#payTechniqueCost, unlike either of which this also
 * honors data/actor-base.mjs#customResources.manaAlternativeForAbilities
 * (see helpers/customResources.mjs) - every eligible custom resource is
 * spent, in order, before falling back to real Mana for whatever remains,
 * same as a spell's own cast-time Mana-Alternative payment (helpers/
 * spell-rolls.mjs#rollSpellItem) just without a dialog to pick just one:
 * a single-click toggle (like Technique/Path Ability) has no such dialog
 * to hang a resource-choice control off of, so every eligible resource
 * contributes automatically instead.
 *
 * Checks affordability FIRST (AP/RP, then how much Mana would remain after
 * every eligible alternative resource's own contribution) and aborts
 * without spending anything at all if that remainder can't be covered by
 * real Mana - only once everything is confirmed affordable does it actually
 * deduct AP/RP, Mana, and each contributing resource's own points.
 * @param {Actor} actor
 * @param {number} apCost
 * @param {number} rpCost   0 = "not set", mirrors apCost 1:1 instead.
 * @param {number} manaCost
 * @return {Promise<string[]|null>} Extra chat lines (one per alternative
 *   resource that contributed) on success, null if unaffordable (a warning
 *   was already shown, nothing was spent).
 */
async function payAbilityCost(actor, apCost, rpCost, manaCost) {
  const combatActive = isCombatActive();
  const offTurn = !isActorsOwnTurn(actor);
  const resolvedRpCost = rpCost > 0 ? rpCost : apCost;

  if (combatActive) {
    if (offTurn) {
      if (actor.system.reactionPoints.value < resolvedRpCost) {
        ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughRP'));
        return null;
      }
    } else if (actor.system.actionPoints.value < apCost) {
      ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughAP'));
      return null;
    }
  }

  let remainingManaCost = manaCost;
  const spends = [];
  for (const { index, resource } of getManaAlternativeResources(actor, 'abilities')) {
    if (remainingManaCost <= 0) break;
    const { resourcePointsSpent, manaCovered } = computeManaAlternativeCoverage(resource, remainingManaCost);
    if (resourcePointsSpent <= 0) continue;
    spends.push({ index, resourcePointsSpent, manaCovered, name: resource.name || resource.abbreviation });
    remainingManaCost -= manaCovered;
  }

  if (actor.system.mana.value < remainingManaCost) {
    ui.notifications.warn(game.i18n.localize('SKSK.Ability.NotEnoughMana'));
    return null;
  }

  const costUpdate = !combatActive ? {} : (offTurn
    ? { 'system.reactionPoints.value': actor.system.reactionPoints.value - resolvedRpCost }
    : { 'system.actionPoints.value': actor.system.actionPoints.value - apCost });
  await actor.update({ ...costUpdate, 'system.mana.value': actor.system.mana.value - remainingManaCost });

  const lines = [];
  for (const spend of spends) {
    await payWithManaAlternative(actor, spend.index, spend.resourcePointsSpent);
    lines.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.AltResourcePaid', {
      name: spend.name, spent: spend.resourcePointsSpent, covered: spend.manaCovered,
    })}</div>`);
  }
  return lines;
}

/**
 * Create (if none exists yet) and return one Class/Species ability entry's
 * own linked ActiveEffect id - Totem/Path-Ability-style bind: created
 * disabled on the item's own actor, id recorded back onto that exact
 * array index.
 * @param {Item} item
 * @param {number} index
 * @return {Promise<string>}
 */
async function ensureClassSpeciesAbilityEffect(item, index) {
  const actor = item.actor;
  const abilities = item.system.abilities ?? [];
  const existingId = abilities[index]?.effectId;
  if (existingId && actor.effects.get(existingId)) return existingId;

  const entry = abilities[index];
  const [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [{
    name: entry?.name || item.name,
    img: item.img || 'icons/svg/aura.svg',
    origin: item.uuid,
    disabled: true,
  }]);

  const updated = foundry.utils.deepClone(abilities);
  updated[index] = { ...updated[index], effectId: effect.id };
  await item.update({ 'system.abilities': updated });
  return effect.id;
}

/**
 * A Class/Species item's own ability-array entry status label - only
 * meaningful for "active" ones, mirrors helpers/soulPathRolls.mjs#
 * getPathAbilityStatusLabel.
 * @param {{type: string, active: boolean, roundsRemaining: number}} entry
 * @return {string}
 */
export function getAbilityStatusLabel(entry) {
  if (entry.type !== 'active') return '';
  if (entry.active) return game.i18n.format('SKSK.Ability.StatusActive', { rounds: entry.roundsRemaining });
  return entry.roundsRemaining > 0
    ? game.i18n.format('SKSK.Ability.StatusCooldown', { rounds: entry.roundsRemaining })
    : game.i18n.localize('SKSK.Ability.StatusReady');
}

/**
 * The localization key for an ability's own Activate/Deactivate button.
 * @param {{active: boolean}} entry
 * @return {string}
 */
export function getAbilityActionLabel(entry) {
  return entry.active ? 'SKSK.Ability.Deactivate' : 'SKSK.Ability.Activate';
}

/**
 * A Class/Species ability's own toggle - mirrors helpers/soulPathRolls.mjs#
 * togglePathAbility (bind-then-toggle, duration then cooldown), operating
 * on an "abilities" array entry instead of "pathAbilities", and paying its
 * cost via payAbilityCost above (Mana-Alternative-aware) instead of a
 * plain Mana check.
 * @param {Actor} actor
 * @param {Item} item
 * @param {number} index
 * @return {Promise<ChatMessage|void>}
 */
export async function toggleClassSpeciesAbility(actor, item, index) {
  const abilities = item.system.abilities ?? [];
  const entry = abilities[index];
  if (!entry || entry.type !== 'active') return;

  const combatActive = isCombatActive();
  const name = entry.name || item.name;

  if (entry.active) {
    const effect = entry.effectId ? actor.effects.get(entry.effectId) : null;
    if (effect) await effect.update({ disabled: true });
    const updated = foundry.utils.deepClone(abilities);
    updated[index] = { ...updated[index], active: false, roundsRemaining: combatActive ? entry.cooldownRounds : 0 };
    await item.update({ 'system.abilities': updated });
    return postActionChatCard(actor, game.i18n.format('SKSK.Ability.Deactivated', { name }), null, 0);
  }

  if (entry.roundsRemaining > 0) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.OnCooldown', { name, rounds: entry.roundsRemaining }));
  }

  const lines = await payAbilityCost(actor, entry.apCost, entry.rpCost, entry.manaCost);
  if (lines === null) return;

  const effectId = await ensureClassSpeciesAbilityEffect(item, index);
  const effect = actor.effects.get(effectId);
  if (effect) await effect.update({ disabled: false });

  const updated = foundry.utils.deepClone(item.system.abilities);
  updated[index] = { ...updated[index], active: true, roundsRemaining: entry.durationRounds };
  await item.update({ 'system.abilities': updated });

  return postActionChatCard(actor, game.i18n.format('SKSK.Ability.Activated', { name }), null, 0, lines.join(''));
}

/**
 * A Talent's own single ability toggle - same shape as
 * toggleClassSpeciesAbility above, just operating on the Talent item's own
 * root "ability*"-prefixed fields instead of an array entry (a Talent
 * grants exactly one ability - see data/talent.mjs).
 * @param {Actor} actor
 * @param {Item} item
 * @return {Promise<ChatMessage|void>}
 */
export async function toggleTalentAbility(actor, item) {
  const system = item.system;
  if (system.abilityType !== 'active') return;

  const combatActive = isCombatActive();

  if (system.abilityActive) {
    const effect = system.abilityEffectId ? actor.effects.get(system.abilityEffectId) : null;
    if (effect) await effect.update({ disabled: true });
    await item.update({
      'system.abilityActive': false,
      'system.abilityRoundsRemaining': combatActive ? system.abilityCooldownRounds : 0,
    });
    return postActionChatCard(actor, game.i18n.format('SKSK.Ability.Deactivated', { name: item.name }), null, 0);
  }

  if (system.abilityRoundsRemaining > 0) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.OnCooldown', { name: item.name, rounds: system.abilityRoundsRemaining }));
  }

  const lines = await payAbilityCost(actor, system.abilityApCost, system.abilityRpCost, system.abilityManaCost);
  if (lines === null) return;

  let effectId = system.abilityEffectId;
  if (!effectId || !actor.effects.get(effectId)) {
    const [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [{
      name: item.name, img: item.img || 'icons/svg/aura.svg', origin: item.uuid, disabled: true,
    }]);
    effectId = effect.id;
    await item.update({ 'system.abilityEffectId': effectId });
  }
  const effect = actor.effects.get(effectId);
  if (effect) await effect.update({ disabled: false });

  await item.update({ 'system.abilityActive': true, 'system.abilityRoundsRemaining': system.abilityDurationRounds });

  return postActionChatCard(actor, game.i18n.format('SKSK.Ability.Activated', { name: item.name }), null, 0, lines.join(''));
}

/**
 * Every active Class/Species ability's, and every active Talent ability's,
 * own per-round ticking, at this actor's own Combat turn start - mirrors
 * helpers/statusEffects.mjs#handleTechniqueTurnStart exactly (duration
 * counts down, auto-deactivating at 0 and starting its own cooldown;
 * cooldown counts down separately), just across every owned Class/Species/
 * Talent item instead of Technique items. Called from, and folded into the
 * combined turn-start card by, helpers/statusEffects.mjs#
 * handleCombatTurnStart - returns description lines rather than posting
 * its own card.
 * @param {Actor} actor
 * @return {Promise<string[]>} descriptionLines
 */
export async function handleAbilityTurnStart(actor) {
  const lines = [];

  for (const item of actor.items.filter(i => i.type === 'class' || i.type === 'species')) {
    const abilities = foundry.utils.deepClone(item.system.abilities ?? []);
    let changed = false;
    for (const entry of abilities) {
      if (entry.type !== 'active') continue;

      if (entry.active) {
        const remaining = (entry.roundsRemaining ?? 0) - 1;
        if (remaining > 0) {
          entry.roundsRemaining = remaining;
          changed = true;
        } else {
          const effect = entry.effectId ? actor.effects.get(entry.effectId) : null;
          if (effect) await effect.update({ disabled: true });
          entry.active = false;
          entry.roundsRemaining = entry.cooldownRounds;
          changed = true;
          lines.push(game.i18n.format('SKSK.Ability.Expired', { name: entry.name || item.name }));
        }
      } else if ((entry.roundsRemaining ?? 0) > 0) {
        entry.roundsRemaining -= 1;
        changed = true;
      }
    }
    if (changed) await item.update({ 'system.abilities': abilities });
  }

  for (const item of actor.items.filter(i => i.type === 'talent')) {
    const system = item.system;
    if (system.abilityType !== 'active') continue;

    if (system.abilityActive) {
      const remaining = (system.abilityRoundsRemaining ?? 0) - 1;
      if (remaining > 0) {
        await item.update({ 'system.abilityRoundsRemaining': remaining });
      } else {
        const effect = system.abilityEffectId ? actor.effects.get(system.abilityEffectId) : null;
        if (effect) await effect.update({ disabled: true });
        await item.update({ 'system.abilityActive': false, 'system.abilityRoundsRemaining': system.abilityCooldownRounds });
        lines.push(game.i18n.format('SKSK.Ability.Expired', { name: item.name }));
      }
    } else if ((system.abilityRoundsRemaining ?? 0) > 0) {
      await item.update({ 'system.abilityRoundsRemaining': system.abilityRoundsRemaining - 1 });
    }
  }

  return lines;
}
