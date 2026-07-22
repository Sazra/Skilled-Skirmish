const { HandlebarsApplicationMixin } = foundry.applications.api;
const { DocumentSheetV2 } = foundry.applications.api;
import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';
import { evaluateSkillFormula, computeSkillBonusTotals, getActorSkillLevel } from '../helpers/skills.mjs';
import {
  checkCombinedSpellPrerequisite,
  checkSimpleOrAdvancedSpellPrerequisite,
  computeSpellManaCost,
  computeSpellApCost,
} from '../helpers/spells.mjs';
import { computeMovementSpeeds, getActorSizeCategory } from '../helpers/movement.mjs';
import { computeCarriedWeight, computeMaxCarryWeight } from '../helpers/inventory.mjs';

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
      addResource: SKSKActorSheet.#addResource,
      removeResource: SKSKActorSheet.#removeResource,
      addAdditionalData: SKSKActorSheet.#addAdditionalData,
      removeAdditionalData: SKSKActorSheet.#removeAdditionalData,
    },
    // Drop target for assigning existing Items (of any type) to this actor
    // by dragging them from the sidebar, a compendium, or another sheet.
    dragDrop: [{ dragSelector: null, dropSelector: null }],
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "character", label: "SKSK.SheetLabels.Character" },
        { id: "general", label: "SKSK.SheetLabels.General" },
        { id: "items", label: "Items" },
        { id: "abilities", label: "Abilities" },
        { id: "skills", label: "SKSK.SheetLabels.Skills" },
        { id: "spells", label: "Spells" },
        { id: "effects", label: "Effects" },
      ],
      initial: "character",
    },
    // Sub-tabs shown inside the Character tab.
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
    character: {
      template: "systems/sksk/templates/actor/parts/character.hbs",
      scrollable: [""],
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
    context.characterSectionTabs = Object.values(this._prepareTabs('characterSections'));
    context.genderChoices = CONFIG.SKSK.genders;
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
  }

  /* -------------------------------------------- */

  /** @override */
  _onChangeForm(formConfig, event) {
    this.#enforceElementExclusivity(event.target);
    super._onChangeForm(formConfig, event);
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
      'primary', 'characterSections', 'skillCategories', 'spellTypes',
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
