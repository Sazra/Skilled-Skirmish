import { SKSKActor } from './documents/actor.mjs';
import { SKSKItem } from './documents/item.mjs';
import { SKSKActorSheet } from './sheets/actor-sheet.mjs';
import { SKSKItemSheet } from './sheets/item-sheet.mjs';
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { SKSK } from './helpers/config.mjs';
import { registerSettings } from './helpers/settings.mjs';
import { rollSavingThrowFromChat, rollSpellEffectSaveFromChat, applySpellEffectFromChat } from './helpers/spell-rolls.mjs';
import { resolveHitEvaluationFromChat } from './helpers/attackRolls.mjs';
import { applyDamageFromChat } from './helpers/damageApplication.mjs';
import { claimInspirationDie } from './helpers/inspiration.mjs';
import { rollTechniqueEffectSaveFromChat } from './helpers/technique-rolls.mjs';
import { computeSpeciesAura } from './helpers/attributes.mjs';
import { getMainSpeciesItem } from './helpers/movement.mjs';
import {
  computeMainSpeciesBaseDays, computeSubMultiplierProduct, computePermanentLifeManaTotal, recalculateDaysFromBaseline,
} from './helpers/longevity.mjs';
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
    technique: models.SKSKTechnique,
    soulPath: models.SKSKSoulPath,
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, 'sksk', SKSKActorSheet, {
    types: ['character', 'npc'],
    makeDefault: true,
    label: 'SKSK.SheetLabels.Actor',
  });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, 'sksk', SKSKItemSheet, {
    types: ['item', 'feature', 'talent', 'class', 'species', 'weapon', 'armor', 'spell', 'technique', 'soulPath'],
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

Handlebars.registerHelper('inc', function (value) {
  return Number(value) + 1;
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
    // Shift+click excludes Spezial-Boni from this save's attribute
    // modifier - see helpers/spell-rolls.mjs#rollSavingThrowFromChat.
    rollSavingThrowFromChat(
      button.dataset.itemUuid, Number(button.dataset.saveIndex), Number(button.dataset.overcharge) || 0, event.shiftKey
    );
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

  // An "effect" Technique's own saving-throw-gated apply button - see
  // helpers/technique-rolls.mjs#rollTechniqueEffectSaveFromChat.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="rollTechniqueEffectSave"]');
    if (!button) return;
    event.preventDefault();
    rollTechniqueEffectSaveFromChat(button.dataset.itemUuid);
  });

  // A Spell's own status/Foundry-effect saving-throw-gated apply button
  // (merged per savingThrowIndex) - see helpers/spell-rolls.mjs#
  // rollSpellEffectSaveFromChat.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="rollSpellEffectSave"]');
    if (!button) return;
    event.preventDefault();
    rollSpellEffectSaveFromChat(
      button.dataset.itemUuid, Number(button.dataset.saveIndex), Number(button.dataset.overcharge) || 0, event.shiftKey
    );
  });

  // A Spell's own "Effekt anwenden" button for its attack/unconditional
  // status/Foundry effect entries - see helpers/spell-rolls.mjs#
  // applySpellEffectFromChat.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="applySpellEffect"]');
    if (!button) return;
    event.preventDefault();
    applySpellEffectFromChat(button.dataset.itemUuid, button.dataset.group);
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

  // Size Category (system.sizeCategory - see helpers/movement.mjs#
  // getActorSizeCategory) is otherwise a normal user-editable field (edited
  // on the General tab's Charakter/Daten sub-section, see templates/actor/
  // parts/character.hbs), but the moment a new main Species item is added,
  // it's overwritten to match that species' own sizeCategory - same
  // write-back pattern as Aura above, just triggered by item creation
  // instead of every Species item's own value (only the main one counts).
  Hooks.on('createItem', (item, options, userId) => {
    if (item.type !== 'species' || !(item.parent instanceof Actor)) return;
    if (game.user.id !== userId) return;
    if (getMainSpeciesItem(item.parent)?.id !== item.id) return;
    item.parent.update({ 'system.sizeCategory': item.system.sizeCategory });
  });

  // ...and likewise whenever the current main Species item's own
  // sizeCategory (or speciesType, in case a sub-species item is promoted to
  // main) is edited afterward.
  Hooks.on('updateItem', (item, changes, options, userId) => {
    if (item.type !== 'species' || !(item.parent instanceof Actor)) return;
    if (game.user.id !== userId) return;
    const changedSize = foundry.utils.getProperty(changes, 'system.sizeCategory') !== undefined;
    const changedType = foundry.utils.getProperty(changes, 'system.speciesType') !== undefined;
    if (!changedSize && !changedType) return;
    if (getMainSpeciesItem(item.parent)?.id !== item.id) return;
    item.parent.update({ 'system.sizeCategory': item.system.sizeCategory });
  });

  // Lebenszeit (Longevity - see data/actor-base.mjs#longevity, helpers/
  // longevity.mjs) otherwise grows automatically from permanent max
  // Life/Mana increases, but has no baseline to grow from until a Character
  // actually has a main Species - the moment they gain one, mainBaselineDays
  // is (re)seeded fresh from it (helpers/longevity.mjs#
  // computeMainSpeciesBaseDays - deliberately NOT the accumulated-by-growth
  // value, which is discarded here). The first time this ever happens for
  // a Character, percent starts at 100 (system.longevity.initialized flips
  // true, baselineTotal is seeded too); every subsequent time (replacing an
  // existing main Species), percent is instead PRESERVED and days
  // re-derived from it against the new baseline - same "preserve percent,
  // re-derive days" rule as every other Species-related change below.
  Hooks.on('createItem', (item, options, userId) => {
    if (item.type !== 'species' || item.system.speciesType !== 'main' || !(item.parent instanceof Actor)) return;
    if (game.user.id !== userId) return;
    const actor = item.parent;
    if (actor.type !== 'character') return;
    if (getMainSpeciesItem(actor)?.id !== item.id) return;
    const mainBaselineDays = computeMainSpeciesBaseDays(actor);
    if (!actor.system.longevity.initialized) {
      actor.update({
        'system.longevity.initialized': true,
        'system.longevity.mainBaselineDays': mainBaselineDays,
        'system.longevity.percent': 100,
        'system.longevity.days': Math.round(mainBaselineDays * computeSubMultiplierProduct(actor)),
        'system.longevity.baselineTotal': computePermanentLifeManaTotal(actor),
      });
    } else {
      const percent = actor.system.longevity.percent;
      actor.update({
        'system.longevity.mainBaselineDays': mainBaselineDays,
        'system.longevity.days': Math.round(mainBaselineDays * computeSubMultiplierProduct(actor) * percent / 100),
      });
    }
  });

  // ...and likewise whenever the current main Species item's own
  // baseLongevity is edited directly (rather than the whole item being
  // replaced) - same "preserve percent, re-derive days against a freshly
  // reset mainBaselineDays" rule as above.
  Hooks.on('updateItem', (item, changes, options, userId) => {
    if (item.type !== 'species' || item.system.speciesType !== 'main' || !(item.parent instanceof Actor)) return;
    if (game.user.id !== userId) return;
    if (foundry.utils.getProperty(changes, 'system.baseLongevity') === undefined) return;
    const actor = item.parent;
    if (actor.type !== 'character' || !actor.system.longevity.initialized) return;
    if (getMainSpeciesItem(actor)?.id !== item.id) return;
    const mainBaselineDays = computeMainSpeciesBaseDays(actor);
    const percent = actor.system.longevity.percent;
    actor.update({
      'system.longevity.mainBaselineDays': mainBaselineDays,
      'system.longevity.days': Math.round(mainBaselineDays * computeSubMultiplierProduct(actor) * percent / 100),
    });
  });

  // A Sub-Species' own baseLongevityMultiplier (gained, changed, or lost
  // entirely) never touches mainBaselineDays or percent - only days moves,
  // re-derived from the preserved percent against the freshly recomputed
  // multiplier product (helpers/longevity.mjs#recalculateDaysFromBaseline).
  function isSubSpeciesOnActor(item) {
    return item.type === 'species' && item.system.speciesType === 'sub' && item.parent instanceof Actor
      && item.parent.type === 'character' && item.parent.system.longevity.initialized;
  }
  Hooks.on('createItem', (item, options, userId) => {
    if (!isSubSpeciesOnActor(item) || game.user.id !== userId) return;
    recalculateDaysFromBaseline(item.parent);
  });
  Hooks.on('updateItem', (item, changes, options, userId) => {
    if (!isSubSpeciesOnActor(item) || game.user.id !== userId) return;
    if (foundry.utils.getProperty(changes, 'system.baseLongevityMultiplier') === undefined) return;
    recalculateDaysFromBaseline(item.parent);
  });
  Hooks.on('deleteItem', (item, options, userId) => {
    if (!isSubSpeciesOnActor(item) || game.user.id !== userId) return;
    recalculateDaysFromBaseline(item.parent);
  });

  // Only one Light/Heavy/Cloth Armor can ever be equipped at once (Shields
  // are unaffected - see helpers/defense.mjs#computeArmorClass, which only
  // ever looks at a single worn body-armor piece) - equipping one
  // auto-unequips every other Light/Heavy/Cloth armor on the same actor.
  Hooks.on('updateItem', (item, changes, options, userId) => {
    if (item.type !== 'armor' || !(item.parent instanceof Actor)) return;
    if (game.user.id !== userId) return;
    if (foundry.utils.getProperty(changes, 'system.equipped') !== true) return;
    if (!['lightArmor', 'heavyArmor', 'cloth'].includes(item.system.armorType)) return;
    const others = item.parent.items.filter(i =>
      i.id !== item.id && i.type === 'armor' && i.system.equipped
      && ['lightArmor', 'heavyArmor', 'cloth'].includes(i.system.armorType)
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