import { evaluateD20WithMode, formatD20ModeSummaryLine, wrapCriticalBlock } from './criticalRolls.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';
import { formatRollCardHeading } from './rollCard.mjs';
import { rollAttackPair, renderAttackPairHTML } from './attackRolls.mjs';

/**
 * Glück's own Reroll mechanic: a small icon next to a D20 roll's own name
 * (see renderRerollButton below) lets the rolling player spend 1 Luck
 * charge (system.luckCharges.value) to redo that exact roll - never any
 * AP/RP, and never the "just made this roll" FP that already got granted
 * once for the original roll (skillCheck/weaponAttack/flankAttack/
 * offHandAttack/attributeRoll - all outcome-independent, so re-granting
 * them on a reroll would be a pure duplicate). Only outcome-DEPENDENT FP
 * (Luck's own criticalRoll/doubleCriticalRoll bonus, and - for an
 * Angriffswurf, once Evaluate/Apply Damage are used against the REROLLED
 * pair - the normal hit/kill FP) is ever granted for the reroll, computed
 * fresh from the new result only. Two "kind"s exist:
 * - "generic" (skill checks - helpers/skillRolls.mjs#rollSkillCheck;
 *   attribute checks - sheets/actor-sheet.mjs's own roll handler): the
 *   entire original chat card IS the roll, so a reroll simply deletes it
 *   and posts a fresh one.
 * - "attack" (weapon/Martial Arts/spell Angriffswürfe - see
 *   helpers/attackRolls.mjs#renderAttackPairHTML, the sole place this
 *   button is actually rendered for that kind): the original card also
 *   carries an already-rolled damage roll and Apply Damage button that
 *   have nothing to do with the D20 itself and must survive untouched, so
 *   a reroll instead replaces just that one rendered pair's own uniquely-
 *   id'd "sksk-attack-block" region of that SAME message in place (see
 *   rerollAttackPair - a multi-attack spell renders more than one such
 *   block into a single message, hence the id).
 *
 * Deliberately never offered at all once an attack has already been
 * auto-resolved against a targeted token (see helpers/attackRolls.mjs#
 * autoResolveAttackForTargets) - by then the original roll's damage may
 * already be applied to a real target's Life, which a reroll has no way
 * to walk back, so helpers/attackRolls.mjs strips this button from that
 * card entirely (see stripRerollButton) rather than ever letting it be
 * clicked in that state.
 */

/**
 * Whether actor qualifies for the Reroll feature at all - Character-only,
 * same as every other Luck/FP mechanic (see helpers/skillFp.mjs). Doesn't
 * check the actual charge count - see renderRerollButton's own doc
 * comment for why the icon still renders at 0 charges.
 * @param {Actor|null} actor
 * @return {boolean}
 */
function qualifiesForReroll(actor) {
  return !!actor && actor.type === 'character';
}

/**
 * Spend 1 Luck charge, warning (and returning false) if none are left.
 * @param {Actor} actor
 * @return {Promise<boolean>}
 */
async function spendLuckCharge(actor) {
  const charges = actor.system.luckCharges.value;
  if (charges < 1) {
    ui.notifications.warn(game.i18n.localize('SKSK.Luck.NotEnoughCharges'));
    return false;
  }
  await actor.update({ 'system.luckCharges.value': charges - 1 });
  return true;
}

/**
 * The small Reroll icon rendered next to a D20 roll's own name (see
 * formatRollCardHeading's own extraHTML param, and helpers/attackRolls.mjs#
 * renderAttackPairHTML for the "attack" kind). Rendered for every
 * Character regardless of their current Luck charge count - 0 charges
 * still warns on click (see handleRerollFromChat), matching this system's
 * usual "check affordability at click time" convention (e.g. helpers/
 * inspiration.mjs#payInspirationCost) rather than hiding the control
 * outright. Renders nothing for an NPC or null actor.
 * @param {Actor|null} actor
 * @param {"generic"|"attack"} kind
 * @param {object} payload   Everything rerollGenericD20/rerollAttackPair
 *   below need to redo this exact roll - see their own doc comments.
 * @return {string}
 */
export function renderRerollButton(actor, kind, payload) {
  if (!qualifiesForReroll(actor)) return '';
  const data = encodeURIComponent(JSON.stringify(payload));
  return `<a class="sksk-reroll-luck" data-action="rerollLuck" data-actor-uuid="${actor.uuid}"
    data-kind="${kind}" data-payload="${data}" title="${game.i18n.localize('SKSK.Luck.RerollTooltip')}">
    <i class="fas fa-clover"></i>
  </a>`;
}

