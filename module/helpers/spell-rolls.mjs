import {
  computeDamageBonus, computeSavingThrowValue, computeSavingThrowBonusSum, computeSpellManaCost, computeSpellApCost,
  computeRitualHours, computeMaxOverchargeCount, computeOverchargedRanges,
} from './spells.mjs';
import { getActorSkillLevel, getSkillLabel } from './skills.mjs';
import {
  applyD20Malus, canCastMovementSpell, getStatusStacks, setStatusStacks, payManaCost, negativeLifeOverflowHTML,
  isActorsOwnTurn,
} from './statusEffects.mjs';
import {
  computeSpellAttackBonus, rollAttackPair, renderAttackPairHTML, getDamageDieSizes,
} from './attackRolls.mjs';
import {
  resolveCheckSuccess, wrapCriticalBlock, wrapCriticalInline, chooseGenericRollMode, evaluateD20WithMode,
  formatD20ModeSummaryLine,
} from './criticalRolls.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine, grantFlatSkillFp, checkReflexActionTrigger } from './skillFp.mjs';
import { renderApplyDamageButton, resolveClickDefender, applySpellEffectGroup } from './damageApplication.mjs';
import {
  consumePrimedTechnique, applyTechniqueBonusDamage, applyTechniqueDiceIncrease,
  getTechniqueEffectPayload, renderTechniqueSavingThrowHTML,
} from './technique-rolls.mjs';
import { formatRollCardHeading } from './rollCard.mjs';

// A Combat round is 6 seconds (see helpers/criticalRolls.mjs and the
// Combat turn-start hooks in statusEffects.mjs), so a "minutes"-unit
// spell's own value converts to this many Combat rounds per minute - see
// rollSpellItem/handlePendingSpellTurnStart.
const ROUNDS_PER_MINUTE = 10;

/**
 * Create (if none exists yet) one of a Spell's own foundryEffects entries'
 * linked ActiveEffect, initially disabled - lives as a template on the
 * CASTER's own actor, copied onto whoever it lands on at apply time (see
 * helpers/damageApplication.mjs#applySpellEffectGroup), same bind-then-
 * toggle pattern as helpers/technique-rolls.mjs#ensureLinkedEffect. A no-op
 * (returns "") if the spell isn't owned by an actor - nothing to host the
 * template effect.
 * @param {Item} item
 * @param {number} index   Index into item.system.foundryEffects.
 * @return {Promise<string>}
 */
export async function ensureLinkedSpellEffect(item, index) {
  if (!item.actor) return '';
  const entry = item.system.foundryEffects[index];
  if (!entry) return '';
  if (entry.effectId && item.actor.effects.get(entry.effectId)) return entry.effectId;

  const [effect] = await item.actor.createEmbeddedDocuments('ActiveEffect', [{
    name: entry.name || item.name,
    img: item.img || 'icons/svg/aura.svg',
    origin: item.uuid,
    disabled: true,
  }]);
  const foundryEffects = foundry.utils.deepClone(item.system.foundryEffects);
  foundryEffects[index].effectId = effect.id;
  await item.update({ 'system.foundryEffects': foundryEffects });
  return effect.id;
}

/**
 * The localized label for a spell's own magic school/category, whichever
 * is meaningful for its spellType - Simple/Advanced's own magicSchool,
 * Combined's own combinedSchool, or Systemless's own systemlessCategory.
 * @param {object} system
 * @return {string}
 */
function resolveSpellSchoolLabel(system) {
  if (system.spellType === 'simple') return game.i18n.localize(CONFIG.SKSK.simpleMagicSchools[system.magicSchool] ?? system.magicSchool);
  if (system.spellType === 'advanced') return game.i18n.localize(CONFIG.SKSK.advancedMagicSchools[system.magicSchool] ?? system.magicSchool);
  if (system.spellType === 'combined') return game.i18n.localize(CONFIG.SKSK.combinedMagicSchools[system.combinedSchool] ?? system.combinedSchool);
  if (system.spellType === 'systemless') return game.i18n.localize(CONFIG.SKSK.systemlessMagicCategories[system.systemlessCategory] ?? system.systemlessCategory);
  return '';
}

/**
 * A single joined line of this spell's own active castingMethods (see
 * data/spell.mjs#castingMethods) - Sacrifice/Medium each append their own
 * freeform description in parentheses, when set.
 * @param {object} system
 * @return {string}   '' if no casting method is active at all.
 */
function formatCastingMethodsLine(system) {
  const labels = [];
  for (const [key, enabled] of Object.entries(system.castingMethods ?? {})) {
    if (!enabled) continue;
    let label = game.i18n.localize(CONFIG.SKSK.castingMethods[key] ?? key);
    if (key === 'sacrifice' && system.sacrificeDescription) label += ` (${system.sacrificeDescription})`;
    if (key === 'medium' && system.mediumDescription) label += ` (${system.mediumDescription})`;
    labels.push(label);
  }
  return labels.join(', ');
}

/**
 * Prompt for how many times to Überladen (Overcharge) a spell cast - one
 * button per count from 1 to computeMaxOverchargeCount(actor), matching
 * helpers/attackRolls.mjs#chooseAttackMode's own one-click DialogV2.wait
 * pattern (a button's own callback resolves the promise directly;
 * rejectClose:false so closing without choosing aborts the cast entirely,
 * same as closing that mode dialog aborts an Evaluate click).
 * @param {Actor} actor
 * @param {Item} item   The spell item, for the dialog's own title.
 * @return {Promise<number|null>} The chosen count, or null/undefined if
 *   the dialog was closed without picking one - the caller should abort.
 */
export async function chooseOverchargeCount(actor, item) {
  const max = computeMaxOverchargeCount(actor);
  const buttons = [];
  for (let count = 1; count <= max; count++) {
    buttons.push({
      action: `overcharge${count}`,
      label: game.i18n.format('SKSK.Spell.Roll.OverchargeCount', { count }),
      callback: () => count,
    });
  }
  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format('SKSK.Spell.Roll.OverchargeTitle', { name: item.name }) },
    content: `<p>${game.i18n.localize('SKSK.Spell.Roll.ChooseOverchargePrompt')}</p>`,
    buttons,
    rejectClose: false,
  });
}

