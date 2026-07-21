import { computeDamageBonus, computeSavingThrowValue } from './spells.mjs';
import { getActorSkillLevel, getSkillLabel } from './skills.mjs';

/**
 * Roll one damage entry (its formula plus any attribute/skill scaling) and
 * render it as a chat-card line.
 * @param {object} damage   An entry from SKSKSpell#damages.
 * @param {Actor} actor     The caster, for scaling bonuses.
 * @return {Promise<string>}
 */
async function renderDamageRoll(damage, actor) {
  const bonus = computeDamageBonus(damage, actor);
  const formula = bonus ? `${damage.formula} + ${bonus}` : damage.formula;
  const roll = await new Roll(formula).evaluate();
  const typeLabel = game.i18n.localize(CONFIG.SKSK.damageTypes[damage.damageType] ?? damage.damageType);
  const rendered = await roll.render();
  return `<div class="sksk-roll-line"><strong>${typeLabel} ${game.i18n.localize('SKSK.Spell.Roll.Damage')}</strong></div>${rendered}`;
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
 * Cast a spell: post one chat message with its description, any attack
 * rolls (and the damage tied to each), any saving throws to request (and
 * the damage/status effects tied to them), and any unconditional damage/
 * status effects. See SKSKItem#roll for how this is invoked.
 * @param {Item} item   The spell item being cast.
 * @return {Promise<ChatMessage>}
 */
export async function rollSpellItem(item) {
  const actor = item.actor;
  const system = item.system;
  const parts = [];

  const descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    system.description ?? '', { relativeTo: item, secrets: item.isOwner }
  );
  parts.push(`<div class="sksk-roll-description">${descriptionHTML}</div>`);

  if (system.attackRoll.enabled) {
    const attackDamages = system.damages.filter(d => d.trigger === 'attack');
    for (let i = 1; i <= system.attackRoll.count; i++) {
      const attackRoll = await new Roll('1d20').evaluate();
      const rendered = await attackRoll.render();
      parts.push(`<div class="sksk-roll-attack"><strong>${game.i18n.format('SKSK.Spell.Roll.Attack', { number: i })}</strong></div>${rendered}`);

      for (const damage of attackDamages) {
        parts.push(await renderDamageRoll(damage, actor));
      }

      if (system.savingThrows.length) {
        const buttons = system.savingThrows.map((save, index) => renderSavingThrowButton(save, index, item)).join('');
        parts.push(`<div class="sksk-roll-saves">${buttons}</div>`);
      }
    }
  } else if (system.savingThrows.length) {
    const buttons = system.savingThrows.map((save, index) => renderSavingThrowButton(save, index, item)).join('');
    parts.push(`<div class="sksk-roll-saves">${buttons}</div>`);

    for (const damage of system.damages.filter(d => d.trigger === 'save')) {
      parts.push(await renderDamageRoll(damage, actor));
    }
    for (const effect of system.statusEffects.filter(e => e.trigger === 'save')) {
      parts.push(renderStatusEffect(effect));
    }
  }

  for (const damage of system.damages.filter(d => d.trigger === 'unconditional')) {
    parts.push(await renderDamageRoll(damage, actor));
  }
  for (const effect of system.statusEffects.filter(e => e.trigger === 'unconditional')) {
    parts.push(renderStatusEffect(effect));
  }

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: item.name,
    content: `<div class="sksk-chat-card sksk-spell-card">${parts.join('')}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
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
      best = { label: game.i18n.localize(CONFIG.SKSK.attributeAbbreviations[attributeKey]).toUpperCase(), value: mod };
    }
  }
  for (const skillKey of save.testSkills ?? []) {
    const level = getActorSkillLevel(actor, skillKey);
    if (!best || level > best.value) {
      best = { label: game.i18n.localize(getSkillLabel(skillKey)), value: level };
    }
  }
  best ??= { label: '', value: 0 };

  const dc = computeSavingThrowValue(save, item.actor);
  const roll = await new Roll(`1d20 + ${best.value}`).evaluate();
  const success = roll.total >= dc;
  const saveLabel = save.label || game.i18n.format('SKSK.Spell.SavingThrow.Numbered', { number: saveIndex + 1 });
  const outcome = game.i18n.localize(success ? 'SKSK.Spell.Roll.Success' : 'SKSK.Spell.Roll.Failure');

  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${saveLabel} (${best.label}) ${game.i18n.localize('SKSK.Spell.Roll.Vs')} DC ${dc}: ${outcome}`,
  });
}
