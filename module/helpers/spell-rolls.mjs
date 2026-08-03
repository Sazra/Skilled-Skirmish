import { computeDamageBonus, computeSavingThrowValue, computeSpellManaCost, computeSpellApCost } from './spells.mjs';
import { getActorSkillLevel, getSkillLabel } from './skills.mjs';
import {
  applyD20Malus, canCastMovementSpell, getStatusStacks, setStatusStacks, payManaCost, negativeLifeOverflowHTML,
} from './statusEffects.mjs';
import {
  computeSpellAttackBonus, rollAttackPair, renderAttackPairHTML, getDamageDieSizes, rollCriticalBonusDamage,
} from './attackRolls.mjs';
import { getGenericCriticalType, getAttackCriticalType, resolveCheckSuccess, wrapCriticalBlock, wrapCriticalInline } from './criticalRolls.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine, grantFlatSkillFp, checkReflexActionTrigger } from './skillFp.mjs';
import { renderApplyDamageButton } from './damageApplication.mjs';

/**
 * Roll one damage entry (its formula plus any attribute/skill scaling) and
 * render it as a chat-card line - also returns its own {damageType,
 * amount}, for the caller to feed into renderApplyDamageButton (Magic
 * Schools have no configured "kill" rate, so a spell's own Apply Damage
 * buttons are always rendered with a null killSkillKey).
 * @param {object} damage   An entry from SKSKSpell#damages.
 * @param {Actor} actor     The caster, for scaling bonuses.
 * @return {Promise<{html: string, entry: {damageType: string, amount: number}}>}
 */
async function renderDamageRoll(damage, actor) {
  const bonus = computeDamageBonus(damage, actor);
  const formula = bonus ? `${damage.formula} + ${bonus}` : damage.formula;
  // rollData exposes the actor's custom resources (see actor-base.mjs#
  // getRollData) as "@<abbreviation>", usable directly in the formula.
  const roll = await new Roll(formula, actor?.getRollData()).evaluate();
  const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damage.damageType] ?? damage.damageType);
  const rendered = await roll.render();
  const html = `<div class="sksk-roll-line"><strong>${typeLabel} ${game.i18n.localize('SKSK.Spell.Roll.Damage')}</strong></div>${rendered}`;
  return { html, entry: { damageType: damage.damageType, amount: roll.total } };
}

/**
 * Render a status effect entry as a plain description line - placeholder
 * until the status-effect system itself exists.
 * @param {object} effect   An entry from SKSKSpell#statusEffects.
 * @return {string}
 */
function renderStatusEffect(effect) {
  const description = effect.description || '—';
  return `<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.Spell.Roll.StatusEffect')}:</strong> ${description}</div>`;
}

/**
 * Render one saving throw as a clickable button carrying enough data
 * (item UUID + index) for rollSavingThrowFromChat to resolve it later,
 * whenever anyone clicks it.
 * @param {object} save    An entry from SKSKSpell#savingThrows.
 * @param {number} index   Its index into savingThrows.
 * @param {Item} item      The spell item (owned by the caster).
 * @return {string}
 */