/**
 * Roll one damage entry (its formula plus any attribute/skill scaling) and
 * render it as a chat-card line - also returns its own {damageType,
 * amount}, for the caller to feed into renderApplyDamageButton (Magic
 * Schools have no configured "kill" rate, so a spell's own Apply Damage
 * buttons are always rendered with a null killSkillKey). Überladen
 * (Overcharge)'s +50%/Überladung damage rule (cumulative-additive) is
 * applied to the roll's own total after the fact - there's no formula-level
 * value to scale beforehand, only a post-roll amount - with its own line
 * showing the boosted total; the entry itself carries that boosted amount
 * (not the raw roll) so Apply Damage reflects it too.
 * @param {object} damage   An entry from SKSKSpell#damages.
 * @param {Actor} actor     The caster, for scaling bonuses.
 * @param {number} [overchargeCount=0]
 * @param {object|null} [spellSystem]   The casting spell's own system data,
 *   for a Lehre damage bonus scoped to its magic school.
 * @param {object|null} [technique]   A consumed "attackBonus" Technique
 *   whose own Schadenswürfelerhöhung (see helpers/technique-rolls.mjs#
 *   applyTechniqueDiceIncrease) should scale this roll's own dice term -
 *   only ever passed for the first damage entry actually rolled (see
 *   rollDamageWithTechnique below), null otherwise.
 * @return {Promise<{html: string, entry: {damageType: string, amount: number}}>}
 */
async function renderDamageRoll(damage, actor, overchargeCount = 0, spellSystem = null, technique = null) {
  const bonus = computeDamageBonus(damage, actor, spellSystem);
  const formulaBase = bonus ? `${damage.formula} + ${bonus}` : damage.formula;
  const formula = applyTechniqueDiceIncrease(formulaBase, technique);
  // rollData exposes the actor's custom resources (see actor-base.mjs#
  // getRollData) as "@<abbreviation>", usable directly in the formula.
  const roll = await new Roll(formula, actor?.getRollData()).evaluate();
  const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damage.damageType] ?? damage.damageType);
  const rendered = await roll.render();
  let amount = roll.total;
  let overchargeHTML = '';
  if (overchargeCount > 0) {
    amount = Math.floor(amount * (1 + 0.5 * overchargeCount));
    overchargeHTML = `<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.OverchargeDamage', { amount })}</div>`;
  }
  const html = `<div class="sksk-roll-damage"><strong>${typeLabel} ${game.i18n.localize('SKSK.Spell.Roll.Damage')}</strong></div>${rendered}${overchargeHTML}`;
  return { html, entry: { damageType: damage.damageType, amount } };
}

/**
 * Roll the caster's own side of a "Wettstreit" (contest) saving throw (see
 * data/spell.mjs#savingThrows.contest): 1d20 plus this save's own
 * attribute-/skill-bonuses (the same bonuses a fixed-DC save would fold
 * into its DC - see computeSavingThrowValue), evaluated once right when
 * the saving-throw button is rendered and then fixed on that button for
 * every later opposing roll against it (see resolveAndRollSavingThrow's
 * contestTotal param) - the caster's own roll doesn't change just because
 * someone rolls against it later.
 * @param {object} save
 * @param {Actor} actor   The caster.
 * @return {Promise<{roll: Roll, total: number}>}
 */
async function rollContestCasterRoll(save, actor) {
  const bonus = computeSavingThrowBonusSum(save, actor);
  const roll = await new Roll(`1d20 + ${bonus}`, actor?.getRollData()).evaluate();
  return { roll, total: roll.total };
}

/**
 * Render one saving throw as a clickable button carrying enough data
 * (item UUID + index) for rollSavingThrowFromChat to resolve it later,
 * whenever anyone clicks it - including the Überladen (Overcharge) count
 * this cast used (already DC-baked-in below, but also stashed on the
 * button so a later click reproduces the exact same DC rather than
 * recomputing off the item's current state).
 *
 * A "Wettstreit" (contest) saving throw (save.contest) has no fixed DC at
 * all - instead the caster's own d20 roll happens right here (see
 * rollContestCasterRoll), is shown inline, and its total is stashed on the
 * button so whoever clicks it later rolls their own d20 + bonus against
 * that fixed roll instead of a DC.
 * @param {object} save    An entry from SKSKSpell#savingThrows.
 * @param {number} index   Its index into savingThrows.
 * @param {Item} item      The spell item (owned by the caster).
 * @param {number} [overchargeCount=0]
 * @return {Promise<string>}
 */
async function renderSavingThrowButton(save, index, item, overchargeCount = 0) {
  const label = save.label || game.i18n.format('SKSK.Spell.SavingThrow.Numbered', { number: index + 1 });
  if (save.contest) {
    const casterRoll = await rollContestCasterRoll(save, item.actor);
    const rollHTML = await casterRoll.roll.render();
    return `<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ContestCasterRoll', { label })}</div>${rollHTML}
    <button type="button" class="sksk-roll-save" data-action="rollSavingThrow"
      data-item-uuid="${item.uuid}" data-save-index="${index}" data-overcharge="${overchargeCount}" data-contest-total="${casterRoll.total}">
      ${game.i18n.format('SKSK.Spell.Roll.ContestButton', { label, total: casterRoll.total })}
    </button>`;
  }
  const dc = computeSavingThrowValue(save, item.actor, overchargeCount);
  return `<button type="button" class="sksk-roll-save" data-action="rollSavingThrow"
    data-item-uuid="${item.uuid}" data-save-index="${index}" data-overcharge="${overchargeCount}">
    ${label} (DC ${dc})
  </button>`;
}

/**
 * Post a spell's chat card (own helper so both an immediate cast and a
 * later payoff - see handlePendingSpellTurnStart - share the exact same
 * message shape).
 * @param {Item} item
 * @param {string[]} parts
 * @return {Promise<ChatMessage>}
 */
