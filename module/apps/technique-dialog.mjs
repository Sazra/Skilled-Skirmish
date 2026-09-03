import {
  activateTechnique, getTechniqueStatusLabel, getTechniqueActionLabel, techniqueShowsEffectButton,
  getActiveStyleBonuses,
} from '../helpers/technique-rolls.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Techniken" (Techniques) window opened from a Character's or NPC's
 * own Actions tab - a list of every owned Technique Item (see data/
 * technique.mjs), each with its own Activate/Deactivate/Prime/Cancel
 * button (helpers/technique-rolls.mjs#activateTechnique), an Edit Effect
 * shortcut (whenever that Technique carries a linked ActiveEffect worth
 * editing), and the usual edit/delete controls - plus a "+" to create a new
 * one. Also shows each Technique's effective (combat-style-discounted)
 * Mana/AP/RP cost - colored the same way the Spells tab colors its own
 * (see actor-spells.hbs/_prepareSpells: blue Mana/green AP when currently
 * affordable) - and its cooldown, current/max while one is running, just
 * the max otherwise (omitted entirely for Techniques with no cooldown at
 * all). Unlike SKSKTotemDialog, this one DOES auto-refresh on relevant
 * external changes - see _onFirstRender/_onClose below - since a
 * Technique's own cooldown ticks down from outside this dialog entirely
 * (helpers/statusEffects.mjs#handleTechniqueTurnStart, at the actor's own
 * Combat turn start).
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
    position: { width: 760, height: 'auto' },
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
    const actor = this.actor;
    const ap = actor.system.actionPoints?.value ?? 0;
    const rp = actor.system.reactionPoints?.value ?? 0;
    const mana = actor.system.mana?.value ?? 0;

    context.techniques = actor.items.filter(i => i.type === 'technique').map(item => {
      // Same discount source payTechniqueCost itself uses (helpers/
      // technique-rolls.mjs) - the number shown here is exactly what
      // activating this Technique would actually cost right now.
      const discounts = getActiveStyleBonuses(actor, item.system.combatStyle);
      const effectiveApCost = Math.max(0, (item.system.apCost ?? 0) - discounts.apDiscount);
      const effectiveManaCost = Math.max(0, (item.system.manaCost ?? 0) - discounts.manaDiscount);
      // rpCost 0 means "not set" (mirrors apCost - see data/technique.mjs)
      // - only shown as its own line when it's actually a distinct value,
      // to avoid a redundant second number equal to the AP one above.
      const hasOwnRpCost = (item.system.rpCost ?? 0) > 0;

      const hasCooldown = (item.system.cooldownRounds ?? 0) > 0;
      const onCooldown = !item.system.active && (item.system.roundsRemaining ?? 0) > 0;

      return {
        item,
        categoryLabel: CONFIG.SKSK.techniqueCategories[item.system.category],
        statusLabel: getTechniqueStatusLabel(item),
        actionLabel: getTechniqueActionLabel(item),
        showEffectButton: techniqueShowsEffectButton(item),
        effectiveManaCost,
        effectiveApCost,
        effectiveRpCost: item.system.rpCost,
        hasOwnRpCost,
        manaAffordable: mana >= effectiveManaCost,
        apAffordable: ap >= effectiveApCost,
        rpAffordable: rp >= item.system.rpCost,
        hasCooldown,
        onCooldown,
      };
    });
    return context;
  }

  /**
   * Register once (not on every re-render) for external changes this
   * dialog needs to reflect but doesn't itself cause: any of this actor's
   * own Technique items being created/updated/deleted (covers both a
   * direct edit via the Item's own sheet - opened by this dialog's own
   * Edit button - and the turn-start cooldown/duration tick, which calls
   * item.update() from helpers/statusEffects.mjs entirely outside this
   * dialog), and this actor's own AP/Mana/RP changing (the Mana/AP/RP
   * cost lines' affordability coloring would otherwise silently go stale
   * the moment any of those pools change, e.g. from a weapon attack or a
   * rest). ApplicationV2 has no built-in auto-unhook, so the ids are
   * tracked on the instance and released in _onClose below.
   * @override
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const refreshIfOwnTechnique = item => {
      if (item.type === 'technique' && item.parent?.id === this.actor.id) this.render();
    };
    const refreshIfThisActor = actor => {
      if (actor.id === this.actor.id) this.render();
    };
    this._techniqueHooks = [
      { hook: 'updateItem', id: Hooks.on('updateItem', refreshIfOwnTechnique) },
      { hook: 'createItem', id: Hooks.on('createItem', refreshIfOwnTechnique) },
      { hook: 'deleteItem', id: Hooks.on('deleteItem', refreshIfOwnTechnique) },
      { hook: 'updateActor', id: Hooks.on('updateActor', refreshIfThisActor) },
    ];
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    for (const { hook, id } of this._techniqueHooks ?? []) Hooks.off(hook, id);
    this._techniqueHooks = [];
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
