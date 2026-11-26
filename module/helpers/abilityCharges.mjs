import { isAbilityAvailable } from './abilityChoice.mjs';

/**
 * Charges of a Class/Species/Talent ability of the type "once" ("Aktiv,
 * einmaliger Effekt", see helpers/abilityRolls.mjs#useOnceAbility) and how
 * they come back.
 *
 * Every number here is a formula - the maximum (data/abilityOnce.mjs#
 * chargesFormula) and the amount of each recovery. In a formula "L" is the
 * actor's level, "@attributes.<attr>.mod" / ".value" an attribute's modifier
 * / value and "@skills.<skill>" a skill's level; + - * / ( ) and functions
 * like floor(), ceil(), round(), min(), max() work (e.g. "floor(L / 2)",
 * "@attributes.str.mod * L", "@skills.adrenalin * @attributes.con.mod").
 * The result is rounded down and never below 0.
 *
 * An ability is addressed by an "ability descriptor" (see readAbility) so
 * the Class/Species array entries and the Talent's own root fields can be
 * handled alike.
 */

const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86400 };

/**
 * Evaluate a charge formula for an actor.
 * @param {string} formula
 * @param {Actor} actor
 * @return {number}   Rounded down, at least 0 (0 for a blank/invalid formula).
 */
export function evaluateChargeFormula(formula, actor) {
  const text = String(formula ?? '').trim();
  if (!text) return 0;
  try {
    const expression = text.replace(/\bL\b/g, '@lvl').replace(/\^/g, '**');
    const total = new Roll(expression, actor.getRollData()).evaluateSync({ strict: false }).total;
    return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  } catch (error) {
    return 0;
  }
}

/**
 * @typedef {object} AbilityDescriptor
 * @property {Item} item
 * @property {number|null} index   Index into item.system.abilities (Class/
 *   Species), null for a Talent's single ability.
 * @property {string} name
 * @property {string} type   "passive" | "active" | "once".
 * @property {number} apCost
 * @property {number} rpCost
 * @property {number} manaCost
 * @property {number} cooldownRounds
 * @property {number} roundsRemaining
 * @property {string} description
 * @property {string} effectSpellUuid
 * @property {string} chargesFormula
 * @property {number} chargesUsed
 * @property {object[]} chargeRecovery
 */

/**
 * Read one ability of a Class/Species/Talent item in a uniform shape.
 * @param {Item} item
 * @param {number|null} [index=null]
 * @return {AbilityDescriptor|null}
 */
export function readAbility(item, index = null) {
  if (item.type === 'talent') {
    const s = item.system;
    return {
      item, index: null, name: item.name, type: s.abilityType, description: s.ability ?? '',
      apCost: s.abilityApCost, rpCost: s.abilityRpCost, manaCost: s.abilityManaCost,
      cooldownRounds: s.abilityCooldownRounds, roundsRemaining: s.abilityRoundsRemaining,
      effectSpellUuid: s.abilityEffectSpellUuid, chargesFormula: s.abilityChargesFormula,
      chargesUsed: s.abilityChargesUsed, chargeRecovery: foundry.utils.deepClone(s.abilityChargeRecovery ?? []),
    };
  }
  const entry = item.system.abilities?.[index];
  if (!entry) return null;
  return {
    item, index, name: entry.name || item.name, type: entry.type, description: entry.description ?? '',
    apCost: entry.apCost, rpCost: entry.rpCost, manaCost: entry.manaCost,
    cooldownRounds: entry.cooldownRounds, roundsRemaining: entry.roundsRemaining,
    effectSpellUuid: entry.effectSpellUuid, chargesFormula: entry.chargesFormula,
    chargesUsed: entry.chargesUsed, chargeRecovery: foundry.utils.deepClone(entry.chargeRecovery ?? []),
  };
}

/**
 * Write runtime values (roundsRemaining, chargesUsed, chargeRecovery) of an
 * ability back to its item. Updates the descriptor itself too.
 * @param {AbilityDescriptor} ability
 * @param {{roundsRemaining?: number, chargesUsed?: number, chargeRecovery?: object[]}} patch
 * @return {Promise<void>}
 */
export async function updateAbility(ability, patch) {
  const { item, index } = ability;
  if (item.type === 'talent') {
    const update = {};
    if ('roundsRemaining' in patch) update['system.abilityRoundsRemaining'] = patch.roundsRemaining;
    if ('chargesUsed' in patch) update['system.abilityChargesUsed'] = patch.chargesUsed;
    if ('chargeRecovery' in patch) update['system.abilityChargeRecovery'] = patch.chargeRecovery;
    await item.update(update);
  } else {
    const abilities = foundry.utils.deepClone(item.system.abilities);
    abilities[index] = { ...abilities[index], ...patch };
    await item.update({ 'system.abilities': abilities });
  }
  Object.assign(ability, patch);
}

/**
 * Whether a Class ability's unlock level is reached (Species and Talent
 * abilities are always unlocked) - same rule as the Abilities tab's list.
 * @param {Actor} actor
 * @param {Item} item
 * @param {number|null} index
 * @return {boolean}
 */
