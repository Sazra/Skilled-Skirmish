import { getActorSkillLevel } from './skills.mjs';
import { getSpellSchool } from './spells.mjs';
import { computeNaturalMaterialBonus } from './defense.mjs';
import { applyD20Malus } from './statusEffects.mjs';
import { getAttackCriticalType, resolveCheckSuccess, wrapCriticalBlock, wrapCriticalInline } from './criticalRolls.mjs';

/**
 * Präzision's own minimum Präzisionswurf result, per skill level (1-5) -
 * see maybeRollPrecision.
 */
const PRECISION_THRESHOLDS = { 1: 20, 2: 19, 3: 18, 4: 17, 5: 16 };

/**
 * The highest of a set of attribute modifiers, unless every one of them is
 * equal - in which case they're all summed instead. Shared by Masterful
 * weapons and every Martial Arts attack (see computeWeaponAttackBonus/
 * computeMartialArtsAttackBonus below) - both use this exact rule.
 * @param {number[]} mods
 * @return {number}
 */
function highestOrSumIfAllTied(mods) {
  if (!mods.length) return 0;
  const highest = Math.max(...mods);
  return mods.every(mod => mod === highest) ? mods.reduce((sum, mod) => sum + mod, 0) : highest;
}

/**
 * Among a Combined spell's own combinedSkills entries, the caster's actual
 * current level in each - the highest one is added as the attack bonus,
 * and every entry tied at that same highest level is summed instead of
 * just the one (e.g. a spell requiring Fire/Water/Air, caster at
 * Fire 3/Water 3/Air 2, contributes 3+3=6, not just 3).
 * @param {object} spellSystem
 * @param {Actor} actor
 * @return {number}
 */
function computeCombinedSkillAttackBonus(spellSystem, actor) {
  const levels = (spellSystem.combinedSkills ?? []).map(entry => getActorSkillLevel(actor, entry.skill));
  if (!levels.length) return 0;
  const highest = Math.max(...levels);
  return levels.filter(level => level === highest).reduce((sum, level) => sum + level, 0);
}

/**
 * A spell's Angriffswurf (attack roll) bonus, added to both of the two
 * d20s rolled for it - depends on spellType:
 * - Simple/Advanced: Willpower modifier + the caster's level in the
 *   spell's own magicSchool + Hit Correction skill level + that school's
 *   variable bonus/malus (system.magicSchoolAttackBonus.<school>, an
 *   Active-Effect-only field).
 * - Combined: Willpower modifier + Hit Correction skill level + the
 *   spell's own combinedSchool's variable bonus/malus
 *   (system.combinedMagicSchoolAttackBonus.<school>) + the combinedSkills
 *   bonus (see computeCombinedSkillAttackBonus).
 * - Systemless: Willpower modifier + Hit Correction skill level + Magic
 *   Control skill level.
 * @param {object} spellSystem
 * @param {Actor} actor
 * @return {number}
 */
export function computeSpellAttackBonus(spellSystem, actor) {
  const wilMod = actor.system.attributes?.wil?.mod ?? 0;
  const hitCorrection = getActorSkillLevel(actor, 'hitCorrection');

  if (spellSystem.spellType === 'simple' || spellSystem.spellType === 'advanced') {
    const schoolLevel = getActorSkillLevel(actor, spellSystem.magicSchool);
    const schoolBonus = actor.system.magicSchoolAttackBonus?.[spellSystem.magicSchool] ?? 0;
    return wilMod + schoolLevel + hitCorrection + schoolBonus;
  }

  if (spellSystem.spellType === 'combined') {
    const schoolBonus = actor.system.combinedMagicSchoolAttackBonus?.[spellSystem.combinedSchool] ?? 0;
    return wilMod + hitCorrection + schoolBonus + computeCombinedSkillAttackBonus(spellSystem, actor);
  }

  // Systemless.
  return wilMod + hitCorrection + getActorSkillLevel(actor, 'magicControl');
}

/**
 * The attribute keys a weapon's Angriffswurf (attack roll) attribute bonus
 * draws from - its own attributeOverride if enabled (a unique variant of a
 * shared Model), otherwise its resolvedModel's own attributes list.
 * @param {object} weaponSystem
 * @return {string[]}
 */
function getWeaponAttributeKeys(weaponSystem) {
  if (weaponSystem.attributeOverride?.enabled) {
    return Object.entries(weaponSystem.attributeOverride.attributes ?? {})
      .filter(([, checked]) => checked).map(([key]) => key);
  }
  return weaponSystem.resolvedModel?.attributes ?? [];
}

