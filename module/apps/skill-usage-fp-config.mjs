import { getSkillCheckDefinition } from '../helpers/skillRolls.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Per-category list of usage triggers a skill can generate FP for, shown as
 * one uniform table (every skill in the category gets the exact same
 * columns) - weapons/armors/magicSchools/attribute/resistances only, where
 * that's true. See MIXED_CATEGORIES below for categories where different
 * skills need different fields. See helpers/skillFp.mjs#grantSkillUsageFp
 * for where each trigger is actually wired up - "kill" (helpers/
 * damageApplication.mjs#applyDamageFromChat + apps/kill-dialog.mjs) and
 * "damageTaken" (helpers/damageApplication.mjs, capped at Resistance level
 * 3 - see helpers/skillFp.mjs#capResistanceGain) are both wired now.
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
 * Per-category hint shown above a "mixed" category's skill list (see
 * MIXED_CATEGORIES/SKILL_SPECIFIC_TRIGGERS below).
 */
const MIXED_CATEGORY_HINTS = {
  production: 'SKSK.SkillFpConfig.ProductionHint',
  rogue: 'SKSK.SkillFpConfig.RogueHint',
  magic: 'SKSK.SkillFpConfig.MagicHint',
  fighter: 'SKSK.SkillFpConfig.FighterHint',
  misc: 'SKSK.SkillFpConfig.MiscHint',
  special: 'SKSK.SkillFpConfig.SpecialHint',
};

/**
 * Every skill-specific (non-"skillCheck") usage trigger, per skill key -
 * drives the "mixed" categories (production/rogue/magic/fighter/misc/
 * special), where - unlike weapons/armors/etc. - different skills in the
 * same category need different fields (e.g. Meditation's "die used" vs.
 * Concentration's "check made"). Taken from the design spreadsheet's own
 * "Wird trainiert durch" column, methods only (not its point values) and
 * excluding anything naming Training itself (see helpers/training.mjs -
 * that's a wholly separate mechanic). Most of these have no corresponding
 * game mechanic implemented yet (e.g. no crafting/lock-picking/summoning
 * system exists) and so are left unwired for now - see helpers/
 * skillFp.mjs#grantSkillUsageFp for which ones actually are wired, called
 * out in each field's own label below.
 */
const SKILL_SPECIFIC_TRIGGERS = {
  // Production (Herstellungsfertigkeiten) - no crafting system exists yet,
  // every field here is unwired.
  alchemy: [{ key: 'potionBrewed', label: 'SKSK.SkillFpConfig.PotionBrewed' }],
  crafting: [
    { key: 'itemCrafted', label: 'SKSK.SkillFpConfig.ItemCrafted' },
    { key: 'itemCraftFailed', label: 'SKSK.SkillFpConfig.ItemCraftFailed' },
  ],
  cooking: [
    { key: 'dishCooked', label: 'SKSK.SkillFpConfig.DishCooked' },
    { key: 'cookFailed', label: 'SKSK.SkillFpConfig.CookFailed' },
  ],
  enchanting: [{ key: 'enchantmentLevel', label: 'SKSK.SkillFpConfig.EnchantmentLevel' }],

  // Rogue (Fingerfertigkeiten) - no assassination/trap/lock-picking/stealth
  // system exists yet, every field here is unwired.
  assassination: [
    { key: 'assassinationAttack', label: 'SKSK.SkillFpConfig.AssassinationAttack' },
    { key: 'assassinationKill', label: 'SKSK.SkillFpConfig.AssassinationKill' },
  ],
  // Traps' roll now happens via a "Falle stellen"/"Falle entschärfen"
  // variant choice (see helpers/skillRolls.mjs#SKILL_ROLL_VARIANTS) - its
  // own plain "skillCheck" field is dropped entirely (see
  // NO_BASE_SKILL_CHECK below); every FP it grants goes through one of
  // these two instead.
  traps: [
    { key: 'trapSet', label: 'SKSK.SkillFpConfig.TrapSet' },
    { key: 'trapDisarmed', label: 'SKSK.SkillFpConfig.TrapDisarmed' },
  ],
  stealth: [
    { key: 'stealthRound', label: 'SKSK.SkillFpConfig.StealthRound' },
  ],
  // Fingerfertigkeit's roll offers its base "skillCheck" as one of three
  // variant choices, alongside Schlossknacken/Taschendiebstahl (see
  // helpers/skillRolls.mjs#SKILL_ROLL_VARIANTS) - unlike Traps, its own
  // "skillCheck" field still applies (via the universal field below), just
  // now selected explicitly rather than being the only option.
  sleightOfHand: [
    { key: 'lockPicked', label: 'SKSK.SkillFpConfig.LockPicked' },
    { key: 'pickpocket', label: 'SKSK.SkillFpConfig.Pickpocket' },
  ],

  // Magic (Magiefertigkeiten).
  concentration: [{ key: 'concentrationCheck', label: 'SKSK.SkillFpConfig.ConcentrationCheck' }],
  meditation: [{ key: 'meditationUsed', label: 'SKSK.SkillFpConfig.MeditationUsed' }],
  summoning: [
    { key: 'summonLevel', label: 'SKSK.SkillFpConfig.SummonLevel' },
    { key: 'summonExistenceDay', label: 'SKSK.SkillFpConfig.SummonExistenceDay' },
  ],
  magicControl: [{ key: 'spellCast', label: 'SKSK.SkillFpConfig.MagicControlSpellCast' }],
  manaCapacity: [{ key: 'dailyManaSpent', label: 'SKSK.SkillFpConfig.DailyManaSpent' }],
  manaRegeneration: [{ key: 'dailyManaSpent', label: 'SKSK.SkillFpConfig.DailyManaSpent' }],
  // Manakern grants FP via a flat, per-item field (system.manaCoreFpGrant
  // on Spell/Item, see helpers/skillFp.mjs#grantFlatSkillFp) instead of any
  // GM-configured rate - only its own base "skillCheck" field (the
  // universal one below) remains here.
  // "ritualHour" is wired (helpers/spell-rolls.mjs#renderSpellEffectParts,
  // via helpers/spells.mjs#computeRitualHours) - granted once a "Ritual"
  // casting-method spell actually resolves, scaled by its own apCost/
  // apCostUnit (data/spell.mjs), at least 1 hour. "enchantingHour" stays
  // unwired - no enchanting system exists yet.
  ritualism: [
    { key: 'ritualHour', label: 'SKSK.SkillFpConfig.RitualHour' },
    { key: 'enchantingHour', label: 'SKSK.SkillFpConfig.EnchantingHour' },
  ],
  chantShortening: [
    { key: 'spellCast', label: 'SKSK.SkillFpConfig.ChantShorteningSpellCast' },
  ],
  // Wired (helpers/spell-rolls.mjs#rollSpellItem, via a spell's Shift+Click
  // - see sheets/actor-sheet.mjs's #onRoll and helpers/spell-rolls.mjs#
  // chooseOverchargeCount) - scaled by however many times the cast was
  // overcharged.
  overcharge: [{ key: 'overchargeUsed', label: 'SKSK.SkillFpConfig.OverchargeUsed' }],
  sourceBound: [{ key: 'sourceAbilityUsed', label: 'SKSK.SkillFpConfig.SourceAbilityUsed' }],
  etherBound: [{ key: 'sourceOpened', label: 'SKSK.SkillFpConfig.SourceOpened' }],
  // chantless ("Spruchlose Magie") isn't listed at all - "Kann nicht
  // trainiert werden" per the design spreadsheet, and it has no skill
  // check either (see getSkillCheckDefinition).

  // Fighter (Kämpferfertigkeiten).
  health: [{ key: 'regenerationUsed', label: 'SKSK.SkillFpConfig.RegenerationUsed' }],
  stamina: [{ key: 'combatMovement', label: 'SKSK.SkillFpConfig.CombatMovement' }],
  technique: [{ key: 'techniqueCooldownRound', label: 'SKSK.SkillFpConfig.TechniqueCooldownRound' }],
  reflexes: [
    { key: 'dodgeUsed', label: 'SKSK.SkillFpConfig.DodgeUsed' },
    { key: 'reflexActionUsed', label: 'SKSK.SkillFpConfig.ReflexActionUsed' },
  ],
  precision: [
    { key: 'criticalHit', label: 'SKSK.SkillFpConfig.CriticalHit' },
    { key: 'doubleCriticalHit', label: 'SKSK.SkillFpConfig.DoubleCriticalHit' },
  ],
  brutality: [{ key: 'criticalBonusDamagePoint', label: 'SKSK.SkillFpConfig.CriticalBonusDamagePoint' }],
  adrenalin: [{ key: 'adrenalinUsed', label: 'SKSK.SkillFpConfig.AdrenalinUsed' }],
  ambidextrous: [{ key: 'offHandAttack', label: 'SKSK.SkillFpConfig.OffHandAttack' }],

  // Misc (Nutzungsfertigkeiten). "passiveDetection" and "prayer" are both
  // wired - see sheets/actor-sheet.mjs's header (#grantPassivePerceptionFp/
  // #openPrayerDialog, via apps/prayer-dialog.mjs).
  observation: [{ key: 'passiveDetection', label: 'SKSK.SkillFpConfig.PassiveDetection' }],
  faith: [{ key: 'prayer', label: 'SKSK.SkillFpConfig.Prayer' }],
  healer: [{ key: 'healedCreature', label: 'SKSK.SkillFpConfig.HealedCreature' }],
  singing: [{ key: 'bardicSpellCast', label: 'SKSK.SkillFpConfig.BardicSpellCast' }],
  tactic: [{ key: 'flankAttack', label: 'SKSK.SkillFpConfig.FlankAttack' }],
  inspiration: [{ key: 'inspirationUsed', label: 'SKSK.SkillFpConfig.InspirationUsed' }],
  totem: [
    { key: 'totemBond', label: 'SKSK.SkillFpConfig.TotemBond' },
    { key: 'totemUsed', label: 'SKSK.SkillFpConfig.TotemUsed' },
  ],
  tenacity: [{ key: 'zeroLifeRound', label: 'SKSK.SkillFpConfig.ZeroLifeRound' }],
  // rhetoric/survival/disguise/intimidation have no method beyond their own
  // skill check (already covered by the universal "skillCheck" field).

  // Special (Spezielles) - only the point-scaled ones; corpusImmortalis/
  // immortal level via other means entirely (no FP field at all - see
  // getMixedCategorySkills), and luck/massacre have no skill check.
  luck: [
    { key: 'criticalRoll', label: 'SKSK.SkillFpConfig.CriticalRoll' },
    { key: 'doubleCriticalRoll', label: 'SKSK.SkillFpConfig.DoubleCriticalRoll' },
  ],
  massacre: [{ key: 'massKill', label: 'SKSK.SkillFpConfig.MassKill' }],
  soulforce: [
    { key: 'soulPowerTraded', label: 'SKSK.SkillFpConfig.SoulPowerTraded' },
    { key: 'allMeditationDiceConsumed', label: 'SKSK.SkillFpConfig.AllMeditationDiceConsumed' },
  ],
  hitCorrection: [{ key: 'attackHit', label: 'SKSK.SkillFpConfig.AttackHit' }],
  defenseCorrection: [{ key: 'attackDefended', label: 'SKSK.SkillFpConfig.AttackDefended' }],
};

/**
 * Categories shown as a per-skill field list (skill-fp-category-mixed.hbs)
 * rather than a uniform table (skill-fp-category.hbs) - every skill in
 * these categories may need a different set of fields, unlike weapons/
 * armors/etc. where every skill shares the exact same columns.
 */
const MIXED_CATEGORIES = ['production', 'rogue', 'magic', 'fighter', 'misc', 'special'];

/**
 * Skills that still have a real skill check (getSkillCheckDefinition
 * returns non-null) but should never show the universal "skillCheck"
 * field - Fallen's roll now always goes through one of its own two
 * variant triggers instead (see helpers/skillRolls.mjs#
 * SKILL_ROLL_VARIANTS), so a plain, variant-less "skillCheck" FP no
 * longer applies to it at all.
 */
const NO_BASE_SKILL_CHECK = new Set(['traps']);

/**
 * The skill keys shown under a given (table-style) category tab - every
 * skill in CONFIG.SKSK.skills[categoryKey], except for "attribute" which is
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
 * The skill keys (and their own field list) shown under a given "mixed"
 * category tab - every skill in CONFIG.SKSK.skills[categoryKey] that has
 * at least one applicable field: the universal "skillCheck" field
 * (whenever getSkillCheckDefinition says the skill actually has a roll),
 * plus whatever SKILL_SPECIFIC_TRIGGERS lists for it. Skills with neither
 * (e.g. Unsterblich/Corpus Immortalis, which level through other means
 * entirely) are omitted outright.
 * @param {string} categoryKey
 * @return {Array<{key: string, label: string, fields: Array<{key: string, label: string}>}>}
 */
function getMixedCategorySkills(categoryKey) {
  const category = CONFIG.SKSK.skills[categoryKey] ?? {};
  const skills = [];
  for (const [key, def] of Object.entries(category)) {
    const fields = [];
    if (getSkillCheckDefinition(key) && !NO_BASE_SKILL_CHECK.has(key)) {
      fields.push({ key: 'skillCheck', label: 'SKSK.SkillFpConfig.SkillCheck' });
    }
    fields.push(...(SKILL_SPECIFIC_TRIGGERS[key] ?? []));
    if (fields.length) skills.push({ key, label: def.label, fields });
  }
  return skills;
}

/**
 * GM-only settings menu app for configuring how many FP each skill grants a
 * Character (never NPCs) per relevant usage - one tab per applicable skill
 * category. Weapons/Armors/Magic Schools/Attribute/Resistances show a
 * uniform table (CATEGORY_FIELDS); Production/Rogue/Magic/Fighter/Misc/
 * Special show a per-skill field list instead (MIXED_CATEGORIES/
 * SKILL_SPECIFIC_TRIGGERS), since different skills there need different
 * fields. A plain world setting (an untyped Object, keyed by skill) has no
 * native config UI, so this provides one, following the same pattern as
 * apps/materials-config.mjs et al. Rates may be fractional (like
 * Training's own per-hour rates - see apps/training-methods-config.mjs);
 * helpers/skillFp.mjs floors at grant time.
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
    weapons: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
    armors: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
    production: { template: 'systems/sksk/templates/settings/skill-fp-category-mixed.hbs', scrollable: [''] },
    rogue: { template: 'systems/sksk/templates/settings/skill-fp-category-mixed.hbs', scrollable: [''] },
    magicSchools: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
    magic: { template: 'systems/sksk/templates/settings/skill-fp-category-mixed.hbs', scrollable: [''] },
    fighter: { template: 'systems/sksk/templates/settings/skill-fp-category-mixed.hbs', scrollable: [''] },
    misc: { template: 'systems/sksk/templates/settings/skill-fp-category-mixed.hbs', scrollable: [''] },
    attribute: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
    resistances: { template: 'systems/sksk/templates/settings/skill-fp-category.hbs', scrollable: [''] },
    special: { template: 'systems/sksk/templates/settings/skill-fp-category-mixed.hbs', scrollable: [''] },
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

    const stored = game.settings.get('sksk', 'skillUsageFp') ?? {};
    context.tab = context.tabs[partId];

    if (MIXED_CATEGORIES.includes(partId)) {
      context.categoryHint = MIXED_CATEGORY_HINTS[partId];
      context.skills = getMixedCategorySkills(partId).map(skill => ({
        ...skill,
        values: stored[skill.key] ?? {},
      }));
      return context;
    }

    const category = CATEGORY_FIELDS[partId];
    if (!category) return context;

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
