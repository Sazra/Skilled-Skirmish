const { HandlebarsApplicationMixin } = foundry.applications.api;
const { DocumentSheetV2 } = foundry.applications.api;
import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';
import { evaluateSkillFormula, computeSkillBonusTotals, getActorSkillLevel } from '../helpers/skills.mjs';
import { getSkillCheckDefinition, rollSkillCheck, nonEmptyAttributeSubsets } from '../helpers/skillRolls.mjs';
import {
  getVisibleAttributeBonusDropdowns, getResolvedAttributeBonuses, chooseAttributeBonus,
  resetAttributeBonusChoice, resetAllAttributeBonusChoices, applyPendingAutoGrants,
} from '../helpers/attributeBonuses.mjs';
import { getAttributeMaxBreakdown, getAttributeUnlimitedBonusBreakdown } from '../helpers/attributes.mjs';
import {
  checkCombinedSpellPrerequisite,
  checkSimpleOrAdvancedSpellPrerequisite,
  computeSpellManaCost,
  computeSpellApCost,
} from '../helpers/spells.mjs';
import { computeMovementSpeeds, getActorSizeCategory } from '../helpers/movement.mjs';
import { computeCarriedWeight, computeMaxCarryWeight } from '../helpers/inventory.mjs';
import { getClassAbilityLevels, actorHasAdvancedClass } from '../helpers/abilities.mjs';
import { getLifeBreakdown, getNegativeLifeBreakdown } from '../helpers/life.mjs';
import { getManaBreakdown } from '../helpers/mana.mjs';
import { getArmorClassBreakdown, getMagicResistanceBreakdown } from '../helpers/defense.mjs';
import { renderBreakdownHtml } from '../helpers/tooltips.mjs';
import { rollMartialArtsAttack, rollRegeneration, rollMeditation, rollAdrenalin, useMove, useDodge, useItem } from '../helpers/actions.mjs';
import { SKSKRestDialog } from '../apps/rest-dialog.mjs';
import {
  getStatusEffectDefinitions, getStatusStacks, increaseStatusStacks, decreaseStatusStacks, applyD20Malus,
  getStatusEffect, getStatusInstances, getStatusInstancesTotal, addStatusInstance, applyCauterization,
  getAdrenalinDamage, setRestrainedConfig, attemptRestrainedEscapeManual,
} from '../helpers/statusEffects.mjs';
import { getGenericCriticalType, wrapCriticalBlock } from '../helpers/criticalRolls.mjs';

/**
 * Schema paths (relative to system.*) whose value input accepts the "+N"/
 * "-N" relative-adjustment syntax on the resources sidebar and is clamped
 * to [0, the field's own computed max] - see #normalizeResourceInput.
 * Barrier is intentionally excluded: it has no max (unbounded).
 */
const CLAMPED_RESOURCE_KEYS = [
  'life', 'negativeLife', 'mana', 'actionPoints', 'reactionPoints',
  'meditationCharges', 'regenerationCharges', 'inspirationCharges', 'adrenalinCharges', 'luckCharges',
];

/**
 * The General tab Overview sub-tab's fixed (non-user-editable) general
 * resources - see helpers/generalResources.mjs. requiredSkill (if any) must
 * reach level 1 before the resource shows up at all (locked otherwise).
 */
