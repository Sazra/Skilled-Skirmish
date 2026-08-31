import { getActorSkillLevel } from "./skills.mjs";
import { getClassAbilityLevels, actorHasAdvancedClass } from "./abilities.mjs";
import { computeMovementSpeeds } from "./movement.mjs";
import { canUseWeaponAttack, canMove, applyAdrenalinDamage, isActorsOwnTurn } from "./statusEffects.mjs";
import {
  computeWeaponAttackBonus, computeWeaponAttributeBonus, computeMartialArtsAttackBonus, rollAttackPair, renderAttackPairHTML,
  getDamageDieSizes, getWeaponDamageType,
} from "./attackRolls.mjs";
import { wrapCriticalBlock } from "./criticalRolls.mjs";
import { formatRollCardHeading } from "./rollCard.mjs";
import { grantSkillUsageFp, formatSkillFpGrantLine, checkReflexActionTrigger, grantFlatSkillFp } from "./skillFp.mjs";
import { renderApplyDamageButton, resolveClickDefender } from "./damageApplication.mjs";
import {
  consumePrimedTechnique, applyTechniqueBonusDamage, applyTechniqueDiceIncrease,
  getTechniqueEffectPayload, renderTechniqueSavingThrowHTML,
} from "./technique-rolls.mjs";
import { checkFlanking } from "./flanking.mjs";
import { computeLehrenTargetBonus } from "./lehren.mjs";
import { isDurabilityEnabled } from "./materials.mjs";

/**
 * The intended target's flanking result (see helpers/flanking.mjs) for an
 * about-to-roll Angriffswurf, resolved via the same defender-lookup used at
 * Evaluate-time (helpers/damageApplication.mjs#resolveClickDefender) - here
 * called BEFORE rolling, since Flankieren's own flat attack bonus (equal to
 * the attacker's own Tactic level) needs to go into the roll itself, not
 * just the later hit comparison. A no-op ({flanking: false}) if there's no
 * resolvable defender yet, or it would resolve to the attacker itself.
 * @param {Actor} actor
 * @return {{flanking: boolean}}
 */
function resolveAttackFlanking(actor) {
  const defender = resolveClickDefender();
  return defender && defender !== actor ? checkFlanking(actor, defender) : { flanking: false };
}

/**
 * A short chat line noting a detected Flankieren bonus, or '' if none
 * applied - shared by rollWeaponItem/rollMartialArtsAttack.
 * @param {{flanking: boolean}} flank
 * @param {number} bonus
 * @return {string}
 */
function formatFlankingBonusLine(flank, bonus) {
  if (!flank.flanking) return '';
  return `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.FlankingBonus', { bonus })}</div>`;
}

/**
 * Post a simple chat card (an optional Roll, an AP-cost line, and a
 * flavor/title) on the given actor's behalf. criticalType (see
 * helpers/criticalRolls.mjs) colors roll's own rendered HTML green/red when
 * given - used by D20 checks (Restrained/Poison/Concentration, see
 * helpers/statusEffects.mjs), left null by every non-D20 roll (Regeneration,
 * Meditation, Adrenalin, ...).
 * @param {Actor} actor
 * @param {string} title
 * @param {Roll|null} roll
 * @param {number} apCost
 * @param {string} [extraHTML]
 * @param {"success"|"failure"|null} [criticalType]
 * @param {number} [rpCost]   Alternate cost paid off the actor's own turn -
 *   see helpers/statusEffects.mjs#isActorsOwnTurn. Never non-zero together
 *   with apCost - RP and AP are alternate payment paths, not combined.
 * @return {Promise<ChatMessage>}
 */
