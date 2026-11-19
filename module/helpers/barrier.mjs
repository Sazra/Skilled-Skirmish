/**
 * Barrier (Barriere): a shield that soaks damage before Life.
 *
 * Every grant of Barrier from a spell/technique/item is one "layer" - an
 * ActiveEffect (flags.sksk.barrier = {amount, stackable}) carrying the
 * remaining amount and, as its normal effect duration, how long it lasts
 * (no duration = unlimited). The actor's own system.barrier.value stays what
 * it always was: a manually edited, permanent pool the GM/player adjusts by
 * hand; it is added on top of the layers and soaks damage last.
 *
 * The rules for layers (a grant is "stackable" only where a source says so
 * explicitly - everything else is not):
 * - Stackable layers add up with each other.
 * - Stackable and non-stackable Barrier cannot be mixed, and a non-stackable
 *   grant never adds to existing Barrier: the new grant and what is there are
 *   compared as if both were non-stackable - only the higher remaining amount
 *   survives (the longer remaining duration decides a tie; if that ties too,
 *   the existing Barrier stays). If the new stackable grant wins, it simply
 *   stays and later stackable grants stack onto it; a group of stackable
 *   layers counts as one value (their sum) in such a comparison.
 * - Damage drains the layers first (a non-stackable one, else the stackable
 *   ones with the shortest remaining duration first), the manual pool last.
 */

/** Flag path of a layer's own data. */
const FLAG = 'barrier';

const UNIT_SECONDS = { seconds: 1, rounds: 6, turns: 6, minutes: 60, hours: 3600, days: 86400 };

/** The duration units a grant may use (besides "unlimited"). */
export const BARRIER_DURATION_UNITS = ['rounds', 'minutes', 'hours', 'days'];

/**
 * Whether an ActiveEffect is a Barrier layer.
 * @param {ActiveEffect} effect
 * @return {boolean}
 */
function isBarrierEffect(effect) {
  return !!effect.getFlag('sksk', FLAG);
}

/**
 * The remaining duration of a layer in seconds (Infinity = unlimited).
 * @param {ActiveEffect} effect
 * @return {number}
 */
function remainingSeconds(effect) {
  if (!effect.isTemporary) return Infinity;
  const seconds = effect.duration.secondsRemaining;
  if (Number.isFinite(seconds)) return seconds;
  const remaining = effect.duration.remaining;
  return Number.isFinite(remaining) ? remaining * (UNIT_SECONDS[effect.duration.units] ?? 1) : Infinity;
}

/**
 * The duration of a new grant in seconds (Infinity = unlimited).
 * @param {{value?: number, units?: string}|null} duration
 * @return {number}
 */
function grantSeconds(duration) {
  if (!duration?.value) return Infinity;
  return duration.value * (UNIT_SECONDS[duration.units] ?? 1);
}

/**
 * A Barrier layer's data.
 * @typedef {object} BarrierLayer
 * @property {ActiveEffect} effect
 * @property {number} amount      The remaining amount.
 * @property {boolean} stackable
 * @property {number} seconds     The remaining duration (Infinity = unlimited).
 */

/**
 * Every Barrier layer currently on an actor (expired and empty ones are
 * ignored).
 * @param {Actor} actor
 * @return {BarrierLayer[]}
 */
export function getBarrierLayers(actor) {
  const layers = [];
  for (const effect of actor.effects) {
    if (effect.disabled || !isBarrierEffect(effect) || effect.duration.expired) continue;
    const data = effect.getFlag('sksk', FLAG);
    if (!(data.amount > 0)) continue;
    layers.push({ effect, amount: data.amount, stackable: !!data.stackable, seconds: remainingSeconds(effect) });
  }
  return layers;
}

/**
 * The total Barrier an actor currently has: its manual pool plus every layer.
 * @param {Actor} actor
 * @return {number}
 */
export function getBarrierTotal(actor) {
  return (actor.system.barrier?.value ?? 0) + getBarrierLayers(actor).reduce((sum, layer) => sum + layer.amount, 0);
}

/**
 * A duration as text ("3 Runden", "unbegrenzt").
 * @param {{value?: number, units?: string}|null} duration
 * @return {string}
 */
