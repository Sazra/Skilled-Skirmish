const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Kampfkunstangriffe" (Martial Arts Attacks) window opened from a
 * Character's or NPC's own GM tab - the actor's own GM-defined list of
 * Martial Arts Attacks (see data/actor-base.mjs#martialArtsAttacks), each
 * with its own formula/AP cost/attribute usage/damage type/attribute
 * checkboxes, used by the Actions tab's own roll button. Previously inline
 * on the GM tab itself; moved into its own window to keep that tab
 * shorter. Unlike the manual-write dialogs elsewhere (Totem/Summoning),
 * this is a real <form> with submitOnChange - every field auto-saves the
 * same way it already did as part of the actor sheet's own form, just via
 * an explicit submit handler since a plain (non-document) ApplicationV2
 * doesn't get that for free.
 */
export class SKSKMartialArtsAttacksDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    tag: 'form',
    classes: ['sksk', 'martial-arts-attacks-dialog'],
    window: { icon: 'fas fa-hand-fist' },
    position: { width: 560, height: 'auto' },
    form: {
      handler: SKSKMartialArtsAttacksDialog.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addMartialArtsAttack: SKSKMartialArtsAttacksDialog.#onAdd,
      removeMartialArtsAttack: SKSKMartialArtsAttacksDialog.#onRemove,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/martial-arts-attacks-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.MartialArtsAttack.SectionTitle')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.actor.system;
    context.attributeChoices = CONFIG.SKSK.attributes;
    context.attributeUsageChoices = CONFIG.SKSK.attributeUsageTypes;
    context.damageTypeChoices = CONFIG.SKSK.damageTypes;
    return context;
  }

  /**
   * Parse the submitted form's flat "martialArtsAttacks.<index>.<field>"
   * keys back into an array and persist it, mirroring the schema at
   * data/actor-base.mjs#martialArtsAttacks.
   * @private
   */
  static async #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const entries = expanded.martialArtsAttacks ?? {};
    const attacks = Object.keys(entries).sort((a, b) => Number(a) - Number(b)).map(index => {
      const entry = entries[index];
      return {
        name: entry.name ?? '',
        formula: entry.formula ?? '',
        apCost: Number(entry.apCost) || 0,
        damageType: entry.damageType ?? 'blunt',
        attributeUsage: entry.attributeUsage ?? 'highestMultiple',
        attributes: Object.fromEntries(
          Object.keys(CONFIG.SKSK.attributes).map(key => [key, !!entry.attributes?.[key]])
        ),
      };
    });
    await this.actor.update({ 'system.martialArtsAttacks': attacks });
  }

  /** Append a blank entry - same defaults as the old GM-tab button. */
  static async #onAdd(event, target) {
    const current = foundry.utils.deepClone(this.actor.system.martialArtsAttacks ?? []);
    const attributes = Object.fromEntries(Object.keys(CONFIG.SKSK.attributes).map(key => [key, false]));
    current.push({ name: '', formula: '1d4', apCost: 0, attributes, attributeUsage: 'highestMultiple' });
    await this.actor.update({ 'system.martialArtsAttacks': current });
    this.render();
  }

  static async #onRemove(event, target) {
    const index = Number(target.dataset.index);
    const current = foundry.utils.deepClone(this.actor.system.martialArtsAttacks ?? []);
    current.splice(index, 1);
    await this.actor.update({ 'system.martialArtsAttacks': current });
    this.render();
  }
}
