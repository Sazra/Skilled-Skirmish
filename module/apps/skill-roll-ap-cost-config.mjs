import { getSkillCheckDefinition, SKILL_ROLL_VARIANTS } from '../helpers/skillRolls.mjs';
import { getSkillRollApCostSettings, DEFAULT_AP_COST } from '../helpers/skillRollCost.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The skill categories shown as their own tab (mirrors apps/skill-usage-fp-
 * config.mjs's own TABS) - "attribute" is left out entirely, since every
 * one of its 8 "Unbegrenzte X" skills has getSkillCheckDefinition return
 * null (no skill check of their own at all, see helpers/skillRolls.mjs) and
 * so never contributes a row to any of these tabs; their own AP cost is
 * covered exclusively by the separate "attributes" (raw attribute roll)
 * tab appended below instead.
 */
const CATEGORY_TABS = [
  { id: 'weapons', label: 'SKSK.SkillCategory.Weapons' },
  { id: 'armors', label: 'SKSK.SkillCategory.Armors' },
  { id: 'production', label: 'SKSK.SkillCategory.Production' },
  { id: 'rogue', label: 'SKSK.SkillCategory.Rogue' },
  { id: 'magicSchools', label: 'SKSK.SkillCategory.MagicSchools' },
  { id: 'magic', label: 'SKSK.SkillCategory.Magic' },
  { id: 'fighter', label: 'SKSK.SkillCategory.Fighter' },
  { id: 'misc', label: 'SKSK.SkillCategory.Misc' },
  { id: 'resistances', label: 'SKSK.SkillCategory.Resistances' },
  { id: 'special', label: 'SKSK.SkillCategory.Special' },
];

/**
 * Every field this table offers for one rollable skill - one per usage
 * variant (helpers/skillRolls.mjs#SKILL_ROLL_VARIANTS, or a single generic
 * "skillCheck" field for a skill with none), further split by attribute
 * for a skill with more than one possible one (def.attributes.length > 1 -
 * e.g. Überleben's Geschicklichkeit/Konstitution/Wahrnehmung), since each
 * combination is independently configurable (see helpers/skillRollCost.mjs#
 * getSkillRollBaseApCost). A field's own key already embeds every dot its
 * name needs (e.g. "skillCheck.con") - foundry.utils.expandObject nests on
 * every dot in the full input name regardless of which piece contributed
 * it, so the form/submit handling below doesn't need to know the
 * difference. Labels are resolved to final display text here (rather than
 * passing translation keys through to the template, like every other field
 * list in this codebase) purely because the attribute-split ones need to
 * combine two localized strings into one.
 * @param {string} skillKey
 * @param {object} def   The skill's own CONFIG.SKSK.skills[...] entry.
 * @return {Array<{key: string, label: string}>}
 */
function getSkillRollFields(skillKey, def) {
  const variants = SKILL_ROLL_VARIANTS[skillKey];
  const baseVariants = variants
    ? variants.map(v => ({ trigger: v.trigger, label: game.i18n.localize(v.label) }))
    : [{ trigger: 'skillCheck', label: game.i18n.localize('SKSK.SkillRollApCostConfig.BaseCheck') }];

  if (!(def.attributes?.length > 1)) {
    return baseVariants.map(v => ({ key: v.trigger, label: v.label }));
  }

  const fields = [];
  for (const variant of baseVariants) {
    for (const attribute of def.attributes) {
      const attributeLabel = game.i18n.localize(CONFIG.SKSK.attributes[attribute]);
      fields.push({ key: `${variant.trigger}.${attribute}`, label: `${variant.label} (${attributeLabel})` });
    }
  }
  return fields;
}

/**
 * The skill keys (and their own field list) shown under a given category
 * tab - every skill in CONFIG.SKSK.skills[categoryKey] that
 * getSkillCheckDefinition recognizes as actually rollable.
 * @param {string} categoryKey
 * @param {object} stored   The "skills" half of the world setting.
 * @return {Array<{key: string, label: string, fields: Array<{key: string, label: string, value: number}>}>}
 */
function getCategorySkills(categoryKey, stored) {
  const category = CONFIG.SKSK.skills[categoryKey] ?? {};
  const skills = [];
  for (const [skillKey, def] of Object.entries(category)) {
    if (!getSkillCheckDefinition(skillKey)) continue;
    const fields = getSkillRollFields(skillKey, def).map(field => ({
      ...field,
      value: foundry.utils.getProperty(stored?.[skillKey] ?? {}, field.key) ?? DEFAULT_AP_COST,
    }));
    skills.push({ key: skillKey, label: def.label, fields });
  }
  return skills;
}

