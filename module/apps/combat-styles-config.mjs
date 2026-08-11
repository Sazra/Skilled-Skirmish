const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only settings menu app for managing the world's list of Kampfstile
 * (combat/technique styles - see data/technique.mjs). A plain world setting
 * (an untyped Array) has no native config UI, so this provides one,
 * following the same add/remove-array-entry pattern as apps/training-
 * methods-config.mjs. Each style is just {id, name} - a Technique item
 * stores the chosen style's id and resolves it against this live list at
 * render/roll time, same convention as Training Methods.
 */
export class SKSKCombatStylesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-combat-styles-config',
    tag: 'form',
    classes: ['sksk', 'combat-styles-config'],
    window: {
      title: 'SKSK.Settings.CombatStyles.Name',
      icon: 'fas fa-fist-raised',
    },
    position: { width: 420, height: 'auto' },
    form: {
      handler: SKSKCombatStylesConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addStyle: SKSKCombatStylesConfig.#addStyle,
      removeStyle: SKSKCombatStylesConfig.#removeStyle,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/sksk/templates/settings/combat-styles-config.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.styles = game.settings.get('sksk', 'combatStyles') ?? [];
    return context;
  }

  /**
   * Parse the submitted form's flat "styles.<index>.name" keys back into an
   * array and persist it - ids are carried over from the existing stored
   * value (not form fields) so they stay stable.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const existing = game.settings.get('sksk', 'combatStyles') ?? [];
    const styles = Object.entries(expanded.styles ?? {}).map(([index, s]) => ({
      id: existing[index]?.id ?? foundry.utils.randomID(),
      name: s.name ?? '',
    }));
    await game.settings.set('sksk', 'combatStyles', styles);
  }

  /** @private */
  static async #addStyle(event, target) {
    const styles = foundry.utils.deepClone(game.settings.get('sksk', 'combatStyles') ?? []);
    styles.push({ id: foundry.utils.randomID(), name: '' });
    await game.settings.set('sksk', 'combatStyles', styles);
    this.render();
  }

  /** @private */
  static async #removeStyle(event, target) {
    const index = Number(target.dataset.index);
    const styles = foundry.utils.deepClone(game.settings.get('sksk', 'combatStyles') ?? []);
    styles.splice(index, 1);
    await game.settings.set('sksk', 'combatStyles', styles);
    this.render();
  }
}
