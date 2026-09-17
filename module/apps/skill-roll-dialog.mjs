import { GENERIC_ROLL_MODES } from '../helpers/criticalRolls.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The combined "which attribute(s), then which roll mode" prompt for a
 * skill with more than one possible attribute (see helpers/skillRolls.mjs#
 * chooseSkillRollAttributeAndMode) - a small stateful dialog rather than a
 * one-shot DialogV2.wait, since DialogV2's own buttons always resolve (and
 * close) the dialog on click, with no way for one to merely toggle some
 * internal state and keep the dialog open. The mode buttons (Neutral/
 * Vorteil/Nachteil) do exactly that: clicking one just switches which mode
 * is "active" (normal, the other two dimmed - Neutral active by default)
 * and re-renders, never closing the dialog. The attribute buttons below
 * always render normally (never dimmed) and, clicked, immediately resolve
 * the whole dialog with {index, mode: <whichever mode is currently
 * active>} - one click to actually roll, restoring the pre-existing
 * button-based convention (see helpers/criticalRolls.mjs#
 * chooseGenericRollMode, still used as-is for single-attribute skills)
 * instead of the dropdown-based version this replaces.
 */
export class SKSKSkillRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {string} title
   * @param {string} promptKey   Lang key for the attribute section's own label.
   * @param {Array<{index: number, label: string}>} attributeOptions
   * @param {object} [options]
   */
  constructor(title, promptKey, attributeOptions, options = {}) {
    super(options);
    this._title = title;
    this.promptKey = promptKey;
    this.attributeOptions = attributeOptions;
    this.mode = 'neutral';
    this._resolve = null;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    tag: 'form',
    classes: ['sksk', 'skill-roll-dialog'],
    window: { icon: 'fas fa-dice-d20' },
    position: { width: 340, height: 'auto' },
    actions: {
      chooseMode: SKSKSkillRollDialog.#onChooseMode,
      rollAttribute: SKSKSkillRollDialog.#onRollAttribute,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/skill-roll-dialog.hbs' },
  };

  /** @override */
  get title() {
    return this._title;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.promptKey = this.promptKey;
    context.modes = GENERIC_ROLL_MODES.map(mode => ({ ...mode, active: mode.id === this.mode }));
    context.attributeOptions = this.attributeOptions;
    return context;
  }

  static #onChooseMode(event, target) {
    this.mode = target.dataset.mode;
    this.render();
  }

  static #onRollAttribute(event, target) {
    const index = Number(target.dataset.index);
    this._resolve?.({ index, mode: this.mode });
    this._resolve = null;
    this.close();
  }

  /**
   * Resolves with null if the dialog is closed (window X, Escape) without
   * an attribute button ever being clicked - a no-op if #onRollAttribute
   * already resolved it (this.close() there triggers this too).
   * @override
   */
  _onClose(options) {
    super._onClose(options);
    this._resolve?.(null);
    this._resolve = null;
  }

  /**
   * Show the dialog and resolve once an attribute button is clicked (or
   * null if closed without one) - the same Promise-returning shape as
   * DialogV2.wait, so helpers/skillRolls.mjs#chooseSkillRollAttributeAndMode
   * can swap implementations without its own caller (sheets/actor-sheet.mjs#
   * rollSkill) needing any change.
   * @param {string} title
   * @param {string} promptKey
   * @param {Array<{index: number, label: string}>} attributeOptions
   * @return {Promise<{index: number, mode: string}|null>}
   */
  static wait(title, promptKey, attributeOptions) {
    return new Promise(resolve => {
      const app = new SKSKSkillRollDialog(title, promptKey, attributeOptions);
      app._resolve = resolve;
      app.render(true);
    });
  }
}