async function postSpellChatCard(item, parts) {
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: item.actor }),
    flavor: item.name,
    content: `<div class="sksk-chat-card sksk-spell-card">${parts.join('')}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * Render every effect part of a spell - any attack rolls (and the damage
 * tied to each), any saving throws to request (and the damage/status
 * effects tied to them), and any unconditional damage/status effects.
 * Split out from rollSpellItem so a spell whose AP cost couldn't be fully
 * paid at cast time (see rollSpellItem/handlePendingSpellTurnStart) can
 * defer this until the debt is paid off, instead of the spell taking
 * effect the instant it's cast. This is also the single place shared by
 * every resolution path (immediate cast, AP-debt payoff, "minutes"-unit
 * rounds payoff), so a "Ritual" casting-method spell's own Ritualism
 * "hours spent" FP (see helpers/spells.mjs#computeRitualHours) is granted
 * right here - only once the spell actually resolves, never at commit
 * time, and never for one cancelled by a Concentration break first.
 *
 * Überladen (Overcharge)'s effect scaling (saving throw DC, ranges,
 * damage) is applied here too, gated by the spell's own
 * overchargeAutoEffects switch - "effectiveOvercharge" is overchargeCount
 * with that switch respected (zeroed out when it's off), while the raw
 * overchargeCount (unconditional) still drives the always-shown "Überladen
 * (×N)" marker, since the AP/Mana cost was paid either way.
 *
 * A primed Technique (helpers/technique-rolls.mjs) is consumed here too -
 * this is the one place shared by every resolution path, matching "the
 * spell's effect actually happening" rather than "cast" (a deferred spell
 * only consumes it once its AP debt/ritual minutes are paid off, not at the
 * initial cast). Its own styleAttackBonus (from any active same-Kampfstil
 * stand) applies to every attack roll this cast makes; its own attackBonus
 * payload (if any) applies once, to the first damage roll actually rolled
 * (attack-triggered first, else save-triggered, else unconditional).
 * @param {Item} item   The spell item.
 * @param {number} [overchargeCount=0]
 * @return {Promise<string[]>}
 */
async function renderSpellEffectParts(item, overchargeCount = 0) {
  const actor = item.actor;
  const system = item.system;
  const parts = [];
  const effectiveOvercharge = system.overchargeAutoEffects !== false ? overchargeCount : 0;
  const technique = actor ? await consumePrimedTechnique(actor, 'spell') : null;
  // An "effect" Technique's own saving-throw-gated apply button (if
  // configured) - independent of damage entirely, so rendered once here
  // regardless of which effect branch below actually fires.
  parts.push(renderTechniqueSavingThrowHTML(technique));
  let techniqueDamageApplied = false;
  // Consumed at most once, by whichever of the (up to 3) Apply-Damage
  // buttons below renders first - see renderApplyDamageButton's own
  // techniqueEffect param (helpers/damageApplication.mjs).
  let pendingTechniqueEffect = getTechniqueEffectPayload(technique);
  const takeTechniqueEffect = () => {
    const payload = pendingTechniqueEffect;
    pendingTechniqueEffect = null;
    return payload;
  };

  const rollDamageWithTechnique = async (damage) => {
    const applyTech = technique && !techniqueDamageApplied;
    const { html, entry } = await renderDamageRoll(damage, actor, effectiveOvercharge, system, applyTech ? technique : null);
    if (applyTech) {
      const adjusted = await applyTechniqueBonusDamage(entry.amount, technique, actor?.getRollData());
      entry.amount = adjusted.total;
      techniqueDamageApplied = true;
      return { html: html + adjusted.line, entry };
    }
    return { html, entry };
  };

  if (overchargeCount > 0) {
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.format('SKSK.Spell.Roll.OverchargeActive', { count: overchargeCount })}</strong></div>`);
  }
  if (effectiveOvercharge > 0 && system.ranges?.length) {
    const rangeLabel = computeOverchargedRanges(system.ranges, effectiveOvercharge)
      .map(r => `${r.distance}m ${game.i18n.localize(CONFIG.SKSK.rangeIndicators[r.indicator] ?? r.indicator)}`)
      .join(', ');
    parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.OverchargeRanges', { ranges: rangeLabel })}</div>`);
  }

  if (actor && system.castingMethods?.ritual) {
    const hours = computeRitualHours(system);
    parts.push(formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'ritualism', 'ritualHour', hours)));
  }

  // 9. Angriffswurf, and its own attack-triggered damage right alongside
  // it (one Angriffswurf+Schaden+Apply-Damage group per iteration, for
  // multi-attack spells) - independent of any saving throws below, so a
  // spell may use both an attack roll and a save at once.
  if (system.attackRoll.enabled) {
    const attackDamages = system.damages.filter(d => d.trigger === 'attack');
    const damageDice = attackDamages.map(damage => ({ damageType: damage.damageType, dieSizes: getDamageDieSizes(damage.formula) }));
    const attackBonus = actor ? computeSpellAttackBonus(system, actor) + (technique?.styleAttackBonus ?? 0) + (technique?.hitBonusAmount ?? 0) : 0;
    for (let i = 1; i <= system.attackRoll.count; i++) {
      const rolls = await rollAttackPair(attackBonus, actor);
      const rendered = await renderAttackPairHTML(rolls, 'magicResistance', actor, { damageDice });
      parts.push(`<div class="sksk-roll-attack"><strong>${game.i18n.format('SKSK.Spell.Roll.Attack', { number: i })}</strong></div>${rendered}`);

      const damageEntries = [];
      for (const damage of attackDamages) {
        const { html, entry } = await rollDamageWithTechnique(damage);
        parts.push(html);
        damageEntries.push(entry);
      }
      parts.push(renderApplyDamageButton(actor, damageEntries, null, takeTechniqueEffect()));
    }
  }

  // 10. Schaden - save-triggered damage, grouped by savingThrowIndex, each
  // group's own (purely informational, unchanged) saving-throw button
  // placed directly above it - then unconditional damage. A blank/null
  // savingThrowIndex defaults to 0 - a <select> with only one saving throw
  // defined shows it pre-selected via plain browser default (the only
  // option), which never fires a "change" event on its own, so the field
  // can stay unset in storage despite visually showing the right choice;
  // reading it as 0 keeps that visual default and the actual applied
  // saving throw in sync instead of silently dropping the entry.
  const saveIndexesWithDamage = [...new Set(
    system.damages.filter(d => d.trigger === 'save').map(d => d.savingThrowIndex ?? 0)
  )];
  for (const idx of saveIndexesWithDamage) {
    if (!system.savingThrows[idx]) continue;
    parts.push(`<div class="sksk-roll-saves">${await renderSavingThrowButton(system.savingThrows[idx], idx, item, effectiveOvercharge)}</div>`);
    const saveDamageEntries = [];
    for (const damage of system.damages.filter(d => d.trigger === 'save' && (d.savingThrowIndex ?? 0) === idx)) {
      const { html, entry } = await rollDamageWithTechnique(damage);
      parts.push(html);
      saveDamageEntries.push(entry);
    }
    parts.push(renderApplyDamageButton(actor, saveDamageEntries, null, takeTechniqueEffect()));
  }

  const unconditionalDamageEntries = [];
  for (const damage of system.damages.filter(d => d.trigger === 'unconditional')) {
    const { html, entry } = await rollDamageWithTechnique(damage);
    parts.push(html);
    unconditionalDamageEntries.push(entry);
  }
  parts.push(renderApplyDamageButton(actor, unconditionalDamageEntries, null, takeTechniqueEffect()));

  // 11. Status/Foundry effects tied to the attack roll - merged into one
  // "Effekt anwenden" button, separate from the attack's own Apply Damage
  // button(s) above (only relevant if the spell actually has an attack roll).
  if (system.attackRoll.enabled) {
    parts.push(renderSpellEffectApplyButtonHTML(item, 'attack'));
  }

  // 12. Rettungswürfe für Statuseffekte/Foundry-Effekte - one merged,
  // effect-gating button (see renderSpellEffectSaveButtonHTML) per
  // savingThrowIndex actually used by any such entry; multiple entries
  // sharing the same index are merged into that one button. A blank/null
  // savingThrowIndex defaults to 0 - see the identical fallback (and its
  // own comment) on saveIndexesWithDamage above.
  const saveIndexesWithEffects = new Set();
  for (const entry of system.statusEffects ?? []) {
    if (entry.trigger === 'save') saveIndexesWithEffects.add(entry.savingThrowIndex ?? 0);
  }
  for (const entry of system.foundryEffects ?? []) {
    if (entry.trigger === 'save') saveIndexesWithEffects.add(entry.savingThrowIndex ?? 0);
  }
  for (const idx of saveIndexesWithEffects) {
    parts.push(await renderSpellEffectSaveButtonHTML(item, idx, effectiveOvercharge));
  }

  // 13. Status/Foundry effects applied unconditionally.
  parts.push(renderSpellEffectApplyButtonHTML(item, 'unconditional'));

  return parts;
}

