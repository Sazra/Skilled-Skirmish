import { getTrainingMethods, computeTrainingPreview, applyTraining } from '../helpers/training.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The small "Training" window opened from a Character sheet's header
 * dumbbell button - lets the player pick one of the GM-configured Training
 * methods (see helpers/training.mjs) and how many hours to train, with a
 * live preview of the FP each trained skill would gain. Like
 * SKSKRestDialog, its fields are transient dialog-only state; nothing is
 * written to the actor until Confirm is clicked (helpers/training.mjs#
 * applyTraining).
 */
export class SKSKTrainingDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    const methods = getTrainingMethods();
    this.methodId = methods[0]?.id ?? '';
    this.hours = 1;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'training-dialog'],
    window: { icon: 'fas fa-dumbbell' },
    position: { width: 380, height: 'auto' },
    actions: {
      confirm: SKSKTrainingDialog.#onConfirm,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/training-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.Training.Title')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const methods = getTrainingMethods();
    const method = methods.find(m => m.id === this.methodId) ?? null;
    context.methods = methods;
    context.methodId = this.methodId;
    context.hours = this.hours;
    context.preview = computeTrainingPreview(method, this.hours);
    context.noMethods = methods.length === 0;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll('[data-training-field]').forEach(el => {
      el.addEventListener('change', this.#onFieldChange.bind(this));
    });
  }

  /**
   * Update this dialog's own transient state from a changed input, then
   * re-render to refresh the live FP preview.
   * @param {Event} event
   */
  #onFieldChange(event) {
    const field = event.target.dataset.trainingField;
    if (field === 'methodId') this.methodId = event.target.value;
    else if (field === 'hours') this.hours = Math.max(0, Number(event.target.value) || 0);
    this.render();
  }

  static async #onConfirm(event, target) {
    if (!this.methodId) return;
    await applyTraining(this.actor, { methodId: this.methodId, hours: this.hours });
    this.close();
  }
}
