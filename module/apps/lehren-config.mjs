import { getAllLehrenDefinitions } from '../helpers/lehren.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The skill keys shown under a given category tab - every skill in
 * CONFIG.SKSK.skills[categoryKey], except for "attribute" which is narrowed
 * to the 8 "Unbegrenzte X" skills (CONFIG.SKSK.unlimitedAttributeSkills) -
 * same narrowing as apps/skill-usage-fp-config.mjs#getCategorySkills (kept
 * as a separate local copy rather than a shared import, matching this
 * codebase's convention of small per-app helpers).
 * @param {string} categoryKey
 * @return {Array<{key: string, label: string, maxLevel: number}>}
 */
function getCategorySkills(categoryKey) {
  const category = CONFIG.SKSK.skills[categoryKey] ?? {};
  let keys = Object.keys(category);
  if (categoryKey === 'attribute') {
    const mapped = new Set(Object.values(CONFIG.SKSK.unlimitedAttributeSkills));
    keys = keys.filter(key => mapped.has(key));
  }
  return keys.map(key => ({ key, label: category[key].label, maxLevel: category[key].maxLevel ?? 10 }));
}

/**
 * GM-only settings menu app for managing the world's Lehren (Lore) catalog
 * - one expandable list per skill, each Lehre carrying a generic bonus-row
 * list (see helpers/lehren.mjs). A plain world setting (an untyped Object,
 * keyed by skill) has no native config UI, so this provides one, following
 * the same tabbed-by-category layout as apps/skill-usage-fp-config.mjs
 * (same 11 categories - weaknesses/immunity/absorb are deliberately
 * excluded, matching that app's own boundary) and the same add/remove-row
 * pattern used elsewhere against a world setting (see also apps/
 * materials-config.mjs, apps/models-config.mjs).
 */