/**
 * Cast a spell: post one chat message with its description, its Mana/AP
 * cost, and (unless its AP cost couldn't be fully paid right away - see
 * below) its full effect (attack rolls, damage, saving throws).
 *
 * Mana cost is paid immediately - drains Mana first, then Life (and
 * Negative Life, once Life bottoms out) for whatever's left over (see
 * helpers/statusEffects.mjs#payManaCost). AP cost is paid immediately too,
 * as much as current AP allows; if that doesn't cover it, the remainder is
 * stored on system.pendingSpell and Concentration is turned on - the spell
 * doesn't take effect yet. From then on, helpers/statusEffects.mjs#
 * handlePendingSpellTurnStart pays down that remainder at the start of
 * each of the caster's later Combat turns (while Concentration holds),
 * and the spell finally takes effect once it reaches 0. Should
 * Concentration break first (see checkConcentration), the spell is
 * cancelled outright - the AP debt is forgiven, but the Mana already
 * spent at cast time is not.
 *
 * Casting is blocked entirely while a previous spell of this actor's is
 * still awaiting its AP payoff.
 * @param {Item} item   The spell item being cast.
 * @param {number} [overchargeCount=0]   How many times to Überladen
 *   (Overcharge) this cast - see helpers/spells.mjs#
 *   computeMaxOverchargeCount/chooseOverchargeCount below.
 * @return {Promise<ChatMessage|void>}
 */