export function formatBarrierDuration(duration) {
  if (!duration?.value) return game.i18n.localize('SKSK.Barrier.Unlimited');
  return `${duration.value} ${game.i18n.localize(`SKSK.Barrier.Units.${duration.units}`)}`;
}

/**
 * A remaining duration in seconds as text.
 * @param {number} seconds
 * @return {string}
 */
function formatRemaining(seconds) {
  if (!Number.isFinite(seconds)) return game.i18n.localize('SKSK.Barrier.Unlimited');
  if (seconds >= 86400) return `${Math.ceil(seconds / 86400)} ${game.i18n.localize('SKSK.Barrier.Units.days')}`;
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} ${game.i18n.localize('SKSK.Barrier.Units.hours')}`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} ${game.i18n.localize('SKSK.Barrier.Units.minutes')}`;
  return `${Math.ceil(seconds / 6)} ${game.i18n.localize('SKSK.Barrier.Units.rounds')}`;
}

/**
 * The tooltip HTML listing an actor's Barrier: the manual pool and every layer
 * with its amount, kind and remaining duration. Empty if it has none at all.
 * @param {Actor} actor
 * @return {string}
 */
export function renderBarrierTooltip(actor) {
  const layers = getBarrierLayers(actor);
  const manual = actor.system.barrier?.value ?? 0;
  if (!layers.length) return '';
  const rows = [];
  for (const layer of layers) {
    const kind = game.i18n.localize(layer.stackable ? 'SKSK.Barrier.Stackable' : 'SKSK.Barrier.NotStackable');
    rows.push(`<div>${layer.amount} - ${layer.effect.name.replace(/\s*\(\d+\)\s*$/, '')} (${kind}, ${formatRemaining(layer.seconds)})</div>`);
  }
  if (manual > 0) rows.push(`<div>${manual} - ${game.i18n.localize('SKSK.Barrier.Manual')}</div>`);
  return `<strong>${game.i18n.localize('SKSK.Resource.Barrier')}: ${getBarrierTotal(actor)}</strong>${rows.join('')}`;
}

/**
 * Create one Barrier layer on an actor.
 * @param {Actor} actor
 * @param {number} amount
 * @param {boolean} stackable
 * @param {{value?: number, units?: string}|null} duration
 * @param {string} name
 * @param {string|null} origin
 * @return {Promise<void>}
 */
async function createLayer(actor, amount, stackable, duration, name, origin) {
  const effectDuration = duration?.value
    ? { value: duration.value, units: duration.units, ...(duration.units === 'rounds' ? { expiry: 'turnStart' } : {}) }
    : {};
  await actor.createEmbeddedDocuments('ActiveEffect', [{
    name: `${name || game.i18n.localize('SKSK.Resource.Barrier')} (${amount})`,
    img: 'icons/svg/shield.svg',
    origin: origin ?? actor.uuid,
    duration: effectDuration,
    flags: { sksk: { [FLAG]: { amount, stackable } } },
  }]);
}

/**
 * Remove every expired/empty Barrier layer from an actor.
 * @param {Actor} actor
 * @return {Promise<void>}
 */
async function pruneBarrierLayers(actor) {
  const dead = actor.effects.filter(effect => isBarrierEffect(effect)
    && (effect.duration.expired || !(effect.getFlag('sksk', FLAG).amount > 0)));
  if (dead.length) await actor.deleteEmbeddedDocuments('ActiveEffect', dead.map(effect => effect.id));
}

/**
 * Grant Barrier to an actor, following the stacking rules at the top of this
 * file.
 * @param {Actor} actor
 * @param {object} grant
 * @param {number} grant.amount
 * @param {boolean} [grant.stackable=false]
 * @param {{value?: number, units?: string}|null} [grant.duration=null]   null/value 0 = unlimited.
 * @param {string} [grant.name]   The source (spell/technique name) for the effect's name.
 * @param {string|null} [grant.origin]   The source item's uuid.
 * @return {Promise<{outcome: "added"|"stacked"|"replaced"|"rejected", line: string}>}
 */
