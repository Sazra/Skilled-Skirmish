/**
 * Optional integration with the Item Piles module (github.com/fantasycalendar/
 * FoundryVTT-ItemPiles): hands it this system's own item/actor/currency
 * layout through its public API, so loot piles, containers, vaults, merchants
 * and player trading work out of the box. Safe without Item Piles installed -
 * the hook below then simply never fires. Item Piles itself applies the
 * integration to its settings (GM only, once per INTEGRATION_VERSION).
 */

/**
 * Bump whenever anything in buildIntegration changes - Item Piles re-applies
 * its stored system settings only when this is newer than the version it saw
 * last, so a change without a bump would never reach existing worlds.
 */
const INTEGRATION_VERSION = '1.1.0';

/**
 * Item types that are character options or abilities rather than physical
 * things - they can't be dropped, looted or traded.
 */
const NON_PHYSICAL_ITEM_TYPES = ['class', 'species', 'spell', 'technique', 'soulPath', 'talent'];

/**
 * Carried coins (system.currency, see data/actor-base.mjs) in 100er steps,
 * with gold as the primary currency: Item/Weapon/Armor prices (system.price)
 * are written in gold. The images are Foundry's own core coin icons.
 */
const CURRENCIES = [
  { key: 'cp', exchangeRate: 0.0001, primary: false, img: 'icons/commodities/currency/coin-engraved-waves-copper.webp' },
  { key: 'sp', exchangeRate: 0.01, primary: false, img: 'icons/commodities/currency/coin-embossed-unicorn-silver.webp' },
  { key: 'gp', exchangeRate: 1, primary: true, img: 'icons/commodities/currency/coin-embossed-crown-gold.webp' },
  { key: 'pp', exchangeRate: 100, primary: false, img: 'icons/commodities/currency/coin-inset-compass-silver.webp' },
];

/**
 * An item that is handed over (looted, bought, traded, dropped) is no longer
 * worn by its previous owner - Item Piles runs every transferred item through
 * this. Must always return an object, even for the empty data Item Piles
 * validates it with.
 * @param {object} itemData
 * @return {object}
 */
function transferItemData(itemData) {
  if (itemData?.system && 'equipped' in itemData.system) itemData.system.equipped = false;
  return itemData ?? {};
}

/**
 * The system integration payload for Item Piles' API.addSystemIntegration.
 * @return {object}
 */
function buildIntegration() {
  return {
    VERSION: INTEGRATION_VERSION,

    // Item pile actors created by Item Piles are NPCs; plain Items are the
    // loot, Weapons/Armor the weapon/equipment classes. Only Items have a
    // quantity (Weapons/Armor count as 1 each, hence unstackable below).
    ACTOR_CLASS_TYPE: 'npc',
    ITEM_CLASS_LOOT_TYPE: 'item',
    ITEM_CLASS_WEAPON_TYPE: 'weapon',
    ITEM_CLASS_EQUIPMENT_TYPE: 'armor',
    ITEM_QUANTITY_ATTRIBUTE: 'system.quantity',
    ITEM_PRICE_ATTRIBUTE: 'system.price',

    ITEM_FILTERS: [{ path: 'type', filters: NON_PHYSICAL_ITEM_TYPES.join(',') }],
    ITEM_SIMILARITIES: ['name', 'type'],
    UNSTACKABLE_ITEM_TYPES: ['weapon', 'armor'],

    ITEM_TRANSFORMER: transferItemData,

    PILE_DEFAULTS: {
      merchantColumns: [
        { label: 'SKSK.Items.Weight', path: 'system.weight', formatting: '{#}', buying: true, selling: true, mapping: {} },
      ],
    },

    CURRENCIES: CURRENCIES.map(({ key, exchangeRate, primary, img }) => ({
      type: 'attribute',
      name: `SKSK.Items.Currency${key[0].toUpperCase()}${key[1]}`,
      img,
      abbreviation: `{#}${key.toUpperCase()}`,
      data: { path: `system.currency.${key}` },
      primary,
      exchangeRate,
    })),
  };
}

/**
 * Registers the integration with Item Piles - call once from sksk.mjs's init
 * hook. Item Piles fires "item-piles-ready" shortly after Foundry's own
 * "ready" and only then reads its system support, so the registration has
 * to happen from this hook.
 */
export function registerItemPilesIntegration() {
  Hooks.once('item-piles-ready', () => {
    game.itempiles.API.addSystemIntegration(buildIntegration());
  });
}