export async function rollSpellItem(item, overchargeCount = 0) {
  const actor = item.actor;
  const system = item.system;

  // Prone/Restrained block any spell whose casting method is Movement -
  // see helpers/statusEffects.mjs#canCastMovementSpell.
  if (actor && system.castingMethods?.movement && !canCastMovementSpell(actor)) {
    ui.notifications.warn(game.i18n.localize('SKSK.StatusEffect.MovementSpellBlocked'));
    return;
  }

  if (actor) {
    const hasPendingDebt = (actor.system.pendingSpell?.apCost ?? 0) > 0 || (actor.system.pendingSpell?.roundsRemaining ?? 0) > 0;
    if (hasPendingDebt && getStatusStacks(actor, 'concentration') > 0) {
      ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.AlreadyConcentrating'));
      return;
    }
    if (hasPendingDebt) {
      // Concentration is gone but its own AP-debt/ritual-rounds fields were
      // left behind - normally these only clear together (a failed
      // Concentration check clears both at once, see helpers/
      // statusEffects.mjs#checkConcentration; handlePendingSpellTurnStart
      // below likewise only pays this down while Concentration is still
      // active). If Concentration was instead removed some other way (e.g.
      // a GM manually clearing the status), self-heal here instead of
      // leaving a stale debt that would silently block every future cast.
      await actor.update({ 'system.pendingSpell': { itemId: '', apCost: 0, roundsRemaining: 0 } });
    }
  }

  if (actor) overchargeCount = Math.min(overchargeCount, computeMaxOverchargeCount(actor));

  // 1. Heading, 2. Magic school.
  const parts = [formatRollCardHeading(item.name)];
  const schoolLabel = resolveSpellSchoolLabel(system);
  if (schoolLabel) parts.push(`<div class="sksk-roll-magic-school">${schoolLabel}</div>`);

  const descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    system.description ?? '', { relativeTo: item, secrets: item.isOwner }
  );

  let deferred = false;

  // Outside the caster's own turn, only apCostUnit "ap" (paying rpCost, or
  // apCost itself if rpCost isn't set) and the pure-reaction "rp" unit can
  // be cast at all - Ritual spells (minutes/hours/days) have no off-turn
  // path, and a "rp"-unit spell conversely has no AP path, so it can only
  // ever be cast off-turn. Unlike the on-turn "ap" branch's own AP-debt/
  // pendingSpell mechanic, insufficient RP is a hard block (no partial
  // payment, no chat card, no Mana spent) - see the plan's own confirmed
  // design choice.
  const offTurn = actor && !isActorsOwnTurn(actor);

  if (actor) {
    // 3. AP/RP cost (or ritual minutes/downtime line).
    if (system.apCostUnit === 'minutes' || system.apCostUnit === 'hours' || system.apCostUnit === 'days') {
      if (offTurn) {
        ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.RitualBlockedOffTurn'));
        return;
      }
      if (system.apCostUnit === 'minutes') {
        const totalRounds = Math.max(1, system.apCost) * ROUNDS_PER_MINUTE;
        await actor.update({ 'system.pendingSpell': { itemId: item.id, apCost: 0, roundsRemaining: totalRounds, overchargeCount } });
        await setStatusStacks(actor, 'concentration', 1);
        parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.RitualMinutesStarted', { minutes: system.apCost, rounds: totalRounds })}</div>`);
        deferred = true;
      } else {
        const unitLabel = game.i18n.localize(CONFIG.SKSK.apCostUnits[system.apCostUnit]);
        parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.RitualDowntime', { value: system.apCost, unit: unitLabel })}</div>`);
      }
    } else if (system.apCostUnit === 'rp') {
      if (!offTurn) {
        ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ReactiveOnlyBlocked'));
        return;
      }
      const rpCost = computeSpellApCost(system, actor, overchargeCount);
      const rp = actor.system.reactionPoints.value;
      if (rp < rpCost) {
        ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughRP'));
        return;
      }
      parts.push(`<div class="sksk-roll-rp-cost"><strong>${game.i18n.localize('SKSK.Spell.RPCost')}:</strong> ${rpCost}</div>`);
      await actor.update({ 'system.reactionPoints.value': rp - rpCost });
      parts.push(formatSkillFpGrantLine(await checkReflexActionTrigger(actor)));
    } else if (offTurn) {
      const apCost = computeSpellApCost(system, actor, overchargeCount);
      const rpCost = (system.rpCost ?? 0) > 0 ? system.rpCost : apCost;
      const rp = actor.system.reactionPoints.value;
      if (rp < rpCost) {
        ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughRP'));
        return;
      }
      parts.push(`<div class="sksk-roll-rp-cost"><strong>${game.i18n.localize('SKSK.Spell.RPCost')}:</strong> ${rpCost}</div>`);
      await actor.update({ 'system.reactionPoints.value': rp - rpCost });
      parts.push(formatSkillFpGrantLine(await checkReflexActionTrigger(actor)));
    } else {
      const apCost = computeSpellApCost(system, actor, overchargeCount);
      parts.push(`<div class="sksk-roll-ap-cost"><strong>${game.i18n.localize('SKSK.Spell.APCost')}:</strong> ${apCost}</div>`);

      const ap = actor.system.actionPoints.value;
      const paidNow = Math.min(ap, apCost);
      const remaining = apCost - paidNow;
      if (paidNow) {
        await actor.update({ 'system.actionPoints.value': ap - paidNow });
        parts.push(formatSkillFpGrantLine(await checkReflexActionTrigger(actor)));
      }

      if (remaining > 0) {
        await actor.update({ 'system.pendingSpell': { itemId: item.id, apCost: remaining, roundsRemaining: 0, overchargeCount } });
        await setStatusStacks(actor, 'concentration', 1);
        parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ApOwed', { paid: paidNow, remaining })}</div>`);
        deferred = true;
      }
    }

    // 4. Mana cost.
    const { cost: manaCost, increased } = computeSpellManaCost(system, actor, overchargeCount);
    const costClass = increased ? 'sksk-roll-mana-cost-increased' : '';
    parts.push(`<div class="sksk-roll-mana-cost"><strong>${game.i18n.localize('SKSK.Spell.ManaCost')}:</strong> <span class="${costClass}">${manaCost}</span></div>`);

    // Manakapazität's own FP accumulator (see helpers/rest.mjs#applyRest,
    // which turns this into FP on the next Anpassungs-/Genesungspause) -
    // the real mana cost above (after mali/boni), regardless of whether it
    // actually got paid from Mana or overflowed into Life/Negative Life.
    if (manaCost > 0) {
      await actor.update({ 'system.manaCapacityAccumulator': (actor.system.manaCapacityAccumulator ?? 0) + manaCost });
    }

    const { lifeDelta, negativeLifeDelta } = await payManaCost(actor, manaCost);
    if (lifeDelta || negativeLifeDelta) {
      const fromLife = -lifeDelta + negativeLifeDelta;
      parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ManaShortfallFromLife', { amount: fromLife })}</div>`);
      parts.push(negativeLifeOverflowHTML(negativeLifeDelta));
    }

    // FP for casting a spell (per its own spellLevel) belongs to its magic
    // school - only meaningful for Simple/Advanced spells, which each
    // belong to exactly one (Combined/Systemless spells have none - see
    // CONFIG.SKSK.simpleMagicSchools/advancedMagicSchools). Granted now,
    // at cast time, regardless of whether its AP cost is still owed above.
    if (system.spellType === 'simple' || system.spellType === 'advanced') {
      const fpGrant = await grantSkillUsageFp(actor, system.magicSchool, 'spellCastPerLevel', system.spellLevel);
      parts.push(formatSkillFpGrantLine(fpGrant));

      // Bardic magic (an Advanced school) is also Singing's own "using
      // Bardic magic" trigger - a flat grant alongside Bardic's own
      // spellCastPerLevel above, not instead of it.
      if (system.magicSchool === 'bardic') {
        parts.push(formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'singing', 'bardicSpellCast')));
      }
    }

    // Magic Control and Chant Shortening both generate FP per spell cast,
    // flat (not per level) and regardless of spellType (unlike the
    // magic-school grant above) - Chant Shortening's own trigger is
    // additionally gated on Magic Control being at least level 1, per the
    // design spreadsheet.
    parts.push(formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'magicControl', 'spellCast')));
    if (getActorSkillLevel(actor, 'magicControl') >= 1) {
      parts.push(formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'chantShortening', 'spellCast')));
    }

    // Manakern's own FP grant is a flat, spell-specific value (system.
    // manaCoreFpGrant) rather than a GM-configured rate - see
    // helpers/skillFp.mjs#grantFlatSkillFp.
    parts.push(formatSkillFpGrantLine(await grantFlatSkillFp(actor, 'manaCore', system.manaCoreFpGrant)));

    // Überladen's own "used" FP, scaled by how many times this cast was
    // overcharged - granted now, at commit time (the cost was already
    // paid above), regardless of whether the effect itself is deferred.
    if (overchargeCount > 0) {
      parts.push(formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'overcharge', 'overchargeUsed', overchargeCount)));
    }
  }

  // 5. Ranges + indicator.
  if (system.ranges?.length) {
    const rangesLabel = system.ranges
      .map(r => `${r.distance}m ${game.i18n.localize(CONFIG.SKSK.rangeIndicators[r.indicator] ?? r.indicator)}`)
      .join(', ');
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.Spell.Ranges')}:</strong> ${rangesLabel}</div>`);
  }

  // 6. Duration, only when described.
  if (system.duration) {
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.Spell.DurationLabel')}:</strong> ${system.duration}</div>`);
  }

  // 7. Wirkmethoden (casting methods).
  const castingMethodsLabel = formatCastingMethodsLine(system);
  if (castingMethodsLabel) {
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.Spell.CastingMethodsLabel')}:</strong> ${castingMethodsLabel}</div>`);
  }

  // 8. Description.
  parts.push(`<div class="sksk-roll-description">${descriptionHTML}</div>`);

  if (!deferred) {
    parts.push(...(await renderSpellEffectParts(item, overchargeCount)));
  }

  return postSpellChatCard(item, parts);
}

