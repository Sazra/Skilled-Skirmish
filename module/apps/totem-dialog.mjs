import { grantSkillUsageFp } from '../helpers/skillFp.mjs';
import { getSkillLabel } from '../helpers/skills.mjs';
import { postActionChatCard } from '../helpers/actions.mjs';
import { getResizedTotems } from '../helpers/totem.mjs';
import { isCombatActive } from '../helpers/statusEffects.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The "Totem" window opened from a Character's own sheet header - a list of
 * totem slots sized to the Totem skill's own level (GM-tab adjustable via
 * system.totemSlotsBonus/totemSlotsMultiplier - see helpers/totem.mjs#
 * computeTotemSlots). An empty slot lets the player freely name a totem
 * (orientation only); "Totem binden" locks the name, grants Totem's
 * "totemBond" FP, and creates a linked, initially-disabled ActiveEffect on
 * the actor - the row's Effects button opens that effect's own native
 * Foundry config sheet for free-form Changes. Once bound, "Totem aktivieren"
 * pays 2 AP + the row's own Mana-per-round cost up front, flips the linked
 * effect's disabled flag off, and grants "totemUsed" FP; "Totem
 * deaktivieren" reverses both (no FP). Every still-active totem drains its
 * own Mana-per-round cost at this actor's own Combat turn start,
 * auto-deactivating on insufficient Mana - see helpers/statusEffects.mjs#
 * handleTotemTurnStart. "Zeile löschen/freigeben" clears the slot AND
 * deletes its linked effect. Like SKSKSummoningDialog, each row writes
 * immediately (no separate Confirm step); the dialog stays open and
 * re-renders after each action.
 */
export class SKSKTotemDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sksk', 'totem-dialog'],
    window: { icon: 'fas fa-monument' },
    position: { width: 560, height: 'auto' },
    actions: {
      bindTotem: SKSKTotemDialog.#onBindTotem,
      unbindTotem: SKSKTotemDialog.#onUnbindTotem,
      toggleTotemActive: SKSKTotemDialog.#onToggleTotemActive,
      openTotemEffect: SKSKTotemDialog.#onOpenTotemEffect,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/sksk/templates/apps/totem-dialog.hbs' },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize('SKSK.TotemDialog.Title')}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.totems = getResizedTotems(this.actor);
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll('[data-totem-mana-cost]').forEach(el => {
      el.addEventListener('change', async event => {
        const index = Number(event.target.dataset.index);
        const totems = getResizedTotems(this.actor);
        if (!totems[index]) return;
        totems[index].manaCostPerRound = Math.max(0, Number(event.target.value) || 0);
        await this.actor.update({ 'system.totems': totems });
      });
    });
  }

  static async #onBindTotem(event, target) {
    const index = Number(target.dataset.index);
    const row = target.closest('.totem-row');
    const name = row.querySelector('[data-totem-name]').value.trim();

    const totems = getResizedTotems(this.actor);
    if (!totems[index] || totems[index].bound) return;

    const [effect] = await this.actor.createEmbeddedDocuments('ActiveEffect', [{
      name: name || game.i18n.localize('SKSK.TotemDialog.Title'),
      img: 'icons/svg/aura.svg',
      disabled: true,
    }]);

    totems[index] = { name, bound: true, active: false, effectId: effect.id, manaCostPerRound: 0 };
    await this.actor.update({ 'system.totems': totems });

    const grant = await grantSkillUsageFp(this.actor, 'totem', 'totemBond');
    const skillLabel = game.i18n.localize(getSkillLabel('totem'));
    const descriptionHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.TotemDialog.BindDescription', {
      name: this.actor.name, totemName: name || '?', amount: grant?.amount ?? 0, skill: skillLabel,
    })}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.TotemDialog.Bind'), null, 0, descriptionHTML);

    this.render();
  }

  static async #onUnbindTotem(event, target) {
    const index = Number(target.dataset.index);
    const totems = getResizedTotems(this.actor);
    const entry = totems[index];
    if (!entry || !entry.bound) return;

    if (entry.effectId) {
      const effect = this.actor.effects.get(entry.effectId);
      if (effect) await effect.delete();
    }

    totems[index] = { name: '', bound: false, active: false, effectId: '', manaCostPerRound: 0 };
    await this.actor.update({ 'system.totems': totems });
    this.render();
  }

  static async #onOpenTotemEffect(event, target) {
    const index = Number(target.dataset.index);
    const totems = getResizedTotems(this.actor);
    const entry = totems[index];
    if (!entry?.effectId) return;

    const effect = this.actor.effects.get(entry.effectId);
    if (!effect) return;
    effect.sheet.render(true);
  }

  static async #onToggleTotemActive(event, target) {
    const index = Number(target.dataset.index);
    const totems = getResizedTotems(this.actor);
    const entry = totems[index];
    if (!entry || !entry.bound) return;

    const effect = entry.effectId ? this.actor.effects.get(entry.effectId) : null;

    if (entry.active) {
      if (effect) await effect.update({ disabled: true });
      totems[index] = { ...entry, active: false };
      await this.actor.update({ 'system.totems': totems });
      await postActionChatCard(this.actor, game.i18n.localize('SKSK.TotemDialog.Deactivate'),
        null, 0, `<div class="sksk-roll-line"><strong>${entry.name || '?'}</strong></div>`);
      this.render();
      return;
    }

    // Outside of Combat entirely (see helpers/statusEffects.mjs#
    // isCombatActive), AP is never checked/spent at all - only Mana still
    // applies normally, mirroring helpers/technique-rolls.mjs#payTechniqueCost.
    const combatActive = isCombatActive();
    const ap = this.actor.system.actionPoints.value;
    if (combatActive && ap < 2) return ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughAP'));
    const mana = this.actor.system.mana.value;
    if (mana < entry.manaCostPerRound) return ui.notifications.warn(game.i18n.localize('SKSK.TotemDialog.NotEnoughMana'));

    if (effect) await effect.update({ disabled: false });
    totems[index] = { ...entry, active: true };
    await this.actor.update({
      'system.totems': totems,
      ...(combatActive ? { 'system.actionPoints.value': ap - 2 } : {}),
      'system.mana.value': mana - entry.manaCostPerRound,
    });

    const grant = await grantSkillUsageFp(this.actor, 'totem', 'totemUsed');
    const skillLabel = game.i18n.localize(getSkillLabel('totem'));
    const descriptionHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.TotemDialog.ActivateDescription', {
      name: this.actor.name, totemName: entry.name || '?', amount: grant?.amount ?? 0, skill: skillLabel,
    })}</div>`;
    await postActionChatCard(this.actor, game.i18n.localize('SKSK.TotemDialog.Activate'), null, 0, descriptionHTML);

    this.render();
  }
}