/**
 * A weapon's attack-bonus attribute contribution - Masterful uses
 * highestOrSumIfAllTied; Refined/Specialized/no property just take the
 * highest (ties don't stack), with Specialized doubling the result.
 * @param {Actor} actor
 * @param {object} weaponSystem
 * @return {number}
 */
function computeWeaponAttributeBonus(actor, weaponSystem) {
  const keys = getWeaponAttributeKeys(weaponSystem);
  const mods = keys.map(key => actor.system.attributes?.[key]?.mod ?? 0);
  if (!mods.length) return 0;

  const properties = weaponSystem.effectiveProperties ?? [];
  const has = key => properties.some(p => p.property === key);

  if (has('masterful')) return highestOrSumIfAllTied(mods);
  const highest = Math.max(...mods);
  return has('specialized') ? highest * 2 : highest;
}

/**
 * A weapon item's Angriffswurf (attack roll) bonus, added to both of the
 * two d20s rolled for it: its matching weapon skill + its material's
 * attack bonus + its resolved Model's flat bonus + its attribute bonus
 * (see computeWeaponAttributeBonus).
 * @param {Actor} actor
 * @param {Item} weaponItem
 * @return {number}
 */
export function computeWeaponAttackBonus(actor, weaponItem) {
  const system = weaponItem.system;
  const skillLevel = getActorSkillLevel(actor, system.weaponType);
  const materialBonus = system.materialAttackBonus ?? 0;
  const modelFlat = system.resolvedModel?.flatBonus ?? 0;
  const attributeBonus = computeWeaponAttributeBonus(actor, system);
  return skillLevel + materialBonus + modelFlat + attributeBonus;
}

/**
 * A Martial Arts attack's attribute bonus contribution - always
 * highestOrSumIfAllTied, regardless of that attack's own attributeUsage
 * (which only governs its damage roll - see helpers/actions.mjs#
 * resolveMartialArtsAttributeBonus).
 * @param {Actor} actor
 * @param {object} attack   An entry from actor.system.martialArtsAttacks.
 * @return {number}
 */
function computeMartialArtsAttributeBonus(actor, attack) {
  const keys = Object.entries(attack.attributes ?? {}).filter(([, checked]) => checked).map(([key]) => key);
  const mods = keys.map(key => actor.system.attributes?.[key]?.mod ?? 0);
  return highestOrSumIfAllTied(mods);
}

/**
 * A Martial Arts attack's Angriffswurf (attack roll) bonus, added to both
 * of the two d20s rolled for it: the Martial Arts skill level + the
 * actor's natural material bonus (no weapon Model, so no flat bonus term)
 * + its attribute bonus (see computeMartialArtsAttributeBonus).
 * @param {Actor} actor
 * @param {object} attack   An entry from actor.system.martialArtsAttacks.
 * @return {number}
 */
export function computeMartialArtsAttackBonus(actor, attack) {
  const skillLevel = getActorSkillLevel(actor, 'martialArts');
  const materialBonus = computeNaturalMaterialBonus(actor);
  const attributeBonus = computeMartialArtsAttributeBonus(actor, attack);
  return skillLevel + materialBonus + attributeBonus;
}

/**
 * Roll the Angriffswurf (attack roll): two independent d20s, each with the
 * same flat bonus and the actor's current D20 malus (Exhaustion only -
 * attributeKey stays null, since no single attribute cleanly represents an
 * arbitrary weapon/spell attack the way it does for e.g. a Constitution
 * check). The two rolls are never combined into one - see
 * renderAttackPairHTML.
 * @param {number} bonus
 * @param {Actor|null} actor
 * @return {Promise<[Roll, Roll]>}
 */
export async function rollAttackPair(bonus, actor) {
  const baseFormula = bonus ? `1d20 + ${bonus}` : '1d20';
  const formula = actor ? applyD20Malus(baseFormula, actor) : baseFormula;
  const rollA = await new Roll(formula, actor?.getRollData()).evaluate();
  const rollB = await new Roll(formula, actor?.getRollData()).evaluate();
  return [rollA, rollB];
}

/**
 * The distinct die sizes (face counts) used by a damage formula, without
 * evaluating it - e.g. "1d4 + 3d6 + 2" -> [4, 6]. Used to compute a
 * critical Angriffswurf's bonus damage (see rollCriticalBonusDamage): one
 * extra die of every distinct size already present in the attack's own
 * damage formula(s), regardless of how many dice of that size the base
 * formula itself rolls.
 * @param {string} formula
 * @return {number[]}
 */
