import { postActionChatCard } from './actions.mjs';

/**
 * The 5 progression stages, in order - must stay in sync with
 * data/soulPath.mjs's own schema keys and helpers/config.mjs#soulPathStages.
 * Sequential-unlock logic below (isBreakthroughUnlocked) walks this order.
 */
const STAGE_KEYS = ['sammlung', 'staerkung', 'kristallisierung', 'erwachen', 'aufstieg'];

/**
 * The actor's own bound Soul Path Item, if any - at most one is ever
 * expected to exist (enforced by sheets/actor-sheet.mjs's own creation/drop
 * guards).
 * @param {Actor} actor
 * @return {Item|null}
 */
export function getSoulPathItem(actor) {
  return actor?.items.find(i => i.type === 'soulPath') ?? null;
}

/**
 * Create (if none exists yet) and return one array-entry's own linked
 * ActiveEffect id - Totem-style bind: created disabled on the Item's own
 * actor, id recorded back onto that exact array index. `arrayField` is
 * either "pathAbilities" or one of the 5 stage keys.
 * @param {Item} item
 * @param {string} arrayField
 * @param {number} index
 * @param {string} [fallbackName]
 * @return {Promise<string>}
 */
async function ensureEntryEffect(item, arrayField, index, fallbackName) {
  const actor = item.actor;
  const array = item.system[arrayField] ?? [];
  const existingId = array[index]?.effectId;
  if (existingId && actor.effects.get(existingId)) return existingId;

  const [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [{
    name: fallbackName || item.name,
    img: item.img || 'icons/svg/aura.svg',
    origin: item.uuid,
    disabled: true,
  }]);

  const updated = foundry.utils.deepClone(item.system[arrayField]);
  updated[index] = { ...updated[index], effectId: effect.id };
  await item.update({ [`system.${arrayField}`]: updated });
  return effect.id;
}

/**
 * Whether stage[index] is sequentially unlocked: the first entry of a
 * stage needs every entry of the PRECEDING stage at completedCount >= 1
 * (the very first stage's first entry is always unlocked); any later entry
 * needs only the immediately preceding entry of the SAME stage at
 * completedCount >= 1.
 * @param {Item} item
 * @param {string} stageKey
 * @param {number} index
 * @return {boolean}
 */
export function isBreakthroughUnlocked(item, stageKey, index) {
  const stage = item.system[stageKey] ?? [];
  if (!stage[index]) return false;

  if (index > 0) return (stage[index - 1]?.completedCount ?? 0) >= 1;

  const stageOrder = STAGE_KEYS.indexOf(stageKey);
  if (stageOrder <= 0) return true;
  const previousStage = item.system[STAGE_KEYS[stageOrder - 1]] ?? [];
  return previousStage.every(entry => (entry.completedCount ?? 0) >= 1);
}

/**
 * isBreakthroughUnlocked plus the entry's own mode-specific attemptability:
 * "once" blocks once completedCount >= 1; "repeatableUntilNext" blocks
 * once the NEXT entry of the same stage has itself been completed at least
 * once (you've moved past it); "repeatable" never self-blocks.
 * @param {Item} item
 * @param {string} stageKey
 * @param {number} index
 * @return {boolean}
 */
export function isBreakthroughAttemptable(item, stageKey, index) {
  if (!isBreakthroughUnlocked(item, stageKey, index)) return false;
  const stage = item.system[stageKey] ?? [];
  const entry = stage[index];
  if (!entry) return false;

  if (entry.mode === 'once') return (entry.completedCount ?? 0) < 1;
  if (entry.mode === 'repeatableUntilNext') {
    const next = stage[index + 1];
    return !(next && (next.completedCount ?? 0) >= 1);
  }
  return true;
}

/**
 * A breakthrough's own cost/difficulty, scaled by its own
 * costIncreasePerCompletion/difficultyIncreasePerCompletion for every
 * completion so far (the very first attempt always uses the base values).
 * @param {Item} item
 * @param {string} stageKey
 * @param {number} index
 * @return {{cost: number, difficulty: number}}
 */
export function getBreakthroughEffectiveValues(item, stageKey, index) {
  const entry = item.system[stageKey]?.[index];
  if (!entry) return { cost: 0, difficulty: 0 };
  const n = entry.completedCount ?? 0;
  return {
    cost: entry.cost + (entry.costIncreasePerCompletion ?? 0) * n,
    difficulty: entry.difficulty + (entry.difficultyIncreasePerCompletion ?? 0) * n,
  };
}

/**
 * Whether a pathAbilities[index] entry should be shown at all on the actor
 * sheet - always true unless lockedBehindBreakthrough is set, in which case
 * it stays hidden until the referenced breakthrough (requiredStage +
 * requiredBreakthroughIndex) has completedCount >= 1.
 * @param {Item} item
 * @param {number} index
 * @return {boolean}
 */
