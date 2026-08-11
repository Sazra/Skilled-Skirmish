import {
  activateTechnique, getTechniqueStatusLabel, getTechniqueActionLabel, techniqueShowsEffectButton,
} from '../helpers/technique-rolls.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Techniken" (Techniques) window opened from a Character's or NPC's
 * own Actions tab - a list of every owned Technique Item (see data/
 * technique.mjs), each with its own Activate/Deactivate/Prime/Cancel
 * button (helpers/technique-rolls.mjs#activateTechnique), an Edit Effect
 * shortcut (whenever that Technique carries a linked ActiveEffect worth
 * editing), and the usual edit/delete controls - plus a "+" to create a new
 * one. Like SKSKTotemDialog, every action writes immediately and manually
 * re-renders; the dialog itself does not auto-refresh on unrelated actor/
 * item updates from elsewhere.
 */
export class SKSKTechniqueDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'technique-dialog'],
    window: { icon: 'fas fa-fist-raised' },
    position: { width: 640, height: 'auto' },
    actions: {
      activateTechnique: SKSKTechniqueDialog.#onActivate,
      openTechniqueEffect: SKSKTechniqueDialog.#onOpenEffect,
      editTechnique: SKSKTechniqueDialog.#onEdit,
      deleteTechnique: SKSKTechniqueDialog.#onDelete,
      createTechnique: SKSKTechniqueDialog.#onCreate,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/technique-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.Technique.SectionTitle')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.techniques = this.actor.items.filter(i => i.type === 'technique').map(item => ({
      item,
      categoryLabel: CONFIG.SKSK.techniqueCategories[item.system.category],
      statusLabel: getTechniqueStatusLabel(item),
      actionLabel: getTechniqueActionLabel(item),
      showEffectButton: techniqueShowsEffectButton(item),
    }));
    return context;
  }

  static async #onActivate(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) await activateTechnique(this.actor, item);
    this.render();
  }

  static async #onOpenEffect(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    const effect = item?.system.effectId ? this.actor.effects.get(item.system.effectId) : null;
    if (!effect) return ui.notifications.warn(game.i18n.localize('SKSK.Technique.NoEffectYet'));
    effect.sheet.render(true);
  }

  static #onEdit(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    item?.sheet.render(true);
  }

  static async #onDelete(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item) await item.delete();
    this.render();
  }

  static async #onCreate(event, target) {
    const [item] = await this.actor.createEmbeddedDocuments('Item', [{
      name: game.i18n.format('DOCUMENT.New', { type: game.i18n.localize('TYPES.Item.technique') }),
      type: 'technique',
    }]);
    item.sheet.render(true);
    this.render();
  }
}
