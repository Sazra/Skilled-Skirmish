const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    position: { width: 560, height: 'auto' },
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
    context.statusEffects = game.settings.get('sksk', 'statusEffects') ?? [];
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
    const statusEffects = Object.entries(expanded.statusEffects ?? {}).map(([index, entry]) => ({
      id: existing[index]?.id ?? foundry.utils.randomID(),
      predefined: existing[index]?.predefined ?? false,
      name: entry.name ?? '',
      img: entry.img ?? 'icons/svg/aura.svg',
      description: entry.description ?? '',
    }));
    await game.settings.set('sksk', 'statusEffects', statusEffects);
  }

  /** @private */
  static async #addStatusEffect(event, target) {
    const statusEffects = foundry.utils.deepClone(game.settings.get('sksk', 'statusEffects') ?? []);
    statusEffects.push({
      id: foundry.utils.randomID(), predefined: false, name: '', img: 'icons/svg/aura.svg', description: '',
    });
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
