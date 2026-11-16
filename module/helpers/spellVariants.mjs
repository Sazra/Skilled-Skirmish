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

const normalize = (text) => String(text ?? '').trim().toLowerCase();

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
 *   of every effect that satisfied a condition of an active variant.
 */
export function detectSpellVariants(item) {
  const result = { indexes: [], markerIds: new Set() };
  const actor = item.actor;
  if (!actor) return result;

  for (const [index, variant] of (item.system.variants ?? []).entries()) {
    const conditions = variant.conditions ?? [];
    if (!conditions.length) continue;
    const matches = conditions.map(condition => findMarkerEffects(actor, condition));
    if (matches.some(found => !found.length)) continue;
    result.indexes.push(index);
    for (const found of matches) for (const effect of found) result.markerIds.add(effect.id);
  }
  return result;
}

/**
 * Apply one change to a plain data object.
 * @param {object} data
 * @param {{key: string, type: string, value: string}} change
 */
function applyChange(data, { key, type, value }) {
  const path = String(key ?? '').trim().replace(/^system\./, '');
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
  for (const index of indexes) {
    const variant = item.system.variants?.[index];
    if (!variant) continue;
    for (const change of variant.changes ?? []) applyChange(data, change);
    for (const damage of variant.addDamages ?? []) data.damages.push(foundry.utils.deepClone(damage));
    for (const status of variant.addStatusEffects ?? []) data.statusEffects.push(foundry.utils.deepClone(status));
  }
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
  return indexes.map(index => {
    const variant = realItem.system.variants?.[index];
    if (!variant) return '';
    const label = foundry.utils.escapeHTML(variant.label || game.i18n.format('SKSK.Spell.Variant.Numbered', { number: index + 1 }));
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