function renderSavingThrowButton(save, index, item) {
  const dc = computeSavingThrowValue(save, item.actor);
  const label = save.label || game.i18n.format('SKSK.Spell.SavingThrow.Numbered', { number: index + 1 });
  return `<button type="button" class="sksk-roll-save" data-action="rollSavingThrow"
    data-item-uuid="${item.uuid}" data-save-index="${index}">
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
 * effect the instant it's cast.
 * @param {Item} item   The spell item.
 * @return {Promise<string[]>}
 */
async function renderSpellEffectParts(item) {
  const actor = item.actor;
  const system = item.system;
  const parts = [];

  if (system.attackRoll.enabled) {
    const attackDamages = system.damages.filter(d => d.trigger === 'attack');
    const damageDice = attackDamages.map(damage => ({ damageType: damage.damageType, dieSizes: getDamageDieSizes(damage.formula) }));
    const attackBonus = actor ? computeSpellAttackBonus(system, actor) : 0;
    for (let i = 1; i <= system.attackRoll.count; i++) {
      const rolls = await rollAttackPair(attackBonus, actor);
      const brutalApplied = rolls.some(roll => getAttackCriticalType(roll, actor) === 'success');
      const rendered = await renderAttackPairHTML(rolls, 'magicResistance', actor, { damageDice, brutalApplied });
      parts.push(`<div class="sksk-roll-attack"><strong>${game.i18n.format('SKSK.Spell.Roll.Attack', { number: i })}</strong></div>${rendered}`);

      const damageEntries = [];
      for (const damage of attackDamages) {
        const { html, entry } = await renderDamageRoll(damage, actor);
        parts.push(html);
        damageEntries.push(entry);
      }

      if (brutalApplied) {
        const bonusResults = await rollCriticalBonusDamage(actor, damageDice);
        let bonusTotal = 0;
        for (const { damageType, roll } of bonusResults) {
          const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damageType] ?? damageType);
          parts.push(`<div class="sksk-roll-line"><strong>${typeLabel} ${game.i18n.localize('SKSK.AttackRoll.CriticalBonusDamage')}</strong></div>${await roll.render()}`);
          damageEntries.push({ damageType, amount: roll.total });
          bonusTotal += roll.total;
        }
        if (bonusTotal) {
          parts.push(formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'brutality', 'criticalBonusDamagePoint', bonusTotal)));
        }
      }
      parts.push(renderApplyDamageButton(actor, damageEntries, null));

      if (system.savingThrows.length) {
        const buttons = system.savingThrows.map((save, index) => renderSavingThrowButton(save, index, item)).join('');
        parts.push(`<div class="sksk-roll-saves">${buttons}</div>`);
      }
    }
  } else if (system.savingThrows.length) {
    const buttons = system.savingThrows.map((save, index) => renderSavingThrowButton(save, index, item)).join('');
    parts.push(`<div class="sksk-roll-saves">${buttons}</div>`);

    const saveDamageEntries = [];
    for (const damage of system.damages.filter(d => d.trigger === 'save')) {
      const { html, entry } = await renderDamageRoll(damage, actor);
      parts.push(html);
      saveDamageEntries.push(entry);
    }
    parts.push(renderApplyDamageButton(actor, saveDamageEntries, null));
    for (const effect of system.statusEffects.filter(e => e.trigger === 'save')) {
      parts.push(renderStatusEffect(effect));
    }
  }

  const unconditionalDamageEntries = [];
  for (const damage of system.damages.filter(d => d.trigger === 'unconditional')) {
    const { html, entry } = await renderDamageRoll(damage, actor);
    parts.push(html);
    unconditionalDamageEntries.push(entry);
  }
  parts.push(renderApplyDamageButton(actor, unconditionalDamageEntries, null));
  for (const effect of system.statusEffects.filter(e => e.trigger === 'unconditional')) {
    parts.push(renderStatusEffect(effect));
  }

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
 * @return {Promise<ChatMessage|void>}
 */
export async function rollSpellItem(item) {
  const actor = item.actor;
  const system = item.system;

  // Prone/Restrained block any spell whose casting method is Movement -
  // see helpers/statusEffects.mjs#canCastMovementSpell.
  if (actor && system.castingMethods?.movement && !canCastMovementSpell(actor)) {
    ui.notifications.warn(game.i18n.localize('SKSK.StatusEffect.MovementSpellBlocked'));
    return;
  }

  if (actor && (actor.system.pendingSpell?.apCost ?? 0) > 0) {
    ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.AlreadyConcentrating'));
    return;
  }

  const parts = [];

  const descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    system.description ?? '', { relativeTo: item, secrets: item.isOwner }
  );
  parts.push(`<div class="sksk-roll-description">${descriptionHTML}</div>`);

  let deferred = false;

  if (actor) {
    const { cost: manaCost, increased } = computeSpellManaCost(system, actor);
    const costClass = increased ? 'sksk-roll-mana-cost-increased' : '';
    parts.push(`<div class="sksk-roll-mana-cost"><strong>${game.i18n.localize('SKSK.Spell.ManaCost')}:</strong> <span class="${costClass}">${manaCost}</span></div>`);

    // Manakapazität's own FP accumulator (see helpers/rest.mjs#applyRest,
    // which turns this into FP on the next Anpassungs-/Genesungspause) -
    // the real mana cost above (after mali/boni), regardless of whether it
    // actually got paid from Mana or overflowed into Life/Negative Life.
    if (manaCost > 0) {
      await actor.update({ 'system.manaCapacityAccumulator': (actor.system.manaCapacityAccumulator ?? 0) + manaCost });
    }

    const apCost = computeSpellApCost(system, actor);
    parts.push(`<div class="sksk-roll-ap-cost"><strong>${game.i18n.localize('SKSK.Spell.APCost')}:</strong> ${apCost}</div>`);

    const { lifeDelta, negativeLifeDelta } = await payManaCost(actor, manaCost);
    if (lifeDelta || negativeLifeDelta) {
      const fromLife = -lifeDelta + negativeLifeDelta;
      parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ManaShortfallFromLife', { amount: fromLife })}</div>`);
      parts.push(negativeLifeOverflowHTML(negativeLifeDelta));
    }

    const ap = actor.system.actionPoints.value;
    const paidNow = Math.min(ap, apCost);
    const remaining = apCost - paidNow;
    if (paidNow) {
      await actor.update({ 'system.actionPoints.value': ap - paidNow });
      parts.push(formatSkillFpGrantLine(await checkReflexActionTrigger(actor)));
    }

    if (remaining > 0) {
      await actor.update({ 'system.pendingSpell': { itemId: item.id, apCost: remaining } });
      await setStatusStacks(actor, 'concentration', 1);
      parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ApOwed', { paid: paidNow, remaining })}</div>`);
      deferred = true;
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
  }

  if (!deferred) {
    parts.push(...(await renderSpellEffectParts(item)));
  }

  return postSpellChatCard(item, parts);
}