export function isPathAbilityVisible(item, index) {
  const ability = item.system.pathAbilities?.[index];
  if (!ability) return false;
  if (!ability.lockedBehindBreakthrough || !ability.requiredStage) return true;
  const stage = item.system[ability.requiredStage] ?? [];
  const required = stage[ability.requiredBreakthroughIndex ?? -1];
  return (required?.completedCount ?? 0) >= 1;
}

/**
 * The moment a breakthrough first reaches completedCount 1, any PASSIVE
 * Path Ability gated behind it becomes visible - its own linked effect
 * needs to be created (if not yet) and enabled right away, since passive
 * abilities have no activation button of their own. Active ones are left
 * alone here - they only enable their effect once the player actually
 * activates them (see togglePathAbility).
 * @param {Actor} actor
 * @param {Item} item
 * @param {string} stageKey
 * @param {number} index
 * @return {Promise<void>}
 */
async function unlockGatedPathAbilities(actor, item, stageKey, index) {
  const abilities = item.system.pathAbilities ?? [];
  for (let i = 0; i < abilities.length; i++) {
    const ability = abilities[i];
    if (ability.type !== 'passive' || !ability.lockedBehindBreakthrough) continue;
    if (ability.requiredStage !== stageKey || ability.requiredBreakthroughIndex !== index) continue;

    const effectId = await ensureEntryEffect(item, 'pathAbilities', i, ability.name);
    const effect = actor.effects.get(effectId);
    if (effect?.disabled) await effect.update({ disabled: false });
  }
}

/**
 * The full Durchbruch (breakthrough) attempt flow: the actor's ENTIRE
 * current Seelenenergie pool is consumed (not just the cost), then a 1d100
 * roll is made. Success requires roll + bonuses to exceed the effective
 * difficulty - bonuses come from (a) how much Seelenenergie was paid beyond
 * the effective cost (+1 per 5% of cost paid in excess), and (b) the
 * actor's own system.soulPathBreakthroughBonus (data/actor-base.mjs),
 * summed automatically by Foundry's own Active Effect pipeline from Path
 * Abilities, completed breakthroughs, and any other Item's effects - no
 * manual aggregation here. Requires at least the effective cost currently
 * banked (warns + aborts otherwise, nothing spent). On success,
 * completedCount is incremented (mode "once" also sets completed=true) and,
 * only on the very first completion, this breakthrough's own linked effect
 * is created/enabled and any Path Ability gated behind it is unlocked.
 * Posts a chat card either way.
 * @param {Actor} actor
 * @param {Item} item
 * @param {string} stageKey
 * @param {number} index
 * @return {Promise<boolean|void>}
 */
export async function attemptBreakthrough(actor, item, stageKey, index) {
  if (!isBreakthroughAttemptable(item, stageKey, index)) {
    return ui.notifications.warn(game.i18n.localize('SKSK.SoulPath.NotAttemptable'));
  }
  const entry = item.system[stageKey][index];
  const { cost: effectiveCost, difficulty: effectiveDifficulty } = getBreakthroughEffectiveValues(item, stageKey, index);

  const pool = actor.system.soulPower.value;
  if (pool < effectiveCost) {
    return ui.notifications.warn(game.i18n.format('SKSK.SoulPath.NotEnoughSoulPower', { cost: effectiveCost }));
  }

  const spentAmount = pool;
  await actor.update({ 'system.soulPower.value': 0 });

  const excessBonus = effectiveCost > 0 ? Math.floor((spentAmount - effectiveCost) / (effectiveCost * 0.05)) : 0;
  const abilityBonus = actor.system.soulPathBreakthroughBonus ?? 0;

  const roll = await new Roll('1d100').evaluate();
  const total = roll.total + excessBonus + abilityBonus;
  const success = total > effectiveDifficulty;

  const stageArray = foundry.utils.deepClone(item.system[stageKey]);
  const wasFirstCompletion = (stageArray[index].completedCount ?? 0) === 0;
  if (success) {
    stageArray[index].completedCount = (stageArray[index].completedCount ?? 0) + 1;
    if (stageArray[index].mode === 'once') stageArray[index].completed = true;
  }
  await item.update({ [`system.${stageKey}`]: stageArray });

  if (success && wasFirstCompletion) {
    const effectId = await ensureEntryEffect(item, stageKey, index, entry.name);
    const effect = actor.effects.get(effectId);
    if (effect) await effect.update({ disabled: false });
    await unlockGatedPathAbilities(actor, item, stageKey, index);
  }

  const resultKey = success ? 'SKSK.SoulPath.BreakthroughSuccess' : 'SKSK.SoulPath.BreakthroughFailure';
  const lines = [
    `<div class="sksk-roll-line">${game.i18n.format('SKSK.SoulPath.BreakthroughRollLine', {
      roll: roll.total, excessBonus, abilityBonus, total, difficulty: effectiveDifficulty,
    })}</div>`,
    `<div class="sksk-roll-line">${game.i18n.format('SKSK.SoulPath.BreakthroughCostPaidLine', { amount: spentAmount })}</div>`,
    `<div class="sksk-roll-description"><strong>${game.i18n.localize(resultKey)}</strong></div>`,
  ].join('');

  await postActionChatCard(actor, game.i18n.format('SKSK.SoulPath.BreakthroughAttemptTitle', { name: entry.name }), roll, 0, lines);

  return success;
}

