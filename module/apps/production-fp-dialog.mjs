import { grantAlchemyFp, grantCraftingFp, grantCookingFp, grantEnchantingFp } from '../helpers/productionFp.mjs';
import { formatSkillFpGrantText } from '../helpers/skillFp.mjs';
import { postActionChatCard } from '../helpers/actions.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Herstellungs-FP" (Production FP) window opened from a Character's
 * own sheet header - one section per Production skill (Alchemie/
 * Herstellung/Kochen/Verzauberung), each a plain, non-persisted number
 * input or two (quality%, and for Alchemie/Verzauberung an essence count/
 * ritual-hours field) read fresh off the DOM on click - no cost, no usage
 * limit, matching apps/source-dialog.mjs's own repeat-use convention. See
 * helpers/productionFp.mjs for the actual FP math.
 */
export class SKSKProductionFpDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'production-fp-dialog'],
    window: { icon: 'fas fa-hammer' },
    position: { width: 380, height: 'auto' },
    actions: {
      grantAlchemy: SKSKProductionFpDialog.#onGrantAlchemy,
      grantCrafting: SKSKProductionFpDialog.#onGrantCrafting,
      grantCooking: SKSKProductionFpDialog.#onGrantCooking,
      grantEnchanting: SKSKProductionFpDialog.#onGrantEnchanting,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/production-fp-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.ProductionFp.Title')}: ${this.actor.name}`;
  }

  static async #onGrantAlchemy() {
    const essences = Number(this.element.querySelector('[name="essences"]').value) || 0;
    const quality = Number(this.element.querySelector('[name="alchemyQuality"]').value) || 0;
    const grant = await grantAlchemyFp(this.actor, essences, quality);
    const grantText = formatSkillFpGrantText(grant);
    const line = `<div class="sksk-roll-line">${grantText || game.i18n.localize('SKSK.ProductionFp.NoGain')}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.ProductionFp.Alchemy'), null, 0, line);
  }

  static async #onGrantCrafting() {
    const quality = Number(this.element.querySelector('[name="craftingQuality"]').value) || 0;
    const grant = await grantCraftingFp(this.actor, quality);
    const grantText = formatSkillFpGrantText(grant);
    const line = `<div class="sksk-roll-line">${grantText || game.i18n.localize('SKSK.ProductionFp.NoGain')}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.ProductionFp.Crafting'), null, 0, line);
  }

  static async #onGrantCooking() {
    const quality = Number(this.element.querySelector('[name="cookingQuality"]').value) || 0;
    const grant = await grantCookingFp(this.actor, quality);
    const grantText = formatSkillFpGrantText(grant);
    const line = `<div class="sksk-roll-line">${grantText || game.i18n.localize('SKSK.ProductionFp.NoGain')}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.ProductionFp.Cooking'), null, 0, line);
  }

  static async #onGrantEnchanting() {
    const quality = Number(this.element.querySelector('[name="enchantingQuality"]').value) || 0;
    const hours = Number(this.element.querySelector('[name="enchantingHours"]').value) || 0;
    const { enchanting, ritualism } = await grantEnchantingFp(this.actor, quality, hours);
    const line = [formatSkillFpGrantText(enchanting), formatSkillFpGrantText(ritualism)]
      .filter(Boolean).map(text => `<div class="sksk-roll-line">${text}</div>`).join('');
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.ProductionFp.Enchanting'), null, 0,
      line || `<div class="sksk-roll-line">${game.i18n.localize('SKSK.ProductionFp.NoGain')}</div>`);
  }
}
