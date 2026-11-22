import {
  rollMartialArtsAttack, rollRegeneration, rollMeditation, promptMultiRoll, rollAdrenalin, useMove, useDodge, useItem,
  useShapeshifting,
} from '../helpers/actions.mjs';
import { getActorSkillLevel, isActorSkillUnlocked, getSkillStacks } from '../helpers/skills.mjs';
import { computeWeaponRangeLabel } from '../helpers/attackRolls.mjs';
import { addHandSwitchInfo, toggleHeldOneHanded } from '../helpers/weaponProperties.mjs';
import { rollSkillFromSheet } from '../helpers/skillRolls.mjs';
import { castSpellFromSheet } from '../helpers/spell-rolls.mjs';
import { decorateSpellForDisplay } from '../helpers/spells.mjs';
import { getActivatableAbilities } from '../helpers/abilityList.mjs';
import { toggleClassSpeciesAbility, toggleTalentAbility } from '../helpers/abilityRolls.mjs';
import { grantInspirationDie, consumeInspirationCharge, rollOwnInspirationDie } from '../helpers/inspiration.mjs';
import { ROLL_DRAGGABLE_SELECTOR, buildRollDragData } from '../helpers/macroRolls.mjs';
import { getBarrierTotal } from '../helpers/barrier.mjs';
import { SKSKTechniqueDialog } from './technique-dialog.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Browser storage key of the window's own preferences (position/size, filter, collapsed sections). */
const PREFS_KEY = 'sksk.actionsDialog';

/** Where each section sits by default: the three zones (left column, right column, full-width bottom). */
const DEFAULT_ZONES = {
  left: ['combat', 'weapons', 'items'],
  right: ['spells', 'abilities', 'skills'],
  bottom: ['misc'],
};

/** Filter chips: the section categories (see the data-category of each section in the template). */
const FILTERS = [
  { key: 'all', label: 'SKSK.ActionsDialog.FilterAll' },
  { key: 'combat', label: 'SKSK.ActionsDialog.Combat' },
  { key: 'magic', label: 'SKSK.ActionsDialog.Magic' },
  { key: 'abilities', label: 'SKSK.Action.Abilities' },
  { key: 'skills', label: 'SKSK.ActionsDialog.Skills' },
  { key: 'misc', label: 'SKSK.ActionsDialog.Misc' },
];

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
  } catch (error) {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    // Browser storage unavailable - the window just doesn't remember anything.
  }
}

/**
 * The "Aktionen" (Actions) window, opened from the first button of an actor
 * sheet's TopBar (and a button on the minimized sheet): every action the actor
 * can take, in two columns without any tab switching - Combat (movement,
 * Martial Arts, Techniques, equipped Weapons, usable Items, Formwandelnd) on
 * the left, Magic (favorite spells), Abilities (activatable ones) and Skills
 * (favorites) on the right, and the rarer Regeneration/Meditation/Adrenalin/
 * Inspiration in a collapsed "Misc" section below. Every entry has the same
 * form - icon, name, costs, state, buttons - the state (active / on cooldown /
 * unavailable) is colour-coded. A chip row filters by category, a search field
 * by name; sections can be collapsed. The AP costs of Regeneration/Meditation/
 * Inspiration sit behind each entry's gear button. A resource bar (Life, Mana,
 * AP, RP, AC, MR) shows on top only while the actor's sheet is minimized
 * (otherwise its sidebar shows those). Size, position, filter and collapsed
 * sections are remembered in the browser. The pen button switches on the layout
 * editing: sections can be dragged between/within the columns and hidden (kept per
 * user in the browser), entries can be dragged within their section and hidden
 * (kept per actor, in its flags) - the main buttons are disabled meanwhile. Its buttons run the very same
 * helpers the sheet's own handlers (and Hotbar macros, see helpers/
 * macroRolls.mjs) use. Auto-refreshes on changes to this actor and its Items.
 */
