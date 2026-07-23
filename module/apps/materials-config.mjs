const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A non-negative number, or the literal string "?" (meaning each
 * Item/Armor/Weapon using this material sets its own value instead - see
 * helpers/materials.mjs). Anything else input by the GM is coerced to 0.
 * @param {*} value
 * @return {number|string}
 */
function sanitizeMaterialValue(value) {
  if (value === '?') return '?';
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

/**
 * GM-only settings menu app for managing the world's list of materials
 * (see helpers/materials.mjs). A plain world setting (an untyped Array)
 * has no native config UI, so this provides one, following the same
 * add/remove-array-entry pattern used on Actor/Item sheets throughout the
 * system - just against a world setting instead of a document.
 */
export class SKSKMaterialsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-materials-config',
    tag: 'form',
    // "materials-config" carries the CSS (see sksk.css) making the window
    // content scroll - the scrollable: [''] PARTS option only persists
    // scroll position across re-renders, it doesn't make anything
    // actually scrollable by itself.
    classes: ['sksk', 'materials-config'],
    window: {
      title: 'SKSK.Settings.Materials.Name',
      icon: 'fas fa-gem',
    },
    position: { width: 500, height: 'auto' },
    form: {
      handler: SKSKMaterialsConfig.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addMaterial: SKSKMaterialsConfig.#addMaterial,
      removeMaterial: SKSKMaterialsConfig.#removeMaterial,
    },
  };

  /** @override */
  static PARTS = {
    form: {
      template: 'systems/sksk/templates/settings/materials-config.hbs',
      scrollable: [''],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.materials = game.settings.get('sksk', 'materials') ?? [];
    return context;
  }

  /**
   * Parse the submitted form's flat "materials.<index>.<field>" keys back
   * into an array and persist it as the world setting.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const materials = Object.values(expanded.materials ?? {}).map(m => ({
      name: m.name ?? '',
      materialBonus: sanitizeMaterialValue(m.materialBonus),
      manaCapacity: sanitizeMaterialValue(m.manaCapacity),
    }));
    await game.settings.set('sksk', 'materials', materials);
  }

  /** @private */
  static async #addMaterial(event, target) {
    const materials = foundry.utils.deepClone(game.settings.get('sksk', 'materials') ?? []);
    materials.push({ name: '', materialBonus: 0, manaCapacity: 0 });
    await game.settings.set('sksk', 'materials', materials);
    this.render();
  }

  /** @private */
  static async #removeMaterial(event, target) {
    const index = Number(target.dataset.index);
    const materials = foundry.utils.deepClone(game.settings.get('sksk', 'materials') ?? []);
    materials.splice(index, 1);
    await game.settings.set('sksk', 'materials', materials);
    this.render();
  }
}
