const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Per-category list of usage triggers a skill can generate FP for - see
 * helpers/skillFp.mjs#grantSkillUsageFp for where each is actually wired
 * up (or, for "kill"/"damageTaken", left unwired for now - no kill/damage
 * detection exists yet). Drives both the GM config app's columns
 * (skill-usage-fp-config.mjs) and, indirectly, which trigger keys are ever
 * meaningful for a given skill.
 */
const CATEGORY_FIELDS = {
  weapons: {
    hintKey: 'SKSK.SkillFpConfig.WeaponsHint',
    fields: [
      { key: 'skillCheck', label: 'SKSK.SkillFpConfig.SkillCheck' },
      { key: 'weaponAttack', label: 'SKSK.SkillFpConfig.WeaponAttack' },
      { key: 'kill', label: 'SKSK.SkillFpConfig.Kill' },
    ],
  },
  armors: {
    hintKey: 'SKSK.SkillFpConfig.ArmorsHint',
    fields: [
      { key: 'hitTaken', label: 'SKSK.SkillFpConfig.HitTaken' },
    ],
  },
  magicSchools: {
    hintKey: 'SKSK.SkillFpConfig.MagicSchoolsHint',
    fields: [
      { key: 'spellCastPerLevel', label: 'SKSK.SkillFpConfig.SpellCastPerLevel' },
    ],
  },
  attribute: {
    hintKey: 'SKSK.SkillFpConfig.AttributeHint',
    fields: [
      { key: 'attributeRoll', label: 'SKSK.SkillFpConfig.AttributeRoll' },
    ],
  },
  resistances: {
    hintKey: 'SKSK.SkillFpConfig.ResistancesHint',
    fields: [
      { key: 'damageTaken', label: 'SKSK.SkillFpConfig.DamageTaken' },
    ],
  },
};

/**
 * The skill keys shown under a given category tab - every skill in
 * CONFIG.SKSK.skills[categoryKey], except for "attribute" which is
 * narrowed to the 8 "Unbegrenzte X" skills (CONFIG.SKSK.
 * unlimitedAttributeSkills) - the only ones with a single attribute their
 * own roll can be tied to; the catch-all "unlimited" skill has none.
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
 * GM-only settings menu app for configuring how many FP each skill grants a
 * Character (never NPCs) per relevant usage - one tab per applicable skill
 * category, see CATEGORY_FIELDS above. A plain world setting (an untyped
 * Object, keyed by skill) has no native config UI, so this provides one,
 * following the same pattern as apps/materials-config.mjs et al. Rates may
 * be fractional (like Training's own per-hour rates - see
 * apps/training-methods-config.mjs); helpers/skillFp.mjs floors at grant
 * time.
 */
export class SKSKSkillUsageFpConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-skill-usage-fp-config',
    tag: 'form',
    classes: ['sksk', 'skill-usage-fp-config'],
    window: {
      title: 'SKSK.Settings.SkillUsageFp.Name',
      icon: 'fas fa-bolt',
    },
    position: { width: 720, height: 640 },
    form: {
      handler: SKSKSkillUsageFpConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: 'weapons', label: 'SKSK.SkillCategory.Weapons' },
        { id: 'armors', label: 'SKSK.SkillCategory.Armors' },
        { id: 'magicSchools', label: 'SKSK.SkillCategory.MagicSchools' },
        { id: 'attribute', label: 'SKSK.SkillCategory.Attribute' },
        { id: 'resistances', label: 'SKSK.SkillCategory.Resistances' },
      ],
      initial: 'weapons',
    },
  };

  /** @override */
  static PARTS = {
    tabs: { template: 'templates/generic/tab-navigation.hbs' },
    weapons: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
    armors: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
    magicSchools: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
    attribute: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
    resistances: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tabs = this._prepareTabs('primary');
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

    const category = CATEGORY_FIELDS[partId];
    if (!category) return context;

    const stored = game.settings.get('sksk', 'skillUsageFp') ?? {};
    context.tab = context.tabs[partId];
    context.categoryHint = category.hintKey;
    context.fields = category.fields;
    context.skills = getCategorySkills(partId).map(skill => ({
      ...skill,
      values: stored[skill.key] ?? {},
    }));
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Force-apply the active tab on first render (Foundry only wires up
    // clicks after that, matching the pattern used on Actor/Item sheets
    // and apps/models-config.mjs).
    const active = this.tabGroups?.primary ?? this.constructor.TABS.primary.initial;
    if (active && this.element.querySelector(`.tab[data-group="primary"][data-tab="${active}"]`)) {
      this.changeTab(active, 'primary', { force: true, updatePosition: false });
    }
  }

  /**
   * Parse the submitted form's flat "skillFp.<skillKey>.<field>" keys
   * (covering every tab at once - Foundry keeps every tab's own fields in
   * the DOM, just hidden, so a single submit sees them all) back into the
   * skillUsageFp world setting.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const raw = expanded.skillFp ?? {};
    const settings = {};
    for (const [skillKey, fields] of Object.entries(raw)) {
      settings[skillKey] = Object.fromEntries(
        Object.entries(fields).map(([fieldKey, value]) => [fieldKey, Number(value) || 0])
      );
    }
    await game.settings.set('sksk', 'skillUsageFp', settings);
  }
}