/**
 * Recursively coerces every leaf of a submitted "skills.<skillKey>..." (or
 * "attributes.<attributeKey>") subtree to a Number, leaving the object
 * structure itself (a skill with an attribute-split field ends up as a
 * nested object, one with plain fields as a flat one - see
 * getSkillRollFields) otherwise untouched.
 * @param {*} node
 * @return {number|Object<string, *>}
 */
function coerceCostLeaves(node) {
  if (node === null || typeof node !== 'object') return Number(node) || 0;
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, coerceCostLeaves(value)]));
}

/**
 * GM-only settings menu app for configuring how much AP (on an actor's own
 * turn) or RP (off it) rolling a skill check or a raw attribute check costs
 * while a Combat is active - see helpers/skillRollCost.mjs, which every
 * actual roll (helpers/skillRolls.mjs#rollSkillCheck, sheets/actor-sheet.mjs#
 * onRoll) reads from. A plain world setting (an untyped Object, split into
 * "skills" and "attributes") has no native config UI, so this provides one -
 * one tab per skill category (mirroring apps/skill-usage-fp-config.mjs),
 * plus a final tab for the entirely separate raw-attribute-roll mechanic,
 * rather than a single flat list, since the combined skill/variant/
 * attribute row count made that unreadable.
 */
export class SKSKSkillRollApCostConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-skill-roll-ap-cost-config',
    tag: 'form',
    classes: ['sksk', 'skill-roll-ap-cost-config'],
    window: {
      title: 'SKSK.Settings.SkillRollApCost.Name',
      icon: 'fas fa-shoe-prints',
    },
    position: { width: 720, height: 640 },
    form: {
      handler: SKSKSkillRollApCostConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [...CATEGORY_TABS, { id: 'attributes', label: 'SKSK.SkillRollApCostConfig.RawAttributes' }],
      initial: 'weapons',
    },
  };

  /** @override */
  static PARTS = {
    tabs: { template: 'templates/generic/tab-navigation.hbs' },
    weapons: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    armors: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    production: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    rogue: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    magicSchools: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    magic: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    fighter: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    misc: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    resistances: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    special: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-category.hbs', scrollable: [''] },
    attributes: { template: 'systems/sksk/templates/settings/skill-roll-ap-cost-attributes.hbs', scrollable: [''] },
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
    // See apps/skill-usage-fp-config.mjs's own identical comment - the
    // "tabs" nav part needs an array, every other part needs the original
    // by-id object, and mutating context.tabs in place would corrupt it for
    // parts rendered afterward since they all share one context reference.
    if (partId === 'tabs') {
      return { ...context, tabs: Object.values(context.tabs) };
    }

    const stored = getSkillRollApCostSettings();
    context.tab = context.tabs[partId];

    if (partId === 'attributes') {
      context.attributes = Object.entries(CONFIG.SKSK.attributes).map(([key, label]) => ({
        key, label, value: stored.attributes?.[key] ?? DEFAULT_AP_COST,
      }));
      return context;
    }

    context.skills = getCategorySkills(partId, stored.skills);
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Force-apply the active tab on first render, matching apps/skill-
    // usage-fp-config.mjs (Foundry only wires up clicks after this point).
    const active = this.tabGroups?.primary ?? this.constructor.TABS.primary.initial;
    if (active && this.element.querySelector(`.tab[data-group="primary"][data-tab="${active}"]`)) {
      this.changeTab(active, 'primary', { force: true, updatePosition: false });
    }
  }

  /**
   * Parse the submitted form's flat "skills.<skillKey>...." and
   * "attributes.<attributeKey>" keys (covering every tab at once - Foundry
   * keeps every tab's own fields in the DOM, just hidden, so a single
   * submit sees them all) back into the skillRollApCost world setting.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const rawSkills = expanded.skills ?? {};
    const skills = {};
    for (const [skillKey, fields] of Object.entries(rawSkills)) {
      skills[skillKey] = coerceCostLeaves(fields);
    }
    const attributes = Object.fromEntries(
      Object.entries(expanded.attributes ?? {}).map(([key, value]) => [key, Number(value) || 0])
    );
    await game.settings.set('sksk', 'skillRollApCost', { skills, attributes });
  }
}