/**
 * A Path Ability's own status label - only meaningful for "active" ones
 * (mirrors Technique's own getTechniqueStatusLabel, minus the "primed"
 * state Techniques have but Path Abilities don't).
 * @param {{type: string, active: boolean, roundsRemaining: number}} entry
 * @return {string}
 */
export function getPathAbilityStatusLabel(entry) {
  if (entry.type !== 'active') return '';
  if (entry.active) return game.i18n.format('SKSK.SoulPath.StatusActive', { rounds: entry.roundsRemaining });
  return entry.roundsRemaining > 0
    ? game.i18n.format('SKSK.SoulPath.StatusCooldown', { rounds: entry.roundsRemaining })
    : game.i18n.localize('SKSK.SoulPath.StatusReady');
}

/**
 * The localization key for a Path Ability's own Activate/Deactivate button.
 * @param {{active: boolean}} entry
 * @return {string}
 */
export function getPathAbilityActionLabel(entry) {
  return entry.active ? 'SKSK.SoulPath.Deactivate' : 'SKSK.SoulPath.Activate';
}

/**
 * An active Path Ability's own toggle - mirrors Technique's own
 * toggleStandTechnique (bind-then-toggle, AP/Mana cost, duration then
 * cooldown), just operating on a pathAbilities array entry instead of an
 * Item's own root fields, and with no combatStyle-driven cost discount
 * (Path Abilities have none).
 * @param {Actor} actor
 * @param {Item} item
 * @param {number} index
 * @return {Promise<ChatMessage|void>}
 */
export async function togglePathAbility(actor, item, index) {
  const abilities = item.system.pathAbilities ?? [];
  const entry = abilities[index];
  if (!entry || entry.type !== 'active') return;

  if (entry.active) {
    const effect = entry.effectId ? actor.effects.get(entry.effectId) : null;
    if (effect) await effect.update({ disabled: true });
    const updated = foundry.utils.deepClone(abilities);
    updated[index] = { ...updated[index], active: false, roundsRemaining: entry.cooldownRounds };
    await item.update({ 'system.pathAbilities': updated });
    return postActionChatCard(actor, game.i18n.format('SKSK.SoulPath.PathAbilityDeactivated', { name: entry.name }), null, 0);
  }

  if (entry.roundsRemaining > 0) {
    return ui.notifications.warn(game.i18n.format('SKSK.Technique.OnCooldown', { name: entry.name, rounds: entry.roundsRemaining }));
  }

  const ap = actor.system.actionPoints.value;
  if (ap < entry.apCost) return ui.notifications.warn(game.i18n.localize('SKSK.SoulPath.NotEnoughAP'));
  const mana = actor.system.mana.value;
  if (mana < entry.manaCost) return ui.notifications.warn(game.i18n.localize('SKSK.SoulPath.NotEnoughMana'));

  const effectId = await ensureEntryEffect(item, 'pathAbilities', index, entry.name);
  const effect = actor.effects.get(effectId);
  if (effect) await effect.update({ disabled: false });

  const updated = foundry.utils.deepClone(item.system.pathAbilities);
  updated[index] = { ...updated[index], active: true, roundsRemaining: entry.durationRounds };
  await item.update({ 'system.pathAbilities': updated });
  await actor.update({ 'system.actionPoints.value': ap - entry.apCost, 'system.mana.value': mana - entry.manaCost });

  return postActionChatCard(actor, game.i18n.format('SKSK.SoulPath.PathAbilityActivated', { name: entry.name }), null, 0);
}

/**
 * Path Ability's own per-round ticking, at this actor's own Combat turn
 * start - mirrors helpers/statusEffects.mjs's own handleTechniqueTurnStart:
 * every active entry's duration counts down by 1, auto-deactivating
 * (disabling its own linked effect, starting its own cooldown) at 0; every
 * inactive-but-on-cooldown entry's cooldown also counts down by 1. Called
 * from statusEffects.mjs#handleCombatTurnStart.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
export async function handlePathAbilityTurnStart(actor) {
  const item = getSoulPathItem(actor);
  if (!item || !item.system.pathAbilities?.length) return;

  const abilities = foundry.utils.deepClone(item.system.pathAbilities);
  let changed = false;
  const lines = [];

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
        lines.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.SoulPath.PathAbilityExpired', { name: entry.name })}</div>`);
      }
    } else if ((entry.roundsRemaining ?? 0) > 0) {
      entry.roundsRemaining -= 1;
      changed = true;
    }
  }

  if (changed) await item.update({ 'system.pathAbilities': abilities });
  if (lines.length) await postActionChatCard(actor, game.i18n.localize('SKSK.SoulPath.TurnStartTitle'), null, 0, lines.join(''));
}
