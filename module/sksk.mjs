import { SKSKActor } from './documents/actor.mjs';
import { SKSKItem } from './documents/item.mjs';
import { SKSKActorSheet } from './sheets/actor-sheet.mjs';
import { SKSKItemSheet } from './sheets/item-sheet.mjs';
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { SKSK } from './helpers/config.mjs';
import * as models from './data/_module.mjs';

Hooks.once('init', function () {
  game.sksk = {
    SKSKActor,
    SKSKItem,
    rollItemMacro,
  };

  CONFIG.SKSK = SKSK;

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
    types: ['item', 'feature', 'class', 'species', 'weapon', 'armor', 'spell'],
    makeDefault: true,
    label: 'SKSK.SheetLabels.Item',
  });

  return preloadHandlebarsTemplates();
});

Handlebars.registerHelper('toLowerCase', function (str) {
  return str.toLowerCase();
});

Hooks.once('ready', function () {
  Hooks.on('hotbarDrop', (bar, data, slot) => createItemMacro(data, slot));
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