export function getDamageDieSizes(formula) {
  if (!formula) return [];
  let terms;
  try {
    terms = new Roll(String(formula)).terms;
  } catch {
    return [];
  }
  return [...new Set(terms.filter(term => term instanceof foundry.dice.terms.Die).map(term => term.faces))];
}

/**
 * Roll a critical Angriffswurf's bonus damage: one extra die of every
 * distinct size in dieSizes (see getDamageDieSizes) - a baseline that
 * applies to every critical attack roll regardless of skills - plus one
 * further die of each size per level of the Brutality skill (so up to 6
 * total per size, at Brutality's max level of 5). A no-op (returns null)
 * if the attack's damage has no dice at all (a flat/descriptive weapon).
 * @param {Actor|null} actor
 * @param {number[]} dieSizes
 * @return {Promise<Roll|null>}
 */
export async function rollCriticalBonusDamage(actor, dieSizes) {
  if (!dieSizes.length) return null;
  const diceCount = 1 + (actor ? getActorSkillLevel(actor, 'brutality') : 0);
  const formula = dieSizes.map(size => `${diceCount}d${size}`).join(' + ');
  return new Roll(formula, actor?.getRollData()).evaluate();
}

/**
 * Präzision (Fighter skill, from level 1): once an ordinary (non-critical)
 * Angriffswurf is confirmed a hit, roll one further, bonus-free
 * Präzisionswurf (1d20) - if it reaches the attacker's own Präzision
 * threshold (natural 20/19/18/17/16 for level 1-5), the attack roll
 * retroactively counts as a critical success after all. A no-op (returns
 * null) if the actor has no Präzision, or the attack roll wasn't an
 * ordinary hit to begin with (already critical, or missed outright).
 * @param {Actor|null} actor
 * @param {boolean} isOrdinaryHit
 * @return {Promise<{roll: Roll, success: boolean}|null>}
 */
export async function maybeRollPrecision(actor, isOrdinaryHit) {
  if (!actor || !isOrdinaryHit) return null;
  const level = getActorSkillLevel(actor, 'precision');
  if (level < 1) return null;
  const threshold = PRECISION_THRESHOLDS[Math.min(5, level)];
  const roll = await new Roll('1d20').evaluate();
  return { roll, success: roll.total >= threshold };
}

/**
 * Render an Angriffswurf (attack roll) pair's chat HTML: both d20s shown
 * side by side (never summed), each colored green/red if its own natural
 * die was a critical success/failure per the attacker's own thresholds
 * (see helpers/criticalRolls.mjs#getAttackCriticalType), plus a button any
 * user can click later (see resolveHitEvaluationFromChat) to resolve
 * hit/miss against a defender's Armor Class or Magic Resistance - a
 * critical success/failure there always hits/always misses regardless of
 * the totals, so each roll's critical type is stashed on the button too -
 * along with the attacker's own uuid (for Präzision/Brutality, resolved
 * only once a hit is confirmed - see resolveHitEvaluationFromChat) and the
 * attack's own damage die sizes/whether Brutality's bonus damage was
 * already granted for a natural critical (see getDamageDieSizes/
 * rollCriticalBonusDamage and helpers/actions.mjs#rollWeaponItem et al).
 * @param {[Roll, Roll]} rolls
 * @param {"armorClass"|"magicResistance"} comparisonType
 * @param {Actor|null} actor   The attacker, whose own critical thresholds apply.
 * @param {{dieSizes?: number[], brutalApplied?: boolean}} [damageInfo]
 * @return {Promise<string>}
 */
export async function renderAttackPairHTML([rollA, rollB], comparisonType, actor, damageInfo = {}) {
  const { dieSizes = [], brutalApplied = false } = damageInfo;
  const critA = getAttackCriticalType(rollA, actor);
  const critB = getAttackCriticalType(rollB, actor);
  const renderedA = wrapCriticalBlock(await rollA.render(), critA);
  const renderedB = wrapCriticalBlock(await rollB.render(), critB);
  return `
    <div class="sksk-attack-roll-pair">
      <div class="sksk-attack-roll-single">
        <div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.RollA')}</div>
        ${renderedA}
      </div>
      <div class="sksk-attack-roll-single">
        <div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.RollB')}</div>
        ${renderedB}
      </div>
    </div>
    <button type="button" class="sksk-roll-hit-eval" data-action="resolveHitEvaluation"
      data-roll-a="${rollA.total}" data-roll-b="${rollB.total}" data-comparison-type="${comparisonType}"
      data-crit-a="${critA ?? ''}" data-crit-b="${critB ?? ''}" data-attacker-uuid="${actor?.uuid ?? ''}"
      data-damage-die-sizes="${dieSizes.join(',')}" data-brutal-applied="${brutalApplied}">
      ${game.i18n.localize('SKSK.AttackRoll.Evaluate')}
    </button>
  `;
}

