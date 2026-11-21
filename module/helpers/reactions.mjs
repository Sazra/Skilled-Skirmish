import { getActorToken, measureTokenDistance } from './tokenDistance.mjs';
import { hasEffectiveProperty } from './weaponProperties.mjs';
import { applyD20Malus, isCombatActive } from './statusEffects.mjs';
import { resolveCheckSuccess, evaluateD20WithMode, wrapCriticalBlock, wrapCriticalInline } from './criticalRolls.mjs';

/**
 * Reactions of a defender to an attack, granted by the Entwaffnend
 * (Disarming) and Umleitung (Redirection) properties of its equipped items.
 * Both are decided right before the attack is evaluated against the defender
 * (see helpers/attackRolls.mjs#resolveAndApplyOneAttack) - the question is
 * asked on the client that resolves the attack (the attacker's own, or the
 * GM's for a target that user doesn't own).
 */

/** Reaction Points both reactions cost. */
export const REACTION_RP_COST = 3;

/** Entwaffnend: the attacker rolls Dexterity against DC 16 or Strength against DC 18. */
const DISARM_CHECKS = [{ attribute: 'dex', dc: 16 }, { attribute: 'str', dc: 18 }];

/** Umleitung: the nearest creature within this distance (m) is the new target; it rolls Constitution against DC 15. */
const REDIRECT_RANGE = 2;
const REDIRECT_CHECK = { attribute: 'con', dc: 15 };

/** Spell range indicators that make a spell an area effect (Umleitung can't redirect those). */
const AREA_INDICATORS = new Set(['radius', 'sphere', 'cuboid', 'cone', 'line', 'square']);

/**
 * @param {object} spellSystem
 * @return {boolean}
 */
export function isAreaSpell(spellSystem) {
  return (spellSystem?.ranges ?? []).some(range => AREA_INDICATORS.has(range.indicator));
}

function attributeLabel(key) {
  return game.i18n.localize(`SKSK.Attribute.${key.charAt(0).toUpperCase()}${key.slice(1)}.long`);
}

/** The defender's equipped items (weapons, armor, shields) with the property. */
function getEquippedWithProperty(actor, key) {
  return actor.items.filter(item => (item.type === 'weapon' || item.type === 'armor')
    && item.system.equipped && hasEffectiveProperty(item.system, key));
}

/**
 * A d20 attribute check against a DC, rolled by an actor (modifier + status maluses,
 * its own default roll mode).
 * @param {Actor} actor
 * @param {string} attribute
 * @param {number} dc
 * @return {Promise<{success: boolean, html: string}>}
 */
async function rollAttributeCheck(actor, attribute, dc) {
  const mod = actor.system.attributes?.[attribute]?.mod ?? 0;
  const formula = applyD20Malus(`1d20 + ${mod}`, actor, attribute);
  const { roll, criticalType } = await evaluateD20WithMode(formula, actor.getRollData(), actor.system.genericCriticalRollMode ?? 'neutral');
  const success = resolveCheckSuccess(roll.total, dc, criticalType);
  const outcome = wrapCriticalInline(game.i18n.localize(success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure'), criticalType);
  const html = `<div class="sksk-roll-line">${game.i18n.format('SKSK.WeaponProperty.ReactionCheckLine', {
    actor: actor.name, attribute: attributeLabel(attribute), dc, total: roll.total, outcome,
  })}</div>${wrapCriticalBlock(await roll.render(), criticalType)}`;
  return { success, html };
}

/**
 * The creature Umleitung would redirect an attack to: the nearest other
 * token within 2m of the defender's token (not the attacker). null if there
 * is none or the tokens can't be measured.
 * @param {Actor} defender
 * @param {Actor|null} attacker
 * @return {Actor|null}
 */
function findRedirectTarget(defender, attacker) {
  const defenderToken = getActorToken(defender);
  if (!defenderToken || !canvas?.tokens) return null;
  let best = null;
  for (const token of canvas.tokens.placeables) {
    const actor = token.actor;
    if (!actor || actor === defender || actor === attacker || token.document.hidden) continue;
    const distance = measureTokenDistance(defenderToken, token);
    if (distance > REDIRECT_RANGE) continue;
    if (!best || distance < best.distance) best = { actor, distance };
  }
  return best?.actor ?? null;
}

/**
 * Which reactions the defender could use against this attack.
 * @return {{disarm: object|null, redirect: object|null}}
 */
function collectOptions({ defender, attacker, comparisonType, damageDice, isArea }) {
  const options = { disarm: null, redirect: null };

  // Entwaffnend: a melee attack with a weapon (not Martial Arts) can be disarmed.
  const weaponUuid = damageDice.find(d => d.weaponUuid && d.melee)?.weaponUuid;
  if (comparisonType === 'armorClass' && weaponUuid && attacker && getEquippedWithProperty(defender, 'disarming').length) {
    let weapon = null;
    try { weapon = fromUuidSync(weaponUuid); } catch (error) { weapon = null; }
    if (weapon?.system?.equipped) options.disarm = { weapon };
  }

  // Umleitung: any attack that is no area effect. A spell attack can only be
  // redirected if the item with the property is enchanted.
  if (!isArea && attacker) {
    const items = getEquippedWithProperty(defender, 'redirection')
      .filter(item => comparisonType !== 'magicResistance' || item.system.enchanted);
    if (items.length) {
      const target = findRedirectTarget(defender, attacker);
      if (target) options.redirect = { target };
    }
  }
  return options;
}

/** The attacker's choice of check for a disarm attempt. */
async function chooseDisarmCheck(attacker, weapon) {
  const buttons = DISARM_CHECKS.map(check => ({
    action: check.attribute,
    label: `${attributeLabel(check.attribute)} (DC ${check.dc}, ${attacker.system.attributes?.[check.attribute]?.mod >= 0 ? '+' : ''}${attacker.system.attributes?.[check.attribute]?.mod ?? 0})`,
    callback: () => check,
  }));
  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize('SKSK.WeaponProperty.DisarmChooseTitle') },
    content: `<p>${game.i18n.format('SKSK.WeaponProperty.DisarmChoosePrompt', { attacker: attacker.name, weapon: weapon.name })}</p>`,
    buttons,
    rejectClose: false,
  });
}

