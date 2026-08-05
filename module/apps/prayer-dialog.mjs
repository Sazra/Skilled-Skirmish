import { grantSkillUsageFp, formatSkillFpGrantLine } from '../helpers/skillFp.mjs';
import { postActionChatCard } from '../helpers/actions.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The small "Gebet" (Prayer) window opened from a Character's own sheet
 * header - grants Faith's "prayer" FP trigger (see apps/skill-usage-fp-
 * config.mjs), scaled by however many hours the player says were spent
 * praying (rate × hours, same multiplier pattern as e.g. spellCastPerLevel
 * - see helpers/skillFp.mjs#grantSkillUsageFp). Like SKSKKillDialog,
 * nothing is written until Confirm is clicked.
 */
export class SKSKPrayerDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.hours = 1;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'prayer-dialog'],
    window: { icon: 'fas fa-hands-praying' },
    position: { width: 340, height: 'auto' },
    actions: {
      confirm: SKSKPrayerDialog.#onConfirm,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/prayer-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.PrayerDialog.Title')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.hours = this.hours;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[data-prayer-field="hours"]')?.addEventListener('change', event => {
      this.hours = Number(event.target.value) || 0;
    });
  }

  static async #onConfirm(event, target) {
    if (!(this.hours > 0)) return;
    const grant = await grantSkillUsageFp(this.actor, 'faith', 'prayer', this.hours);
    const extraHTML = formatSkillFpGrantLine(grant) || `<div class="sksk-roll-line">${game.i18n.localize('SKSK.PrayerDialog.NoGain')}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.PrayerDialog.Title'), null, 0, extraHTML);
    this.close();
  }
}
