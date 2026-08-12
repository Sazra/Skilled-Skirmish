import { grantSkillUsageFp, formatSkillFpGrantLine } from '../helpers/skillFp.mjs';
import { postActionChatCard } from '../helpers/actions.mjs';
import { grantMassKillFp, MASS_KILL_TIERS } from '../helpers/massacre.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Kill Tracking" window opened from a Character's or NPC's own GM tab -
 * covers both single-kill and mass-kill FP grants, fully manual GM judgment
 * calls independent of any damage roll:
 * - Mark Kill: picks one weapon-category skill (the only category with a
 *   configured "kill" rate - see apps/skill-usage-fp-config.mjs) and grants
 *   that Kill's FP directly. A counterpart to the automatic Kill FP grant
 *   already wired into helpers/damageApplication.mjs#applyDamageFromChat
 *   (triggered when Apply Damage brings a defender's Life and Negative Life
 *   both to their floor).
 * - Mass Kill: grants Massacre's own Mass Kill FP for killing a given
 *   number of people within (roughly) 10 minutes, the time window itself
 *   isn't tracked (see helpers/massacre.mjs#grantMassKillFp).
 * Previously two separate dialogs (Kill Dialog + an inline GM-tab button
 * row); merged into one window and neither auto-closes on grant, so the GM
 * can freely mix several grants in one sitting.
 */
export class SKSKMassKillDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    const skills = Object.keys(CONFIG.SKSK.skills.weapons ?? {});
    this.skillKey = skills[0] ?? '';
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'mass-kill-dialog'],
    window: { icon: 'fas fa-skull-crossbones' },
    position: { width: 360, height: 'auto' },
    actions: {
      confirmKill: SKSKMassKillDialog.#onConfirmKill,
      grantMassKillFp: SKSKMassKillDialog.#onGrantMassKill,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/mass-kill-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.GM.KillTrackingSectionTitle')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.skillChoices = CONFIG.SKSK.skills.weapons ?? {};
    context.skillKey = this.skillKey;
    context.massKillTiers = MASS_KILL_TIERS;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[data-kill-field="skillKey"]')?.addEventListener('change', event => {
      this.skillKey = event.target.value;
    });
  }

  static async #onConfirmKill(event, target) {
    if (!this.skillKey) return;
    const grant = await grantSkillUsageFp(this.actor, this.skillKey, 'kill');
    const extraHTML = formatSkillFpGrantLine(grant) || `<div class="sksk-roll-line">${game.i18n.localize('SKSK.KillDialog.NoGain')}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.KillDialog.Title'), null, 0, extraHTML);
  }

  static async #onGrantMassKill(event, target) {
    await grantMassKillFp(this.actor, Number(target.dataset.tier));
  }
}