export class SKSKLehrenConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-lehren-config',
    tag: 'form',
    classes: ['sksk', 'lehren-config'],
    window: {
      title: 'SKSK.Settings.Lehren.Name',
      icon: 'fas fa-book',
    },
    position: { width: 820, height: 680 },
    form: {
      handler: SKSKLehrenConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addLehre: SKSKLehrenConfig.#addLehre,
      removeLehre: SKSKLehrenConfig.#removeLehre,
      addLehreBonus: SKSKLehrenConfig.#addLehreBonus,
      removeLehreBonus: SKSKLehrenConfig.#removeLehreBonus,
    },
  };

  // Hardcoded (rather than derived from CONFIG.SKSK) since static class
  // fields evaluate before the init hook populates CONFIG.SKSK - same 11
  // categories as apps/skill-usage-fp-config.mjs's own TABS.
  static TABS = {
    primary: {
      tabs: [
        { id: 'weapons', label: 'SKSK.SkillCategory.Weapons' },
        { id: 'armors', label: 'SKSK.SkillCategory.Armors' },
        { id: 'production', label: 'SKSK.SkillCategory.Production' },
        { id: 'rogue', label: 'SKSK.SkillCategory.Rogue' },
        { id: 'magicSchools', label: 'SKSK.SkillCategory.MagicSchools' },
        { id: 'magic', label: 'SKSK.SkillCategory.Magic' },
        { id: 'fighter', label: 'SKSK.SkillCategory.Fighter' },
        { id: 'misc', label: 'SKSK.SkillCategory.Misc' },
        { id: 'attribute', label: 'SKSK.SkillCategory.Attribute' },
        { id: 'resistances', label: 'SKSK.SkillCategory.Resistances' },
        { id: 'special', label: 'SKSK.SkillCategory.Special' },
      ],
      initial: 'weapons',
    },
  };

  /** @override */
  static PARTS = {
    tabs: { template: 'templates/generic/tab-navigation.hbs' },
    weapons: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    armors: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    production: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    rogue: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    magicSchools: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    magic: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    fighter: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    misc: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    attribute: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    resistances: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
    special: { template: 'systems/sksk/templates/settings/lehren-category.hbs', scrollable: [''] },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tabs = this._prepareTabs('primary');
    context.lehrenBonusTargets = CONFIG.SKSK.lehrenBonusTargets;
    context.lehrenBonusScopes = CONFIG.SKSK.lehrenBonusScopes;
    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    // The "tabs" nav part needs its own tabs as an array (for #each), but
    // every category part below still needs the original by-id object (to
    // look up its own context.tab) - since _renderHTML passes the same
    // context object reference to every part in turn, mutating context.tabs
    // in place here would corrupt it for every part rendered afterward, so
    // this returns a shallow copy instead of overwriting it on context.
    if (partId === 'tabs') {
      return { ...context, tabs: Object.values(context.tabs) };
    }

    const catalog = getAllLehrenDefinitions();
    context.tab = context.tabs[partId];
    context.skills = getCategorySkills(partId).map(skill => ({
      ...skill,
      defs: catalog[skill.key] ?? [],
    }));
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Force-apply the active tab on first render (Foundry only wires up
    // clicks after that, matching the pattern used elsewhere in this app
    // family - see apps/skill-usage-fp-config.mjs).
    const active = this.tabGroups?.primary ?? this.constructor.TABS.primary.initial;
    if (active && this.element.querySelector(`.tab[data-group="primary"][data-tab="${active}"]`)) {
      this.changeTab(active, 'primary', { force: true, updatePosition: false });
    }

    // A bonus row's "scope" field is only meaningful for the attackBonus/
    // damageBonus targets (see helpers/lehren.mjs) - hide it otherwise,
    // both on load and whenever the row's own target select changes.
    const toggleScope = (targetSelect) => {
      const scoped = ['attackBonus', 'damageBonus'].includes(targetSelect.value);
      targetSelect.closest('.lehre-bonus-row')?.querySelector('.lehre-bonus-scope')?.classList.toggle('hidden', !scoped);
    };
    const targetSelects = this.element.querySelectorAll('.lehre-bonus-target');
    for (const select of targetSelects) toggleScope(select);
    this.element.addEventListener('change', (event) => {
      if (event.target.matches('.lehre-bonus-target')) toggleScope(event.target);
    });
  }

  /**
   * Parse the submitted form's flat "lehren.<skillKey>.<index>.<field>"
   * (and nested "...bonuses.<index>.<field>") keys back into the lehren
   * world setting - id is always carried over from the existing stored
   * value (never a form field); new entries get theirs assigned in
   * #addLehre at creation time instead.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const existing = getAllLehrenDefinitions();
    const lehren = {};
    for (const [skillKey, entries] of Object.entries(expanded.lehren ?? {})) {
      lehren[skillKey] = Object.entries(entries).map(([index, entry]) => ({
        id: existing[skillKey]?.[index]?.id ?? foundry.utils.randomID(),
        name: entry.name ?? '',
        description: entry.description ?? '',
        minSkillLevel: Number(entry.minSkillLevel) || 0,
        bonuses: Object.values(entry.bonuses ?? {}).map(row => ({
          target: row.target ?? 'attackBonus',
          scope: row.scope ?? 'thisSkill',
          formula: row.formula ?? '',
        })),
      }));
    }
    await game.settings.set('sksk', 'lehren', lehren);
  }

  /** @private */
  static async #addLehre(event, target) {
    const skillKey = target.dataset.skill;
    const lehren = foundry.utils.deepClone(getAllLehrenDefinitions());
    (lehren[skillKey] ??= []).push({
      id: foundry.utils.randomID(), name: '', description: '', minSkillLevel: 0, bonuses: [],
    });
    await game.settings.set('sksk', 'lehren', lehren);
    this.render();
  }

  /** @private */
  static async #removeLehre(event, target) {
    const skillKey = target.dataset.skill;
    const index = Number(target.dataset.index);
    const lehren = foundry.utils.deepClone(getAllLehrenDefinitions());
    (lehren[skillKey] ?? []).splice(index, 1);
    await game.settings.set('sksk', 'lehren', lehren);
    this.render();
  }

  /** @private */
  static async #addLehreBonus(event, target) {
    const skillKey = target.dataset.skill;
    const lehreIndex = Number(target.dataset.lehreIndex);
    const lehren = foundry.utils.deepClone(getAllLehrenDefinitions());
    const def = lehren[skillKey]?.[lehreIndex];
    if (!def) return;
    (def.bonuses ??= []).push({ target: 'attackBonus', scope: 'thisSkill', formula: '@value' });
    await game.settings.set('sksk', 'lehren', lehren);
    this.render();
  }

  /** @private */
  static async #removeLehreBonus(event, target) {
    const skillKey = target.dataset.skill;
    const lehreIndex = Number(target.dataset.lehreIndex);
    const index = Number(target.dataset.index);
    const lehren = foundry.utils.deepClone(getAllLehrenDefinitions());
    const def = lehren[skillKey]?.[lehreIndex];
    if (!def) return;
    (def.bonuses ?? []).splice(index, 1);
    await game.settings.set('sksk', 'lehren', lehren);
    this.render();
  }
}
