import { getWeaponModels, getArmorModels, getModelPropertiesFor } from '../helpers/models.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A multi-select's submitted shape (name="...key" checkboxes) back into a
 * plain array of the checked keys.
 * @param {object} selection  E.g. {str: true, dex: false}.
 * @return {string[]}
 */
function selectedKeys(selection) {
  return Object.entries(selection ?? {}).filter(([, checked]) => checked).map(([key]) => key);
}

/**
 * GM-only settings menu app for managing the world's lists of Weapon
 * Models (by weapon type) and Armor Models (Light Armor/Heavy Armor/
 * Shield) - see helpers/models.mjs. Two plain world settings (untyped
 * Arrays) have no native config UI, so this provides one, following the
 * same add/remove-array-entry pattern used elsewhere against a world
 * setting (see also apps/materials-config.mjs).
 */
export class SKSKModelsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-models-config',
    tag: 'form',
    classes: ['sksk'],
    window: {
      title: 'SKSK.Settings.Models.Name',
      icon: 'fas fa-shapes',
    },
    position: { width: 720, height: 640 },
    form: {
      handler: SKSKModelsConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addWeaponModel: SKSKModelsConfig.#addWeaponModel,
      removeWeaponModel: SKSKModelsConfig.#removeWeaponModel,
      addArmorModel: SKSKModelsConfig.#addArmorModel,
      removeArmorModel: SKSKModelsConfig.#removeArmorModel,
    },
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: 'weaponModels', label: 'SKSK.Models.WeaponModels' },
        { id: 'armorModels', label: 'SKSK.Models.ArmorModels' },
      ],
      initial: 'weaponModels',
    },
  };

  /** @override */
  static PARTS = {
    tabs: {
      template: 'templates/generic/tab-navigation.hbs',
    },
    weaponModels: {
      template: 'systems/sksk/templates/settings/weapon-models.hbs',
      scrollable: [''],
    },
    armorModels: {
      template: 'systems/sksk/templates/settings/armor-models.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tabs = this._prepareTabs('primary');
    context.weaponModels = getWeaponModels();
    context.armorModels = getArmorModels();
    context.weaponTypeChoices = Object.fromEntries(
      Object.entries(CONFIG.SKSK.skills.weapons).map(([key, def]) => [key, def.label])
    );
    context.armorTypeChoices = CONFIG.SKSK.armorModelTypes;
    context.attributeChoices = CONFIG.SKSK.attributes;
    // Every weapon model shares the same property pool (weapon type
    // doesn't affect applicability); every armor model shares the same
    // pool too (light/heavy/shield combined) rather than filtering per
    // row's own armorType, to keep this GM tool simple - properties that
    // don't apply to a particular armor type are just left unchecked.
    context.weaponPropertyChoices = getModelPropertiesFor(['weapon']);
    context.armorPropertyChoices = getModelPropertiesFor(['lightArmor', 'heavyArmor', 'shield']);
    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === 'tabs' && context.tabs) {
      context.tabs = Object.values(context.tabs);
    } else {
      const tab = context.tabs?.[partId];
      if (tab) context.tab = tab;
    }
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Force-apply the active tab on first render (Foundry only wires up
    // clicks after that, matching the pattern used on Actor/Item sheets).
    const active = this.tabGroups?.primary ?? this.constructor.TABS.primary.initial;
    if (active && this.element.querySelector(`.tab[data-group="primary"][data-tab="${active}"]`)) {
      this.changeTab(active, 'primary', { force: true, updatePosition: false });
    }
  }

  /**
   * Parse the submitted form's flat "weaponModels.<index>.<field>" and
   * "armorModels.<index>.<field>" keys back into arrays and persist them
   * as the world settings.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const weaponModels = Object.values(expanded.weaponModels ?? {}).map(m => ({
      name: m.name ?? '',
      weaponType: m.weaponType ?? 'axe',
      diceFormula: m.diceFormula ?? '',
      flatBonus: Number(m.flatBonus) || 0,
      attributes: selectedKeys(m.attributes),
      properties: selectedKeys(m.properties),
    }));
    const armorModels = Object.values(expanded.armorModels ?? {}).map(m => ({
      name: m.name ?? '',
      armorType: m.armorType ?? 'lightArmor',
      flatBonus: Number(m.flatBonus) || 0,
      attributes: selectedKeys(m.attributes),
      properties: selectedKeys(m.properties),
      hardenedValue: Number(m.hardenedValue) || 0,
    }));
    await game.settings.set('sksk', 'weaponModels', weaponModels);
    await game.settings.set('sksk', 'armorModels', armorModels);
  }

  /** @private */
  static async #addWeaponModel(event, target) {
    const models = foundry.utils.deepClone(getWeaponModels());
    models.push({ name: '', weaponType: 'axe', diceFormula: '', flatBonus: 0, attributes: [], properties: [] });
    await game.settings.set('sksk', 'weaponModels', models);
    this.render();
  }

  /** @private */
  static async #removeWeaponModel(event, target) {
    const index = Number(target.dataset.index);
    const models = foundry.utils.deepClone(getWeaponModels());
    models.splice(index, 1);
    await game.settings.set('sksk', 'weaponModels', models);
    this.render();
  }

  /** @private */
  static async #addArmorModel(event, target) {
    const models = foundry.utils.deepClone(getArmorModels());
    models.push({ name: '', armorType: 'lightArmor', flatBonus: 0, attributes: [], properties: [], hardenedValue: 0 });
    await game.settings.set('sksk', 'armorModels', models);
    this.render();
  }

  /** @private */
  static async #removeArmorModel(event, target) {
    const index = Number(target.dataset.index);
    const models = foundry.utils.deepClone(getArmorModels());
    models.splice(index, 1);
    await game.settings.set('sksk', 'armorModels', models);
    this.render();
  }
}
