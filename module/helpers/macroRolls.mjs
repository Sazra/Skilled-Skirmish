import { rollMartialArtsAttack, useItem } from './actions.mjs';
import { getSkillLabel } from './skills.mjs';
import { chooseSpellCastOptions } from './spell-rolls.mjs';

/**
 * Drag-to-hotbar macros: every roll an actor sheet offers (attribute/skill
 * checks, the Actions tab's buttons) can be dragged onto the Hotbar, and
 * every owned Item (weapon, spell, ...) already could be - see
 * sheets/actor-sheet.mjs#_onRender (which makes the rollable elements
 * draggable) and sksk.mjs's "hotbarDrop" hook (which calls
 * createMacroFromDrop below).
 *
 * A dragged roll never carries a snapshot of the sheet's own (render-time)
 * roll data - the macro it creates only stores WHICH roll it is (actor +
 * action + a few stable parameters), and runRollMacro re-resolves
 * everything fresh when the macro is executed, replaying the very same
 * sheet action a click would have run (including its AP/RP checks, mode
 * dialogs and chat card), so a macro never goes stale as bonuses change.
 * Shift (held while the macro is clicked) behaves like Shift+click on the
 * sheet.
 *
 * A macro never belongs to the actor its roll was dragged from: it runs for
 * whoever triggers it - the user's currently selected (owned) token, else
 * their assigned character (see resolveMacroActor) - with that actor's own
 * values. Items (a weapon, a spell, ...) are looked up on that actor by name
 * and type.
 */

/** The drag payload's own `type` - see buildRollDragData/createMacroFromDrop. */
export const ROLL_DRAG_TYPE = 'sksk.roll';

/**
 * Sheet actions (actor-sheet.mjs's DEFAULT_OPTIONS.actions keys) that can be
 * dragged to the Hotbar, with their macro icon. "roll" is only ever an
 * attribute roll here - an Item row's own "roll" link (data-roll-type=
 * "item") is already covered by dragging the Item row itself.
 */
const MACRO_ACTIONS = {
  roll: 'icons/svg/d20-grey.svg',
  rollSkill: 'icons/svg/book.svg',
  rollRegeneration: 'icons/svg/regen.svg',
  rollMeditation: 'icons/svg/aura.svg',
  rollAdrenalin: 'icons/svg/lightning.svg',
  grantInspiration: 'icons/svg/light.svg',
  useMove: 'icons/svg/walk.svg',
  useDodge: 'icons/svg/shield.svg',
  useItem: 'icons/svg/sword.svg',
  rollMartialArtsAttack: 'icons/svg/combat.svg',
  attemptRestrainedEscape: 'icons/svg/net.svg',
  openTechniqueDialog: 'icons/svg/sword.svg',
};

/**
 * CSS selector matching every element on an actor sheet that
 * buildRollDragData can turn into a macro.
 */
export const ROLL_DRAGGABLE_SELECTOR = [
  '[data-action="roll"][data-attribute-key]',
  ...Object.keys(MACRO_ACTIONS).filter(a => a !== 'roll').map(a => `[data-action="${a}"]`),
].join(', ');

/**
 * The actor a macro runs for: the user's selected token's actor (one they
 * own), else their assigned character, else - only for macros created
 * before macros became actor-independent - the actor recorded in the macro.
 * @param {string|null} [legacyActorUuid]
 * @return {Promise<Actor|null>}
 */
export async function resolveMacroActor(legacyActorUuid = null) {
  const selected = canvas.tokens?.controlled?.find(token => token.actor?.isOwner)?.actor;
  if (selected) return selected;
  if (game.user.character) return game.user.character;
  return legacyActorUuid ? await fromUuid(legacyActorUuid) : null;
}

/**
 * Finds the same Item (matched by type and name) among an actor's own items,
 * falling back to its id - an Item dragged off one actor's sheet is looked up
 * on whichever actor the macro ends up running for.
 * @param {Actor} actor
 * @param {{itemName?: string, itemType?: string, itemId?: string}} reference
 * @return {Item|null}
 */