export async function postActionChatCard(actor, title, roll, apCost, extraHTML = '', criticalType = null, rpCost = 0) {
  const parts = [formatRollCardHeading(title)];
  if (apCost) {
    parts.push(`<div class="sksk-roll-ap-cost"><strong>${game.i18n.localize('SKSK.Spell.APCost')}:</strong> ${apCost}</div>`);
  }
  if (rpCost) {
    parts.push(`<div class="sksk-roll-rp-cost"><strong>${game.i18n.localize('SKSK.Spell.RPCost')}:</strong> ${rpCost}</div>`);
  }
  if (roll) parts.push(wrapCriticalBlock(await roll.render(), criticalType));
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
 * Post a simple "reloading" chat card for a Nachladen(X)-property weapon
 * (see CONFIG.SKSK.modelProperties.reload) and clear its own "ammoRemaining"
 * flag (back to a full magazine next fire) - no attack/damage roll happens
 * on this click at all, it's entirely spent reloading. See rollWeaponItem,
 * which routes here instead of its normal attack flow once the magazine is
 * empty.
 * @param {Item} item
 * @param {number} apCost
 * @return {Promise<ChatMessage|void>}
 */
async function rollWeaponReload(item, apCost) {
  const actor = item.actor;
  if (actor && !hasEnoughActionPoints(actor, apCost)) return;
  if (actor) await actor.update(spendActionPoints(actor, apCost));
  await item.unsetFlag('sksk', 'ammoRemaining');
  const descriptionHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.AttackRoll.ReloadDescription', { name: actor?.name ?? item.name, weapon: item.name })}</div>`;
  return postActionChatCard(actor, item.name, null, apCost, descriptionHTML);
}

/**
 * Roll a weapon item: its Angriffswurf (attack roll) - two d20s plus
 * computeWeaponAttackBonus, see helpers/attackRolls.mjs - followed by its
 * existing damage formula (or plain description, if it has no formula),
 * both in one chat card. See documents/item.mjs#roll, which routes every
 * weapon-type Item here (mirrors the existing spell-type routing to
 * helpers/spell-rolls.mjs#rollSpellItem).
 *
 * Nachladen(X)/Magazin(X) (see CONFIG.SKSK.modelProperties.reload): a
 * weapon carrying this property fires Magazin(X) times (its resolvedModel's
 * own reloadMagazineSize - a Model-only field, defaulting to 1 when unset,
 * i.e. "fires once then must reload") before its own next Angriffswurf-
 * button click instead spends Nachladen(X)'s own AP cost reloading (see
 * rollWeaponReload above) rather than firing. A "sksk.ammoRemaining" flag
 * (pure per-Item runtime state, not schema data) tracks shots left in the
 * current magazine, refilling to a full magazine once reloaded.
 * @param {Item} item   The weapon item being used.
 * @return {Promise<ChatMessage>}
 */
export async function rollWeaponItem(item) {
  const actor = item.actor;
  const reloadEntry = (item.system.effectiveProperties ?? []).find(e => e.property === 'reload');
  let ammoRemaining = null;
  if (reloadEntry) {
    const magazineSize = Math.max(1, item.system.resolvedModel?.reloadMagazineSize || 1);
    ammoRemaining = item.getFlag('sksk', 'ammoRemaining') ?? magazineSize;
    if (ammoRemaining <= 0) return rollWeaponReload(item, reloadEntry.value ?? 0);
  }

  const parts = [formatRollCardHeading(item.name)];
  const damageType = getWeaponDamageType(item.system);
  const damageDice = [{ damageType, dieSizes: getDamageDieSizes(item.system.formula) }];
  const damageEntries = [];

  // A primed Technique (helpers/technique-rolls.mjs) is consumed by this
  // actor's own very next weapon/Martial Arts attack, whichever comes
  // first - its styleAttackBonus (from any active same-Kampfstil stand)
  // applies to the attack roll below; its own attackBonus payload (if
  // any) applies to the damage roll further down.
  const technique = actor ? await consumePrimedTechnique(actor, 'weapon') : null;

  if (actor) {
    const flank = resolveAttackFlanking(actor);
    const flankBonus = flank.flanking ? getActorSkillLevel(actor, 'tactic') : 0;
    const attackBonus = computeWeaponAttackBonus(actor, item) + (technique?.styleAttackBonus ?? 0) + (technique?.hitBonusAmount ?? 0) + flankBonus;
    const rolls = await rollAttackPair(attackBonus, actor);
    const rendered = await renderAttackPairHTML(rolls, 'armorClass', actor, {
      damageDice, killSkillKey: item.system.weaponType, flanking: flank.flanking,
    });
    parts.push(`<div class="sksk-roll-attack"><strong>${game.i18n.localize('SKSK.AttackRoll.Attack')}</strong></div>${rendered}`);
    parts.push(formatFlankingBonusLine(flank, flankBonus));

    const fpGrant = await grantSkillUsageFp(actor, item.system.weaponType, 'weaponAttack');
    parts.push(formatSkillFpGrantLine(fpGrant));
    if (flank.flanking) parts.push(formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'tactic', 'flankAttack')));
  }

  if (item.system.formula) {
    const attributeBonus = actor ? computeWeaponAttributeBonus(actor, item.system) : 0;
    const lehrenDamageBonus = actor
      ? computeLehrenTargetBonus(actor, 'damageBonus', { skillKey: item.system.weaponType, kind: 'weapon' })
      : 0;
    const damageTypeBonus = actor?.system.damageBonus?.[damageType] ?? 0;
    const allWeaponsDamageBonus = actor?.system.damageBonusAll ?? 0;
    const totalDamageBonus = attributeBonus + lehrenDamageBonus + damageTypeBonus + allWeaponsDamageBonus;
    const damageFormulaBase = totalDamageBonus ? `${item.system.formula} + ${totalDamageBonus}` : item.system.formula;
    const damageFormula = applyTechniqueDiceIncrease(damageFormulaBase, technique);
    const roll = await new Roll(damageFormula, item.getRollData()).evaluate();
    const rendered = await roll.render();
    parts.push(`<div class="sksk-roll-damage"><strong>${game.i18n.localize('SKSK.Spell.Roll.Damage')}</strong></div>${rendered}`);
    const { total, line } = await applyTechniqueBonusDamage(roll.total, technique, item.getRollData());
    parts.push(line);
    damageEntries.push({ damageType, amount: total });
    parts.push(renderApplyDamageButton(actor, damageEntries, item.system.weaponType, getTechniqueEffectPayload(technique)));
    parts.push(renderTechniqueSavingThrowHTML(technique));
  } else if (item.system.description) {
    const descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      item.system.description ?? '', { relativeTo: item, secrets: item.isOwner }
    );
    parts.push(`<div class="sksk-roll-description">${descriptionHTML}</div>`);
    parts.push(renderApplyDamageButton(actor, [], item.system.weaponType, getTechniqueEffectPayload(technique)));
    parts.push(renderTechniqueSavingThrowHTML(technique));
  }

  // Haltbarkeit (Durability) - every actual shot/swing costs 1, regardless
  // of hit/miss; Nachladen's own reload click (above, an early return)
  // never reaches here, so reloading itself never costs durability. A
  // no-op entirely while the mechanic is switched off (see helpers/
  // materials.mjs#isDurabilityEnabled).
  const durabilityUpdate = isDurabilityEnabled()
    ? { 'system.durability.value': Math.max(0, item.system.durability.value - 1) }
    : {};
  if (reloadEntry) {
    await item.update({ ...durabilityUpdate, 'flags.sksk.ammoRemaining': ammoRemaining - 1 });
  } else if (Object.keys(durabilityUpdate).length) {
    await item.update(durabilityUpdate);
  }

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: item.name,
    content: `<div class="sksk-chat-card sksk-action-card">${parts.join('')}</div>`,
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
 * Whether an actor currently has at least rpCost Reaction Points - warns
 * and returns false otherwise, aborting the calling action before anything
 * is rolled or deducted. Mirrors hasEnoughActionPoints above; see
 * helpers/statusEffects.mjs#isActorsOwnTurn - callers only ever reach this
 * off the actor's own turn, RP's only spendable context.
 * @param {Actor} actor
 * @param {number} rpCost
 * @return {boolean}
 */
