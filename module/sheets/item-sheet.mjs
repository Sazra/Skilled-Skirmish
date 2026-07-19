const { HandlebarsApplicationMixin } = foundry.applications.api;
const { DocumentSheetV2 } = foundry.applications.api;
import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';
import { getSkillBonusChoices } from '../helpers/skills.mjs';

/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {DocumentSheetV2}
 * @mixes {HandlebarsApplication}
 */
export class SKSKItemSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'sheet', 'item'],
    position: { width: 520, height: 480 },
    form: {
      submitOnChange: true
    },
    actions: {
      create: SKSKItemSheet.#onEffectAction,
      edit: SKSKItemSheet.#onEffectAction,
      delete: SKSKItemSheet.#onEffectAction,
      toggle: SKSKItemSheet.#onEffectAction,
      addAttributeBonus: SKSKItemSheet.#addAttributeBonus,
      addSkillBonus: SKSKItemSheet.#addSkillBonus,
      addAbility: SKSKItemSheet.#addAbility,
      removeArrayEntry: SKSKItemSheet.#removeArrayEntry,
      addAbilityEffect: SKSKItemSheet.#addAbilityEffect,
      addRange: SKSKItemSheet.#addRange,
      addCombinedSkill: SKSKItemSheet.#addCombinedSkill,
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", label: "Description" },
        { id: "attributes", label: "Attributes" },
        { id: "effects", label: "Effects" },
      ],
      initial: "description",
    },
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/sksk/templates/item/parts/header.hbs",
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs",
    },
    description: {
      template: "systems/sksk/templates/item/parts/description.hbs",
      scrollable: [""],
    },
    attributes: {
      template: "systems/sksk/templates/item/parts/attributes.hbs",
      scrollable: [""],
    },
    effects: {
      template: "systems/sksk/templates/item/parts/effects.hbs",
      scrollable: [""],
    },
  };

  /**
   * The Item document managed by this sheet.
   * @type {Item}
   */
  get item() {
    return this.document;
  }

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    // Dynamically set header template based on item type
    const itemType = this.item.type;
    // For now, all item types use the same header, but we could customize per type
    parts.header.template = `systems/sksk/templates/item/parts/header.hbs`;

    if (itemType === 'species') {
      parts.header.template = `systems/sksk/templates/item/parts/header-species.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/species.hbs`;
      // Species have no item-level effects tab; effects live on abilities instead.
      delete parts.effects;
    } else if (itemType === 'class') {
      parts.header.template = `systems/sksk/templates/item/parts/header-class.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/class.hbs`;
      // Classes have no item-level effects tab; effects live on abilities instead.
      delete parts.effects;
    } else if (itemType === 'talent') {
      parts.header.template = `systems/sksk/templates/item/parts/header-talent.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/talent.hbs`;
      // Talents have a single ability; its Active Effects are shown inline
      // rather than in a separate item-level effects tab.
      delete parts.effects;
    } else if (itemType === 'spell') {
      parts.header.template = `systems/sksk/templates/item/parts/header-spell.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/spell.hbs`;
      // Spells have no abilities substructure, so the standard item-level
      // effects tab (kept, unlike species/class/talent) is where any
      // on-cast Active Effects belong.
    }

    return parts;
  }

  /** @override */
  _prepareTabs(group) {
    const tabs = super._prepareTabs(group);
    if (group === 'primary' && this.item.type === 'species') {
      tabs.attributes.label = 'SKSK.SheetLabels.Species';
      delete tabs.effects;
    } else if (group === 'primary' && this.item.type === 'class') {
      tabs.attributes.label = 'SKSK.SheetLabels.Class';
      delete tabs.effects;
    } else if (group === 'primary' && this.item.type === 'talent') {
      tabs.attributes.label = 'TYPES.Item.talent';
      delete tabs.effects;
    } else if (group === 'primary' && this.item.type === 'spell') {
      tabs.attributes.label = 'TYPES.Item.spell';
    }
    return tabs;
  }

  /* -------------------------------------------- */

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    // For the tabs navigation part, convert tabs object to array
    if (partId === 'tabs' && context.tabs) {
      context.tabs = Object.values(context.tabs);
    }
    // For tab content parts, provide the tab context
    else {
      const tab = context.tabs?.[partId];
      if (tab) {
        context.tab = tab;
      }
    }
    return context;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = context.document;

    // Use a safe clone of the item data for further operations.
    const itemData = item.toObject();

    // Add the item's data to context for easier access, as well as flags.
    context.item = item;
    context.data = itemData; // Legacy compatibility
    context.system = itemData.system;
    context.flags = itemData.flags;

    // Template convenience variables
    context.cssClass = this.options.classes.join(' ');
    context.owner = item.isOwner;

    // Retrieve the roll data for TinyMCE editors.
    context.rollData = item.getRollData();

    context.descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      item.system.description ?? "",
      { relativeTo: item, secrets: item.isOwner, rollData: context.rollData }
    );

    // Prepare active effects for easier access
    context.effects = prepareActiveEffectCategories(item.effects);

    if (item.type === 'species') {
      context.speciesTypeChoices = CONFIG.SKSK.speciesTypes;
      context.attributeChoicesNoAura = Object.fromEntries(
        Object.entries(CONFIG.SKSK.attributes).filter(([key]) => key !== 'aur')
      );
      context.canAddAbility = (item.system.abilities?.length ?? 0) < 3;
    }

    if (item.type === 'class') {
      context.classTypeChoices = CONFIG.SKSK.classTypes;
      context.isFirstClass = item.system.classType === 'first';
    }

    if (item.type === 'species' || item.type === 'class') {
      context.skillBonusChoices = getSkillBonusChoices();
    }

    if (item.type === 'talent') {
      context.talentTypeChoices = CONFIG.SKSK.talentTypes;
      context.attributeChoices = CONFIG.SKSK.attributes;
    }

    if (item.type === 'species' || item.type === 'class') {
      // Active Effects scoped to a specific ability, indexed to match system.abilities.
      context.abilityEffects = (item.system.abilities ?? []).map((ability, index) =>
        item.effects.filter(effect => effect.getFlag('sksk', 'abilityIndex') === index)
      );
    }

    if (item.type === 'spell') {
      context.spellTypeChoices = CONFIG.SKSK.spellTypes;
      const isAdvancedSpell = item.system.spellType === 'advanced';
      context.isCombinedSpell = item.system.spellType === 'combined';
      context.showMagicSchool = item.system.spellType === 'simple' || isAdvancedSpell;
      context.magicSchoolChoices = isAdvancedSpell ? CONFIG.SKSK.advancedMagicSchools : CONFIG.SKSK.simpleMagicSchools;
      context.combinedSkillChoices = getSkillBonusChoices();
      context.rangeIndicatorChoices = CONFIG.SKSK.rangeIndicators;
      context.castingMethodChoices = CONFIG.SKSK.castingMethods;
      context.canRemoveRange = (item.system.ranges?.length ?? 0) > 1;
    }

    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    const activeTab = this.tabGroups?.primary
      ?? this.constructor.TABS.primary.initial;
    if (activeTab && this.element.querySelector(`.tab[data-group="primary"][data-tab="${activeTab}"]`)) {
      this.changeTab(activeTab, "primary", { force: true, updatePosition: false });
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle active effect management.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element.
   * @private
   */
  static #onEffectAction(event, target) {
    onManageActiveEffect(event, this.item, target);
  }

  /**
   * Append a blank entry to an array-valued system field.
   * @param {string} field  The system field name, e.g. "attributeBonuses".
   * @param {object} entry  The blank entry to append.
   * @private
   */
  async #addArrayEntry(field, entry) {
    const current = foundry.utils.deepClone(this.item.system[field] ?? []);
    current.push(entry);
    await this.item.update({ [`system.${field}`]: current });
  }

  /**
   * Remove an entry from an array-valued system field.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element, carrying
   *                               data-field and data-index.
   * @private
   */
  static async #removeArrayEntry(event, target) {
    const field = target.dataset.field;
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.item.system[field] ?? []);
    current.splice(index, 1);
    await this.item.update({ [`system.${field}`]: current });
  }

  static async #addAttributeBonus(event, target) {
    await this.#addArrayEntry('attributeBonuses', { attribute: 'str', bonus: 1 });
  }

  static async #addSkillBonus(event, target) {
    await this.#addArrayEntry('skillBonuses', { skill: 'axe', bonus: 1 });
  }

  static async #addAbility(event, target) {
    if ((this.item.system.abilities?.length ?? 0) >= 3) return;
    await this.#addArrayEntry('abilities', { name: '', description: '' });
  }

  static async #addRange(event, target) {
    await this.#addArrayEntry('ranges', { distance: 10, indicator: 'projectile' });
  }

  static async #addCombinedSkill(event, target) {
    await this.#addArrayEntry('combinedSkills', { skill: 'axe', level: 1 });
  }

  /**
   * Create a new Active Effect scoped to a specific ability.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element, carrying data-index.
   * @private
   */
  static async #addAbilityEffect(event, target) {
    const index = Number(target.dataset.index);
    await this.item.createEmbeddedDocuments('ActiveEffect', [{
      name: game.i18n.format('DOCUMENT.New', { type: game.i18n.localize('DOCUMENT.ActiveEffect') }),
      img: 'icons/svg/aura.svg',
      origin: this.item.uuid,
      'flags.sksk.abilityIndex': index,
    }]);
  }
}