/**
 * Pay down a pending spell's still-owed AP cost (see rollSpellItem) at the
 * start of this actor's Combat turn - pays as much as current AP allows,
 * repeating on however many further turns it takes to reach 0. Once fully
 * paid, the spell finally takes effect (its deferred parts - see
 * renderSpellEffectParts - are posted now, in their own chat message) and
 * Concentration is turned off. A no-op outside of Concentration (a failed
 * Concentration check already reset apCost to 0 itself - see
 * helpers/statusEffects.mjs#checkConcentration - which is what actually
 * cancels the spell).
 * @param {Actor} actor
 * @return {Promise<void>}
 */
export async function handlePendingSpellTurnStart(actor) {
  const pending = actor.system.pendingSpell;
  if (!pending?.apCost || getStatusStacks(actor, 'concentration') <= 0) return;

  const item = actor.items.get(pending.itemId);
  const label = item?.name ?? game.i18n.localize('SKSK.StatusEffect.Concentration.Name');

  const ap = actor.system.actionPoints.value;
  const paid = Math.min(ap, pending.apCost);
  const remaining = pending.apCost - paid;
  await actor.update({
    'system.actionPoints.value': ap - paid,
    'system.pendingSpell.apCost': remaining,
  });
  const reflexGrant = paid > 0 ? await checkReflexActionTrigger(actor) : null;

  if (remaining > 0) {
    const parts = [
      `<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ApPaidTowardSpell', { paid, remaining })}</div>`,
      formatSkillFpGrantLine(reflexGrant),
    ];
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: label,
      content: `<div class="sksk-chat-card sksk-action-card">${parts.join('')}</div>`,
    };
    ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
    await ChatMessage.create(messageData);
    return;
  }

  await actor.update({ 'system.pendingSpell.itemId': '' });
  await setStatusStacks(actor, 'concentration', 0);
  if (!item) return;

  const parts = await renderSpellEffectParts(item);
  parts.push(formatSkillFpGrantLine(reflexGrant));
  await postSpellChatCard(item, parts);
}

/**
 * Handle a click on a saving-throw button in chat: roll 1d20 plus the
 * clicking user's best applicable attribute modifier or skill level (the
 * target "may use whichever they have"), and post the result against the
 * saving throw's DC.
 * @param {string} itemUuid
 * @param {number} saveIndex
 * @return {Promise<ChatMessage|void>}
 */
export async function rollSavingThrowFromChat(itemUuid, saveIndex) {
  const item = await fromUuid(itemUuid);
  if (!item) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const save = item.system.savingThrows?.[saveIndex];
  if (!save) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const actor = game.user.character;
  if (!actor) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.NoCharacter'));

  let best = null;
  for (const [attributeKey, enabled] of Object.entries(save.testAttributes ?? {})) {
    if (!enabled) continue;
    const mod = actor.system.attributes?.[attributeKey]?.mod ?? 0;
    if (!best || mod > best.value) {
      best = { label: game.i18n.localize(CONFIG.SKSK.attributeAbbreviations[attributeKey]).toUpperCase(), value: mod, attributeKey };
    }
  }
  for (const skillKey of save.testSkills ?? []) {
    const level = getActorSkillLevel(actor, skillKey);
    if (!best || level > best.value) {
      best = { label: game.i18n.localize(getSkillLabel(skillKey)), value: level, attributeKey: null };
    }
  }
  best ??= { label: '', value: 0, attributeKey: null };

  const dc = computeSavingThrowValue(save, item.actor);
  const formula = applyD20Malus(`1d20 + ${best.value}`, actor, best.attributeKey);
  const roll = await new Roll(formula, actor.getRollData()).evaluate();
  const criticalType = getGenericCriticalType(roll);
  const success = resolveCheckSuccess(roll.total, dc, criticalType);
  const saveLabel = save.label || game.i18n.format('SKSK.Spell.SavingThrow.Numbered', { number: saveIndex + 1 });
  const outcomeKey = criticalType === 'success' ? 'SKSK.Spell.Roll.CriticalSuccess'
    : criticalType === 'failure' ? 'SKSK.Spell.Roll.CriticalFailure'
    : success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure';
  const outcome = wrapCriticalInline(game.i18n.localize(outcomeKey), criticalType);

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${saveLabel} (${best.label}) ${game.i18n.localize('SKSK.Spell.Roll.Vs')} DC ${dc}: ${outcome}`,
    content: `<div class="sksk-chat-card sksk-action-card">${wrapCriticalBlock(await roll.render(), criticalType)}</div>`,
    rolls: [roll],
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