function hasEnoughReactionPoints(actor, rpCost) {
  if ((actor.system.reactionPoints?.value ?? 0) >= rpCost) return true;
  ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughRP'));
  return false;
}

/**
 * Deduct a flat RP cost from an actor - a plain object patch, not yet
 * applied; merge into whatever else the calling action also updates so
 * both land in a single actor.update() call. Mirrors spendActionPoints
 * above.
 * @param {Actor} actor
 * @param {number} rpCost
 * @return {object}
 */
function spendReactionPoints(actor, rpCost) {
  if (!rpCost) return {};
  return { 'system.reactionPoints.value': Math.max(0, (actor.system.reactionPoints?.value ?? 0) - rpCost) };
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
 * data/actor-base.mjs#martialArtsAttacks): its Angriffswurf (attack roll -
 * two d20s plus computeMartialArtsAttackBonus, see helpers/attackRolls.mjs)
 * followed by its own dice formula plus the attribute bonus resolved per
 * its own attributeUsage (a separate rule from the attack roll's own
 * attribute bonus - attributeUsage only ever governed this damage roll),
 * deducting its own AP cost.
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
  // Outside the actor's own turn, this attack is paid from RP instead of
  // AP - mirroring the attack's own apCost 1:1 (Martial Arts Attacks have
  // no separate RP-cost field, unlike Techniques/Items/Spells). Martial
  // Arts Attacks are always melee, so unlike weapon items (see useItem
  // below) there's no Ranged property to block here.
  const offTurn = !isActorsOwnTurn(actor);
  if (offTurn ? !hasEnoughReactionPoints(actor, attack.apCost) : !hasEnoughActionPoints(actor, attack.apCost)) return;

  const damageDice = [{ damageType: attack.damageType, dieSizes: getDamageDieSizes(attack.formula) }];
  const technique = await consumePrimedTechnique(actor, 'martialArts');
  const flank = resolveAttackFlanking(actor);
  const flankBonus = flank.flanking ? getActorSkillLevel(actor, 'tactic') : 0;
  const attackBonus = computeMartialArtsAttackBonus(actor, attack) + (technique?.styleAttackBonus ?? 0) + (technique?.hitBonusAmount ?? 0) + flankBonus;
  const rolls = await rollAttackPair(attackBonus, actor);
  const attackHTML = `<div class="sksk-roll-attack"><strong>${game.i18n.localize('SKSK.AttackRoll.Attack')}</strong></div>${await renderAttackPairHTML(rolls, 'armorClass', actor, {
    damageDice, killSkillKey: 'martialArts', flanking: flank.flanking,
  })}${formatFlankingBonusLine(flank, flankBonus)}`;

  const attributeBonus = resolveMartialArtsAttributeBonus(actor, attack.attributes, attack.attributeUsage);
  const lehrenDamageBonus = computeLehrenTargetBonus(actor, 'damageBonus', { skillKey: 'martialArts', kind: 'weapon' });
  const damageTypeBonus = actor.system.damageBonus?.[attack.damageType] ?? 0;
  const allWeaponsDamageBonus = actor.system.damageBonusAll ?? 0;
  const bonus = attributeBonus + lehrenDamageBonus + damageTypeBonus + allWeaponsDamageBonus;
  const formulaBase = bonus ? `${attack.formula} + ${bonus}` : attack.formula;
  const formula = applyTechniqueDiceIncrease(formulaBase, technique);
  const roll = await new Roll(formula, actor.getRollData()).evaluate();
  const renderedDamage = await roll.render();
  const { total: damageTotal, line: techniqueLine } = await applyTechniqueBonusDamage(roll.total, technique, actor.getRollData());
  const damageEntries = [{ damageType: attack.damageType, amount: damageTotal }];
  const applyDamageHTML = renderApplyDamageButton(actor, damageEntries, 'martialArts', getTechniqueEffectPayload(technique))
    + renderTechniqueSavingThrowHTML(technique);

  await actor.update(offTurn ? spendReactionPoints(actor, attack.apCost) : spendActionPoints(actor, attack.apCost));
  let fpHTML = formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'martialArts', 'weaponAttack'));
  if (flank.flanking) fpHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'tactic', 'flankAttack'));
  // Every attack beyond the first (see the default-seeded "Main Hand"/
  // "Off Hand" entries, though a GM may add more) counts as Ambidextrous'
  // own "Zweitwaffe" (second weapon) trigger.
  if (index >= 1) {
    fpHTML += formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'ambidextrous', 'offHandAttack'));
  }
  fpHTML += formatSkillFpGrantLine(await checkReflexActionTrigger(actor));

  const apCostHTML = attack.apCost
    ? `<div class="${offTurn ? 'sksk-roll-rp-cost' : 'sksk-roll-ap-cost'}"><strong>${game.i18n.localize(offTurn ? 'SKSK.Spell.RPCost' : 'SKSK.Spell.APCost')}:</strong> ${attack.apCost}</div>`
    : '';
  const title = attack.name || game.i18n.localize('SKSK.Action.MartialArtsAttack');
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: title,
    content: `<div class="sksk-chat-card sksk-action-card">${formatRollCardHeading(title)}${apCostHTML}${attackHTML}${renderedDamage}${techniqueLine}${applyDamageHTML}${fpHTML}</div>`,
    rolls: [roll],
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
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
  const fpGrant = await grantSkillUsageFp(actor, 'health', 'regenerationUsed');
  const descriptionHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.Action.RegenerateLifeDescription', { name: actor.name })}</div>`;
  const extraHTML = descriptionHTML + formatSkillFpGrantLine(fpGrant) + formatSkillFpGrantLine(await checkReflexActionTrigger(actor));
  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Regeneration'), roll, apCost, extraHTML);
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
  const restored = newValue - mana.value;
  await actor.update({
    ...spendActionPoints(actor, apCost),
    'system.mana.value': newValue,
    // Manaregeneration's own FP accumulator (see helpers/rest.mjs#
    // applyRest, which turns this into FP on the next Anpassungs-/
    // Genesungspause) - only the amount actually restored (post-cap), not
    // the raw roll total.
    'system.manaRegenerationAccumulator': (actor.system.manaRegenerationAccumulator ?? 0) + Math.max(0, restored),
  });
  const fpGrant = await grantSkillUsageFp(actor, 'meditation', 'meditationUsed');
  // Seelenstärke's own extra trigger - only while a Combat is active, and
  // only if the GM has also flipped this actor's own GM-tab switch on top
  // of the usual GM-configured rate (see data/actor-base.mjs#
  // soulforceMeditationCombatFpEnabled).
  const soulforceGrant = (game.combat && actor.system.soulforceMeditationCombatFpEnabled)
    ? await grantSkillUsageFp(actor, 'soulforce', 'meditationUsedInCombat')
    : null;
  const descriptionHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.Action.RegenerateManaDescription', { name: actor.name })}</div>`;
  const extraHTML = descriptionHTML + formatSkillFpGrantLine(fpGrant) + formatSkillFpGrantLine(soulforceGrant)
    + formatSkillFpGrantLine(await checkReflexActionTrigger(actor));
  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Meditation'), roll, apCost, extraHTML);
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

  const fpGrant = await grantSkillUsageFp(actor, 'adrenalin', 'adrenalinUsed');
  const descriptionHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.Action.AdrenalinDescription', { name: actor.name })}</div>`;
  const extraHTML = descriptionHTML + formatSkillFpGrantLine(fpGrant);
  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Adrenalin'), roll, 0, extraHTML);
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

  // Outside the actor's own turn, moving is a flat 2 RP reaction - the
  // on-turn "first use per round is free, then 1 AP" logic below is purely
  // an own-turn concept and doesn't apply.
  const offTurn = !isActorsOwnTurn(actor);
  const round = game.combat?.round ?? null;
  const isFree = !offTurn && (round === null || actor.system.lastFreeMoveRound !== round);
  const apCost = offTurn ? 0 : (isFree ? 0 : 1);
  const rpCost = offTurn ? 2 : 0;
  if (offTurn ? !hasEnoughReactionPoints(actor, rpCost) : !hasEnoughActionPoints(actor, apCost)) return;

  const speed = computeMovementSpeeds(actor)[movementType] ?? 0;
  const updates = offTurn ? spendReactionPoints(actor, rpCost) : spendActionPoints(actor, apCost);
  if (!offTurn && isFree && round !== null) updates['system.lastFreeMoveRound'] = round;
  if (Object.keys(updates).length) await actor.update(updates);

  // Stamina's own "distance moved in combat" FP trigger - only while an
  // actual Combat is tracking rounds, per the design spreadsheet's
  // "im Kampf" wording; not for free exploration movement outside Combat.
  const fpGrant = round !== null
    ? await grantSkillUsageFp(actor, 'stamina', 'combatMovement', Math.ceil(speed / 20))
    : null;

  const label = game.i18n.localize(CONFIG.SKSK.movementTypes[movementType] ?? movementType);
  const extraHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.Action.MoveDistance', { label, speed })}</div>`
    + formatSkillFpGrantLine(fpGrant) + formatSkillFpGrantLine(await checkReflexActionTrigger(actor));
  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Move'), null, apCost, extraHTML, null, rpCost);
}