export async function grantBarrier(actor, { amount, stackable = false, duration = null, name = '', origin = null }) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  const isNpc = actor.type === 'npc';
  const kind = game.i18n.localize(stackable ? 'SKSK.Barrier.Stackable' : 'SKSK.Barrier.NotStackable');
  const durationLabel = formatBarrierDuration(duration);
  const wrap = (text) => `<div class="sksk-roll-line sksk-roll-barrier">${text}</div>`;
  if (!(amount > 0)) return { outcome: 'rejected', line: '' };

  await pruneBarrierLayers(actor);
  const layers = getBarrierLayers(actor);
  const params = { target: actor.name, amount, kind, duration: durationLabel };
  if (!layers.length) {
    await createLayer(actor, amount, stackable, duration, name, origin);
    return { outcome: 'added', line: wrap(game.i18n.format(isNpc ? 'SKSK.Barrier.GrantedNpc' : 'SKSK.Barrier.Granted', params)) };
  }
  if (stackable && layers.every(layer => layer.stackable)) {
    await createLayer(actor, amount, true, duration, name, origin);
    return { outcome: 'stacked', line: wrap(game.i18n.format(isNpc ? 'SKSK.Barrier.StackedNpc' : 'SKSK.Barrier.Stacked', { ...params, total: layers.reduce((s, l) => s + l.amount, amount) })) };
  }

  // Not stackable with what is there (or the kinds differ): both count as
  // non-stackable, the stronger one stays.
  const existingAmount = layers.reduce((sum, layer) => sum + layer.amount, 0);
  const existingSeconds = Math.max(...layers.map(layer => layer.seconds));
  const newSeconds = grantSeconds(duration);
  const wins = amount > existingAmount || (amount === existingAmount && newSeconds > existingSeconds);
  if (!wins) {
    return { outcome: 'rejected', line: wrap(game.i18n.format(isNpc ? 'SKSK.Barrier.RejectedNpc' : 'SKSK.Barrier.Rejected', { ...params, existing: existingAmount })) };
  }
  await actor.deleteEmbeddedDocuments('ActiveEffect', layers.map(layer => layer.effect.id));
  await createLayer(actor, amount, stackable, duration, name, origin);
  return { outcome: 'replaced', line: wrap(game.i18n.format(isNpc ? 'SKSK.Barrier.ReplacedNpc' : 'SKSK.Barrier.Replaced', { ...params, existing: existingAmount })) };
}

/**
 * Take an amount of Barrier away from an actor (damage soaked): layers first
 * (a non-stackable one, else the stackable ones that run out soonest), the
 * manual pool last. Emptied layers are removed.
 * @param {Actor} actor
 * @param {number} amount
 * @return {Promise<void>}
 */
export async function reduceBarrier(actor, amount) {
  let left = Math.max(0, Math.floor(Number(amount) || 0));
  if (!left) return;
  const layers = getBarrierLayers(actor).sort((a, b) => {
    if (a.stackable !== b.stackable) return a.stackable ? 1 : -1;
    if (a.seconds === b.seconds) return 0;
    return a.seconds < b.seconds ? -1 : 1;
  });
  const updates = [];
  const removals = [];
  for (const layer of layers) {
    if (left <= 0) break;
    const take = Math.min(layer.amount, left);
    left -= take;
    const rest = layer.amount - take;
    if (rest > 0) {
      updates.push({
        _id: layer.effect.id,
        name: layer.effect.name.replace(/\(\d+\)\s*$/, `(${rest})`),
        [`flags.sksk.${FLAG}.amount`]: rest,
      });
    } else {
      removals.push(layer.effect.id);
    }
  }
  if (updates.length) await actor.updateEmbeddedDocuments('ActiveEffect', updates);
  if (removals.length) await actor.deleteEmbeddedDocuments('ActiveEffect', removals);
  if (left > 0) {
    const manual = actor.system.barrier?.value ?? 0;
    await actor.update({ 'system.barrier.value': Math.max(0, manual - left) });
  }
}

/**
 * The schema of a source's own Barrier grant (Technique, Item): formula is
 * rolled with the wielder's roll data (blank = no Barrier), duration 0 =
 * unlimited, else that many durationUnit; not stackable unless the source says so.
 * @param {object} fields   foundry.data.fields
 * @return {foundry.data.fields.SchemaField}
 */
