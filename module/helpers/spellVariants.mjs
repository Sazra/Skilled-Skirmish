/**
 * Spell Varianten (data/spell.mjs#variants): extra effects a spell triggers
 * when a marker status/effect is present on its caster - e.g. the Trickkunst
 * Infusion spells or "Wasser sammeln", which only put a marker on the caster
 * and change the NEXT spell.
 *
 * A variant is active while ALL its conditions are met by the caster's
 * active effects (a status by its id, any other effect by its exact name).
 * While active, its changes are applied to a copy of the spell's data for
 * this cast. The spell code reads everything from `item.system`, so the cast
 * runs on a stand-in item (see createVariantItem) whose `system` is that
 * modified copy - every option of the spell can be changed this way without
 * the casting code knowing about variants.
 *
 * The markers that triggered a variant are "used": one with the duration
 * option "Bis Nutzung" is removed (see extraDamage.mjs#consumeUsedEffects),
 * any other keeps triggering the variant for as long as it lasts.
 */

import { consumeUsedEffects } from './extraDamage.mjs';
import { applyMetamagic, findMetamagicMarkers, isMetamagicCode, renderMetamagicLines, ENHANCEMENT_CODE_BASE } from './metamagic.mjs';
import { getSpellSchool } from './spells.mjs';

const normalize = (text) => String(text ?? '').trim().toLowerCase();

// ------------------------------------------------------- "next spell" Varianten
//
// A variant with the scope "next" (data/spell.mjs#variants) is stored on an
// "infusion" spell but changes whatever spell its caster casts next, as far as
// that spell passes the variant's filter. It is found through the marker effect
// the infusion spell put on the caster (the effect's origin is that spell), so
// new infusions are pure data: a spell with a marker effect (duration option
// "Bis Nutzung") and a "next" variant - no code per spell.
//
// A variant list entry for such a variant is a code >= ENHANCEMENT_CODE_BASE
// (a hash of the spell's name and the variant's label), which travels through
// chat buttons and the pending-spell data like the small variant indexes.

