import { applyElementalDefense } from './defense.mjs';
import { applyLifeChange, negativeLifeOverflowHTML, getStatusStacks, increaseStatusStacks, getStatusEffectDefinitions } from './statusEffects.mjs';
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
 * Copy a consumed "effect"/"attackTarget" Technique's own linked
 * ActiveEffect (see data/technique.mjs#effectId, created via helpers/
 * technique-rolls.mjs#ensureLinkedEffect) - which stays on the granting
 * actor, always disabled, purely as a template - onto the resolved
 * defender as a fresh, enabled ActiveEffect, leaving that template
 * untouched for the next time this Technique gets primed. A no-op
 * (returns "") if the granting Item or its own template effect can no
 * longer be found.
 * @param {string} itemUuid
 * @param {string} effectId
 * @param {Actor} defender
 * @return {Promise<string>}
 */
async function applyTechniqueEffectToTarget(itemUuid, effectId, defender) {
  const item = itemUuid ? await fromUuid(itemUuid) : null;
  const template = item?.actor?.effects.get(effectId);
  if (!template) return '';

  const effectData = template.toObject();
  delete effectData._id;
  effectData.disabled = false;
  effectData.origin = item.uuid;
  await defender.createEmbeddedDocuments('ActiveEffect', [effectData]);

  return `<div class="sksk-roll-line">${game.i18n.format('SKSK.Technique.EffectApplied', { name: item.name, target: defender.name })}</div>`;
}

/**
 * Apply every effect an "effect"-category Technique carries (see
 * data/technique.mjs#effectId/effectStatusEffects, both may be set at
 * once) to a resolved defender - the freeform linked ActiveEffect (if any,
 * see applyTechniqueEffectToTarget above) and every predefined status
 * effect entry (via helpers/statusEffects.mjs#increaseStatusStacks). Shared
 * by both delivery paths: the plain "Apply Damage"/"Apply Effect" button
 * below (no saving throw configured) and helpers/technique-rolls.mjs#
 * rollTechniqueEffectSaveFromChat (saving throw configured, only called
 * here on a failed save). A no-op (returns "") if the Item can no longer
 * be found.
 * @param {string} itemUuid
 * @param {Actor} defender
 * @return {Promise<string>}
 */
export async function applyTechniqueEffectBundle(itemUuid, defender) {
  const item = itemUuid ? await fromUuid(itemUuid) : null;
  if (!item) return '';

  const lines = [];
  if (item.system.effectId) {
    const line = await applyTechniqueEffectToTarget(itemUuid, item.system.effectId, defender);
    if (line) lines.push(line);
  }
  for (const entry of item.system.effectStatusEffects ?? []) {
    if (!entry.statusId) continue;
    await increaseStatusStacks(defender, entry.statusId, entry.stacks ?? 1);
    const def = getStatusEffectDefinitions().find(d => d.id === entry.statusId);
    lines.push(`<div class="sksk-roll-line sksk-roll-status-effect">${game.i18n.format('SKSK.Technique.StatusEffectApplied', { name: def?.name ?? entry.statusId, target: defender.name })}</div>`);
  }
  return lines.join('');
}

/**
 * Apply every "attack"/"save"/"unconditional"-triggered status/Foundry
 * effect entry a Spell carries (see data/spell.mjs#statusEffects/
 * foundryEffects) that matches the given group to a resolved defender -
 * predefined status effects via helpers/statusEffects.mjs#
 * increaseStatusStacks, freeform Active Effects by copying each entry's own
 * linked template (see helpers/spell-rolls.mjs#ensureLinkedSpellEffect,
 * same bind-then-copy pattern as applyTechniqueEffectToTarget above) onto
 * the defender. Shared by helpers/spell-rolls.mjs#applySpellEffectFromChat
 * (group "attack"/"unconditional", its own dedicated "Effekt anwenden"
 * button) and #rollSpellEffectSaveFromChat (group "save", keyed additionally
 * by savingThrowIndex - only called there on a failed save). A no-op
 * (returns "") if the Item can no longer be found.
 * @param {string} itemUuid
 * @param {"attack"|"save"|"unconditional"} group
 * @param {number|null} savingThrowIndex   Only meaningful for group "save" -
 *   which specific saving throw's own effect entries to apply (entries for
 *   any OTHER saving throw index are left alone).
 * @param {Actor} defender
 * @return {Promise<string>}
 */
export async function applySpellEffectGroup(itemUuid, group, savingThrowIndex, defender) {
  const item = itemUuid ? await fromUuid(itemUuid) : null;
  if (!item) return '';

  // A blank/null savingThrowIndex on the entry itself defaults to 0 - see
  // helpers/spell-rolls.mjs#renderSpellEffectParts's own identical fallback
  // (and its comment) for why: a <select> with only one saving throw shows
  // it pre-selected via plain browser default, which never fires a "change"
  // event on its own, so the field can stay unset in storage.
  const matches = (entry) => entry.trigger === group && (group !== 'save' || (entry.savingThrowIndex ?? 0) === savingThrowIndex);
  const lines = [];
  for (const entry of item.system.statusEffects ?? []) {
    if (!matches(entry) || !entry.statusId) continue;
    await increaseStatusStacks(defender, entry.statusId, entry.stacks ?? 1);
    const def = getStatusEffectDefinitions().find(d => d.id === entry.statusId);
    lines.push(`<div class="sksk-roll-line sksk-roll-status-effect">${game.i18n.format('SKSK.Spell.StatusEffectApplied', { name: def?.name ?? entry.statusId, target: defender.name })}</div>`);
  }
  for (const entry of item.system.foundryEffects ?? []) {
    if (!matches(entry) || !entry.effectId) continue;
    const template = item.actor?.effects.get(entry.effectId);
    if (!template) continue;
    const effectData = template.toObject();
    delete effectData._id;
    effectData.disabled = false;
    effectData.origin = item.uuid;
    await defender.createEmbeddedDocuments('ActiveEffect', [effectData]);
    lines.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.EffectApplied', { name: entry.name || item.name, target: defender.name })}</div>`);
  }
  return lines.join('');
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
 * @param {{itemUuid: string}|null} [techniqueEffect]   A consumed "effect"/
 *   "attackTarget" Technique's own payload (see helpers/technique-rolls.mjs#
 *   getTechniqueEffectPayload) - null whenever that Technique's own saving
 *   throw is enabled instead (see helpers/technique-rolls.mjs#
 *   renderTechniqueSavingThrowHTML, rendered as its own separate button in
 *   that case). When given, this button still renders (labelled "Apply
 *   Effect" instead) even if every damage entry is non-positive, so a
 *   damage-less target-effect Technique still gets a button to hang its own
 *   application off of; applyDamageFromChat then applies that Technique's
 *   own effect(s) unconditionally via applyTechniqueEffectBundle above.
 * @return {string}
 */
export function renderApplyDamageButton(attacker, damageEntries, killSkillKey = null, techniqueEffect = null) {
  const entries = mergeDamageEntries(damageEntries);
  if (!entries.length && !techniqueEffect) return '';
  const payload = encodeURIComponent(JSON.stringify(entries));
  const techniqueAttrs = techniqueEffect ? ` data-technique-item-uuid="${techniqueEffect.itemUuid}"` : '';
  const label = entries.length
    ? game.i18n.localize('SKSK.AttackRoll.ApplyDamage')
    : game.i18n.localize('SKSK.Technique.ApplyEffect');
  return `<button type="button" class="sksk-apply-damage" data-action="applyDamage"
    data-attacker-uuid="${attacker?.uuid ?? ''}" data-damage-entries="${payload}" data-kill-skill="${killSkillKey ?? ''}"${techniqueAttrs}>
    ${label}
  </button>`;
}

/**
 * Handle a click on an "Apply Damage" button (see renderApplyDamageButton):
 * resolves the defender (helpers/attackRolls.mjs#resolveClickDefender),
 * runs each carried {damageType, amount} entry through
 * helpers/defense.mjs#applyElementalDefense, nets the results (damage
 * negative, healing positive) into one applyLifeChange call, and - if that
 * leaves the defender's Life AND Negative Life both at their own floor
 * (Life 0, Negative Life 0 - its buffer fully drained, "true death", see
 * helpers/statusEffects.mjs#applyLifeChange) and it wasn't ALREADY true beforehand
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

  if (button.dataset.techniqueItemUuid) {
    lines.push(await applyTechniqueEffectBundle(button.dataset.techniqueItemUuid, defender));
  }

  const wasAlreadyDead = defender.system.life.value === 0 && defender.system.negativeLife.value <= 0;
  const { negativeLifeDelta } = await applyLifeChange(defender, netDelta);
  lines.push(negativeLifeOverflowHTML(negativeLifeDelta));

  const isDead = defender.system.life.value === 0 && defender.system.negativeLife.value <= 0;
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
