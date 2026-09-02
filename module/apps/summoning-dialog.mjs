import { grantSkillUsageFp } from '../helpers/skillFp.mjs';
import { getSkillLabel } from '../helpers/skills.mjs';
import { postActionChatCard } from '../helpers/actions.mjs';
import { getResizedSummons } from '../helpers/summoning.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Beschwörung" (Summoning) window opened from a Character's own sheet
 * header - a list of summon slots sized to the Willpower modifier (GM-tab
 * adjustable via system.summonSlotsBonus/summonSlotsMultiplier - see
 * helpers/summoning.mjs#computeSummonSlots). An empty slot lets the player
 * freely name a summon (orientation only) and set its Level; "Beschwören"
 * locks the slot (name/Level become read-only, the button becomes
 * "Löschen") and grants Summoning's "summonLevel" FP, scaled by that Level.
 * "Löschen" clears the slot back to empty, freeing it for a new summon.
 * Every still-summoned slot separately grants "summonExistenceDay" FP on
 * the next Anpassungs-/Genesungspause - see helpers/rest.mjs#applyRest.
 * Unlike SKSKReligionDialog's own Prayer section (or SKSKMassKillDialog's
 * own Mark Kill section), each row writes immediately (no separate Confirm
 * step), since every row
 * is its own atomic action; the dialog stays open and re-renders after
 * each one.
 */
export class SKSKSummoningDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'summoning-dialog'],
    window: { icon: 'fas fa-dragon' },
    position: { width: 480, height: 'auto' },
    actions: {
      simulateSummon: SKSKSummoningDialog.#onSimulateSummon,
      clearSummon: SKSKSummoningDialog.#onClearSummon,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/summoning-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.SummoningDialog.Title')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.summons = getResizedSummons(this.actor);
    return context;
  }

  static async #onSimulateSummon(event, target) {
    const index = Number(target.dataset.index);
    const row = target.closest('.summon-row');
    const name = row.querySelector('[data-summon-name]').value.trim();
    const level = Math.max(0, Number(row.querySelector('[data-summon-level]').value) || 0);
    if (level < 1) return;

    const summons = getResizedSummons(this.actor);
    if (!summons[index] || summons[index].summoned) return;
    summons[index] = { name, level, summoned: true };
    await this.actor.update({ 'system.summons': summons });

    const grant = await grantSkillUsageFp(this.actor, 'summoning', 'summonLevel', level);
    const skillLabel = game.i18n.localize(getSkillLabel('summoning'));
    const descriptionHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.SummoningDialog.Description', {
      name: this.actor.name, summonName: name || '?', level, amount: grant?.amount ?? 0, skill: skillLabel,
    })}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.SummoningDialog.Title'), null, 0, descriptionHTML);

    this.render();
  }

  static async #onClearSummon(event, target) {
    const index = Number(target.dataset.index);
    const summons = getResizedSummons(this.actor);
    if (!summons[index]) return;
    summons[index] = { name: '', level: 1, summoned: false };
    await this.actor.update({ 'system.summons': summons });
    this.render();
  }
}
