const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only settings menu app bundling the system's three simple top-level
 * world settings (Skill Points for Level 10/5 Skills, Max Carry Weight
 * Formula) behind one menu button, instead of Foundry's core Settings
 * dialog rendering them as separate plain config:true fields at the bottom
 * of its own list - see helpers/settings.mjs, where all three are now
 * registered with config:false.
 */
export class SKSKGeneralSettingsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-general-settings-config',
    tag: 'form',
    classes: ['sksk', 'general-settings-config'],
    window: {
      title: 'SKSK.Settings.GeneralSettings.Name',
      icon: 'fas fa-sliders-h',
    },
    position: { width: 480, height: 'auto' },
    form: {
      handler: SKSKGeneralSettingsConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/sksk/templates/settings/general-settings-config.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.skillPointsLevel10 = game.settings.get('sksk', 'skillPointsLevel10');
    context.skillPointsLevel5 = game.settings.get('sksk', 'skillPointsLevel5');
    context.carryWeightFormula = game.settings.get('sksk', 'carryWeightFormula');
    return context;
  }

  /** @private */
  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    await game.settings.set('sksk', 'skillPointsLevel10', Number(data.skillPointsLevel10) || 0);
    await game.settings.set('sksk', 'skillPointsLevel5', Number(data.skillPointsLevel5) || 0);
    await game.settings.set('sksk', 'carryWeightFormula', data.carryWeightFormula ?? '');
  }
}
