const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A custom status effect's optional flat-per-stack stat modifiers (see
 * helpers/statusEffects.mjs#buildStatModifierChanges) - only ever shown/
 * editable for non-predefined entries.
 */
const STAT_MODIFIER_FIELDS = ['lifeBonus', 'manaBonus', 'apBonus', 'rpBonus', 'acBonus', 'mrBonus'];

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
    return context;
  }

  /**
   * Parse the submitted form's flat "statusEffects.<index>.<field>" keys
   * back into an array and persist it - predefined entries' id/predefined
   * flag are carried over from the existing stored value (not form fields).
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const existing = game.settings.get('sksk', 'statusEffects') ?? [];
    const statusEffects = Object.entries(expanded.statusEffects ?? {}).map(([index, entry]) => {
      const predefined = existing[index]?.predefined ?? false;
      const result = {
        id: existing[index]?.id ?? foundry.utils.randomID(),
        predefined,
        name: entry.name ?? '',
        img: entry.img ?? 'icons/svg/aura.svg',
        description: entry.description ?? '',
      };
      // Flat stat modifiers are custom-entry-only - predefined effects
      // manage their own consequences in code instead.
      if (!predefined) {
        for (const field of STAT_MODIFIER_FIELDS) result[field] = Number(entry[field]) || 0;
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
    for (const field of STAT_MODIFIER_FIELDS) entry[field] = 0;
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
}