/**
 * Offer the defender its reactions to an attack (Entwaffnend, Umleitung) and
 * carry out the chosen one. Only possible where the defender can be written
 * to (its owner, or the GM) and - in Combat, the only place RP are spent, like
 * AP - while it has the Reaction Points.
 * @param {object} context
 * @param {Actor} context.defender
 * @param {Actor|null} context.attacker
 * @param {"armorClass"|"magicResistance"} context.comparisonType
 * @param {object[]} context.damageDice
 * @param {boolean} [context.isArea]   The attack is an area effect.
 * @return {Promise<{kind: "none"|"failed"|"redirect", html: string, target?: Actor}>}
 *   none: the attack goes on against the defender (html: notes to show);
 *   failed: the attacker was disarmed and the attack fails; redirect: the
 *   attack goes against `target` instead, with a new attack roll.
 */
export async function offerDefenderReactions({ defender, attacker, comparisonType, damageDice = [], isArea = false }) {
  const none = { kind: 'none', html: '' };
  const inCombat = isCombatActive();
  if (!defender?.isOwner || (inCombat && (defender.system.reactionPoints?.value ?? 0) < REACTION_RP_COST)) return none;

  const options = collectOptions({ defender, attacker, comparisonType, damageDice, isArea });
  if (!options.disarm && !options.redirect) return none;

  const buttons = [];
  if (options.disarm) {
    buttons.push({ action: 'disarm', label: game.i18n.localize('SKSK.WeaponProperty.ReactionDisarm'), callback: () => 'disarm' });
  }
  if (options.redirect) {
    buttons.push({
      action: 'redirect',
      label: game.i18n.format('SKSK.WeaponProperty.ReactionRedirect', { target: options.redirect.target.name }),
      callback: () => 'redirect',
    });
  }
  buttons.push({ action: 'none', label: game.i18n.localize('SKSK.WeaponProperty.ReactionNone'), default: true, callback: () => 'none' });

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format('SKSK.WeaponProperty.ReactionTitle', { defender: defender.name }) },
    content: `<p>${game.i18n.format('SKSK.WeaponProperty.ReactionPrompt', {
      defender: defender.name, attacker: attacker?.name ?? '?', cost: REACTION_RP_COST, rp: defender.system.reactionPoints.value,
    })}</p>`,
    buttons,
    rejectClose: false,
  });
  if (choice !== 'disarm' && choice !== 'redirect') return none;

  // RP are only ever spent in Combat.
  if (inCombat) {
    await defender.update({
      'system.reactionPoints.value': Math.max(0, (defender.system.reactionPoints?.value ?? 0) - REACTION_RP_COST),
    });
  }
  const paid = `<div class="sksk-roll-line sksk-roll-rp-cost">${game.i18n.format(inCombat ? 'SKSK.WeaponProperty.ReactionPaid' : 'SKSK.WeaponProperty.ReactionUsed', { defender: defender.name, cost: REACTION_RP_COST })}</div>`;

  if (choice === 'disarm') {
    const { weapon } = options.disarm;
    const check = await chooseDisarmCheck(attacker, weapon);
    if (!check) return { kind: 'none', html: paid };
    const { success, html } = await rollAttributeCheck(attacker, check.attribute, check.dc);
    if (success) {
      return { kind: 'none', html: paid + html + `<div class="sksk-roll-line">${game.i18n.localize('SKSK.WeaponProperty.DisarmResisted')}</div>` };
    }
    try {
      if (weapon.isOwner) await weapon.update({ 'system.equipped': false });
    } catch (error) {
      console.warn('sksk | could not unequip the disarmed weapon', error);
    }
    return {
      kind: 'failed',
      html: paid + html + `<div class="sksk-roll-line"><strong>${game.i18n.format('SKSK.WeaponProperty.DisarmSucceeded', { attacker: attacker.name, weapon: weapon.name })}</strong></div>`,
    };
  }

  // Umleitung
  const { target } = options.redirect;
  const { success, html } = await rollAttributeCheck(target, REDIRECT_CHECK.attribute, REDIRECT_CHECK.dc);
  if (success) {
    return { kind: 'none', html: paid + html + `<div class="sksk-roll-line">${game.i18n.format('SKSK.WeaponProperty.RedirectResisted', { target: target.name })}</div>` };
  }
  return {
    kind: 'redirect', target,
    html: paid + html + `<div class="sksk-roll-line"><strong>${game.i18n.format('SKSK.WeaponProperty.RedirectSucceeded', { target: target.name })}</strong></div>`,
  };
}