/**
 * Redo a "generic" (skill/attribute check) D20 roll: re-evaluates the
 * exact same formula/mode, grants only the outcome-dependent Luck FP fresh
 * (never the original "made this check" FP a second time), and posts a
 * brand new card carrying its own fresh Reroll button - replacing the
 * original message entirely (see handleRerollFromChat).
 * @param {Actor} actor
 * @param {{formula: string, mode: string, label: string}} payload
 * @return {Promise<ChatMessage>}
 */
async function rerollGenericD20(actor, payload) {
  const { formula, mode, label } = payload;
  const result = await evaluateD20WithMode(formula, actor.getRollData(), mode);
  const { roll, criticalType, doubleCritical } = result;

  let extraHTML = `<div class="sksk-roll-line sksk-luck-reroll-note">${game.i18n.localize('SKSK.Luck.RerolledNote')}</div>`;
  extraHTML += formatD20ModeSummaryLine(result, mode);
  if (criticalType === 'success') {
    extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'criticalRoll'));
  }
  if (doubleCritical) {
    extraHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'luck', 'doubleCriticalRoll'));
  }

  const headingExtra = renderRerollButton(actor, 'generic', payload);
  const content = `<div class="sksk-chat-card sksk-action-card">`
    + formatRollCardHeading(label, headingExtra)
    + wrapCriticalBlock(await roll.render(), criticalType)
    + extraHTML
    + `</div>`;
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: label,
    content,
    rolls: [roll],
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * Redo just the D20 half of an Angriffswurf: rerolls the same two-d20
 * pair (same flat bonus), re-renders it through renderAttackPairHTML (a
 * fresh Evaluate button, and this same Reroll button again for a further
 * reroll), and splices that fresh "sksk-attack-block" region into the
 * ORIGINAL message's content in place - its already-rolled damage roll
 * and Apply Damage button, entirely unrelated to which D20 counts, are
 * left completely untouched.
 * @param {Actor} actor
 * @param {{blockId: string, bonus: number, comparisonType: "armorClass"|"magicResistance",
 *   damageDice: Array, killSkillKey: string|null, flanking: boolean,
 *   label: string}} payload
 * @param {string|null} messageId
 * @return {Promise<void>}
 */
async function rerollAttackPair(actor, payload, messageId) {
  const message = messageId ? game.messages.get(messageId) : null;
  if (!message) return;

  const { blockId, bonus, comparisonType, damageDice, killSkillKey, flanking, label } = payload;
  const rolls = await rollAttackPair(bonus, actor);
  const newBlock = await renderAttackPairHTML(rolls, comparisonType, actor, {
    damageDice, killSkillKey, flanking, bonus, label,
  });

  // Find THIS specific block (not just the first one in the message) - a
  // multi-attack spell renders more than one into the same message, see
  // renderAttackPairHTML's own blockId doc comment. The end marker is a
  // real (empty) <span>, not an HTML comment - ChatMessage content
  // sanitization strips comments outright, which would silently break
  // this search.
  const blockStart = message.content.indexOf(`<div class="sksk-attack-block" data-block-id="${blockId}">`);
  const endMarker = `<span class="sksk-attack-block-end" data-block-id="${blockId}"></span>`;
  const markerIndex = message.content.indexOf(endMarker);
  if (blockStart === -1 || markerIndex === -1) return;
  const newContent = message.content.slice(0, blockStart)
    + newBlock
    + message.content.slice(markerIndex + endMarker.length);
  await message.update({ content: newContent });
}

/**
 * Delegated click handler for the Reroll icon (see sksk.mjs) - resolves
 * and permission-checks the actor, spends the Luck charge, and dispatches
 * to the right redo implementation by kind.
 * @param {HTMLElement} button
 * @return {Promise<void>}
 */
export async function handleRerollFromChat(button) {
  const actor = button.dataset.actorUuid ? await fromUuid(button.dataset.actorUuid) : null;
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize('SKSK.Luck.NotOwner'));
  if (!(await spendLuckCharge(actor))) return;

  const kind = button.dataset.kind;
  const payload = JSON.parse(decodeURIComponent(button.dataset.payload || '{}'));
  const messageId = button.closest('[data-message-id]')?.dataset.messageId ?? null;

  if (kind === 'attack') {
    await rerollAttackPair(actor, payload, messageId);
    return;
  }

  const newMessage = await rerollGenericD20(actor, payload);
  if (newMessage && messageId) await game.messages.get(messageId)?.delete();
}
