import { postActionChatCard } from './actions.mjs';
import { formatRollCardHeading } from './rollCard.mjs';
import { getClassAbilityLevels, actorHasAdvancedClass } from './abilities.mjs';
import { getActorSkillLevel } from './skills.mjs';
import { handlePendingSpellTurnStart } from './spell-rolls.mjs';
import { handlePathAbilityTurnStart } from './soulPathRolls.mjs';
import {
  resolveCheckSuccess, wrapCriticalBlock, chooseGenericRollMode, evaluateD20WithMode, formatD20ModeSummaryLine,
} from './criticalRolls.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';
import { computeLehrenTargetBonus } from './lehren.mjs';

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
 * A custom status effect's optional Base-/Spezial-/Modifikator-tier
 * attribute bonus row lists (see apps/status-effects-config.mjs,
 * data/actor-base.mjs's attributeBonuses schema), and which per-attribute
 * suffix each targets via a real ActiveEffect change - same convention as
 * CUSTOM_STAT_MODIFIER_FIELDS above, except each field is an array of
 * { attribute, bonus } rows (one change per non-zero row) rather than a
 * single flat number.
 */
const CUSTOM_ATTRIBUTE_BONUS_FIELDS = {
  baseAttributeBonuses: 'base',
  specialAttributeBonuses: 'special',
  modifierAttributeBonuses: 'modifier',
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
 * CONFIG.SKSK.predefinedStatusEffects not already present (matched by id),
 * then re-sync name/description on every predefined entry the GM hasn't
 * customized (see the "customized" flag below) to the current locale's
 * translation - keeps a world's predefined names/descriptions correctly
 * localized as translations are added/changed, without ever overwriting an
 * intentional GM rename (see status-effects-config.mjs#onSubmit, the only
 * place "customized" is ever set true). Safe to call every "ready" hook.
 * Callers must await this before reading the setting again (e.g.
 * registerConfigStatusEffects below) - the write is a real round-trip.
 * @return {Promise<void>}
 */
export async function ensurePredefinedStatusEffects() {
  const current = game.settings.get('sksk', 'statusEffects') ?? [];
  const existingIds = new Set(current.map(e => e.id));
  const missing = CONFIG.SKSK.predefinedStatusEffects.filter(def => !existingIds.has(def.id));

  const seeded = missing.map(def => ({
    id: def.id,
    predefined: true,
    customized: false,
    name: game.i18n.localize(def.nameKey),
    img: def.img,
    description: game.i18n.localize(def.descriptionKey),
  }));

  let changed = seeded.length > 0;
  const refreshed = current.map(entry => {
    if (!entry.predefined || entry.customized) return entry;
    const def = CONFIG.SKSK.predefinedStatusEffects.find(d => d.id === entry.id);
    if (!def) return entry;
    const name = game.i18n.localize(def.nameKey);
    const description = game.i18n.localize(def.descriptionKey);
    if (name === entry.name && description === entry.description) return entry;
    changed = true;
    return { ...entry, name, description };
  });

  if (!changed) return;
  await game.settings.set('sksk', 'statusEffects', [...refreshed, ...seeded]);
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
 * this rather than only narrating the amount in chat, as does the
 * Angriffswurf "Apply Damage" button (see helpers/damageApplication.mjs).
 * Damage that would take Life below 0 doesn't just get floored away -
 * whatever's left over once Life hits 0 is drained from
 * system.negativeLife.value instead, regardless of which of the above dealt
 * it. system.negativeLife.value is a REMAINING buffer (like a second Life
 * pool that only kicks in once Life itself is empty) - full (its own max)
 * means still safely clinging on, 0 means truly dead (see
 * helpers/statusEffects.mjs#handleTenacityTurnStart, which reads it the same
 * way, and helpers/damageApplication.mjs#applyDamageFromChat's own death
 * check). The very first hit that pushes Life below 0 (Life was still above
 * 0 immediately before this call) starts that buffer fresh at its own max,
 * rather than continuing to drain whatever stale value was left over from a
 * PRIOR trip into Negative Life that Life has since recovered from - see
 * helpers/rest.mjs#applyRest, the only place that ever refills it. Healing
 * never interacts with Negative Life here (Rest already handles healing it
 * directly, on its own tiers).
 * @param {Actor} actor
 * @param {number} delta   Positive to heal, negative to damage.
 * @return {Promise<{lifeDelta: number, negativeLifeDelta: number}>} The
 *   amounts actually applied to each (may differ from delta once clamped);
 *   negativeLifeDelta is the (always non-negative) magnitude of NEW damage
 *   absorbed into the Negative Life buffer this call, i.e. positive when
 *   Negative Life worsens - not the raw signed change to its stored value,
 *   which can look like an increase on a fresh entry (0 -> max - overflow).
 */
export async function applyLifeChange(actor, delta) {
  if (!delta) return { lifeDelta: 0, negativeLifeDelta: 0 };
  const life = actor.system.life;
  const wasAboveZero = life.value > 0;
  const newLifeValue = clampResourceChange(life.value, life.max, delta);
  const lifeDelta = newLifeValue - life.value;

  const updates = {};
  if (lifeDelta) updates['system.life.value'] = newLifeValue;

  let negativeLifeDelta = 0;
  if (delta < 0) {
    const overflow = -delta + lifeDelta; // damage magnitude Life itself couldn't absorb
    if (overflow > 0) {
      const negativeLife = actor.system.negativeLife;
      const startingValue = wasAboveZero ? negativeLife.max : negativeLife.value;
      const newNegativeLifeValue = Math.max(0, startingValue - overflow);
      negativeLifeDelta = startingValue - newNegativeLifeValue;
      if (newNegativeLifeValue !== negativeLife.value) updates['system.negativeLife.value'] = newNegativeLifeValue;
    }
  }

  if (Object.keys(updates).length) await actor.update(updates);
  return { lifeDelta, negativeLifeDelta };
}

/**
 * Pay a Mana cost (e.g. casting a spell) - drains system.mana.value first;
 * whatever the cost exceeds that by is deducted from Life instead (and
 * Negative Life too, once Life bottoms out - see applyLifeChange), rather
 * than blocking the action outright.
 * @param {Actor} actor
 * @param {number} cost
 * @return {Promise<{manaPaid: number, lifeDelta: number, negativeLifeDelta: number}>}
 */
export async function payManaCost(actor, cost) {
  const amount = Math.max(0, Math.round(Number(cost) || 0));
  if (!amount) return { manaPaid: 0, lifeDelta: 0, negativeLifeDelta: 0 };

  const mana = actor.system.mana;
  const manaPaid = Math.min(mana.value, amount);
  if (manaPaid) await actor.update({ 'system.mana.value': mana.value - manaPaid });

  const deficit = amount - manaPaid;
  const { lifeDelta, negativeLifeDelta } = deficit > 0
    ? await applyLifeChange(actor, -deficit)
    : { lifeDelta: 0, negativeLifeDelta: 0 };

  return { manaPaid, lifeDelta, negativeLifeDelta };
}

/**
 * The extra chat line noting Negative Life overflow (see applyLifeChange),
 * or '' if none occurred - shared by every turn-start Life-damage handler
 * below (and by helpers/spell-rolls.mjs, for Mana shortfalls paid from
 * Life).
 * @param {number} negativeLifeDelta
 * @return {string}
 */
export function negativeLifeOverflowHTML(negativeLifeDelta) {
  if (!negativeLifeDelta) return '';
  return `<div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.NegativeLifeOverflow', { amount: negativeLifeDelta })}</div>`;
}

/**
 * How much actual damage a single applyLifeChange call dealt (Life
 * consumed plus any Negative Life overflow, combined into one positive
 * magnitude) - 0 for a pure heal. Used to accumulate a Combat turn's total
 * damage for Concentration's check (see checkConcentration), which sums
 * every turn-start Life-damage source together rather than checking once
 * per source.
 * @param {{lifeDelta: number, negativeLifeDelta: number}} change
 * @return {number}
 */
function damageDealtFrom({ lifeDelta, negativeLifeDelta }) {
  return Math.max(0, -lifeDelta) + negativeLifeDelta;
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
  for (const [field, tier] of Object.entries(CUSTOM_ATTRIBUTE_BONUS_FIELDS)) {
    for (const row of def[field] ?? []) {
      const perStack = Number(row.bonus) || 0;
      if (!perStack || !row.attribute) continue;
      changes.push({
        key: `system.attributeBonuses.${row.attribute}.${tier}`,
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: String(perStack * stacks),
      });
    }
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
  // fpGainBonuses can't be reduced to an ADD-mode system.changes key (see
  // buildStatModifierChanges' own doc comment) - baked into a flag instead,
  // pre-scaled by the current stack count same as changes' own per-stack
  // amounts. Read back by helpers/skillFp.mjs#collectSkillFpGainBonusEntries.
  const fpGainBonuses = (def?.fpGainBonuses ?? [])
    .filter(row => row.skill)
    .map(row => ({ ...row, amount: (Number(row.amount) || 0) * clamped }));

  if (effect) {
    await effect.update({ name, disabled: false, changes, 'flags.sksk.stacks': clamped, 'flags.sksk.fpGainBonuses': fpGainBonuses });
  } else {
    await actor.createEmbeddedDocuments('ActiveEffect', [{
      name, img: def?.img || 'icons/svg/aura.svg', statuses: [id],
      origin: actor.uuid, flags: { sksk: { stacks: clamped, fpGainBonuses } }, changes,
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
  return applyMergedLifeDamage(actor, 'cauterization', value);
}

/**
 * Shared merge-value status effect logic behind applyCauterization and
 * applyAdrenalinDamage - unlike a stack count or a multi-instance status
 * (Wound/Schaden am maximalen Leben), a second application doesn't create
 * a separate instance or bump a shared stack count; it merges into the
 * existing one's value instead. The value reduces max Life via a real
 * ActiveEffect change (system.life.bonus) - not Negative Life directly
 * (though Negative Life cascades in too, once Tenacity's buffer is
 * exhausted - see helpers/life.mjs). Cauterization and Adrenalin Damage
 * are kept as two separate status ids specifically so either can be
 * healed/cleared independently of the other (see clearAdrenalinDamage).
 * Once the effect's own update/creation resolves, Life and Negative Life
 * have already been re-derived against the newly-reduced max (see data/
 * actor-base.mjs#prepareDerivedData) - if either's current value now
 * exceeds its own max, it's clamped straight down to it, same as any other
 * source of max-Life reduction would need to (Foundry never does this on
 * its own for an Active-Effect-driven max change).
 * @param {Actor} actor
 * @param {string} id
 * @param {number} value
 * @return {Promise<void>}
 */
async function applyMergedLifeDamage(actor, id, value) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  if (!amount) return;

  const effect = getStatusEffect(actor, id);
  const def = getStatusEffectDefinitions().find(d => d.id === id);
  const newTotal = (effect?.getFlag('sksk', 'value') ?? 0) + amount;
  const name = `${def?.name || id} (${newTotal})`;
  const changes = [{ key: 'system.life.bonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(-newTotal) }];

  if (effect) {
    await effect.update({ name, changes, 'flags.sksk.value': newTotal });
  } else {
    await actor.createEmbeddedDocuments('ActiveEffect', [{
      name, img: def?.img || 'icons/svg/aura.svg', statuses: [id],
      origin: actor.uuid, flags: { sksk: { value: newTotal } }, changes,
    }]);
  }

  const clampUpdates = {};
  if (actor.system.life.value > actor.system.life.max) clampUpdates['system.life.value'] = actor.system.life.max;
  if (actor.system.negativeLife.value > actor.system.negativeLife.max) {
    clampUpdates['system.negativeLife.value'] = actor.system.negativeLife.max;
  }
  if (Object.keys(clampUpdates).length) await actor.update(clampUpdates);
}

/**
 * Apply (or merge into an existing) Adrenalin Damage - see
 * applyMergedLifeDamage. Kept separate from the general Schaden am
 * maximalen Leben status (see addStatusInstance) specifically so any
 * qualifying Pause can reliably clear exactly the portion of max-Life
 * damage Adrenalin itself caused (see clearAdrenalinDamage), without
 * touching max-Life damage from any other source.
 * @param {Actor} actor
 * @param {number} value
 * @return {Promise<void>}
 */
export async function applyAdrenalinDamage(actor, value) {
  return applyMergedLifeDamage(actor, 'adrenalinDamage', value);
}

/**
 * Adrenalin Damage's current accumulated value (see applyAdrenalinDamage)
 * - 0 if none.
 * @param {Actor} actor
 * @return {number}
 */
export function getAdrenalinDamage(actor) {
  return getStatusEffect(actor, 'adrenalinDamage')?.getFlag('sksk', 'value') ?? 0;
}

/**
 * Reduce Adrenalin Damage's accumulated value by `amount` (see
 * applyAdrenalinDamage) - floored at 0, deleting the backing Active
 * Effect entirely once it reaches 0 (restoring however much max Life, and
 * max Negative Life once Tenacity's buffer is exhausted, that portion was
 * reducing). Distinct from Adrenalin's used-count reset (see
 * helpers/rest.mjs#applyRest): the used count drives future (uses-1)d4
 * rolls and resets to 0 at any qualifying Pause, while this only reduces
 * the damage already dealt, and only at Anpassungspause/Genesungspause.
 * @param {Actor} actor
 * @param {number} amount
 * @return {Promise<number>} The amount actually reduced (less than
 *   requested if less than that remained).
 */
export async function reduceAdrenalinDamage(actor, amount) {
  const reduceBy = Math.max(0, Math.round(Number(amount) || 0));
  if (!reduceBy) return 0;

  const effect = getStatusEffect(actor, 'adrenalinDamage');
  if (!effect) return 0;
  const current = effect.getFlag('sksk', 'value') ?? 0;
  const applied = Math.min(current, reduceBy);
  const newTotal = current - applied;

  if (newTotal <= 0) {
    await effect.delete();
  } else {
    const def = getStatusEffectDefinitions().find(d => d.id === 'adrenalinDamage');
    const name = `${def?.name || 'adrenalinDamage'} (${newTotal})`;
    const changes = [{ key: 'system.life.bonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(-newTotal) }];
    await effect.update({ name, changes, 'flags.sksk.value': newTotal });
  }

  return applied;
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
 * Flag (or unflag) one specific active status instance to bypass Spezial-
 * Boni on its own automatic save - Poison (per severity), Concentration,
 * and Restrained are the only predefined statuses with such a save (see
 * handlePoisonTurnStart/checkConcentration/attemptRestrainedEscape, and the
 * matching checkbox on their own row in actor-effects.hbs). A no-op if the
 * status isn't currently active (nothing to flag).
 * @param {Actor} actor
 * @param {string} id
 * @param {boolean} value
 * @return {Promise<void>}
 */
export async function setStatusIgnoreSpecialBonus(actor, id, value) {
  const effect = getStatusEffect(actor, id);
  if (!effect) return;
  await effect.setFlag('sksk', 'ignoreSpecialBonusOnSave', value);
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
 * The shared logic behind Restrained's escape check (Strength) against its
 * own configured DC - success removes the status entirely (matching
 * Poison's "a passed check cures it" convention); failure leaves it in
 * place. Used by every timing (automatic start/end-of-turn, with mode
 * omitted - falls back to the actor's own GM-tab preset, system.
 * genericCriticalRollMode; and the player-triggered "apCost" one, which
 * instead prompts fresh every time - see attemptRestrainedEscapeManual).
 * Only rolls/resolves the check - never posts a chat card itself, since the
 * turn-start timing folds its result into the combined turn-start card
 * (see handleRestrainedTurnStart/postCombatTurnStartCard) while every other
 * timing still posts its own (see attemptRestrainedEscape).
 * @param {Actor} actor
 * @param {"neutral"|"advantage"|"disadvantage"} [mode]
 * @param {boolean} [forceIgnoreSpecial]   Shift+click on the player-
 *   triggered escape button (see attemptRestrainedEscapeManual) - excludes
 *   Spezial-Boni for this one roll regardless of the instance's own flag.
 * @return {Promise<{roll: Roll, criticalType: string|null, dc: number, outcome: string, luckHTML: string}|null>}
 */
async function resolveRestrainedEscapeCheck(actor, mode = null, forceIgnoreSpecial = false) {
  const effect = getStatusEffect(actor, 'restrained');
  if (!effect) return null;

  const resolvedMode = mode ?? actor.system.genericCriticalRollMode;
  const dc = effect.getFlag('sksk', 'dc') ?? 0;
  // A GM can flag this Restrained instance to bypass Spezial-Boni on its
  // own escape check - see setStatusIgnoreSpecialBonus.
  const ignoreSpecial = forceIgnoreSpecial || effect.getFlag('sksk', 'ignoreSpecialBonusOnSave');
  const strMod = actor.system.attributes?.str?.[ignoreSpecial ? 'modExcludingSpecial' : 'mod'] ?? 0;
  const formula = applyD20Malus(`1d20 + ${strMod}`, actor, 'str');
  const result = await evaluateD20WithMode(formula, actor.getRollData(), resolvedMode);
  const { roll, criticalType, doubleCritical } = result;
  const success = resolveCheckSuccess(roll.total, dc, criticalType);

  if (success) await setStatusStacks(actor, 'restrained', 0);

  const outcomeKey = criticalType === 'success' ? 'SKSK.Spell.Roll.CriticalSuccess'
    : criticalType === 'failure' ? 'SKSK.Spell.Roll.CriticalFailure'
    : success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure';
  const outcome = game.i18n.localize(outcomeKey);
  // Luck's own "criticalRoll"/"doubleCriticalRoll" FP - any generic (non-
  // Angriffswurf) D20 roll's critical success/double critical, see
  // helpers/criticalRolls.mjs#evaluateD20WithMode.
  let luckHTML = criticalType === 'success'
    ? formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'criticalRoll'))
    : '';
  if (doubleCritical) {
    luckHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'doubleCriticalRoll'));
  }
  luckHTML += formatD20ModeSummaryLine(result, resolvedMode);
  return { roll, criticalType, dc, outcome, luckHTML };
}

/**
 * Attempt Restrained's escape check and post its own chat card - used by
 * the player-triggered "apCost" timing (see attemptRestrainedEscapeManual)
 * and the "end" turn timing (see handleRestrainedTurnEnd). The "start" turn
 * timing instead folds the same check into the combined turn-start card -
 * see handleRestrainedTurnStart.
 * @param {Actor} actor
 * @param {"neutral"|"advantage"|"disadvantage"} [mode]
 * @param {boolean} [forceIgnoreSpecial]
 * @return {Promise<void>}
 */
export async function attemptRestrainedEscape(actor, mode = null, forceIgnoreSpecial = false) {
  const result = await resolveRestrainedEscapeCheck(actor, mode, forceIgnoreSpecial);
  if (!result) return;
  const { roll, criticalType, dc, outcome, luckHTML } = result;
  const extraHTML = `<div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.RestrainedCheck', { dc })}: ${outcome}</div>${luckHTML}`;
  await postActionChatCard(actor, getStatusEffectName('restrained'), roll, 0, extraHTML, criticalType);
}

/**
 * Player-triggered escape attempt (Restrained's "apCost" timing) - spends
 * its configured AP cost first (if any), aborting if the actor can't
 * afford it, then prompts for Neutral/Vorteil/Nachteil (unlike the
 * automatic start/end-of-turn timings, which use the actor's own GM-tab
 * preset instead - see attemptRestrainedEscape).
 * @param {Actor} actor
 * @param {boolean} [ignoreSpecial=false]   Shift+click on the escape
 *   button (see sheets/actor-sheet.mjs#attemptRestrainedEscape).
 * @return {Promise<void>}
 */
export async function attemptRestrainedEscapeManual(actor, ignoreSpecial = false) {
  const effect = getStatusEffect(actor, 'restrained');
  if (!effect) return;

  const apCost = effect.getFlag('sksk', 'apCost') ?? 0;
  const ap = actor.system.actionPoints.value;
  if (apCost > 0 && ap < apCost) return ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughAP'));

  const mode = await chooseGenericRollMode();
  if (!mode) return;

  if (apCost > 0) await actor.update({ 'system.actionPoints.value': ap - apCost });
  await attemptRestrainedEscape(actor, mode, ignoreSpecial);
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
 * The total flat bonus/malus any D20 roll for this actor should carry -
 * Exhaustion's universal malus, plus Dazed's attribute-specific one when
 * attributeKey is one of Str/Dex/Con/App, plus any Lehren bonus targeting
 * "allRolls" (see helpers/lehren.mjs) - unlike the other two, this last one
 * can be positive.
 * @param {Actor} actor
 * @param {string|null} [attributeKey]
 * @return {number}
 */
export function computeD20Malus(actor, attributeKey = null) {
  const lehrenBonus = computeLehrenTargetBonus(actor, 'allRolls');
  const allRollsBonus = actor.system.allRollsBonus ?? 0;
  return computeExhaustionD20Malus(actor) + (attributeKey ? computeDazedAttributeMalus(actor, attributeKey) : 0) + lehrenBonus + allRollsBonus;
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
 * takes to work off entirely. Returns its finding rather than posting its
 * own chat card - folded into the combined turn-start card instead, see
 * postCombatTurnStartCard (via handleActionPointsTurnStart).
 * @param {Actor} actor
 * @return {Promise<string[]>} descriptionLines
 */
async function handleDazedTurnStart(actor) {
  const stacks = getStatusStacks(actor, 'dazed');
  if (stacks <= 0) return [];

  const ap = actor.system.actionPoints.value;
  const deduct = Math.min(stacks, Math.max(0, ap - 2));
  if (deduct <= 0) return [];

  await actor.update({ 'system.actionPoints.value': ap - deduct });
  await setStatusStacks(actor, 'dazed', stacks - deduct);

  return [game.i18n.format('SKSK.StatusEffect.DazedApDrained', { amount: deduct })];
}

/**
 * AP/RP's own combat-turn-start handling, in a fixed order since each
 * step spends from whatever the step before it left behind: 1) AP and RP
 * are refilled to their max, 2) Dazed's own drain applies against that
 * fresh AP (see handleDazedTurnStart), 3) any pending spell's AP debt is
 * paid down against whatever AP steps 1-2 left behind (see
 * handlePendingSpellTurnStart, which still posts its own separate card -
 * paying down spell debt is a distinct action, not a passive tick) - a
 * Concentration break from this same turn's damage (checked afterwards, in
 * handleCombatTurnStart) already zeroes that debt itself if it occurs, so
 * paying it down first here doesn't conflict with that.
 * @param {Actor} actor
 * @return {Promise<string[]>} descriptionLines (Dazed's own, if any)
 */
async function handleActionPointsTurnStart(actor) {
  const ap = actor.system.actionPoints;
  const rp = actor.system.reactionPoints;
  const updates = {};
  if (ap.value !== ap.max) updates['system.actionPoints.value'] = ap.max;
  if (rp.value !== rp.max) updates['system.reactionPoints.value'] = rp.max;
  // Reflexe's own "Reflexaktion" FP trigger (see helpers/skillFp.mjs#
  // checkReflexActionTrigger) fires at most once per turn - reset here,
  // before AP is actually spent on anything this turn.
  if (actor.system.reflexActionGranted) updates['system.reflexActionGranted'] = false;
  if (Object.keys(updates).length) await actor.update(updates);

  const descriptionLines = await handleDazedTurnStart(actor);
  await handlePendingSpellTurnStart(actor);
  return descriptionLines;
}

/**
 * An empty "nothing happened" result shape shared by every turn-start
 * Life/Mana tick handler below (Poison/Frostbite/Wound/Custom) - each
 * returns this same shape so handleCombatTurnStart can fold all four into
 * one combined chat card instead of each posting its own (see
 * postCombatTurnStartCard).
 * @typedef {{damage: number, descriptionLines: string[], extraSections: string[]}} TurnStartTickResult
 */

/**
 * Poison's own combat-turn-start handling: for every Poison severity
 * currently active on the actor, roll its damage die and apply it directly
 * to system.life.value (clamped to [0, max]), then run an automatic
 * Constitution check against its DC once its own recheck timer allows
 * (every round for Mild; every 3/5/10 rounds, first triggering that many
 * rounds after being poisoned, for Medium/Severe/Deadly). A passed check
 * cures that severity entirely; a failed one just reschedules the next
 * recheck (Mild has none to reschedule - it always triggers). Returns its
 * findings rather than posting its own chat card - see
 * postCombatTurnStartCard, the sole caller (via handleCombatTurnStart).
 * @param {Actor} actor
 * @param {number} round
 * @return {Promise<TurnStartTickResult>}
 */
async function handlePoisonTurnStart(actor, round) {
  let totalDamage = 0;
  const descriptionLines = [];
  const extraSections = [];
  for (const [severityId, def] of Object.entries(CONFIG.SKSK.poisonSeverities)) {
    const effect = getStatusEffect(actor, severityId);
    if (!effect) continue;

    const nextCheckRound = effect.getFlag('sksk', 'nextCheckRound') ?? round;
    const triggers = def.intervalRounds <= 1 || round >= nextCheckRound;
    if (!triggers) continue;

    const statusName = getStatusEffectName(severityId);
    const damageRoll = await new Roll(`1d${def.damageDie}`, actor.getRollData()).evaluate();
    const lifeChange = await applyLifeChange(actor, -damageRoll.total);
    const { negativeLifeDelta } = lifeChange;
    totalDamage += damageDealtFrom(lifeChange);
    descriptionLines.push(game.i18n.format('SKSK.StatusEffect.TurnStartDamage', { amount: damageRoll.total, status: statusName }));
    if (negativeLifeDelta) descriptionLines.push(game.i18n.format('SKSK.StatusEffect.NegativeLifeOverflow', { amount: negativeLifeDelta }));

    // A GM can flag this specific poison instance to bypass Spezial-Boni on
    // its own recheck (e.g. a poison meant to ignore temporary buffs) - see
    // setStatusIgnoreSpecialBonus.
    const ignoreSpecial = effect.getFlag('sksk', 'ignoreSpecialBonusOnSave');
    const conMod = actor.system.attributes?.con?.[ignoreSpecial ? 'modExcludingSpecial' : 'mod'] ?? 0;
    const checkFormula = applyD20Malus(`1d20 + ${conMod}`, actor, 'con');
    // Fully automatic (turn-start) check - uses the actor's own GM-tab
    // preset (system.genericCriticalRollMode) rather than a per-check
    // dialog, see helpers/criticalRolls.mjs#evaluateD20WithMode.
    const checkResult = await evaluateD20WithMode(checkFormula, actor.getRollData(), actor.system.genericCriticalRollMode);
    const { roll: checkRoll, criticalType, doubleCritical } = checkResult;
    const success = resolveCheckSuccess(checkRoll.total, def.dc, criticalType);

    if (success) {
      await setStatusStacks(actor, severityId, 0);
    } else if (def.intervalRounds > 1) {
      await effect.setFlag('sksk', 'nextCheckRound', round + def.intervalRounds);
    }

    const checkRendered = wrapCriticalBlock(await checkRoll.render(), criticalType);
    const outcomeKey = criticalType === 'success' ? 'SKSK.Spell.Roll.CriticalSuccess'
      : criticalType === 'failure' ? 'SKSK.Spell.Roll.CriticalFailure'
      : success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure';
    const outcome = game.i18n.localize(outcomeKey);
    // Luck's own "criticalRoll"/"doubleCriticalRoll" FP - any generic (non-
    // Angriffswurf) D20 roll's critical success/double critical, see
    // helpers/criticalRolls.mjs#evaluateD20WithMode.
    let luckHTML = criticalType === 'success'
      ? formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'criticalRoll'))
      : '';
    if (doubleCritical) {
      luckHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'doubleCriticalRoll'));
    }
    luckHTML += formatD20ModeSummaryLine(checkResult, actor.system.genericCriticalRollMode);
    extraSections.push(`
      <div class="sksk-roll-line"><strong>${statusName}</strong> - ${game.i18n.format('SKSK.StatusEffect.PoisonCheck', { dc: def.dc })}: ${outcome}</div>
      ${checkRendered}
      ${luckHTML}
    `);
  }
  return { damage: totalDamage, descriptionLines, extraSections };
}

/**
 * Frostbite's own combat-turn-start handling: a flat Cold damage tick,
 * applied directly to system.life.value (clamped to [0, max]), regardless
 * of its own stack count - see computeFrostbiteDamage. Returns its findings
 * rather than posting its own chat card - see postCombatTurnStartCard.
 * @param {Actor} actor
 * @return {Promise<TurnStartTickResult>}
 */
async function handleFrostbiteTurnStart(actor) {
  if (getStatusStacks(actor, 'frostbite') <= 0) return { damage: 0, descriptionLines: [], extraSections: [] };
  const damage = computeFrostbiteDamage(actor);
  const lifeChange = await applyLifeChange(actor, -damage);
  const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes.cold);
  const statusName = getStatusEffectName('frostbite');
  const descriptionLines = [game.i18n.format('SKSK.StatusEffect.TurnStartDamage', { amount: damage, status: `${statusName} (${typeLabel})` })];
  if (lifeChange.negativeLifeDelta) {
    descriptionLines.push(game.i18n.format('SKSK.StatusEffect.NegativeLifeOverflow', { amount: lifeChange.negativeLifeDelta }));
  }
  return { damage: damageDealtFrom(lifeChange), descriptionLines, extraSections: [] };
}

/**
 * Wound's own combat-turn-start handling: the summed damage value of
 * every Wound instance currently on the actor, applied directly to
 * system.life.value (clamped to [0, max]). Returns its findings rather than
 * posting its own chat card - see postCombatTurnStartCard.
 * @param {Actor} actor
 * @return {Promise<TurnStartTickResult>}
 */
async function handleWoundTurnStart(actor) {
  const total = getStatusInstancesTotal(actor, 'wound');
  if (!total) return { damage: 0, descriptionLines: [], extraSections: [] };
  const lifeChange = await applyLifeChange(actor, -total);
  const descriptionLines = [game.i18n.format('SKSK.StatusEffect.TurnStartDamage', { amount: total, status: getStatusEffectName('wound') })];
  if (lifeChange.negativeLifeDelta) {
    descriptionLines.push(game.i18n.format('SKSK.StatusEffect.NegativeLifeOverflow', { amount: lifeChange.negativeLifeDelta }));
  }
  return { damage: damageDealtFrom(lifeChange), descriptionLines, extraSections: [] };
}

/**
 * Custom (GM-added) status effects' own combat-turn-start handling: for
 * every custom definition carrying a non-zero lifeChangePerStack and/or
 * manaChangePerStack, scaled by the actor's current stack count for that
 * status (see CUSTOM_TURN_START_FIELDS). Life change is applied directly
 * to system.life.value (clamped to [0, max]) via applyLifeChange, matching
 * every other Life-affecting status effect in this system (Wound,
 * Frostbite, Poison). Mana LOSS cascades into Life (and Negative Life, once
 * Life bottoms out) via payManaCost, matching every other way Mana can be
 * spent/drained in this system (spell casting, manual sheet edits - see
 * sheets/actor-sheet.mjs#spillManaOverflow) rather than simply discarding
 * whatever Mana couldn't absorb, as an earlier version of this function did.
 * Mana GAIN is simply clamped to max (no cascade needed for a gain).
 * Returns its findings rather than posting its own chat card - see
 * postCombatTurnStartCard.
 * @param {Actor} actor
 * @return {Promise<TurnStartTickResult>}
 */
async function handleCustomTurnStart(actor) {
  let totalDamage = 0;
  const descriptionLines = [];
  for (const def of getStatusEffectDefinitions()) {
    if (def.predefined) continue;
    const stacks = getStatusStacks(actor, def.id);
    if (stacks <= 0) continue;
    const statusName = getStatusEffectName(def.id);

    const requestedLifeChange = (Number(def.lifeChangePerStack) || 0) * stacks;
    if (requestedLifeChange) {
      const lifeChange = await applyLifeChange(actor, requestedLifeChange);
      const { lifeDelta, negativeLifeDelta } = lifeChange;
      const total = lifeDelta - negativeLifeDelta;
      if (total) {
        const key = total > 0 ? 'SKSK.StatusEffect.TurnStartHealing' : 'SKSK.StatusEffect.TurnStartDamage';
        descriptionLines.push(game.i18n.format(key, { amount: Math.abs(total), status: statusName }));
        if (negativeLifeDelta) descriptionLines.push(game.i18n.format('SKSK.StatusEffect.NegativeLifeOverflow', { amount: negativeLifeDelta }));
      }
      totalDamage += damageDealtFrom(lifeChange);
    }

    const manaChange = (Number(def.manaChangePerStack) || 0) * stacks;
    if (manaChange > 0) {
      const mana = actor.system.mana;
      const newValue = clampResourceChange(mana.value, mana.max, manaChange);
      const applied = newValue - mana.value;
      if (applied) {
        await actor.update({ 'system.mana.value': newValue });
        descriptionLines.push(game.i18n.format('SKSK.StatusEffect.TurnStartManaGain', { amount: applied, status: statusName }));
      }
    } else if (manaChange < 0) {
      const { manaPaid, lifeDelta, negativeLifeDelta } = await payManaCost(actor, -manaChange);
      if (manaPaid) descriptionLines.push(game.i18n.format('SKSK.StatusEffect.TurnStartManaLoss', { amount: manaPaid, status: statusName }));
      if (lifeDelta) {
        totalDamage += damageDealtFrom({ lifeDelta, negativeLifeDelta });
        descriptionLines.push(game.i18n.format('SKSK.StatusEffect.TurnStartDamage', { amount: -lifeDelta, status: statusName }));
        if (negativeLifeDelta) descriptionLines.push(game.i18n.format('SKSK.StatusEffect.NegativeLifeOverflow', { amount: negativeLifeDelta }));
      }
    }
  }
  return { damage: totalDamage, descriptionLines, extraSections: [] };
}

/**
 * Restrained's own combat-turn-start handling: an automatic escape check,
 * only when its own configured timing is "start" - folded into the
 * combined turn-start card rather than posting its own (see
 * postCombatTurnStartCard), same treatment as Poison's own passive save.
 * The "end" timing (handleRestrainedTurnEnd below) still posts its own
 * separate card - not yet folded in.
 * @param {Actor} actor
 * @return {Promise<string[]>} extraSections
 */
async function handleRestrainedTurnStart(actor) {
  const effect = getStatusEffect(actor, 'restrained');
  if (!effect || effect.getFlag('sksk', 'timing') !== 'start') return [];
  const result = await resolveRestrainedEscapeCheck(actor);
  if (!result) return [];
  const { roll, criticalType, dc, outcome, luckHTML } = result;
  const statusName = getStatusEffectName('restrained');
  return [`
    <div class="sksk-roll-line"><strong>${statusName}</strong> - ${game.i18n.format('SKSK.StatusEffect.RestrainedCheck', { dc })}: ${outcome}</div>
    ${wrapCriticalBlock(await roll.render(), criticalType)}
    ${luckHTML}
  `];
}

async function handleRestrainedTurnEnd(actor) {
  const effect = getStatusEffect(actor, 'restrained');
  if (!effect || effect.getFlag('sksk', 'timing') !== 'end') return;
  await attemptRestrainedEscape(actor);
}

/**
 * Concentration's own damage-response check - exported for reuse anywhere
 * else in the system that deals real damage to an actor (not just the
 * turn-start sources below), per the "implement this in the background,
 * we'll use it in various places" requirement. A no-op if the actor isn't
 * Concentrating or no damage was actually dealt. DC is (damage / 2,
 * rounded down, minimum 5); the roll is 1d20 + Constitution modifier +
 * Concentration skill level. Failure breaks Concentration outright
 * (removes the status); success leaves it in place.
 * @param {Actor} actor
 * @param {number} damage
 * @return {Promise<void>}
 */
export async function checkConcentration(actor, damage) {
  if (damage <= 0 || getStatusStacks(actor, 'concentration') <= 0) return;

  const dc = Math.max(5, Math.floor(damage / 2));
  // A GM can flag this Concentration instance to bypass Spezial-Boni on its
  // own check - see setStatusIgnoreSpecialBonus.
  const ignoreSpecial = getStatusEffect(actor, 'concentration')?.getFlag('sksk', 'ignoreSpecialBonusOnSave');
  const conMod = actor.system.attributes?.con?.[ignoreSpecial ? 'modExcludingSpecial' : 'mod'] ?? 0;
  const concentrationLevel = getActorSkillLevel(actor, 'concentration');
  const formula = applyD20Malus(`1d20 + ${conMod} + ${concentrationLevel}`, actor, 'con');
  // Fully automatic (damage-triggered) check - uses the actor's own GM-tab
  // preset (system.genericCriticalRollMode) rather than a per-check dialog,
  // see helpers/criticalRolls.mjs#evaluateD20WithMode.
  const result = await evaluateD20WithMode(formula, actor.getRollData(), actor.system.genericCriticalRollMode);
  const { roll, criticalType, doubleCritical } = result;
  const success = resolveCheckSuccess(roll.total, dc, criticalType);

  // A failed check breaks Concentration outright - if a spell (see
  // helpers/spell-rolls.mjs#rollSpellItem) was still being paid off, in AP
  // instalments or a "minutes"-unit ritual's own round countdown, that
  // cancels it too: its remaining debt is forgiven, but the Mana it
  // already cost at cast time is not refunded.
  let cancelledSpell = false;
  if (!success) {
    await setStatusStacks(actor, 'concentration', 0);
    if (actor.system.pendingSpell?.apCost || actor.system.pendingSpell?.roundsRemaining) {
      await actor.update({ 'system.pendingSpell': { itemId: '', apCost: 0, roundsRemaining: 0 } });
      cancelledSpell = true;
    }
  }

  const outcomeKey = criticalType === 'success' ? 'SKSK.Spell.Roll.CriticalSuccess'
    : criticalType === 'failure' ? 'SKSK.Spell.Roll.CriticalFailure'
    : success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure';
  const outcome = game.i18n.localize(outcomeKey);
  const fpGrant = await grantSkillUsageFp(actor, 'concentration', 'concentrationCheck');
  // Luck's own "criticalRoll"/"doubleCriticalRoll" FP - any generic (non-
  // Angriffswurf) D20 roll's critical success/double critical, see
  // helpers/criticalRolls.mjs#evaluateD20WithMode.
  let luckHTML = criticalType === 'success'
    ? formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'criticalRoll'))
    : '';
  if (doubleCritical) {
    luckHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'doubleCriticalRoll'));
  }
  luckHTML += formatD20ModeSummaryLine(result, actor.system.genericCriticalRollMode);
  const extraHTML = `
    <div class="sksk-roll-line">${game.i18n.format('SKSK.StatusEffect.ConcentrationCheck', { dc })}: ${outcome}</div>
    ${cancelledSpell ? `<div class="sksk-roll-line">${game.i18n.localize('SKSK.Spell.Roll.SpellCancelled')}</div>` : ''}
    ${formatSkillFpGrantLine(fpGrant)}
    ${luckHTML}
  `;
  await postActionChatCard(actor, getStatusEffectName('concentration'), roll, 0, extraHTML, criticalType);
}

/**
 * Schleichen's own "im Kampf getarnt" FP trigger: while the Concealed
 * status (see CONFIG.SKSK.predefinedStatusEffects) is active, grant
 * Stealth's "stealthRound" FP every time this actor's own Combat turn
 * begins - always silent (no chat card at all, not even folded into the
 * combined turn-start card), same as every other skill-usage FP grant
 * outside of Training (see helpers/skillFp.mjs#formatSkillFpGrantLine).
 * @param {Actor} actor
 * @return {Promise<void>}
 */
async function handleStealthTurnStart(actor) {
  if (getStatusStacks(actor, 'concealed') <= 0) return;
  await grantSkillUsageFp(actor, 'stealth', 'stealthRound');
}

/**
 * Zähigkeit's own "0 Leben, aber noch negatives Leben" FP trigger: grants
 * Tenacity's "zeroLifeRound" FP at the start of this actor's own Combat
 * turn whenever it's at 0 Life but still has Negative Life left (i.e.
 * still clinging on, not yet truly downed/dead) - always silent, same as
 * handleStealthTurnStart above.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
async function handleTenacityTurnStart(actor) {
  if (actor.system.life.value > 0 || actor.system.negativeLife.value <= 0) return;
  await grantSkillUsageFp(actor, 'tenacity', 'zeroLifeRound');
}

/**
 * Totem's own per-round Mana upkeep: at this actor's own Combat turn start,
 * drains every still-active totem's own manaCostPerRound from system.mana
 * (processed in list order, sharing the one Mana pool) - a totem that can't
 * be paid for is auto-deactivated (its linked ActiveEffect's disabled flag
 * flips back to true) instead of ever pushing Mana negative. Returns its
 * findings rather than posting its own chat card - folded into the
 * combined turn-start card instead, see postCombatTurnStartCard. See apps/
 * totem-dialog.mjs#toggleTotemActive for the player-triggered activate/
 * deactivate flow this mirrors.
 * @param {Actor} actor
 * @return {Promise<string[]>} descriptionLines
 */
async function handleTotemTurnStart(actor) {
  const totems = actor.system.totems ?? [];
  if (!totems.some(entry => entry.active)) return [];

  let mana = actor.system.mana.value;
  const updated = [];
  const deactivatedNames = [];
  for (const entry of totems) {
    if (!entry.active) { updated.push(entry); continue; }
    const cost = entry.manaCostPerRound ?? 0;
    if (mana >= cost) {
      mana -= cost;
      updated.push(entry);
    } else {
      updated.push({ ...entry, active: false });
      deactivatedNames.push(entry.name || '?');
      const effect = entry.effectId ? actor.effects.get(entry.effectId) : null;
      if (effect) await effect.update({ disabled: true });
    }
  }

  const updates = { 'system.totems': updated };
  if (mana !== actor.system.mana.value) updates['system.mana.value'] = mana;
  await actor.update(updates);

  return deactivatedNames.map(name => game.i18n.format('SKSK.TotemDialog.AutoDeactivated', { name }));
}

/**
 * Whether a Technique's own "active" flag represents a genuine duration-
 * ticking buff (stand, or an "effect" targeting its own wielder) rather
 * than a "primed, awaiting the next weapon/Martial Arts attack" marker
 * (attackBonus, or an "effect" targeting the attack's own target) - see
 * data/technique.mjs.
 * @param {Item} item
 * @return {boolean}
 */
function techniqueHasDuration(item) {
  return item.system.category === 'stand' || (item.system.category === 'effect' && item.system.effectTarget === 'self');
}

/**
 * Duplicated from helpers/technique-rolls.mjs#computeTechniqueCooldownStart
 * (see that copy's own doc comment for the full "+1 grace round" rationale
 * and worked examples) rather than imported, mirrors the existing
 * techniqueHasDuration duplication between these two files - kept in sync.
 * @param {number} cooldownRounds
 * @return {number}
 */
function computeTechniqueCooldownStart(cooldownRounds) {
  return cooldownRounds > 0 ? cooldownRounds + 1 : 0;
}

/**
 * Technique's own per-round ticking, at this actor's own Combat turn start:
 * every still-active stand/self-effect Technique's own duration counts down
 * by 1, auto-deactivating (disabling its own linked ActiveEffect, starting
 * its own cooldown, per computeTechniqueCooldownStart's "+1 grace round"
 * rule) once it hits 0 - see helpers/technique-rolls.mjs#
 * toggleStandTechnique for the player-triggered equivalent (which starts
 * the same cooldown, but posts its own separate "Deaktiviert" card instead
 * of announcing it here - the cooldown announcement below is specific to
 * natural expiry, the only cooldown-starting event that happens silently
 * during turn-start processing). Every Technique currently on cooldown
 * (inactive, roundsRemaining > 0) also counts down by 1 - regardless of
 * which of the four ways it went on cooldown (expiry here, manual
 * deactivation, consumption, or direct-effect activation - see
 * technique-rolls.mjs) - granting Technique's own "techniqueCooldownRound"
 * FP for each round elapsed, always silent (see handleStealthTurnStart
 * above), but now reporting how many rounds remain (or that it's ready
 * again) as a description line either way. Primed-but-not-duration-based
 * Techniques (attackBonus, or an "effect" targeting the attack's own
 * target) aren't touched here at all - they stay primed until consumed by
 * this actor's next weapon/Martial Arts attack (helpers/actions.mjs) or
 * manually cancelled. Returns its findings rather than posting its own
 * chat card - folded into the combined turn-start card instead, see
 * postCombatTurnStartCard.
 * @param {Actor} actor
 * @return {Promise<string[]>} descriptionLines
 */
async function handleTechniqueTurnStart(actor) {
  const techniques = actor.items.filter(i => i.type === 'technique');
  if (!techniques.length) return [];

  const descriptionLines = [];
  for (const item of techniques) {
    if (item.system.active && techniqueHasDuration(item)) {
      const remaining = (item.system.roundsRemaining ?? 0) - 1;
      if (remaining > 0) {
        await item.update({ 'system.roundsRemaining': remaining });
      } else {
        const effect = item.system.effectId ? actor.effects.get(item.system.effectId) : null;
        if (effect) await effect.update({ disabled: true });
        const cooldownStart = computeTechniqueCooldownStart(item.system.cooldownRounds);
        await item.update({ 'system.active': false, 'system.roundsRemaining': cooldownStart });
        descriptionLines.push(game.i18n.format('SKSK.Technique.Expired', { name: item.name }));
        if (cooldownStart > 0) {
          descriptionLines.push(game.i18n.format('SKSK.Technique.CooldownStarted', { name: item.name, rounds: item.system.cooldownRounds }));
        }
      }
      continue;
    }

    if (!item.system.active && (item.system.roundsRemaining ?? 0) > 0) {
      await grantSkillUsageFp(actor, 'technique', 'techniqueCooldownRound');
      const remaining = Math.max(0, item.system.roundsRemaining - 1);
      await item.update({ 'system.roundsRemaining': remaining });
      descriptionLines.push(remaining > 0
        ? game.i18n.format('SKSK.Technique.CooldownRemaining', { name: item.name, rounds: remaining })
        : game.i18n.format('SKSK.Technique.CooldownComplete', { name: item.name }));
    }
  }

  return descriptionLines;
}

/**
 * Which of "SKSK.StatusEffect.TurnStartBeginsMale"/"...Female" an actor's
 * own system.gender (see data/actor-base.mjs, Character tab's Data section)
 * resolves to - male/genderless use the male form, female/hermaphrodite use
 * the female form, per the design's own pairing (there's no third/neutral
 * form for this particular line).
 * @param {Actor} actor
 * @return {string}
 */
function turnStartBeginsKeyFor(actor) {
  return actor.system.gender === 'female' || actor.system.gender === 'hermaphrodite'
    ? 'SKSK.StatusEffect.TurnStartBeginsFemale'
    : 'SKSK.StatusEffect.TurnStartBeginsMale';
}

/**
 * Post the ONE combined turn-start chat card announcing whichever actor's
 * Combat turn is beginning (see handleCombatTurnStart) - headed with the
 * actor's own name (not a status effect's; the description below never
 * repeats it), always posted so a GM always sees whose turn started, even
 * on a turn where nothing at all ticked (the plain, gendered "begins their
 * turn" line below - see turnStartBeginsKeyFor). Whenever Poison/Frostbite/
 * Wound/custom status effects actually had something to report this turn,
 * that plain line is replaced by a single joined description sentence
 * covering every damage/healing/Mana tick instead, followed by each Poison
 * severity's own passive save roll block, if any triggered this round.
 * @param {Actor} actor
 * @param {string[]} descriptionLines
 * @param {string[]} extraSections
 * @return {Promise<ChatMessage>}
 */
async function postCombatTurnStartCard(actor, descriptionLines, extraSections) {
  const description = descriptionLines.length
    ? descriptionLines.join(' ')
    : game.i18n.localize(turnStartBeginsKeyFor(actor));

  const parts = [formatRollCardHeading(actor.name), `<div class="sksk-roll-description">${description}</div>`];
  parts.push(...extraSections);

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: actor.name,
    content: `<div class="sksk-chat-card sksk-action-card">${parts.join('')}</div>`,
    rolls: [],
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * Called once for whichever actor's Combat turn is beginning (see the
 * "combatTurnChange" hook in sksk.mjs) - refills AP/RP and pays down any
 * pending spell's AP debt (see handleActionPointsTurnStart, which also
 * returns Dazed's own AP-drain line), then every active Poison severity's
 * damage/check cycle, Frostbite's damage tick, Wound's summed damage,
 * custom status effects' own Life/Mana turn-start ticks (see
 * handlePoisonTurnStart/handleFrostbiteTurnStart/handleWoundTurnStart/
 * handleCustomTurnStart), Restrained's automatic escape check (only if
 * timed to "start" - see handleRestrainedTurnStart), Totem's per-round Mana
 * upkeep (auto-deactivating any totem it can't afford), and Technique's own
 * duration/cooldown ticking (auto-deactivating any expired stand/self-
 * effect; its own cooldown-round FP grant is silent, see
 * handleTechniqueTurnStart) - all folded into ONE combined chat card (see
 * postCombatTurnStartCard) instead of each posting its own: a single
 * heading with the actor's own name, one joined description sentence
 * covering every damage/healing/Mana/Dazed/Totem/Technique-expiry line, and
 * every Poison/Restrained passive save roll block. Concentration's check
 * runs against however much of the Poison/Frostbite/Wound/custom damage
 * actually landed (checked once for the round's total, not once per
 * source - Dazed/Restrained/Totem/Technique don't deal Life damage, so they
 * don't factor in here). Schleichen's Concealed-status FP trigger and
 * Zähigkeit's 0-Life FP trigger are always silent (no chat card at all, see
 * handleStealthTurnStart/handleTenacityTurnStart) - not folded into the
 * card since there's nothing to show. A bound Soul Path's own active Path
 * Abilities' duration/cooldown ticking (helpers/soulPathRolls.mjs#
 * handlePathAbilityTurnStart, same shape as Technique's own stand ticking,
 * minus the cooldown-round FP grant - no such trigger exists for Path
 * Abilities) still posts its own separate card - not yet folded in.
 * @param {Actor} actor
 * @param {number} round
 * @return {Promise<void>}
 */
export async function handleCombatTurnStart(actor, round) {
  const dazedLines = await handleActionPointsTurnStart(actor);

  const poison = await handlePoisonTurnStart(actor, round);
  const frostbite = await handleFrostbiteTurnStart(actor);
  const wound = await handleWoundTurnStart(actor);
  const custom = await handleCustomTurnStart(actor);
  const restrainedSections = await handleRestrainedTurnStart(actor);
  const totemLines = await handleTotemTurnStart(actor);
  const techniqueLines = await handleTechniqueTurnStart(actor);

  const totalDamage = poison.damage + frostbite.damage + wound.damage + custom.damage;
  const descriptionLines = [
    ...dazedLines,
    ...poison.descriptionLines, ...frostbite.descriptionLines, ...wound.descriptionLines, ...custom.descriptionLines,
    ...totemLines, ...techniqueLines,
  ];
  const extraSections = [
    ...poison.extraSections, ...frostbite.extraSections, ...wound.extraSections, ...custom.extraSections,
    ...restrainedSections,
  ];
  await postCombatTurnStartCard(actor, descriptionLines, extraSections);

  await checkConcentration(actor, totalDamage);
  await handleStealthTurnStart(actor);
  await handleTenacityTurnStart(actor);
  await handlePathAbilityTurnStart(actor);
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
