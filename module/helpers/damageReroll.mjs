/**
 * Three related damage-reroll mechanics (Tödliche Angriffe/Tödliche Magie/
 * Elementexperte, from the design spreadsheet's Talente tab), each
 * grantable from any of: a Talent's own single ability (data/talent.mjs#
 * damageRerollMode/damageRerollElement), a Class/Species ability array
 * entry (data/class.mjs, data/species.mjs - identical pair, per entry),
 * or directly via Active Effect (data/actor-base.mjs#
 * damageRerollTwiceWeapon/damageRerollTwiceSpell/damageRerollOnesElements)
 * - see hasRollTwiceWeapon/hasRollTwiceSpell/getRerollOnesElements below,
 * which union all three sources together.
 *
 * - "Roll twice, take the better total" (Tödliche Angriffe for weapon/
 *   Martial Arts damage, Tödliche Magie for spell damage) is fully
 *   automatic on every successful attack - no player choice, no icon -
 *   see rollPossiblyDoubledDamage, wired into helpers/actions.mjs#
 *   rollWeaponItem/rollMartialArtsAttack, helpers/spell-rolls.mjs's own
 *   attack-triggered damage loop, and helpers/attackRolls.mjs#
 *   rollCriticalBonusDamage's own critical bonus dice (the ability's own
 *   text explicitly doubles those too).
 * - "May reroll any natural 1" (Elementexperte, once per damage roll) IS
 *   player-optional - a small icon next to that one damage roll (see
 *   renderDamageRerollOnesIcon/handleDamageRerollOnesFromChat), free (no
 *   Luck charge, no AP/RP), gone from the card again once used (unlike
 *   helpers/luck.mjs's own D20 Reroll, which re-offers itself after every
 *   use) - a re-click after a natural 1 count of 0 just warns instead of
 *   doing nothing silently.
 */

/**
 * Every damageRerollMode-carrying array a Class/Species item exposes -
 * both share the exact same shape (see data/class.mjs's own doc comment).
 * @param {Item} item
 * @return {Array<{damageRerollMode: string, damageRerollElement: string}>}
 */
function abilityEntriesOf(item) {
  return item.system.abilities ?? [];
}

/**
 * Whether any of actor's owned Talent/Class/Species items (or its own
 * direct Active Effect switch) grants the given damageRerollMode -
 * "rollTwiceWeapon"/"rollTwiceSpell" only ever need this boolean; see
 * getRerollOnesElements below for "rerollOnes", which also needs each
 * source's own chosen element.
 * @param {Actor|null} actor
 * @param {"rollTwiceWeapon"|"rollTwiceSpell"} mode
 * @return {boolean}
 */
function actorGrantsDamageRerollMode(actor, mode) {
  if (!actor) return false;
  for (const item of actor.items) {
    if (item.type === 'talent' && item.system.damageRerollMode === mode) return true;
    if (item.type === 'class' || item.type === 'species') {
      if (abilityEntriesOf(item).some(a => a.damageRerollMode === mode)) return true;
    }
  }
  return false;
}

/**
 * Tödliche Angriffe - see this file's own doc comment.
 * @param {Actor|null} actor
 * @return {boolean}
 */
export function hasRollTwiceWeapon(actor) {
  return !!actor?.system.damageRerollTwiceWeapon || actorGrantsDamageRerollMode(actor, 'rollTwiceWeapon');
}

/**
 * Tödliche Magie - see this file's own doc comment.
 * @param {Actor|null} actor
 * @return {boolean}
 */
export function hasRollTwiceSpell(actor) {
  return !!actor?.system.damageRerollTwiceSpell || actorGrantsDamageRerollMode(actor, 'rollTwiceSpell');
}

/**
 * Elementexperte - every CONFIG.SKSK.damageTypes key actor may reroll
 * natural 1s for, unioned across every source (see this file's own doc
 * comment) - a Character can plausibly hold more than one source for
 * different elements at once (Elementexperte's own ability text allows
 * taking it multiple times, once per element).
 * @param {Actor|null} actor
 * @return {Set<string>}
 */
export function getRerollOnesElements(actor) {
  const elements = new Set();
  if (!actor) return elements;
  for (const [key, enabled] of Object.entries(actor.system.damageRerollOnesElements ?? {})) {
    if (enabled) elements.add(key);
  }
  for (const item of actor.items) {
    if (item.type === 'talent' && item.system.damageRerollMode === 'rerollOnes' && item.system.damageRerollElement) {
      elements.add(item.system.damageRerollElement);
    }
    if (item.type === 'class' || item.type === 'species') {
      for (const ability of abilityEntriesOf(item)) {
        if (ability.damageRerollMode === 'rerollOnes' && ability.damageRerollElement) elements.add(ability.damageRerollElement);
      }
    }
  }
  return elements;
}