/**
 * Post a mid-payoff progress line for a still-pending spell (own chat
 * message, speaking as the actor - not yet the spell's own card) - shared
 * by both debt kinds' "still not done" branch in handlePendingSpellTurnStart.
 * @param {Actor} actor
 * @param {string} label
 * @param {string} lineHTML
 * @param {{label: string, amount: number}|null} reflexGrant
 * @return {Promise<ChatMessage>}
 */
async function postPendingSpellProgress(actor, label, lineHTML, reflexGrant) {
  const parts = [formatRollCardHeading(label), lineHTML, formatSkillFpGrantLine(reflexGrant)];
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: label,
    content: `<div class="sksk-chat-card sksk-action-card">${parts.join('')}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * A pending spell's debt fully paid off (either kind - see
 * handlePendingSpellTurnStart): clears pendingSpell, turns Concentration
 * off, and finally lets the spell take effect (see renderSpellEffectParts,
 * with whatever Überladen count the original cast used - see
 * data/actor-base.mjs#pendingSpell.overchargeCount), posted in its own
 * chat message.
 * @param {Actor} actor
 * @param {Item|undefined} item
 * @param {{label: string, amount: number}|null} reflexGrant
 * @param {number} [overchargeCount=0]
 * @return {Promise<void>}
 */
async function resolvePendingSpell(actor, item, reflexGrant, overchargeCount = 0) {
  await actor.update({ 'system.pendingSpell.itemId': '' });
  await setStatusStacks(actor, 'concentration', 0);
  if (!item) return;

  const parts = [formatRollCardHeading(item.name), ...(await renderSpellEffectParts(item, overchargeCount))];
  parts.push(formatSkillFpGrantLine(reflexGrant));
  await postSpellChatCard(item, parts);
}

/**
 * Pay down a pending spell's still-owed debt at the start of this actor's
 * Combat turn - either kind (see rollSpellItem): a fixed AP amount, paying
 * as much as current AP allows each turn, or a "minutes"-unit ritual's own
 * round counter, which instead drains ALL current AP every turn regardless
 * of amount and just counts down by 1. Once either debt reaches 0, the
 * spell finally takes effect (see resolvePendingSpell) and Concentration is
 * turned off. A no-op outside of Concentration (a failed Concentration
 * check already reset both debt fields itself - see helpers/
 * statusEffects.mjs#checkConcentration - which is what actually cancels
 * the spell).
 * @param {Actor} actor
 * @return {Promise<void>}
 */
export async function handlePendingSpellTurnStart(actor) {
  const pending = actor.system.pendingSpell;
  const hasApDebt = (pending?.apCost ?? 0) > 0;
  const hasRoundsDebt = (pending?.roundsRemaining ?? 0) > 0;
  if ((!hasApDebt && !hasRoundsDebt) || getStatusStacks(actor, 'concentration') <= 0) return;

  const item = actor.items.get(pending.itemId);
  const label = item?.name ?? game.i18n.localize('SKSK.StatusEffect.Concentration.Name');
  const overchargeCount = pending.overchargeCount ?? 0;

  if (hasRoundsDebt) {
    const drained = actor.system.actionPoints.value;
    const remaining = pending.roundsRemaining - 1;
    await actor.update({
      'system.actionPoints.value': 0,
      'system.pendingSpell.roundsRemaining': remaining,
    });
    const reflexGrant = drained > 0 ? await checkReflexActionTrigger(actor) : null;

    if (remaining > 0) {
      await postPendingSpellProgress(
        actor, label,
        `<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.RitualRoundPassed', { remaining })}</div>`,
        reflexGrant
      );
      return;
    }

    await resolvePendingSpell(actor, item, reflexGrant, overchargeCount);
    return;
  }

  const ap = actor.system.actionPoints.value;
  const paid = Math.min(ap, pending.apCost);
  const remaining = pending.apCost - paid;
  await actor.update({
    'system.actionPoints.value': ap - paid,
    'system.pendingSpell.apCost': remaining,
  });
  const reflexGrant = paid > 0 ? await checkReflexActionTrigger(actor) : null;

  if (remaining > 0) {
    await postPendingSpellProgress(
      actor, label,
      `<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ApPaidTowardSpell', { paid, remaining })}</div>`,
      reflexGrant
    );
    return;
  }

  await resolvePendingSpell(actor, item, reflexGrant, overchargeCount);
}

/**
 * Shared core of rolling a Spell's own saving throw, self-service: the
 * clicking user's own assigned character (never resolveClickDefender - a
 * saving-throw button is posted in public chat for the TARGET's own player
 * to roll for themselves) rolls 1d20 plus their best applicable attribute
 * modifier or skill level (they "may use whichever they have") against the
 * DC (computed from the CASTER's own bonuses). Shared by both
 * rollSavingThrowFromChat below (the plain, informational button rendered
 * above Damage entries - see renderSavingThrowButton) and
 * rollSpellEffectSaveFromChat (the separate, effect-gating button rendered
 * for statusEffects/foundryEffects entries - see
 * renderSpellEffectSaveButtonHTML), which both need the exact same roll
 * resolution but differ in what happens afterward.
 * @param {Actor} rollingActor   The clicking user's own character - who
 *   actually rolls (and, for the effect-gating caller, who the effect(s)
 *   land on if they fail).
 * @param {Item} casterItem   The spell item, for computing the DC against
 *   its own caster's bonuses.
 * @param {object} save   An entry from SKSKSpell#savingThrows.
 * @param {number} saveIndex
 * @param {number} overchargeCount
 * @param {string} mode   See helpers/criticalRolls.mjs#chooseGenericRollMode.
 * @param {boolean} ignoreSpecial   Shift+click - excludes Spezial-Boni from
 *   the best applicable attribute modifier for this one roll (Modifikator-
 *   Boni still apply; skill-based saves are unaffected either way).
 * @param {number|null} [contestTotal=null]   For a "Wettstreit" (contest)
 *   saving throw (save.contest) - the caster's own roll total, already
 *   fixed at button-render time (see renderSavingThrowButton/
 *   rollContestCasterRoll) and passed through from the button's own
 *   data-contest-total. Used as the value to beat instead of computing a
 *   DC from save.baseValue.
 * @return {Promise<{dc: number, roll: Roll, criticalType: string|null, success: boolean, saveLabel: string, outcome: string, luckHTML: string, best: {label: string, value: number, attributeKey: string|null}, result: object, isContest: boolean}>}
 */
