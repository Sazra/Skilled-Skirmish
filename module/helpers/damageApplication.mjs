import { applyElementalDefense } from './defense.mjs';
import { applyLifeChange, negativeLifeOverflowHTML, getStatusStacks } from './statusEffects.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';

/**
 * Resolve the "defender" for an Angriffswurf-related chat-button click
 * (Evaluate Hit - see helpers/attackRolls.mjs#resolveHitEvaluationFromChat;
 * Apply Damage - see applyDamageFromChat below): the clicking user's first
 * target; a GM or Assistant GM with no target set can instead just have a
 * token selected on the canvas (of anyone's, not only their own), without
 * needing to formally target it; anyone else without a target falls back
 * to their own assigned character. Defined here (rather than in
 * attackRolls.mjs) purely to avoid a circular import - this module has no
 * dependency on attackRolls.mjs otherwise, and attackRolls.mjs imports this
 * function back from here.
 * @return {Actor|null}
 */
export function resolveClickDefender() {
  const targets = Array.from(game.user.targets ?? []);
  const controlled = game.user.isGM ? (canvas.tokens?.controlled ?? []) : [];
  return targets[0]?.actor ?? controlled[0]?.actor ?? game.user.character ?? null;
}

/**
 * Sum a list of {damageType, amount} entries sharing the same damageType
 * into one - e.g. a weapon's base damage plus its own Brutality bonus
 * damage (same type) become a single Apply-Damage entry, while a spell's
 * Fire+Cold damage stay separate. Entries with a non-positive amount are
 * dropped entirely.
 * @param {Array<{damageType: string, amount: number}>} entries
 * @return {Array<{damageType: string, amount: number}>}
 */
export function mergeDamageEntries(entries) {
  const totals = {};
  for (const { damageType, amount } of entries) {
    if (amount > 0) totals[damageType] = (totals[damageType] ?? 0) + amount;
  }
  return Object.entries(totals).map(([damageType, amount]) => ({ damageType, amount }));
}

/**
 * Render a "Schaden anwenden" (Apply Damage) button for one or more
 * already-rolled damage amounts (see rollWeaponItem/rollMartialArtsAttack/
 * renderDamageRoll/rollCriticalBonusDamage) - clicking it (see
 * applyDamageFromChat) resolves a defender the same way Evaluate Hit does
 * (helpers/attackRolls.mjs#resolveClickDefender), applies each entry
 * through Resistance/Weakness/Immunity/Absorption (see helpers/
 * defense.mjs#applyElementalDefense), nets them into one Life/Negative
 * Life update, and grants Kill FP to killSkillKey (if given and the
 * defender dies) - kept separate from Evaluate Hit so the GM can check the
 * hit/crit outcome first and only commit the Life change when ready. A
 * no-op (renders nothing) if every entry is non-positive.
 * @param {Actor|null} attacker
 * @param {Array<{damageType: string, amount: number}>} damageEntries
 * @param {string|null} [killSkillKey]   The attacker's own skill to credit
 *   a Kill to, if this ends up being the killing blow - null for sources
 *   with no configured "kill" rate (currently only weapon-category skills
 *   have one - see apps/skill-usage-fp-config.mjs).
 * @return {string}
 */
export function renderApplyDamageButton(attacker, damageEntries, killSkillKey = null) {
  const entries = mergeDamageEntries(damageEntries);
  if (!entries.length) return '';
  const payload = encodeURIComponent(JSON.stringify(entries));
  return `<button type="button" class="sksk-apply-damage" data-action="applyDamage"
    data-attacker-uuid="${attacker?.uuid ?? ''}" data-damage-entries="${payload}" data-kill-skill="${killSkillKey ?? ''}">
    ${game.i18n.localize('SKSK.AttackRoll.ApplyDamage')}
  </button>`;
}