/**
 * Roll a damage formula once, or - if shouldDouble - twice, keeping
 * whichever total is higher (Tödliche Angriffe/Tödliche Magie). Renders
 * both rolls side by side (mirroring helpers/attackRolls.mjs#
 * renderAttackPairHTML's own Vorteil-style pair display) with the kept
 * one highlighted, rather than silently only showing one, so the player
 * can see the talent actually did something.
 * @param {string} formula
 * @param {object} rollData
 * @param {boolean} shouldDouble
 * @return {Promise<{total: number, html: string, rolls: Roll[], pickedRoll: Roll}>}
 *   pickedRoll is whichever of the (one or two) rolls actually counts -
 *   for renderDamageRerollOnesIcon's own natural-1 count, so Elementexperte
 *   correctly counts 1s on the roll that's actually being used.
 */
export async function rollPossiblyDoubledDamage(formula, rollData, shouldDouble) {
  const rollA = await new Roll(formula, rollData).evaluate();
  if (!shouldDouble) return { total: rollA.total, html: await rollA.render(), rolls: [rollA], pickedRoll: rollA };

  const rollB = await new Roll(formula, rollData).evaluate();
  const pickedB = rollB.total > rollA.total;
  const renderedA = await rollA.render();
  const renderedB = await rollB.render();
  const html = `
    <div class="sksk-roll-line">${game.i18n.localize('SKSK.DamageReroll.RollTwiceNote')}</div>
    <div class="sksk-attack-roll-pair">
      <div class="sksk-attack-roll-single ${pickedB ? '' : 'sksk-reroll-picked'}">${renderedA}</div>
      <div class="sksk-attack-roll-single ${pickedB ? 'sksk-reroll-picked' : ''}">${renderedB}</div>
    </div>`;
  return { total: pickedB ? rollB.total : rollA.total, html, rolls: [rollA, rollB], pickedRoll: pickedB ? rollB : rollA };
}

/**
 * How many natural 1s a just-evaluated Roll's own dice show, grouped by
 * die size - captured once at roll time and baked into the reroll-ones
 * icon's own payload (rather than re-inspecting the Roll object later),
 * since the actual rerolling only ever needs "how many dice of which
 * size", never the original Roll instance itself.
 * @param {Roll} roll
 * @return {Object<string, number>}   Keyed by face count, as a string
 *   (JSON round-trips numeric keys as strings anyway).
 */
