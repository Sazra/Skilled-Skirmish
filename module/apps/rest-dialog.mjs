import { computeRestPreview, applyRest } from '../helpers/rest.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The small "spend time / take a Pause" window opened from an actor
 * sheet's header clock button. Its fields (segments/isBreak/charge
 * allocations) are transient dialog-only state, not actor data - nothing
 * is written to the actor until Confirm is clicked (helpers/rest.mjs#
 * applyRest), unlike the rest of the system's forms which submitOnChange
 * straight onto a document.
 */
export class SKSKRestDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.segments = 2;
    this.isBreak = true;
    this.regenForHealing = 0;
    this.regenForExhaustion = 0;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'rest-dialog'],
    window: { icon: 'fas fa-clock' },
    position: { width: 380, height: 'auto' },
    actions: {
      confirm: SKSKRestDialog.#onConfirm,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/rest-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.Rest.Title')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.segments = this.segments;
    context.isBreak = this.isBreak;
    context.regenForHealing = this.regenForHealing;
    context.regenForExhaustion = this.regenForExhaustion;
    Object.assign(context, computeRestPreview(this.actor, this));
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll('[data-rest-field]').forEach(el => {
      el.addEventListener('change', this.#onFieldChange.bind(this));
    });
  }

  /**
   * Update this dialog's own transient state from a changed input, then
   * re-render to refresh the live preview (mana gain, tier, charge maxima).
   * @param {Event} event
   */
  #onFieldChange(event) {
    const field = event.target.dataset.restField;
    if (field === 'segments') this.segments = Math.max(1, Number(event.target.value) || 1);
    else if (field === 'isBreak') this.isBreak = event.target.checked;
    else if (field === 'regenForHealing') this.regenForHealing = Math.max(0, Number(event.target.value) || 0);
    else if (field === 'regenForExhaustion') this.regenForExhaustion = Math.max(0, Number(event.target.value) || 0);
    this.render();
  }

  static async #onConfirm(event, target) {
    await applyRest(this.actor, {
      segments: this.segments,
      isBreak: this.isBreak,
      regenForHealing: this.regenForHealing,
      regenForExhaustion: this.regenForExhaustion,
    });
    this.close();
  }
}
