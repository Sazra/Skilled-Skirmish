import { grantSkillUsageFp, formatSkillFpGrantLine } from '../helpers/skillFp.mjs';
import { postActionChatCard } from '../helpers/actions.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The small "Kill markieren" window opened from a Character's own GM tab -
 * a fully manual counterpart to the automatic Kill FP grant already wired
 * into helpers/damageApplication.mjs#applyDamageFromChat (triggered when
 * Apply Damage actually brings a defender's Life and Negative Life both to
 * their floor). The GM picks one weapon-category skill (the only category
 * with a configured "kill" rate - see apps/skill-usage-fp-config.mjs) and
 * grants that Kill's FP directly, independent of any damage roll at all.
 * Like SKSKTrainingDialog, nothing is written until Confirm is clicked.
 */
export class SKSKKillDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    const skills = Object.keys(CONFIG.SKSK.skills.weapons ?? {});
    this.skillKey = skills[0] ?? '';
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'kill-dialog'],
    window: { icon: 'fas fa-skull' },
    position: { width: 340, height: 'auto' },
    actions: {
      confirm: SKSKKillDialog.#onConfirm,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/kill-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.KillDialog.Title')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.skillChoices = CONFIG.SKSK.skills.weapons ?? {};
    context.skillKey = this.skillKey;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[data-kill-field="skillKey"]')?.addEventListener('change', event => {
      this.skillKey = event.target.value;
    });
  }

  static async #onConfirm(event, target) {
    if (!this.skillKey) return;
    const grant = await grantSkillUsageFp(this.actor, this.skillKey, 'kill');
    const extraHTML = formatSkillFpGrantLine(grant) || `<div class="sksk-roll-line">${game.i18n.localize('SKSK.KillDialog.NoGain')}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.KillDialog.Title'), null, 0, extraHTML);
    this.close();
  }
}