function isAbilityUnlocked(actor, item, index) {
  if (item.type !== 'class' && item.type !== 'species') return true;
  return isAbilityAvailable(actor, item, index);
}

/**
 * Every "once" ability of the actor that has charges.
 * @param {Actor} actor
 * @return {AbilityDescriptor[]}
 */
export function listChargeAbilities(actor) {
  const result = [];
  for (const item of actor.items) {
    if (item.type === 'talent') {
      const ability = readAbility(item);
      if (ability.type === 'once' && ability.chargesFormula.trim()) result.push(ability);
    } else if (item.type === 'class' || item.type === 'species') {
      for (const index of (item.system.abilities ?? []).keys()) {
        const ability = readAbility(item, index);
        if (ability?.type !== 'once' || !ability.chargesFormula.trim()) continue;
        if (!isAbilityUnlocked(actor, item, index)) continue;
        result.push(ability);
      }
    }
  }
  return result;
}

/**
 * The charge state of an ability.
 * @param {Actor} actor
 * @param {AbilityDescriptor} ability
 * @return {{has: boolean, max: number, used: number, current: number}}
 */
export function getChargeState(actor, ability) {
  if (!ability.chargesFormula?.trim()) return { has: false, max: 0, used: 0, current: 0 };
  const max = evaluateChargeFormula(ability.chargesFormula, actor);
  const used = Math.max(0, Math.min(ability.chargesUsed ?? 0, max));
  return { has: true, max, used, current: max - used };
}

/**
 * Spend (negative) or restore (positive) charges of an ability, kept within
 * 0..max. Returns the amount that actually changed.
 * @param {Actor} actor
 * @param {AbilityDescriptor} ability
 * @param {number} delta   Positive restores, negative spends.
 * @return {Promise<number>}
 */
export async function changeCharges(actor, ability, delta) {
  const state = getChargeState(actor, ability);
  if (!state.has) return 0;
  const used = Math.max(0, Math.min(state.max, state.used - delta));
  if (used === ability.chargesUsed) return 0;
  const changed = state.used - used;
  await updateAbility(ability, { chargesUsed: used });
  return changed;
}

/**
 * Start the clocks of an ability's "time" recoveries (called when its
 * charges drop from full - the timers only run while some are missing).
 * @param {AbilityDescriptor} ability
 * @return {Promise<void>}
 */
export async function startChargeClocks(ability) {
  const now = game.time.worldTime;
  if (!ability.chargeRecovery.some(entry => entry.mode === 'time')) return;
  const chargeRecovery = ability.chargeRecovery.map(entry => (entry.mode === 'time' ? { ...entry, clock: now } : entry));
  await updateAbility(ability, { chargeRecovery });
}

/**
 * A short localized description of one recovery rule (for tooltips).
 * @param {object} entry
 * @return {string}
 */
export function describeRecovery(entry) {
  const amount = entry.amountFormula || '1';
  const unit = game.i18n.localize(`SKSK.Ability.Charges.Unit.${entry.unit}`);
  const key = {
    turnStart: 'SKSK.Ability.Charges.DescribeTurnStart',
    segments: 'SKSK.Ability.Charges.DescribeSegments',
    day: 'SKSK.Ability.Charges.DescribeDay',
    time: 'SKSK.Ability.Charges.DescribeTime',
  }[entry.mode];
  return game.i18n.format(key, { amount, interval: entry.interval, unit });
}

/**
 * The chat line announcing restored charges.
 * @param {AbilityDescriptor} ability
 * @param {number} restored
 * @param {{current: number, max: number}} state
 * @return {string}
 */
function restoredLine(ability, restored, state) {
  return game.i18n.format('SKSK.Ability.Charges.Restored', {
    name: ability.name, amount: restored, current: Math.min(state.max, state.current + restored), max: state.max,
  });
}

/**
 * Restore the charges of one ability by the sum of the given recovery
 * amounts; returns the chat line (or "" if nothing changed).
 * @param {Actor} actor
 * @param {AbilityDescriptor} ability
 * @param {number} amount
 * @return {Promise<string>}
 */
async function restoreAndDescribe(actor, ability, amount) {
  if (amount <= 0) return '';
  const before = getChargeState(actor, ability);
  const restored = await changeCharges(actor, ability, amount);
  return restored > 0 ? restoredLine(ability, restored, before) : '';
}

/**
 * Turn start of the ability owner's Combat turn: "turnStart" recoveries.
 * @param {Actor} actor
 * @return {Promise<string[]>}   Lines for the combined turn-start card.
 */
