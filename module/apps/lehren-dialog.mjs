import { getActorSkillLevel } from '../helpers/skills.mjs';
import {
  LEHREN_POOL_SIZE, getLehrenDefinitions, getInvestedLehreLevel, getInvestedLehrenPoolTotal, setInvestedLehreLevel,
} from '../helpers/lehren.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The skill keys shown under a given category tab - same shape/narrowing
 * as apps/lehren-config.mjs's own local copy (see there for why this isn't
 * shared).
 * @param {string} categoryKey
 * @return {Array<{key: string, label: string}>}
 */
function getCategorySkills(categoryKey) {
  const category = CONFIG.SKSK.skills[categoryKey] ?? {};
  let keys = Object.keys(category);
  if (categoryKey === 'attribute') {
    const mapped = new Set(Object.values(CONFIG.SKSK.unlimitedAttributeSkills));
    keys = keys.filter(key => mapped.has(key));
  }
  return keys.map(key => ({ key, label: category[key].label }));
}

/**
 * The "Lehren" (Lore) window opened from a Character's own sheet header - a
 * shared pool of 5 levels per skill, freely distributed across that skill's
 * own GM-defined Lehren catalog (see helpers/lehren.mjs), gated per-Lehre by
 * its own minimum skill level. Only skills that actually have at least one
 * Lehre defined are shown (most skills will start with none). Like
 * SKSKTotemDialog, each stepper click writes immediately (no separate
 * Confirm step); the dialog stays open and re-renders after each action.
 */
export class SKSKLehrenDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'lehren-dialog'],
    window: { icon: 'fas fa-book' },
    position: { width: 760, height: 640 },
    actions: {
      increaseLehreLevel: SKSKLehrenDialog.#onChangeLevel,
      decreaseLehreLevel: SKSKLehrenDialog.#onChangeLevel,
    },
  };

  // Same 11 categories as apps/lehren-config.mjs's own TABS.
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
    weapons: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    armors: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    production: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    rogue: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    magicSchools: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    magic: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    fighter: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    misc: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    attribute: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    resistances: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
    special: { template: 'systems/sksk/templates/apps/lehren-dialog-category.hbs', scrollable: [''] },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.LehrenDialog.Title')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tabs = this._prepareTabs('primary');
    context.lehrenPoolSize = LEHREN_POOL_SIZE;
    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === 'tabs') {
      return { ...context, tabs: Object.values(context.tabs) };
    }

    context.tab = context.tabs[partId];
    context.skills = getCategorySkills(partId)
      .map(skill => ({ ...skill, defs: getLehrenDefinitions(skill.key) }))
      .filter(skill => skill.defs.length)
      .map(skill => {
        const level = getActorSkillLevel(this.actor, skill.key);
        const poolTotal = getInvestedLehrenPoolTotal(this.actor, skill.key);
        const poolFull = poolTotal >= LEHREN_POOL_SIZE;
        return {
          ...skill,
          level,
          poolTotal,
          poolFull,
          defs: skill.defs.map(def => {
            const invested = getInvestedLehreLevel(this.actor, skill.key, def.id);
            const locked = level < (def.minSkillLevel ?? 0);
            return { ...def, invested, locked, canIncrease: !poolFull && !(locked && invested === 0) };
          }),
        };
      });
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
  }

  /** @private */
  static async #onChangeLevel(event, target) {
    const skillKey = target.dataset.skill;
    const lehreId = target.dataset.lehre;
    const delta = target.dataset.action === 'increaseLehreLevel' ? 1 : -1;
    const current = getInvestedLehreLevel(this.actor, skillKey, lehreId);
    const ok = await setInvestedLehreLevel(this.actor, skillKey, lehreId, current + delta);
    if (ok) this.render();
  }
}