/**
 * Handle a click on an Angriffswurf's "Evaluate" button: resolves the
 * defender as whoever the clicking user is currently targeting (their
 * first target); a GM or Assistant GM with no target set can instead just
 * have a token selected on the canvas (of anyone's, not only their own),
 * without needing to formally target it; anyone else without a target
 * falls back to their own assigned character. Then compares both of the
 * attack's already-rolled d20 totals against that defender's Armor Class
 * or Magic Resistance (per the button's own data-comparison-type) and
 * posts the outcome as a new chat message, speaking as the defender.
 *
 * An ordinary (non-critical) hit additionally gives the attacker's own
 * Präzision a chance to retroactively promote it to a critical success
 * (see maybeRollPrecision); a critical success arrived at this way, or
 * already flagged as a natural critical at roll time, grants Brutality's
 * bonus damage (see rollCriticalBonusDamage) - but at most once per attack,
 * regardless of how many of the two d20s ended up critical (a natural
 * critical already granted it immediately at roll time - see
 * helpers/actions.mjs#rollWeaponItem/rollMartialArtsAttack and
 * helpers/spell-rolls.mjs#renderSpellEffectParts - in which case
 * data-brutal-applied is already "true" here).
 * @param {HTMLElement} button
 * @return {Promise<ChatMessage|void>}
 */
export async function resolveHitEvaluationFromChat(button) {
  const targets = Array.from(game.user.targets ?? []);
  const controlled = game.user.isGM ? (canvas.tokens?.controlled ?? []) : [];
  const defender = targets[0]?.actor ?? controlled[0]?.actor ?? game.user.character;
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const attacker = button.dataset.attackerUuid ? await fromUuid(button.dataset.attackerUuid) : null;
  const dieSizes = (button.dataset.damageDieSizes || '').split(',').filter(Boolean).map(Number);
  let brutalApplied = button.dataset.brutalApplied === 'true';

  const comparisonType = button.dataset.comparisonType;
  const statValue = comparisonType === 'magicResistance' ? defender.system.magicResistance : defender.system.armorClass;
  const statLabel = game.i18n.localize(comparisonType === 'magicResistance' ? 'SKSK.Resource.MR' : 'SKSK.Resource.AC');

  const renderLine = async (rollTotal, rollLabel, initialCriticalType) => {
    let criticalType = initialCriticalType;
    const hit = resolveCheckSuccess(rollTotal, statValue, criticalType);
    let extraHTML = '';

    if (criticalType === null && hit) {
      const precision = await maybeRollPrecision(attacker, true);
      if (precision) {
        const precisionRendered = wrapCriticalBlock(await precision.roll.render(), precision.success ? 'success' : null);
        extraHTML += `<div class="sksk-roll-line">${game.i18n.localize('SKSK.AttackRoll.PrecisionRoll')}</div>${precisionRendered}`;
        if (precision.success) criticalType = 'success';
      }
    }

    if (criticalType === 'success' && !brutalApplied) {
      brutalApplied = true;
      const bonusRoll = await rollCriticalBonusDamage(attacker, dieSizes);
      if (bonusRoll) {
        extraHTML += `<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.AttackRoll.CriticalBonusDamage')}</strong></div>${await bonusRoll.render()}`;
      }
    }

    const outcomeKey = criticalType === 'success' ? 'SKSK.AttackRoll.CriticalHit'
      : criticalType === 'failure' ? 'SKSK.AttackRoll.CriticalMiss'
      : hit ? 'SKSK.AttackRoll.Hit' : 'SKSK.AttackRoll.Miss';
    const outcome = wrapCriticalInline(game.i18n.localize(outcomeKey), criticalType);
    return `<div class="sksk-roll-line">${game.i18n.format('SKSK.AttackRoll.EvaluationLine', {
      label: rollLabel, total: rollTotal, statLabel, statValue, outcome,
    })}</div>${extraHTML}`;
  };

  const content = `<div class="sksk-chat-card sksk-action-card">`
    + (await renderLine(Number(button.dataset.rollA), game.i18n.localize('SKSK.AttackRoll.RollA'), button.dataset.critA || null))
    + (await renderLine(Number(button.dataset.rollB), game.i18n.localize('SKSK.AttackRoll.RollB'), button.dataset.critB || null))
    + `</div>`;

  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: game.i18n.format('SKSK.AttackRoll.EvaluationTitle', { defender: defender.name }),
    content,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}