function findOwnedItem(actor, { itemName, itemType, itemId }) {
  const byName = itemName ? actor.items.find(item => item.name === itemName && (!itemType || item.type === itemType)) : null;
  return byName ?? (itemId ? actor.items.get(itemId) ?? null : null);
}

/**
 * The d20 formulas of an attribute's own rollable label/modifier (see
 * templates/actor/parts/attributes.hbs and the minimized attribute bar in
 * sheets/actor-sheet.mjs) - built fresh from the actor's CURRENT bonuses.
 * @param {Actor} actor
 * @param {string} attributeKey
 * @return {{roll: string, rollExcludingSpecial: string}}
 */
export function getAttributeRollFormulas(actor, attributeKey) {
  const attribute = actor.system.attributes?.[attributeKey];
  const rollBonus = actor.system.attributeRollBonus?.[attributeKey] ?? 0;
  const bonus = `${attribute?.unlimitedBonus ? `+${attribute.unlimitedBonus}` : ''}${rollBonus ? `+${rollBonus}` : ''}`;
  return {
    roll: `d20+@attributes.${attributeKey}.mod${bonus}`,
    rollExcludingSpecial: `d20+@attributes.${attributeKey}.modExcludingSpecial${bonus}`,
  };
}

/**
 * Build the drag payload for one rollable sheet element - null if it isn't
 * one buildRollDragData knows how to turn into a macro (or lacks what it
 * needs, e.g. an empty Martial Arts attack list).
 * @param {Actor} actor
 * @param {HTMLElement} element   An element matching ROLL_DRAGGABLE_SELECTOR.
 * @return {{type: string, actorUuid: string, action: string, params: object, label: string}|null}
 */
export function buildRollDragData(actor, element) {
  const action = element.dataset.action;
  if (!(action in MACRO_ACTIONS)) return null;

  const row = element.closest('.action-row');
  const rowLabel = row?.querySelector('.resource-label')?.textContent.trim();
  let label;
  let params = {};

  switch (action) {
    case 'roll':
      if (!element.dataset.attributeKey) return null;
      params = { attributeKey: element.dataset.attributeKey };
      label = element.dataset.label || game.i18n.localize(CONFIG.SKSK.attributes[params.attributeKey] ?? params.attributeKey);
      break;
    case 'rollSkill':
      if (!element.dataset.skill) return null;
      params = { skill: element.dataset.skill };
      label = game.i18n.localize(getSkillLabel(params.skill));
      break;
    case 'useItem': {
      const item = actor.items.get(element.dataset.itemId);
      if (!item) return null;
      params = { itemName: item.name, itemType: item.type, itemId: item.id };
      label = item.name;
      break;
    }
    case 'useMove': {
      const movementType = element.dataset.movementType ?? row?.querySelector('.move-type-select')?.value ?? 'walking';
      params = { movementType };
      label = `${rowLabel ?? game.i18n.localize('SKSK.Action.Move')}: ${game.i18n.localize(CONFIG.SKSK.movementTypes[movementType] ?? movementType)}`;
      break;
    }
    case 'rollMartialArtsAttack': {
      const select = row?.querySelector('.martial-arts-attack-select');
      if (!select?.value) return null;
      const name = select.selectedOptions[0]?.textContent.trim() ?? '';
      params = { index: Number(select.value), name };
      label = name || rowLabel;
      break;
    }
    default:
      label = rowLabel || element.getAttribute('title') || action;
  }

  return { type: ROLL_DRAG_TYPE, actorUuid: actor.uuid, action, params, label };
}

/**
 * The "hotbarDrop" hook's handler for a dragged sheet roll (see
 * ROLL_DRAG_TYPE): creates (or reuses) the script Macro that runs it and
 * assigns it to the dropped Hotbar slot.
 * @param {object} data   buildRollDragData's own payload.
 * @param {number} slot
 */
