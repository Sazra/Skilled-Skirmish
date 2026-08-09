import { getActorSkillLevel } from './skills.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';
import { postActionChatCard } from './actions.mjs';
import { resolveClickDefender } from './damageApplication.mjs';

/**
 * Inspiration die face counts by the granting actor's own Inspiration skill
 * level (1-5, matching that skill's own maxLevel) - index 0 = level 1.
 */
const DIE_SIZES = [4, 6, 8, 10, 12];

/**
 * The Inspiration die size an actor would currently grant (or roll for
 * themselves), based on their own Inspiration skill level - 0 (no die)
 * below level 1, matching inspirationCharges' own gate (see
 * helpers/generalResources.mjs#computeMaxInspirationCharges).
 * @param {Actor} actor
 * @return {number}
 */
export function getInspirationDieSize(actor) {
  const level = getActorSkillLevel(actor, 'inspiration');
  if (level < 1) return 0;
  return DIE_SIZES[Math.min(level, DIE_SIZES.length) - 1];
}

/**
 * Spend the given actor's own inspirationApCost (AP) and 1 Inspiration
 * charge, warning (and returning false, no changes written) if either can't
 * be afforded.
 * @param {Actor} actor
 * @return {Promise<boolean>}
 */
async function payInspirationCost(actor) {
  const apCost = actor.system.inspirationApCost ?? 0;
  const ap = actor.system.actionPoints.value;
  if (ap < apCost) {
    ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughAP'));
    return false;
  }
  const charges = actor.system.inspirationCharges.value;
  if (charges < 1) {
    ui.notifications.warn(game.i18n.localize('SKSK.Inspiration.NotEnoughCharges'));
    return false;
  }
  await actor.update({
    'system.actionPoints.value': ap - apCost,
    'system.inspirationCharges.value': charges - 1,
  });
  return true;
}

function costLine(apCost) {
  return `<div class="sksk-roll-line">${game.i18n.format('SKSK.Inspiration.Cost', { ap: apCost })}</div>`;
}

/**
 * Render the "claim" button for an untargeted grant's own chat card - see
 * claimInspirationDie below (module/sksk.mjs delegates its click here).
 * @param {Actor} granter
 * @param {number} dieSize
 * @return {string}
 */
function renderClaimButton(granter, dieSize) {
  return `<button type="button" class="sksk-claim-inspiration" data-action="claimInspiration"
    data-granter-uuid="${granter.uuid}" data-die-size="${dieSize}">
    ${game.i18n.format('SKSK.Inspiration.ClaimButton', { die: dieSize })}
  </button>`;
}

/**
 * Whether granting a die of newSize would actually improve on an actor's
 * currently-held die (strictly higher, per the design's own "keep the
 * better one" rule) - true if they hold none at all.
 * @param {Actor} actor
 * @param {number} newSize
 * @return {boolean}
 */
function isUpgrade(actor, newSize) {
  return (actor.system.inspirationDie?.size ?? 0) < newSize;
}

/**
 * Actions tab's Inspiration button, plain click - grants an Inspiration die
 * (sized by the granting actor's own Inspiration skill level) to the
 * clicking user's first Foundry target, if any; with no target, offers it
 * in chat instead for anyone to claim (see claimInspirationDie). Spends the
 * granter's own inspirationApCost AP and 1 Inspiration charge either way. A
 * direct target already holding an equal-or-better die aborts before
 * spending anything (see isUpgrade).
 * @param {Actor} actor
 * @return {Promise<ChatMessage|void>}
 */
export async function grantInspirationDie(actor) {
  const dieSize = getInspirationDieSize(actor);
  if (!dieSize) return ui.notifications.warn(game.i18n.localize('SKSK.Inspiration.NoLevel'));

  const targetActor = Array.from(game.user.targets ?? [])[0]?.actor ?? null;
  if (targetActor && !isUpgrade(targetActor, dieSize)) {
    return ui.notifications.warn(game.i18n.format('SKSK.Inspiration.AlreadyHasBetter', { name: targetActor.name }));
  }

  if (!(await payInspirationCost(actor))) return;

  if (targetActor) {
    await targetActor.update({
      'system.inspirationDie': { size: dieSize, grantedByUuid: actor.uuid, grantedByName: actor.name },
    });
    const resultLine = `<div class="sksk-roll-line">${game.i18n.format('SKSK.Inspiration.GrantedTo', { name: targetActor.name, die: dieSize })}</div>`;
    return postActionChatCard(actor, game.i18n.localize('SKSK.Inspiration.Title'), null, 0, costLine(actor.system.inspirationApCost ?? 0) + resultLine);
  }

  const claimHTML = renderClaimButton(actor, dieSize);
  return postActionChatCard(actor, game.i18n.localize('SKSK.Inspiration.Title'), null, 0, costLine(actor.system.inspirationApCost ?? 0) + claimHTML);
}

