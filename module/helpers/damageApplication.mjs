import { applyElementalDefense, getDurabilityAffectedArmor } from './defense.mjs';
import { isDurabilityEnabled } from './materials.mjs';
import {
  applyLifeChange, negativeLifeOverflowHTML, getStatusStacks, increaseStatusStacks, getStatusEffectDefinitions,
  checkConcentration, damageDealtFrom,
} from './statusEffects.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine } from './skillFp.mjs';
import { getElementalDeathChargeHeal } from './elementalChargeEffects.mjs';

/**
 * NPC-facing chat line per helpers/defense.mjs#applyElementalDefense
 * outcome - see applyResolvedDamageEntries below.
 */
const NPC_DAMAGE_OUTCOME_KEYS = {
  normal: 'SKSK.AttackRoll.NpcDamageNormal',
  resisted: 'SKSK.AttackRoll.NpcDamageResisted',
  weakened: 'SKSK.AttackRoll.NpcDamageWeakened',
  immune: 'SKSK.AttackRoll.NpcDamageImmune',
  absorbed: 'SKSK.AttackRoll.NpcDamageAbsorbed',
};

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
 * The shared core of "Apply Damage"/"Apply Effect" (see
 * renderApplyDamageButton above and applyDamageFromChat below): runs each
 * carried {damageType, amount} entry through helpers/defense.mjs#
 * applyElementalDefense, nets the results (damage negative, healing
 * positive) into one applyLifeChange call, applies a linked Technique
 * effect bundle if any (applyTechniqueEffectBundle above), and grants
 * every FP trigger a real click of the button would - "<type>Resistance"'s
 * "damageTaken" per entry that actually dealt damage, Healer's own
 * "healedCreature" to the ATTACKER for any entry Absorption converted into
 * healing instead, and - if this leaves the defender's Life AND Negative
 * Life both at their own floor (Life 0, Negative Life 0, "true death" - see
 * helpers/statusEffects.mjs#applyLifeChange) and it wasn't ALREADY true
 * beforehand (so re-applying damage to an already-dead target, e.g.
 * overkill, never grants Kill FP a second time) - a Kill FP to the
 * attacker for killSkillKey, plus (if the attacker is currently Concealed -
 * Attentat/Assassination) an additional "assassinationKill" FP to their
 * Attentat skill. Also wears down the defender's own Durability, same as
 * ever (see helpers/materials.mjs#isDurabilityEnabled) - once per call,
 * regardless of how many entries it carries (a single hit, not one tick
 * per entry), uniformly for every damage source that funnels through here
 * (weapon/Martial Arts attacks, spells, techniques).
 *
 * Doesn't post any chat message itself, nor resolve the defender - the
 * caller (a manual "Apply Damage" button click below, or
 * helpers/attackRolls.mjs#autoResolveAttackForTargets) decides both.
 * @param {Actor} defender
 * @param {Actor|null} attacker
 * @param {Array<{damageType: string, amount: number}>} entries
 * @param {string|null} killSkillKey   The attacker's own skill to credit a
 *   Kill to, if this ends up being the killing blow - null for sources with
 *   no configured "kill" rate.
 * @param {string|null} [techniqueItemUuid]   A consumed "effect"/
 *   "attackTarget" Technique's own payload (see renderApplyDamageButton's
 *   own techniqueEffect param) - applied unconditionally alongside the
 *   damage entries above, same as a real button click always has.
 * @return {Promise<{lines: string[]}>}
 */
export async function applyResolvedDamageEntries(defender, attacker, entries, killSkillKey, techniqueItemUuid = null) {
  if (isDurabilityEnabled()) {
    for (const armorItem of getDurabilityAffectedArmor(defender)) {
      await armorItem.update({ 'system.durability.value': Math.max(0, armorItem.system.durability.value - 1) });
    }
  }

  let netDelta = 0;
  const lines = [];
  for (const { damageType, amount } of entries) {
    const { amount: adjusted, healing, outcome } = applyElementalDefense(defender, damageType, amount);
    netDelta += healing ? adjusted : -adjusted;
    const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damageType] ?? damageType);
    // NPCs report only the qualitative outcome (never the real amount), so
    // players can't reverse-engineer an NPC's exact Life/Resistance/
    // Weakness from the chat log - see helpers/defense.mjs#
    // applyElementalDefense's own outcome doc comment. Characters (the
    // party's own sheets, already fully visible to their players anyway)
    // keep the exact number.
    if (defender.type === 'npc') {
      const outcomeKey = NPC_DAMAGE_OUTCOME_KEYS[outcome];
      lines.push(`<div class="sksk-roll-line">${game.i18n.format(outcomeKey, { type: typeLabel })}</div>`);
    } else {
      const outcomeKey = healing ? 'SKSK.AttackRoll.DamageAbsorbedIntoHealing' : 'SKSK.AttackRoll.DamageApplied';
      lines.push(`<div class="sksk-roll-line">${game.i18n.format(outcomeKey, { type: typeLabel, amount: adjusted })}</div>`);
    }
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

  if (techniqueItemUuid) {
    lines.push(await applyTechniqueEffectBundle(techniqueItemUuid, defender));
  }

  const wasAlreadyDead = defender.system.life.value === 0 && defender.system.negativeLife.value <= 0;
  const { lifeDelta, negativeLifeDelta } = await applyLifeChange(defender, netDelta);
  lines.push(negativeLifeOverflowHTML(defender, negativeLifeDelta));
  const damageDealt = damageDealtFrom({ lifeDelta, negativeLifeDelta });
  // The Elementarist ability's own Todesmagie-Ladungen bonus (helpers/
  // elementalChargeEffects.mjs) - the attacker heals whenever it deals real
  // damage (not a pure heal, and not if it merely tickled an already-0
  // Life/Negative Life target for 0 actual damage) to ANY defender, not
  // just one this attack happened to kill.
  if (attacker && damageDealt > 0) {
    const deathChargeHeal = getElementalDeathChargeHeal(attacker);
    if (deathChargeHeal > 0) await applyLifeChange(attacker, deathChargeHeal);
  }
  // Concentration's own damage-response check (see helpers/statusEffects.mjs#
  // checkConcentration) - a no-op unless the defender is actually
  // Concentrating and this call's own net Life change was real damage (not
  // a pure heal). Posts its own separate chat card. Deliberately NOT wired
  // into Adrenalinschaden/Kauterisierung (helpers/statusEffects.mjs#
  // applyAdrenalinDamage/applyCauterization) - those reduce max Life via a
  // standing ActiveEffect rather than ever landing here, so they're
  // naturally excluded without any extra guard.
  await checkConcentration(defender, damageDealt);

  const isDead = defender.system.life.value === 0 && defender.system.negativeLife.value <= 0;
  if (isDead && !wasAlreadyDead && attacker && killSkillKey) {
    lines.push(formatSkillFpGrantLine(await grantSkillUsageFp(attacker, killSkillKey, 'kill')));
    lines.push(`<div class="sksk-roll-line"><strong>${game.i18n.format('SKSK.AttackRoll.KillConfirmed', { defender: defender.name })}</strong></div>`);
    if (getStatusStacks(attacker, 'concealed') > 0) {
      lines.push(formatSkillFpGrantLine(await grantSkillUsageFp(attacker, 'assassination', 'assassinationKill')));
    }
  }

  return { lines };
}

/**
 * The "Manueller Schaden" (Manual Damage) window's own confirm button (see
 * apps/manual-damage-dialog.mjs) - rolls each freeform {formula,
 * damageType} entry the GM/player typed in (a plain flat number and a dice
 * formula both evaluate the same way through Roll, so neither needs its
 * own special-casing), resolves a defender exactly like a chat "Apply
 * Damage" button does (resolveClickDefender - the user's own current
 * target, else a GM's own controlled token, else their assigned
 * character), and applies the results through the exact same
 * applyResolvedDamageEntries pipeline (Resistance/Weakness/Immunity/
 * Absorption, Life/Negative Life netting) - with no attacker (this damage
 * has no in-fiction source of its own) and no killSkillKey (nothing to
 * credit a Kill to). Posts one chat card with every entry's own roll
 * alongside the usual application summary; a no-op (just a warning, no
 * chat message) if there's no resolvable defender, no entry has both a
 * non-blank formula and a chosen damage type, or any formula fails to
 * parse/evaluate.
 * @param {Array<{formula: string, damageType: string}>} rawEntries
 * @return {Promise<ChatMessage|void>}
 */
export async function rollAndApplyManualDamage(rawEntries) {
  const defender = resolveClickDefender();
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const rollData = defender.getRollData();
  const resolvedEntries = [];
  const rollLines = [];
  const rolls = [];
  for (const { formula, damageType } of rawEntries) {
    if (!formula?.trim() || !damageType) continue;
    let roll;
    try {
      roll = await new Roll(formula, rollData).evaluate();
    } catch (error) {
      return ui.notifications.error(game.i18n.format('SKSK.ManualDamage.InvalidFormula', { formula }));
    }
    rolls.push(roll);
    resolvedEntries.push({ damageType, amount: roll.total });
    const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damageType] ?? damageType);
    rollLines.push(
      `<div class="sksk-roll-line">${game.i18n.format('SKSK.ManualDamage.RolledEntry', { type: typeLabel, formula })}</div>${await roll.render()}`
    );
  }
  if (!resolvedEntries.length) return ui.notifications.warn(game.i18n.localize('SKSK.ManualDamage.NoEntries'));

  const { lines } = await applyResolvedDamageEntries(defender, null, mergeDamageEntries(resolvedEntries), null);

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: game.i18n.format('SKSK.ManualDamage.ChatTitle', { defender: defender.name }),
    content: `<div class="sksk-chat-card sksk-action-card">${rollLines.join('')}${lines.join('')}</div>`,
    rolls,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * Handle a click on an "Apply Damage" button (see renderApplyDamageButton):
 * resolves the defender (helpers/attackRolls.mjs#resolveClickDefender),
 * applies the button's own carried entries/Technique payload through
 * applyResolvedDamageEntries above, and posts a chat summary either way.
 * @param {HTMLElement} button
 * @return {Promise<ChatMessage|void>}
 */
export async function applyDamageFromChat(button) {
  const defender = resolveClickDefender();
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const attacker = button.dataset.attackerUuid ? await fromUuid(button.dataset.attackerUuid) : null;
  const entries = JSON.parse(decodeURIComponent(button.dataset.damageEntries || '[]'));
  const killSkillKey = button.dataset.killSkill || null;

  const { lines } = await applyResolvedDamageEntries(
    defender, attacker, entries, killSkillKey, button.dataset.techniqueItemUuid || null
  );

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: game.i18n.format('SKSK.AttackRoll.DamageAppliedTitle', { defender: defender.name }),
    content: `<div class="sksk-chat-card sksk-action-card">${lines.join('')}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