const GENERAL_RESOURCES = [
  { key: 'meditationCharges', label: 'SKSK.GeneralResource.Meditation' },
  { key: 'regenerationCharges', label: 'SKSK.GeneralResource.Regeneration' },
  { key: 'inspirationCharges', label: 'SKSK.GeneralResource.Inspiration', requiredSkill: 'inspiration' },
  { key: 'adrenalinCharges', label: 'SKSK.GeneralResource.Adrenalin', requiredSkill: 'adrenalin' },
  { key: 'luckCharges', label: 'SKSK.GeneralResource.Luck', requiredSkill: 'luck' },
];

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
      rollSkill: SKSKActorSheet.#rollSkill,
      addResource: SKSKActorSheet.#addResource,
      removeResource: SKSKActorSheet.#removeResource,
      addAdditionalData: SKSKActorSheet.#addAdditionalData,
      removeAdditionalData: SKSKActorSheet.#removeAdditionalData,
      addMartialArtsAttack: SKSKActorSheet.#addMartialArtsAttack,
      removeMartialArtsAttack: SKSKActorSheet.#removeMartialArtsAttack,
      rollMartialArtsAttack: SKSKActorSheet.#rollMartialArtsAttack,
      rollRegeneration: SKSKActorSheet.#rollRegeneration,
      rollMeditation: SKSKActorSheet.#rollMeditation,
      rollAdrenalin: SKSKActorSheet.#rollAdrenalin,
      useMove: SKSKActorSheet.#useMove,
      useDodge: SKSKActorSheet.#useDodge,
      useItem: SKSKActorSheet.#useItem,
      openRestDialog: SKSKActorSheet.#openRestDialog,
      increaseStatusStack: SKSKActorSheet.#increaseStatusStack,
      decreaseStatusStack: SKSKActorSheet.#decreaseStatusStack,
      addStatusInstance: SKSKActorSheet.#addStatusInstance,
      applyCauterization: SKSKActorSheet.#applyCauterization,
      attemptRestrainedEscape: SKSKActorSheet.#attemptRestrainedEscape,
      resetAttributeBonus: SKSKActorSheet.#resetAttributeBonus,
      resetAllAttributeBonuses: SKSKActorSheet.#resetAllAttributeBonuses,
    },
    // Drop target for assigning existing Items (of any type) to this actor
    // by dragging them from the sidebar, a compendium, or another sheet.
    dragDrop: [{ dragSelector: null, dropSelector: null }],
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "general", label: "SKSK.SheetLabels.General" },
        { id: "items", label: "Items" },
        { id: "abilities", label: "Abilities" },
        { id: "skills", label: "SKSK.SheetLabels.Skills" },
        { id: "spells", label: "Spells" },
        { id: "effects", label: "Effects" },
        { id: "gm", label: "SKSK.SheetLabels.GM" },
      ],
      initial: "general",
    },
    // Sub-tabs shown inside the General tab - Character (formerly its own
    // top-level tab) and Actions (new) alongside the General tab's
    // pre-existing content, now named Overview.
    generalSections: {
      tabs: [
        { id: "overview", label: "SKSK.General.Overview" },
        { id: "character", label: "SKSK.SheetLabels.Character" },
        { id: "actions", label: "SKSK.SheetLabels.Actions" },
      ],
      initial: "overview",
    },
    // Sub-tabs shown inside the General tab's Character section.
    characterSections: {
      tabs: [
        { id: "data", label: "SKSK.CharacterSection.Data" },
        { id: "biography", label: "SKSK.CharacterSection.Biography" },
      ],
      initial: "data",
    },
    // Sub-tabs shown inside the Skills tab; one per CONFIG.SKSK.skills
    // category. Hardcoded (rather than derived from CONFIG.SKSK) because
    // static class fields evaluate before the init hook populates CONFIG.SKSK.
    skillCategories: {
      tabs: [
        { id: "weapons", label: "SKSK.SkillCategory.Weapons" },
        { id: "armors", label: "SKSK.SkillCategory.Armors" },
        { id: "production", label: "SKSK.SkillCategory.Production" },
        { id: "rogue", label: "SKSK.SkillCategory.Rogue" },
        { id: "magicSchools", label: "SKSK.SkillCategory.MagicSchools" },
        { id: "magic", label: "SKSK.SkillCategory.Magic" },
        { id: "fighter", label: "SKSK.SkillCategory.Fighter" },
        { id: "misc", label: "SKSK.SkillCategory.Misc" },
        { id: "attribute", label: "SKSK.SkillCategory.Attribute" },
        { id: "resistances", label: "SKSK.SkillCategory.Resistances" },
        { id: "weaknesses", label: "SKSK.SkillCategory.Weaknesses" },
        { id: "immunity", label: "SKSK.SkillCategory.Immunity" },
        { id: "absorb", label: "SKSK.SkillCategory.Absorb" },
        { id: "special", label: "SKSK.SkillCategory.Special" },
      ],
      initial: "weapons",
    },
    // Top-level sub-tabs shown inside the Spells tab, one per spell type.
    // Vertical along the left edge (see .spell-type-tabs in the stylesheet)
    // since there are only 4 - unlike the school/category tabs below,
    // which get a horizontal wrapping row like the Skills tab's categories.
    spellTypes: {
      tabs: [
        { id: "simple", label: "SKSK.Spell.Type.Simple" },
        { id: "advanced", label: "SKSK.Spell.Type.Advanced" },
        { id: "combined", label: "SKSK.Spell.Type.Combined" },
        { id: "systemless", label: "SKSK.Spell.Type.Systemless" },
      ],
      initial: "simple",
    },
    // Second-level sub-tabs, one set per spell type; only the set matching
    // the active spellTypes tab is ever visible. Hardcoded rather than
    // derived from CONFIG.SKSK for the same reason as skillCategories above.
    spellSimpleSchools: {
      tabs: [
        { id: "fire", label: "SKSK.Skill.MagicSchool.Fire" },
        { id: "water", label: "SKSK.Skill.MagicSchool.Water" },
        { id: "earth", label: "SKSK.Skill.MagicSchool.Earth" },
        { id: "air", label: "SKSK.Skill.MagicSchool.Air" },
        { id: "life", label: "SKSK.Skill.MagicSchool.Life" },
        { id: "death", label: "SKSK.Skill.MagicSchool.Death" },
        { id: "light", label: "SKSK.Skill.MagicSchool.Light" },
        { id: "nature", label: "SKSK.Skill.MagicSchool.Nature" },
        { id: "dark", label: "SKSK.Skill.MagicSchool.Dark" },
        { id: "trickery", label: "SKSK.Skill.MagicSchool.Trickery" },
      ],
      initial: "fire",
    },
    spellAdvancedSchools: {
      tabs: [
        { id: "martialArts", label: "SKSK.Skill.Weapon.MartialArts" },
        { id: "bardic", label: "SKSK.Skill.MagicSchool.Bardic" },
        { id: "space", label: "SKSK.Skill.MagicSchool.Space" },
        { id: "time", label: "SKSK.Skill.MagicSchool.Time" },
        { id: "blood", label: "SKSK.Skill.MagicSchool.Blood" },
        { id: "divination", label: "SKSK.Skill.MagicSchool.Divination" },
      ],
      initial: "martialArts",
    },
    spellCombinedSchools: {
      tabs: [
        { id: "stormancy", label: "SKSK.Spell.CombinedSchool.Stormancy" },
        { id: "chaomancy", label: "SKSK.Spell.CombinedSchool.Chaomancy" },
        { id: "demomancy", label: "SKSK.Spell.CombinedSchool.Demomancy" },
        { id: "drakomancy", label: "SKSK.Spell.CombinedSchool.Drakomancy" },
        { id: "necromancy", label: "SKSK.Spell.CombinedSchool.Necromancy" },
        { id: "miracles", label: "SKSK.Spell.CombinedSchool.Miracles" },
        { id: "feymancy", label: "SKSK.Spell.CombinedSchool.Feymancy" },
        { id: "geomancy", label: "SKSK.Spell.CombinedSchool.Geomancy" },
        { id: "biomancy", label: "SKSK.Spell.CombinedSchool.Biomancy" },
        { id: "cryomancy", label: "SKSK.Spell.CombinedSchool.Cryomancy" },
        { id: "witchery", label: "SKSK.Spell.CombinedSchool.Witchery" },
      ],
      initial: "stormancy",
    },
    spellSystemlessCategories: {
      tabs: [
        { id: "household", label: "SKSK.Spell.SystemlessCategory.Household" },
        { id: "special", label: "SKSK.Spell.SystemlessCategory.Special" },
        { id: "magicalBody", label: "SKSK.Spell.SystemlessCategory.MagicalBody" },
        { id: "general", label: "SKSK.Spell.SystemlessCategory.General" },
      ],
      initial: "household",
    },
  };

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
    general: {
      template: "systems/sksk/templates/actor/parts/general.hbs",
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
    skills: {
      template: "systems/sksk/templates/actor/parts/skills.hbs",
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
    gm: {
      template: "systems/sksk/templates/actor/parts/gm.hbs",
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
    } else {
      parts.header.template = `systems/sksk/templates/actor/parts/header.hbs`;
      parts.resources.template = `systems/sksk/templates/actor/parts/resources.hbs`;
    }

    // The GM tab holds background information/switches irrelevant to
    // players - not rendered into the DOM at all for non-GM users (see
    // also _prepareContext, which hides its tab-bar button).
    if (!game.user.isGM) delete parts.gm;

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

    // With more than one tab group declared, the base _prepareContext no
    // longer auto-populates context.tabs - prepare both groups ourselves.
    context.tabs = this._prepareTabs('primary');
    // The GM tab holds background information/switches irrelevant to
    // players - hidden from the tab bar entirely for non-GM users.
    if (!game.user.isGM) delete context.tabs.gm;
    context.generalSectionTabs = Object.values(this._prepareTabs('generalSections'));
    context.characterSectionTabs = Object.values(this._prepareTabs('characterSections'));
    context.genderChoices = CONFIG.SKSK.genders;
    // Actions tab (Move) and GM tab (Martial Arts Attacks) choices - see
    // helpers/actions.mjs.
    context.movementTypeChoices = CONFIG.SKSK.movementTypes;
    context.attributeChoices = CONFIG.SKSK.attributes;
    context.attributeUsageChoices = CONFIG.SKSK.attributeUsageTypes;
    // GM tab's attribute-bonus reset list - see helpers/attributeBonuses.mjs.
    context.resolvedAttributeBonuses = getResolvedAttributeBonuses(actor);
    // Actions tab's Weapons/Usable Items containers - "usable" Items are
    // Consumable and/or have Charges enabled (see data/item.mjs#charges) -
    // see helpers/actions.mjs#useItem.
    context.equippedWeapons = actor.items.filter(i => i.type === 'weapon' && i.system.equipped);
    context.usableItems = actor.items.filter(i =>
      i.type === 'item' && (i.system.consumable || i.system.charges?.enabled)
    );
    context.skillTabs = Object.values(this._prepareTabs('skillCategories'));
    context.spellTypeTabs = Object.values(this._prepareTabs('spellTypes'));
    context.spellSimpleSchoolTabs = Object.values(this._prepareTabs('spellSimpleSchools'));
    context.spellAdvancedSchoolTabs = Object.values(this._prepareTabs('spellAdvancedSchools'));
    context.spellCombinedSchoolTabs = Object.values(this._prepareTabs('spellCombinedSchools'));
    context.spellSystemlessCategoryTabs = Object.values(this._prepareTabs('spellSystemlessCategories'));

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

    this._prepareSkills(context);
    this._prepareSpells(context);
    this._prepareGeneral(context);

    // Carried vs. max carry weight (see helpers/inventory.mjs), shown at
    // the top of the Items tab. maxCarryWeight is Infinity for Titanic
    // creatures - displayed as "unlimited" instead of a number.
    const maxCarryWeight = await computeMaxCarryWeight(actor);
    context.carriedWeight = Math.round(computeCarriedWeight(actor) * 10) / 10;
    context.maxCarryWeightDisplay = maxCarryWeight === Infinity
      ? game.i18n.localize('SKSK.Items.Unlimited')
      : Math.round(maxCarryWeight * 10) / 10;

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

    // Predefined (Exhaustion/Dazed/the four Poison severities) and any
    // GM-added custom status effects, each backed by (at most) one real
    // ActiveEffect on the actor whose flags.sksk.stacks this +/- control
    // adjusts - see helpers/statusEffects.mjs.
    context.statusEffectRows = getStatusEffectDefinitions().map(def => {
      const row = { id: def.id, name: def.name, img: def.img, description: def.description };
      if (['wound', 'maxLifeDamage'].includes(def.id)) {
        row.kind = 'multiInstance';
        row.instanceCount = getStatusInstances(actor, def.id).length;
        row.total = getStatusInstancesTotal(actor, def.id);
      } else if (def.id === 'cauterization') {
        row.kind = 'cauterization';
        row.stacks = getStatusEffect(actor, def.id)?.getFlag('sksk', 'value') ?? 0;
      } else if (def.id === 'adrenalinDamage') {
        // Read-only here - only ever changed by rollAdrenalin (see
        // helpers/actions.mjs) or healed by a qualifying Pause (see
        // helpers/rest.mjs), never manually.
        row.kind = 'adrenalinDamage';
        row.stacks = getAdrenalinDamage(actor);
      } else if (def.id === 'restrained') {
        row.kind = 'restrained';
        row.stacks = getStatusStacks(actor, def.id);
        const effect = getStatusEffect(actor, def.id);
        row.dc = effect?.getFlag('sksk', 'dc') ?? 10;
        row.timing = effect?.getFlag('sksk', 'timing') ?? 'start';
        row.apCost = effect?.getFlag('sksk', 'apCost') ?? 0;
      } else {
        row.kind = 'simple';
        row.stacks = getStatusStacks(actor, def.id);
      }
      return row;
    });
    context.restrainedTimingChoices = CONFIG.SKSK.restrainedTimingChoices;

    // Hover tooltips over the Life/Negative Life/Mana/AC/MR labels on the
    // resources sidebar, breaking each computed value down into its
    // formula's individual components - see helpers/tooltips.mjs.
    context.lifeTooltip = renderBreakdownHtml(game.i18n.localize('SKSK.Resource.Life'), getLifeBreakdown(actor));
    context.negativeLifeTooltip = renderBreakdownHtml(
      game.i18n.localize('SKSK.Resource.NegativeLife'), getNegativeLifeBreakdown(actor)
    );
    context.manaTooltip = renderBreakdownHtml(game.i18n.localize('SKSK.Resource.Mana'), getManaBreakdown(actor));
    context.armorClassTooltip = renderBreakdownHtml(game.i18n.localize('SKSK.Resource.AC'), getArmorClassBreakdown(actor));
    context.magicResistanceTooltip = renderBreakdownHtml(
      game.i18n.localize('SKSK.Resource.MR'), getMagicResistanceBreakdown(actor)
    );

    // Hover tooltip per attribute (attributes.hbs) breaking down its Max
    // and "Verbessert X" skill bonus (see helpers/attributes.mjs) - shown
    // on hover instead of inline, to keep the attribute bar compact.
    context.attributeTooltips = {};
    for (const key of Object.keys(CONFIG.SKSK.attributes)) {
      const label = game.i18n.localize(CONFIG.SKSK.attributes[key]);
      context.attributeTooltips[key] =
        renderBreakdownHtml(`${label} ${game.i18n.localize('SKSK.Breakdown.AttributeMax')}`, getAttributeMaxBreakdown(actor, key))
        + renderBreakdownHtml(`${label} ${game.i18n.localize('SKSK.Breakdown.AttributeSkillBonus')}`, getAttributeUnlimitedBonusBreakdown(actor, key));
    }

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

    const actorLevel = context.system.resources?.level?.value ?? 1;

    // Whether the actor also holds an Advanced Class raises the Second
    // Class unlock levels from 13/18/24 to 14/19/25.
    const hasAdvancedClass = actorHasAdvancedClass(this.actor);

    // Abilities granted by class/species items, flattened into a single
    // list for the Abilities tab (alongside talents).
    const classAndSpeciesAbilities = [];

    const collectClassAbilities = (source) => {
      const levels = getClassAbilityLevels(source.system.classType, hasAdvancedClass);
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
          sourceLabel: `${source.name}: Lvl ${requiredLevel}`,
          // Sorted after species abilities, then by unlock level - see the
          // sort below the item-collection loop.
          sortGroup: 1,
          requiredLevel,
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
          // Always sorted first - see the sort below the item-collection loop.
          sortGroup: 0,
          requiredLevel: 0,
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
        // "Level" is abbreviated to "Lvl" here (but not on the Talent item
        // sheet's own Type dropdown) to save space in the Abilities tab's
        // item-source column, which is shared with class/species abilities.
        i.typeLabel = game.i18n.localize(CONFIG.SKSK.talentTypes[i.system.talentType]).replace('Level ', 'Lvl ');
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
      // Spells are handled separately by _prepareSpells - they're grouped
      // and sorted rather than shown as one flat list.
    }

    // Abilities tab order: every species' abilities, then class abilities
    // by the level they unlock at, then talents (rendered separately in
    // abilities.hbs, after this list).
    classAndSpeciesAbilities.sort((a, b) => a.sortGroup - b.sortGroup || a.requiredLevel - b.requiredLevel);

    // Assign and return
    context.gear = gear;
    context.features = features;
    context.talents = talents;
    context.classes = classes;
    context.species = species;
    context.classAndSpeciesAbilities = classAndSpeciesAbilities;
  }

  /**
   * Group the actor's spells for the Spells tab: first by spell type
   * (Simple/Advanced/Combined/Systemless), then by that type's own
   * category (magic school for Simple/Advanced, the Combined school, or
   * the Systemless category). Spells within each leaf are sorted by their
   * level, then alphabetically - e.g. a level 2 spell always precedes a
   * level 3 one regardless of name, but two level-3 spells sort by name.
   *
   * @param {Object} context The context to prepare.
   *
   * @return {undefined}
   */
  _prepareSpells(context) {
    const actor = this.actor;
    const spells = context.items.filter(i => i.type === 'spell');

    // Every spell's actual mana cost (see helpers/spells.mjs#
    // computeSpellManaCost) and, for Simple/Advanced/Combined spells,
    // whether the actor can currently cast it at all (Systemless spells
    // have no prerequisite and are always castable) - both attached
    // directly on the item so the Spells tab can gray out uncastable
    // spells and show their real (possibly penalized/discounted) cost.
    for (const item of spells) {
      const { cost, increased } = computeSpellManaCost(item.system, actor);
      item.effectiveManaCost = cost;
      item.manaCostIncreased = increased;
      item.effectiveApCost = computeSpellApCost(item.system, actor);
      if (item.system.spellType === 'simple' || item.system.spellType === 'advanced') {
        const { castable, missingLabel } = checkSimpleOrAdvancedSpellPrerequisite(item.system, actor);
        item.castable = castable;
        item.missingLabel = missingLabel;
      } else if (item.system.spellType === 'combined') {
        const { castable, missingLabel } = checkCombinedSpellPrerequisite(item.system, actor);
        item.castable = castable;
        item.missingLabel = missingLabel;
      } else {
        // Systemless spells have no prerequisite at all.
        item.castable = true;
      }
      // Whether the spell can be cast without the mana shortfall surcharge
      // - mana cost (icon+number) turns blue and AP cost (icon+number)
      // turns green in this case; mana cost turns red instead whenever the
      // surcharge does apply (see manaCostIncreased above).
      item.costGood = item.castable && !item.manaCostIncreased;
    }

    const sortSpells = (list) => list.slice().sort((a, b) => {
      const levelDiff = (a.system.spellLevel ?? 1) - (b.system.spellLevel ?? 1);
      return levelDiff !== 0 ? levelDiff : a.name.localeCompare(b.name);
    });

    const groupBy = (list, keyFn) => {
      const groups = {};
      for (const item of list) {
        const key = keyFn(item);
        (groups[key] ??= []).push(item);
      }
      for (const key of Object.keys(groups)) groups[key] = sortSpells(groups[key]);
      return groups;
    };

    context.spellsBySimpleSchool = groupBy(
      spells.filter(i => i.system.spellType === 'simple'), i => i.system.magicSchool
    );
    context.spellsByAdvancedSchool = groupBy(
      spells.filter(i => i.system.spellType === 'advanced'), i => i.system.magicSchool
    );
    context.spellsByCombinedSchool = groupBy(
      spells.filter(i => i.system.spellType === 'combined'), i => i.system.combinedSchool
    );
    context.spellsBySystemlessCategory = groupBy(
      spells.filter(i => i.system.spellType === 'systemless'), i => i.system.systemlessCategory
    );
  }

  /**
   * Build, per skill category, the list of rows shown in the Skills tab's
   * sub-tabs: for a character, points/toggle are entered directly and the
   * level is derived from them; for an NPC, a formula stands in for
   * points/toggle so the skill scales automatically with the NPC's level.
   *
   * @param {Object} context The context to prepare.
   *
   * @return {undefined}
   */
  _prepareSkills(context) {
    const actor = this.actor;
    const isNpc = actor.type === 'npc';
    const skills = actor.system.skills ?? {};
    const rollData = actor.getRollData();
    // Starting bonuses from equipped Species (always) and first-only Class
    // items. These are whole skill LEVELS (not points) added on top of the
    // level derived from entered points/formula, capped at the skill's max.
    const skillBonusTotals = computeSkillBonusTotals(actor);

    const skillCategories = {};
    for (const [category, categorySkills] of Object.entries(CONFIG.SKSK.skills)) {
      skillCategories[category] = Object.entries(categorySkills).map(([key, def]) => {
        const data = skills[key] ?? {};
        const row = {
          key,
          label: def.label,
          maxLevel: def.maxLevel,
          isBinary: def.maxLevel === 1,
          isStackable: !!def.stackable,
          points: data.points ?? 0,
          toggle: data.toggle ?? false,
          formula: data.formula ?? '',
          bonus: skillBonusTotals[key] ?? 0,
          favorite: data.favorite ?? false,
          gain: data.gain ?? 0,
          // Whether this skill carries a skill check at all (see
          // helpers/skillRolls.mjs) - only levelled skills with an
          // attribute assigned via the design sheet's "Attributsnutzung"
          // column do.
          rollable: !!def.attributes?.length,
          // "Oder"-choice attribute-bonus thresholds this skill currently
          // has an unresolved, visible dropdown for - see
          // helpers/attributeBonuses.mjs#getVisibleAttributeBonusDropdowns.
          // "all"/"and" mode thresholds need no dropdown at all, so they
          // never appear here.
          attributeBonusDropdowns: getVisibleAttributeBonusDropdowns(actor, key).map(d => ({
            index: d.index,
            level: d.level,
            choices: Object.fromEntries(d.attributes.map(a => [a, CONFIG.SKSK.attributes[a]])),
          })),
        };

        if (row.isStackable) {
          // Weaknesses aren't leveled skills; the raw value IS the stack
          // count (character: entered directly, NPC: formula result).
          row.stacks = isNpc ? evaluateSkillFormula(row.formula, rollData) : row.points;
        } else if (isNpc) {
          // The formula computes total points directly; "L" in the
          // formula is replaced with the actor's level, so non-linear
          // scaling (e.g. "L * L") works, not just a flat rate per level.
          const formulaResult = evaluateSkillFormula(row.formula, rollData);
          if (row.isBinary) {
            row.unlocked = formulaResult === 1;
          } else {
            row.points = formulaResult;
            row.level = getActorSkillLevel(actor, key);
          }
        } else if (row.isBinary) {
          row.unlocked = row.toggle;
        } else {
          row.level = getActorSkillLevel(actor, key);
        }

        return row;
      });
    }

    // Resistance, Immunity, Absorption and Weakness of the same element
    // interact: an active Immunity or Absorption hides (without zeroing)
    // the matching Resistance row, while a Weakness instead stacks on top
    // of whatever Resistance remains visible (+100% damage taken/instance).
    const rowsByKey = {};
    for (const rows of Object.values(skillCategories)) {
      for (const row of rows) rowsByKey[row.key] = row;
    }
    skillCategories.resistances = (skillCategories.resistances ?? []).filter(row => {
      const element = row.key.replace(/Resistance$/, '');
      const blocked = rowsByKey[`${element}Immunity`]?.unlocked || rowsByKey[`${element}Absorption`]?.unlocked;
      if (blocked) return false;
      const stacks = rowsByKey[`${element}Weakness`]?.stacks ?? 0;
      if (stacks > 0) {
        row.weaknessStacks = stacks;
        row.weaknessDamagePercent = stacks * 100;
      }
      return true;
    });

    context.skillCategories = skillCategories;
    context.isNpc = isNpc;
  }

  /**
   * Build the General tab's data: movement speeds, favorited skills (level
   * only - see skills.hbs' favorite toggle), and the actor's user-
   * extensible custom resources list. Also resolves the size category
   * shown (and editable) in the sheet header. Must run after
   * _prepareSkills, since it reuses its already-computed skillCategories
   * rows to pull out the favorited ones.
   *
   * @param {Object} context The context to prepare.
   *
   * @return {undefined}
   */
  _prepareGeneral(context) {
    const actor = this.actor;

    const speeds = computeMovementSpeeds(actor);
    context.movementSpeeds = Object.entries(CONFIG.SKSK.movementTypes).map(([key, label]) => ({
      key, label, value: speeds[key],
    }));

    // Header dropdown: shows the resolved size (override or species
    // default) but only ever writes an explicit override on change - see
    // getActorSizeCategory.
    context.sizeCategory = getActorSizeCategory(actor);
    context.sizeCategoryChoices = CONFIG.SKSK.sizeCategories;

    context.favoriteSkills = Object.values(context.skillCategories ?? {})
      .flat()
      .filter(row => row.favorite);

    context.generalResources = GENERAL_RESOURCES
      .filter(r => !r.requiredSkill || getActorSkillLevel(actor, r.requiredSkill) >= 1)
      .map(r => ({ key: r.key, label: r.label, value: actor.system[r.key].value, max: actor.system[r.key].max }));
  }

  /* -------------------------------------------- */

  /** @override */
  _onChangeForm(formConfig, event) {
    if (this.#onChooseAttributeBonus(event.target)) return;
    this.#normalizeResourceInput(event.target);
    this.#enforceElementExclusivity(event.target);
    super._onChangeForm(formConfig, event);
  }

  /**
   * Handle picking an attribute from a skill's attribute-bonus dropdown
   * (skills.hbs) - unlike a normal form field, this has no "name" of its
   * own (there's nothing to persist 1:1), so it's intercepted here rather
   * than submitted normally. See helpers/attributeBonuses.mjs#
   * chooseAttributeBonus for what actually happens (Character: permanent
   * +1; NPC: choice stored, bonus stays dynamic).
   * @param {HTMLElement} target
   * @return {boolean} Whether this event was an attribute-bonus choice
   *                    (and should NOT fall through to normal handling).
   */
  #onChooseAttributeBonus(target) {
    const skillKey = target?.dataset?.attributeBonusSkill;
    if (skillKey === undefined) return false;
    const index = Number(target.dataset.attributeBonusIndex);
    const attributeKey = target.value;
    if (attributeKey) chooseAttributeBonus(this.actor, skillKey, index, attributeKey);
    return true;
  }

  /**
   * Life/Negative Life/Mana/AP/RP's value inputs (resources.hbs/
   * resources-npc.hbs) accept "+N"/"-N" to adjust the CURRENT value by
   * that amount, in addition to a plain absolute number - and always
   * clamp to [0, the field's own computed max]. Rewrites the input's own
   * value in place before the pending submitOnChange form submission
   * fires, so the corrected number is what actually gets saved - mirrors
   * #enforceElementExclusivity below.
   * @param {HTMLElement} target
   */
  #normalizeResourceInput(target) {
    const match = target?.name?.match(/^system\.(\w+)\.value$/);
    if (!match || !CLAMPED_RESOURCE_KEYS.includes(match[1])) return;
    const [, key] = match;
    const resource = this.actor.system[key];
    const raw = target.value.trim();

    let next;
    if (/^[+-]\d+$/.test(raw)) next = resource.value + Number(raw);
    else {
      const parsed = Number(raw);
      next = Number.isFinite(parsed) ? parsed : resource.value;
    }
    target.value = String(Math.max(0, Math.min(next, resource.max)));
  }

  /**
   * Weakness, Immunity and Absorption of the same element are mutually
   * exclusive. When a player switches one on for an element, edit the
   * other two's inputs directly (unchecked / zeroed) before the pending
   * submitOnChange form submission fires, so the correction lands in the
   * same document update as the actual change instead of a follow-up write.
   * Only reacts to the character-facing toggle/points inputs - NPC formula
   * fields are left to the GM's own judgement, since a formula's result can
   * vary by level and isn't a fixed on/off state to enforce live.
   * @param {HTMLElement} target   The input that just changed.
   */
  #enforceElementExclusivity(target) {
    const match = target?.name?.match(/^system\.skills\.(\w+)\.(toggle|points)$/);
    if (!match) return;
    const [, key, field] = match;

    let element;
    if (field === 'toggle' && key.endsWith('Immunity') && target.checked) {
      element = key.slice(0, -'Immunity'.length);
    } else if (field === 'toggle' && key.endsWith('Absorption') && target.checked) {
      element = key.slice(0, -'Absorption'.length);
    } else if (field === 'points' && key.endsWith('Weakness') && Number(target.value) > 0) {
      element = key.slice(0, -'Weakness'.length);
    } else {
      return;
    }

    const form = target.form;
    for (const sibling of [`${element}Immunity`, `${element}Absorption`, `${element}Weakness`]) {
      if (sibling === key) continue;
      const toggleInput = form?.querySelector(`[name="system.skills.${sibling}.toggle"]`);
      if (toggleInput) toggleInput.checked = false;
      const pointsInput = form?.querySelector(`[name="system.skills.${sibling}.points"]`);
      if (pointsInput) pointsInput.value = 0;
    }
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // Every declared tab group needs its active tab force-applied on first
    // render (Foundry only wires up clicks after that, it doesn't apply an
    // initial state to nested groups on its own).
    for (const group of [
      'primary', 'generalSections', 'characterSections', 'skillCategories', 'spellTypes',
      'spellSimpleSchools', 'spellAdvancedSchools', 'spellCombinedSchools', 'spellSystemlessCategories',
    ]) {
      const active = this.tabGroups?.[group] ?? this.constructor.TABS[group].initial;
      if (active && this.element.querySelector(`.tab[data-group="${group}"][data-tab="${active}"]`)) {
        this.changeTab(active, group, { force: true, updatePosition: false });
      }
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

    // Restrained's DC/timing/AP-cost fields aren't real schema fields (they
    // live as flags on its own ActiveEffect, not system.*), so the sheet's
    // normal submitOnChange form binding can't reach them - read all three
    // from this row directly instead whenever any of them changes.
    const restrainedRow = this.element.querySelector('.status-effect-row[data-status-id="restrained"]');
    restrainedRow?.addEventListener('change', (event) => {
      if (!event.target.matches('.restrained-dc-input, .restrained-timing-select, .restrained-apcost-input')) return;
      event.stopPropagation();
      setRestrainedConfig(this.actor, {
        dc: restrainedRow.querySelector('.restrained-dc-input')?.value,
        timing: restrainedRow.querySelector('.restrained-timing-select')?.value,
        apCost: restrainedRow.querySelector('.restrained-apcost-input')?.value,
      });
    });

    // A Character's "all"/"and" mode attribute-threshold bonuses (no
    // choice to make) have no single "skill level changed" event to hook,
    // so they're lazily detected and applied here instead - a no-op for
    // NPCs (their equivalent bonus stays fully dynamic) and once nothing
    // is left pending. See helpers/attributeBonuses.mjs.
    if (this.actor.isOwner) applyPendingAutoGrants(this.actor);
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
    // target.dataset is a DOMStringMap, not a plain object - deepClone
    // preserves that prototype, and foundry.utils.isPlainObject then
    // rejects it while cleaning the creation data, silently dropping every
    // field beyond the top-level type/name. Spreading it first yields a
    // genuine plain object.
    const data = { ...target.dataset };
    const type = data.type;
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
   * Append a blank entry to the actor's user-extensible custom resources
   * list (General tab).
   * @private
   */
  static async #addResource(event, target) {
    const current = foundry.utils.deepClone(this.actor.system.customResources ?? []);
    current.push({ name: '', value: 0, max: 0 });
    await this.actor.update({ 'system.customResources': current });
  }

  /**
   * Remove an entry from the actor's custom resources list.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element, carrying data-index.
   * @private
   */
  static async #removeResource(event, target) {
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.actor.system.customResources ?? []);
    current.splice(index, 1);
    await this.actor.update({ 'system.customResources': current });
  }

  /**
   * Append a blank entry to the actor's user-extensible additional data
   * list (Character tab's Data section).
   * @private
   */
  static async #addAdditionalData(event, target) {
    const current = foundry.utils.deepClone(this.actor.system.additionalData ?? []);
    current.push({ label: '', value: '' });
    await this.actor.update({ 'system.additionalData': current });
  }

  /**
   * Remove an entry from the actor's additional data list.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element, carrying data-index.
   * @private
   */
  static async #removeAdditionalData(event, target) {
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.actor.system.additionalData ?? []);
    current.splice(index, 1);
    await this.actor.update({ 'system.additionalData': current });
  }

  /**
   * Append a blank entry to the actor's GM-defined Martial Arts Attacks
   * list (GM tab) - see data/actor-base.mjs#martialArtsAttacks.
   * @private
   */
  static async #addMartialArtsAttack(event, target) {
    const current = foundry.utils.deepClone(this.actor.system.martialArtsAttacks ?? []);
    // Every attribute key must be explicitly present (false) - see the
    // matching comment on data/actor-base.mjs#martialArtsAttacks' own
    // default value.
    const attributes = Object.fromEntries(Object.keys(CONFIG.SKSK.attributes).map(key => [key, false]));
    current.push({ name: '', formula: '1d4', apCost: 0, attributes, attributeUsage: 'highestMultiple' });
    await this.actor.update({ 'system.martialArtsAttacks': current });
  }

  /**
   * Remove an entry from the actor's Martial Arts Attacks list.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element, carrying data-index.
   * @private
   */
  static async #removeMartialArtsAttack(event, target) {
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.actor.system.martialArtsAttacks ?? []);
    current.splice(index, 1);
    await this.actor.update({ 'system.martialArtsAttacks': current });
  }

  /**
   * Roll the Martial Arts Attack currently chosen in the Actions tab's
   * selector - see helpers/actions.mjs#rollMartialArtsAttack.
   * @param {PointerEvent} event
   * @param {HTMLElement} target   The clicked Roll button.
   * @private
   */
  static async #rollMartialArtsAttack(event, target) {
    const select = target.closest('.action-row')?.querySelector('.martial-arts-attack-select');
    if (!select?.value) return;
    await rollMartialArtsAttack(this.actor, Number(select.value));
  }

  /** @private */
  static async #rollRegeneration(event, target) {
    await rollRegeneration(this.actor);
  }

  /** @private */
  static async #rollMeditation(event, target) {
    await rollMeditation(this.actor);
  }

  static async #rollAdrenalin(event, target) {
    await rollAdrenalin(this.actor);
  }

  /**
   * Use the Move action for the movement type currently chosen in the
   * Actions tab's selector - see helpers/actions.mjs#useMove.
   * @param {PointerEvent} event
   * @param {HTMLElement} target   The clicked Move button.
   * @private
   */
  static async #useMove(event, target) {
    const select = target.closest('.action-row')?.querySelector('.move-type-select');
    await useMove(this.actor, select?.value ?? 'walking');
  }

  /** @private */
  static async #useDodge(event, target) {
    await useDodge(this.actor);
  }

  /**
   * Use one of the Actions tab's listed equipped Weapons/usable Items -
   * see helpers/actions.mjs#useItem.
   * @param {PointerEvent} event
   * @param {HTMLElement} target   The clicked Use button, carrying data-item-id.
   * @private
   */
  static async #useItem(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) await useItem(this.actor, item);
  }

  /**
   * Open the "spend time / take a Pause" dialog (helpers/rest.mjs) from the
   * sheet header's clock button.
   */
  static #openRestDialog(event, target) {
    new SKSKRestDialog(this.actor).render(true);
  }

  /**
   * GM tab: undo one resolved attribute-bonus threshold, letting its
   * dropdown (if "choice" mode) reappear for re-selection - doesn't touch
   * the underlying skill level/points. See helpers/attributeBonuses.mjs#
   * resetAttributeBonusChoice.
   */
  static async #resetAttributeBonus(event, target) {
    await resetAttributeBonusChoice(this.actor, target.dataset.skill, Number(target.dataset.index));
  }

  /** GM tab: undo every resolved attribute-bonus threshold on this actor at once. */
  static async #resetAllAttributeBonuses(event, target) {
    await resetAllAttributeBonusChoices(this.actor);
  }

  /**
   * +/- one stack of a status effect (helpers/statusEffects.mjs) from the
   * Effects tab's Status Effects section.
   */
  static async #increaseStatusStack(event, target) {
    await increaseStatusStacks(this.actor, target.dataset.statusId, 1);
  }

  static async #decreaseStatusStack(event, target) {
    await decreaseStatusStacks(this.actor, target.dataset.statusId, 1);
  }

  /**
   * Add a new independent instance of a multi-instance status effect
   * (Wound/Schaden am maximalen Leben), with the value entered in this
   * row's own paired number input.
   */
  static async #addStatusInstance(event, target) {
    const input = target.closest('.status-effect-row')?.querySelector('.status-effect-add-value');
    const value = Number(input?.value) || 0;
    if (value <= 0) return;
    await addStatusInstance(this.actor, target.dataset.statusId, value);
  }

  static async #applyCauterization(event, target) {
    const input = target.closest('.status-effect-row')?.querySelector('.status-effect-add-value');
    const value = Number(input?.value) || 0;
    if (value <= 0) return;
    await applyCauterization(this.actor, value);
  }

  static async #attemptRestrainedEscape(event, target) {
    await attemptRestrainedEscapeManual(this.actor);
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

    // Handle rolls that supply the formula directly - attribute checks
    // (attributes.hbs) carry their own attribute key too, so Exhaustion's
    // universal D20 malus and Dazed's Str/Dex/Con/App-specific one (see
    // helpers/statusEffects.mjs) can be folded in.
    if (dataset.roll) {
      let label = dataset.label ? `[attribute] ${dataset.label}` : '';
      const formula = applyD20Malus(dataset.roll, this.actor, dataset.attributeKey ?? null);
      let roll = new Roll(formula, this.actor.getRollData());
      roll.evaluate().then(async evaluated => {
        const criticalType = getGenericCriticalType(evaluated);
        const messageData = {
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          flavor: label,
          content: wrapCriticalBlock(await evaluated.render(), criticalType),
          rolls: [evaluated],
        };
        ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
        return ChatMessage.create(messageData);
      });
      return roll;
    }
  }

  /**
   * Handle clicking a skill (skills.hbs' name, or general-overview.hbs'
   * favorited skill row) to roll its skill check: 1d20 + skill level +
   * attribute modifier(s). Skills with a single fixed attribute roll
   * immediately. Skills with more than one possible attribute prompt with
   * one button per valid option - clicking a button both makes the choice
   * and rolls with it in the same action, closing the dialog. An "oder"
   * skill (attributeMode "choice") offers one button per individual
   * attribute; an "und/oder" skill ("combine") instead offers one button
   * per non-empty combination of its attributes (each summed together),
   * since the player may want any subset, not just single attributes -
   * see helpers/skillRolls.mjs.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element, carrying data-skill.
   * @private
   */
  static async #rollSkill(event, target) {
    event.preventDefault();
    const skillKey = target.dataset.skill;
    const def = getSkillCheckDefinition(skillKey);
    if (!def) return;

    const attributes = def.attributes;
    if (attributes.length === 1) {
      return rollSkillCheck(this.actor, skillKey, attributes);
    }

    const isCombine = def.attributeMode === 'combine';
    const options = isCombine ? nonEmptyAttributeSubsets(attributes) : attributes.map(a => [a]);
    const buttons = options.map((option, index) => ({
      action: `option${index}`,
      label: option.map(a => game.i18n.localize(CONFIG.SKSK.attributes[a])).join(' + '),
      callback: () => option,
    }));

    const promptKey = isCombine ? 'SKSK.Skill.CombineAttributePrompt' : 'SKSK.Skill.ChooseAttributePrompt';
    const chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize(def.label) },
      content: `<p>${game.i18n.localize(promptKey)}</p>`,
      buttons,
      rejectClose: false,
    });
    if (!chosen?.length) return;
    return rollSkillCheck(this.actor, skillKey, chosen);
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
