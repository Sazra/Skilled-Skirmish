import { getWeaponModels, getArmorModels, getModelPropertiesFor, clampSingleAttributeSelection } from '../helpers/models.mjs';

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
 * Groups an array of models by one of their own fields, while preserving
 * each model's index in the ORIGINAL (ungrouped) array - needed since
 * every field name in the form is "weaponModels.<original index>.<field>",
 * matching the flat world-setting array, regardless of which sub-tab it's
 * displayed under.
 * @param {object[]} models
 * @param {string} typeField  E.g. "weaponType" or "armorType".
 * @return {Object<string, Array<{model: object, index: number}>>}
 */
function groupByType(models, typeField) {
  const groups = {};
  models.forEach((model, index) => {
    (groups[model[typeField]] ??= []).push({ model, index });
  });
  return groups;
}

/**
 * GM-only settings menu app for managing the world's lists of Weapon
 * Models (one sub-tab per weapon type) and Armor Models (one sub-tab per
 * Light Armor/Heavy Armor/Shield) - see helpers/models.mjs. Two plain
 * world settings (untyped Arrays) have no native config UI, so this
 * provides one, following the same add/remove-array-entry pattern used
 * elsewhere against a world setting (see also apps/materials-config.mjs).
 */
export class SKSKModelsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-models-config',
    tag: 'form',
    // "models-config" carries the CSS (see sksk.css) making the active
    // tab's own content scroll while the tab bar stays fixed - the
    // scrollable: [''] PARTS option only persists scroll position across
    // re-renders, it doesn't make anything actually scrollable by itself.
    classes: ['sksk', 'models-config'],
    window: {
      title: 'SKSK.Settings.Models.Name',
      icon: 'fas fa-shapes',
    },
    // Same width as materials-config.mjs/training-methods-config.mjs/
    // lehren-config.mjs - all four settings list apps deliberately share one
    // width, per design request, rather than each sizing to its own content.
    position: { width: 820, height: 640 },
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
    // Sub-tabs shown inside the Weapon Models tab, one per weapon type -
    // replaces a per-row Weapon Type dropdown. Hardcoded (rather than
    // derived from CONFIG.SKSK) since static class fields evaluate before
    // the init hook populates CONFIG.SKSK, matching actor-sheet.mjs's
    // skillCategories.
    weaponModelTypes: {
      tabs: [
        { id: 'axe', label: 'SKSK.Skill.Weapon.Axe' },
        { id: 'bow', label: 'SKSK.Skill.Weapon.Bow' },
        { id: 'bluntWeapon', label: 'SKSK.Skill.Weapon.BluntWeapon' },
        { id: 'dagger', label: 'SKSK.Skill.Weapon.Dagger' },
        { id: 'firearms', label: 'SKSK.Skill.Weapon.Firearms' },
        { id: 'martialArts', label: 'SKSK.Skill.Weapon.MartialArts' },
        { id: 'polearms', label: 'SKSK.Skill.Weapon.Polearm' },
        { id: 'sword', label: 'SKSK.Skill.Weapon.Sword' },
      ],
      initial: 'axe',
    },
    // Sub-tabs shown inside the Armor Models tab - replaces a per-row
    // Armor Type dropdown.
    armorModelTypes: {
      tabs: [
        { id: 'lightArmor', label: 'SKSK.Skill.Armor.LightArmor' },
        { id: 'heavyArmor', label: 'SKSK.Skill.Armor.HeavyArmor' },
        { id: 'shield', label: 'SKSK.Skill.Armor.Shield' },
      ],
      initial: 'lightArmor',
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
    context.weaponModelTypeTabs = Object.values(this._prepareTabs('weaponModelTypes'));
    context.armorModelTypeTabs = Object.values(this._prepareTabs('armorModelTypes'));

    context.weaponModelsByType = groupByType(getWeaponModels(), 'weaponType');
    context.armorModelsByType = groupByType(getArmorModels(), 'armorType');
    // Only Bow/Feuerwaffen actually offer the Kind (Waffe/Munition) select
    // on their entries - see data/weapon.mjs's own RANGED_WEAPON_TYPES.
    context.rangedWeaponTypes = ['bow', 'firearms'];

    context.attributeChoices = CONFIG.SKSK.attributes;
    context.damageTypeChoices = CONFIG.SKSK.damageTypes;
    // Every weapon type shares the same property pool.
    context.weaponPropertyChoices = getModelPropertiesFor(['weapon']);
    // Armor properties are filtered per the model's own exact type now
    // that each lives under its own sub-tab (Light/Heavy Armor share a
    // pool; Shield's is genuinely different - e.g. Deployable/Arm-Bound
    // only make sense there).
    context.armorPropertyChoicesByType = {
      lightArmor: getModelPropertiesFor(['lightArmor']),
      heavyArmor: getModelPropertiesFor(['heavyArmor']),
      shield: getModelPropertiesFor(['shield']),
    };
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
    // Force-apply every declared tab group's active tab on first render
    // (Foundry only wires up clicks after that, matching the pattern used
    // on Actor/Item sheets).
    for (const group of ['primary', 'weaponModelTypes', 'armorModelTypes']) {
      const active = this.tabGroups?.[group] ?? this.constructor.TABS[group].initial;
      if (active && this.element.querySelector(`.tab[data-group="${group}"][data-tab="${active}"]`)) {
        this.changeTab(active, group, { force: true, updatePosition: false });
      }
    }
  }

  /**
   * Parse the submitted form's flat "weaponModels.<index>.<field>" and
   * "armorModels.<index>.<field>" keys back into arrays and persist them
   * as the world settings. weaponType/armorType aren't form fields
   * anymore (implicit from whichever sub-tab a model was added under),
   * so they're carried over from the existing stored value instead.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const existingWeaponModels = getWeaponModels();
    const existingArmorModels = getArmorModels();
    const weaponModels = Object.entries(expanded.weaponModels ?? {}).map(([index, m]) => {
      const properties = selectedKeys(m.properties);
      const attributes = clampSingleAttributeSelection(
        selectedKeys(m.attributes), properties, existingWeaponModels[index]?.attributes ?? []
      );
      return {
        name: m.name ?? '',
        weaponType: existingWeaponModels[index]?.weaponType ?? 'axe',
        // Only submitted at all for Bow/Feuerwaffen entries (see
        // weapon-models.hbs) - every other type's entries have no Kind
        // select and so always fall back to "weapon" here.
        kind: m.kind === 'ammunition' ? 'ammunition' : 'weapon',
        diceFormula: m.diceFormula ?? '',
        flatBonus: Number(m.flatBonus) || 0,
        damageType: m.damageType ?? 'blunt',
        attributes,
        properties,
        heavyRequirement: Number(m.heavyRequirement) || 0,
        demandingRequirement: Number(m.demandingRequirement) || 0,
        drainingRequirement: Number(m.drainingRequirement) || 0,
        reachRange: Number(m.reachRange) || 0,
        rangedRange: Number(m.rangedRange) || 0,
      };
    });
    const armorModels = Object.entries(expanded.armorModels ?? {}).map(([index, m]) => ({
      name: m.name ?? '',
      armorType: existingArmorModels[index]?.armorType ?? 'lightArmor',
      flatBonus: Number(m.flatBonus) || 0,
      attributes: selectedKeys(m.attributes),
      properties: selectedKeys(m.properties),
      hardenedValue: Number(m.hardenedValue) || 0,
      heavyRequirement: Number(m.heavyRequirement) || 0,
      demandingRequirement: Number(m.demandingRequirement) || 0,
      drainingRequirement: Number(m.drainingRequirement) || 0,
    }));
    await game.settings.set('sksk', 'weaponModels', weaponModels);
    await game.settings.set('sksk', 'armorModels', armorModels);
  }

  /** @private */
  static async #addWeaponModel(event, target) {
    const models = foundry.utils.deepClone(getWeaponModels());
    models.push({
      name: '', weaponType: target.dataset.weaponType, kind: 'weapon', diceFormula: '', flatBonus: 0, damageType: 'blunt',
      attributes: [], properties: [],
      heavyRequirement: 0, demandingRequirement: 0, drainingRequirement: 0, reachRange: 0, rangedRange: 0,
    });
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
    models.push({
      name: '', armorType: target.dataset.armorType, flatBonus: 0, attributes: [], properties: [], hardenedValue: 0,
      heavyRequirement: 0, demandingRequirement: 0, drainingRequirement: 0,
    });
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