async function resolveAndRollSavingThrow(rollingActor, casterItem, save, saveIndex, overchargeCount, mode, ignoreSpecial, contestTotal = null) {
  let best = null;
  const modField = ignoreSpecial ? 'modExcludingSpecial' : 'mod';
  for (const [attributeKey, enabled] of Object.entries(save.testAttributes ?? {})) {
    if (!enabled) continue;
    const mod = rollingActor.system.attributes?.[attributeKey]?.[modField] ?? 0;
    if (!best || mod > best.value) {
      best = { label: game.i18n.localize(CONFIG.SKSK.attributeAbbreviations[attributeKey]).toUpperCase(), value: mod, attributeKey };
    }
  }
  for (const skillKey of save.testSkills ?? []) {
    const level = getActorSkillLevel(rollingActor, skillKey);
    if (!best || level > best.value) {
      best = { label: game.i18n.localize(getSkillLabel(skillKey)), value: level, attributeKey: null };
    }
  }
  best ??= { label: '', value: 0, attributeKey: null };

  const dc = contestTotal ?? computeSavingThrowValue(save, casterItem.actor, overchargeCount);
  const formula = applyD20Malus(`1d20 + ${best.value}`, rollingActor, best.attributeKey);
  const result = await evaluateD20WithMode(formula, rollingActor.getRollData(), mode);
  const { roll, criticalType, doubleCritical } = result;
  const success = resolveCheckSuccess(roll.total, dc, criticalType);
  const saveLabel = save.label || game.i18n.format('SKSK.Spell.SavingThrow.Numbered', { number: saveIndex + 1 });
  const outcomeKey = criticalType === 'success' ? 'SKSK.Spell.Roll.CriticalSuccess'
    : criticalType === 'failure' ? 'SKSK.Spell.Roll.CriticalFailure'
    : success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure';
  const outcome = wrapCriticalInline(game.i18n.localize(outcomeKey), criticalType);

  // Luck's own "criticalRoll"/"doubleCriticalRoll" FP - any generic (non-
  // Angriffswurf) D20 roll's critical success/double critical, see
  // helpers/criticalRolls.mjs#evaluateD20WithMode.
  let luckHTML = criticalType === 'success'
    ? formatSkillFpGrantLine(await grantSkillUsageFp(rollingActor, 'luck', 'criticalRoll'))
    : '';
  if (doubleCritical) {
    luckHTML += formatSkillFpGrantLine(await grantSkillUsageFp(rollingActor, 'luck', 'doubleCriticalRoll'));
  }
  luckHTML += formatD20ModeSummaryLine(result, mode);

  return { dc, roll, criticalType, success, saveLabel, outcome, luckHTML, best, result, isContest: contestTotal != null };
}

/**
 * Handle a click on a saving-throw button in chat: roll 1d20 plus the
 * clicking user's best applicable attribute modifier or skill level (the
 * target "may use whichever they have"), and post the result against the
 * saving throw's DC - including whatever Überladen (Overcharge) count the
 * original cast baked into the button (see renderSavingThrowButton). Purely
 * informational - never gates anything itself (Damage stays manually
 * applied via its own Apply Damage button either way); see
 * rollSpellEffectSaveFromChat below for the separate, effect-gating sibling.
 * @param {string} itemUuid
 * @param {number} saveIndex
 * @param {number} [overchargeCount=0]
 * @param {boolean} [ignoreSpecial=false]   Shift+click on the chat button
 *   (see sksk.mjs's "rollSavingThrow" delegate).
 * @param {number|null} [contestTotal=null]   See resolveAndRollSavingThrow's
 *   own contestTotal param - passed through from the button's
 *   data-contest-total for a "Wettstreit" (contest) saving throw.
 * @return {Promise<ChatMessage|void>}
 */
export async function rollSavingThrowFromChat(itemUuid, saveIndex, overchargeCount = 0, ignoreSpecial = false, contestTotal = null) {
  const item = await fromUuid(itemUuid);
  if (!item) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const save = item.system.savingThrows?.[saveIndex];
  if (!save) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const actor = game.user.character;
  if (!actor) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.NoCharacter'));

  const mode = await chooseGenericRollMode();
  if (!mode) return;

  const r = await resolveAndRollSavingThrow(actor, item, save, saveIndex, overchargeCount, mode, ignoreSpecial, contestTotal);

  const vsLabel = r.isContest ? game.i18n.format('SKSK.Spell.Roll.VsContestTotal', { total: r.dc }) : `DC ${r.dc}`;
  const flavor = `${r.saveLabel} (${r.best.label}) ${game.i18n.localize('SKSK.Spell.Roll.Vs')} ${vsLabel}: ${r.outcome}`;
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    content: `<div class="sksk-chat-card sksk-action-card">${formatRollCardHeading(r.saveLabel)}${wrapCriticalBlock(await r.roll.render(), r.criticalType)}${r.luckHTML}</div>`,
    rolls: [r.roll],
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * Render a spell's own saving-throw button for a specific savingThrowIndex's
 * status/Foundry effect entries (see data/spell.mjs#statusEffects/
 * foundryEffects) - unlike renderSavingThrowButton (purely informational),
 * clicking this one rolls the save AND (on failure) immediately applies
 * every entry tied to that same index, all in one click (see
 * rollSpellEffectSaveFromChat below) - multiple entries sharing the same
 * savingThrowIndex are naturally merged into this one button. Empty string
 * if that index has no qualifying entries.
 * A "Wettstreit" (contest) saving throw (save.contest) has no fixed DC -
 * the caster's own d20 roll happens right here instead (see
 * rollContestCasterRoll), shown inline, with its total stashed on the
 * button for whoever clicks it later to roll against.
 * @param {Item} item
 * @param {number} savingThrowIndex
 * @param {number} [overchargeCount=0]
 * @return {Promise<string>}
 */
