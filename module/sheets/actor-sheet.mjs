const { HandlebarsApplicationMixin } = foundry.applications.api;
const { DocumentSheetV2 } = foundry.applications.api;
import {
  onManageActiveEffect,
  prepareActiveEffectCategories,
} from '../helpers/effects.mjs';
import {
  evaluateSkillFormula, computeSkillBonusTotals, getActorSkillLevel, isActorSkillUnlocked, getSkillStacks,
} from '../helpers/skills.mjs';
import { getSkillCheckDefinition, rollSkillCheck, nonEmptyAttributeSubsets, chooseSkillRollVariant } from '../helpers/skillRolls.mjs';
import {
  getVisibleAttributeBonusDropdowns, getResolvedAttributeBonuses, chooseAttributeBonus,
  resetAttributeBonusChoice, resetAllAttributeBonusChoices, applyPendingAutoGrants,
} from '../helpers/attributeBonuses.mjs';
import {
  getAttributeMaxBreakdown, getAttributeUnlimitedBonusBreakdown, getAttributeBaseBonusBreakdown,
  getAttributeSpecialBonusBreakdown, getAttributeModifierBonusBreakdown, computePassivePerception,
  computeSpecialAttributeBonus, computeModifierAttributeBonus,
} from '../helpers/attributes.mjs';
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
import { rollMartialArtsAttack, rollRegeneration, rollMeditation, rollAdrenalin, useMove, useDodge, useItem, postActionChatCard } from '../helpers/actions.mjs';
import { chooseOverchargeCount } from '../helpers/spell-rolls.mjs';
import { SKSKRestDialog } from '../apps/rest-dialog.mjs';
import { SKSKTrainingDialog } from '../apps/training-dialog.mjs';
import { SKSKPrayerDialog } from '../apps/prayer-dialog.mjs';
import { SKSKSummoningDialog } from '../apps/summoning-dialog.mjs';
import { SKSKTotemDialog } from '../apps/totem-dialog.mjs';
import { SKSKSourceDialog } from '../apps/source-dialog.mjs';
import { SKSKProductionFpDialog } from '../apps/production-fp-dialog.mjs';
import { SKSKLehrenDialog } from '../apps/lehren-dialog.mjs';
import {
  grantInspirationDie, consumeInspirationCharge, rollOwnInspirationDie, rollGrantedInspirationDie,
} from '../helpers/inspiration.mjs';
import { copyEffectKeyToClipboard } from '../helpers/effectKeyReference.mjs';
import { formatRollCardHeading } from '../helpers/rollCard.mjs';
import { SKSKMassKillDialog } from '../apps/mass-kill-dialog.mjs';
import { SKSKMartialArtsAttacksDialog } from '../apps/martial-arts-attacks-dialog.mjs';
import { SKSKTechniqueDialog } from '../apps/technique-dialog.mjs';
import {
  getSoulPathItem, isPathAbilityVisible, getPathAbilityStatusLabel, getPathAbilityActionLabel,
  isBreakthroughUnlocked, isBreakthroughAttemptable, getBreakthroughEffectiveValues,
  attemptBreakthrough, togglePathAbility,
} from '../helpers/soulPathRolls.mjs';
import {
  getStatusEffectDefinitions, getStatusStacks, increaseStatusStacks, decreaseStatusStacks, applyD20Malus,
  getStatusEffect, getStatusInstances, getStatusInstancesTotal, addStatusInstance, applyCauterization,
  getAdrenalinDamage, setRestrainedConfig, attemptRestrainedEscapeManual, setStatusStacks,
  setStatusIgnoreSpecialBonus,
} from '../helpers/statusEffects.mjs';
import { wrapCriticalBlock, chooseGenericRollMode, evaluateD20WithMode, formatD20ModeSummaryLine } from '../helpers/criticalRolls.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine, tradeSoulPowerForFp } from '../helpers/skillFp.mjs';

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
    // Appended to DocumentSheetV2's own window.controls (Configure Sheet/
    // Configure Ownership) - Foundry merges these arrays across the
    // inheritance chain rather than replacing them, so this shows up
    // alongside those in the same "..." header menu next to Copy Document
    // UUID.
    window: {
      controls: [
        {
          icon: 'fa-solid fa-circle-user',
          label: 'SKSK.SheetLabels.ConfigureToken',
          action: 'configureToken',
        },
      ],
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
      openMartialArtsAttacksDialog: SKSKActorSheet.#openMartialArtsAttacksDialog,
      rollMartialArtsAttack: SKSKActorSheet.#rollMartialArtsAttack,
      rollRegeneration: SKSKActorSheet.#rollRegeneration,
      rollMeditation: SKSKActorSheet.#rollMeditation,
      rollAdrenalin: SKSKActorSheet.#rollAdrenalin,
      grantInspiration: SKSKActorSheet.#grantInspiration,
      rollGrantedInspiration: SKSKActorSheet.#rollGrantedInspiration,
      useMove: SKSKActorSheet.#useMove,
      useDodge: SKSKActorSheet.#useDodge,
      useItem: SKSKActorSheet.#useItem,
      openRestDialog: SKSKActorSheet.#openRestDialog,
      openTrainingDialog: SKSKActorSheet.#openTrainingDialog,
      openMassKillDialog: SKSKActorSheet.#openMassKillDialog,
      openPrayerDialog: SKSKActorSheet.#openPrayerDialog,
      openSummoningDialog: SKSKActorSheet.#openSummoningDialog,
      openTotemDialog: SKSKActorSheet.#openTotemDialog,
      openSourceDialog: SKSKActorSheet.#openSourceDialog,
      openProductionFpDialog: SKSKActorSheet.#openProductionFpDialog,
      openLehrenDialog: SKSKActorSheet.#openLehrenDialog,
      toggleHeaderToolbar: SKSKActorSheet.#toggleHeaderToolbar,
      openTechniqueDialog: SKSKActorSheet.#openTechniqueDialog,
      grantPassivePerceptionFp: SKSKActorSheet.#grantPassivePerceptionFp,
      increaseStatusStack: SKSKActorSheet.#increaseStatusStack,
      decreaseStatusStack: SKSKActorSheet.#decreaseStatusStack,
      applyRestrained: SKSKActorSheet.#applyRestrained,
      toggleStatusEffect: SKSKActorSheet.#toggleStatusEffect,
      addStatusInstance: SKSKActorSheet.#addStatusInstance,
      applyCauterization: SKSKActorSheet.#applyCauterization,
      attemptRestrainedEscape: SKSKActorSheet.#attemptRestrainedEscape,
      toggleIgnoreSpecialBonus: SKSKActorSheet.#toggleIgnoreSpecialBonus,
      editAttributeValue: SKSKActorSheet.#editAttributeValue,
      resetAttributeBonus: SKSKActorSheet.#resetAttributeBonus,
      resetAllAttributeBonuses: SKSKActorSheet.#resetAllAttributeBonuses,
      configureToken: SKSKActorSheet.#configureToken,
      attemptBreakthrough: SKSKActorSheet.#attemptBreakthrough,
      togglePathAbility: SKSKActorSheet.#togglePathAbility,
      openPathAbilityEffect: SKSKActorSheet.#openPathAbilityEffect,
      openBreakthroughEffect: SKSKActorSheet.#openBreakthroughEffect,
      createSoulPath: SKSKActorSheet.#createSoulPath,
      editSoulPath: SKSKActorSheet.#editSoulPath,
      deleteSoulPath: SKSKActorSheet.#deleteSoulPath,
      tradeSoulPower: SKSKActorSheet.#tradeSoulPower,
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
        { id: "abilities", label: "SKSK.SheetLabels.Abilities" },
        { id: "skills", label: "SKSK.SheetLabels.Skills" },
        { id: "spells", label: "SKSK.SheetLabels.Spells" },
        { id: "effects", label: "SKSK.SheetLabels.Effects" },
        // Only rendered/shown once unlocked - see _configureRenderParts/
        // _prepareContext (same soulforce level 5 / soulPowerResourceEnabled
        // condition already used for the Soul Power resource itself).
        { id: "soulPath", label: "SKSK.SoulPath.TabLabel" },
        { id: "gm", label: "SKSK.SheetLabels.GM" },
      ],
      initial: "general",
    },
    // Sub-tabs shown inside the Soul Path tab, one per progression stage -
    // hardcoded rather than derived from CONFIG.SKSK for the same reason as
    // skillCategories/spellSimpleSchools above (static fields evaluate
    // before CONFIG.SKSK is populated).
    soulPathStages: {
      tabs: [
        { id: "sammlung", label: "SKSK.SoulPath.Stage.Sammlung" },
        { id: "staerkung", label: "SKSK.SoulPath.Stage.Staerkung" },
        { id: "kristallisierung", label: "SKSK.SoulPath.Stage.Kristallisierung" },
        { id: "erwachen", label: "SKSK.SoulPath.Stage.Erwachen" },
        { id: "aufstieg", label: "SKSK.SoulPath.Stage.Aufstieg" },
      ],
      initial: "sammlung",
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
    toolbar: {
      template: "systems/sksk/templates/actor/parts/header-toolbar.hbs",
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
    soulPath: {
      template: "systems/sksk/templates/actor/parts/soul-path.hbs",
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
      // The icon toolbar only exists for Characters (see header.hbs's own
      // .header-rest, now relocated there) - the NPC header has nothing
      // worth collapsing into it.
      delete parts.toolbar;
    } else {
      parts.header.template = `systems/sksk/templates/actor/parts/header.hbs`;
      parts.resources.template = `systems/sksk/templates/actor/parts/resources.hbs`;
    }

    // The GM tab holds background information/switches irrelevant to
    // players - not rendered into the DOM at all for non-GM users (see
    // also _prepareContext, which hides its tab-bar button).
    if (!game.user.isGM) delete parts.gm;

    // The Soul Path tab only exists once unlocked - same condition as the
    // Soul Power resource itself (see _prepareGeneral) - not rendered into
    // the DOM at all otherwise (see also _prepareContext, which hides its
    // tab-bar button).
    if (!this.#isSoulPathUnlocked) {
      delete parts.soulPath;
      // If the tab was active and just got revoked (e.g. a GM flips
      // soulPowerResourceEnabled off while the sheet is open), Foundry's
      // own render pipeline tries to restore "soulPath" as the active tab
      // on the freshly-rebuilt DOM and throws since it no longer exists -
      // reset it here, before that pipeline runs, rather than only in
      // _onRender (too late for Foundry's own restoration attempt).
      if (this.tabGroups?.primary === 'soulPath') {
        this.tabGroups.primary = this.constructor.TABS.primary.initial;
      }
    }

    return parts;
  }

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    // Header toolbar toggle - Character-only (see _configureRenderParts,
    // which deletes the "toolbar" PART entirely for NPCs). Foundry's own
    // window.controls array only ever populates the "..." dropdown, never a
    // standalone sibling button, so this button is inserted by hand right
    // before that dropdown's own toggle (this.window.controls - confirmed
    // live to be that exact button element, not the dropdown's contents).
    if (this.actor.type === 'character') {
      const button = document.createElement('button');
      button.type = 'button';
      button.classList.add('header-control', 'icon', 'fa-solid', this.#toolbarCollapsed ? 'fa-arrow-down' : 'fa-arrow-up');
      button.dataset.action = 'toggleHeaderToolbar';
      button.dataset.tooltip = game.i18n.localize('SKSK.General.ToggleToolbar');
      button.setAttribute('aria-label', game.i18n.localize('SKSK.General.ToggleToolbar'));
      this.window.controls?.insertAdjacentElement('beforebegin', button);
    }
    // Minimized-state attribute-roll bar (Character and NPC both) - a row
    // of compact buttons that stays usable while the sheet is minimized
    // (the ordinary attributes side-tab lives inside .window-content,
    // which the minimize collapse hides - see .minimized-attribute-bar in
    // sksk.css). Inserted once here (right after .window-header, i.e. a
    // sibling of .window-content, never hidden by that collapse) rather
    // than as a PART, since it must survive outside .window-content
    // entirely. Uses the exact same roll formula/attributes as attributes.
    // hbs's own rollable label (see helpers/actions.mjs's generic "roll"
    // action, #onRoll below), just icon-only.
    const bar = document.createElement('div');
    bar.classList.add('minimized-attribute-bar');
    for (const [key, attribute] of Object.entries(this.actor.system.attributes ?? {})) {
      const button = document.createElement('a');
      button.classList.add('minimized-attribute-button');
      button.dataset.action = 'roll';
      const rollBonus = this.actor.system.attributeRollBonus?.[key] ?? 0;
      const bonus = `${attribute.unlimitedBonus ? `+${attribute.unlimitedBonus}` : ''}${rollBonus ? `+${rollBonus}` : ''}`;
      button.dataset.roll = `d20+@attributes.${key}.mod${bonus}`;
      button.dataset.rollExcludingSpecial = `d20+@attributes.${key}.modExcludingSpecial${bonus}`;
      button.dataset.attributeKey = key;
      button.dataset.label = attribute.label;
      button.dataset.tooltip = attribute.label;
      button.setAttribute('aria-label', attribute.label);
      const icon = document.createElement('i');
      icon.classList.add('fas', CONFIG.SKSK.attributeIcons[key] ?? 'fa-dice-d20');
      button.appendChild(icon);
      bar.appendChild(button);
    }
    this.window.header?.insertAdjacentElement('afterend', bar);
    return frame;
  }

  /**
   * Whether the Soul Path tab (and the Soul Power resource) should be
   * visible - Seelenstärke reaching its own max level (5), or the GM tab's
   * own soulPowerResourceEnabled switch being on.
   * @type {boolean}
   */
  get #isSoulPathUnlocked() {
    return getActorSkillLevel(this.actor, 'soulforce') >= 5 || this.actor.system.soulPowerResourceEnabled;
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

  /**
   * Whether the header's icon toolbar (the "toolbar" PART, Character-only -
   * see #openRestDialog et al.) is currently collapsed - purely a runtime
   * UI preference, not persisted, so every fresh sheet render starts
   * expanded. Toggled by the frame arrow button added in _renderFrame.
   * @type {boolean}
   */
  #toolbarCollapsed = false;

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
    // Header icon toolbar's own collapsed/expanded state - see #toolbarCollapsed.
    context.toolbarCollapsed = this.#toolbarCollapsed;
    // The GM tab holds background information/switches irrelevant to
    // players - hidden from the tab bar entirely for non-GM users.
    if (!game.user.isGM) delete context.tabs.gm;
    // The Soul Path tab is hidden from the tab bar entirely until unlocked
    // - see #isSoulPathUnlocked.
    if (!this.#isSoulPathUnlocked) delete context.tabs.soulPath;
    context.soulPathStageTabs = Object.values(this._prepareTabs('soulPathStages'));
    context.generalSectionTabs = Object.values(this._prepareTabs('generalSections'));
    context.characterSectionTabs = Object.values(this._prepareTabs('characterSections'));
    context.genderChoices = CONFIG.SKSK.genders;
    // Actions tab's Move dropdown - see helpers/actions.mjs.
    context.movementTypeChoices = CONFIG.SKSK.movementTypes;
    context.genericRollModeChoices = CONFIG.SKSK.genericRollModes;
    // GM tab's attribute-bonus reset list - see helpers/attributeBonuses.mjs.
    context.resolvedAttributeBonuses = getResolvedAttributeBonuses(actor);
    // Actions tab's Weapons/Usable Items containers - a "usable" Item is
    // one that's either Consumable, or Equippable+Equipped+Enchanted (see
    // data/item.mjs#prepareDerivedData's own isUsable) - see helpers/
    // actions.mjs#rollItemUsage.
    context.equippedWeapons = actor.items.filter(i => i.type === 'weapon' && i.system.equipped);
    context.usableItems = actor.items.filter(i => i.type === 'item' && i.system.isUsable);
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
    await this._prepareSoulPath(context);

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
    // adjusts - see helpers/statusEffects.mjs. Rendered as a wrapping grid
    // of chips (see actor-effects.hbs) - rows whose controls need more
    // room are marked "wide" (span the full grid width) and sorted after
    // every regular chip-sized row, so the chip grid stays a solid,
    // unbroken block instead of the wide rows interrupting it wherever
    // they fall in definition order.
    const WIDE_STATUS_EFFECT_KINDS = new Set(['multiInstance', 'cauterization', 'restrained']);
    // The only predefined statuses with an automatic save of their own -
    // see helpers/statusEffects.mjs#handlePoisonTurnStart/checkConcentration/
    // attemptRestrainedEscape - so the only ones a GM can flag to bypass
    // Spezial-Boni on that specific check (system.attributeBonuses' own
    // Modifikator-tier still always applies).
    const IGNORE_SPECIAL_STATUS_IDS = new Set([
      'poisonMild', 'poisonMedium', 'poisonSevere', 'poisonDeadly', 'concentration', 'restrained',
    ]);
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
      } else if (['concentration', 'concealed'].includes(def.id)) {
        // Purely on/off (never multiple stacks), so a slide toggle reads
        // clearer than a +/- stepper - see #toggleStatusEffect.
        row.kind = 'toggle';
        row.active = getStatusStacks(actor, def.id) > 0;
      } else {
        row.kind = 'simple';
        row.stacks = getStatusStacks(actor, def.id);
      }
      row.wide = WIDE_STATUS_EFFECT_KINDS.has(row.kind);
      if (IGNORE_SPECIAL_STATUS_IDS.has(def.id)) {
        const activeEffect = getStatusEffect(actor, def.id);
        if (activeEffect) {
          row.showIgnoreSpecial = true;
          row.ignoreSpecialBonusOnSave = activeEffect.getFlag('sksk', 'ignoreSpecialBonusOnSave') ?? false;
        }
      }
      return row;
    }).sort((a, b) => Number(a.wide) - Number(b.wide));
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

    // Hover tooltip per attribute (attributes.hbs) breaking down its Max,
    // Base/Spezial/Modifikator-Bonus tiers, and "Verbessert X" skill bonus
    // (see helpers/attributes.mjs) - shown on hover instead of inline, to
    // keep the attribute bar compact.
    context.attributeTooltips = {};
    // Whether an attribute's own value/mod display should render in the
    // "has a bonus" blue (same var as skills.hbs' own .skill-bonus - see
    // css/sksk.css) - value only cares about the Spezial tier (the only one
    // that touches "value"); mod cares about either tier, since both
    // Spezial and Modifikator ultimately land in "mod". See
    // attributes.hbs's hover-swap to the Base-only baseValue/
    // modExcludingSpecial for the "without Spezial-Boni" view.
    context.attributeBonusFlags = {};
    for (const key of Object.keys(CONFIG.SKSK.attributes)) {
      const label = game.i18n.localize(CONFIG.SKSK.attributes[key]);
      context.attributeTooltips[key] =
        renderBreakdownHtml(`${label} ${game.i18n.localize('SKSK.Breakdown.AttributeMax')}`, getAttributeMaxBreakdown(actor, key))
        + renderBreakdownHtml(`${label} ${game.i18n.localize('SKSK.Breakdown.AttributeBaseBonus')}`, getAttributeBaseBonusBreakdown(actor, key))
        + renderBreakdownHtml(`${label} ${game.i18n.localize('SKSK.Breakdown.AttributeSpecialBonus')}`, getAttributeSpecialBonusBreakdown(actor, key))
        + renderBreakdownHtml(`${label} ${game.i18n.localize('SKSK.Breakdown.AttributeModifierBonus')}`, getAttributeModifierBonusBreakdown(actor, key))
        + renderBreakdownHtml(`${label} ${game.i18n.localize('SKSK.Breakdown.AttributeSkillBonus')}`, getAttributeUnlimitedBonusBreakdown(actor, key));

      const specialBonus = computeSpecialAttributeBonus(actor, key);
      const modifierBonus = computeModifierAttributeBonus(actor, key);
      // rollBonus is a pure Active-Effect-only bonus to just the attribute's
      // own standalone roll button (system.attributeRollBonus.<key>) -
      // deliberately not part of attribute.mod, since mod also feeds skill
      // checks and weapon/spell attribute contributions. Spliced into
      // attributes.hbs's own data-roll/data-roll-excluding-special formula
      // strings, bundled here rather than a separate context map to avoid
      // an extra {{#with}} nesting level in the template.
      context.attributeBonusFlags[key] = {
        value: specialBonus !== 0, mod: specialBonus !== 0 || modifierBonus !== 0,
        rollBonus: actor.system.attributeRollBonus?.[key] ?? 0,
      };
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
          // count (character: entered directly, NPC: formula result) -
          // see helpers/skills.mjs#getSkillStacks.
          row.stacks = getSkillStacks(actor, key);
        } else if (row.isBinary) {
          // See helpers/skills.mjs#isActorSkillUnlocked (character: its own
          // toggle; NPC: formula evaluates to 1).
          row.unlocked = isActorSkillUnlocked(actor, key);
        } else if (isNpc) {
          // The formula computes total points directly; "L" in the
          // formula is replaced with the actor's level, so non-linear
          // scaling (e.g. "L * L") works, not just a flat rate per level.
          row.points = evaluateSkillFormula(row.formula, rollData);
          row.level = getActorSkillLevel(actor, key);
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

    context.passivePerception = computePassivePerception(actor);

    context.favoriteSkills = Object.values(context.skillCategories ?? {})
      .flat()
      .filter(row => row.favorite);

    // Actions tab: Adrenalin/Inspiration rows are hidden individually
    // (each still paired in the same grid row otherwise) until their own
    // skill reaches level 1 - mirrors computeMaxAdrenalinCharges/
    // computeMaxInspirationCharges's own level-1 gate (helpers/
    // generalResources.mjs), checked directly here rather than inferred
    // from the resulting max charges (a very low attribute modifier could
    // theoretically zero that out even at level 1).
    context.hasAdrenalin = getActorSkillLevel(actor, 'adrenalin') >= 1;
    context.hasInspiration = getActorSkillLevel(actor, 'inspiration') >= 1;
    context.hasAdrenalinOrInspiration = context.hasAdrenalin || context.hasInspiration;

    context.generalResources = GENERAL_RESOURCES
      .filter(r => !r.requiredSkill || getActorSkillLevel(actor, r.requiredSkill) >= 1)
      .map(r => ({ key: r.key, label: r.label, value: actor.system[r.key].value, max: actor.system[r.key].max }));

    // Seelenstärke's own "Seelenmacht" (Soul Power) resource - listed among
    // the Additional Resources (general-overview.hbs) rather than the
    // resources sidebar, since (like Barrier) it's unbounded and has no
    // max - shown under the same condition that gates the Soul Path tab
    // itself (see #isSoulPathUnlocked). canTrade shows its own row's
    // trade-in button (helpers/skillFp.mjs#tradeSoulPowerForFp) - a
    // separate condition from the row's own visibility above: trading
    // only ever makes sense below Seelenstärke's own max level (5), once
    // the GM tab's own soulPowerMechanicEnabled switch is on, regardless
    // of *why* the row itself is currently shown.
    if (this.#isSoulPathUnlocked) {
      context.generalResources.push({
        key: 'soulPower', label: 'SKSK.Resource.SoulPower', value: actor.system.soulPower.value, noMax: true,
        canTrade: actor.system.soulPowerMechanicEnabled && getActorSkillLevel(actor, 'soulforce') < 5,
      });
    }
  }

  /**
   * Build the Soul Path tab's data: the bound Item (if any), its icon
   * badges, the visible (unlocked) Path Abilities, and each stage's own
   * "frontier"-filtered Durchbruch list - every already-completed entry
   * (history, read-only) plus at most one more (the next unlocked-but-
   * incomplete entry, carrying its own effective cost/difficulty for the
   * Attempt button) - nothing beyond that is included at all, per the
   * "not shown until reached" design (see helpers/soulPathRolls.mjs#
   * isBreakthroughUnlocked). context.soulPathItem is always resolved (the
   * GM tab's own bind/edit/delete section needs it regardless of whether
   * the Soul Path tab itself is currently unlocked) - only the tab's own
   * richer context (icons/abilities/stage entries) is skipped while locked.
   * @param {Object} context
   * @return {Promise<undefined>}
   */
  async _prepareSoulPath(context) {
    const actor = this.actor;
    const item = getSoulPathItem(actor);
    context.soulPathItem = item;
    if (!item || !this.#isSoulPathUnlocked) return;

    context.soulPathDescriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      item.system.description ?? '', { relativeTo: item, secrets: item.isOwner }
    );

    context.soulPathTypeIcon = CONFIG.SKSK.pathTypeIcons[item.system.pathType];
    context.soulPathElementIcons = (item.system.elements ?? [])
      .map(key => CONFIG.SKSK.pathElementIcons[key])
      .filter(Boolean);

    context.visiblePathAbilities = (item.system.pathAbilities ?? [])
      .map((entry, index) => ({ entry, index }))
      .filter(({ index }) => isPathAbilityVisible(item, index))
      .map(({ entry, index }) => ({
        ...entry, index,
        statusLabel: getPathAbilityStatusLabel(entry),
        actionLabel: getPathAbilityActionLabel(entry),
      }));

    context.soulPathStageEntries = {};
    for (const stageKey of Object.keys(CONFIG.SKSK.soulPathStages)) {
      const stage = item.system[stageKey] ?? [];
      const rows = [];
      for (let index = 0; index < stage.length; index++) {
        const entry = stage[index];
        const completedAtLeastOnce = (entry.completedCount ?? 0) >= 1;
        if (completedAtLeastOnce) {
          rows.push({ ...entry, index, completedAtLeastOnce, attemptable: false });
          continue;
        }
        if (isBreakthroughUnlocked(item, stageKey, index)) {
          const { cost, difficulty } = getBreakthroughEffectiveValues(item, stageKey, index);
          rows.push({
            ...entry, index, completedAtLeastOnce,
            attemptable: isBreakthroughAttemptable(item, stageKey, index),
            effectiveCost: cost, effectiveDifficulty: difficulty,
          });
        }
        // The first not-yet-completed entry is the frontier (shown if
        // unlocked, hidden entirely otherwise) - nothing past it can be
        // reachable yet, so stop here regardless.
        break;
      }
      context.soulPathStageEntries[stageKey] = rows;
    }
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
   * Barrier/Life/Negative Life/Mana/AP/RP's value inputs (resources.hbs/
   * resources-npc.hbs) accept "+N"/"-N" to adjust the CURRENT value by
   * that amount, in addition to a plain absolute number - CLAMPED_RESOURCE_
   * KEYS members always clamp to [0, the field's own computed max], while
   * Barrier (no max of its own - see #normalizeBarrierInput) only floors at
   * 0. Rewrites the input's own value in place before the pending
   * submitOnChange form submission fires, so the corrected number is what
   * actually gets saved - mirrors #enforceElementExclusivity below.
   * Barrier, Life and Mana additionally cascade their own overflow into a
   * sibling resource's input rather than just discarding it at the 0 floor
   * - see #spillBarrierOverflow/#spillLifeOverflow/#spillManaOverflow,
   * mirroring helpers/statusEffects.mjs#applyLifeChange/#payManaCost's own
   * cascade for non-manual damage/Mana-cost sources (turn-start effects,
   * Spell casts, ...) - Barrier itself has no such non-manual source today,
   * this input is the only place its own overflow can occur.
   * @param {HTMLElement} target
   */
  #normalizeResourceInput(target) {
    const match = target?.name?.match(/^system\.(\w+)\.value$/);
    if (!match) return;
    const [, key] = match;
    if (key === 'barrier') return this.#normalizeBarrierInput(target);
    if (!CLAMPED_RESOURCE_KEYS.includes(key)) return;

    const resource = this.actor.system[key];
    const raw = target.value.trim();

    let next;
    if (/^[+-]\d+$/.test(raw)) next = resource.value + Number(raw);
    else {
      const parsed = Number(raw);
      next = Number.isFinite(parsed) ? parsed : resource.value;
    }

    if (key === 'life' && next < 0) return this.#spillLifeOverflow(target, -next);
    if (key === 'mana' && next < 0) return this.#spillManaOverflow(target, -next);

    target.value = String(Math.max(0, Math.min(next, resource.max)));
  }

  /**
   * Barrier's own value input - unlike CLAMPED_RESOURCE_KEYS, it has no max
   * of its own (theoretically unbounded), but still accepts "+N"/"-N" the
   * same way, and dropping it below 0 spills the leftover onto Life instead
   * of discarding it - see #spillBarrierOverflow.
   * @param {HTMLElement} target
   */
  #normalizeBarrierInput(target) {
    const barrier = this.actor.system.barrier;
    const raw = target.value.trim();

    let next;
    if (/^[+-]\d+$/.test(raw)) next = barrier.value + Number(raw);
    else {
      const parsed = Number(raw);
      next = Number.isFinite(parsed) ? parsed : barrier.value;
    }

    if (next < 0) return this.#spillBarrierOverflow(target, -next);
    target.value = String(Math.max(0, next));
  }

  /**
   * Drains `overflow` from Life (looked up on the same pending form),
   * cascading further into Negative Life via #spillLifeOverflow if Life
   * itself can't fully absorb it - shared by #spillManaOverflow and
   * #spillBarrierOverflow, the two resources that drain into Life once
   * they're spent.
   * @param {HTMLFormElement|null|undefined} form
   * @param {number} overflow   Positive magnitude the caller's own resource
   *   couldn't absorb.
   */
  #spillIntoLife(form, overflow) {
    const lifeInput = form?.querySelector('[name="system.life.value"]');
    if (!lifeInput) return;
    const newLife = this.actor.system.life.value - overflow;
    if (newLife < 0) this.#spillLifeOverflow(lifeInput, -newLife);
    else lifeInput.value = String(newLife);
  }

  /**
   * Life dropping below 0 via its own value input drains the leftover from
   * Negative Life instead of discarding it - mirrors helpers/
   * statusEffects.mjs#applyLifeChange's own overflow handling (entering
   * Negative Life fresh - Life was still above 0 before this change -
   * starts that buffer at its own max; a further drop while already at 0
   * Life continues draining whatever's left, see the same function).
   * Rewrites Negative Life's own sibling input in place (rather than a
   * separate actor.update() call) so both land in the one pending form
   * submission this change event already triggers.
   * @param {HTMLElement} lifeInput
   * @param {number} overflow   Positive magnitude Life itself couldn't absorb.
   */
  #spillLifeOverflow(lifeInput, overflow) {
    lifeInput.value = '0';
    const negLifeInput = lifeInput.form?.querySelector('[name="system.negativeLife.value"]');
    if (!negLifeInput) return;
    const negativeLife = this.actor.system.negativeLife;
    const startingValue = this.actor.system.life.value > 0 ? negativeLife.max : negativeLife.value;
    negLifeInput.value = String(Math.max(0, startingValue - overflow));
  }

  /**
   * Mana dropping below 0 via its own value input drains the leftover from
   * Life instead - mirrors helpers/statusEffects.mjs#payManaCost's own
   * deficit-from-Life cascade for non-manual Mana costs (e.g. casting a
   * Spell); further overflow past 0 Life continues on into Negative Life
   * via #spillLifeOverflow, same as any other source of Life damage.
   * @param {HTMLElement} manaInput
   * @param {number} overflow   Positive magnitude Mana itself couldn't absorb.
   */
  #spillManaOverflow(manaInput, overflow) {
    manaInput.value = '0';
    this.#spillIntoLife(manaInput.form, overflow);
  }

  /**
   * Barrier dropping below 0 via its own value input drains the leftover
   * from Life instead - same #spillIntoLife cascade #spillManaOverflow
   * uses, continuing on into Negative Life via #spillLifeOverflow if Life
   * itself also overflows.
   * @param {HTMLElement} barrierInput
   * @param {number} overflow   Positive magnitude Barrier itself couldn't absorb.
   */
  #spillBarrierOverflow(barrierInput, overflow) {
    barrierInput.value = '0';
    this.#spillIntoLife(barrierInput.form, overflow);
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
      'soulPathStages',
    ]) {
      const active = this.tabGroups?.[group] ?? this.constructor.TABS[group].initial;
      if (active && this.element.querySelector(`.tab[data-group="${group}"][data-tab="${active}"]`)) {
        this.changeTab(active, group, { force: true, updatePosition: false });
      }
    }

    // Drag events for macros. A draggable row otherwise hijacks click-drag
    // gestures that start inside a nested field, breaking native text
    // selection (e.g. dragging across a skill's points value selects
    // nothing, it drags the whole row instead). The dragstart event's own
    // target is always the draggable row itself (not whatever the pointer
    // was actually over), so the real origin has to be captured separately
    // on mousedown, before the browser decides to start a native drag.
    if (this.actor.isOwner) {
      const itemElements = this.element.querySelectorAll('li.item');
      for (const li of itemElements) {
        if (li.classList.contains('inventory-header')) continue;
        li.setAttribute('draggable', true);
        li.addEventListener('mousedown', (ev) => {
          li.dataset.dragBlocked = ev.target.closest('input, textarea, select') ? 'true' : '';
        });
        li.addEventListener('dragstart', (ev) => {
          if (li.dataset.dragBlocked === 'true') {
            ev.preventDefault();
            return;
          }
          this._onDragStart(ev);
        }, false);
      }
    }

    // Bind drop handling so existing Items (of any type) can be dragged
    // onto this sheet from the sidebar, a compendium, or another sheet.
    this.#dragDrop.forEach(d => d.bind(this.element));

    // Attribute value edit-in-place (attributes.hbs) - revert to the
    // computed display on blur, and treat Enter the same way (plain text
    // inputs don't blur on Enter by themselves) - see #editAttributeValue.
    for (const input of this.element.querySelectorAll('.attribute-value-input')) {
      input.addEventListener('blur', () => {
        input.closest('.attribute-box-wrapper')?.classList.remove('editing');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        input.blur();
      });
    }

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

    // Inspiration button's own Right-Click variant (spend a charge, roll
    // the die for yourself) - ApplicationV2's own action map only ever
    // dispatches "click", so this needs its own listener; suppresses the
    // browser's native context menu. See helpers/inspiration.mjs#
    // rollOwnInspirationDie.
    this.element.querySelector('[data-action="grantInspiration"]')?.addEventListener('contextmenu', async event => {
      event.preventDefault();
      await rollOwnInspirationDie(this.actor);
    });

    // Ctrl+Right-click on an attribute value/mod box, a resource field/AC/MR
    // display, or a skill row copies that field's own Foundry Active Effect
    // "Attribute Key" (e.g. "system.attributeBonuses.str.special") to the
    // clipboard - see helpers/effectKeyReference.mjs. Delegated (one
    // listener for every [data-effect-key] element, rather than one per
    // element like the attribute-value-input blur/keydown above) since many
    // elements carry this attribute. A plain right-click still opens
    // Foundry's own context menu untouched.
    this.element.addEventListener('contextmenu', async event => {
      if (!event.ctrlKey) return;
      const target = event.target.closest('[data-effect-key]');
      if (!target) return;
      event.preventDefault();
      await copyEffectKeyToClipboard(target.dataset.effectKey);
    });
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

    // At most one Soul Path per actor - reject a second rather than
    // silently replacing (or duplicating) the GM's already-authored one.
    if (item.type === 'soulPath' && getSoulPathItem(this.actor)) {
      return ui.notifications.warn(game.i18n.localize('SKSK.SoulPath.AlreadyHasOne'));
    }

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
   * Open the "Kampfkunstangriffe" (Martial Arts Attacks) dialog (apps/
   * martial-arts-attacks-dialog.mjs) from the GM tab - see data/
   * actor-base.mjs#martialArtsAttacks.
   */
  static #openMartialArtsAttacksDialog(event, target) {
    new SKSKMartialArtsAttacksDialog(this.actor).render(true);
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
   * Actions tab's Inspiration button, plain/Shift+Click - see
   * helpers/inspiration.mjs. Right-Click is handled separately via a
   * "contextmenu" listener bound in _onRender (ApplicationV2's own action
   * map only ever dispatches "click").
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   * @private
   */
  static async #grantInspiration(event, target) {
    if (event.shiftKey) return consumeInspirationCharge(this.actor);
    await grantInspirationDie(this.actor);
  }

  /**
   * Sheet header's Inspiration Die field - rolls (and clears) whatever die
   * this actor currently holds. See helpers/inspiration.mjs#
   * rollGrantedInspirationDie.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   * @private
   */
  static async #rollGrantedInspiration(event, target) {
    await rollGrantedInspirationDie(this.actor);
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
   * Open the Training dialog (helpers/training.mjs) from the sheet
   * header's dumbbell button - Character-only, see header.hbs (the NPC
   * header template has no such button since NPCs don't generate FP).
   */
  static #openTrainingDialog(event, target) {
    new SKSKTrainingDialog(this.actor).render(true);
  }

  /**
   * Open the "Kill Tracking" dialog (apps/mass-kill-dialog.mjs) from the GM
   * tab - covers both a fully manual single-Kill FP grant (independent of
   * the automatic one wired into helpers/damageApplication.mjs#
   * applyDamageFromChat) and Mass Kill FP grants - see helpers/massacre.mjs#
   * grantMassKillFp.
   */
  static #openMassKillDialog(event, target) {
    new SKSKMassKillDialog(this.actor).render(true);
  }

  /**
   * Open the "Gebet" (Prayer) dialog (apps/prayer-dialog.mjs) from the
   * sheet header - Character-only, same convention as #openTrainingDialog.
   */
  static #openPrayerDialog(event, target) {
    new SKSKPrayerDialog(this.actor).render(true);
  }

  /**
   * Open the "Beschwörung" (Summoning) dialog (apps/summoning-dialog.mjs)
   * from the sheet header - Character-only, same convention as
   * #openTrainingDialog/#openPrayerDialog.
   */
  static #openSummoningDialog(event, target) {
    new SKSKSummoningDialog(this.actor).render(true);
  }

  /**
   * Open the "Totem" dialog (apps/totem-dialog.mjs) from the sheet header -
   * Character-only, same convention as #openSummoningDialog.
   */
  static #openTotemDialog(event, target) {
    new SKSKTotemDialog(this.actor).render(true);
  }

  /**
   * Open the "Quelle" (Source) dialog (apps/source-dialog.mjs) from the
   * sheet header - Character-only, same convention as #openTotemDialog.
   */
  static #openSourceDialog(event, target) {
    new SKSKSourceDialog(this.actor).render(true);
  }

  /**
   * Open the "Herstellungs-FP" (Production FP) dialog (apps/production-fp-
   * dialog.mjs) from the sheet header - Character-only, same convention as
   * #openSourceDialog.
   */
  static #openProductionFpDialog(event, target) {
    new SKSKProductionFpDialog(this.actor).render(true);
  }

  /**
   * Open the "Lehren" (Lore) dialog (apps/lehren-dialog.mjs) from the sheet
   * header - Character-only, same convention as #openProductionFpDialog.
   */
  static #openLehrenDialog(event, target) {
    new SKSKLehrenDialog(this.actor).render(true);
  }

  /**
   * Toggle the header icon toolbar's collapsed state (see #toolbarCollapsed)
   * - triggered either from the toolbar's own frame arrow button (see
   * _renderFrame) or, in principle, any other element carrying this same
   * action. Re-renders only the "toolbar" PART (cheap - no need to rebuild
   * the rest of the sheet) and flips the frame button's own icon in place.
   */
  static #toggleHeaderToolbar(event, target) {
    this.#toolbarCollapsed = !this.#toolbarCollapsed;
    this.render({ parts: ['toolbar'] });
    const button = this.window.header?.querySelector('[data-action="toggleHeaderToolbar"]');
    button?.classList.toggle('fa-arrow-up', !this.#toolbarCollapsed);
    button?.classList.toggle('fa-arrow-down', this.#toolbarCollapsed);
  }

  /**
   * Open the "Techniken" (Techniques) dialog (apps/technique-dialog.mjs)
   * from the Actions tab - unlike the header dialogs above, available for
   * both Character and NPC sheets (the Actions tab itself is shared).
   */
  static #openTechniqueDialog(event, target) {
    new SKSKTechniqueDialog(this.actor).render(true);
  }

  /**
   * A Durchbruch's own "Attempt" button - see helpers/soulPathRolls.mjs#
   * attemptBreakthrough.
   * @param {PointerEvent} event
   * @param {HTMLElement} target   Carries data-stage/data-index.
   */
  static async #attemptBreakthrough(event, target) {
    const item = getSoulPathItem(this.actor);
    if (!item) return;
    await attemptBreakthrough(this.actor, item, target.dataset.stage, Number(target.dataset.index));
  }

  /**
   * A Path Ability's own Activate/Deactivate button - see helpers/
   * soulPathRolls.mjs#togglePathAbility.
   * @param {PointerEvent} event
   * @param {HTMLElement} target   Carries data-index.
   */
  static async #togglePathAbility(event, target) {
    const item = getSoulPathItem(this.actor);
    if (!item) return;
    await togglePathAbility(this.actor, item, Number(target.dataset.index));
  }

  /**
   * Open a Path Ability's own linked ActiveEffect in Foundry's native
   * effect config sheet.
   * @param {PointerEvent} event
   * @param {HTMLElement} target   Carries data-index.
   */
  static #openPathAbilityEffect(event, target) {
    const item = getSoulPathItem(this.actor);
    const effectId = item?.system.pathAbilities?.[Number(target.dataset.index)]?.effectId;
    const effect = effectId ? this.actor.effects.get(effectId) : null;
    if (!effect) return ui.notifications.warn(game.i18n.localize('SKSK.SoulPath.NoEffectYet'));
    effect.sheet.render(true);
  }

  /**
   * Open a Durchbruch's own linked ActiveEffect in Foundry's native effect
   * config sheet.
   * @param {PointerEvent} event
   * @param {HTMLElement} target   Carries data-stage/data-index.
   */
  static #openBreakthroughEffect(event, target) {
    const item = getSoulPathItem(this.actor);
    const effectId = item?.system[target.dataset.stage]?.[Number(target.dataset.index)]?.effectId;
    const effect = effectId ? this.actor.effects.get(effectId) : null;
    if (!effect) return ui.notifications.warn(game.i18n.localize('SKSK.SoulPath.NoEffectYet'));
    effect.sheet.render(true);
  }

  /**
   * GM tab's "Create Soul Path" button - guarded against a second one
   * (only one Soul Path Item is ever expected per actor).
   */
  static async #createSoulPath(event, target) {
    if (getSoulPathItem(this.actor)) return;
    await Item.create({ name: game.i18n.localize('SKSK.SoulPath.SectionTitle'), type: 'soulPath' }, { parent: this.actor });
  }

  /**
   * GM tab's "Edit" button for the bound Soul Path.
   */
  static #editSoulPath(event, target) {
    getSoulPathItem(this.actor)?.sheet.render(true);
  }

  /**
   * GM tab's "Delete" button for the bound Soul Path - also cleans up
   * every per-entry ActiveEffect it created (Path Abilities and every
   * stage's own Durchbrüche), since deleting the Item itself doesn't
   * touch the actor-level effects it's merely linked to by id.
   */
  static async #deleteSoulPath(event, target) {
    const item = getSoulPathItem(this.actor);
    if (!item) return;
    const effectIds = [
      ...(item.system.pathAbilities ?? []).map(a => a.effectId),
      ...Object.keys(CONFIG.SKSK.soulPathStages).flatMap(stageKey => (item.system[stageKey] ?? []).map(e => e.effectId)),
    ].filter(Boolean);
    if (effectIds.length) await this.actor.deleteEmbeddedDocuments('ActiveEffect', effectIds);
    await item.delete();
  }

  /**
   * The Additional Resources list's own Soul Power row trade-in button -
   * see helpers/skillFp.mjs#tradeSoulPowerForFp. Warns instead of posting
   * a chat card when there's nothing to trade or the GM hasn't configured
   * a soulPowerTraded rate yet (see apps/skill-usage-fp-config.mjs).
   */
  static async #tradeSoulPower(event, target) {
    const actor = this.actor;
    const spent = actor.system.soulPower.value;
    if (spent <= 0) {
      return ui.notifications.warn(game.i18n.localize('SKSK.Resource.SoulPowerTradeEmpty'));
    }
    const grant = await tradeSoulPowerForFp(actor);
    if (!grant) return ui.notifications.warn(game.i18n.localize('SKSK.Resource.SoulPowerTradeNoRate'));
    const description = game.i18n.format('SKSK.Resource.SoulPowerTradeDescription', { name: actor.name, amount: spent });
    await postActionChatCard(actor, game.i18n.localize('SKSK.Resource.SoulPowerTradeCardTitle'), null, 0, `<div class="sksk-roll-description">${description}</div>`);
  }

  /**
   * Grant Observation's "passiveDetection" FP from the sheet header's
   * Passive Perception field - a flat, freely repeatable grant (same
   * pattern as the Kill dialog's own confirm), no dialog needed since
   * there's nothing to choose.
   */
  static async #grantPassivePerceptionFp(event, target) {
    const grant = await grantSkillUsageFp(this.actor, 'observation', 'passiveDetection');
    if (!grant) return;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.General.PassivePerception'), null, 0, formatSkillFpGrantLine(grant));
  }

  /**
   * Open this actor's Prototype Token configuration directly from the
   * sheet, without needing a placed token on a scene first - added via
   * DEFAULT_OPTIONS.window.controls to the sheet's "..." header menu.
   */
  static #configureToken(event, target) {
    new CONFIG.Token.prototypeSheetClass({ prototype: this.actor.prototypeToken }).render(true);
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
   * Restrained's own "+1" control, in place of the generic +/- stepper
   * every other simple status effect uses (see actor-effects.hbs's
   * "restrained" row kind) - Restrained is genuinely binary (present or
   * not, never multiple stacks), and its own config (Befreiungs-SG/
   * Check-Zeitpunkt/AP-Kosten) must be saved together with activation via
   * helpers/statusEffects.mjs#setRestrainedConfig (which this shares with
   * the change-listener wired in _onRender, for editing an ALREADY-active
   * instance's own config afterward), reading whatever this row's own
   * config inputs currently show (defaults, if untouched). Using the
   * generic increaseStatusStacks here (as this row's own "-1" button
   * still correctly does, for removal - see #decreaseStatusStack) would
   * create the effect with only a stacks flag - no dc/timing/apCost -
   * silently breaking every one of its own automatic checks, since they
   * all read those flags directly and treat a missing "timing" as never
   * matching "start"/"end".
   */
  static async #applyRestrained(event, target) {
    const row = target.closest('.status-effect-row');
    if (!row) return;
    await setRestrainedConfig(this.actor, {
      dc: row.querySelector('.restrained-dc-input')?.value,
      timing: row.querySelector('.restrained-timing-select')?.value,
      apCost: row.querySelector('.restrained-apcost-input')?.value,
    });
  }

  /**
   * Flip whether this specific status instance's own automatic save (Poison
   * recheck/Concentration check/Restrained escape) bypasses Spezial-Boni -
   * see helpers/statusEffects.mjs#setStatusIgnoreSpecialBonus.
   */
  static async #toggleIgnoreSpecialBonus(event, target) {
    await setStatusIgnoreSpecialBonus(this.actor, target.dataset.statusId, target.checked);
  }

  /**
   * Reveal an attribute's raw editable input in place of its computed
   * display (attributes.hbs's "attribute-value-display"/"attribute-value-
   * input" pair) - the input reverts to the display on blur/Enter (see the
   * listener bound in _onRender), whether or not the value actually
   * changed (a real change also triggers a full re-render via submitOnChange,
   * which resets to the display state on its own - this just avoids a
   * flash of the stale input in the no-change case).
   */
  static #editAttributeValue(event, target) {
    const wrapper = target.closest('.attribute-box-wrapper');
    if (!wrapper) return;
    wrapper.classList.add('editing');
    const input = wrapper.querySelector('.attribute-value-input');
    input?.focus();
    input?.select();
  }

  /**
   * Flip a purely on/off status effect (Concentration/Concealed) between
   * 0 and 1 stack - the Effects tab's slide toggle, in place of the
   * usual +/- stepper (see actor-effects.hbs's "toggle" row kind).
   */
  static async #toggleStatusEffect(event, target) {
    const id = target.dataset.statusId;
    await setStatusStacks(this.actor, id, getStatusStacks(this.actor, id) > 0 ? 0 : 1);
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
    // Shift+click excludes Spezial-Boni from this escape check - see
    // helpers/statusEffects.mjs#attemptRestrainedEscapeManual.
    await attemptRestrainedEscapeManual(this.actor, event.shiftKey);
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
   * Handle clickable rolls - Shift+clicking a spell prompts to Überladen
   * (Overcharge) it first (see helpers/spell-rolls.mjs#
   * chooseOverchargeCount), skipped entirely if this actor is already
   * mid-cast (same condition rollSpellItem itself guards on) to avoid
   * popping the dialog pointlessly. A plain click, or Shift+click on any
   * non-spell item, behaves exactly as before.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element.
   * @private
   */
  static async #onRoll(event, target) {
    event.preventDefault();
    const dataset = target.dataset;

    // Handle item rolls.
    if (dataset.rollType) {
      if (dataset.rollType == 'item') {
        const itemId = target.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        if (event.shiftKey && item.type === 'spell') {
          const pendingSpell = this.actor.system.pendingSpell;
          if ((pendingSpell?.apCost ?? 0) > 0 || (pendingSpell?.roundsRemaining ?? 0) > 0) {
            return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.AlreadyConcentrating'));
          }
          const count = await chooseOverchargeCount(this.actor, item);
          if (!count) return;
          return item.roll(count);
        }

        return item.roll();
      }
    }

    // Handle rolls that supply the formula directly - attribute checks
    // (attributes.hbs) carry their own attribute key too, so Exhaustion's
    // universal D20 malus and Dazed's Str/Dex/Con/App-specific one (see
    // helpers/statusEffects.mjs) can be folded in.
    if (dataset.roll) {
      const mode = await chooseGenericRollMode();
      if (!mode) return;

      let label = dataset.label ? `[attribute] ${dataset.label}` : '';
      // Shift+click excludes Spezial-Boni for this one roll (see
      // data-roll-excluding-special in attributes.hbs) - Modifikator-Boni
      // still apply, only the "value"-inflating tier is skipped.
      const rollFormula = (event.shiftKey && dataset.rollExcludingSpecial) ? dataset.rollExcludingSpecial : dataset.roll;
      const formula = applyD20Malus(rollFormula, this.actor, dataset.attributeKey ?? null);
      const result = await evaluateD20WithMode(formula, this.actor.getRollData(), mode);
      const { roll, criticalType, doubleCritical } = result;

      // A pure attribute roll (not a skill check) generates FP for that
      // attribute's own "Unbegrenzte X" skill, if configured - see
      // helpers/skillFp.mjs and CONFIG.SKSK.unlimitedAttributeSkills.
      let fpHTML = '';
      const unlimitedSkill = dataset.attributeKey ? CONFIG.SKSK.unlimitedAttributeSkills[dataset.attributeKey] : null;
      if (unlimitedSkill) {
        fpHTML = formatSkillFpGrantLine(await grantSkillUsageFp(this.actor, unlimitedSkill, 'attributeRoll'));
      }
      fpHTML += formatD20ModeSummaryLine(result, mode);
      // Luck's own "criticalRoll"/"doubleCriticalRoll" FP - any generic (non-
      // Angriffswurf) D20 roll's critical success/double critical, see
      // helpers/criticalRolls.mjs#evaluateD20WithMode.
      if (criticalType === 'success') {
        fpHTML += formatSkillFpGrantLine(await grantSkillUsageFp(this.actor, 'luck', 'criticalRoll'));
      }
      if (doubleCritical) {
        fpHTML += formatSkillFpGrantLine(await grantSkillUsageFp(this.actor, 'luck', 'doubleCriticalRoll'));
      }

      const messageData = {
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: label,
        content: `<div class="sksk-chat-card sksk-action-card">${formatRollCardHeading(dataset.label ?? label)}${wrapCriticalBlock(await roll.render(), criticalType)}${fpHTML}</div>`,
        rolls: [roll],
      };
      ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
      return ChatMessage.create(messageData);
    }
  }

  /**
   * Handle clicking a skill (skills.hbs' name, or general-overview.hbs'
   * favorited skill row) to roll its skill check: 1d20 + skill level +
   * attribute modifier(s). Some skills (see helpers/skillRolls.mjs#
   * SKILL_ROLL_VARIANTS) first prompt for which variant of their roll is
   * being made (e.g. Fallen: setting vs. disarming a trap) - same roll,
   * different flavor/FP trigger; skipped entirely for skills with none
   * defined. Skills with a single fixed attribute then roll immediately.
   * Skills with more than one possible attribute prompt with one button
   * per valid option - clicking a button both makes the choice and rolls
   * with it in the same action, closing the dialog. An "oder" skill
   * (attributeMode "choice") offers one button per individual attribute;
   * an "und/oder" skill ("combine") instead offers one button per
   * non-empty combination of its attributes (each summed together), since
   * the player may want any subset, not just single attributes.
   * @param {PointerEvent} event   The originating click event.
   * @param {HTMLElement} target   The capturing HTML element, carrying data-skill.
   * @private
   */
  static async #rollSkill(event, target) {
    event.preventDefault();
    const skillKey = target.dataset.skill;
    const def = getSkillCheckDefinition(skillKey);
    if (!def) return;

    // Shift+click excludes Spezial-Boni from this roll's attribute
    // modifier(s) - see helpers/skillRolls.mjs#rollSkillCheck.
    const ignoreSpecial = event.shiftKey;

    const { chosen, variant } = await chooseSkillRollVariant(skillKey, def);
    if (!chosen) return;

    const attributes = def.attributes;
    if (attributes.length === 1) {
      return rollSkillCheck(this.actor, skillKey, attributes, variant, ignoreSpecial);
    }

    const isCombine = def.attributeMode === 'combine';
    const options = isCombine ? nonEmptyAttributeSubsets(attributes) : attributes.map(a => [a]);
    const buttons = options.map((option, index) => ({
      action: `option${index}`,
      label: option.map(a => game.i18n.localize(CONFIG.SKSK.attributes[a])).join(' + '),
      callback: () => option,
    }));

    const promptKey = isCombine ? 'SKSK.Skill.CombineAttributePrompt' : 'SKSK.Skill.ChooseAttributePrompt';
    const chosenAttributes = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize(def.label) },
      content: `<p>${game.i18n.localize(promptKey)}</p>`,
      buttons,
      rejectClose: false,
    });
    if (!chosenAttributes?.length) return;
    return rollSkillCheck(this.actor, skillKey, chosenAttributes, variant, ignoreSpecial);
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
