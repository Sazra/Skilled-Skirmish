const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Every GM-configurable world setting this system defines (see
 * helpers/settings.mjs) - exported/imported together as one flat JSON blob
 * so a GM can back up or transfer a world's SKSK configuration (skill point
 * costs, carry weight formula, Materials/Models/Status Effects/Training
 * Methods lists) without manually re-entering everything.
 */
const EXPORTABLE_SETTINGS = [
  'skillPointsLevel5',
  'skillPointsLevel10',
  'carryWeightFormula',
  'materials',
  'weaponModels',
  'armorModels',
  'statusEffects',
  'trainingMethods',
];

/**
 * GM-only settings menu app for exporting the world's SKSK settings
 * (EXPORTABLE_SETTINGS above) to a downloadable JSON file, and importing
 * them back from one - e.g. to back up a world's configuration or copy it
 * to another world. Only the listed keys are ever touched; anything else in
 * an imported file's "settings" object is ignored.
 */
export class SKSKSettingsExportImport extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-settings-export-import',
    classes: ['sksk', 'settings-export-import'],
    window: {
      title: 'SKSK.Settings.ExportImport.Name',
      icon: 'fas fa-file-export',
    },
    position: { width: 420, height: 'auto' },
    actions: {
      exportSettings: SKSKSettingsExportImport.#exportSettings,
      importSettings: SKSKSettingsExportImport.#importSettings,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/sksk/templates/settings/export-import.hbs',
    },
  };

  /**
   * Gather every exportable setting's current value and trigger a JSON file
   * download via Foundry's own saveDataToFile helper.
   * @private
   */
  static #exportSettings(event, target) {
    const settings = {};
    for (const key of EXPORTABLE_SETTINGS) settings[key] = game.settings.get('sksk', key);
    const data = {
      system: 'sksk',
      systemVersion: game.system.version,
      exportedAt: new Date().toISOString(),
      settings,
    };
    const filename = `sksk-settings-${game.world.id}-${new Date().toISOString().slice(0, 10)}.json`;
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), 'application/json', filename);
  }

  /**
   * Prompt for a JSON file (previously produced by #exportSettings, or
   * hand-edited following the same shape), validate it, ask for
   * confirmation (this overwrites current settings, so treated as
   * destructive), then apply every recognized key.
   * @private
   */
  static async #importSettings(event, target) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;

      let data;
      try {
        data = JSON.parse(await foundry.utils.readTextFromFile(file));
      } catch (e) {
        ui.notifications.error(game.i18n.localize('SKSK.Settings.ExportImport.InvalidFile'));
        return;
      }
      if (!data?.settings || typeof data.settings !== 'object') {
        ui.notifications.error(game.i18n.localize('SKSK.Settings.ExportImport.InvalidFile'));
        return;
      }

      const importKeys = EXPORTABLE_SETTINGS.filter(key => key in data.settings);
      if (!importKeys.length) {
        ui.notifications.warn(game.i18n.localize('SKSK.Settings.ExportImport.NothingToImport'));
        return;
      }

      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize('SKSK.Settings.ExportImport.ImportConfirmTitle') },
        content: `<p>${game.i18n.format('SKSK.Settings.ExportImport.ImportConfirmContent', { count: importKeys.length })}</p>`,
      });
      if (!confirmed) return;

      for (const key of importKeys) await game.settings.set('sksk', key, data.settings[key]);
      ui.notifications.info(game.i18n.format('SKSK.Settings.ExportImport.ImportSuccess', { count: importKeys.length }));
    });
    input.click();
  }
}
