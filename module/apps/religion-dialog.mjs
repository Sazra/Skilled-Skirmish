import { grantSkillUsageFp, formatSkillFpGrantText } from '../helpers/skillFp.mjs';
import { postActionChatCard } from '../helpers/actions.mjs';
import { getWorldDeities, getDeityById } from '../helpers/religion.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Religion" window opened from a Character's own sheet header -
 * replaces the old "Gebet" (Prayer) window. Lets the player choose their
 * Patron (system.religion.patronId, written immediately on change - see
 * data/actor-base.mjs#religion), read that Patron's description/domains/
 * elements, perform the original hours-of-prayer FP grant unchanged (see
 * helpers/skillFp.mjs#grantSkillUsageFp), and pick one of the Patron's
 * configured "Dinge und Taten" (deeds) to immediately adjust their Glaube
 * (faith) skill's own invested points (positive or negative) - unlike
 * Prayer's FP, deeds are discrete events, not a rate to be trained, so they
 * write system.skills.faith.points directly rather than through the
 * pending "gain" pool.
 */
export class SKSKReligionDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.hours = 1;
    this.deedId = '';
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'religion-dialog'],
    window: { icon: 'fas fa-hands-praying' },
    position: { width: 380, height: 'auto' },
    actions: {
      confirmPrayer: SKSKReligionDialog.#onConfirmPrayer,
      confirmDeed: SKSKReligionDialog.#onConfirmDeed,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/religion-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.Religion.Title')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.hours = this.hours;

    const patronId = this.actor.system.religion.patronId;
    context.patronChoices = { '': game.i18n.localize('SKSK.Religion.NoPatron') };
    for (const deity of getWorldDeities()) context.patronChoices[deity.id] = deity.name;
    context.patronId = patronId;

    const patron = getDeityById(patronId);
    context.patron = patron;
    context.domains = patron?.domains?.filter(d => d) ?? [];
    context.elementLabels = (patron?.elements ?? []).map(key => game.i18n.localize(CONFIG.SKSK.damageTypes[key] ?? key));

    context.deedChoices = { '': game.i18n.localize('SKSK.Religion.SelectDeed') };
    for (const deed of patron?.deeds ?? []) context.deedChoices[deed.id] = deed.name;
    context.deedId = this.deedId;

    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[data-religion-field="hours"]')?.addEventListener('change', event => {
      this.hours = Number(event.target.value) || 0;
    });
    this.element.querySelector('[data-religion-field="patronId"]')?.addEventListener('change', async event => {
      this.deedId = '';
      await this.actor.update({ 'system.religion.patronId': event.target.value });
      this.render();
    });
    this.element.querySelector('[data-religion-field="deedId"]')?.addEventListener('change', event => {
      this.deedId = event.target.value;
    });
  }

  static async #onConfirmPrayer(event, target) {
    if (!(this.hours > 0)) return;
    const grant = await grantSkillUsageFp(this.actor, 'faith', 'prayer', this.hours);
    const grantText = formatSkillFpGrantText(grant) || game.i18n.localize('SKSK.Religion.NoGain');
    const description = `${game.i18n.format('SKSK.Religion.PrayerDescription', { name: this.actor.name, hours: this.hours })} ${grantText}`;
    const extraHTML = `<div class="sksk-roll-description">${description}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.Religion.PrayerTitle'), null, 0, extraHTML);
  }

  static async #onConfirmDeed(event, target) {
    const patron = getDeityById(this.actor.system.religion.patronId);
    const deed = patron?.deeds?.find(d => d.id === this.deedId);
    if (!deed) return;
    const current = this.actor.system.skills.faith?.points ?? 0;
    await this.actor.update({ 'system.skills.faith.points': Math.max(0, current + deed.amount) });
    const description = game.i18n.format('SKSK.Religion.DeedDescription', {
      name: this.actor.name, deed: deed.name, amount: deed.amount,
    });
    const extraHTML = `<div class="sksk-roll-description">${description}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.Religion.DeedTitle'), null, 0, extraHTML);
  }
}
