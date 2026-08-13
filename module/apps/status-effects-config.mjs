import { CUSTOM_TURN_START_FIELDS } from '../helpers/statusEffects.mjs';
import { getSkillBonusChoices } from '../helpers/skills.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A custom status effect's optional flat-per-stack stat modifiers (see
 * helpers/statusEffects.mjs#buildStatModifierChanges) - only ever shown/
 * editable for non-predefined entries.
 */
const STAT_MODIFIER_FIELDS = ['lifeBonus', 'manaBonus', 'apBonus', 'rpBonus', 'acBonus', 'mrBonus'];

/**
 * A custom status effect's optional flat-per-stack turn-start ticks (see
 * helpers/statusEffects.mjs#CUSTOM_TURN_START_FIELDS/handleCustomTurnStart) -
 * also only ever shown/editable for non-predefined entries.
 */
const NUMERIC_FIELDS = [...STAT_MODIFIER_FIELDS, ...CUSTOM_TURN_START_FIELDS];

/**
 * A custom status effect's optional Base-/Spezial-/Modifikator-tier
 * attribute bonus row lists (see helpers/statusEffects.mjs#
 * buildStatModifierChanges), each { attribute, bonus } - also only ever
 * shown/editable for non-predefined entries. Base feeds
 * system.attributeBonuses.<attr>.base (Species/Talent's own permanent
 * stat-increase tier); Special/Modifier feed the same two Active-Effect-
 * only fields Item/Armor/Weapon/Technique/Spell's own "Effects" tab already
 * targets.
 */
const ATTRIBUTE_BONUS_FIELDS = ['baseAttributeBonuses', 'specialAttributeBonuses', 'modifierAttributeBonuses'];

/**
 * A custom status effect's optional FP Gain Bonuses row list (see
 * helpers/statusEffects.mjs#setStatusStacks), each { skill, bonusType,
 * amount, allowZero } - unlike ATTRIBUTE_BONUS_FIELDS above, this can't be
 * reduced to a flat ADD-mode system.changes key (it needs custom multi-tier
 * aggregation logic - see helpers/skillFp.mjs#applySkillFpGainBonus), so
 * it's delivered as a flags.sksk.fpGainBonuses payload on the resulting
 * ActiveEffect instead - also only ever shown/editable for non-predefined
 * entries.
 */
const FP_GAIN_BONUS_FIELD = 'fpGainBonuses';

/**
 * GM-only settings menu app for managing the world's list of status
 * effects (see helpers/statusEffects.mjs). A plain world setting (an
 * untyped Array) has no native config UI, so this provides one, following
 * the same add/remove-array-entry pattern used elsewhere (see also
 * apps/materials-config.mjs). Predefined entries (id/img fixed, carrying
 * bespoke game-mechanical hooks keyed on that id) can have their name/img/
 * description edited but not their id, and can't be removed; GM-added
 * custom entries are fully editable/removable but get no automated
 * mechanics of their own.
 */
export class SKSKStatusEffectsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-status-effects-config',
    tag: 'form',
    classes: ['sksk', 'status-effects-config'],
    window: {
      title: 'SKSK.Settings.StatusEffects.Name',
      icon: 'fas fa-skull-crossbones',
    },
    position: { width: 560, height: 640 },
    form: {
      handler: SKSKStatusEffectsConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addStatusEffect: SKSKStatusEffectsConfig.#addStatusEffect,
      removeStatusEffect: SKSKStatusEffectsConfig.#removeStatusEffect,
      addStatusAttributeBonus: SKSKStatusEffectsConfig.#addStatusAttributeBonus,
      removeStatusAttributeBonus: SKSKStatusEffectsConfig.#removeStatusAttributeBonus,
      addStatusFpGainBonus: SKSKStatusEffectsConfig.#addStatusFpGainBonus,
      removeStatusFpGainBonus: SKSKStatusEffectsConfig.#removeStatusFpGainBonus,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/sksk/templates/settings/status-effects-config.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const statusEffects = game.settings.get('sksk', 'statusEffects') ?? [];
    context.statusEffects = await Promise.all(statusEffects.map(async entry => ({
      ...entry,
      descriptionHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(entry.description ?? ''),
    })));
    context.attributeChoices = CONFIG.SKSK.attributes;
    context.skillBonusChoices = getSkillBonusChoices();
    context.fpGainBonusTypeChoices = CONFIG.SKSK.fpGainBonusTypes;
    return context;
  }

  /**
   * Parse the submitted form's flat "statusEffects.<index>.<field>" keys
   * back into an array and persist it - predefined entries' id/predefined
   * flag are carried over from the existing stored value (not form fields).
   * A predefined entry is flagged "customized" the moment its name/
   * description no longer matches the current locale's translation (see
   * helpers/statusEffects.mjs#ensurePredefinedStatusEffects) - this is what
   * keeps future locale updates from silently overwriting an intentional
   * GM rename, while still letting an untouched (or reverted-to-default)
   * entry keep tracking translation changes automatically.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const existing = game.settings.get('sksk', 'statusEffects') ?? [];
    const statusEffects = Object.entries(expanded.statusEffects ?? {}).map(([index, entry]) => {
      const predefined = existing[index]?.predefined ?? false;
      const name = entry.name ?? '';
      const description = entry.description ?? '';
      const result = {
        id: existing[index]?.id ?? foundry.utils.randomID(),
        predefined,
        name,
        img: entry.img ?? 'icons/svg/aura.svg',
        description,
      };
      if (predefined) {
        const def = CONFIG.SKSK.predefinedStatusEffects.find(d => d.id === result.id);
        result.customized = def ? (name !== game.i18n.localize(def.nameKey) || description !== game.i18n.localize(def.descriptionKey)) : true;
      } else {
        // Flat stat modifiers, turn-start ticks and attribute bonus rows
        // are custom-entry-only - predefined effects manage their own
        // consequences in code instead.
        for (const field of NUMERIC_FIELDS) result[field] = Number(entry[field]) || 0;
        for (const field of ATTRIBUTE_BONUS_FIELDS) {
          result[field] = Object.values(entry[field] ?? {}).map(row => ({
            attribute: row.attribute ?? 'str',
            bonus: Number(row.bonus) || 0,
          }));
        }
        result[FP_GAIN_BONUS_FIELD] = Object.values(entry[FP_GAIN_BONUS_FIELD] ?? {}).map(row => ({
          skill: row.skill ?? '',
          bonusType: row.bonusType ?? 'positive',
          amount: Number(row.amount) || 0,
          allowZero: !!row.allowZero,
        }));
      }
      return result;
    });
    await game.settings.set('sksk', 'statusEffects', statusEffects);
  }

  /** @private */
  static async #addStatusEffect(event, target) {
    const statusEffects = foundry.utils.deepClone(game.settings.get('sksk', 'statusEffects') ?? []);
    const entry = {
      id: foundry.utils.randomID(), predefined: false, name: '', img: 'icons/svg/aura.svg', description: '',
    };
    for (const field of NUMERIC_FIELDS) entry[field] = 0;
    for (const field of ATTRIBUTE_BONUS_FIELDS) entry[field] = [];
    entry[FP_GAIN_BONUS_FIELD] = [];
    statusEffects.push(entry);
    await game.settings.set('sksk', 'statusEffects', statusEffects);
    this.render();
  }

  /** @private */
  static async #removeStatusEffect(event, target) {
    const index = Number(target.dataset.index);
    const statusEffects = foundry.utils.deepClone(game.settings.get('sksk', 'statusEffects') ?? []);
    statusEffects.splice(index, 1);
    await game.settings.set('sksk', 'statusEffects', statusEffects);
    this.render();
  }

  /** @private */
  static async #addStatusAttributeBonus(event, target) {
    const index = Number(target.dataset.index);
    const field = target.dataset.field;
    const statusEffects = foundry.utils.deepClone(game.settings.get('sksk', 'statusEffects') ?? []);
    const entry = statusEffects[index];
    if (!entry) return;
    (entry[field] ??= []).push({ attribute: 'str', bonus: 1 });
    await game.settings.set('sksk', 'statusEffects', statusEffects);
    this.render();
  }

  /** @private */
  static async #removeStatusAttributeBonus(event, target) {
    const index = Number(target.dataset.index);
    const field = target.dataset.field;
    const bonusIndex = Number(target.dataset.bonusIndex);
    const statusEffects = foundry.utils.deepClone(game.settings.get('sksk', 'statusEffects') ?? []);
    const entry = statusEffects[index];
    if (!entry) return;
    (entry[field] ?? []).splice(bonusIndex, 1);
    await game.settings.set('sksk', 'statusEffects', statusEffects);
    this.render();
  }

  /**
   * Same add/remove pair as #addStatusAttributeBonus/#removeStatusAttributeBonus
   * above, but for FP_GAIN_BONUS_FIELD's differently-shaped row (skill/
   * bonusType/amount/allowZero rather than attribute/bonus) - kept as its
   * own action pair rather than a `field`-agnostic default row, since the
   * default row shape differs.
   * @private
   */
  static async #addStatusFpGainBonus(event, target) {
    const index = Number(target.dataset.index);
    const statusEffects = foundry.utils.deepClone(game.settings.get('sksk', 'statusEffects') ?? []);
    const entry = statusEffects[index];
    if (!entry) return;
    (entry[FP_GAIN_BONUS_FIELD] ??= []).push({ skill: 'axe', bonusType: 'positive', amount: 0, allowZero: false });
    await game.settings.set('sksk', 'statusEffects', statusEffects);
    this.render();
  }

  /** @private */
  static async #removeStatusFpGainBonus(event, target) {
    const index = Number(target.dataset.index);
    const bonusIndex = Number(target.dataset.bonusIndex);
    const statusEffects = foundry.utils.deepClone(game.settings.get('sksk', 'statusEffects') ?? []);
    const entry = statusEffects[index];
    if (!entry) return;
    (entry[FP_GAIN_BONUS_FIELD] ?? []).splice(bonusIndex, 1);
    await game.settings.set('sksk', 'statusEffects', statusEffects);
    this.render();
  }
}