/**
 * "Use" an equipped Weapon from the Actions tab: rolls it (posts its own
 * description, if any - Weapons carry no formula of their own), deducting
 * its own configured AP cost (system.useApCost). A generic Item's own
 * "Use" button calls this too, but item.type 'item' just delegates
 * straight to item.roll() - see rollItemUsage below, which now handles
 * everything (AP cost, Charges/quantity consumption, Reflexe's own FP
 * trigger, and the Roll-Card itself) in one self-contained place, the same
 * way rollWeaponItem/rollSpellItem already do for their own types.
 * @param {Actor} actor
 * @param {Item} item   A Weapon or Item, owned by actor.
 * @return {Promise<void>}
 */
export async function useItem(actor, item) {
  if (item.type === 'item') return item.roll();

  if (item.type === 'weapon' && !canUseWeaponAttack(actor)) {
    return ui.notifications.warn(game.i18n.localize('SKSK.StatusEffect.AttackBlocked'));
  }

  // Outside the actor's own turn, this attack is paid from RP instead of
  // AP - mirroring the weapon's own useApCost 1:1 (weapons have no
  // separate RP-cost field). Ranged weapons can't be used this way at all
  // (per design, only melee attacks work as an off-turn reaction).
  const offTurn = item.type === 'weapon' && !isActorsOwnTurn(actor);
  if (offTurn && (item.system.effectiveProperties ?? []).some(p => p.property === 'ranged')) {
    return ui.notifications.warn(game.i18n.localize('SKSK.Action.RangedReactionBlocked'));
  }

  const cost = item.system.useApCost ?? 0;
  if (offTurn ? !hasEnoughReactionPoints(actor, cost) : !hasEnoughActionPoints(actor, cost)) return;

  await item.roll();
  await actor.update(offTurn ? spendReactionPoints(actor, cost) : spendActionPoints(actor, cost));
  if (offTurn && cost) {
    ui.notifications.info(game.i18n.format('SKSK.Action.ReactionRpSpent', { cost }));
  }

  // item.roll() (above) already posted its own chat card before AP/RP was
  // spent, so Reflexe's own FP trigger (which can only be checked once
  // it's actually deducted) gets a small chat card of its own instead,
  // only when it actually fires.
  const reflexGrant = await checkReflexActionTrigger(actor);
  if (reflexGrant) await postActionChatCard(actor, game.i18n.localize('SKSK.Action.Use'), null, 0, formatSkillFpGrantLine(reflexGrant));
}