export function buildBarrierGrantSchema(fields) {
  return new fields.SchemaField({
    formula: new fields.StringField({ required: true, blank: true, initial: '' }),
    stackable: new fields.BooleanField({ initial: false }),
    duration: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    durationUnit: new fields.StringField({
      required: true, blank: false, initial: 'rounds', choices: BARRIER_DURATION_UNITS,
    }),
  });
}

/**
 * Roll a source's own Barrier formula into a Barrier entry for the "Apply"
 * chat button (helpers/damageApplication.mjs#renderApplyDamageButton): the
 * target is chosen when the button is clicked.
 * @param {Actor|null} roller   Whose roll data the formula uses.
 * @param {{formula: string, stackable?: boolean, duration?: number, durationUnit?: string}} grant
 * @param {{name?: string, origin?: string|null}} [source]
 * @return {Promise<{html: string, entry: object}|null>}   null if there is no (valid) formula.
 */
export async function rollBarrierEntry(roller, grant, source = {}) {
  const formula = String(grant?.formula ?? '').trim();
  if (!formula) return null;
  let roll;
  try {
    roll = await new Roll(formula, roller?.getRollData?.() ?? {}).evaluate();
  } catch (error) {
    ui.notifications.warn(game.i18n.format('SKSK.Barrier.BadFormula', { formula }));
    return null;
  }
  const amount = Math.max(0, Math.floor(roll.total));
  const html = `<div class="sksk-roll-line sksk-roll-barrier"><strong>${game.i18n.localize('SKSK.Barrier.DamageType')}:</strong> ${amount} <span class="sksk-roll-formula">(${roll.formula})</span></div>`;
  const barrier = {
    stackable: !!grant.stackable,
    value: grant.duration ?? 0,
    units: grant.durationUnit ?? 'rounds',
    name: source.name ?? '',
    origin: source.origin ?? null,
  };
  return { html, entry: { damageType: 'barrier', amount, barrier } };
}

/**
 * Roll a source's own Barrier formula (a Technique's barrierGrant) and grant
 * the result to a target.
 * @param {Actor} target   Who receives the Barrier.
 * @param {Actor|null} roller   Whose roll data the formula uses (the wielder).
 * @param {{formula: string, stackable?: boolean, duration?: number, durationUnit?: string}} grant
 * @param {{name?: string, origin?: string|null}} [source]
 * @return {Promise<string>}   Chat lines (the roll and what happened); empty if there is no formula.
 */
export async function rollAndGrantBarrier(target, roller, grant, source = {}) {
  const formula = String(grant?.formula ?? '').trim();
  if (!formula) return '';
  let roll;
  try {
    roll = await new Roll(formula, roller?.getRollData?.() ?? {}).evaluate();
  } catch (error) {
    ui.notifications.warn(game.i18n.format('SKSK.Barrier.BadFormula', { formula }));
    return '';
  }
  const amount = Math.max(0, Math.floor(roll.total));
  const rollLine = `<div class="sksk-roll-line sksk-roll-barrier"><strong>${game.i18n.localize('SKSK.Barrier.DamageType')}:</strong> ${amount} <span class="sksk-roll-formula">(${roll.formula})</span></div>`;
  const { line } = await grantBarrier(target, {
    amount,
    stackable: !!grant.stackable,
    duration: grant.duration ? { value: grant.duration, units: grant.durationUnit } : null,
    name: source.name ?? '',
    origin: source.origin ?? null,
  });
  return rollLine + line;
}

/**
 * Grant the Barrier an effect/item gives at the start of the actor's own turn
 * (Active Effect key system.barrierTurnStart, an amount) - never stackable,
 * lasting until the actor's next turn starts.
 * @param {Actor} actor
 * @return {Promise<string[]>}   Description lines for the turn-start card.
 */
export async function handleBarrierTurnStart(actor) {
  const amount = Math.floor(actor.system.barrierTurnStart ?? 0);
  if (!(amount > 0)) return [];
  const { outcome } = await grantBarrier(actor, { amount, stackable: false, duration: { value: 1, units: 'rounds' }, name: game.i18n.localize('SKSK.Barrier.TurnStartName') });
  if (outcome === 'rejected') return [];
  return [game.i18n.format(actor.type === 'npc' ? 'SKSK.Barrier.TurnStartNpc' : 'SKSK.Barrier.TurnStart', { amount })];
}
