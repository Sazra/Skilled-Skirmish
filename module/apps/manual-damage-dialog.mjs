import { rollAndApplyManualDamage } from '../helpers/damageApplication.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Manueller Schaden" (Manual Damage) window - opened from a header
 * button next to the toolbar toggle (see sheets/actor-sheet.mjs#
 * _renderFrame), available to any Character or NPC sheet regardless of
 * who owns it. Lets a GM or player type in one or more freeform damage
 * entries (a flat number or a dice formula, each with its own damage
 * element) and, on confirm, roll and apply them through the exact same
 * Resistance/Weakness/Immunity/Absorption pipeline a weapon/spell's own
 * "Apply Damage" button uses (see helpers/damageApplication.mjs#
 * rollAndApplyManualDamage) - e.g. narrative/environmental damage the GM
 * calls for that isn't tied to any Item roll. Not bound to any particular
 * actor at all; the target is resolved the same way a chat "Apply Damage"
 * button's own click always is (resolveClickDefender), only once Roll &
 * Apply is actually clicked.
 *
 * A plain in-memory entries list (this.entries), never persisted anywhere -
 * every field auto-submits into it via the standard submitOnChange form
 * pattern (mirrors apps/martial-arts-attacks-dialog.mjs, just kept in
 * memory here instead of written to an actor), so Add/Remove Entry always
 * mutates the latest typed values rather than a stale snapshot.
 */
export class SKSKManualDamageDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.entries = [{ formula: '', damageType: Object.keys(CONFIG.SKSK.damageTypes)[0] ?? '' }];
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'sksk-manual-damage-dialog',
    tag: 'form',
    classes: ['sksk', 'manual-damage-dialog'],
    window: { title: 'SKSK.ManualDamage.Title', icon: 'fas fa-heart-crack' },
    position: { width: 480, height: 'auto' },
    form: {
      handler: SKSKManualDamageDialog.#onSubmit,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      addManualDamageEntry: SKSKManualDamageDialog.#onAddEntry,
      removeManualDamageEntry: SKSKManualDamageDialog.#onRemoveEntry,
      rollAndApplyManualDamage: SKSKManualDamageDialog.#onRollAndApply,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/manual-damage-dialog.hbs' },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.entries = this.entries;
    context.damageTypeChoices = CONFIG.SKSK.damageTypes;
    return context;
  }

  /**
   * Parse the submitted form's flat "entries.<index>.<field>" keys back
   * into this.entries, mirroring apps/martial-arts-attacks-dialog.mjs's
   * own identical parsing (just kept in memory rather than persisted).
   * @private
   */
  static #onSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const raw = expanded.entries ?? {};
    this.entries = Object.keys(raw).sort((a, b) => Number(a) - Number(b)).map(index => ({
      formula: raw[index].formula ?? '',
      damageType: raw[index].damageType ?? '',
    }));
  }

  /** Append a blank entry, defaulting its damage type to the first row's own (if any). */
  static #onAddEntry(event, target) {
    this.entries.push({ formula: '', damageType: this.entries[0]?.damageType ?? Object.keys(CONFIG.SKSK.damageTypes)[0] ?? '' });
    this.render();
  }

  /** Remove one entry, keeping at least one row so the form is never empty. */
  static #onRemoveEntry(event, target) {
    this.entries.splice(Number(target.dataset.index), 1);
    if (!this.entries.length) this.entries.push({ formula: '', damageType: Object.keys(CONFIG.SKSK.damageTypes)[0] ?? '' });
    this.render();
  }

  /** Roll and apply every entry (see helpers/damageApplication.mjs#rollAndApplyManualDamage), then close. */
  static async #onRollAndApply(event, target) {
    await rollAndApplyManualDamage(this.entries);
    this.close();
  }
}