/**
 * Actions tab's Inspiration button, Shift+Click - spends the same AP/charge
 * cost as a normal grant, but grants no die to anyone; simulates a special
 * ability that consumes an Inspiration charge on its own.
 * @param {Actor} actor
 * @return {Promise<ChatMessage|void>}
 */
export async function consumeInspirationCharge(actor) {
  if (!(await payInspirationCost(actor))) return;
  return postActionChatCard(actor, game.i18n.localize('SKSK.Inspiration.ChargeConsumed'), null, 0, costLine(actor.system.inspirationApCost ?? 0));
}

/**
 * Actions tab's Inspiration button, Right-Click - spends the same AP/charge
 * cost as a normal grant, then immediately rolls the die for the actor's
 * own use (sized by their own Inspiration skill level), granting Inspiration
 * its own "inspirationUsed" FP directly (this actor is both granter and
 * roller at once).
 * @param {Actor} actor
 * @return {Promise<ChatMessage|void>}
 */
export async function rollOwnInspirationDie(actor) {
  const dieSize = getInspirationDieSize(actor);
  if (!dieSize) return ui.notifications.warn(game.i18n.localize('SKSK.Inspiration.NoLevel'));
  if (!(await payInspirationCost(actor))) return;

  const roll = await new Roll(`1d${dieSize}`, actor.getRollData()).evaluate();
  const grant = await grantSkillUsageFp(actor, 'inspiration', 'inspirationUsed');
  const extraHTML = costLine(actor.system.inspirationApCost ?? 0) + formatSkillFpGrantLine(grant);
  return postActionChatCard(actor, game.i18n.localize('SKSK.Inspiration.RolledForSelf'), roll, 0, extraHTML);
}

/**
 * The header field's own click handler - rolls and clears whatever
 * Inspiration die this actor is currently holding (granted by someone else,
 * or by themselves via rollOwnInspirationDie above never populates this
 * field - only grantInspirationDie/claimInspirationDie do). Credits the
 * original granter's own Inspiration skill with "inspirationUsed" FP, if
 * that actor still exists and is a Character.
 * @param {Actor} actor
 * @return {Promise<ChatMessage|void>}
 */
export async function rollGrantedInspirationDie(actor) {
  const die = actor.system.inspirationDie;
  if (!die?.size) return ui.notifications.warn(game.i18n.localize('SKSK.Inspiration.NoDieHeld'));

  const roll = await new Roll(`1d${die.size}`, actor.getRollData()).evaluate();
  await actor.update({ 'system.inspirationDie': { size: 0, grantedByUuid: '', grantedByName: '' } });

  let fpHTML = '';
  if (die.grantedByUuid) {
    const granter = await fromUuid(die.grantedByUuid);
    if (granter) fpHTML = formatSkillFpGrantLine(await grantSkillUsageFp(granter, 'inspiration', 'inspirationUsed'));
  }
  return postActionChatCard(actor, game.i18n.localize('SKSK.Inspiration.DieUsed'), roll, 0, fpHTML);
}

/**
 * The chat "claim" button's own click handler (untargeted grants only) -
 * see module/sksk.mjs's delegated "claimInspiration" click listener.
 * Resolves the claiming actor the same way Apply-Damage buttons resolve
 * their defender (helpers/damageApplication.mjs#resolveClickDefender): the
 * clicking user's own target, a GM's selected token, or their own assigned
 * character. Like a direct-target grant, aborts (no changes) if the
 * claimant already holds an equal-or-better die.
 * @param {HTMLElement} button
 * @return {Promise<ChatMessage|void>}
 */
export async function claimInspirationDie(button) {
  const granterUuid = button.dataset.granterUuid;
  const dieSize = Number(button.dataset.dieSize);
  const claimant = resolveClickDefender();
  if (!claimant) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));
  if (!isUpgrade(claimant, dieSize)) {
    return ui.notifications.warn(game.i18n.format('SKSK.Inspiration.AlreadyHasBetter', { name: claimant.name }));
  }

  const granter = granterUuid ? await fromUuid(granterUuid) : null;
  await claimant.update({
    'system.inspirationDie': { size: dieSize, grantedByUuid: granterUuid, grantedByName: granter?.name ?? '' },
  });

  const resultLine = `<div class="sksk-roll-line">${game.i18n.format('SKSK.Inspiration.Claimed', { name: claimant.name, die: dieSize })}</div>`;
  return postActionChatCard(claimant, game.i18n.localize('SKSK.Inspiration.Title'), null, 0, resultLine);
}
