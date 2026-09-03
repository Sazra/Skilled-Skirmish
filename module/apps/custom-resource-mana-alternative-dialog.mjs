const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The small "Mana-Alternative" sub-window for one row of the General tab's
 * "Zusätzliche Ressourcen" list (templates/actor/parts/general-overview.hbs)
 * - holds that resource's roll-formula abbreviation (data/actor-base.mjs#
 * customResources.abbreviation) and its full "used instead of Mana" config,
 * out of the way of the row's own compact Name/Value/Max columns. Opened via
 * a small gear icon next to the resource's name. Like
 * SKSKMartialArtsAttacksDialog, this is a real <form> with submitOnChange -
 * every field auto-saves via an explicit submit handler since a plain
 * (non-document) ApplicationV2 doesn't get that for free.
 */
export class SKSKCustomResourceManaAlternativeDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, index, options = {}) {
    super(options);
    this.actor = actor;
    this.index = index;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    tag: 'form',
    classes: ['sksk', 'custom-resource-mana-alternative-dialog'],
    window: { icon: 'fas fa-gear' },
    position: { width: 380, height: 'auto' },
    form: {
      handler: SKSKCustomResourceManaAlternativeDialog.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/custom-resource-mana-alternative-dialog.hbs' },
  };

  /**
   * The live resource entry this dialog edits - re-read from the actor
   * every time (rather than cached at construction) so the dialog always
   * reflects the actor's current state, including its own last submit.
   * @return {object|undefined}
   */
  get entry() {
    return this.actor.system.customResources?.[this.index];
  }

  /** @override */
  get title() {
    const name = this.entry?.name || game.i18n.localize('SKSK.General.AdditionalResources');
    return `${game.i18n.localize('SKSK.General.ManaAlternativeDialogTitle')}: ${name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.entry = this.entry;
    context.manaAlternativeModeChoices = CONFIG.SKSK.manaAlternativeModes;
    return context;
  }

  /**
   * Merge the submitted fields into this dialog's own customResources
   * entry (by index) and persist the whole array, mirroring the schema at
   * data/actor-base.mjs#customResources. A no-op if the entry was removed
   * (e.g. deleted from the parent sheet's row) while this dialog stayed
   * open.
   *
   * Explicitly re-renders afterward - unlike a DocumentSheetV2 bound to
   * the edited document itself, a plain ApplicationV2's submitOnChange
   * does NOT auto-refresh the template on its own (confirmed live), and
   * this one's own isManaAlternative/manaAlternativeMode fields gate other
   * fields' visibility via {{#if}}, which needs that refresh to show.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const resources = foundry.utils.deepClone(this.actor.system.customResources ?? []);
    if (!resources[this.index]) return;
    const submitted = foundry.utils.expandObject(formData.object);
    foundry.utils.mergeObject(resources[this.index], submitted);
    await this.actor.update({ 'system.customResources': resources });
    this.render();
  }
}
