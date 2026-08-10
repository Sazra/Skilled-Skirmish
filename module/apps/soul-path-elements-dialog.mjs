const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The small "Elemente" (Elements) window opened from a Soul Path Item's own
 * Properties tab - a plain checkbox list over CONFIG.SKSK.pathElements (see
 * helpers/config.mjs), replacing a native <select multiple> (which this
 * codebase has no other precedent for and reads awkwardly for ~39 options).
 * Like SKSKTotemDialog/SKSKSourceDialog's own row actions, each checkbox
 * writes system.elements immediately; the dialog stays open for repeat use.
 */
export class SKSKSoulPathElementsDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(item, options = {}) {
    super(options);
    this.item = item;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'soul-path-elements-dialog'],
    window: { icon: 'fas fa-fire' },
    position: { width: 420, height: 'auto' },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/soul-path-elements-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.SoulPath.Elements')}: ${this.item.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const selected = new Set(this.item.system.elements ?? []);
    context.elements = Object.entries(CONFIG.SKSK.pathElements).map(([key, label]) => ({
      key, label, checked: selected.has(key),
    }));
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll('.soul-path-element-checkbox').forEach(el => {
      el.addEventListener('change', async event => {
        const current = new Set(this.item.system.elements ?? []);
        if (event.target.checked) current.add(event.target.dataset.key);
        else current.delete(event.target.dataset.key);
        await this.item.update({ 'system.elements': Array.from(current) });
      });
    });
  }
}