function countNaturalOnesBySize(roll) {
  const counts = {};
  for (const die of roll.dice) {
    for (const result of die.results) {
      if (result.active && result.result === 1) counts[die.faces] = (counts[die.faces] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Elementexperte's own small Reroll icon, rendered next to one specific
 * damage roll's own line (see helpers/actions.mjs#rollWeaponItem/
 * rollMartialArtsAttack, helpers/spell-rolls.mjs's own attack-triggered
 * damage loop) - '' unless damageType is one of actor's own
 * getRerollOnesElements. Free of charge; a re-check at click time (see
 * handleDamageRerollOnesFromChat) covers the switch having been turned
 * off since this was rendered.
 * @param {Actor|null} actor
 * @param {string} damageType
 * @param {Roll} roll   The already-evaluated RAW damage roll (before any
 *   post-processing) this icon belongs to - natural 1s are counted off
 *   this roll directly, never off whatever the caller derives from it.
 * @param {string} blockId
 * @param {{type: "delta"|"multiplier", value: number}} [postAdjust]   How
 *   this damage's own final damageEntries amount was derived from roll.total
 *   - "delta" (the default, value 0) for a flat additive difference (e.g.
 *   a consumed Technique's own bonus, see helpers/technique-rolls.mjs#
 *   applyTechniqueBonusDamage); "multiplier" for Überladen's own
 *   floor(total * (1 + 0.5*count)) scaling (helpers/spell-rolls.mjs).
 *   Re-applied to the rerolled total the exact same way, so a multiplicative
 *   bonus doesn't get quietly flattened into an additive one on reroll.
 * @return {string}
 */
export function renderDamageRerollOnesIcon(actor, damageType, roll, blockId, postAdjust = { type: 'delta', value: 0 }) {
  if (!actor || actor.type !== 'character' || !getRerollOnesElements(actor).has(damageType)) return '';
  const payload = { damageType, rawRollTotal: roll.total, onesBySize: countNaturalOnesBySize(roll), blockId, postAdjust };
  const data = encodeURIComponent(JSON.stringify(payload));
  return `<a class="sksk-reroll-damage-ones" data-action="rerollDamageOnes" data-actor-uuid="${actor.uuid}"
    data-payload="${data}" title="${game.i18n.localize('SKSK.DamageReroll.RerollOnesTooltip')}">
    <i class="fas fa-arrows-rotate"></i>
  </a>`;
}

/**
 * Wraps a single damage roll's own line (label + optional reroll icon +
 * rendered dice) in a uniquely id'd block, the same "find and replace
 * just this region in place" scheme helpers/luck.mjs#redoAttackPairRoll
 * already uses for an Angriffswurf's own pair - see
 * handleDamageRerollOnesFromChat for why an id (rather than "the first
 * one in the message") is needed: a multi-damage-type spell attack (or a
 * multi-attack one) renders more than one of these into a single message.
 * @param {string} blockId
 * @param {string} innerHTML
 * @return {string}
 */
export function wrapDamageBlock(blockId, innerHTML) {
  return `<div class="sksk-damage-block" data-block-id="${blockId}">${innerHTML}</div>`
    + `<span class="sksk-damage-block-end" data-block-id="${blockId}"></span>`;
}

/**
 * Delegated click handler for Elementexperte's own Reroll-Ones icon (see
 * sksk.mjs) - permission/eligibility-checked fresh (never spends anything
 * - just a free, once-per-roll switch), rerolls exactly as many fresh dice
 * (of the same sizes) as the original roll showed natural 1s, and:
 * 1. Appends a small note + the fresh dice's own render into this damage
 *    roll's own block, in place (no icon on the rebuilt block - one use
 *    per roll, unlike helpers/luck.mjs's own D20 Reroll).
 * 2. Updates the nearest Apply Damage button FOLLOWING that block in the
 *    same message (built strictly in that order by every caller, so this
 *    is always the right one - see helpers/damageApplication.mjs#
 *    renderApplyDamageButton) - only that one matching-damageType entry's
 *    own amount changes, every other damage type in the same button is
 *    left untouched.
 * @param {HTMLElement} button
 * @return {Promise<void>}
 */
export async function handleDamageRerollOnesFromChat(button) {
  const actor = button.dataset.actorUuid ? await fromUuid(button.dataset.actorUuid) : null;
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize('SKSK.DamageReroll.NotOwner'));

  const payload = JSON.parse(decodeURIComponent(button.dataset.payload || '{}'));
  const { damageType, rawRollTotal, onesBySize, blockId, postAdjust } = payload;
  if (!getRerollOnesElements(actor).has(damageType)) {
    return ui.notifications.warn(game.i18n.localize('SKSK.DamageReroll.NotEnabled'));
  }
  const totalOnes = Object.values(onesBySize ?? {}).reduce((sum, n) => sum + n, 0);
  if (!totalOnes) return ui.notifications.warn(game.i18n.localize('SKSK.DamageReroll.NoOnes'));

  const rerollFormula = Object.entries(onesBySize).map(([size, count]) => `${count}d${size}`).join(' + ');
  const rerollRoll = await new Roll(rerollFormula, actor.getRollData()).evaluate();
  const newRawTotal = rawRollTotal - totalOnes + rerollRoll.total;
  const newEntryAmount = postAdjust?.type === 'multiplier'
    ? Math.floor(newRawTotal * postAdjust.value)
    : newRawTotal + (postAdjust?.value ?? 0);

  const message = button.closest('[data-message-id]');
  const messageId = message?.dataset.messageId ?? null;
  const messageDoc = messageId ? game.messages.get(messageId) : null;
  if (!messageDoc) return;

  const blockStart = messageDoc.content.indexOf(`<div class="sksk-damage-block" data-block-id="${blockId}">`);
  const endMarker = `<span class="sksk-damage-block-end" data-block-id="${blockId}"></span>`;
  const markerIndex = messageDoc.content.indexOf(endMarker);
  if (blockStart === -1 || markerIndex === -1) return;

  // Strip this block's own icon (one use per roll) and append the reroll
  // note/render right before the block's own closing tag.
  const originalBlock = messageDoc.content.slice(blockStart, markerIndex);
  const strippedBlock = originalBlock.replace(/<a class="sksk-reroll-damage-ones"[\s\S]*?<\/a>/, '');
  const noteHTML = `<div class="sksk-roll-line sksk-reroll-note">`
    + game.i18n.format('SKSK.DamageReroll.RerolledOnesNote', { count: totalOnes, amount: newEntryAmount })
    + `</div>${await rerollRoll.render()}`;
  const newBlock = strippedBlock.replace(/<\/div>$/, `${noteHTML}</div>`);

  // The Apply Damage button immediately following this block, in the
  // untouched remainder of the message - update just this one damageType
  // entry's own amount, leaving every other entry (and the button's other
  // attributes) exactly as they were.
  const remainder = messageDoc.content.slice(markerIndex + endMarker.length);
  const buttonMatch = remainder.match(/data-damage-entries="([^"]*)"/);
  let newRemainder = remainder;
  if (buttonMatch) {
    const entries = JSON.parse(decodeURIComponent(buttonMatch[1]));
    const entry = entries.find(e => e.damageType === damageType);
    if (entry) entry.amount = newEntryAmount;
    const newEncoded = encodeURIComponent(JSON.stringify(entries));
    newRemainder = remainder.replace(buttonMatch[0], `data-damage-entries="${newEncoded}"`);
  }

  const newContent = messageDoc.content.slice(0, blockStart) + newBlock + newRemainder;
  await messageDoc.update({ content: newContent });
}