const hashText = (text) => {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** @param {*} value   @return {boolean} */
export const isEnhancementCode = (value) => Number.isInteger(value) && value >= ENHANCEMENT_CODE_BASE;

/**
 * @param {Item} item   The infusion spell.
 * @param {number} index   Index of the "next" variant.
 * @return {number}
 */
export function enhancementCode(item, index) {
  const variant = item.system.variants?.[index];
  return ENHANCEMENT_CODE_BASE + hashText(`${item.name}|${variant?.label || index}`);
}

let enhancementRegistry = null;
let registryHooked = false;

/** code -> {item, index} of every "next" variant of the world's and the actors' spells. */
function buildEnhancementRegistry() {
  if (!registryHooked) {
    registryHooked = true;
    for (const hook of ['createItem', 'updateItem', 'deleteItem']) Hooks.on(hook, () => { enhancementRegistry = null; });
  }
  const map = new Map();
  const scan = (item) => {
    if (item.type !== 'spell') return;
    (item.system.variants ?? []).forEach((variant, index) => {
      if (variant.scope === 'next') map.set(enhancementCode(item, index), { item, index });
    });
  };
  game.items?.forEach(scan);
  game.actors?.forEach(actor => actor.items.forEach(scan));
  return map;
}

/**
 * @param {number} code
 * @return {{item: Item, variant: object, index: number}|null}
 */
export function resolveEnhancement(code) {
  enhancementRegistry ??= buildEnhancementRegistry();
  const entry = enhancementRegistry.get(code);
  if (!entry) return null;
  const variant = entry.item.system.variants?.[entry.index];
  return variant ? { item: entry.item, variant, index: entry.index } : null;
}

const splitList = (text) => String(text ?? '').split(/[,;]/).map(part => normalize(part)).filter(Boolean);

/**
 * Whether a spell passes the filter of a "next" variant.
 * @param {object} filter   data/spell.mjs#variants[].filter
 * @param {Item} item   The spell about to be cast.
 * @return {boolean}
 */
export function matchesEnhancementFilter(filter, item) {
  if (!filter) return true;
  const system = item.system;
  const damages = system.damages ?? [];
  const types = new Set(damages.map(damage => damage.damageType));
  const allowedElements = Object.entries(system.elementChoice?.allowed ?? {}).filter(([, on]) => on).map(([key]) => key);
  const dealsType = (list) => list.some(type => types.has(type) || (types.has('@element') && allowedElements.includes(type)));

  const names = splitList(filter.spellNames);
  if (names.length && !names.includes(normalize(item.name))) return false;
  const spellTypes = splitList(filter.spellTypes);
  if (spellTypes.length && !spellTypes.includes(normalize(system.spellType))) return false;
  const school = normalize(getSpellSchool(system));
  const schools = splitList(filter.schools);
  if (schools.length && !schools.includes(school)) return false;
  if (splitList(filter.excludeSchools).includes(school)) return false;
  const wanted = splitList(filter.damageTypes);
  if (wanted.length && !dealsType(wanted)) return false;
  const unwanted = splitList(filter.excludeDamageTypes);
  if (unwanted.length && [...types].some(type => unwanted.includes(type))) return false;
  if (filter.requiresAttack && !system.attackRoll?.enabled) return false;
  if (filter.requiresDamage && !damages.length) return false;
  if (filter.requiresSavingThrow && !(system.savingThrows ?? []).length) return false;
  return true;
}

/**
 * The caster's active effects that satisfy one variant condition.
 * @param {Actor} actor
 * @param {{kind: string, key: string}} condition
 * @return {ActiveEffect[]}
 */
function findMarkerEffects(actor, condition) {
  const key = normalize(condition.key);
  if (!key) return [];
  return [...actor.appliedEffects].filter(effect => (condition.kind === 'status'
    ? effect.statuses?.has(condition.key)
    : normalize(effect.name) === key));
}

/**
 * Which of a spell's variants are active for its caster right now.
 * @param {Item} item   An owned spell.
 * @return {{indexes: number[], markerIds: Set<string>}}   markerIds: the ids
 *   of every effect that satisfied a condition of an active variant. The
 *   indexes also hold the Metamagie codes (helpers/metamagic.mjs) of the
 *   caster's markers - a Metamagie spell itself is never changed by them.
 */
export function detectSpellVariants(item) {
  const result = { indexes: [], markerIds: new Set() };
  const actor = item.actor;
  if (!actor) return result;

  for (const [index, variant] of (item.system.variants ?? []).entries()) {
    if (variant.scope === 'next') continue;
    const conditions = variant.conditions ?? [];
    if (!conditions.length) continue;
    const matches = conditions.map(condition => findMarkerEffects(actor, condition));
    if (matches.some(found => !found.length)) continue;
    result.indexes.push(index);
    for (const found of matches) for (const effect of found) result.markerIds.add(effect.id);
  }

  if (!item.system.metamagic) {
    const meta = findMetamagicMarkers(actor);
    result.indexes.push(...meta.codes);
    for (const id of meta.markerIds) result.markerIds.add(id);
  }
  // An infusion spell is never changed by other infusions.
  if (!item.system.metamagic && !(item.system.variants ?? []).some(variant => variant.scope === 'next')) {
    const enhancements = findEnhancements(item);
    result.indexes.push(...enhancements.codes);
    for (const id of enhancements.markerIds) result.markerIds.add(id);
  }
  return result;
}

/**
 * The "next" variants (see above) that change a spell about to be cast: those
 * of the spells whose marker effects the caster carries.
 * @param {Item} item   An owned spell.
 * @return {{codes: number[], markerIds: Set<string>}}   markerIds: the
 *   markers to use up - also those whose variant did not match this spell
 *   (unless its filter says otherwise).
 */
function findEnhancements(item) {
  const result = { codes: [], markerIds: new Set() };
  const actor = item.actor;
  const effects = [...actor.appliedEffects];
  const sources = new Map();
  for (const effect of effects) {
    if (!effect.origin || sources.has(effect.origin)) continue;
    let source = null;
    try { source = fromUuidSync(effect.origin); } catch (error) { source = null; }
    if (source?.documentName === 'Item' && source.type === 'spell') sources.set(effect.origin, source);
  }
  for (const [uuid, source] of sources) {
    for (const [index, variant] of (source.system.variants ?? []).entries()) {
      if (variant.scope !== 'next') continue;
      const conditions = variant.conditions ?? [];
      const matches = conditions.length
        ? conditions.map(condition => findMarkerEffects(actor, condition))
        : [effects.filter(effect => effect.origin === uuid)];
      if (matches.some(found => !found.length)) continue;
      const markers = matches.flat();
      if (matchesEnhancementFilter(variant.filter, item)) {
        const code = enhancementCode(source, index);
        enhancementRegistry ??= buildEnhancementRegistry();
        enhancementRegistry.set(code, { item: source, index });
        result.codes.push(code);
      } else if (variant.filter?.consumeOnMismatch === false) {
        continue;
      }
      for (const effect of markers) result.markerIds.add(effect.id);
    }
  }
  return result;
}

/**
 * Apply one change to a plain data object.
 * @param {object} data
 * @param {{key: string, type: string, value: string}} change
 */
function applyChange(data, change) {
  const path = String(change.key ?? '').trim().replace(/^system\./, '');
  // "damages.*.formula" changes that option of every entry of the list.
  if (path.includes('*')) {
    const [head, ...rest] = path.split('*');
    const listPath = head.replace(/\.$/, '');
    const list = foundry.utils.getProperty(data, listPath);
    if (!Array.isArray(list)) return;
    list.forEach((entry, index) => applyChange(data, { ...change, key: `${listPath}.${index}${rest.join('*')}` }));
    return;
  }
  applySingleChange(data, path, change);
}

function applySingleChange(data, path, { type, value }) {
  if (!path) return;
  const current = foundry.utils.getProperty(data, path);
  if (current === undefined) {
    console.warn(`SKSK | Spell variant change targets unknown option "${path}"`);
    return;
  }

  let next = current;
  if (type === 'set') {
    if (typeof current === 'number') next = Number(value);
    else if (typeof current === 'boolean') next = ['true', '1', 'yes', 'ja', 'on'].includes(normalize(value));
    else next = String(value);
  } else if (type === 'add') {
    next = typeof current === 'number' ? current + Number(value) : `${current}${value}`;
  } else if (type === 'multiply') {
    next = typeof current === 'number' ? current * Number(value) : current;
  } else if (type === 'append') {
    const text = String(current ?? '');
    next = text && !/\s$/.test(text) ? `${text} ${value}` : `${text}${value}`;
  }
  if (typeof next === 'number' && !Number.isFinite(next)) return;
  foundry.utils.setProperty(data, path, next);
}

/**
 * A spell's data with the given variants applied - a plain object copy, the
 * item itself is never modified. Changes are applied first (so a path like
 * "damages.0.formula" still means the spell's own first damage), then the
 * variants' extra Damage/Status Effect entries are appended.
 * @param {Item} item
 * @param {number[]} indexes
 * @return {object}
 */
export function buildVariantSystem(item, indexes) {
  const data = item.system.toObject();
  const applyVariant = (variant) => {
    for (const change of variant.changes ?? []) applyChange(data, change);
    for (const damage of variant.addDamages ?? []) data.damages.push(foundry.utils.deepClone(damage));
    for (const status of variant.addStatusEffects ?? []) data.statusEffects.push(foundry.utils.deepClone(status));
  };
  for (const index of indexes) {
    if (isMetamagicCode(index)) continue;
    const variant = isEnhancementCode(index) ? resolveEnhancement(index)?.variant : item.system.variants?.[index];
    if (variant) applyVariant(variant);
  }
  // Metamagie (helpers/metamagic.mjs) comes last, on top of the variants.
  applyMetamagic(data, indexes.filter(isMetamagicCode), item.actor);
  return data;
}

/**
 * A stand-in for a spell item whose `system` has the given variants applied;
 * everything else (actor, uuid, name, update, ...) is forwarded to the real
 * item. Returns the item itself when no variant is active.
 * @param {Item} item
 * @param {number[]} indexes
 * @return {Item}
 */
export function createVariantItem(item, indexes) {
  if (!indexes?.length) return item;
  const system = buildVariantSystem(item, indexes);
  return new Proxy(item, {
    get(target, prop) {
      if (prop === 'system') return system;
      if (prop === 'variantIndexes') return indexes;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * The variant indexes a cast was made with, as the string stored on chat
 * buttons ("1,3"; empty for none).
 * @param {Item} item
 * @return {string}
 */
export function variantAttribute(item) {
  return (item.variantIndexes ?? []).join(',');
}

/**
 * The variant indexes from a chat button's data attribute.
 * @param {string|undefined} text
 * @return {number[]}
 */
export function parseVariantAttribute(text) {
  return String(text ?? '').split(',').map(part => parseInt(part, 10)).filter(Number.isInteger);
}

/**
 * Chat lines announcing the active variants of a cast.
 * @param {Item} realItem
 * @param {number[]} indexes
 * @return {string}
 */
export function renderVariantLines(realItem, indexes) {
  return renderMetamagicLines(realItem, indexes) + indexes.filter(index => !isMetamagicCode(index)).map(index => {
    const enhancement = isEnhancementCode(index) ? resolveEnhancement(index) : null;
    const variant = enhancement ? enhancement.variant : realItem.system.variants?.[index];
    if (!variant) return '';
    const fallback = enhancement ? enhancement.item.name : game.i18n.format('SKSK.Spell.Variant.Numbered', { number: index + 1 });
    const label = foundry.utils.escapeHTML(variant.label || fallback);
    const note = variant.note ? ` - ${foundry.utils.escapeHTML(variant.note)}` : '';
    return `<div class="sksk-roll-line sksk-roll-variant"><strong>${game.i18n.localize('SKSK.Spell.Variant.Active')}:</strong> ${label}${note}</div>`;
  }).join('');
}

/**
 * Use up the markers of a cast: the ones with the duration option "Bis
 * Nutzung" are removed.
 * @param {Actor} actor
 * @param {Set<string>} markerIds
 * @return {Promise<string>}   Chat lines naming the removed effects.
 */
export async function consumeVariantMarkers(actor, markerIds) {
  if (!actor || !markerIds.size) return '';
  return consumeUsedEffects(actor, { kind: 'spell', rolled: false }, markerIds);
}
