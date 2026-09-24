import { redoGenericD20Roll, redoAttackPairRoll } from './luck.mjs';

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
 * luck.mjs's own redoGenericD20Roll/redoAttackPairRoll for the actual
 * reroll (same D20-outcome FP rules apply - see those functions' own doc
 * comments) rather than duplicating them, since the two mechanisms only
 * ever differ in their own eligibility check/cost, never in how the roll
 * itself gets redone. Two "kind"s, mirroring helpers/luck.mjs#
 * renderRerollButton's own:
 * - "generic" (skill/attribute checks): the attribute(s) a specific check
 *   itself tests (see helpers/skillRolls.mjs#rollSkillCheck/sheets/
 *   actor-sheet.mjs's own roll handler).
 * - "attack" (weapon/Martial Arts/spell Angriffswürfe - see
 *   helpers/attackRolls.mjs#renderAttackPairHTML, the sole place this
 *   icon is actually rendered for that kind): the attribute(s) that
 *   attack's own attack-roll bonus draws from (helpers/attackRolls.mjs#
 *   getWeaponAttributeKeys/getMartialArtsAttributeKeys, or a fixed
 *   ['wil'] for every spell, which always adds its Willpower modifier).
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
 * one of attributeKeys currently has its own switch on. Re-evaluated
 * fresh every time a card is (re)built, so the icon disappears the moment
 * a GM/Active Effect turns the switch back off, and (re)appears the
 * moment it's turned on again for a subsequent roll.
 * @param {Actor|null} actor
 * @param {string[]} attributeKeys   Every attribute this specific roll
 *   involves - for "generic", a single-attribute check, or several for an
 *   "und"-combined skill check (see helpers/skillRolls.mjs#rollSkillCheck/
 *   sheets/actor-sheet.mjs's own roll handler); for "attack", whichever
 *   attribute(s) that attack's own attack-roll bonus draws from (see this
 *   file's own doc comment).
 * @param {"generic"|"attack"} kind
 * @param {object} payload   Same shape the matching kind's own
 *   helpers/luck.mjs#renderRerollButton payload uses (redoGenericD20Roll's
 *   {formula, mode, label} or redoAttackPairRoll's {blockId, bonus,
 *   comparisonType, damageDice, killSkillKey, flanking, label}) - always
 *   also carrying attributeKeys itself, for handleAttributeRerollFromChat's
 *   own click-time eligibility re-check.
 * @return {string}
 */
export function renderAttributeRerollButton(actor, attributeKeys, kind, payload) {
  if (!qualifiesForAttributeReroll(actor, attributeKeys)) return '';
  const data = encodeURIComponent(JSON.stringify({ ...payload, attributeKeys }));
  return `<a class="sksk-reroll-attribute" data-action="rerollAttribute" data-actor-uuid="${actor.uuid}"
    data-kind="${kind}" data-payload="${data}" title="${game.i18n.localize('SKSK.AttributeReroll.RerollTooltip')}">
    <i class="fas fa-arrows-rotate"></i>
  </a>`;
}

/**
 * Delegated click handler for the Attribute-Reroll icon (see sksk.mjs) -
 * permission-checks the actor, re-checks eligibility (defensively, in
 * case the switch was turned off between render and click), then dispatches
 * to the right redo implementation by kind - no charge, no AP/RP either
 * way. Mirrors helpers/luck.mjs#handleRerollFromChat's own dispatch.
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
  if (button.dataset.kind === 'attack') {
    await redoAttackPairRoll(actor, payload, messageId);
    return;
  }

  const newMessage = await redoGenericD20Roll(actor, payload, 'SKSK.AttributeReroll.RerolledNote');
  if (newMessage && messageId) await game.messages.get(messageId)?.delete();
}
