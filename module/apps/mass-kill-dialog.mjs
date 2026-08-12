import { grantMassKillFp, MASS_KILL_TIERS } from '../helpers/massacre.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Mass Kill" window opened from a Character's or NPC's own GM tab - a
 * fully manual GM judgment call granting Massacre's own Mass Kill FP for
 * killing a given number of people within (roughly) 10 minutes, the time
 * window itself isn't tracked (see helpers/massacre.mjs#grantMassKillFp).
 * Previously an inline button row on the GM tab itself; moved into its own
 * window to keep that tab shorter.
 */
export class SKSKMassKillDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'mass-kill-dialog'],
    window: { icon: 'fas fa-skull-crossbones' },
    position: { width: 340, height: 'auto' },
    actions: {
      grantMassKillFp: SKSKMassKillDialog.#onGrant,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/mass-kill-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.MassKill.SectionTitle')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.massKillTiers = MASS_KILL_TIERS;
    return context;
  }

  static async #onGrant(event, target) {
    await grantMassKillFp(this.actor, Number(target.dataset.tier));
  }
}
