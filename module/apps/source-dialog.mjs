import { grantSkillUsageFp, formatSkillFpGrantText } from '../helpers/skillFp.mjs';
import { postActionChatCard } from '../helpers/actions.mjs';
import { isCombatActive } from '../helpers/statusEffects.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The small "Quelle" (Source) window opened from a Character's own sheet
 * header - offers two independent, repeatable actions: "Quelle aktivieren"
 * (Source-Bound's own "sourceAbilityUsed" FP trigger) and "Ätherquelle
 * öffnen" (Ether-Bound's own "sourceOpened" FP trigger). Each spends its own
 * AP/Mana amount, directly editable inline (system.sourceAbilityApCost/
 * sourceAbilityManaCost, system.etherSourceApCost/etherSourceManaCost - see
 * data/actor-base.mjs), 0 being a valid, explicitly allowed cost. No usage
 * limit - like SKSKTotemDialog's own row actions, each click writes
 * immediately and the dialog stays open for repeat use.
 */
export class SKSKSourceDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'source-dialog'],
    window: { icon: 'fas fa-water' },
    position: { width: 380, height: 'auto' },
    actions: {
      activateSource: SKSKSourceDialog.#onActivateSource,
      openEtherSource: SKSKSourceDialog.#onOpenEtherSource,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/source-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.SourceDialog.Title')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.actor.system;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll('[data-source-cost]').forEach(el => {
      el.addEventListener('change', async event => {
        const field = event.target.dataset.sourceCost;
        await this.actor.update({ [`system.${field}`]: Math.max(0, Number(event.target.value) || 0) });
      });
    });
  }

  /**
   * Spend the given AP/Mana amounts, warning (and aborting, no changes
   * written) if either can't be afforded.
   * @param {Actor} actor
   * @param {number} apCost
   * @param {number} manaCost
   * @return {Promise<boolean>} Whether the cost was successfully paid.
   */
  static async #payCost(actor, apCost, manaCost) {
    // Outside of Combat entirely (see helpers/statusEffects.mjs#
    // isCombatActive), AP is never checked/spent at all - only Mana still
    // applies normally, mirroring helpers/technique-rolls.mjs#payTechniqueCost.
    const combatActive = isCombatActive();
    const ap = actor.system.actionPoints.value;
    if (combatActive && ap < apCost) {
      ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughAP'));
      return false;
    }
    const mana = actor.system.mana.value;
    if (mana < manaCost) {
      ui.notifications.warn(game.i18n.localize('SKSK.SourceDialog.NotEnoughMana'));
      return false;
    }
    const apUpdate = combatActive ? { 'system.actionPoints.value': ap - apCost } : {};
    await actor.update({ ...apUpdate, 'system.mana.value': mana - manaCost });
    return true;
  }

  static async #onActivateSource() {
    const apCost = this.actor.system.sourceAbilityApCost ?? 0;
    const manaCost = this.actor.system.sourceAbilityManaCost ?? 0;
    if (!(await SKSKSourceDialog.#payCost(this.actor, apCost, manaCost))) return;

    const grant = await grantSkillUsageFp(this.actor, 'sourceBound', 'sourceAbilityUsed');
    const costLine = `<div class="sksk-roll-line">${game.i18n.format('SKSK.SourceDialog.ActionCost', { ap: apCost, mana: manaCost })}</div>`;
    const grantText = formatSkillFpGrantText(grant);
    const gainLine = `<div class="sksk-roll-line">${grantText || game.i18n.localize('SKSK.SourceDialog.NoGain')}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.SourceDialog.ActivateSource'), null, 0, costLine + gainLine);
    this.render();
  }

  static async #onOpenEtherSource() {
    const apCost = this.actor.system.etherSourceApCost ?? 0;
    const manaCost = this.actor.system.etherSourceManaCost ?? 0;
    if (!(await SKSKSourceDialog.#payCost(this.actor, apCost, manaCost))) return;

    const grant = await grantSkillUsageFp(this.actor, 'etherBound', 'sourceOpened');
    const costLine = `<div class="sksk-roll-line">${game.i18n.format('SKSK.SourceDialog.ActionCost', { ap: apCost, mana: manaCost })}</div>`;
    const grantText = formatSkillFpGrantText(grant);
    const gainLine = `<div class="sksk-roll-line">${grantText || game.i18n.localize('SKSK.SourceDialog.NoGain')}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.SourceDialog.OpenEtherSource'), null, 0, costLine + gainLine);
    this.render();
  }
}