/**
 * Roll a generic Item's own "Use" action - see documents/item.mjs#roll,
 * which routes every item.type "item" roll here (whether triggered via
 * the Actions tab's "Use" button - see useItem above - or by clicking the
 * item directly, e.g. in the Items tab).
 *
 * A non-Usable item (see data/item.mjs#prepareDerivedData's own isUsable -
 * Consumable, or Equippable+Equipped+Enchanted; an equipped item with no
 * enchantment has only passive Active Effects, nothing to actively Use)
 * just posts its own description (plus its own enchantment description,
 * if enchanted) with no further consequence - AP cost, Charges, Manakern's
 * own FP grant, and the optional roll below are all Usable-only.
 *
 * A Usable item pays its own useApCost (if any); consumes one charge if
 * Charges are enabled (computed together with the Consumable quantity
 * consequence in ONE combined update - a Consumable item's charges
 * reaching 0 also consumes one unit of its own quantity and resets charges
 * back to max, mirroring the separate updateItem hook in sksk.mjs, but
 * computed eagerly here instead of relying on that hook's own subsequent,
 * un-awaitable update, so the Roll-Card below can correctly report the
 * resulting quantity/charges without racing it) or, without Charges
 * enabled, consumes one unit of quantity directly if Consumable; then
 * rolls its own optional dice roll, if enabled.
 * @param {Item} item
 * @return {Promise<ChatMessage>}
 */
