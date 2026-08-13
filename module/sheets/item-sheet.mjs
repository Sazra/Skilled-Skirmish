const { HandlebarsApplicationMixin } = foundry.applications.api;
const { DocumentSheetV2 } = foundry.applications.api;
import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';
import { getSkillBonusChoices } from '../helpers/skills.mjs';
import { computeSavingThrowValue, computeDamageBonus, computeCombinedSchoolOverrideLevel } from '../helpers/spells.mjs';
import { getMaterials, getMaterial } from '../helpers/materials.mjs';
import { getWeaponModels, getArmorModels, getWeaponModel, getArmorModel, getOverridablePropertiesFor } from '../helpers/models.mjs';
import { computeEffectiveProperties } from '../helpers/properties.mjs';
import { getCombatStyles } from '../helpers/combatStyles.mjs';
import {
  techniqueHasDuration, techniqueShowsEffectButton, getTechniqueStatusLabel, getTechniqueActionLabel, activateTechnique,
} from '../helpers/technique-rolls.mjs';
import {
  togglePathAbility, getPathAbilityStatusLabel, getPathAbilityActionLabel,
} from '../helpers/soulPathRolls.mjs';
import { SKSKSoulPathElementsDialog } from '../apps/soul-path-elements-dialog.mjs';

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
      addSavingThrow: SKSKItemSheet.#addSavingThrow,
      addSavingThrowAttributeBonus: SKSKItemSheet.#addSavingThrowAttributeBonus,
      addSavingThrowSkillBonus: SKSKItemSheet.#addSavingThrowSkillBonus,
      addSavingThrowTestSkill: SKSKItemSheet.#addSavingThrowTestSkill,
      removeNestedArrayEntry: SKSKItemSheet.#removeNestedArrayEntry,
      addDamage: SKSKItemSheet.#addDamage,
      addDamageAttributeBonus: SKSKItemSheet.#addDamageAttributeBonus,
      addDamageSkillBonus: SKSKItemSheet.#addDamageSkillBonus,
      addStatusEffect: SKSKItemSheet.#addStatusEffect,
      addCombinedSchoolOverride: SKSKItemSheet.#addCombinedSchoolOverride,
      addCombinedSchoolOverrideAttributeBonus: SKSKItemSheet.#addCombinedSchoolOverrideAttributeBonus,
      addCombinedSchoolOverrideSkillBonus: SKSKItemSheet.#addCombinedSchoolOverrideSkillBonus,
      addManaCostReduction: SKSKItemSheet.#addManaCostReduction,
      addApCostReduction: SKSKItemSheet.#addApCostReduction,
      addMovementBonus: SKSKItemSheet.#addMovementBonus,
      addChargeBonus: SKSKItemSheet.#addChargeBonus,
      addAttributeMaxModifier: SKSKItemSheet.#addAttributeMaxModifier,
      addFpGainBonus: SKSKItemSheet.#addFpGainBonus,
      activateTechnique: SKSKItemSheet.#activateTechnique,
      openTechniqueEffect: SKSKItemSheet.#openTechniqueEffect,
      addPathAbility: SKSKItemSheet.#addPathAbility,
      addBreakthrough: SKSKItemSheet.#addBreakthrough,
      togglePathAbility: SKSKItemSheet.#togglePathAbility,
      openPathAbilityEffect: SKSKItemSheet.#openPathAbilityEffect,
      openBreakthroughEffect: SKSKItemSheet.#openBreakthroughEffect,
      openSoulPathElementsDialog: SKSKItemSheet.#openSoulPathElementsDialog,
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", label: "Description" },
        { id: "attributes", label: "Attributes" },
        { id: "effects", label: "Effects" },
        // GM-only tab (Item/Weapon/Armor/Species/Class/Talent) - Material/Model
        // override fields and the 4 expandable bonus-list tables. Stripped
        // entirely for non-GMs and for types with no GM-only fields - see
        // _configureRenderParts/_prepareTabs.
        { id: "gm", label: "SKSK.SheetLabels.GM" },
        // Soul Path only - replaces the 3 tabs above entirely (see
        // _prepareTabs/_configureRenderParts) with its own 6: Properties,
        // then the 5 progression stages in order (see helpers/config.mjs#
        // soulPathStages).
        { id: "soulPathProperties", label: "SKSK.SoulPath.Tab.Properties" },
        { id: "sammlung", label: "SKSK.SoulPath.Stage.Sammlung" },
        { id: "staerkung", label: "SKSK.SoulPath.Stage.Staerkung" },
        { id: "kristallisierung", label: "SKSK.SoulPath.Stage.Kristallisierung" },
        { id: "erwachen", label: "SKSK.SoulPath.Stage.Erwachen" },
        { id: "aufstieg", label: "SKSK.SoulPath.Stage.Aufstieg" },
        // Soul Path's own GM tab - a distinct id from the shared "gm" above
        // (which stays deleted for soulPath) since it only ever holds the
        // FP Gain Bonuses list, not the Material/Model/Reduction/Movement/
        // Charge/MaxAttribute fields the other 6 GM tabs have.
        { id: "gmSoulPath", label: "SKSK.SheetLabels.GM" },
      ],
      initial: "description",
    },
    // Sub-tabs shown inside the Spell tab, keeping the (fairly long) set of
    // spell fields from turning into one giant scroll.
    spellSections: {
      tabs: [
        { id: "general", label: "SKSK.Spell.Section.General" },
        { id: "savingThrows", label: "SKSK.Spell.Section.SavingThrows" },
        { id: "damage", label: "SKSK.Spell.Section.Damage" },
        { id: "statusEffects", label: "SKSK.Spell.Section.StatusEffects" },
      ],
      initial: "general",
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
    // Template overridden per-type in _configureRenderParts, same as attributes.
    gm: {
      template: "systems/sksk/templates/item/parts/gm-item.hbs",
      scrollable: [""],
    },
    soulPathProperties: {
      template: "systems/sksk/templates/item/parts/soul-path-properties.hbs",
      scrollable: [""],
    },
    // Each stage has its own template (not shared - sharing one template
    // path across multiple PARTS entries broke tab-context resolution for
    // every part past the first using that path) with the stage key baked
    // in directly, rather than driven by {{tab.id}}.
    sammlung: {
      template: "systems/sksk/templates/item/parts/soul-path-sammlung.hbs",
      scrollable: [""],
    },
    staerkung: {
      template: "systems/sksk/templates/item/parts/soul-path-staerkung.hbs",
      scrollable: [""],
    },
    kristallisierung: {
      template: "systems/sksk/templates/item/parts/soul-path-kristallisierung.hbs",
      scrollable: [""],
    },
    erwachen: {
      template: "systems/sksk/templates/item/parts/soul-path-erwachen.hbs",
      scrollable: [""],
    },
    aufstieg: {
      template: "systems/sksk/templates/item/parts/soul-path-aufstieg.hbs",
      scrollable: [""],
    },
    gmSoulPath: {
      template: "systems/sksk/templates/item/parts/soul-path-gm.hbs",
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
      parts.gm.template = `systems/sksk/templates/item/parts/gm-species.hbs`;
      // Species have no item-level effects tab; effects live on abilities instead.
      delete parts.effects;
    } else if (itemType === 'class') {
      parts.header.template = `systems/sksk/templates/item/parts/header-class.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/class.hbs`;
      parts.gm.template = `systems/sksk/templates/item/parts/gm-class.hbs`;
      // Classes have no item-level effects tab; effects live on abilities instead.
      delete parts.effects;
    } else if (itemType === 'talent') {
      parts.header.template = `systems/sksk/templates/item/parts/header-talent.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/talent.hbs`;
      parts.gm.template = `systems/sksk/templates/item/parts/gm-talent.hbs`;
      // Talents have a single ability; its Active Effects are shown inline
      // rather than in a separate item-level effects tab.
      delete parts.effects;
    } else if (itemType === 'spell') {
      parts.header.template = `systems/sksk/templates/item/parts/header-spell.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/spell.hbs`;
      // Spells have no abilities substructure, so the standard item-level
      // effects tab (kept, unlike species/class/talent) is where any
      // on-cast Active Effects belong. No GM-only fields exist on Spell.
      delete parts.gm;
    } else if (itemType === 'item') {
      parts.attributes.template = `systems/sksk/templates/item/parts/item-gear.hbs`;
      parts.gm.template = `systems/sksk/templates/item/parts/gm-item.hbs`;
    } else if (itemType === 'armor') {
      // Unlike the generic Item type, Armor has no Quantity field.
      parts.header.template = `systems/sksk/templates/item/parts/header-armor.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/armor.hbs`;
      parts.gm.template = `systems/sksk/templates/item/parts/gm-armor.hbs`;
    } else if (itemType === 'weapon') {
      // Unlike the generic Item type, Weapon has no Quantity field.
      parts.header.template = `systems/sksk/templates/item/parts/header-weapon.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/weapon.hbs`;
      parts.gm.template = `systems/sksk/templates/item/parts/gm-weapon.hbs`;
    } else if (itemType === 'technique') {
      parts.header.template = `systems/sksk/templates/item/parts/header-technique.hbs`;
      parts.attributes.template = `systems/sksk/templates/item/parts/technique.hbs`;
      // No GM-only fields exist on Technique.
      delete parts.gm;
    } else if (itemType === 'soulPath') {
      // Soul Path replaces the shared description/attributes/effects triple
      // entirely with its own 6 tabs (see static TABS/PARTS above), nor
      // does it use the shared GM tab - but it does get its own dedicated
      // gmSoulPath tab (FP Gain Bonuses only, see PARTS.gmSoulPath above).
      parts.header.template = `systems/sksk/templates/item/parts/header-soul-path.hbs`;
      delete parts.description;
      delete parts.attributes;
      delete parts.effects;
      delete parts.gm;
    }

    // The GM tab (whichever per-type template it ended up with above) is
    // entirely hidden from players - it only ever holds GM-authoring fields
    // (Material/Model overrides, bonus-list tables), mirroring the Actor
    // sheet's own GM tab (see actor-sheet.mjs's _configureRenderParts).
    // Soul Path's own gmSoulPath tab gets the same treatment.
    if (!game.user.isGM) {
      delete parts.gm;
      delete parts.gmSoulPath;
    }

    // Every other item type has no use for Soul Path's own 6 tabs (or its
    // gmSoulPath tab) - a separate, unconditional check (matching
    // _prepareTabs' own shape below), since every existing type already
    // matches one of the branches above and would otherwise never reach a
    // trailing "else" here, leaving these parts undeleted and their
    // templates attempting to render with none of the soulPath-only
    // context _prepareContext only ever populates for actual Soul Path
    // items.
    if (itemType !== 'soulPath') {
      delete parts.soulPathProperties;
      delete parts.sammlung;
      delete parts.staerkung;
      delete parts.kristallisierung;
      delete parts.erwachen;
      delete parts.aufstieg;
      delete parts.gmSoulPath;
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
    } else if (group === 'primary' && this.item.type === 'technique') {
      tabs.attributes.label = 'TYPES.Item.technique';
    } else if (group === 'primary' && this.item.type === 'soulPath') {
      delete tabs.description;
      delete tabs.attributes;
      delete tabs.effects;
    }
    if (group === 'primary' && this.item.type !== 'soulPath') {
      delete tabs.soulPathProperties;
      delete tabs.sammlung;
      delete tabs.staerkung;
      delete tabs.kristallisierung;
      delete tabs.erwachen;
      delete tabs.aufstieg;
      delete tabs.gmSoulPath;
    }
    // No GM-only fields exist on Spell/Technique, and the shared "gm" tab
    // is hidden from players entirely - mirrors the parts-level gating in
    // _configureRenderParts above. Soul Path never uses the shared "gm" tab
    // either (it has its own gmSoulPath instead, gated separately below).
    if (group === 'primary' && ['spell', 'technique', 'soulPath'].includes(this.item.type)) {
      delete tabs.gm;
    }
    if (group === 'primary' && !game.user.isGM) {
      delete tabs.gm;
      delete tabs.gmSoulPath;
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

    // With more than one tab group declared (spellSections, for spells),
    // the base _prepareContext no longer auto-populates context.tabs for
    // "primary" - prepare it ourselves so every item type's tab nav still
    // renders.
    context.tabs = this._prepareTabs('primary');

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
      context.sizeCategoryChoices = CONFIG.SKSK.sizeCategories;
    }

    if (item.type === 'class') {
      context.classTypeChoices = CONFIG.SKSK.classTypes;
      context.isFirstClass = item.system.classType === 'first';
    }

    // Equipped/Enchanted only matter (and are only shown) once an Item is
    // marked equippable at all - unlike Armor/Weapon, which always are.
    if (item.type === 'item') {
      context.isEquippable = item.system.equippable;
    }

    if (item.type === 'species' || item.type === 'class' || item.type === 'talent') {
      context.skillBonusChoices = getSkillBonusChoices();
    }

    // fpGainBonuses (Part of the GM tab on Item/Weapon/Armor/Species/Class/
    // Talent, and Soul Path's own dedicated GM tab) - see
    // helpers/skillFp.mjs#applySkillFpGainBonus.
    if (['item', 'weapon', 'armor', 'species', 'class', 'talent', 'soulPath'].includes(item.type)) {
      context.skillBonusChoices ??= getSkillBonusChoices();
      context.fpGainBonusTypeChoices = CONFIG.SKSK.fpGainBonusTypes;
    }

    if (item.type === 'talent') {
      context.talentTypeChoices = CONFIG.SKSK.talentTypes;
      // Talent has only one ability, so unlike Species/Class's abilityEffects
      // (filtered per ability index), all of the item's effects belong to it.
      context.talentEffects = Array.from(item.effects);
    }

    // Combined-school override entries (Class/Species/Talent granting the
    // ability to cast a specific combined magic school up to a computed
    // max level - see helpers/spells.mjs#getCombinedSchoolOverrideLevel)
    // share the same attribute/skill-bonus UI and choices across all three
    // item types.
    if (item.type === 'species' || item.type === 'class' || item.type === 'talent') {
      context.attributeChoices = CONFIG.SKSK.attributes;
      context.combinedSchoolChoices = CONFIG.SKSK.combinedMagicSchools;
      if (item.actor) {
        context.combinedSchoolOverrideValues = (item.system.combinedSchoolOverrides ?? []).map(
          entry => computeCombinedSchoolOverrideLevel(entry, item.actor)
        );
      }
    }

    // Mana-cost reduction entries (Talent/Class/Species/Item/Armor/Weapon
    // discounting a specific magic school's mana cost - see
    // helpers/spells.mjs#computeSpellManaCost) share the same per-entry
    // spellType+school choices across all six item types.
    if (['talent', 'class', 'species', 'item', 'armor', 'weapon'].includes(item.type)) {
      context.spellTypeChoices = CONFIG.SKSK.spellTypes;
      context.simpleMagicSchoolChoices = CONFIG.SKSK.simpleMagicSchools;
      context.advancedMagicSchoolChoices = CONFIG.SKSK.advancedMagicSchools;
      context.combinedSchoolChoices = CONFIG.SKSK.combinedMagicSchools;
      context.systemlessCategoryChoices = CONFIG.SKSK.systemlessMagicCategories;
      // "all" (every movement type at once) plus each individual type.
      context.movementTypeChoices = { all: 'SKSK.Movement.All', ...CONFIG.SKSK.movementTypes };
    }

    // Only Species can replace (rather than merely add to) an actor's base
    // movement speed, or unlock a movement type entirely - see
    // helpers/movement.mjs#computeMovementSpeeds.
    if (item.type === 'species') {
      context.movementBonusModeChoices = CONFIG.SKSK.movementBonusModes;
    }

    // Charge bonuses (Meditation/Regeneration/Inspiration/Adrenalin max
    // charges) - only Species/Class/Talent can grant these. See
    // helpers/generalResources.mjs.
    if (['species', 'class', 'talent'].includes(item.type)) {
      context.chargeResourceChoices = CONFIG.SKSK.chargeResources;
      context.attributeMaxOperationChoices = CONFIG.SKSK.attributeMaxOperations;
    }

    // Material selection (Item/Armor/Weapon only) - see helpers/materials.mjs.
    // The override inputs for materialBonus/manaCapacity are only shown
    // when the selected material's own value is "?" (individually
    // configurable per item). The resulting bonuses/totalManaCapacity are
    // derived-only (set in each type's prepareDerivedData, not part of the
    // schema), so context.system (a toObject() clone, source data only)
    // doesn't carry them - passed through as their own context properties
    // straight from the live item.system instead.
    if (['item', 'armor', 'weapon'].includes(item.type)) {
      context.materials = getMaterials();
      const material = getMaterial(item.system.material);
      context.materialBonusIsVariable = material?.materialBonus === '?';
      context.manaCapacityIsVariable = material?.manaCapacity === '?';
      context.totalManaCapacity = item.system.totalManaCapacity;
      if (item.type === 'weapon') {
        context.materialAttackBonus = item.system.materialAttackBonus;
        context.materialDamageBonus = item.system.materialDamageBonus;
      } else if (item.type === 'armor') {
        context.materialArmorBonus = item.system.materialArmorBonus;
      } else if (item.type === 'item') {
        context.materialRollBonus = item.system.materialRollBonus;
      }
    }

    // Model selection and property overrides (Weapon/Armor only) - see
    // helpers/models.mjs, helpers/properties.mjs. resolvedModel/
    // effectiveProperties are derived-only (set in prepareDerivedData, not
    // part of the schema), so they're read straight from the live
    // item.system instance rather than context.system (a toObject() clone,
    // source data only - see the Material block above for the same
    // reasoning).
    if (item.type === 'weapon' || item.type === 'armor') {
      const isWeapon = item.type === 'weapon';
      const category = isWeapon ? 'weapon' : item.system.armorType;
      // {value, label} pairs (matching the {{selectOptions}} default shape
      // used elsewhere, e.g. getSkillBonusChoices) rather than the raw
      // CONFIG.SKSK.skills.* object, whose entries are {label, maxLevel}.
      context.typeChoices = Object.entries(isWeapon ? CONFIG.SKSK.skills.weapons : CONFIG.SKSK.skills.armors).map(
        ([key, def]) => ({ value: key, label: def.label })
      );
      context.modelChoices = (isWeapon ? getWeaponModels() : getArmorModels()).filter(
        m => (isWeapon ? m.weaponType : m.armorType) === (isWeapon ? item.system.weaponType : item.system.armorType)
      );
      context.resolvedModel = item.system.resolvedModel;
      // The Property Overrides section shows a switch for every property
      // applicable to this item's category (same keyed-object shape as
      // e.g. weaponPropertyChoices, for the same {{#each choices as |def
      // key|}} template pattern), pre-checked/pre-filled to reflect the
      // CURRENT effective state (material + model + existing overrides) -
      // see #onPropertyOverrideChange, which turns a changed switch back
      // into an add/remove override entry.
      context.overridePropertyChoices = getOverridablePropertiesFor([category]);
      const effective = item.system.effectiveProperties ?? [];
      context.effectivePropertyKeys = effective.map(e => e.property);
      context.effectivePropertyValues = Object.fromEntries(effective.map(e => [e.property, e.value ?? 0]));
      context.attributeChoices = CONFIG.SKSK.attributes;
      context.damageTypeChoices = CONFIG.SKSK.damageTypes;
    }

    if (item.type === 'species' || item.type === 'class') {
      // Active Effects scoped to a specific ability, indexed to match system.abilities.
      context.abilityEffects = (item.system.abilities ?? []).map((ability, index) =>
        item.effects.filter(effect => effect.getFlag('sksk', 'abilityIndex') === index)
      );
    }

    if (item.type === 'spell') {
      context.spellSectionTabs = Object.values(this._prepareTabs('spellSections'));
      context.spellTypeChoices = CONFIG.SKSK.spellTypes;
      const isAdvancedSpell = item.system.spellType === 'advanced';
      context.isCombinedSpell = item.system.spellType === 'combined';
      context.isSystemlessSpell = item.system.spellType === 'systemless';
      context.showMagicSchool = item.system.spellType === 'simple' || isAdvancedSpell;
      context.magicSchoolChoices = isAdvancedSpell ? CONFIG.SKSK.advancedMagicSchools : CONFIG.SKSK.simpleMagicSchools;
      context.combinedSchoolChoices = CONFIG.SKSK.combinedMagicSchools;
      context.systemlessCategoryChoices = CONFIG.SKSK.systemlessMagicCategories;
      context.combinedSkillChoices = getSkillBonusChoices();
      context.rangeIndicatorChoices = CONFIG.SKSK.rangeIndicators;
      context.castingMethodChoices = CONFIG.SKSK.castingMethods;
      context.apCostUnitChoices = CONFIG.SKSK.apCostUnits;
      context.canRemoveRange = (item.system.ranges?.length ?? 0) > 1;

      context.attributeChoices = CONFIG.SKSK.attributes;
      context.damageTypeChoices = CONFIG.SKSK.damageTypes;
      context.spellTriggerChoices = CONFIG.SKSK.spellTriggers;
      // Choices for the "which saving throw" selector on Damage/Status
      // Effect entries whose trigger is "save"; falls back to a numbered
      // label when the saving throw itself has none set.
      context.savingThrowChoices = (item.system.savingThrows ?? []).map((entry, index) => ({
        value: index,
        label: entry.label || game.i18n.format('SKSK.Spell.SavingThrow.Numbered', { number: index + 1 }),
      }));
      // Only meaningful when the spell is owned by an actor - otherwise
      // there's no caster to derive attribute/skill values from.
      if (item.actor) {
        context.savingThrowValues = (item.system.savingThrows ?? []).map(
          entry => computeSavingThrowValue(entry, item.actor)
        );
        context.damageBonusValues = (item.system.damages ?? []).map(
          entry => computeDamageBonus(entry, item.actor)
        );
      }
    }

    if (item.type === 'technique') {
      context.techniqueCategoryChoices = CONFIG.SKSK.techniqueCategories;
      context.combatStyleChoices = Object.fromEntries(getCombatStyles().map(s => [s.id, s.name]));
      context.bonusDamageModeChoices = CONFIG.SKSK.bonusDamageModes;
      context.effectTargetChoices = CONFIG.SKSK.techniqueEffectTargets;
      context.hasCombatStyles = getCombatStyles().length > 0;
      context.isStand = item.system.category === 'stand';
      context.isBonusDamage = item.system.category === 'bonusDamage';
      context.isEffect = item.system.category === 'effect';
      // Only stand, and effect targeting the wielder itself, are genuine
      // duration-ticking buffs - bonusDamage/effect-attackTarget are primed
      // instead, consumed by the next weapon/Martial Arts attack (see
      // helpers/technique-rolls.mjs).
      context.showDuration = techniqueHasDuration(item);
      context.showEffectId = techniqueShowsEffectButton(item);
      context.statusLabel = getTechniqueStatusLabel(item);
      context.actionLabel = getTechniqueActionLabel(item);
    }

    if (item.type === 'soulPath') {
      context.pathTypeChoices = CONFIG.SKSK.pathTypes;
      context.pathAbilityTypeChoices = CONFIG.SKSK.pathAbilityTypes;
      context.breakthroughModeChoices = CONFIG.SKSK.soulPathBreakthroughModes;
      context.soulPathStageChoices = CONFIG.SKSK.soulPathStages;
      context.pathAbilityStatuses = (item.system.pathAbilities ?? []).map(getPathAbilityStatusLabel);
      context.pathAbilityActionLabels = (item.system.pathAbilities ?? []).map(getPathAbilityActionLabel);
      // Elements are picked via apps/soul-path-elements-dialog.mjs now (see
      // the Properties tab's own button) rather than an in-sheet
      // <select multiple> - this is just the button's own preview text.
      context.pathElementsPreview = (item.system.elements ?? [])
        .map(key => game.i18n.localize(CONFIG.SKSK.pathElements[key] ?? key))
        .join(', ');
    }

    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // Foundry's own tabGroups.primary always initializes to static
    // TABS.primary.initial ("description") regardless of item type, even
    // though Soul Path has no "description" tab at all (see
    // _prepareTabs) - fall back to its own first tab whenever the current
    // value doesn't correspond to an actually-rendered section, rather
    // than only when it's falsy.
    let activeTab = this.tabGroups?.primary;
    if (!activeTab || !this.element.querySelector(`.tab[data-group="primary"][data-tab="${activeTab}"]`)) {
      activeTab = this.item.type === 'soulPath' ? 'soulPathProperties' : this.constructor.TABS.primary.initial;
    }
    if (activeTab && this.element.querySelector(`.tab[data-group="primary"][data-tab="${activeTab}"]`)) {
      this.tabGroups.primary = activeTab;
      this.changeTab(activeTab, "primary", { force: true, updatePosition: false });
    }

    if (this.item.type === 'spell') {
      const activeSection = this.tabGroups?.spellSections
        ?? this.constructor.TABS.spellSections.initial;
      if (activeSection && this.element.querySelector(`.tab[data-group="spellSections"][data-tab="${activeSection}"]`)) {
        this.changeTab(activeSection, "spellSections", { force: true, updatePosition: false });
      }
    }

    if (this.item.type === 'weapon' || this.item.type === 'armor') {
      // The Property Overrides switches aren't named form fields (their
      // effect is computed, not a direct 1:1 field), so they're handled via
      // a manual "change" listener instead of the sheet's normal
      // submitOnChange - see #onPropertyOverrideChange.
      this.element.querySelector('.property-overrides-section')
        ?.addEventListener('change', this.#onPropertyOverrideChange.bind(this));
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
    await this.#addArrayEntry('abilities', { name: '', description: '', lifeBonusFormula: '0', manaBonusFormula: '0' });
  }

  static async #addRange(event, target) {
    await this.#addArrayEntry('ranges', { distance: 10, indicator: 'projectile' });
  }

  static async #addCombinedSkill(event, target) {
    await this.#addArrayEntry('combinedSkills', { skill: 'axe', level: 1 });
  }

  static async #addSavingThrow(event, target) {
    await this.#addArrayEntry('savingThrows', {
      label: '', baseValue: 10, attributeBonuses: [], skillBonuses: [],
      testAttributes: {}, testSkills: [],
    });
  }

  /**
   * A new Damage entry starts pre-filled with the standard scaling most
   * spells use - the Willpower modifier, the skill(s) tied to how the
   * spell is cast (its magic school for Simple/Advanced, every required
   * skill for Combined), and Magic Control. All of it is just a starting
   * point the player can freely remove or change afterward.
   */
  static async #addDamage(event, target) {
    const system = this.item.system;
    const attributeBonuses = [
      { attribute: 'wil', useModifier: true, formula: '@value' },
    ];
    const skillBonuses = [];
    if (system.spellType === 'simple' || system.spellType === 'advanced') {
      skillBonuses.push({ skill: system.magicSchool, formula: '@value' });
    } else if (system.spellType === 'combined') {
      for (const entry of system.combinedSkills ?? []) {
        if (entry.skill) skillBonuses.push({ skill: entry.skill, formula: '@value' });
      }
    }
    skillBonuses.push({ skill: 'magicControl', formula: '@value' });

    await this.#addArrayEntry('damages', {
      formula: '1d6', damageType: 'fire', trigger: 'unconditional', savingThrowIndex: null,
      attributeBonuses, skillBonuses,
    });
  }

  static async #addStatusEffect(event, target) {
    await this.#addArrayEntry('statusEffects', {
      description: '', trigger: 'unconditional', savingThrowIndex: null,
    });
  }

  static async #addCombinedSchoolOverride(event, target) {
    await this.#addArrayEntry('combinedSchoolOverrides', {
      combinedSchool: 'stormancy', baseFormula: '0', attributeBonuses: [], skillBonuses: [],
    });
  }

  static async #addManaCostReduction(event, target) {
    await this.#addArrayEntry('manaCostReductions', {
      spellType: 'simple', school: 'fire', percent: 0, flatFormula: '0', allowBelowOne: false,
    });
  }

  static async #addApCostReduction(event, target) {
    await this.#addArrayEntry('apCostReductions', {
      spellType: 'simple', school: 'fire', flatFormula: '0',
    });
  }

  static async #addMovementBonus(event, target) {
    const entry = { movementType: 'all', bonus: 0 };
    // mode/unlocked only exist on Species' schema - see data/species.mjs.
    if (this.item.type === 'species') {
      entry.mode = 'bonus';
      entry.unlocked = false;
    }
    await this.#addArrayEntry('movementBonuses', entry);
  }

  static async #addChargeBonus(event, target) {
    await this.#addArrayEntry('chargeBonuses', { resource: 'meditation', bonus: 0 });
  }

  static async #addAttributeMaxModifier(event, target) {
    await this.#addArrayEntry('attributeMaxModifiers', { attribute: 'str', operation: 'add', value: 1 });
  }

  /** @private */
  static async #addFpGainBonus(event, target) {
    await this.#addArrayEntry('fpGainBonuses', { skill: 'axe', bonusType: 'positive', amount: 0, allowZero: false });
  }

  /**
   * The Technique sheet's own Activate/Deactivate (or Prime/Cancel) button
   * - see helpers/technique-rolls.mjs#activateTechnique. A no-op if this
   * Item isn't actually owned by an Actor (nothing to spend AP/Mana from).
   */
  static async #activateTechnique(event, target) {
    if (!this.item.actor) return ui.notifications.warn(game.i18n.localize('SKSK.Technique.NotOwned'));
    await activateTechnique(this.item.actor, this.item);
  }

  /**
   * Open a Technique's own linked ActiveEffect (bound the first time it's
   * activated - see helpers/technique-rolls.mjs#ensureLinkedEffect) in
   * Foundry's native effect config sheet.
   */
  static async #openTechniqueEffect(event, target) {
    const effect = this.item.system.effectId ? this.item.actor?.effects.get(this.item.system.effectId) : null;
    if (!effect) return ui.notifications.warn(game.i18n.localize('SKSK.Technique.NoEffectYet'));
    effect.sheet.render(true);
  }

  /**
   * The Properties tab's "Elements" button - opens apps/
   * soul-path-elements-dialog.mjs's checkbox-list window.
   */
  static #openSoulPathElementsDialog(event, target) {
    new SKSKSoulPathElementsDialog(this.item).render(true);
  }

  static async #addPathAbility(event, target) {
    await this.#addArrayEntry('pathAbilities', {
      name: '', description: '', type: 'passive', apCost: 0, manaCost: 0, durationRounds: 1, cooldownRounds: 0,
    });
  }

  static async #addBreakthrough(event, target) {
    const stage = target.dataset.stage;
    await this.#addArrayEntry(stage, {
      name: '', description: '', cost: 0, difficulty: 0, mode: 'once',
    });
  }

  /**
   * A Path Ability's own Activate/Deactivate button - see helpers/
   * soulPathRolls.mjs#togglePathAbility. A no-op if this Item isn't owned
   * by an Actor (nothing to spend AP/Mana from).
   */
  static async #togglePathAbility(event, target) {
    if (!this.item.actor) return ui.notifications.warn(game.i18n.localize('SKSK.Technique.NotOwned'));
    await togglePathAbility(this.item.actor, this.item, Number(target.dataset.index));
  }

  /**
   * Open a Path Ability's own linked ActiveEffect (bound the first time it
   * unlocks/activates) in Foundry's native effect config sheet.
   */
  static async #openPathAbilityEffect(event, target) {
    const index = Number(target.dataset.index);
    const effectId = this.item.system.pathAbilities?.[index]?.effectId;
    const effect = effectId ? this.item.actor?.effects.get(effectId) : null;
    if (!effect) return ui.notifications.warn(game.i18n.localize('SKSK.SoulPath.NoEffectYet'));
    effect.sheet.render(true);
  }

  /**
   * Open a Durchbruch (breakthrough) entry's own linked ActiveEffect (bound
   * on its first completion) in Foundry's native effect config sheet.
   */
  static async #openBreakthroughEffect(event, target) {
    const stage = target.dataset.stage;
    const index = Number(target.dataset.index);
    const effectId = this.item.system[stage]?.[index]?.effectId;
    const effect = effectId ? this.item.actor?.effects.get(effectId) : null;
    if (!effect) return ui.notifications.warn(game.i18n.localize('SKSK.SoulPath.NoEffectYet'));
    effect.sheet.render(true);
  }

  /**
   * Recompute this Weapon/Armor's propertyOverrides array from the current
   * checked/value state of every property switch in the Property Overrides
   * section - a switch checked when the property isn't naturally granted
   * (by this item's Material + Model alone) becomes an "add" override;
   * unchecked when it IS naturally granted becomes a "remove" override; a
   * checked switch whose coupled Requirement/Range value differs from the
   * natural one becomes an "add" override carrying the new value. A switch
   * left matching the natural state needs no override entry at all - see
   * helpers/properties.mjs#computeEffectiveProperties.
   * @param {Event} event  A "change" event bubbled up from the section.
   * @private
   */
  async #onPropertyOverrideChange(event) {
    event.stopPropagation();
    const item = this.item;
    const isWeapon = item.type === 'weapon';
    const model = isWeapon ? getWeaponModel(item.system.model) : getArmorModel(item.system.model);
    const natural = new Map(
      computeEffectiveProperties({ material: item.system.material, propertyOverrides: [] }, model)
        .map(e => [e.property, e.value])
    );

    const section = event.currentTarget;
    const overrides = [];
    for (const toggle of section.querySelectorAll('.property-override-toggle')) {
      const key = toggle.dataset.property;
      const def = CONFIG.SKSK.modelProperties[key];
      const valueInput = section.querySelector(`.property-override-value[data-property="${key}"]`);
      const value = valueInput ? Number(valueInput.value) || 0 : 0;
      const isNatural = natural.has(key);
      if (toggle.checked && !isNatural) {
        overrides.push({ property: key, mode: 'add', value });
      } else if (!toggle.checked && isNatural) {
        overrides.push({ property: key, mode: 'remove', value: 0 });
      } else if (toggle.checked && isNatural && (def?.hasRequirement || def?.hasRange) && value !== natural.get(key)) {
        overrides.push({ property: key, mode: 'add', value });
      }
    }
    await item.update({ 'system.propertyOverrides': overrides });
  }

  /**
   * Append a blank entry to an array nested inside one element of a
   * top-level array-valued system field, e.g. a saving throw's
   * attributeBonuses/skillBonuses.
   * @param {string} parentField  The top-level system field, e.g. "savingThrows".
   * @param {number} parentIndex  Index of the element within that array.
   * @param {string} childField   The nested array field on that element.
   * @param {object} entry        The blank entry to append.
   * @private
   */
  async #addNestedArrayEntry(parentField, parentIndex, childField, entry) {
    const parent = foundry.utils.deepClone(this.item.system[parentField] ?? []);
    const child = foundry.utils.deepClone(parent[parentIndex]?.[childField] ?? []);
    child.push(entry);
    parent[parentIndex][childField] = child;
    await this.item.update({ [`system.${parentField}`]: parent });
  }

  static async #addSavingThrowAttributeBonus(event, target) {
    const parentIndex = Number(target.dataset.index);
    await this.#addNestedArrayEntry('savingThrows', parentIndex, 'attributeBonuses', {
      attribute: 'wil', useModifier: true, formula: '@value',
    });
  }

  static async #addSavingThrowSkillBonus(event, target) {
    const parentIndex = Number(target.dataset.index);
    await this.#addNestedArrayEntry('savingThrows', parentIndex, 'skillBonuses', {
      skill: 'magicControl', formula: '@value',
    });
  }

  static async #addSavingThrowTestSkill(event, target) {
    const parentIndex = Number(target.dataset.index);
    await this.#addNestedArrayEntry('savingThrows', parentIndex, 'testSkills', 'stealth');
  }

  static async #addDamageAttributeBonus(event, target) {
    const parentIndex = Number(target.dataset.index);
    await this.#addNestedArrayEntry('damages', parentIndex, 'attributeBonuses', {
      attribute: 'str', useModifier: true, formula: '@value',
    });
  }

  static async #addDamageSkillBonus(event, target) {
    const parentIndex = Number(target.dataset.index);
    await this.#addNestedArrayEntry('damages', parentIndex, 'skillBonuses', {
      skill: 'axe', formula: '@value',
    });
  }

  static async #addCombinedSchoolOverrideAttributeBonus(event, target) {
    const parentIndex = Number(target.dataset.index);
    await this.#addNestedArrayEntry('combinedSchoolOverrides', parentIndex, 'attributeBonuses', {
      attribute: 'wil', useModifier: true, formula: '@value',
    });
  }

  static async #addCombinedSchoolOverrideSkillBonus(event, target) {
    const parentIndex = Number(target.dataset.index);
    await this.#addNestedArrayEntry('combinedSchoolOverrides', parentIndex, 'skillBonuses', {
      skill: 'magicControl', formula: '@value',
    });
  }

  /**
   * Remove an entry from an array nested inside one element of a
   * top-level array-valued system field (the counterpart to
   * #addNestedArrayEntry above).
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element, carrying
   *                               data-parent-field, data-parent-index,
   *                               data-field and data-index.
   * @private
   */
  static async #removeNestedArrayEntry(event, target) {
    const { parentField, parentIndex, field, index } = target.dataset;
    const parent = foundry.utils.deepClone(this.item.system[parentField] ?? []);
    const child = foundry.utils.deepClone(parent[Number(parentIndex)]?.[field] ?? []);
    child.splice(Number(index), 1);
    parent[Number(parentIndex)][field] = child;
    await this.item.update({ [`system.${parentField}`]: parent });
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
