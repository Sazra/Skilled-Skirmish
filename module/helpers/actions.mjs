import { getActorSkillLevel } from "./skills.mjs";
import { getClassAbilityLevels, actorHasAdvancedClass } from "./abilities.mjs";
import { computeMovementSpeeds } from "./movement.mjs";
import { canUseWeaponAttack, canMove, applyAdrenalinDamage } from "./statusEffects.mjs";

/**
 * Post a simple chat card (an optional Roll, an AP-cost line, and a
 * flavor/title) on the given actor's behalf.
 * @param {Actor} actor
 * @param {string} title
 * @param {Roll|null} roll
 * @param {number} apCost
 * @param {string} [extraHTML]
 * @return {Promise<ChatMessage>}
 */
export async function postActionChatCard(actor, title, roll, apCost, extraHTML = '') {
  const parts = [];
  if (roll) parts.push(await roll.render());
  if (apCost) {
    parts.push(`<div class="sksk-roll-ap-cost"><strong>${game.i18n.localize('SKSK.Spell.APCost')}:</strong> ${apCost}</div>`);
  }
  if (extraHTML) parts.push(extraHTML);

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: title,
    content: `<div class="sksk-chat-card sksk-action-card">${parts.join('')}</div>`,
    rolls: roll ? [roll] : [],
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * Whether an actor currently has at least apCost Action Points - warns and
 * returns false otherwise, aborting the calling action before anything is
 * rolled or deducted.
 * @param {Actor} actor
 * @param {number} apCost
 * @return {boolean}
 */
function hasEnoughActionPoints(actor, apCost) {
  if ((actor.system.actionPoints?.value ?? 0) >= apCost) return true;
  ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughAP'));
  return false;
}

/**
 * Deduct a flat AP cost from an actor - a plain object patch, not yet
 * applied; merge into whatever else the calling action also updates so
 * both land in a single actor.update() call.
 * @param {Actor} actor
 * @param {number} apCost
 * @return {object}
 */
function spendActionPoints(actor, apCost) {
  if (!apCost) return {};
  return { 'system.actionPoints.value': Math.max(0, (actor.system.actionPoints?.value ?? 0) - apCost) };
}

/**
 * How a Martial Arts Attack's selected attribute switches combine into a
 * single modifier (CONFIG.SKSK.attributeUsageTypes) - mirrors the
 * Refined/Specialized/Masterful Model properties' wording, generalized to
 * any number of selected attributes:
 * - "highestSingle": only the single highest modifier counts once, even
 *   if others tie with it.
 * - "all": every selected attribute's modifier is summed.
 * - "highestMultiple": the highest modifier counts once per attribute
 *   that reaches it (so two attributes tied for highest both count).
 * @param {Actor} actor
 * @param {Object<string, boolean>} attributes   E.g. {str: true, dex: false}.
 * @param {string} attributeUsage
 * @return {number}
 */
function resolveMartialArtsAttributeBonus(actor, attributes, attributeUsage) {
  const selectedKeys = Object.entries(attributes ?? {}).filter(([, checked]) => checked).map(([key]) => key);
  const mods = selectedKeys.map(key => actor.system.attributes?.[key]?.mod ?? 0);
  if (!mods.length) return 0;
  if (attributeUsage === 'all') return mods.reduce((sum, mod) => sum + mod, 0);
  const highest = Math.max(...mods);
  if (attributeUsage === 'highestMultiple') return highest * mods.filter(mod => mod === highest).length;
  return highest;
}

/**
 * Roll one of the actor's GM-defined Martial Arts Attacks (see
 * data/actor-base.mjs#martialArtsAttacks): its own dice formula plus the
 * attribute bonus resolved per its attributeUsage, deducting its own AP
 * cost.
 * @param {Actor} actor
 * @param {number} index   Index into actor.system.martialArtsAttacks.
 * @return {Promise<ChatMessage|void>}
 */
export async function rollMartialArtsAttack(actor, index) {
  const attack = actor.system.martialArtsAttacks?.[index];
  if (!attack) return;
  if (!canUseWeaponAttack(actor)) {
    return ui.notifications.warn(game.i18n.localize('SKSK.StatusEffect.AttackBlocked'));
  }
  if (!hasEnoughActionPoints(actor, attack.apCost)) return;

  const bonus = resolveMartialArtsAttributeBonus(actor, attack.attributes, attack.attributeUsage);
  const formula = bonus ? `${attack.formula} + ${bonus}` : attack.formula;
  const roll = await new Roll(formula, actor.getRollData()).evaluate();

  await actor.update(spendActionPoints(actor, attack.apCost));
  return postActionChatCard(actor, attack.name || game.i18n.localize('SKSK.Action.MartialArtsAttack'), roll, attack.apCost);
}

/**
 * The die size(s) contributed by an actor's Class item(s) to a
 * Regeneration roll - its first Class's own life value, plus its second
 * Class's (once unlocked at the actor's level - same threshold as its
 * abilities/life value in helpers/life.mjs).
 * @param {Actor} actor
 * @return {number[]}
 */
export function getRegenerationDieSizes(actor) {
  const level = actor.system.resources?.level?.value ?? 1;
  const hasAdvancedClass = actorHasAdvancedClass(actor);
  const sizes = [];
  for (const item of actor.items) {
    if (item.type !== 'class' || !item.system.life) continue;
    if (item.system.classType === 'first') {
      sizes.push(item.system.life);
    } else if (item.system.classType === 'second') {
      const [threshold] = getClassAbilityLevels('second', hasAdvancedClass);
      if (level >= threshold) sizes.push(item.system.life);
    }
  }
  return sizes;
}

/**
 * Roll a Regeneration die to restore Life: 1d[first Class's life value] +
 * 1d[second Class's life value, once unlocked] + Constitution modifier +
 * Health skill level - restoring the result (clamped to max Life), and
 * deducting system.regenerationApCost (which may be 0).
 * @param {Actor} actor
 * @return {Promise<ChatMessage|void>}
 */
export async function rollRegeneration(actor) {
  const apCost = actor.system.regenerationApCost ?? 0;
  if (!hasEnoughActionPoints(actor, apCost)) return;

  const dice = getRegenerationDieSizes(actor).map(size => `1d${size}`);
  const conMod = actor.system.attributes?.con?.mod ?? 0;
  const healthLevel = getActorSkillLevel(actor, 'health');
  const formula = [...dice, conMod, healthLevel].join(' + ');
  const roll = await new Roll(formula, actor.getRollData()).evaluate();

  const life = actor.system.life;
  const newValue = Math.min(life.max, life.value + roll.total);
  await actor.update({ ...spendActionPoints(actor, apCost), 'system.life.value': newValue });
  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Regeneration'), roll, apCost);
}

/**
 * Roll a Meditation die to restore Mana: 1d[Aura value] + Mana
 * Regeneration skill level + Source Bound skill level - restoring the
 * result (clamped to max Mana), and deducting system.meditationApCost
 * (which may be 0).
 * @param {Actor} actor
 * @return {Promise<ChatMessage|void>}
 */
export async function rollMeditation(actor) {
  const apCost = actor.system.meditationApCost ?? 0;
  if (!hasEnoughActionPoints(actor, apCost)) return;

  const aura = actor.system.attributes?.aur?.value ?? 0;
  const skillBonus = getActorSkillLevel(actor, 'manaRegeneration') + getActorSkillLevel(actor, 'sourceBound');
  const formula = aura > 0 ? `1d${aura} + ${skillBonus}` : String(skillBonus);
  const roll = await new Roll(formula, actor.getRollData()).evaluate();

  const mana = actor.system.mana;
  const newValue = Math.min(mana.max, mana.value + roll.total);
  await actor.update({ ...spendActionPoints(actor, apCost), 'system.mana.value': newValue });
  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Meditation'), roll, apCost);
}

/**
 * Use Adrenalin: costs no AP, but reduces the Adrenalin general resource
 * (system.adrenalinCharges) by 1 and restores 1 AP. Each use rolls
 * (this lifetime use count - 1)d4 damage, merged into its own dedicated
 * Adrenalin Damage status effect (see helpers/statusEffects.mjs#
 * applyAdrenalinDamage) rather than the general Schaden am maximalen
 * Leben status - kept separate so any qualifying Pause can reliably heal
 * exactly the damage Adrenalin itself caused (see helpers/rest.mjs#
 * applyRest). The first use accordingly costs no max Life yet (0d4).
 * @param {Actor} actor
 * @return {Promise<ChatMessage|void>}
 */
export async function rollAdrenalin(actor) {
  const charges = actor.system.adrenalinCharges?.value ?? 0;
  if (charges <= 0) {
    return ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughAdrenalin'));
  }

  const usedCount = (actor.system.adrenalinUsedCount ?? 0) + 1;
  const diceCount = usedCount - 1;
  const roll = await new Roll(diceCount > 0 ? `${diceCount}d4` : '0', actor.getRollData()).evaluate();

  const ap = actor.system.actionPoints;
  await actor.update({
    'system.adrenalinCharges.value': charges - 1,
    'system.adrenalinUsedCount': usedCount,
    'system.actionPoints.value': Math.min(ap.max, ap.value + 1),
  });

  if (roll.total > 0) await applyAdrenalinDamage(actor, roll.total);

  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Adrenalin'), roll, 0);
}

/**
 * Move the actor by one of its movement speeds - free on the first use of
 * a given Combat round, 1 AP for every further use that round. Outside of
 * (or before) any active Combat, there's no "round" to track, so it's
 * always free.
 * @param {Actor} actor
 * @param {string} movementType   A CONFIG.SKSK.movementTypes key.
 * @return {Promise<ChatMessage|void>}
 */
export async function useMove(actor, movementType) {
  if (!canMove(actor)) {
    return ui.notifications.warn(game.i18n.localize('SKSK.StatusEffect.MoveBlocked'));
  }

  const round = game.combat?.round ?? null;
  const isFree = round === null || actor.system.lastFreeMoveRound !== round;
  const apCost = isFree ? 0 : 1;
  if (!hasEnoughActionPoints(actor, apCost)) return;

  const speed = computeMovementSpeeds(actor)[movementType] ?? 0;
  const updates = spendActionPoints(actor, apCost);
  if (isFree && round !== null) updates['system.lastFreeMoveRound'] = round;
  if (Object.keys(updates).length) await actor.update(updates);

  const label = game.i18n.localize(CONFIG.SKSK.movementTypes[movementType] ?? movementType);
  const extraHTML = `<div class="sksk-roll-line">${game.i18n.format('SKSK.Action.MoveDistance', { label, speed })}</div>`;
  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Move'), null, apCost, extraHTML);
}

/**
 * "Use" an equipped Weapon or a usable Item from the Actions tab: rolls it
 * (SKSKItem#roll's own behavior - a formula roll for a generic Item that
 * has one set, its description otherwise; Weapons have neither, so this
 * just posts their description if any), deducting its own configured AP
 * cost (system.useApCost). A used Item additionally consumes itself - one
 * charge if it has charges enabled (which may itself deplete the item's
 * quantity, via the updateItem hook in sksk.mjs - see data/item.mjs#
 * charges), or one unit of quantity directly if it's Consumable without
 * charges enabled.
 * @param {Actor} actor
 * @param {Item} item   A Weapon or Item, owned by actor.
 * @return {Promise<void>}
 */
export async function useItem(actor, item) {
  if (item.type === 'weapon' && !canUseWeaponAttack(actor)) {
    return ui.notifications.warn(game.i18n.localize('SKSK.StatusEffect.AttackBlocked'));
  }

  const apCost = item.system.useApCost ?? 0;
  if (!hasEnoughActionPoints(actor, apCost)) return;

  await item.roll();
  await actor.update(spendActionPoints(actor, apCost));

  if (item.type === 'item') {
    if (item.system.charges?.enabled) {
      await item.update({ 'system.charges.value': Math.max(0, item.system.charges.value - 1) });
    } else if (item.system.consumable) {
      await item.update({ 'system.quantity': Math.max(0, item.system.quantity - 1) });
    }
  }
}

/**
 * Use Dodge: grants disadvantage on (1 + Reflexes skill level) attacks
 * against the actor until its next turn - a chat announcement only (no
 * automated attack-roll system exists yet to enforce it against). Costs a
 * flat 1 AP.
 * @param {Actor} actor
 * @return {Promise<ChatMessage|void>}
 */
export async function useDodge(actor) {
  const apCost = 1;
  if (!hasEnoughActionPoints(actor, apCost)) return;

  const count = 1 + getActorSkillLevel(actor, 'reflexes');
  await actor.update(spendActionPoints(actor, apCost));

  const extraHTML = `<div class="sksk-roll-line">${game.i18n.format('SKSK.Action.DodgeCount', { count })}</div>`;
  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Dodge'), null, apCost, extraHTML);
}