async function createRollMacro(data, slot) {
  // No actor in the payload on purpose: the macro runs for the active token /
  // own character (see resolveMacroActor).
  const payload = { action: data.action, params: data.params };
  const command = `game.sksk.runRollMacro(${JSON.stringify(payload)});`;
  let macro = game.macros.find(m => m.command === command && m.author?.id === game.user.id);
  if (!macro) {
    macro = await Macro.create({
      name: data.label,
      type: 'script',
      img: MACRO_ACTIONS[data.action],
      command,
      flags: { 'sksk.rollMacro': true },
    });
  }
  await game.user.assignHotbarMacro(macro, slot);
}

/**
 * Create (or reuse) the script Macro that rolls one owned Item (see
 * rollItemMacro) and assign it to a Hotbar slot.
 * @param {object} data   Foundry's own Item drag data.
 * @param {number} slot
 */
async function createItemMacro(data, slot) {
  const item = await Item.fromDropData(data);
  if (!item) return;
  const command = `game.sksk.rollItemMacro(${JSON.stringify(data.uuid)}, ${JSON.stringify(item.name)}, ${JSON.stringify(item.type)});`;
  let macro = game.macros.find(m => m.name === item.name && m.command === command);
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: 'script',
      img: item.img,
      command,
      flags: { 'sksk.itemMacro': true },
    });
  }
  await game.user.assignHotbarMacro(macro, slot);
}

/**
 * The "hotbarDrop" hook's handler - claims this system's own drops (a
 * dragged sheet roll, or an Item of an owned Actor/Token) and returns false
 * SYNCHRONOUSLY so Foundry's own default (a plain "open this sheet" macro)
 * is skipped, doing the actual (async) macro creation on the side. Anything
 * else (a compendium/world Item, any other document) is left to Foundry.
 * @param {Hotbar} bar
 * @param {object} data
 * @param {number} slot
 * @return {false|undefined}
 */
export function createMacroFromDrop(bar, data, slot) {
  if (data?.type === ROLL_DRAG_TYPE) {
    createRollMacro(data, slot);
    return false;
  }
  if (data?.type === 'Item' && typeof data.uuid === 'string'
    && (data.uuid.includes('Actor.') || data.uuid.includes('Token.'))) {
    createItemMacro(data, slot);
    return false;
  }
  return undefined;
}

/**
 * A stand-in for the click event a sheet action handler normally receives:
 * only Shift matters to any of them (see this file's header), taken from
 * the live keyboard state at the moment the macro was triggered.
 * @return {{preventDefault: Function, shiftKey: boolean}}
 */
function macroEvent() {
  const shiftKey = !!game.keyboard?.isModifierActive?.('Shift');
  return { preventDefault() {}, stopPropagation() {}, shiftKey, ctrlKey: false, altKey: false };
}

/**
 * Execute a macro created by createRollMacro (see its command): replays the
 * same actor-sheet action a click on that roll would have run - the
 * handler is looked up on the actor's own sheet instance (never rendered
 * for this), fed a minimal stand-in for the clicked element carrying just
 * the dataset that handler reads.
 * @param {{actorUuid: string, action: string, params: object}} payload
 * @return {Promise<*>}
 */
