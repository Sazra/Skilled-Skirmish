const { HandlebarsApplicationMixin } = foundry.applications.api;
const { DocumentSheetV2 } = foundry.applications.api;
import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {DocumentSheetV2}
 * @mixes {HandlebarsApplication}
 */
export class SKSKActorSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'sheet', 'actor'],
    position: { width: 600, height: "auto" },
    form: {
      submitOnChange: true
    },
    actions: {
      editItem: SKSKActorSheet.#editItem,
      createItem: SKSKActorSheet.#createItem,
      deleteItem: SKSKActorSheet.#deleteItem,
      create: SKSKActorSheet.#onEffectAction,
      edit: SKSKActorSheet.#onEffectAction,
      delete: SKSKActorSheet.#onEffectAction,
      toggle: SKSKActorSheet.#onEffectAction,
      roll: SKSKActorSheet.#onRoll,
    },
    // Drop target for assigning existing Items (of any type) to this actor
    // by dragging them from the sidebar, a compendium, or another sheet.
    dragDrop: [{ dragSelector: null, dropSelector: null }],
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", label: "Description" },
        { id: "items", label: "Items" },
        { id: "abilities", label: "Abilities" },
        { id: "spells", label: "Spells" },
        { id: "effects", label: "Effects" },
      ],
      initial: "description",
    },
  };

  /** @override */
  _prepareTabs(group) {
    const tabs = super._prepareTabs(group);
    if (group === "primary" && this.actor.type === 'npc') {
      // NPCs don't have a spells tab
      delete tabs.spells;
    }
    return tabs;
  }

  /** @override */
  static PARTS = {
    header: {
      template: "systems/sksk/templates/actor/parts/header.hbs",
    },
    resources: {
      template: "systems/sksk/templates/actor/parts/resources.hbs",
    },
    attributes: {
      template: "systems/sksk/templates/actor/parts/attributes.hbs",
    },
    tabs: {
      template: "systems/sksk/templates/actor/parts/tab-navigation.hbs",
    },
    description: {
      template: "systems/sksk/templates/actor/parts/description.hbs",
      scrollable: [""],
    },
    items: {
      template: "systems/sksk/templates/actor/parts/items.hbs",
      scrollable: [""],
    },
    abilities: {
      template: "systems/sksk/templates/actor/parts/abilities.hbs",
      scrollable: [""],
    },
    spells: {
      template: "systems/sksk/templates/actor/parts/spells.hbs",
      scrollable: [""],
    },
    effects: {
      template: "systems/sksk/templates/actor/parts/effects.hbs",
      scrollable: [""],
    },
  };

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    // Dynamically set templates based on actor type
    const actorType = this.actor.type;

    // Set header template based on actor type
    if (actorType === 'npc') {
      parts.header.template = `systems/sksk/templates/actor/parts/header-npc.hbs`;
      parts.resources.template = `systems/sksk/templates/actor/parts/resources-npc.hbs`;
      // NPCs don't have a spells tab
      delete parts.spells;
    } else {
      parts.header.template = `systems/sksk/templates/actor/parts/header.hbs`;
      parts.resources.template = `systems/sksk/templates/actor/parts/resources.hbs`;
    }

    return parts;
  }

  /**
   * The Actor document managed by this sheet.
   * @type {Actor}
   */
  get actor() {
    return this.document;
  }

  constructor(...args) {
    super(...args);
    this.#dragDrop = this.#createDragDropHandlers();
  }

  /**
   * The drag-and-drop workflows bound to this sheet.
   * @type {DragDrop[]}
   */
  #dragDrop;

  #createDragDropHandlers() {
    return this.options.dragDrop.map(config => {
      config.permissions = {
        dragstart: () => this.isEditable,
        drop: () => this.isEditable,
      };
      config.callbacks = {
        drop: this._onDropItem.bind(this),
      };
      return new foundry.applications.ux.DragDrop.implementation(config);
    });
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
    const actor = context.document;
    const actorData = actor.system;

    // Add the actor's data to context for easier access, as well as flags.
    context.actor = actor;
    context.data = actor.toObject(); // Legacy compatibility
    context.system = actorData;
    context.flags = actor.flags;

    // Template convenience variables
    context.cssClass = [...this.options.classes, actor.type].join(' ');
    context.owner = actor.isOwner;

    // Add items array for compatibility with legacy getData() structure
    context.items = Array.from(actor.items.values());
    context.items.sort((a, b) => (a.sort || 0) - (b.sort || 0));

    // Prepare character data and items.
    if (actor.type === 'character') {
      this._prepareItems(context);
      this._prepareCharacterData(context);
    }

    // Prepare NPC data and items.
    if (actor.type === 'npc') {
      this._prepareItems(context);
    }

    // Add roll data for TinyMCE editors.
    context.rollData = actor.getRollData();

    context.biographyHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      actor.system.biography ?? "",
      { relativeTo: actor, secrets: actor.isOwner, rollData: context.rollData }
    );

    // Prepare active effects
    context.effects = prepareActiveEffectCategories(
      // A generator that returns all effects stored on the actor
      // as well as any items
      actor.allApplicableEffects()
    );

    return context;
  }

  /**
   * Organize and classify Items for Character sheets.
   *
   * @param {Object} context The context to prepare.
   *
   * @return {undefined}
   */
  _prepareCharacterData(context) {
    // Attribute labels and modifiers are prepared by the TypeDataModel.
  }

  /**
   * Organize and classify Items for Character sheets.
   *
   * @param {Object} context The context to prepare.
   *
   * @return {undefined}
   */
  _prepareItems(context) {
    // Initialize containers.
    const gear = [];
    const features = [];
    const classes = [];
    const species = [];
    const talents = [];
    const spells = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
      7: [],
      8: [],
      9: [],
    };

    const actorLevel = context.system.resources?.level?.value ?? 1;

    // Whether the actor also holds an Advanced Class raises the Second
    // Class unlock levels from 13/18/24 to 14/19/25.
    const hasAdvancedClass = context.items.some(
      (i) => i.type === 'class' && i.system.classType === 'advanced'
    );

    // The level at which each of a class's 3 abilities unlocks, by class type.
    const classAbilityLevels = {
      first: [1, 6, 12],
      second: hasAdvancedClass ? [14, 19, 25] : [13, 18, 24],
      advanced: [13, 13, 13],
      third: [25, 25, 25],
    };

    // Abilities granted by class/species items, flattened into a single
    // list for the Abilities tab (alongside talents).
    const classAndSpeciesAbilities = [];

    const collectClassAbilities = (source) => {
      const levels = classAbilityLevels[source.system.classType] ?? [1, 1, 1];
      source.system.abilities?.forEach((ability, index) => {
        if (!ability.name && !ability.description) return;
        const requiredLevel = levels[index] ?? 1;
        // Not unlocked yet at the actor's current level.
        if (actorLevel < requiredLevel) return;
        classAndSpeciesAbilities.push({
          name: ability.name || source.name,
          description: ability.description,
          sourceId: source.id,
          sourceImg: source.img,
          sourceLabel: `${source.name}: Level ${requiredLevel}`,
        });
      });
    };

    const collectSpeciesAbilities = (source) => {
      for (const ability of source.system.abilities ?? []) {
        if (!ability.name && !ability.description) continue;
        classAndSpeciesAbilities.push({
          name: ability.name || source.name,
          description: ability.description,
          sourceId: source.id,
          sourceImg: source.img,
          // Species abilities are labeled with only the species' name.
          sourceLabel: source.name,
        });
      }
    };

    // Iterate through items, allocating to containers
    for (let i of context.items) {
      i.img = i.img || Item.DEFAULT_ICON;
      // Append to gear.
      if (i.type === 'item') {
        gear.push(i);
      }
      // Append to gear.
      else if (i.type === 'armor') {
        gear.push(i);
      }
      // Append to gear.
      else if (i.type === 'weapon') {
        gear.push(i);
      }
      // Append to features.
      else if (i.type === 'feature') {
        features.push(i);
      }
      // Append to talents.
      else if (i.type === 'talent') {
        i.typeLabel = game.i18n.localize(CONFIG.SKSK.talentTypes[i.system.talentType]);
        talents.push(i);
      }
      // Append to classes.
      else if (i.type === 'class') {
        i.typeLabel = game.i18n.localize(CONFIG.SKSK.classTypes[i.system.classType]);
        classes.push(i);
        collectClassAbilities(i);
      }
      // Append to species.
      else if (i.type === 'species') {
        i.typeLabel = game.i18n.localize(CONFIG.SKSK.speciesTypes[i.system.speciesType]);
        species.push(i);
        collectSpeciesAbilities(i);
      }
      // Append to spells.
      else if (i.type === 'spell') {
        if (i.system.spellLevel != undefined) {
          spells[i.system.spellLevel].push(i);
        }
      }
    }

    // Assign and return
    context.gear = gear;
    context.features = features;
    context.talents = talents;
    context.classes = classes;
    context.species = species;
    context.spells = spells;
    context.classAndSpeciesAbilities = classAndSpeciesAbilities;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    const activeTab = this.tabGroups?.primary ?? this.constructor.TABS.primary.initial;
    if (activeTab && this.element.querySelector(`.tab[data-group="primary"][data-tab="${activeTab}"]`)) {
      this.changeTab(activeTab, "primary", { force: true, updatePosition: false });
    }

    // Drag events for macros.
    if (this.actor.isOwner) {
      const handler = (ev) => this._onDragStart(ev);
      const itemElements = this.element.querySelectorAll('li.item');
      for (const li of itemElements) {
        if (li.classList.contains('inventory-header')) continue;
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', handler, false);
      }
    }

    // Bind drop handling so existing Items (of any type) can be dragged
    // onto this sheet from the sidebar, a compendium, or another sheet.
    this.#dragDrop.forEach(d => d.bind(this.element));
  }

  /**
   * Handle dropping an Item onto this sheet, embedding a copy of it on
   * the actor. Works for every item type.
   * @param {DragEvent} event
   * @private
   */
  async _onDropItem(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type !== 'Item') return;

    const item = await Item.implementation.fromDropData(data);
    if (!item) return;

    // Already an owned item on this actor - nothing to do.
    if (item.actor === this.actor) return;

    const itemData = item.toObject();
    return this.actor.createEmbeddedDocuments('Item', [itemData]);
  }

  /**
   * Handle editing an item.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element.
   * @private
   */
  static #editItem(event, target) {
    const li = target.closest('.item');
    const item = this.actor.items.get(li.dataset.itemId);
    item.sheet.render(true);
  }

  /**
   * Handle creating a new Owned Item for the actor.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element.
   * @private
   */
  static async #createItem(event, target) {
    event.preventDefault();
    const type = target.dataset.type;
    const data = foundry.utils.deepClone(target.dataset);
    const name = `New ${type.capitalize()}`;
    const itemData = {
      name: name,
      type: type,
      system: data,
    };
    delete itemData.system['type'];
    delete itemData.system['action'];
    return await Item.create(itemData, { parent: this.actor });
  }

  /**
   * Handle deleting an item.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element.
   * @private
   */
  static async #deleteItem(event, target) {
    const li = target.closest('.item');
    const item = this.actor.items.get(li.dataset.itemId);
    await item.delete();
    // Use native DOM to hide the element
    li.style.display = 'none';
    this.render(false);
  }

  /**
   * Handle active effect management.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element.
   * @private
   */
  static #onEffectAction(event, target) {
    const row = target.closest('li');
    const document =
      row.dataset.parentId === this.actor.id
        ? this.actor
        : this.actor.items.get(row.dataset.parentId);
    onManageActiveEffect(event, document, target);
  }

  /**
   * Handle clickable rolls.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element.
   * @private
   */
  static #onRoll(event, target) {
    event.preventDefault();
    const dataset = target.dataset;

    // Handle item rolls.
    if (dataset.rollType) {
      if (dataset.rollType == 'item') {
        const itemId = target.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (item) return item.roll();
      }
    }

    // Handle rolls that supply the formula directly.
    if (dataset.roll) {
      let label = dataset.label ? `[attribute] ${dataset.label}` : '';
      let roll = new Roll(dataset.roll, this.actor.getRollData());
      roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: label,
        rollMode: game.settings.get('core', 'rollMode'),
      });
      return roll;
    }
  }

  /**
   * Handle drag start for macros.
   * @param {DragEvent} event   The drag start event
   * @private
   */
  _onDragStart(event) {
    const target = event.currentTarget;
    if ("link" in event.target.dataset) return;

    let dragData;
    if (target.dataset.itemId) {
      const item = this.actor.items.get(target.dataset.itemId);
      dragData = item.toDragData();
    }

    if (dragData) {
      event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    }
  }
}