async function renderSpellEffectSaveButtonHTML(item, savingThrowIndex, overchargeCount = 0) {
  const save = item.system.savingThrows?.[savingThrowIndex];
  if (!save) return '';
  const label = save.label || game.i18n.format('SKSK.Spell.SavingThrow.Numbered', { number: savingThrowIndex + 1 });
  if (save.contest) {
    const casterRoll = await rollContestCasterRoll(save, item.actor);
    const rollHTML = await casterRoll.roll.render();
    return `<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ContestCasterRoll', { label })}</div>${rollHTML}
    <button type="button" class="sksk-roll-hit-eval" data-action="rollSpellEffectSave"
      data-item-uuid="${item.uuid}" data-save-index="${savingThrowIndex}" data-overcharge="${overchargeCount}" data-contest-total="${casterRoll.total}">
      ${game.i18n.format('SKSK.Spell.RollEffectSavingThrowContest', { label, total: casterRoll.total })}
    </button>`;
  }
  const dc = computeSavingThrowValue(save, item.actor, overchargeCount);
  return `<button type="button" class="sksk-roll-hit-eval" data-action="rollSpellEffectSave"
    data-item-uuid="${item.uuid}" data-save-index="${savingThrowIndex}" data-overcharge="${overchargeCount}">
    ${game.i18n.format('SKSK.Spell.RollEffectSavingThrow', { label, dc })}
  </button>`;
}

/**
 * Handle a click on a spell effect's own saving-throw button (see
 * renderSpellEffectSaveButtonHTML above): the clicking user's own character
 * rolls their save (same self-service resolution as rollSavingThrowFromChat,
 * sharing its core via resolveAndRollSavingThrow) and - unlike that plain
 * informational button - immediately applies every statusEffects/
 * foundryEffects entry tied to this savingThrowIndex (see helpers/
 * damageApplication.mjs#applySpellEffectGroup) if, and only if, the save was
 * FAILED (a successful save resists every one of them).
 * @param {string} itemUuid
 * @param {number} saveIndex
 * @param {number} [overchargeCount=0]
 * @param {boolean} [ignoreSpecial=false]
 * @param {number|null} [contestTotal=null]   See resolveAndRollSavingThrow's
 *   own contestTotal param - passed through from the button's
 *   data-contest-total for a "Wettstreit" (contest) saving throw.
 * @return {Promise<ChatMessage|void>}
 */
export async function rollSpellEffectSaveFromChat(itemUuid, saveIndex, overchargeCount = 0, ignoreSpecial = false, contestTotal = null) {
  const item = await fromUuid(itemUuid);
  if (!item) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const save = item.system.savingThrows?.[saveIndex];
  if (!save) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const actor = game.user.character;
  if (!actor) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.NoCharacter'));

  const mode = await chooseGenericRollMode();
  if (!mode) return;

  const r = await resolveAndRollSavingThrow(actor, item, save, saveIndex, overchargeCount, mode, ignoreSpecial, contestTotal);
  const appliedHTML = r.success ? '' : await applySpellEffectGroup(itemUuid, 'save', saveIndex, actor);

  const vsLabel = r.isContest ? game.i18n.format('SKSK.Spell.Roll.VsContestTotal', { total: r.dc }) : `DC ${r.dc}`;
  const flavor = `${r.saveLabel} (${r.best.label}) ${game.i18n.localize('SKSK.Spell.Roll.Vs')} ${vsLabel}: ${r.outcome}`;
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    content: `<div class="sksk-chat-card sksk-action-card">${formatRollCardHeading(r.saveLabel)}${wrapCriticalBlock(await r.roll.render(), r.criticalType)}${r.luckHTML}${appliedHTML}</div>`,
    rolls: [r.roll],
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * Whether a spell has any status/Foundry effect entries tied to the given
 * non-save trigger group - "save" entries are handled separately, keyed by
 * savingThrowIndex (see renderSpellEffectSaveButtonHTML above).
 * @param {object} system
 * @param {"attack"|"unconditional"} group
 * @return {boolean}
 */
function spellHasEffectsForGroup(system, group) {
  return (system.statusEffects ?? []).some(e => e.trigger === group)
    || (system.foundryEffects ?? []).some(e => e.trigger === group);
}

/**
 * Render a spell's own "Effekt anwenden" button for a non-save trigger
 * group ("attack"/"unconditional") - applies every status/Foundry effect
 * entry tied to that group (see helpers/damageApplication.mjs#
 * applySpellEffectGroup), merged into one click, resolving the defender the
 * same way Apply Damage does (helpers/damageApplication.mjs#
 * resolveClickDefender - unlike the self-service saving-throw buttons
 * above, since these groups aren't gated by a roll at all). Empty string if
 * the spell has no such entries.
 * @param {Item} item
 * @param {"attack"|"unconditional"} group
 * @return {string}
 */
function renderSpellEffectApplyButtonHTML(item, group) {
  if (!spellHasEffectsForGroup(item.system, group)) return '';
  return `<button type="button" class="sksk-apply-damage" data-action="applySpellEffect"
    data-item-uuid="${item.uuid}" data-group="${group}">
    ${game.i18n.localize('SKSK.Spell.ApplyEffect')}
  </button>`;
}

/**
 * Handle a click on a spell effect's own "Effekt anwenden" button (see
 * renderSpellEffectApplyButtonHTML above) - resolves the defender (helpers/
 * damageApplication.mjs#resolveClickDefender) and applies every entry tied
 * to that group unconditionally (see helpers/damageApplication.mjs#
 * applySpellEffectGroup).
 * @param {string} itemUuid
 * @param {"attack"|"unconditional"} group
 * @return {Promise<ChatMessage|void>}
 */
export async function applySpellEffectFromChat(itemUuid, group) {
  const defender = resolveClickDefender();
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const item = await fromUuid(itemUuid);
  const html = await applySpellEffectGroup(itemUuid, group, null, defender);
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: item?.name ?? '',
    content: `<div class="sksk-chat-card sksk-action-card">${html}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