export async function rollItemUsage(item) {
  const actor = item.actor;
  const system = item.system;
  const parts = [formatRollCardHeading(item.name)];

  const descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    system.description ?? '', { relativeTo: item, secrets: item.isOwner }
  );
  const enchantmentHTML = system.enchanted
    ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        system.enchantmentDescription ?? '', { relativeTo: item, secrets: item.isOwner }
      )
    : '';

  if (!system.isUsable) {
    parts.push(`<div class="sksk-roll-description">${descriptionHTML}</div>`);
    if (enchantmentHTML) parts.push(`<div class="sksk-roll-description">${enchantmentHTML}</div>`);
    return postItemUsageCard(actor, item, parts);
  }

  // Outside the actor's own turn, Using this item is paid from RP instead
  // of AP - system.useRpCost if explicitly set (0 = "not set"), otherwise
  // mirroring useApCost 1:1.
  const offTurn = actor && !isActorsOwnTurn(actor);
  const apCost = system.useApCost ?? 0;
  const rpCost = offTurn ? ((system.useRpCost ?? 0) > 0 ? system.useRpCost : apCost) : 0;
  if (actor && (offTurn ? !hasEnoughReactionPoints(actor, rpCost) : !hasEnoughActionPoints(actor, apCost))) return;

  const usesCharges = system.charges?.enabled;
  const updates = {};
  let chargesAfterUse = null;
  let quantityDecreased = false;
  let remainingQuantity = system.quantity;

  if (usesCharges) {
    chargesAfterUse = Math.max(0, system.charges.value - 1);
    updates['system.charges.value'] = chargesAfterUse;
    if (chargesAfterUse === 0 && system.consumable) {
      remainingQuantity = Math.max(0, system.quantity - 1);
      updates['system.quantity'] = remainingQuantity;
      updates['system.charges.value'] = remainingQuantity > 0 ? system.charges.max : 0;
      quantityDecreased = true;
    }
  } else if (system.consumable) {
    remainingQuantity = Math.max(0, system.quantity - 1);
    updates['system.quantity'] = remainingQuantity;
    quantityDecreased = true;
  }
  // Haltbarkeit (Durability) - Consumable items are exempt entirely (per
  // design; see data/item.mjs#durability), and the whole mechanic is a
  // no-op while switched off (see helpers/materials.mjs#isDurabilityEnabled).
  if (!system.consumable && isDurabilityEnabled()) {
    updates['system.durability.value'] = Math.max(0, system.durability.value - 1);
  }
  if (Object.keys(updates).length) await item.update(updates);

  if (actor) {
    if (offTurn) { if (rpCost) await actor.update(spendReactionPoints(actor, rpCost)); }
    else if (apCost) await actor.update(spendActionPoints(actor, apCost));
  }

  // 2. Status line - what's happening to the item itself.
  let statusText;
  if (system.consumable) {
    if (quantityDecreased) {
      statusText = remainingQuantity > 0
        ? game.i18n.format('SKSK.ItemSheet.UseStatusConsumedWithRemaining', { quantity: remainingQuantity })
        : game.i18n.localize('SKSK.ItemSheet.UseStatusConsumed');
    } else {
      statusText = game.i18n.localize('SKSK.ItemSheet.UseStatusUsed');
    }
  } else {
    statusText = game.i18n.localize('SKSK.ItemSheet.UseStatusEnchantmentActivated');
  }
  parts.push(`<div class="sksk-item-use-status-line">${statusText}</div>`);

  // 3. AP/RP cost, only when non-zero.
  if (offTurn && rpCost > 0) {
    parts.push(`<div class="sksk-roll-rp-cost"><strong>${game.i18n.localize('SKSK.Spell.RPCost')}:</strong> ${rpCost}</div>`);
  } else if (!offTurn && apCost > 0) {
    parts.push(`<div class="sksk-roll-ap-cost"><strong>${game.i18n.localize('SKSK.Spell.APCost')}:</strong> ${apCost}</div>`);
  }

  // 4. Charges, only when enabled.
  if (usesCharges && actor) {
    const key = chargesAfterUse > 0 ? 'SKSK.ItemSheet.ChargesRemaining' : 'SKSK.ItemSheet.ChargesDepleted';
    parts.push(`<div class="sksk-item-use-status-line">${game.i18n.format(key, { actor: actor.name, value: chargesAfterUse })}</div>`);
  }

  if (actor) {
    // Manakern's own flat FP grant (system.manaCoreFpGrant) - only for an
    // actual Use, matching its own hint text ("granted on each use").
    parts.push(formatSkillFpGrantLine(await grantFlatSkillFp(actor, 'manaCore', system.manaCoreFpGrant)));
    parts.push(formatSkillFpGrantLine(await checkReflexActionTrigger(actor)));
  }

  // 5-6. Description, then the enchantment's own description (if any).
  parts.push(`<div class="sksk-roll-description">${descriptionHTML}</div>`);
  if (enchantmentHTML) parts.push(`<div class="sksk-roll-description">${enchantmentHTML}</div>`);

  // 7. The optional roll.
  let roll = null;
  if (system.roll.enabled && system.formula) {
    const rollData = item.getRollData();
    roll = await new Roll(rollData.formula, rollData).evaluate();
    parts.push(await roll.render());
  }

  return postItemUsageCard(actor, item, parts, roll);
}

