import { redoGenericD20Roll } from './luck.mjs';

/**
 * A free (no Luck charge, no AP/RP) sibling of helpers/luck.mjs's own
 * Reroll: a per-attribute switch (system.attributeRerollEnabled.<key>,
 * see data/actor-base.mjs - purely an Active Effect target, no manual GM-
 * tab checkbox, same convention as e.g. attributeRollApCostModifier)
 * unlocks its own small icon on that attribute's own roll AND on any
 * skill check involving it, letting the player redo the roll for free
 * whenever it's on. Rendered immediately to Luck's own icon's LEFT (see
 * renderAttributeRerollButton/luck.mjs#wrapRerollIcons) - both icons can
 * appear together on the same card, independently of one another. Shares
 * luck.mjs's own redoGenericD20Roll for the actual reroll (same D20-
 * outcome FP rules apply - see that function's own doc comment) rather
 * than duplicating it, since the two mechanisms only ever differ in their
 * own eligibility check/cost, never in how the roll itself gets redone.
 */

/**
 * Whether ANY of the given attributes has its own Reroll switch on for
 * this actor - Character-only, same as every other Luck/FP mechanic.
 * @param {Actor|null} actor
 * @param {string[]} attributeKeys
 * @return {boolean}
 */
function qualifiesForAttributeReroll(actor, attributeKeys) {
  if (!actor || actor.type !== 'character' || !attributeKeys?.length) return false;
  return attributeKeys.some(key => actor.system.attributeRerollEnabled?.[key]);
}

/**
 * The small Attribute-Reroll icon - '' (renders nothing) unless at least
 * one of payload.attributeKeys currently has its own switch on. Re-
 * evaluated fresh every time a card is (re)built, so the icon disappears
 * the moment a GM/Active Effect turns the switch back off, and (re)appears
 * the moment it's turned on again for a subsequent roll.
 * @param {Actor|null} actor
 * @param {string[]} attributeKeys   Every attribute this specific roll
 *   involves (a single-attribute check, or several for an "und"-combined
 *   skill check) - see helpers/skillRolls.mjs#rollSkillCheck/sheets/
 *   actor-sheet.mjs's own roll handler for how each builds this.
 * @param {object} payload   Same shape helpers/luck.mjs#redoGenericD20Roll
 *   expects ({formula, mode, label, attributeKeys}).
 * @return {string}
 */
export function renderAttributeRerollButton(actor, attributeKeys, payload) {
  if (!qualifiesForAttributeReroll(actor, attributeKeys)) return '';
  const data = encodeURIComponent(JSON.stringify(payload));
  return `<a class="sksk-reroll-attribute" data-action="rerollAttribute" data-actor-uuid="${actor.uuid}"
    data-payload="${data}" title="${game.i18n.localize('SKSK.AttributeReroll.RerollTooltip')}">
    <i class="fas fa-arrows-rotate"></i>
  </a>`;
}

/**
 * Delegated click handler for the Attribute-Reroll icon (see sksk.mjs) -
 * permission-checks the actor, re-checks eligibility (defensively, in
 * case the switch was turned off between render and click), then redoes
 * the roll via helpers/luck.mjs#redoGenericD20Roll - no charge, no AP/RP.
 * @param {HTMLElement} button
 * @return {Promise<void>}
 */
export async function handleAttributeRerollFromChat(button) {
  const actor = button.dataset.actorUuid ? await fromUuid(button.dataset.actorUuid) : null;
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize('SKSK.AttributeReroll.NotOwner'));

  const payload = JSON.parse(decodeURIComponent(button.dataset.payload || '{}'));
  if (!qualifiesForAttributeReroll(actor, payload.attributeKeys ?? [])) {
    return ui.notifications.warn(game.i18n.localize('SKSK.AttributeReroll.NotEnabled'));
  }

  const messageId = button.closest('[data-message-id]')?.dataset.messageId ?? null;
  const newMessage = await redoGenericD20Roll(actor, payload, 'SKSK.AttributeReroll.RerolledNote');
  if (newMessage && messageId) await game.messages.get(messageId)?.delete();
}