export class SKSKActionsDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    const prefs = loadPrefs();
    const position = {};
    for (const key of ['left', 'top', 'width', 'height']) {
      if (Number.isFinite(prefs.position?.[key])) position[key] = prefs.position[key];
    }
    super(foundry.utils.mergeObject({ position }, options));
    this.actor = actor;
    this.#filter = FILTERS.some(f => f.key === prefs.filter) ? prefs.filter : 'all';
    // "Misc" starts collapsed until the user opens it once.
    this.#collapsed = new Set(prefs.collapsed ?? ['misc']);
    this.#layout = prefs.layout ?? {};
  }

  /** The selectors' own choices and the UI state, kept over a re-render. */
  #moveType = 'walking';

  #martialArtsIndex = '';

  #filter = 'all';

  #search = '';

  #searchFocused = false;

  #collapsed;

  #openSettings = new Set();

  /** The user's section layout: {zones: {left: [ids], right: [ids], bottom: [ids]}, hiddenSections: [ids]}. */
  #layout = {};

  #editing = false;

  /** The section/entry currently being dragged in the edit mode. */
  #drag = null;

  #sheetObserver = null;

  /** Open the window for an actor - or bring its already open one to the front. */
  static open(actor) {
    const existing = [...foundry.applications.instances.values()]
      .find(app => app instanceof SKSKActionsDialog && app.actor === actor);
    if (existing) {
      existing.bringToFront();
      return existing;
    }
    const dialog = new SKSKActionsDialog(actor);
    dialog.render(true);
    return dialog;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'actions-dialog'],
    window: { icon: 'fas fa-bolt', resizable: true },
    position: { width: 650, height: 640 },
    actions: {
      rollRegeneration: SKSKActionsDialog.#onRollRegeneration,
      rollMeditation: SKSKActionsDialog.#onRollMeditation,
      rollAdrenalin: SKSKActionsDialog.#onRollAdrenalin,
      grantInspiration: SKSKActionsDialog.#onGrantInspiration,
      useMove: SKSKActionsDialog.#onUseMove,
      useDodge: SKSKActionsDialog.#onUseDodge,
      rollMartialArtsAttack: SKSKActionsDialog.#onRollMartialArtsAttack,
      openTechniqueDialog: SKSKActionsDialog.#onOpenTechniqueDialog,
      useItem: SKSKActionsDialog.#onUseItem,
      useShapeshifting: SKSKActionsDialog.#onUseShapeshifting,
      toggleHeldOneHanded: SKSKActionsDialog.#onToggleHeldOneHanded,
      rollSkill: SKSKActionsDialog.#onRollSkill,
      castSpell: SKSKActionsDialog.#onCastSpell,
      toggleClassSpeciesAbility: SKSKActionsDialog.#onToggleClassSpeciesAbility,
      toggleTalentAbility: SKSKActionsDialog.#onToggleTalentAbility,
      toggleSection: SKSKActionsDialog.#onToggleSection,
      setFilter: SKSKActionsDialog.#onSetFilter,
      toggleEntrySettings: SKSKActionsDialog.#onToggleEntrySettings,
      toggleEditMode: SKSKActionsDialog.#onToggleEditMode,
      resetLayout: SKSKActionsDialog.#onResetLayout,
      toggleEntryHidden: SKSKActionsDialog.#onToggleEntryHidden,
      toggleSectionHidden: SKSKActionsDialog.#onToggleSectionHidden,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/actions-dialog.hbs', scrollable: ['.actions-scroll'] },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.SheetLabels.Actions')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    context.system = system;
    context.filters = FILTERS;
    context.canEdit = actor.isOwner;
    context.movementTypeChoices = CONFIG.SKSK.movementTypes;
    context.moveType = this.#moveType;

    // The resource bar (shown only while the sheet is minimized).
    const pool = (key, label) => {
      const value = system[key]?.value ?? 0;
      const max = system[key]?.max ?? 0;
      return { key, label, value, max, pct: max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0 };
    };
    context.resources = [
      pool('life', 'SKSK.Resource.Life'),
      pool('mana', 'SKSK.Resource.Mana'),
      pool('actionPoints', 'SKSK.Spell.APCost'),
      pool('reactionPoints', 'SKSK.Spell.RPCost'),
    ];
    context.defenses = [
      { label: 'SKSK.Resource.AC', value: system.armorClass },
      { label: 'SKSK.Resource.MR', value: system.magicResistance },
    ];
    const barrier = getBarrierTotal(actor);
    if (barrier > 0) context.defenses.push({ label: 'SKSK.Resource.Barrier', value: barrier });

    // Adrenalin/Inspiration only show once their skill is learned - mirrors
    // helpers/generalResources.mjs's own level-1 gate for their charges.
    context.hasAdrenalin = getActorSkillLevel(actor, 'adrenalin') >= 1;
    context.hasInspiration = getActorSkillLevel(actor, 'inspiration') >= 1;
    context.noRegeneration = (system.regenerationCharges?.value ?? 0) <= 0;
    context.noMeditation = (system.meditationCharges?.value ?? 0) <= 0;
    context.noAdrenalin = (system.adrenalinCharges?.value ?? 0) <= 0;
    context.noInspiration = (system.inspirationCharges?.value ?? 0) <= 0;

    // Equipped weapons, each with its range/reach label and hand switch.
    context.equippedWeapons = actor.items.filter(i => i.type === 'weapon' && i.system.equipped);
    context.equippedWeapons.forEach(weapon => {
      weapon.rangeLabel = computeWeaponRangeLabel(weapon, actor);
      addHandSwitchInfo(actor, weapon);
    });
    // A "usable" Item is a Consumable, or an Equippable+Equipped+Enchanted one
    // (data/item.mjs#prepareDerivedData's isUsable).
    context.usableItems = actor.items.filter(i => i.type === 'item' && i.system.isUsable);
    // Formwandelnd: equipped weapons/armor that can change their form.
    context.shapeshiftItems = actor.items.filter(i => (i.type === 'weapon' || i.type === 'armor')
      && i.system.equipped && (i.system.effectiveProperties ?? []).some(p => p.property === 'shapeshifting'));

    context.favoriteSkills = this.#getFavoriteSkills();
    context.favoriteSpells = this.#getFavoriteSpells();
    context.abilities = getActivatableAbilities(actor);
    return context;
  }

  /**
   * The actor's favorite skills (see the star in the Skills tab): label, whether
   * it has a skill check to roll, and its level display.
   * @return {object[]}
   */
  #getFavoriteSkills() {
    const actor = this.actor;
    const rows = [];
    for (const categorySkills of Object.values(CONFIG.SKSK.skills)) {
      for (const [key, def] of Object.entries(categorySkills)) {
        if (!actor.system.skills?.[key]?.favorite) continue;
        const row = { key, label: def.label, rollable: !!def.attributes?.length, maxLevel: def.maxLevel };
        if (def.stackable) row.display = String(getSkillStacks(actor, key));
        else if (def.maxLevel === 1) row.display = isActorSkillUnlocked(actor, key) ? '✓' : '–';
        else row.display = `${getActorSkillLevel(actor, key)} / ${def.maxLevel}`;
        rows.push(row);
      }
    }
    return rows;
  }

  /**
   * The actor's favorite spells (see the star in the Spells tab), sorted by
   * level then name, with the same cost/castable data the Spells tab shows.
   * @return {Item[]}
   */
  #getFavoriteSpells() {
    const spells = this.actor.items.filter(i => i.type === 'spell' && i.system.favorite
      && !foundry.utils.getProperty(i, 'flags.sksk.abilitySpell'));
    spells.forEach(spell => decorateSpellForDisplay(spell, this.actor));
    return spells.sort((a, b) => ((a.system.spellLevel ?? 1) - (b.system.spellLevel ?? 1)) || a.name.localeCompare(b.name));
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const refreshIfOwnItem = item => {
      if (item.parent?.id === this.actor.id) this.render();
    };
    const refreshIfThisActor = actor => {
      if (actor.id === this.actor.id) this.render();
    };
    // The resource bar follows the actor sheet's minimized state, which has no event of its own.
    const resyncIfActorSheet = app => {
      if (app === this.actor.sheet) this.#observeSheet();
    };
    this._actionsHooks = [
      { hook: 'updateItem', id: Hooks.on('updateItem', refreshIfOwnItem) },
      { hook: 'createItem', id: Hooks.on('createItem', refreshIfOwnItem) },
      { hook: 'deleteItem', id: Hooks.on('deleteItem', refreshIfOwnItem) },
      { hook: 'updateActor', id: Hooks.on('updateActor', refreshIfThisActor) },
      { hook: 'renderApplicationV2', id: Hooks.on('renderApplicationV2', resyncIfActorSheet) },
      { hook: 'closeApplicationV2', id: Hooks.on('closeApplicationV2', resyncIfActorSheet) },
    ];
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    for (const { hook, id } of this._actionsHooks ?? []) Hooks.off(hook, id);
    this._actionsHooks = [];
    this.#sheetObserver?.disconnect();
    this.#sheetObserver = null;
  }

  /** @override */
  _onPosition(position) {
    super._onPosition(position);
    // Remember the size and position (an "auto" height isn't a size to remember).
    const saved = {};
    for (const key of ['left', 'top', 'width', 'height']) {
      if (Number.isFinite(position[key])) saved[key] = position[key];
    }
    if (!saved.width) return;
    savePrefs({ ...loadPrefs(), position: saved });
  }

  /**
   * Show the resource bar only while this actor's sheet is open AND minimized.
   * Watches the sheet's own window element, whose "minimized" class flips.
   */
  #observeSheet() {
    this.#sheetObserver?.disconnect();
    this.#sheetObserver = null;
    if (!this.element) return;
    const sheet = this.actor.sheet;
    const sync = () => this.element?.classList.toggle('sheet-minimized', !!(sheet?.rendered && sheet.minimized));
    sync();
    if (!sheet?.rendered || !sheet.element) return;
    this.#sheetObserver = new MutationObserver(sync);
    this.#sheetObserver.observe(sheet.element, { attributes: true, attributeFilter: ['class'] });
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    this.#observeSheet();

    // The actor's own AP-cost fields (system.*) behind each entry's gear - written straight to the actor.
    html.querySelectorAll('input[data-system-field]').forEach(input => {
      input.addEventListener('change', async event => {
        const value = Math.max(0, Math.trunc(Number(event.target.value)) || 0);
        await this.actor.update({ [`system.${event.target.dataset.systemField}`]: value });
      });
    });

    // Remember the selectors' choices over a re-render.
    const attackSelect = html.querySelector('.martial-arts-attack-select');
    if (attackSelect && [...attackSelect.options].some(option => option.value === this.#martialArtsIndex)) {
      attackSelect.value = this.#martialArtsIndex;
    }
    html.querySelector('.move-type-select')?.addEventListener('change', event => {
      this.#moveType = event.target.value;
    });
    attackSelect?.addEventListener('change', event => {
      this.#martialArtsIndex = event.target.value;
    });

    // Search field.
    const search = html.querySelector('.actions-search');
    if (search) {
      search.value = this.#search;
      search.addEventListener('input', event => {
        this.#search = event.target.value;
        this.#applyView();
      });
      search.addEventListener('focus', () => { this.#searchFocused = true; });
      search.addEventListener('blur', () => { this.#searchFocused = false; });
      if (this.#searchFocused) {
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      }
    }

    // Right-click on Inspiration: spend a charge and roll the die for yourself.
    html.querySelector('[data-action="grantInspiration"]')?.addEventListener('contextmenu', async event => {
      event.preventDefault();
      await rollOwnInspirationDie(this.actor);
    });

    // Every roll here can be dragged onto the Hotbar as a macro, like on the
    // sheet itself (helpers/macroRolls.mjs).
    if (this.actor.isOwner) {
      for (const element of html.querySelectorAll(ROLL_DRAGGABLE_SELECTOR)) {
        element.setAttribute('draggable', true);
        element.addEventListener('dragstart', event => {
          event.stopPropagation();
          const dragData = buildRollDragData(this.actor, element);
          if (!dragData) return event.preventDefault();
          event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        });
      }
    }

    this.#applyLayout();
    this.#bindDragAndDrop(html);
    this.#applyView();
  }

  /** The actor's own entry layout (per-section order, hidden entries) - kept in its flags. */
  #actorLayout() {
    return this.actor.getFlag('sksk', 'actionsLayout') ?? {};
  }

  /**
   * Put the sections into the user's zones/order and the entries into the
   * actor's saved order, and mark hidden sections/entries. Anything not in the
   * saved layout (e.g. a newly favorited spell) stays where the template put it -
   * for entries that is the end of their section.
   */
  #applyLayout() {
    const html = this.element;
    for (const [zone, ids] of Object.entries(this.#layout.zones ?? {})) {
      const zoneElement = html.querySelector(`.actions-zone[data-zone="${zone}"]`);
      if (!zoneElement) continue;
      for (const id of ids) {
        const section = html.querySelector(`.actions-section[data-section="${id}"]`);
        if (section) zoneElement.appendChild(section);
      }
    }
    const hiddenSections = new Set(this.#layout.hiddenSections ?? []);
    const actorLayout = this.#actorLayout();
    const hiddenEntries = new Set(actorLayout.hidden ?? []);
    for (const section of html.querySelectorAll('.actions-section')) {
      section.classList.toggle('section-off', hiddenSections.has(section.dataset.section));
      const body = section.querySelector('.actions-section-body');
      const order = actorLayout.order?.[section.dataset.section] ?? [];
      const entries = [...body.querySelectorAll(':scope > .action-entry')];
      const rank = element => {
        const index = order.indexOf(element.dataset.key);
        return index < 0 ? Number.MAX_SAFE_INTEGER : index;
      };
      entries
        .map((element, position) => ({ element, position }))
        .sort((a, b) => (rank(a.element) - rank(b.element)) || (a.position - b.position))
        .forEach(({ element }) => body.appendChild(element));
      entries.forEach(element => element.classList.toggle('entry-off', hiddenEntries.has(element.dataset.key)));
    }
  }

  /**
   * Drag and drop of the edit mode (delegated on the scroll area): a section
   * header can be dropped on another section (before/after it) or on an empty
   * spot of a zone; an entry only onto another entry of the same section.
   * @param {HTMLElement} html
   */
  #bindDragAndDrop(html) {
    const scroll = html.querySelector('.actions-scroll');
    if (!scroll) return;
    const clearMarks = () => html.querySelectorAll('.drop-before, .drop-after, .drop-into')
      .forEach(element => element.classList.remove('drop-before', 'drop-after', 'drop-into'));
    const isAfter = (event, element) => {
      const rect = element.getBoundingClientRect();
      return event.clientY > rect.top + rect.height / 2;
    };

    scroll.addEventListener('dragstart', event => {
      if (!this.#editing) return;
      if (event.target.matches?.('.actions-section-header')) {
        this.#drag = { type: 'section', element: event.target.closest('.actions-section') };
      } else if (event.target.matches?.('.action-entry')) {
        this.#drag = { type: 'entry', element: event.target, section: event.target.closest('.actions-section') };
      } else {
        return;
      }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', 'sksk-actions-layout');
    });

    scroll.addEventListener('dragover', event => {
      const drag = this.#drag;
      if (!drag) return;
      clearMarks();
      if (drag.type === 'section') {
        const target = event.target.closest('.actions-section');
        if (target) {
          if (target === drag.element) return;
          event.preventDefault();
          target.classList.add(isAfter(event, target) ? 'drop-after' : 'drop-before');
          return;
        }
        const zone = event.target.closest('.actions-zone');
        if (zone) {
          event.preventDefault();
          zone.classList.add('drop-into');
        }
      } else {
        const target = event.target.closest('.action-entry');
        if (target && target !== drag.element && target.closest('.actions-section') === drag.section) {
          event.preventDefault();
          target.classList.add(isAfter(event, target) ? 'drop-after' : 'drop-before');
        }
      }
    });

    scroll.addEventListener('drop', async event => {
      const drag = this.#drag;
      if (!drag) return;
      event.preventDefault();
      clearMarks();
      this.#drag = null;
      if (drag.type === 'section') {
        const target = event.target.closest('.actions-section');
        if (target && target !== drag.element) {
          if (isAfter(event, target)) target.after(drag.element);
          else target.before(drag.element);
        } else if (!target) {
          event.target.closest('.actions-zone')?.appendChild(drag.element);
        } else {
          return;
        }
        this.#saveSectionLayout();
        this.#applyView();
      } else {
        const target = event.target.closest('.action-entry');
        if (!target || target === drag.element || target.closest('.actions-section') !== drag.section) return;
        if (isAfter(event, target)) target.after(drag.element);
        else target.before(drag.element);
        await this.#saveEntryOrder(drag.section);
      }
    });

    scroll.addEventListener('dragend', () => {
      clearMarks();
      this.#drag = null;
    });
  }

  /** Remember which section sits in which zone, in which order (per user, in the browser). */
  #saveSectionLayout() {
    const zones = {};
    for (const zone of this.element.querySelectorAll('.actions-zone')) {
      zones[zone.dataset.zone] = [...zone.querySelectorAll(':scope > .actions-section')].map(section => section.dataset.section);
    }
    this.#layout = { ...this.#layout, zones };
    this.#savePrefs();
  }

  /** Remember the order of one section's entries (per actor, in its flags). */
  async #saveEntryOrder(section) {
    const keys = [...section.querySelectorAll(':scope > .actions-section-body > .action-entry')]
      .map(entry => entry.dataset.key);
    const current = this.#actorLayout();
    await this.actor.setFlag('sksk', 'actionsLayout', {
      ...current, order: { ...(current.order ?? {}), [section.dataset.section]: keys },
    });
  }

  /**
   * Apply the remembered view state to the freshly rendered DOM: collapsed
   * sections, opened gear settings, the filter chip and the search.
   */
  #applyView() {
    const html = this.element;
    const searching = this.#search.trim().length > 0;
    const needle = this.#search.trim().toLowerCase();
    html.dataset.filter = this.#filter;
    html.classList.toggle('searching', searching);
    html.classList.toggle('editing', this.#editing);
    html.querySelector('[data-action="toggleEditMode"]')?.classList.toggle('active', this.#editing);
    html.querySelectorAll('.actions-section-header, .action-entry').forEach(element => {
      if (this.#editing) element.setAttribute('draggable', 'true');
      else element.removeAttribute('draggable');
    });

    html.querySelectorAll('[data-action="setFilter"]').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === this.#filter);
    });
    html.querySelectorAll('.entry-settings').forEach(box => {
      box.classList.toggle('open', this.#openSettings.has(box.dataset.key));
    });

    for (const section of html.querySelectorAll('.actions-section')) {
      section.classList.toggle('collapsed', this.#collapsed.has(section.dataset.section));
      let visibleEntries = 0;
      for (const entry of section.querySelectorAll('.action-entry')) {
        const text = entry.querySelector('.entry-main')?.textContent.toLowerCase() ?? '';
        const match = !searching || text.includes(needle);
        entry.hidden = !match;
        if (match && (this.#editing || !entry.classList.contains('entry-off'))) visibleEntries++;
      }
      const categoryHidden = this.#filter !== 'all' && section.dataset.category !== this.#filter;
      section.hidden = categoryHidden || (searching && visibleEntries === 0);
    }
    // A zone whose sections are all hidden disappears (so the other column fills the width) - except while editing, when every zone is a drop target.
    const isShown = section => !section.hidden && (this.#editing || !section.classList.contains('section-off'));
    for (const zone of html.querySelectorAll('.actions-zone')) {
      zone.hidden = !this.#editing && ![...zone.querySelectorAll(':scope > .actions-section')].some(isShown);
    }
    const noResults = ![...html.querySelectorAll('.actions-section')].some(isShown);
    html.querySelector('.actions-no-results')?.toggleAttribute('hidden', !(noResults && searching));
  }

  /** Persist the filter and the collapsed sections. */
  #savePrefs() {
    savePrefs({ ...loadPrefs(), filter: this.#filter, collapsed: [...this.#collapsed], layout: this.#layout });
  }

  static #onToggleSection(event, target) {
    const key = target.closest('.actions-section')?.dataset.section;
    if (!key) return;
    if (this.#collapsed.has(key)) this.#collapsed.delete(key);
    else this.#collapsed.add(key);
    this.#savePrefs();
    this.#applyView();
  }

  static #onSetFilter(event, target) {
    this.#filter = target.dataset.filter;
    this.#savePrefs();
    this.#applyView();
  }

  static #onToggleEditMode(event, target) {
    this.#editing = !this.#editing;
    this.#applyView();
  }

  /** Back to the default layout: sections of this user and the entry order/hidden entries of this actor. */
  static async #onResetLayout(event, target) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('SKSK.ActionsDialog.ResetLayout') },
      content: `<p>${game.i18n.localize('SKSK.ActionsDialog.ResetLayoutConfirm')}</p>`,
      rejectClose: false,
    });
    if (!confirmed) return;
    this.#layout = {};
    this.#savePrefs();
    await this.actor.unsetFlag('sksk', 'actionsLayout');
    this.render();
  }

  static async #onToggleEntryHidden(event, target) {
    const key = target.closest('.action-entry')?.dataset.key;
    if (!key) return;
    const current = this.#actorLayout();
    const hidden = new Set(current.hidden ?? []);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    await this.actor.setFlag('sksk', 'actionsLayout', { ...current, hidden: [...hidden] });
  }

  static #onToggleSectionHidden(event, target) {
    event.stopPropagation();
    const id = target.closest('.actions-section')?.dataset.section;
    if (!id) return;
    const hidden = new Set(this.#layout.hiddenSections ?? []);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    this.#layout = { ...this.#layout, hiddenSections: [...hidden] };
    this.#savePrefs();
    this.#applyLayout();
    this.#applyView();
  }

  static #onToggleEntrySettings(event, target) {
    const key = target.dataset.key;
    if (this.#openSettings.has(key)) this.#openSettings.delete(key);
    else this.#openSettings.add(key);
    this.#applyView();
  }

  static async #onRollRegeneration(event, target) {
    // Shift+click: roll several at once - see helpers/actions.mjs#promptMultiRoll.
    if (event.shiftKey) {
      const options = await promptMultiRoll(this.actor, 'regeneration');
      if (!options) return;
      return rollRegeneration(this.actor, options);
    }
    await rollRegeneration(this.actor);
  }

  static async #onRollMeditation(event, target) {
    if (event.shiftKey) {
      const options = await promptMultiRoll(this.actor, 'meditation');
      if (!options) return;
      return rollMeditation(this.actor, options);
    }
    await rollMeditation(this.actor);
  }

  static async #onRollAdrenalin(event, target) {
    await rollAdrenalin(this.actor);
  }

  static async #onGrantInspiration(event, target) {
    if (event.shiftKey) return consumeInspirationCharge(this.actor);
    await grantInspirationDie(this.actor);
  }

  static async #onUseMove(event, target) {
    const movementType = target.closest('.action-entry')?.querySelector('.move-type-select')?.value ?? 'walking';
    await useMove(this.actor, movementType);
  }

  static async #onUseDodge(event, target) {
    await useDodge(this.actor);
  }

  static async #onRollMartialArtsAttack(event, target) {
    const select = target.closest('.action-entry')?.querySelector('.martial-arts-attack-select');
    if (!select?.value) return;
    await rollMartialArtsAttack(this.actor, Number(select.value));
  }

  static #onOpenTechniqueDialog(event, target) {
    new SKSKTechniqueDialog(this.actor).render(true);
  }

  static async #onUseItem(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) await useItem(this.actor, item);
  }

  static async #onUseShapeshifting(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) await useShapeshifting(this.actor, item);
  }

  static async #onToggleHeldOneHanded(event, target) {
    await toggleHeldOneHanded(this.actor, this.actor.items.get(target.dataset.itemId));
  }

  static async #onRollSkill(event, target) {
    event.preventDefault();
    await rollSkillFromSheet(this.actor, target.dataset.skill, event.shiftKey);
  }

  static async #onCastSpell(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) await castSpellFromSheet(this.actor, item, event.shiftKey);
  }

  static async #onToggleClassSpeciesAbility(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) await toggleClassSpeciesAbility(this.actor, item, Number(target.dataset.index));
  }

  static async #onToggleTalentAbility(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) await toggleTalentAbility(this.actor, item);
  }
}