/**
 * Post a generic Item's own Roll-Card - own helper (rather than
 * postActionChatCard, which always builds its own heading from a plain
 * title string) since rollItemUsage already builds its full parts array,
 * heading included, itself.
 * @param {Actor|null} actor
 * @param {Item} item
 * @param {string[]} parts
 * @param {Roll|null} [roll]
 * @return {Promise<ChatMessage>}
 */
async function postItemUsageCard(actor, item, parts, roll = null) {
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: item.name,
    content: `<div class="sksk-chat-card sksk-action-card">${parts.join('')}</div>`,
    rolls: roll ? [roll] : [],
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
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
  // Outside the actor's own turn, Dodge is a flat 2 RP reaction instead of
  // its usual 1 AP.
  const offTurn = !isActorsOwnTurn(actor);
  const apCost = offTurn ? 0 : 1;
  const rpCost = offTurn ? 2 : 0;
  if (offTurn ? !hasEnoughReactionPoints(actor, rpCost) : !hasEnoughActionPoints(actor, apCost)) return;

  const count = 1 + getActorSkillLevel(actor, 'reflexes');
  await actor.update(offTurn ? spendReactionPoints(actor, rpCost) : spendActionPoints(actor, apCost));
  const fpGrant = await grantSkillUsageFp(actor, 'reflexes', 'dodgeUsed');

  const extraHTML = `<div class="sksk-roll-description">${game.i18n.format('SKSK.Action.DodgeCount', { count })}</div>`
    + formatSkillFpGrantLine(fpGrant) + formatSkillFpGrantLine(await checkReflexActionTrigger(actor));
  return postActionChatCard(actor, game.i18n.localize('SKSK.Action.Dodge'), null, apCost, extraHTML, null, rpCost);
}