/**
 * Handle a click on an "Apply Damage" button (see renderApplyDamageButton):
 * resolves the defender (helpers/attackRolls.mjs#resolveClickDefender),
 * runs each carried {damageType, amount} entry through
 * helpers/defense.mjs#applyElementalDefense, nets the results (damage
 * negative, healing positive) into one applyLifeChange call, and - if that
 * leaves the defender's Life AND Negative Life both at their max-depleted
 * floor (Life 0, Negative Life at its own max - "true death", see
 * data/actor-base.mjs#negativeLife) and it wasn't ALREADY true beforehand
 * (so re-applying damage to an already-dead target, e.g. overkill, never
 * grants Kill FP a second time) - grants the attacker a Kill FP for
 * killSkillKey, plus (if the attacker is currently Concealed - Attentat/
 * Assassination, see helpers/attackRolls.mjs#resolveHitEvaluationFromChat)
 * an additional "assassinationKill" FP to their Attentat skill, regardless
 * of which Apply-Damage button of the attack (base weapon damage, Brutal
 * bonus, or Attentat bonus) actually delivered the killing blow. Also
 * grants the defender's own "<type>Resistance" skill
 * its "damageTaken" FP for every entry that actually dealt damage (not
 * fully prevented by Immunity, nor converted into healing by Absorption -
 * a Resistance row is hidden from the Skills tab entirely while either is
 * active anyway, see sheets/actor-sheet.mjs#_prepareSkills, so there's
 * nothing to reward it for reducing in those cases) - subject to
 * Resistance's own special gain cap (see helpers/skillFp.mjs#
 * capResistanceGain). Conversely, an entry Absorption converts into
 * healing instead grants the ATTACKER (not the defender) Healer's own
 * "healedCreature" FP, scaled by the healed amount - detecting an
 * Absorption-driven heal this way needs no dedicated "heal" action of its
 * own, since every heal-via-Absorption necessarily passes through here.
 * Posts a chat summary either way.
 * @param {HTMLElement} button
 * @return {Promise<ChatMessage|void>}
 */
export async function applyDamageFromChat(button) {
  const defender = resolveClickDefender();
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const attacker = button.dataset.attackerUuid ? await fromUuid(button.dataset.attackerUuid) : null;
  const entries = JSON.parse(decodeURIComponent(button.dataset.damageEntries || '[]'));
  const killSkillKey = button.dataset.killSkill || null;

  let netDelta = 0;
  const lines = [];
  for (const { damageType, amount } of entries) {
    const { amount: adjusted, healing } = applyElementalDefense(defender, damageType, amount);
    netDelta += healing ? adjusted : -adjusted;
    const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damageType] ?? damageType);
    const outcomeKey = healing ? 'SKSK.AttackRoll.DamageAbsorbedIntoHealing' : 'SKSK.AttackRoll.DamageApplied';
    lines.push(`<div class="sksk-roll-line">${game.i18n.format(outcomeKey, { type: typeLabel, amount: adjusted })}</div>`);
    if (!healing && adjusted > 0) {
      lines.push(formatSkillFpGrantLine(await grantSkillUsageFp(defender, `${damageType}Resistance`, 'damageTaken', adjusted)));
    } else if (healing && adjusted > 0 && attacker) {
      // Healer's own "healedCreature" FP trigger: the defender's Absorption
      // turned this entry into healing instead of damage - credited to
      // whoever caused it (the attacker), not the defender, scaled by the
      // healed amount.
      lines.push(formatSkillFpGrantLine(await grantSkillUsageFp(attacker, 'healer', 'healedCreature', adjusted)));
    }
  }

  const wasAlreadyDead = defender.system.life.value === 0 && defender.system.negativeLife.value >= defender.system.negativeLife.max;
  const { negativeLifeDelta } = await applyLifeChange(defender, netDelta);
  lines.push(negativeLifeOverflowHTML(negativeLifeDelta));

  const isDead = defender.system.life.value === 0 && defender.system.negativeLife.value >= defender.system.negativeLife.max;
  if (isDead && !wasAlreadyDead && attacker && killSkillKey) {
    lines.push(formatSkillFpGrantLine(await grantSkillUsageFp(attacker, killSkillKey, 'kill')));
    lines.push(`<div class="sksk-roll-line"><strong>${game.i18n.format('SKSK.AttackRoll.KillConfirmed', { defender: defender.name })}</strong></div>`);
    if (getStatusStacks(attacker, 'concealed') > 0) {
      lines.push(formatSkillFpGrantLine(await grantSkillUsageFp(attacker, 'assassination', 'assassinationKill')));
    }
  }

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: game.i18n.format('SKSK.AttackRoll.DamageAppliedTitle', { defender: defender.name }),
    content: `<div class="sksk-chat-card sksk-action-card">${lines.join('')}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