export async function recoverChargesOnTurnStart(actor) {
  const lines = [];
  for (const ability of listChargeAbilities(actor)) {
    if (getChargeState(actor, ability).used <= 0) continue;
    const amount = ability.chargeRecovery
      .filter(entry => entry.mode === 'turnStart')
      .reduce((sum, entry) => sum + evaluateChargeFormula(entry.amountFormula, actor), 0);
    const line = await restoreAndDescribe(actor, ability, amount);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * A Pause: "segments" recoveries (every Abschnitt of a Pause counts) and -
 * without Calendaria - "day" recoveries after an Anpassungspause or better.
 * @param {Actor} actor
 * @param {{segments: number, isBreak: boolean, tier: string|null, calendariaActive: boolean}} rest
 * @return {Promise<string[]>}
 */
export async function recoverChargesOnRest(actor, { segments, isBreak, tier, calendariaActive }) {
  const lines = [];
  for (const ability of listChargeAbilities(actor)) {
    if (getChargeState(actor, ability).used <= 0) continue;
    let amount = 0;
    let carryChanged = false;
    const chargeRecovery = ability.chargeRecovery.map(entry => {
      if (entry.mode === 'segments' && isBreak) {
        const total = (entry.carry ?? 0) + segments;
        const times = Math.floor(total / entry.interval);
        amount += times * evaluateChargeFormula(entry.amountFormula, actor);
        const carry = total - times * entry.interval;
        if (carry !== entry.carry) carryChanged = true;
        return { ...entry, carry };
      }
      if (entry.mode === 'day' && !calendariaActive && (tier === 'anpassung' || tier === 'genesung')) {
        amount += evaluateChargeFormula(entry.amountFormula, actor);
      }
      return entry;
    });
    if (carryChanged) await updateAbility(ability, { chargeRecovery });
    const line = await restoreAndDescribe(actor, ability, amount);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * A change of day (Calendaria): "day" recoveries, once per elapsed day.
 * @param {Actor} actor
 * @param {number} days
 * @return {Promise<string[]>}
 */
export async function recoverChargesOnDayChange(actor, days) {
  const lines = [];
  for (const ability of listChargeAbilities(actor)) {
    if (getChargeState(actor, ability).used <= 0) continue;
    const amount = ability.chargeRecovery
      .filter(entry => entry.mode === 'day')
      .reduce((sum, entry) => sum + days * evaluateChargeFormula(entry.amountFormula, actor), 0);
    const line = await restoreAndDescribe(actor, ability, amount);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * World time passed: "time" recoveries (every interval of minutes/hours/days
 * since the clock last ticked). A recovery only runs while charges are
 * missing - its clock is (re)started when they first drop (see
 * startChargeClocks) and by this function if it never was.
 * @param {Actor} actor
 * @return {Promise<string[]>}
 */
export async function tickChargeTimers(actor) {
  const now = game.time.worldTime;
  const lines = [];
  for (const ability of listChargeAbilities(actor)) {
    if (!ability.chargeRecovery.some(entry => entry.mode === 'time')) continue;
    if (getChargeState(actor, ability).used <= 0) continue;

    let amount = 0;
    let changed = false;
    const chargeRecovery = ability.chargeRecovery.map(entry => {
      if (entry.mode !== 'time') return entry;
      const period = entry.interval * (UNIT_SECONDS[entry.unit] ?? 3600);
      // Never started (or the clock was turned back): start counting now.
      if (!(entry.clock > 0) || entry.clock > now) {
        changed = true;
        return { ...entry, clock: now };
      }
      const periods = Math.floor((now - entry.clock) / period);
      if (periods < 1) return entry;
      amount += periods * evaluateChargeFormula(entry.amountFormula, actor);
      changed = true;
      return { ...entry, clock: entry.clock + periods * period };
    });
    if (changed) await updateAbility(ability, { chargeRecovery });
    const line = await restoreAndDescribe(actor, ability, amount);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Every actor whose abilities a world-time tick should check: all world
 * actors plus the synthetic actors of the active Scene's unlinked tokens.
 * @return {Actor[]}
 */
function getTickActors() {
  const actors = new Map(game.actors.map(actor => [actor.uuid, actor]));
  for (const token of canvas.scene?.tokens ?? []) {
    if (token.actor && !token.actorLink) actors.set(token.actor.uuid, token.actor);
  }
  return [...actors.values()];
}

/**
 * Post the restored-charge lines of one actor (whispered to the GM and the
 * actor's owners).
 * @param {Actor} actor
 * @param {string[]} lines
 * @return {Promise<void>}
 */
export async function postChargeLines(actor, lines) {
  if (!lines.length) return;
  const owners = game.users.filter(user => !user.isGM && actor.testUserPermission(user, 'OWNER')).map(user => user.id);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sksk-chat-card sksk-action-card">${lines.map(line => `<div class="sksk-roll-line">${line}</div>`).join('')}</div>`,
    whisper: [...ChatMessage.getWhisperRecipients('GM').map(user => user.id), ...owners],
  });
}

/**
 * Wire up the world-time based charge recovery - safe to call once from the
 * 'ready' hook. Only the table's active GM ever writes.
 */
export function registerAbilityChargeHooks() {
  Hooks.on('updateWorldTime', async (worldTime, dt) => {
    if (game.user.id !== game.users.activeGM?.id || !(dt > 0)) return;
    for (const actor of getTickActors()) {
      if (!actor.items.some(item => item.type === 'class' || item.type === 'species' || item.type === 'talent')) continue;
      await postChargeLines(actor, await tickChargeTimers(actor));
    }
  });
}
