import { SKSKActor } from './documents/actor.mjs';
import { SKSKItem } from './documents/item.mjs';
import { SKSKActorSheet } from './sheets/actor-sheet.mjs';
import { SKSKItemSheet } from './sheets/item-sheet.mjs';
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { SKSK } from './helpers/config.mjs';
import { registerSettings } from './helpers/settings.mjs';
import { rollSavingThrowFromChat } from './helpers/spell-rolls.mjs';
import { resolveHitEvaluationFromChat } from './helpers/attackRolls.mjs';
import { applyDamageFromChat } from './helpers/damageApplication.mjs';
import { claimInspirationDie } from './helpers/inspiration.mjs';
import { computeSpeciesAura } from './helpers/attributes.mjs';
import {
  ensurePredefinedStatusEffects, registerConfigStatusEffects, handleCombatTurnStart, handleCombatTurnEnd,
} from './helpers/statusEffects.mjs';
import { clampSingleAttributeSelection } from './helpers/models.mjs';
import * as models from './data/_module.mjs';

Hooks.once('init', function () {
  game.sksk = {
    SKSKActor,
    SKSKItem,
    rollItemMacro,
  };

  CONFIG.SKSK = SKSK;

  registerSettings();

  CONFIG.Combat.initiative = {
    formula: '1d20 + @abilities.dex.mod',
    decimals: 2,
  };

  CONFIG.Actor.documentClass = SKSKActor;
  Object.assign(CONFIG.Actor.dataModels, {
    character: models.SKSKCharacter,
    npc: models.SKSKNPC,
  });

  CONFIG.Item.documentClass = SKSKItem;
  Object.assign(CONFIG.Item.dataModels, {
    item: models.SKSKItem,
    feature: models.SKSKFeature,
    talent: models.SKSKTalent,
    class: models.SKSKClass,
    species: models.SKSKSpecies,
    weapon: models.SKSKWeapon,
    armor: models.SKSKArmor,
    spell: models.SKSKSpell,
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, 'sksk', SKSKActorSheet, {
    types: ['character', 'npc'],
    makeDefault: true,
    label: 'SKSK.SheetLabels.Actor',
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, 'sksk', SKSKItemSheet, {
    types: ['item', 'feature', 'talent', 'class', 'species', 'weapon', 'armor', 'spell'],
    makeDefault: true,
    label: 'SKSK.SheetLabels.Item',
  });

  return preloadHandlebarsTemplates();
});

Handlebars.registerHelper('toLowerCase', function (str) {
  return str.toLowerCase();
});

Handlebars.registerHelper('eq', function (a, b) {
  return a === b;
});

Handlebars.registerHelper('gt', function (a, b) {
  return a > b;
});

Handlebars.registerHelper('firstLetter', function (str) {
  return (str ?? '').charAt(0).toUpperCase();
});

Handlebars.registerHelper('includes', function (array, value) {
  return (array ?? []).includes(value);
});

Handlebars.registerHelper('concat', function (...args) {
  args.pop(); // Drop the trailing Handlebars options object.
  return args.join('');
});

Hooks.once('ready', async function () {
  // Seed the world's predefined status effects (Exhaustion/Dazed/the four
  // Poison severities - see helpers/statusEffects.mjs) if missing, and
  // register every status effect (predefined + GM-added custom ones) as a
  // normal Foundry status so it shows up on the Token HUD. Must await the
  // seeding write before reading the setting back for registration.
  await ensurePredefinedStatusEffects();
  registerConfigStatusEffects();

  Hooks.on('hotbarDrop', (bar, data, slot) => createItemMacro(data, slot));

  // Delegated (not per-message-render) so it keeps working for every chat
  // card regardless of how/when each one gets rendered.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="rollSavingThrow"]');
    if (!button) return;
    event.preventDefault();
    rollSavingThrowFromChat(button.dataset.itemUuid, Number(button.dataset.saveIndex), Number(button.dataset.overcharge) || 0);
  });

  // Angriffswurf (attack roll) chat cards' "Evaluate" button - see
  // helpers/attackRolls.mjs#resolveHitEvaluationFromChat.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="resolveHitEvaluation"]');
    if (!button) return;
    event.preventDefault();
    resolveHitEvaluationFromChat(button);
  });

  // Any damage roll's "Apply Damage" button - see
  // helpers/damageApplication.mjs#applyDamageFromChat.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="applyDamage"]');
    if (!button) return;
    event.preventDefault();
    applyDamageFromChat(button);
  });

  // An untargeted Inspiration grant's own chat "claim" button - see
  // helpers/inspiration.mjs#claimInspirationDie.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="claimInspiration"]');
    if (!button) return;
    event.preventDefault();
    claimInspirationDie(button);
  });

  // A weapon's attributeOverride enforces the same single-attribute rule
  // as its Weapon Model (see helpers/models.mjs#clampSingleAttributeSelection)
  // unless Refined or Masterful is active - a Weapon Model is a plain world
  // setting whose own config app clamps it directly (models-config.mjs),
  // but a weapon Item is a real embedded Document, so this clamps the
  // incoming change itself before it commits. Runs only on the initiating
  // client (preUpdate hooks aren't broadcast), so no game.user.id guard is
  // needed here unlike the post-update hooks below.
  Hooks.on('preUpdateItem', (item, changes, options, userId) => {
    if (item.type !== 'weapon') return;
    const incoming = foundry.utils.getProperty(changes, 'system.attributeOverride.attributes');
    if (!incoming) return;

    const properties = item.system.effectiveProperties?.map(p => p.property) ?? [];
    const previousAttributes = Object.entries(item.system.attributeOverride?.attributes ?? {})
      .filter(([, checked]) => checked).map(([key]) => key);
    const submittedAttributes = Object.entries({ ...item.system.attributeOverride?.attributes, ...incoming })
      .filter(([, checked]) => checked).map(([key]) => key);

    const clamped = clampSingleAttributeSelection(submittedAttributes, properties, previousAttributes);
    if (clamped.length === submittedAttributes.length && clamped.every(key => submittedAttributes.includes(key))) return;

    const clampedMap = Object.fromEntries(
      ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'].map(key => [key, clamped.includes(key)])
    );
    foundry.utils.setProperty(changes, 'system.attributeOverride.attributes', clampedMap);
  });

  // Aura is otherwise a normal user-editable attribute, but the moment a
  // Species item is added (main or sub - however it got there: sheet
  // button, drag-drop, compendium import), it's overwritten with the sum
  // of every Species item's own Aura value. Only the client that actually
  // created the item performs the write-back, so every other connected
  // client doesn't also race to make the same update.
  Hooks.on('createItem', (item, options, userId) => {
    if (item.type !== 'species' || !(item.parent instanceof Actor)) return;
    if (game.user.id !== userId) return;
    item.parent.update({ 'system.attributes.aur.rawValue': computeSpeciesAura(item.parent) });
  });

  // Only one Light/Heavy Armor can ever be equipped at once (Shields are
  // unaffected - see helpers/defense.mjs#computeArmorClass, which only
  // ever looks at a single worn Light/Heavy piece) - equipping one
  // auto-unequips every other Light/Heavy armor on the same actor.
  Hooks.on('updateItem', (item, changes, options, userId) => {
    if (item.type !== 'armor' || !(item.parent instanceof Actor)) return;
    if (game.user.id !== userId) return;
    if (foundry.utils.getProperty(changes, 'system.equipped') !== true) return;
    if (!['lightArmor', 'heavyArmor'].includes(item.system.armorType)) return;
    const others = item.parent.items.filter(i =>
      i.id !== item.id && i.type === 'armor' && i.system.equipped
      && ['lightArmor', 'heavyArmor'].includes(i.system.armorType)
    );
    for (const other of others) other.update({ 'system.equipped': false });
  });

  // A Consumable Item's charges reaching 0 consumes one unit of its own
  // quantity, then resets its charges back to max - a fresh copy takes its
  // place, same as swapping in the next potion from a stack. An Equippable
  // (non-Consumable) item's charges instead just stay at 0 once
  // depleted - it isn't used up, it just needs recharging some other way.
  // See data/item.mjs#charges.
  Hooks.on('updateItem', (item, changes, options, userId) => {
    if (item.type !== 'item' || !item.system.consumable || !item.system.charges.enabled) return;
    if (game.user.id !== userId) return;
    if (foundry.utils.getProperty(changes, 'system.charges.value') !== 0) return;
    const newQuantity = Math.max(0, item.system.quantity - 1);
    item.update({
      'system.quantity': newQuantity,
      'system.charges.value': newQuantity > 0 ? item.system.charges.max : 0,
    });
  });

  // Dazed's AP drain, every active Poison severity's damage/check cycle,
  // Frostbite's damage tick, Wound's summed damage, custom status effects'
  // own turn-start Life/Mana ticks, and Restrained's automatic escape check
  // (see helpers/statusEffects.mjs#handleCombatTurnStart/handleCombatTurnEnd)
  // trigger at the start of the incoming combatant's own turn (or, for
  // Restrained's "end" timing, the end of the OUTGOING one's). Only the GM's
  // client acts, since this modifies arbitrary actors regardless of who owns
  // them. Uses "combatTurnChange" (fires on every client, after the Combat's
  // database update, for every turn advancement) rather than "combatTurn" -
  // the latter is never fired when a round rolls over (Combat#nextRound only
  // calls Hooks.callAll("combatRound", ...)), which silently skipped every
  // turn-start effect for whoever's turn began a new round.
  Hooks.on('combatTurnChange', (combat, prior, current) => {
    if (!game.user.isGM) return;
    const outgoingActor = combat.combatants.get(prior.combatantId)?.actor;
    if (outgoingActor) handleCombatTurnEnd(outgoingActor);

    const incomingActor = combat.combatants.get(current.combatantId)?.actor;
    if (incomingActor) handleCombatTurnStart(incomingActor, current.round);
  });
});

async function createItemMacro(data, slot) {
  if (data.type !== 'Item') return;
  if (!data.uuid.includes('Actor.') && !data.uuid.includes('Token.')) {
    return ui.notifications.warn(
      'You can only create macro buttons for owned Items'
    );
  }
  const item = await Item.fromDropData(data);
  const command = `game.sksk.rollItemMacro("${data.uuid}");`;
  let macro = game.macros.find(
    (m) => m.name === item.name && m.command === command
  );
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: 'script',
      img: item.img,
      command: command,
      flags: { 'sksk.itemMacro': true },
    });
  }
  game.user.assignHotbarMacro(macro, slot);
  return false;
}

function rollItemMacro(itemUuid) {
  const dropData = {
    type: 'Item',
    uuid: itemUuid,
  };
  Item.fromDropData(dropData).then((item) => {
    if (!item || !item.parent) {
      const itemName = item?.name ?? itemUuid;
      return ui.notifications.warn(
        `Could not find item ${itemName}. You may need to delete and recreate this macro.`
      );
    }
    item.roll();
  });
}