export async function runRollMacro(payload) {
  const actor = await resolveMacroActor(payload?.actorUuid);
  if (!actor) {
    return ui.notifications.warn(game.i18n.localize('SKSK.Macro.NoActiveActor'));
  }
  if (!actor.isOwner) {
    return ui.notifications.warn(game.i18n.format('SKSK.Macro.NotOwner', { name: actor.name }));
  }

  const params = payload.params ?? {};
  const event = macroEvent();

  // Not a click on any DOM row - rolled straight from the actor's own data.
  if (payload.action === 'rollMartialArtsAttack') {
    const attacks = actor.system.martialArtsAttacks ?? [];
    // Prefer the attack's own name (stable across a reorder); fall back to
    // its recorded position.
    const byName = params.name ? attacks.findIndex(a => a.name === params.name) : -1;
    const index = byName >= 0 ? byName : params.index;
    if (!attacks[index]) return ui.notifications.warn(game.i18n.localize('SKSK.Macro.AttackNotFound'));
    return rollMartialArtsAttack(actor, index);
  }

  if (payload.action === 'useItem') {
    const item = findOwnedItem(actor, params);
    if (!item) return ui.notifications.warn(game.i18n.format('SKSK.Macro.ItemNotOnActor', { actor: actor.name, name: params.itemName ?? '' }));
    return useItem(actor, item);
  }

  const dataset = {};
  if (payload.action === 'roll') {
    const formulas = getAttributeRollFormulas(actor, params.attributeKey);
    Object.assign(dataset, {
      roll: formulas.roll,
      rollExcludingSpecial: formulas.rollExcludingSpecial,
      attributeKey: params.attributeKey,
      label: game.i18n.localize(CONFIG.SKSK.attributes[params.attributeKey] ?? params.attributeKey),
    });
  } else {
    Object.assign(dataset, params);
  }

  const handler = actor.sheet.options.actions?.[payload.action];
  if (typeof handler !== 'function') return ui.notifications.warn(game.i18n.localize('SKSK.Macro.UnknownAction'));
  const target = { dataset, closest: () => null, getAttribute: () => null };
  return handler.call(actor.sheet, event, target);
}

/**
 * Execute a macro created by createItemMacro: rolls the owned Item the same
 * way clicking it on the sheet does (Shift+click on a Spell first opens the
 * cast-options dialog - Überladen/extra Mana/alternative resource).
 * Runs for the active token's / own character's copy of the Item (matched by
 * name and type), not for the actor it was originally dragged from; that
 * original is only the fallback for a GM with nothing selected.
 * @param {string} itemUuid
 * @param {string} [itemName]   The dragged Item's name (macros created before
 *   this was recorded resolve it from itemUuid instead).
 * @param {string} [itemType]
 * @return {Promise<*>}
 */
export async function rollItemMacro(itemUuid, itemName = '', itemType = '') {
  const original = await Item.fromDropData({ type: 'Item', uuid: itemUuid });
  const name = itemName || original?.name || '';
  const type = itemType || original?.type || '';

  const actor = await resolveMacroActor(original?.parent?.uuid ?? null);
  if (!actor) {
    return ui.notifications.warn(game.i18n.localize('SKSK.Macro.NoActiveActor'));
  }
  const item = findOwnedItem(actor, { itemName: name, itemType: type, itemId: original?.parent === actor ? original.id : null });
  if (!item) {
    return ui.notifications.warn(game.i18n.format('SKSK.Macro.ItemNotOnActor', { actor: actor.name, name: name || itemUuid }));
  }
  if (!actor.isOwner) {
    return ui.notifications.warn(game.i18n.format('SKSK.Macro.NotOwner', { name: actor.name }));
  }

  if (macroEvent().shiftKey && item.type === 'spell') {
    const pendingSpell = item.parent.system.pendingSpell;
    if ((pendingSpell?.apCost ?? 0) > 0 || (pendingSpell?.roundsRemaining ?? 0) > 0) {
      return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.AlreadyConcentrating'));
    }
    const choice = await chooseSpellCastOptions(item.parent, item);
    if (!choice) return;
    return item.roll(choice.overchargeCount, choice.extraCostTier, choice.altResourceIndex);
  }
  // A weapon / usable item goes through the Actions tab's own "Use" path, so
  // its AP/RP cost and blocked-attack checks apply like a click there.
  if (item.type === 'weapon' || item.type === 'item') return useItem(item.parent, item);
  return item.roll();
}
