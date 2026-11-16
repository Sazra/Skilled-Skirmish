import { readAbility } from './abilityCharges.mjs';

/**
 * The Spell behind the effect of a "once" ability (data/abilityOnce.mjs#
 * effectSpellUuid). Its chat buttons (saving throws, effect buttons, ...) and
 * the whole spell logic need a Spell item OWNED by the acting character, so
 * the first activation puts a hidden copy of the linked spell on the actor
 * (flag "abilitySpell" = the source UUID), which is refreshed from its source
 * before every use. The copy never shows in the Spells tab (see
 * isAbilitySpellCopy) and is removed again together with the ability's item.
 */

const FLAG = 'abilitySpell';

/**
 * Whether an item is such a hidden copy.
 * @param {Item} item
 * @return {boolean}
 */
export function isAbilitySpellCopy(item) {
  return item.type === 'spell' && !!item.getFlag('sksk', FLAG);
}

/**
 * The actor's copy of a linked spell, created or refreshed from its source.
 * @param {Actor} actor
 * @param {string} uuid   The UUID of the source Spell.
 * @return {Promise<Item|null>}   null if neither the source nor an earlier
 *   copy exists (or the source is not a Spell).
 */
export async function ensureAbilitySpell(actor, uuid) {
  if (!uuid) return null;
  const source = await fromUuid(uuid).catch(() => null);
  if (source && source.type !== 'spell') return null;
  let copy = actor.items.find(item => item.getFlag('sksk', FLAG) === uuid) ?? null;
  if (!source) return copy;

  const data = source.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  data.flags = foundry.utils.mergeObject(data.flags ?? {}, { sksk: { [FLAG]: uuid } });
  data.system.sustaining = false;
  const effects = (data.effects ?? []).map(effect => foundry.utils.deepClone(effect));

  if (!copy) {
    // The spell's Foundry-effect templates are embedded effects whose ids its
    // foundryEffects entries refer to - they have to keep their ids.
    [copy] = await actor.createEmbeddedDocuments('Item', [data], { keepEmbeddedIds: true });
    return copy;
  }

  await copy.update({ name: data.name, img: data.img, system: data.system });
  const sourceIds = new Set(effects.map(effect => effect._id));
  const stale = copy.effects.filter(effect => !sourceIds.has(effect.id)).map(effect => effect.id);
  if (stale.length) await copy.deleteEmbeddedDocuments('ActiveEffect', stale);
  const present = new Set(copy.effects.map(effect => effect.id));
  const missing = effects.filter(effect => !present.has(effect._id));
  if (missing.length) await copy.createEmbeddedDocuments('ActiveEffect', missing, { keepId: true });
  for (const effect of effects) {
    const existing = copy.effects.get(effect._id);
    if (existing) await existing.update({ name: effect.name, img: effect.img, changes: effect.changes, duration: effect.duration, disabled: effect.disabled });
  }
  return copy;
}

/**
 * Remove the hidden copies an item's abilities linked, once that item leaves
 * its actor (unless another of the actor's abilities still links the same
 * spell).
 * @param {Item} item   The deleted Class/Species/Talent.
 * @return {Promise<void>}
 */
export async function removeAbilitySpellCopies(item) {
  const actor = item.parent;
  if (!actor || !['class', 'species', 'talent'].includes(item.type)) return;

  const linked = new Set();
  if (item.type === 'talent') {
    if (item.system.abilityEffectSpellUuid) linked.add(item.system.abilityEffectSpellUuid);
  } else {
    for (const entry of item.system.abilities ?? []) if (entry.effectSpellUuid) linked.add(entry.effectSpellUuid);
  }
  if (!linked.size) return;

  const stillLinked = new Set();
  for (const other of actor.items) {
    if (other.id === item.id || !['class', 'species', 'talent'].includes(other.type)) continue;
    const abilities = other.type === 'talent' ? [readAbility(other)] : (other.system.abilities ?? []).map((_, i) => readAbility(other, i));
    for (const ability of abilities) if (ability?.effectSpellUuid) stillLinked.add(ability.effectSpellUuid);
  }
  const doomed = actor.items
    .filter(candidate => candidate.type === 'spell' && linked.has(candidate.getFlag('sksk', FLAG)) && !stillLinked.has(candidate.getFlag('sksk', FLAG)))
    .map(candidate => candidate.id);
  if (doomed.length) await actor.deleteEmbeddedDocuments('Item', doomed);
}

/**
 * Wire the clean-up hook - safe to call once from the 'ready' hook.
 */
export function registerAbilitySpellHooks() {
  Hooks.on('deleteItem', (item, options, userId) => {
    // Only the user who deleted the item cleans up after it.
    if (userId !== game.user.id) return;
    removeAbilitySpellCopies(item).catch(error => console.warn('SKSK | ability spell clean-up failed', error));
  });
}
