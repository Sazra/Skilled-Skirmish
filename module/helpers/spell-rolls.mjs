import {
  computeDamageBonus, computeSavingThrowValue, computeSavingThrowBonusSum, computeSpellManaCost, computeSpellApCost,
  computeRitualHours, computeMaxOverchargeCount, computeOverchargedRanges, computeExtraManaCostSum,
  getOverchargeSettings, formatOverchargeDuration, resolveSpellStatusStacks, isSpellFoundryEffectActive,
  computeMaxExtraCostTier, normalizeExtraCostCounts, computeCombinedSpellFpTargets,
  computeExtraCostEffects, computeExtraUpkeep, isSavingThrowActive, computeEffectiveRanges, formatRangeLabel,
  getSpellElementOptions, resolveSpellDamages, getSpellSchool, SPELL_BARRIER, getSpellDurationMultiplier,
} from './spells.mjs';
import { rollExtraDamage, consumeUsedEffects } from './extraDamage.mjs';
import { isAbilitySpellCopy } from './abilitySpell.mjs';
import { promptMetamagicChoice, placeMetamagicMarker, scaleDurationText } from './metamagic.mjs';
import { recommendRollMode, recommendSaveMode, recommendAttackMode } from './rollRecommendation.mjs';
import {
  detectSpellVariants, createVariantItem, renderVariantLines, consumeVariantMarkers, variantAttribute,
} from './spellVariants.mjs';
import { getActorSkillLevel, getSkillLabel } from './skills.mjs';
import {
  applyD20Malus, canCastMovementSpell, getStatusStacks, setStatusStacks, payManaCost, negativeLifeOverflowHTML,
  isActorsOwnTurn, isCombatActive,
} from './statusEffects.mjs';
import {
  computeSpellAttackBonus, rollAttackPair, renderAttackPairHTML, getDamageDieSizes,
  autoResolveAttackForTargets, greyOutManualEvalButtons, stripRerollButton,
} from './attackRolls.mjs';
import {
  resolveCheckSuccess, wrapCriticalBlock, wrapCriticalInline, chooseGenericRollMode, evaluateD20WithMode,
} from './criticalRolls.mjs';
import { grantSkillUsageFp, formatSkillFpGrantLine, grantFlatSkillFp, checkReflexActionTrigger, getSkillFpRate } from './skillFp.mjs';
import { registerElementalCharge } from './elementalCharges.mjs';
import { getElementalAirRangeBonus } from './elementalChargeEffects.mjs';
import { getManaAlternativeResources, computeManaAlternativeCoverage, payWithManaAlternative } from './customResources.mjs';
import { renderApplyDamageButton, resolveClickDefender, resolveClickRoller, applySpellEffectGroup } from './damageApplication.mjs';
import {
  consumePrimedTechnique, applyTechniqueBonusDamage, applyTechniqueDiceIncrease,
  getTechniqueEffectPayload, renderTechniqueSavingThrowHTML,
} from './technique-rolls.mjs';
import { formatRollCardHeading } from './rollCard.mjs';
import { computePassiveManaRegenPerSegment } from './rest.mjs';
import { wrapRerollIcons } from './luck.mjs';
import { hasEffectiveProperty } from './weaponProperties.mjs';
import { isAreaSpell } from './reactions.mjs';
import {
  hasRollTwiceSpell, rollPossiblyDoubledDamage, renderDamageRerollOnesIcon, wrapDamageBlock,
} from './damageReroll.mjs';

// A Combat round is 6 seconds (see helpers/criticalRolls.mjs and the
// Combat turn-start hooks in statusEffects.mjs), so a "minutes"-unit
// spell's own value converts to this many Combat rounds per minute - see
// rollSpellItem/handlePendingSpellTurnStart.
const ROUNDS_PER_MINUTE = 10;

// The most times one Shift+Click cast may repeat a spell (outside Combat).
const MAX_MULTI_CAST = 20;

/**
 * The template ActiveEffect behind one of a Spell's foundryEffects entries
 * (its effectId): normally hosted on the spell item itself, or - for a
 * spell set up before templates moved onto the item - on the caster's
 * actor.
 * @param {Item} item
 * @param {string} effectId
 * @return {ActiveEffect|null}
 */
export function getSpellEffectTemplate(item, effectId) {
  if (!effectId) return null;
  return item.effects.get(effectId) ?? item.actor?.effects.get(effectId) ?? null;
}

/**
 * Create (if none exists yet) one of a Spell's own foundryEffects entries'
 * linked ActiveEffect, initially disabled - lives as a template on the
 * spell item itself, copied onto whoever it lands on at apply time (see
 * helpers/damageApplication.mjs#applySpellEffectGroup), same bind-then-
 * toggle pattern as helpers/technique-rolls.mjs#ensureLinkedEffect. A no-op
 * (returns "") if the spell isn't owned by an actor - nothing to host the
 * template effect.
 * @param {Item} item
 * @param {number} index   Index into item.system.foundryEffects.
 * @return {Promise<string>}
 */
export async function ensureLinkedSpellEffect(item, index) {
  const entry = item.system.foundryEffects[index];
  if (!entry) return '';
  if (entry.effectId && getSpellEffectTemplate(item, entry.effectId)) return entry.effectId;

  // The template lives on the SPELL ITEM itself (never transferred to its
  // owner - it only ever serves as a copy source), so it can be edited
  // before the spell is owned by anyone. Templates an older version bound
  // on the caster's actor keep working, see getSpellEffectTemplate.
  const [effect] = await item.createEmbeddedDocuments('ActiveEffect', [{
    name: entry.name || item.name,
    img: item.img || 'icons/svg/aura.svg',
    origin: item.uuid,
    disabled: true,
    transfer: false,
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
 * Prompt for a spell cast's optional modifiers - Überladen (Overcharge)
 * count, an "Es kann mehr Mana gezahlt werden" extra-cost tier, and/or a
 * custom resource to spend instead of Mana - all in one Shift+Click dialog,
 * matching helpers/attackRolls.mjs#chooseAttackMode's own one-click
 * DialogV2.wait pattern (a button's own callback resolves the promise
 * directly; rejectClose:false so closing without choosing aborts the cast
 * entirely, same as closing that mode dialog aborts an Evaluate click).
 *
 * One button per Überladen count from 1 to computeMaxOverchargeCount(actor),
 * plus a leading "cast without Überladen" button (overchargeCount 0) - so
 * the dialog's other choices (extra-cost tier, alternative resource) can be
 * used without also overcharging.
 *
 * If the spell defines any extra-cost tiers (data/spell.mjs#extraManaCosts),
 * the dialog also offers a <select> for which cumulative tier to pay (0 =
 * none) - each option shows the running total extra Mana cost (see
 * computeExtraManaCostSum). If the actor has any custom resource flagged
 * usable instead of Mana for spells (data/actor-base.mjs#customResources.
 * isManaAlternative, see helpers/customResources.mjs#
 * getManaAlternativeResources), the dialog also offers a <select> for which
 * one to spend - each option previews how many of its own points would be
 * spent to cover this spell's BASE Mana cost (no Überladen/extra-cost tier
 * factored in - a representative preview, not a live recalculation; the
 * actual amount spent at cast time is always computed against the final
 * cost, see rollSpellItem). Whichever button is clicked, its callback reads
 * every <select>'s CURRENT value off the button's own owning form (DialogV2
 * wraps its content+footer in one <form>, so button.form reaches it) - one
 * click commits every choice together, there being only the one row of
 * buttons.
 * @param {Actor} actor
 * @param {Item} item   The spell item, for the dialog's own title.
 * @return {Promise<{overchargeCount: number, extraCostTier: number, altResourceIndex: number}|null>}
 *   altResourceIndex is -1 for "none". null/undefined if the dialog was
 *   closed without picking an option - the caller should abort.
 */
export async function chooseSpellCastOptions(actor, item) {
  const max = computeMaxOverchargeCount(actor);
  const extraTiers = item.system.extraManaCosts ?? [];
  const hasExtraTiers = extraTiers.length > 0;
  const altResources = getManaAlternativeResources(actor, 'spells');
  const hasAltResources = altResources.length > 0;

  let extraCostFieldHTML = '';
  if (hasExtraTiers) {
    const options = [`<option value="0">${game.i18n.localize('SKSK.Spell.Roll.ExtraCostNone')}</option>`];
    extraTiers.forEach((tierEntry, index) => {
      const tier = index + 1;
      const sum = computeExtraManaCostSum(item.system, tier);
      const label = tierEntry.label || game.i18n.format('SKSK.Spell.ExtraManaCost.Numbered', { number: tier });
      options.push(`<option value="${tier}">${label} (+${sum})</option>`);
    });
    extraCostFieldHTML = `<div class="form-group">
      <label>${game.i18n.localize('SKSK.Spell.Roll.ExtraCostLabel')}</label>
      <select name="extraCostTier">${options.join('')}</select>
    </div>`;
    // One count input per repeatable step ("kann mehrfach gewählt werden"),
    // shown only while the chosen tier reaches that step (see the render
    // hook below).
    extraTiers.forEach((tierEntry, index) => {
      if (!tierEntry.repeatable) return;
      const stepLabel = tierEntry.label || game.i18n.format('SKSK.Spell.ExtraManaCost.Numbered', { number: index + 1 });
      const maxRepeats = Math.max(1, tierEntry.maxRepeats ?? 1);
      extraCostFieldHTML += `<div class="form-group" data-extra-step="${index + 1}" style="display:none">
        <label>${game.i18n.format('SKSK.Spell.Roll.ExtraCostRepeatLabel', { label: stepLabel, max: maxRepeats })}</label>
        <input type="number" name="extraCostCount${index}" value="1" min="1" max="${maxRepeats}" step="1" />
      </div>`;
    });
  }

  // A "?" Mana cost: ask for the base amount right here too (otherwise
  // rollSpellItem asks on its own).
  const isVariable = !!item.system.manaCostVariable;
  const variableDefault = Math.max(1, item.system.variableManaPaid || 1);
  const variableFieldHTML = isVariable
    ? `<div class="form-group">
      <label>${game.i18n.localize('SKSK.Spell.Roll.VariableManaLabel')}</label>
      <input type="number" name="variableMana" value="${variableDefault}" min="0" step="1" autofocus />
    </div>`
    : '';

  // Outside Combat a spell may be cast several times in one go (one compact
  // chat card, see rollSpellItem) - every cast pays its own costs, the
  // Überladen/extra-cost/variable-Mana choices below apply to all of them.
  const canMulti = canCastSpellMultiple(item);
  const castCountFieldHTML = canMulti
    ? `<div class="form-group">
      <label title="${game.i18n.localize('SKSK.Spell.Roll.MultiCastHint')}">${game.i18n.localize('SKSK.Spell.Roll.MultiCastLabel')}</label>
      <input type="number" name="castCount" value="1" min="1" max="${MAX_MULTI_CAST}" step="1" />
    </div>`
    : '';
  const readCastCount = (form) => (canMulti
    ? Math.max(1, Math.min(MAX_MULTI_CAST, Math.floor(Number(form?.elements?.castCount?.value ?? 1)) || 1))
    : 1);

  let altResourceFieldHTML = '';
  if (hasAltResources) {
    const baseManaCost = computeSpellManaCost(item.system, actor, 0, 0, [], isVariable ? variableDefault : null).cost;
    const options = [`<option value="-1">${game.i18n.localize('SKSK.Spell.Roll.AltResourceNone')}</option>`];
    for (const { index, resource } of altResources) {
      const { resourcePointsSpent, manaCovered } = computeManaAlternativeCoverage(resource, baseManaCost, item.system.spellLevel);
      const name = resource.name || resource.abbreviation;
      const preview = game.i18n.format('SKSK.Spell.Roll.AltResourcePreview', { spent: resourcePointsSpent, covered: manaCovered });
      options.push(`<option value="${index}">${name} (${preview})</option>`);
    }
    altResourceFieldHTML = `<div class="form-group">
      <label>${game.i18n.localize('SKSK.Spell.Roll.AltResourceLabel')}</label>
      <select name="altResourceIndex">${options.join('')}</select>
    </div>`;
  }

  const readChoice = (overchargeCount) => (event, button) => {
    const extraCostTier = hasExtraTiers ? Number(button.form?.elements?.extraCostTier?.value ?? 0) : 0;
    // Only steps the chosen tier actually reaches can be repeated.
    const extraCostCounts = extraTiers.map((tierEntry, index) => {
      if (!tierEntry.repeatable || extraCostTier < index + 1) return 1;
      return Number(button.form?.elements?.[`extraCostCount${index}`]?.value ?? 1);
    });
    return {
    overchargeCount,
    extraCostTier,
    variableMana: isVariable ? Math.max(0, Math.floor(Number(button.form?.elements?.variableMana?.value ?? variableDefault)) || 0) : null,
    extraCostCounts: normalizeExtraCostCounts(item.system, extraCostCounts),
    altResourceIndex: hasAltResources ? Number(button.form?.elements?.altResourceIndex?.value ?? -1) : -1,
    castCount: readCastCount(button.form),
    };
  };

  const buttonLabels = [game.i18n.localize('SKSK.Spell.Roll.CastWithoutOvercharge')];
  for (let count = 1; count <= max; count++) buttonLabels.push(game.i18n.format('SKSK.Spell.Roll.OverchargeCount', { count }));
  const buttons = [{
    action: 'noOvercharge',
    label: buttonLabels[0],
    callback: readChoice(0),
  }];
  for (let count = 1; count <= max; count++) {
    buttons.push({
      action: `overcharge${count}`,
      label: buttonLabels[count],
      callback: readChoice(count),
    });
  }
  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format('SKSK.Spell.Roll.OverchargeTitle', { name: item.name }) },
    content: `<p>${game.i18n.localize('SKSK.Spell.Roll.ChooseOverchargePrompt')}</p>${variableFieldHTML}${castCountFieldHTML}${extraCostFieldHTML}${altResourceFieldHTML}`,
    buttons,
    render: (event, dialog) => {
      const root = dialog?.element ?? event?.target?.element;
      if (!root?.querySelector) return;
      const tierSelect = root.querySelector('select[name="extraCostTier"]');
      const variableInput = root.querySelector('input[name="variableMana"]');
      // Re-reads the whole form: shows/hides the repeat counts of the steps
      // the chosen tier reaches, and updates every button's own Mana cost
      // plus every alternative resource's own points for each possible
      // number of Überladungen (the cast buttons only pick that number).
      const sync = () => {
        const tier = tierSelect ? Number(tierSelect.value) || 0 : 0;
        root.querySelectorAll('[data-extra-step]').forEach(row => {
          row.style.display = tier >= Number(row.dataset.extraStep) ? '' : 'none';
        });
        const counts = normalizeExtraCostCounts(item.system, extraTiers.map((entry, index) => (
          entry.repeatable && tier >= index + 1 ? Number(root.querySelector(`input[name="extraCostCount${index}"]`)?.value ?? 1) : 1
        )));
        const mana = isVariable ? Math.max(0, Math.floor(Number(variableInput?.value)) || 0) : null;
        const costFor = (n) => computeSpellManaCost(item.system, actor, n, tier, counts, mana).cost;
        const casts = canMulti
          ? Math.max(1, Math.min(MAX_MULTI_CAST, Math.floor(Number(root.querySelector('input[name="castCount"]')?.value)) || 1))
          : 1;
        for (let n = 0; n <= max; n++) {
          const button = root.querySelector(`button[data-action="${n ? `overcharge${n}` : 'noOvercharge'}"]`);
          if (!button) continue;
          const cost = costFor(n);
          button.textContent = casts > 1
            ? `${buttonLabels[n]} (${casts}× ${cost} = ${cost * casts} Mana)`
            : `${buttonLabels[n]} (${cost} Mana)`;
        }
        root.querySelectorAll('select[name="altResourceIndex"] option').forEach(option => {
          const found = altResources.find(entry => String(entry.index) === option.value);
          if (!found) return;
          const points = [];
          for (let n = 0; n <= max; n++) {
            points.push(`${n}×: ${computeManaAlternativeCoverage(found.resource, costFor(n), item.system.spellLevel).resourcePointsSpent}`);
          }
          option.textContent = `${found.resource.name || found.resource.abbreviation} (${points.join(' | ')})`;
        });
      };
      root.addEventListener('input', sync);
      root.addEventListener('change', sync);
      sync();
    },
    rejectClose: false,
  });
}

/**
 * Ask how many AP a "?"-AP-cost spell (data/spell.mjs#apCostVariable)
 * should cost this time (never below its apCostMin).
 * @param {Item} item
 * @return {Promise<number|null>}   null if the prompt was closed/cancelled.
 */
async function promptVariableAp(item) {
  const min = Math.max(0, item.system.apCostMin ?? 0);
  const fallback = Math.max(min, item.system.variableApPaid || min, 1);
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format('SKSK.Spell.Roll.VariableApTitle', { name: item.name }) },
    content: `<div class="form-group">
      <label>${game.i18n.format('SKSK.Spell.Roll.VariableApLabel', { min })}</label>
      <input type="number" name="variableAp" value="${fallback}" min="${min}" step="1" autofocus />
    </div>`,
    ok: {
      label: game.i18n.localize('SKSK.Spell.Roll.VariableManaConfirm'),
      callback: (event, button) => Number(button.form?.elements?.variableAp?.value ?? fallback),
    },
    rejectClose: false,
  });
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(min, Math.floor(value));
}

/**
 * Ask how much Mana a "?"-cost spell (data/spell.mjs#manaCostVariable)
 * should cost this time.
 * @param {Item} item
 * @return {Promise<number|null>}   null if the prompt was closed/cancelled.
 */
async function promptVariableMana(item) {
  const fallback = Math.max(1, item.system.variableManaPaid || 1);
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format('SKSK.Spell.Roll.VariableManaTitle', { name: item.name }) },
    content: `<div class="form-group">
      <label>${game.i18n.localize('SKSK.Spell.Roll.VariableManaLabel')}</label>
      <input type="number" name="variableMana" value="${fallback}" min="0" step="1" autofocus />
    </div>`,
    ok: {
      label: game.i18n.localize('SKSK.Spell.Roll.VariableManaConfirm'),
      callback: (event, button) => Number(button.form?.elements?.variableMana?.value ?? fallback),
    },
    rejectClose: false,
  });
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(0, Math.floor(value));
}

/**
 * Let the caster pick the element of a spell with an element choice
 * (data/spell.mjs#elementChoice, mode "choice") - one of its allowed
 * elements, or - if the spell allows it - "random" (rolled for every cast).
 * @param {Item} item
 * @return {Promise<string|null>}   An element key, "random", or null if the
 *   prompt was closed/cancelled.
 */
async function promptSpellElement(item) {
  const options = getSpellElementOptions(item.system);
  const allowRandom = !!item.system.elementChoice?.allowRandom;
  const optionHTML = [
    ...(allowRandom ? [`<option value="random">${game.i18n.format('SKSK.Spell.Element.RandomOption', { count: options.length })}</option>`] : []),
    ...options.map(key => `<option value="${key}">${game.i18n.localize(CONFIG.SKSK.damageTypes[key] ?? key)}</option>`),
  ].join('');
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format('SKSK.Spell.Element.PromptTitle', { name: item.name }) },
    content: `<div class="form-group">
      <label>${game.i18n.localize('SKSK.Spell.Element.PromptLabel')}</label>
      <select name="element" autofocus>${optionHTML}</select>
    </div>`,
    ok: {
      label: game.i18n.localize('SKSK.Spell.Element.PromptConfirm'),
      callback: (event, button) => button.form?.elements?.element?.value ?? null,
    },
    rejectClose: false,
  });
  return value || null;
}

/**
 * The element of ONE cast of a spell with an element choice: the picked one,
 * or - for mode "random" / a picked "random" - a 1dN roll over the allowed
 * elements (N = how many there are, in CONFIG.SKSK.damageTypes order).
 * @param {Item} item
 * @param {string|null} pick   An element key, "random" or null (no choice).
 * @return {Promise<{element: string|null, html: string}>}   html: the chat
 *   lines announcing the element (and the roll, if one was made).
 */
async function resolveCastElement(item, pick) {
  const options = getSpellElementOptions(item.system);
  if (!options.length) return { element: null, html: '' };
  let element = options.includes(pick) ? pick : null;
  let rollHTML = '';
  if (!element) {
    const roll = await new Roll(`1d${options.length}`).evaluate();
    element = options[roll.total - 1];
    rollHTML = await roll.render();
  }
  const label = game.i18n.localize(CONFIG.SKSK.damageTypes[element] ?? element);
  const line = `<div class="sksk-roll-line sksk-roll-element"><strong>${game.i18n.localize('SKSK.Spell.Element.Label')}:</strong> ${label}</div>`;
  return { element, html: rollHTML + line };
}

/**
 * Ask how much Unterhalt a "?"-upkeep spell (data/spell.mjs#upkeepVariable)
 * should cost while it is sustained this time.
 * @param {Item} item
 * @return {Promise<number|null>}   null if the prompt was closed/cancelled.
 */
async function promptVariableUpkeep(item) {
  const fallback = Math.max(1, item.system.variableUpkeepPaid || 1);
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format('SKSK.Spell.UpkeepVariableTitle', { name: item.name }) },
    content: `<div class="form-group">
      <label>${game.i18n.localize('SKSK.Spell.UpkeepVariableLabel')}</label>
      <input type="number" name="variableUpkeep" value="${fallback}" min="0" step="1" autofocus />
    </div>`,
    ok: {
      label: game.i18n.localize('SKSK.Spell.UpkeepVariableConfirm'),
      callback: (event, button) => Number(button.form?.elements?.variableUpkeep?.value ?? fallback),
    },
    rejectClose: false,
  });
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(0, Math.floor(value));
}

/**
 * Switch a spell's "sustaining" flag on or off (the Spells tab's quick
 * toggle and the item sheet's checkbox both come through here). For a "?"
 * Unterhalt (data/spell.mjs#upkeepVariable) switching it ON asks for the
 * amount first - closing the prompt leaves the spell as it was.
 * @param {Item} item
 * @param {boolean} [sustaining]   The wanted state; defaults to toggling.
 * @return {Promise<boolean>}   Whether the flag was changed.
 */
export async function setSpellSustaining(item, sustaining = !item.system.sustaining) {
  const update = { 'system.sustaining': sustaining };
  if (sustaining && item.system.upkeepVariable) {
    const amount = await promptVariableUpkeep(item);
    if (amount === null) return false;
    update['system.variableUpkeepPaid'] = amount;
  }
  await item.update(update);
  return true;
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
 * Tödliche Magie's own "roll twice, take the better total" (helpers/
 * damageReroll.mjs#hasRollTwiceSpell) applies to the roll itself, before
 * Überladen's own scaling; Elementexperte's own Reroll-Ones icon captures
 * that scaling as its own postAdjust (so a reroll re-scales correctly
 * too) - but NOT a technique's own bonus, which rollDamageWithTechnique
 * below adds only AFTER this function returns, for the first damage
 * entry rolled only; a reroll used on that specific entry would omit it.
 * Accepted as a deliberately narrow gap (Technique-consumption AND an
 * Elementexperte reroll on that exact entry, in the same cast) rather
 * than threading that late adjustment back through this function too.
 * @return {Promise<{html: string, entry: {damageType: string, amount: number}}>}
 */
async function renderDamageRoll(damage, actor, overchargeCount = 0, spellSystem = null, technique = null, source = null) {
  const isBarrier = damage.damageType === SPELL_BARRIER;
  const bonus = computeDamageBonus(damage, actor, spellSystem);
  const formulaBase = bonus ? `${damage.formula} + ${bonus}` : damage.formula;
  const formula = applyTechniqueDiceIncrease(formulaBase, technique);
  // rollData exposes the actor's custom resources (see actor-base.mjs#
  // getRollData) as "@<abbreviation>", usable directly in the formula.
  const rollTwice = hasRollTwiceSpell(actor);
  // A Barrier entry may use the Mana paid for the spell (@mana) and the
  // caster's passive Mana regeneration (@manaRegen) in its formula.
  const rollData = actor?.getRollData();
  if (isBarrier && rollData) {
    rollData.mana = source?.mana ?? 0;
    rollData.manaRegen = Math.max(0, computePassiveManaRegenPerSegment(actor));
  }
  const { total: rollTotal, html: rendered, pickedRoll } = await rollPossiblyDoubledDamage(formula, rollData, rollTwice);
  const typeLabel = game.i18n.localize(isBarrier ? 'SKSK.Barrier.DamageType' : (CONFIG.SKSK.damageTypes[damage.damageType] ?? damage.damageType));
  // A Spell with its own "ignores Barrier" switch tags every damage entry it
  // produces - see helpers/damageApplication.mjs#applyResolvedDamageEntries.
  const barrierFlag = spellSystem?.ignoresBarrier ? { ignoresBarrier: true } : {};
  let amount = rollTotal;
  let overchargeHTML = '';
  const overchargeMultiplier = overchargeCount > 0
    ? (100 + getOverchargeSettings(spellSystem).damagePercent * overchargeCount) / 100 : null;
  if (overchargeMultiplier) {
    amount = Math.floor(amount * overchargeMultiplier);
    overchargeHTML = `<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.OverchargeDamage', { amount })}</div>`;
  }
  const postAdjust = overchargeMultiplier ? { type: 'multiplier', value: overchargeMultiplier } : { type: 'delta', value: 0 };
  const blockId = foundry.utils.randomID();
  const rerollOnesIcon = actor && !isBarrier ? renderDamageRerollOnesIcon(actor, damage.damageType, pickedRoll, blockId, postAdjust) : '';
  const html = wrapDamageBlock(blockId,
    `<div class="sksk-roll-damage"><strong>${isBarrier ? typeLabel : `${typeLabel} ${game.i18n.localize('SKSK.Spell.Roll.Damage')}`}</strong>${wrapRerollIcons(rerollOnesIcon)}</div>${rendered}${overchargeHTML}`
  );
  if (isBarrier) {
    // Barrier granted instead of damage (helpers/barrier.mjs): the entry
    // carries what the Apply button needs to grant it.
    const barrier = {
      stackable: !!damage.barrierStackable,
      value: damage.barrierDuration ?? 0,
      units: damage.barrierDurationUnit ?? 'rounds',
      name: source?.name ?? '',
      origin: source?.uuid ?? null,
    };
    return { html, entry: { damageType: 'barrier', amount, barrier } };
  }
  return { html, entry: { damageType: damage.damageType, amount, ...barrierFlag } };
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
async function rollContestCasterRoll(save, actor, dcBonus = 0) {
  const bonus = computeSavingThrowBonusSum(save, actor) + dcBonus;
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
 * @param {number} [dcBonus=0]   DC change from paid extra-cost steps.
 * @return {Promise<string>}
 */
async function renderSavingThrowButton(save, index, item, overchargeCount = 0, dcBonus = 0) {
  const label = save.label || game.i18n.format('SKSK.Spell.SavingThrow.Numbered', { number: index + 1 });
  if (save.contest) {
    const casterRoll = await rollContestCasterRoll(save, item.actor, dcBonus);
    const rollHTML = await casterRoll.roll.render();
    return `<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ContestCasterRoll', { label })}</div>${rollHTML}
    <button type="button" class="sksk-roll-save" data-action="rollSavingThrow"
      data-item-uuid="${item.uuid}" data-save-index="${index}" data-overcharge="${overchargeCount}" data-dc-bonus="${dcBonus}" data-variants="${variantAttribute(item)}" data-contest-total="${casterRoll.total}">
      ${game.i18n.format('SKSK.Spell.Roll.ContestButton', { label, total: casterRoll.total })}
    </button>`;
  }
  const dc = computeSavingThrowValue(save, item.actor, overchargeCount, dcBonus);
  return `<button type="button" class="sksk-roll-save" data-action="rollSavingThrow"
    data-item-uuid="${item.uuid}" data-save-index="${index}" data-overcharge="${overchargeCount}" data-dc-bonus="${dcBonus}" data-variants="${variantAttribute(item)}">
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
async function postSpellChatCard(item, parts, flavor = item.name) {
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: item.actor }),
    flavor,
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
 * @param {number[]} [extraCostCounts=[]]   Repeat count per extra-cost
 *   step (see helpers/spells.mjs#normalizeExtraCostCounts).
 * @param {number|null} [variableMana=null]   Base Mana chosen for a "?"
 *   cost spell (scales its ranges, see helpers/spells.mjs#computeEffectiveRanges).
 * @param {number} [extraCostTier=0]   Which "Es kann mehr Mana gezahlt
 *   werden" tier was paid (see data/spell.mjs#extraManaCosts) - gates any
 *   damages entry whose trigger is "extraCost" (see the "extraCost" damage
 *   loop below), independent of overchargeAutoEffects.
 * @return {Promise<string[]>}
 */
async function renderSpellEffectParts(item, overchargeCount = 0, extraCostTier = 0, extraCostCounts = [], variableMana = null, element = null) {
  const actor = item.actor;
  const system = item.system;
  const parts = [];
  // The Damage entries with this cast's element filled in for "Gewähltes
  // Element" (see helpers/spells.mjs#resolveSpellDamages).
  // A Barrier entry (SPELL_BARRIER) is never attack- or save-gated: it is
  // granted unconditionally, or by a paid extra-cost step.
  const damages = resolveSpellDamages(system.damages, element, system)
    .map(damage => (damage.damageType === SPELL_BARRIER && damage.trigger !== 'extraCost' ? { ...damage, trigger: 'unconditional' } : damage));
  // This spell's own Überladen rules (data/spell.mjs#overcharge): the
  // DC/range/damage scaling only applies in "scaling" mode (and with the
  // auto-effects switch on) - in "extraAttack" mode each Überladung is one
  // more attack instead (see the attack section below).
  const oc = getOverchargeSettings(system);
  const effectiveOvercharge = system.overchargeAutoEffects !== false && oc.effect === 'scaling' ? overchargeCount : 0;
  const ocDc = effectiveOvercharge * oc.dcBonus;
  // What the paid extra-cost steps change besides the cost: additional
  // attacks, saving-throw DCs (ranges: see the range line below).
  const castFx = computeExtraCostEffects(system, extraCostTier, extraCostCounts);
  const baseAttackCount = (system.attackRoll.enabled ? system.attackRoll.count : 0) + castFx.extraAttacks;
  // Only a spell that attacks at all gets the extra Überladungs-Angriffe.
  const overchargeAttackCount = oc.effect === 'extraAttack' && baseAttackCount > 0 ? overchargeCount : 0;
  const attackCount = baseAttackCount + overchargeAttackCount;
  const attacksEnabled = attackCount > 0;
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

  // Zusatzschaden from Active Effects (helpers/extraDamage.mjs): rolled once
  // per damage entry, as its own roll + entries.
  const usedEffects = new Set();
  const dealtTypes = new Set();
  let damageRolled = false;
  const extraSchool = system.spellType === 'systemless' ? null : getSpellSchool(system);
  // Reflektierend (Reflective armor) only reflects the damage of real spells -
  // not that of an ability's effect spell (see helpers/abilitySpell.mjs).
  const reflectFlag = actor && !isAbilitySpellCopy(item) ? { reflectable: true } : {};
  const rollDamageWithTechnique = async (damage) => {
    // A Barrier entry is no damage: no technique bonus, no extra damage, and
    // it does not count as "an attack/damage was rolled" for "Bis Nutzung".
    if (damage.damageType === SPELL_BARRIER) {
      const barrierRoll = await renderDamageRoll(damage, actor, effectiveOvercharge, system, null, {
        name: item.name, uuid: item.uuid,
        mana: system.manaCostVariable ? Math.max(0, Number(variableMana ?? system.variableManaPaid ?? 0) || 0) : (system.manaCost ?? 0),
      });
      return { html: barrierRoll.html, entry: barrierRoll.entry, extras: [] };
    }
    const applyTech = technique && !techniqueDamageApplied;
    const { html, entry } = await renderDamageRoll(damage, actor, effectiveOvercharge, system, applyTech ? technique : null);
    Object.assign(entry, reflectFlag);
    let fullHTML = html;
    if (applyTech) {
      const adjusted = await applyTechniqueBonusDamage(entry.amount, technique, actor?.getRollData());
      entry.amount = adjusted.total;
      techniqueDamageApplied = true;
      fullHTML = html + adjusted.line;
    }
    damageRolled = true;
    dealtTypes.add(entry.damageType);
    const extra = await rollExtraDamage(actor, { kind: 'spell', damageType: entry.damageType, school: extraSchool }, {
      entryFlags: { ...(system.ignoresBarrier ? { ignoresBarrier: true } : {}), ...reflectFlag }, used: usedEffects,
    });
    return { html: fullHTML + extra.html, entry, extras: extra.entries };
  };

  if (overchargeCount > 0) {
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.format('SKSK.Spell.Roll.OverchargeActive', { count: overchargeCount })}</strong></div>`);
  }
  if (extraCostTier > 0) {
    const tierEntry = system.extraManaCosts?.[extraCostTier - 1];
    const tierLabel = tierEntry?.label || game.i18n.format('SKSK.Spell.ExtraManaCost.Numbered', { number: extraCostTier });
    const sum = computeExtraManaCostSum(system, extraCostTier, extraCostCounts);
    const used = normalizeExtraCostCounts(system, extraCostCounts);
    const repeated = (system.extraManaCosts ?? [])
      .map((entry, index) => ({ entry, index, count: used[index] }))
      .filter(({ index, count }) => index < extraCostTier && count > 1)
      .map(({ entry, index, count }) => `${entry.label || game.i18n.format('SKSK.Spell.ExtraManaCost.Numbered', { number: index + 1 })} ×${count}`);
    const fullLabel = repeated.length ? `${tierLabel} (${repeated.join(', ')})` : tierLabel;
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.format('SKSK.Spell.Roll.ExtraCostActive', { label: fullLabel, amount: sum })}</strong></div>`);
  }
  if (effectiveOvercharge > 0 && system.ranges?.length) {
    // The Elementarist ability's own Luft-Ladungen bonus (helpers/
    // elementalChargeEffects.mjs) applies on top of Überladen's own
    // percentage scaling, not before it.
    const airChargeBonus = actor ? getElementalAirRangeBonus(actor) : 0;
    const rangeLabel = computeOverchargedRanges(computeEffectiveRanges(system, extraCostTier, extraCostCounts, variableMana), effectiveOvercharge, oc)
      .map(r => formatRangeLabel(r, airChargeBonus))
      .join(', ');
    parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.OverchargeRanges', { ranges: rangeLabel })}</div>`);
  }
  if (overchargeCount > 0 && oc.durationText) {
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.Spell.Roll.OverchargeDuration')}:</strong> ${formatOverchargeDuration(oc.durationText, overchargeCount)}</div>`);
  }

  if (actor && system.castingMethods?.ritual) {
    const hours = computeRitualHours(system);
    parts.push(formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'ritualism', 'ritualHour', hours)));
  }

  // 9. Angriffswurf, and its own attack-triggered damage right alongside
  // it (one Angriffswurf+Schaden+Apply-Damage group per iteration, for
  // multi-attack spells) - independent of any saving throws below, so a
  // spell may use both an attack roll and a save at once.
  if (attacksEnabled) {
    const attackDamages = damages.filter(d => d.trigger === 'attack');
    const damageDice = attackDamages.map(damage => ({
      damageType: damage.damageType, dieSizes: getDamageDieSizes(damage.formula), ...(system.ignoresBarrier ? { ignoresBarrier: true } : {}),
    }));
    const attackBonus = actor ? computeSpellAttackBonus(system, actor) + (technique?.styleAttackBonus ?? 0) + (technique?.hitBonusAmount ?? 0) : 0;
    for (let i = 1; i <= attackCount; i++) {
      const rolls = await rollAttackPair(attackBonus, actor);
      // The attacks an Überladung adds come last and give no FP.
      const isOverchargeAttack = i > baseAttackCount;
      const rendered = await renderAttackPairHTML(rolls, 'magicResistance', actor, {
        damageDice, bonus: attackBonus, noFp: isOverchargeAttack, isArea: isAreaSpell(system),
        label: isOverchargeAttack
          ? game.i18n.format('SKSK.Spell.Roll.OverchargeAttack', { number: i - baseAttackCount })
          : game.i18n.format('SKSK.Spell.Roll.Attack', { number: i }),
        // Every spell's own attack bonus always includes its Willpower
        // modifier (see computeSpellAttackBonus above), regardless of
        // spellType - so "wil" is the one attribute a Spell-Angriffswurf's
        // own Attribute-Reroll icon ever needs to check.
        attributeKeys: ['wil'],
      });
      const attackBlockIndex = parts.length;
      parts.push(rendered);

      const damageEntries = [];
      for (const damage of attackDamages) {
        const { html, entry, extras } = await rollDamageWithTechnique(damage);
        parts.push(html);
        damageEntries.push(entry, ...extras);
      }
      const techniqueEffect = takeTechniqueEffect();
      const applyButtonIndex = parts.length;
      parts.push(renderApplyDamageButton(actor, damageEntries, null, techniqueEffect, 'magicResistance'));

      // Convenience: if the user has one or more OTHER tokens targeted,
      // resolve this attack against every one of them right away, no
      // manual Evaluate/Apply Damage click needed - see helpers/
      // attackRolls.mjs#autoResolveAttackForTargets. Unlike weapon/Martial
      // Arts attacks, a spell that misses still deals half this damage
      // (rounded up) unless the target's own Verbesserte Magieresistenz
      // switch is on - see that function's own doc comment. The manual
      // buttons above stay in place either way, just visually dimmed once
      // this actually did something.
      if (actor) {
        const autoResolveHTML = await autoResolveAttackForTargets(rolls, 'magicResistance', actor, {
          damageEntries, damageDice, killSkillKey: null, techniqueItemUuid: techniqueEffect?.itemUuid ?? null, noFp: isOverchargeAttack, isArea: isAreaSpell(system),
        });
        if (autoResolveHTML) {
          parts[attackBlockIndex] = stripRerollButton(greyOutManualEvalButtons(parts[attackBlockIndex]));
          parts[applyButtonIndex] = greyOutManualEvalButtons(parts[applyButtonIndex]);
          parts.push(autoResolveHTML);
        }
      }
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
    damages.filter(d => d.trigger === 'save').map(d => d.savingThrowIndex ?? 0)
  )];
  for (const idx of saveIndexesWithDamage) {
    if (!system.savingThrows[idx] || !isSavingThrowActive(system, idx, extraCostTier)) continue;
    parts.push(`<div class="sksk-roll-saves">${await renderSavingThrowButton(system.savingThrows[idx], idx, item, 0, (castFx.dcBonus[idx] ?? 0) + ocDc)}</div>`);
    const saveDamageEntries = [];
    for (const damage of damages.filter(d => d.trigger === 'save' && (d.savingThrowIndex ?? 0) === idx)) {
      const { html, entry, extras } = await rollDamageWithTechnique(damage);
      parts.push(html);
      saveDamageEntries.push(entry, ...extras);
    }
    parts.push(renderApplyDamageButton(actor, saveDamageEntries, null, takeTechniqueEffect()));
  }

  const unconditionalDamageEntries = [];
  for (const damage of damages.filter(d => d.trigger === 'unconditional')) {
    const { html, entry, extras } = await rollDamageWithTechnique(damage);
    parts.push(html);
    unconditionalDamageEntries.push(entry, ...extras);
  }
  parts.push(renderApplyDamageButton(actor, unconditionalDamageEntries, null, takeTechniqueEffect()));

  // 10b. "Es kann mehr Mana gezahlt werden" - damage entries whose trigger
  // is "extraCost" (see data/spell.mjs#damages.extraCostIndex), gated on
  // whichever tier was actually paid at cast time (extraCostTier) -
  // cumulative, so a higher paid tier also rolls every lower-indexed entry
  // (extraCostIndex 0 = tier 1, etc. - see computeExtraManaCostSum's own
  // identical cumulative slicing). Independent of overchargeAutoEffects -
  // the extra cost was paid either way, so its damage always applies.
  // An entry tied to a repeatable step ("kann mehrfach gewählt werden") is
  // rolled once per time that step was chosen - the damage scales with the
  // repeat count just like its Mana cost does.
  const extraCostDamageEntries = [];
  const usedExtraCounts = normalizeExtraCostCounts(system, extraCostCounts);
  for (const damage of damages.filter(d => d.trigger === 'extraCost' && extraCostTier >= (d.extraCostIndex ?? 0) + 1)) {
    const repeats = usedExtraCounts[damage.extraCostIndex ?? 0] ?? 1;
    for (let n = 1; n <= repeats; n++) {
      if (repeats > 1) {
        parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ExtraCostRepeatRoll', { n, total: repeats })}</div>`);
      }
      const { html, entry, extras } = await rollDamageWithTechnique(damage);
      parts.push(html);
      extraCostDamageEntries.push(entry, ...extras);
    }
  }
  parts.push(renderApplyDamageButton(actor, extraCostDamageEntries, null, takeTechniqueEffect()));

  // 11. Status/Foundry effects tied to the attack roll - merged into one
  // "Effekt anwenden" button, separate from the attack's own Apply Damage
  // button(s) above (only relevant if the spell actually has an attack roll).
  if (attacksEnabled) {
    parts.push(renderSpellEffectApplyButtonHTML(item, 'attack', extraCostTier, extraCostCounts, element));
  }

  // 12. Rettungswürfe für Statuseffekte/Foundry-Effekte - one merged,
  // effect-gating button (see renderSpellEffectSaveButtonHTML) per
  // savingThrowIndex actually used by any such entry; multiple entries
  // sharing the same index are merged into that one button. A blank/null
  // savingThrowIndex defaults to 0 - see the identical fallback (and its
  // own comment) on saveIndexesWithDamage above.
  const saveIndexesWithEffects = new Set();
  // Entries gated on an extra-cost step that was not paid don't count.
  for (const [i, entry] of (system.statusEffects ?? []).entries()) {
    if (entry.trigger === 'save' && resolveSpellStatusStacks(system, i, extraCostTier, extraCostCounts) !== null) {
      saveIndexesWithEffects.add(entry.savingThrowIndex ?? 0);
    }
  }
  for (const [i, entry] of (system.foundryEffects ?? []).entries()) {
    if (entry.trigger === 'save' && isSpellFoundryEffectActive(system, i, extraCostTier)) {
      saveIndexesWithEffects.add(entry.savingThrowIndex ?? 0);
    }
  }
  for (const idx of saveIndexesWithEffects) {
    if (!isSavingThrowActive(system, idx, extraCostTier)) continue;
    parts.push(await renderSpellEffectSaveButtonHTML(item, idx, 0, (castFx.dcBonus[idx] ?? 0) + ocDc, extraCostTier, extraCostCounts, element));
  }

  // 12b. A saving throw an extra-cost step makes necessary, with no damage
  // or effect of its own tied to it: still shown as a plain save button.
  const tiedSaveIndexes = new Set([...saveIndexesWithDamage, ...saveIndexesWithEffects]);
  for (const [idx, save] of (system.savingThrows ?? []).entries()) {
    if (save.extraCostIndex === null || save.extraCostIndex === undefined) continue;
    if (tiedSaveIndexes.has(idx) || !isSavingThrowActive(system, idx, extraCostTier)) continue;
    parts.push(`<div class="sksk-roll-saves">${await renderSavingThrowButton(save, idx, item, 0, (castFx.dcBonus[idx] ?? 0) + ocDc)}</div>`);
  }

  // 13. Status/Foundry effects applied unconditionally.
  parts.push(renderSpellEffectApplyButtonHTML(item, 'unconditional', extraCostTier, extraCostCounts, element));

  // "Bis Nutzung": an effect this cast used (an attack/damage was rolled) is
  // removed now - see helpers/extraDamage.mjs#consumeUsedEffects.
  if (actor) {
    parts.push(await consumeUsedEffects(actor, {
      kind: 'spell', school: extraSchool, damageTypes: [...dealtTypes], rolled: attacksEnabled || damageRolled,
    }, usedEffects));
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
 * @param {number} [overchargeCount=0]   How many times to Überladen
 *   (Overcharge) this cast - see helpers/spells.mjs#
 *   computeMaxOverchargeCount/chooseSpellCastOptions below.
 * @param {number} [extraCostTier=0]   Which "Es kann mehr Mana gezahlt
 *   werden" tier to pay this cast (see data/spell.mjs#extraManaCosts) -
 *   chosen via the same dialog as overchargeCount (chooseSpellCastOptions).
 * @param {number} [altResourceIndex=-1]   Index into the actor's own
 *   system.customResources to spend (instead of Mana) toward this cast's
 *   final Mana cost - -1 for none. Whatever the resource doesn't cover
 *   falls back to normal Mana payment. See helpers/customResources.mjs.
 * @param {number[]} [extraCostCounts=[]]
 * @param {number|null} [variableMana=null]
 * @param {number} [castCount=1]   How many times to cast it in a row
 *   (only honoured outside Combat, see canCastSpellMultiple): every cast pays
 *   its own costs and rolls its own effect, all in ONE compact chat card -
 *   without the spell description, just ranges/duration, the costs and
 *   every roll.
 * @param {{name: string, descriptionHTML?: string, pay: function(): Promise<string[]|null>, onPaid?: function(): Promise<void>}|null} [abilityOptions=null]
 *   Set when a Class/Species/Talent ability of the type "once" casts this
 *   (linked) spell as its effect (see helpers/abilityRolls.mjs#useOnceAbility):
 *   the spell's own costs, casting restrictions and prompts are skipped -
 *   `pay` settles the ABILITY's cost instead (null = it could not be paid, the
 *   cast is aborted), `onPaid` runs once after that - and the card carries
 *   the ability's name/description.
 * @return {Promise<ChatMessage|void>}
 */
export async function rollSpellItem(item, overchargeCount = 0, extraCostTier = 0, altResourceIndex = -1, extraCostCounts = [], variableMana = null, castCount = 1, abilityOptions = null) {
  const actor = item.actor;
  const system = item.system;

  // Prone/Restrained block any spell whose casting method is Movement -
  // see helpers/statusEffects.mjs#canCastMovementSpell.
  if (actor && !abilityOptions && system.castingMethods?.movement && !canCastMovementSpell(actor)) {
    ui.notifications.warn(game.i18n.localize('SKSK.StatusEffect.MovementSpellBlocked'));
    return;
  }

  // Infusion: a spell that must be cast with an Infusion weapon needs one equipped.
  if (actor && system.requiresInfusionWeapon
    && !actor.items.some(i => i.type === 'weapon' && i.system.equipped && hasEffectiveProperty(i.system, 'infusion'))) {
    ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.InfusionWeaponRequired'));
    return;
  }

  if (actor && !abilityOptions) {
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
  extraCostTier = Math.max(0, Math.min(extraCostTier, computeMaxExtraCostTier(system)));
  extraCostCounts = normalizeExtraCostCounts(system, extraCostCounts);

  // "?" as Mana cost: the caster chooses the base amount for this cast (the
  // Shift+Click dialog already asked; a plain click asks here). Closing the
  // prompt aborts the cast.
  if (actor && !abilityOptions && system.manaCostVariable) {
    if (variableMana === null || variableMana === undefined) {
      variableMana = await promptVariableMana(item);
      if (variableMana === null) return;
    }
    variableMana = Math.max(0, Math.floor(Number(variableMana)) || 0);
    if (variableMana !== system.variableManaPaid) await item.update({ 'system.variableManaPaid': variableMana });
  } else {
    variableMana = null;
  }

  // The Unterhalt of the paid extra-cost steps is remembered on the spell:
  // it is switched to "sustaining" only after the cast (setSpellSustaining),
  // by when the chosen steps would otherwise be forgotten.
  if (actor && !abilityOptions) {
    const extraUpkeep = computeExtraUpkeep(system, extraCostTier, extraCostCounts);
    if (extraUpkeep !== (system.extraUpkeepPaid ?? 0)) await item.update({ 'system.extraUpkeepPaid': extraUpkeep });
  }

  // "?" as AP cost: likewise asked once per cast (closing the prompt aborts
  // it). Only the plain "ap" unit has an AP amount to choose.
  let variableAp = null;
  if (actor && !abilityOptions && system.apCostVariable && system.apCostUnit === 'ap') {
    variableAp = await promptVariableAp(item);
    if (variableAp === null) return;
    if (variableAp !== system.variableApPaid) await item.update({ 'system.variableApPaid': variableAp });
  }

  // A Metamagie spell (helpers/metamagic.mjs) may need a choice (how many
  // levels, which element, ...): asked now, closing the prompt aborts the cast.
  let metaChoice = null;
  if (actor && !abilityOptions && system.metamagic) {
    metaChoice = await promptMetamagicChoice(item);
    if (metaChoice === null) return;
  }

  // An element-choice spell (data/spell.mjs#elementChoice): "choice" asks
  // which element once (closing the prompt aborts the cast); each cast then
  // resolves it - a "random" pick (or mode "random") is rolled per cast.
  let elementPick = null;
  if (actor && system.elementChoice?.mode === 'choice' && getSpellElementOptions(system).length) {
    elementPick = await promptSpellElement(item);
    if (elementPick === null) return;
  }

  // Casting the same spell several times in a row (Shift+Click dialog, only
  // outside Combat - see canCastSpellMultiple): one compact card instead.
  castCount = !abilityOptions && canCastSpellMultiple(item)
    ? Math.max(1, Math.min(MAX_MULTI_CAST, Math.floor(Number(castCount)) || 1))
    : 1;
  const ctx = { overchargeCount, extraCostTier, extraCostCounts, variableMana, variableAp, altResourceIndex, element: null, variants: [] };

  // 1. Heading, 2. Magic school (an ability shows its own name instead).
  const parts = [formatRollCardHeading(abilityOptions?.name ?? item.name)];
  const schoolLabel = abilityOptions ? '' : resolveSpellSchoolLabel(system);
  if (schoolLabel) parts.push(`<div class="sksk-roll-magic-school">${schoolLabel}</div>`);

  if (castCount > 1) {
    // Only the values that matter (ranges, duration, per-cast costs) and
    // every roll - no casting methods, no description.
    parts.push(...(await renderSpellInfoParts(item, ctx, true)));
    let totalMana = 0;
    for (let number = 1; number <= castCount; number++) {
      // Varianten (helpers/spellVariants.mjs): re-detected for every cast, so
      // a marker with "Bis Nutzung" only changes the first of them.
      const found = detectSpellVariants(item);
      const castItem = createVariantItem(item, found.indexes);
      const cast = await resolveCastElement(castItem, elementPick);
      const castOvercharge = overchargeCount + (castItem.system.metaOvercharge ?? 0);
      const castCtx = { ...ctx, overchargeCount: castOvercharge, element: cast.element, variants: found.indexes };
      const paid = await paySpellCast(castItem, castCtx);
      if (paid.aborted) {
        if (number === 1) return;
        break;
      }
      totalMana += paid.manaCost;
      const markerHTML = await consumeVariantMarkers(actor, found.markerIds);
      const entry = [`<div class="sksk-multicast-heading">${game.i18n.format('SKSK.Spell.Roll.MultiCastNumber', { number, total: castCount })}</div>`, renderVariantLines(item, found.indexes), markerHTML, cast.html, ...paid.parts];
      if (!paid.deferred) {
        entry.push(...(await renderSpellEffectParts(castItem, castOvercharge, extraCostTier, extraCostCounts, variableMana, cast.element)));
        if (castItem.system.metaDouble) {
          entry.push(`<div class="sksk-multicast-heading">${game.i18n.localize('SKSK.Metamagic.SecondTarget')}</div>`,
            ...(await renderSpellEffectParts(castItem, castOvercharge, extraCostTier, extraCostCounts, variableMana, cast.element)));
        }
      }
      parts.push(`<div class="sksk-multicast-entry">${entry.join('')}</div>`);
    }
    if (actor && totalMana > 0) {
      parts.push(`<div class="sksk-roll-mana-cost sksk-multicast-total"><strong>${game.i18n.localize('SKSK.Spell.Roll.MultiCastTotalMana')}:</strong> ${totalMana}</div>`);
    }
    return postSpellChatCard(item, parts);
  }

  // Varianten (helpers/spellVariants.mjs): markers on the caster that change
  // this cast - everything below runs on the variant-modified stand-in item.
  const found = detectSpellVariants(item);
  const castItem = createVariantItem(item, found.indexes);
  const cast = await resolveCastElement(castItem, elementPick);
  ctx.element = cast.element;
  ctx.variants = found.indexes;
  // Überlade (Metamagie): extra Überladungen on top of the chosen ones.
  overchargeCount += castItem.system.metaOvercharge ?? 0;
  ctx.overchargeCount = overchargeCount;
  const paid = abilityOptions ? await payAbilityCast(abilityOptions) : await paySpellCast(castItem, ctx);
  if (paid.aborted) return;
  parts.push(...paid.parts);
  if (metaChoice !== null) parts.push(await placeMetamagicMarker(actor, item, metaChoice));
  parts.push(renderVariantLines(item, found.indexes), await consumeVariantMarkers(actor, found.markerIds));
  if (cast.html) parts.push(cast.html);
  if (abilityOptions?.descriptionHTML) parts.push(abilityOptions.descriptionHTML);
  parts.push(...(await renderSpellInfoParts(castItem, ctx, !!abilityOptions)));
  if (!paid.deferred) {
    parts.push(...(await renderSpellEffectParts(castItem, overchargeCount, extraCostTier, extraCostCounts, variableMana, cast.element)));
    // Verdopple (Metamagie): the spell takes effect a second time.
    if (castItem.system.metaDouble) {
      parts.push(`<div class="sksk-multicast-heading">${game.i18n.localize('SKSK.Metamagic.SecondTarget')}</div>`,
        ...(await renderSpellEffectParts(castItem, overchargeCount, extraCostTier, extraCostCounts, variableMana, cast.element)));
    }
  }

  return postSpellChatCard(item, parts, abilityOptions?.name ?? item.name);
}

/**
 * Settle the cost of an ability that casts a spell as its effect (see
 * rollSpellItem's abilityOptions) - the counterpart of paySpellCast.
 * @param {{pay: function(): Promise<string[]|null>, onPaid?: function(): Promise<void>}} options
 * @return {Promise<{aborted: boolean, parts: string[], deferred: boolean, manaCost: number}>}
 */
async function payAbilityCast(options) {
  const costLines = await options.pay();
  if (costLines === null) return { aborted: true, parts: [], deferred: false, manaCost: 0 };
  await options.onPaid?.();
  return { aborted: false, parts: costLines, deferred: false, manaCost: 0 };
}

/**
 * Whether a spell cast may be repeated several times in one go (the
 * Shift+Click dialog's "how many times" field, see chooseSpellCastOptions):
 * only outside Combat (nothing is turn-bound then), only for an owned spell,
 * and only for the units that resolve immediately - a "minutes" ritual (AP
 * drain over Combat rounds) or a pure-reaction "rp" spell can't be repeated.
 * @param {Item} item
 * @return {boolean}
 */
export function canCastSpellMultiple(item) {
  if (!item?.actor || isCombatActive() || item.system.metamagic) return false;
  return ['ap', 'hours', 'days'].includes(item.system.apCostUnit ?? 'ap');
}

/**
 * Pay for ONE cast of a spell (AP/RP, Mana, Manakapazität/skill FP, ...) and
 * collect its own chat lines - the cost part of rollSpellItem, split out so
 * a repeated cast can run it once per cast. Posts nothing itself.
 * @param {Item} item
 * @param {{overchargeCount: number, extraCostTier: number, extraCostCounts: number[],
 *   variableMana: number|null, variableAp: number|null, altResourceIndex: number,
 *   element: string|null, variants: number[]}} ctx   element: this cast's element (see
 *   data/spell.mjs#elementChoice), kept on a pending spell until it resolves.
 * @return {Promise<{aborted: boolean, parts: string[], deferred: boolean, manaCost: number}>}
 *   aborted: the cast was blocked (a notification was shown, nothing paid).
 *   deferred: its effect has to wait for an AP/ritual debt to be paid off.
 */
async function paySpellCast(item, ctx) {
  const actor = item.actor;
  const system = item.system;
  const { overchargeCount, extraCostTier, extraCostCounts, variableMana, variableAp, altResourceIndex } = ctx;
  const parts = [];
  let manaCost = 0;
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
        return { aborted: true, parts: [], deferred: false, manaCost: 0 };
      }
      if (system.apCostUnit === 'minutes') {
        const totalRounds = Math.max(1, system.apCost) * ROUNDS_PER_MINUTE;
        await actor.update({ 'system.pendingSpell': { itemId: item.id, apCost: 0, roundsRemaining: totalRounds, overchargeCount, extraCostTier, extraCostCounts, variableMana: variableMana ?? 0, element: ctx.element ?? '', variants: ctx.variants ?? [] } });
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
        return { aborted: true, parts: [], deferred: false, manaCost: 0 };
      }
      const rpCost = computeSpellApCost(system, actor, overchargeCount, variableAp);
      const rp = actor.system.reactionPoints.value;
      if (rp < rpCost) {
        ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughRP'));
        return { aborted: true, parts: [], deferred: false, manaCost: 0 };
      }
      parts.push(`<div class="sksk-roll-rp-cost"><strong>${game.i18n.localize('SKSK.Spell.RPCost')}:</strong> ${rpCost}</div>`);
      await actor.update({ 'system.reactionPoints.value': rp - rpCost });
      parts.push(formatSkillFpGrantLine(await checkReflexActionTrigger(actor)));
    } else if (offTurn) {
      const apCost = computeSpellApCost(system, actor, overchargeCount, variableAp);
      const rpCost = (system.rpCost ?? 0) > 0 ? system.rpCost : apCost;
      const rp = actor.system.reactionPoints.value;
      if (rp < rpCost) {
        ui.notifications.warn(game.i18n.localize('SKSK.Action.NotEnoughRP'));
        return { aborted: true, parts: [], deferred: false, manaCost: 0 };
      }
      parts.push(`<div class="sksk-roll-rp-cost"><strong>${game.i18n.localize('SKSK.Spell.RPCost')}:</strong> ${rpCost}</div>`);
      await actor.update({ 'system.reactionPoints.value': rp - rpCost });
      parts.push(formatSkillFpGrantLine(await checkReflexActionTrigger(actor)));
    } else {
      const apCost = computeSpellApCost(system, actor, overchargeCount, variableAp);
      parts.push(`<div class="sksk-roll-ap-cost"><strong>${game.i18n.localize('SKSK.Spell.APCost')}:</strong> ${apCost}</div>`);

      if (!isCombatActive()) {
        // Outside Combat, AP is never actually spent (see helpers/
        // statusEffects.mjs#isCombatActive) - no partial payment/AP-debt
        // tracking, no Concentration, no Reflexe FP (nothing was actually
        // spent to react to).
        parts.push(`<div class="sksk-roll-line">${game.i18n.localize('SKSK.Action.FreeOutsideCombat')}</div>`);
      } else {
        const ap = actor.system.actionPoints.value;
        const paidNow = Math.min(ap, apCost);
        const remaining = apCost - paidNow;
        if (paidNow) {
          await actor.update({ 'system.actionPoints.value': ap - paidNow });
          parts.push(formatSkillFpGrantLine(await checkReflexActionTrigger(actor)));
        }

        if (remaining > 0) {
          await actor.update({ 'system.pendingSpell': { itemId: item.id, apCost: remaining, roundsRemaining: 0, overchargeCount, extraCostTier, extraCostCounts, variableMana: variableMana ?? 0, element: ctx.element ?? '', variants: ctx.variants ?? [] } });
          await setStatusStacks(actor, 'concentration', 1);
          parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ApOwed', { paid: paidNow, remaining })}</div>`);
          deferred = true;
        }
      }
    }

    // 4. Mana cost.
    const manaResult = computeSpellManaCost(system, actor, overchargeCount, extraCostTier, extraCostCounts, variableMana);
    manaCost = manaResult.cost;
    const increased = manaResult.increased;
    const costClass = increased ? 'sksk-roll-mana-cost-increased' : '';
    parts.push(`<div class="sksk-roll-mana-cost"><strong>${game.i18n.localize('SKSK.Spell.ManaCost')}:</strong> <span class="${costClass}">${manaCost}</span></div>`);

    // Manakapazität's own FP accumulator (see helpers/rest.mjs#applyRest,
    // which turns this into FP on the next Anpassungs-/Genesungspause) -
    // the real mana cost above (after mali/boni), regardless of whether it
    // actually got paid from Mana, a custom resource, or overflowed into
    // Life/Negative Life.
    if (manaCost > 0) {
      await actor.update({ 'system.manaCapacityAccumulator': (actor.system.manaCapacityAccumulator ?? 0) + manaCost });
    }

    // A custom resource spent instead of Mana (see helpers/
    // customResources.mjs) - computed against the FINAL manaCost (after
    // Überladen/extra-cost tier/discounts), unlike the dialog's own preview
    // which only ever showed the base cost. Whatever it doesn't cover falls
    // back to the normal Mana payment below.
    let manaCostAfterAltResource = manaCost;
    const altResource = altResourceIndex >= 0 ? actor.system.customResources?.[altResourceIndex] : null;
    if (altResource?.isManaAlternative) {
      const { resourcePointsSpent, manaCovered } = computeManaAlternativeCoverage(altResource, manaCost, system.spellLevel);
      if (resourcePointsSpent > 0) {
        await payWithManaAlternative(actor, altResourceIndex, resourcePointsSpent);
        manaCostAfterAltResource = manaCost - manaCovered;
        const resourceName = altResource.name || altResource.abbreviation;
        parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.AltResourcePaid', { name: resourceName, spent: resourcePointsSpent, covered: manaCovered })}</div>`);
      }
    }

    const { lifeDelta, negativeLifeDelta } = await payManaCost(actor, manaCostAfterAltResource);
    if (lifeDelta || negativeLifeDelta) {
      const fromLife = -lifeDelta + negativeLifeDelta;
      parts.push(`<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ManaShortfallFromLife', { amount: fromLife })}</div>`);
      parts.push(negativeLifeOverflowHTML(actor, negativeLifeDelta));
    }

    // FP for casting a spell (per its own spellLevel) belongs to its magic
    // school - only meaningful for Simple/Advanced spells, which each
    // belong to exactly one (Systemless spells have none - see
    // CONFIG.SKSK.simpleMagicSchools/advancedMagicSchools). Granted now,
    // at cast time, regardless of whether its AP cost is still owed above.
    // Split into two separately GM-configured rates by whether a Combat is
    // currently active (isCombatActive - same started/not-yet-started
    // distinction every AP/RP waiver in the system already uses), not by
    // whether THIS cast itself was part of a combat action.
    if (system.spellType === 'simple' || system.spellType === 'advanced') {
      const trigger = isCombatActive() ? 'spellCastPerLevelInCombat' : 'spellCastPerLevelOutOfCombat';
      const fpGrant = await grantSkillUsageFp(actor, system.magicSchool, trigger, system.spellLevel);
      parts.push(formatSkillFpGrantLine(fpGrant));

      // Bardic magic (an Advanced school) is also Singing's own "using
      // Bardic magic" trigger - a flat grant alongside Bardic's own
      // spellCastPerLevelInCombat/OutOfCombat above, not instead of it.
      if (system.magicSchool === 'bardic') {
        parts.push(formatSkillFpGrantLine(await grantSkillUsageFp(actor, 'singing', 'bardicSpellCast')));
      }

      // Elementarladungen Bottom-Bar widget (opt-in, see helpers/
      // elementalCharges.mjs) - only Einfache Magieschulen charge a slot,
      // not Advanced ones.
      if (system.spellType === 'simple') {
        await registerElementalCharge(actor, system.magicSchool);
      }
    } else if (system.spellType === 'combined') {
      // Combined spells belong to no single magic-school skill, so their
      // own per-level "cast" FP uses its own GM-configured rate (the
      // "combinedMagic" pseudo-skill row on the Magieschulen tab, see
      // apps/skill-usage-fp-config.mjs) rather than grantSkillUsageFp's own
      // skill-keyed one, then gets credited to whichever real skill(s)
      // actually enabled this cast - see helpers/spells.mjs#
      // computeCombinedSpellFpTargets for the override-vs-combinedSkills
      // split logic.
      const trigger = isCombatActive() ? 'spellCastPerLevelInCombat' : 'spellCastPerLevelOutOfCombat';
      const totalAmount = Math.floor(getSkillFpRate('combinedMagic', trigger) * system.spellLevel);
      for (const { skill, amount } of computeCombinedSpellFpTargets(system, actor, totalAmount)) {
        parts.push(formatSkillFpGrantLine(await grantFlatSkillFp(actor, skill, amount)));
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

  return { aborted: false, parts, deferred, manaCost };
}

/**
 * The informational lines of a cast: ranges, duration and - unless compact -
 * the casting methods and the (enriched) description.
 * @param {Item} item
 * @param {object} ctx   See paySpellCast.
 * @param {boolean} compact   Leave out casting methods and description.
 * @return {Promise<string[]>}
 */
async function renderSpellInfoParts(item, ctx, compact) {
  const actor = item.actor;
  const system = item.system;
  const parts = [];

  // 5. Ranges + indicator.
  if (system.ranges?.length) {
    // The Elementarist ability's own Luft-Ladungen bonus (helpers/
    // elementalChargeEffects.mjs) - +2m per charge on top of the spell's
    // own stored range (never on a cuboid's volume).
    const airChargeBonus = actor ? getElementalAirRangeBonus(actor) : 0;
    const rangesLabel = computeEffectiveRanges(system, ctx.extraCostTier, ctx.extraCostCounts, ctx.variableMana)
      .map(r => formatRangeLabel(r, airChargeBonus))
      .join(', ');
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.Spell.Ranges')}:</strong> ${rangesLabel}</div>`);
  }

  // 6. Duration, only when described.
  if (system.duration) {
    // The caster's own duration factor (Active Effect keys
    // system.spellDurationMultiplier...) changes the shown duration too.
    const durationFactor = getSpellDurationMultiplier(item.actor, getSpellSchool(system));
    const scaled = durationFactor !== 1 ? scaleDurationText(system.duration, durationFactor) : null;
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.Spell.DurationLabel')}:</strong> ${scaled ? scaled.text : system.duration}</div>`);
  }
  if (compact) return parts;

  // 7. Wirkmethoden (casting methods).
  const castingMethodsLabel = formatCastingMethodsLine(system);
  if (castingMethodsLabel) {
    parts.push(`<div class="sksk-roll-line"><strong>${game.i18n.localize('SKSK.Spell.CastingMethodsLabel')}:</strong> ${castingMethodsLabel}</div>`);
  }

  // 8. Description.
  const descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    system.description ?? '', { relativeTo: item, secrets: item.isOwner }
  );
  parts.push(`<div class="sksk-roll-description">${descriptionHTML}</div>`);
  return parts;
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
 * with whatever Überladen count/extra-cost tier the original cast used -
 * see data/actor-base.mjs#pendingSpell.overchargeCount/extraCostTier),
 * posted in its own chat message.
 * @param {Actor} actor
 * @param {Item|undefined} item
 * @param {{label: string, amount: number}|null} reflexGrant
 * @param {number} [overchargeCount=0]
 * @param {number} [extraCostTier=0]
 * @return {Promise<void>}
 */
async function resolvePendingSpell(actor, item, reflexGrant, overchargeCount = 0, extraCostTier = 0, extraCostCounts = [], variableMana = null, element = null, variants = []) {
  await actor.update({ 'system.pendingSpell.itemId': '' });
  await setStatusStacks(actor, 'concentration', 0);
  if (!item) return;

  const parts = [formatRollCardHeading(item.name)];
  if (element) {
    parts.push(`<div class="sksk-roll-line sksk-roll-element"><strong>${game.i18n.localize('SKSK.Spell.Element.Label')}:</strong> ${game.i18n.localize(CONFIG.SKSK.damageTypes[element] ?? element)}</div>`);
  }
  const pendingItem = createVariantItem(item, variants);
  parts.push(...(await renderSpellEffectParts(pendingItem, overchargeCount, extraCostTier, extraCostCounts, variableMana, element)));
  if (pendingItem.system.metaDouble) {
    parts.push(`<div class="sksk-multicast-heading">${game.i18n.localize('SKSK.Metamagic.SecondTarget')}</div>`,
      ...(await renderSpellEffectParts(pendingItem, overchargeCount, extraCostTier, extraCostCounts, variableMana, element)));
  }
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
  const extraCostTier = pending.extraCostTier ?? 0;
  const extraCostCounts = pending.extraCostCounts ?? [];
  const variableMana = item?.system.manaCostVariable ? (pending.variableMana ?? 0) : null;
  const element = pending.element || null;
  const variants = [...(pending.variants ?? [])];

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

    await resolvePendingSpell(actor, item, reflexGrant, overchargeCount, extraCostTier, extraCostCounts, variableMana, element, variants);
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

  await resolvePendingSpell(actor, item, reflexGrant, overchargeCount, extraCostTier, extraCostCounts, variableMana, element, variants);
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
async function resolveAndRollSavingThrow(rollingActor, casterItem, save, saveIndex, overchargeCount, mode, ignoreSpecial, contestTotal = null, dcBonus = 0) {
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

  const dc = contestTotal ?? computeSavingThrowValue(save, casterItem.actor, overchargeCount, dcBonus);
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

  return { dc, roll, criticalType, success, saveLabel, outcome, luckHTML, best, result, isContest: contestTotal != null };
}

/**
 * Handle a click on a saving-throw button in chat: roll 1d20 plus the
 * clicking user's (selected token's, else assigned character's - see
 * helpers/damageApplication.mjs#resolveClickRoller) best applicable attribute modifier or skill level (the
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
export async function rollSavingThrowFromChat(itemUuid, saveIndex, overchargeCount = 0, ignoreSpecial = false, contestTotal = null, dcBonus = 0, variants = []) {
  const realItem = await fromUuid(itemUuid);
  const item = realItem ? createVariantItem(realItem, variants) : null;
  if (!item) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const save = item.system.savingThrows?.[saveIndex];
  if (!save) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const actor = resolveClickRoller();
  if (!actor) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.NoCharacter'));

  const mode = await chooseGenericRollMode(recommendSaveMode(actor, {
    testAttributes: save.testAttributes, testSkills: save.testSkills,
    modField: ignoreSpecial ? 'modExcludingSpecial' : 'mod', getSkillLevel: key => getActorSkillLevel(actor, key),
  }));
  if (!mode) return;

  const r = await resolveAndRollSavingThrow(actor, item, save, saveIndex, overchargeCount, mode, ignoreSpecial, contestTotal, dcBonus);

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
async function renderSpellEffectSaveButtonHTML(item, savingThrowIndex, overchargeCount = 0, dcBonus = 0, extraCostTier = 0, extraCostCounts = [], element = null) {
  const extraAttrs = `data-extra-tier="${extraCostTier}" data-extra-counts="${extraCostCounts.join(',')}"${element ? ` data-element="${element}"` : ''} data-variants="${variantAttribute(item)}"`;
  const save = item.system.savingThrows?.[savingThrowIndex];
  if (!save) return '';
  const label = save.label || game.i18n.format('SKSK.Spell.SavingThrow.Numbered', { number: savingThrowIndex + 1 });
  if (save.contest) {
    const casterRoll = await rollContestCasterRoll(save, item.actor, dcBonus);
    const rollHTML = await casterRoll.roll.render();
    return `<div class="sksk-roll-line">${game.i18n.format('SKSK.Spell.Roll.ContestCasterRoll', { label })}</div>${rollHTML}
    <button type="button" class="sksk-roll-hit-eval" data-action="rollSpellEffectSave"
      data-item-uuid="${item.uuid}" data-save-index="${savingThrowIndex}" data-overcharge="${overchargeCount}" data-dc-bonus="${dcBonus}" ${extraAttrs} data-contest-total="${casterRoll.total}">
      ${game.i18n.format('SKSK.Spell.RollEffectSavingThrowContest', { label, total: casterRoll.total })}
    </button>`;
  }
  const dc = computeSavingThrowValue(save, item.actor, overchargeCount, dcBonus);
  return `<button type="button" class="sksk-roll-hit-eval" data-action="rollSpellEffectSave"
    data-item-uuid="${item.uuid}" data-save-index="${savingThrowIndex}" data-overcharge="${overchargeCount}" data-dc-bonus="${dcBonus}" ${extraAttrs}>
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
export async function rollSpellEffectSaveFromChat(itemUuid, saveIndex, overchargeCount = 0, ignoreSpecial = false, contestTotal = null, dcBonus = 0, extraCostTier = 0, extraCostCounts = [], element = null, variants = []) {
  const realItem = await fromUuid(itemUuid);
  const item = realItem ? createVariantItem(realItem, variants) : null;
  if (!item) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const save = item.system.savingThrows?.[saveIndex];
  if (!save) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.ItemNotFound'));

  const actor = resolveClickRoller();
  if (!actor) return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.NoCharacter'));

  const mode = await chooseGenericRollMode(recommendSaveMode(actor, {
    testAttributes: save.testAttributes, testSkills: save.testSkills,
    modField: ignoreSpecial ? 'modExcludingSpecial' : 'mod', getSkillLevel: key => getActorSkillLevel(actor, key),
  }));
  if (!mode) return;

  const r = await resolveAndRollSavingThrow(actor, item, save, saveIndex, overchargeCount, mode, ignoreSpecial, contestTotal, dcBonus);
  const appliedHTML = r.success ? '' : await applySpellEffectGroup(itemUuid, 'save', saveIndex, actor, extraCostTier, extraCostCounts, element, variants);

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
function spellHasEffectsForGroup(system, group, extraCostTier = 0) {
  return (system.statusEffects ?? []).some((e, i) => e.trigger === group && resolveSpellStatusStacks(system, i, extraCostTier) !== null)
    || (system.foundryEffects ?? []).some((e, i) => e.trigger === group && isSpellFoundryEffectActive(system, i, extraCostTier));
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
function renderSpellEffectApplyButtonHTML(item, group, extraCostTier = 0, extraCostCounts = [], element = null) {
  if (!spellHasEffectsForGroup(item.system, group, extraCostTier)) return '';
  return `<button type="button" class="sksk-apply-damage" data-action="applySpellEffect"
    data-item-uuid="${item.uuid}" data-group="${group}" data-extra-tier="${extraCostTier}" data-extra-counts="${extraCostCounts.join(',')}"${element ? ` data-element="${element}"` : ''} data-variants="${variantAttribute(item)}">
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
export async function applySpellEffectFromChat(itemUuid, group, extraCostTier = 0, extraCostCounts = [], element = null, variants = []) {
  const item = await fromUuid(itemUuid);
  const defender = resolveClickDefender(item?.actor ?? null);
  if (!defender) return ui.notifications.warn(game.i18n.localize('SKSK.AttackRoll.NoDefender'));

  const html = await applySpellEffectGroup(itemUuid, group, null, defender, extraCostTier, extraCostCounts, element, variants);
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: item?.name ?? '',
    content: `<div class="sksk-chat-card sksk-action-card">${html}</div>`,
  };
  ChatMessage.applyRollMode(messageData, game.settings.get('core', 'rollMode'));
  return ChatMessage.create(messageData);
}

/**
 * Cast a spell from a click on a sheet/window: a plain click casts it with the
 * standard options, Shift+click first asks for the cast options (Überladen/
 * extra Mana/alternative resource, see chooseSpellCastOptions).
 * @param {Actor} actor
 * @param {Item} item
 * @param {boolean} [shiftKey=false]
 * @return {Promise<*>}
 */
export async function castSpellFromSheet(actor, item, shiftKey = false) {
  if (shiftKey) {
    const pendingSpell = actor.system.pendingSpell;
    if ((pendingSpell?.apCost ?? 0) > 0 || (pendingSpell?.roundsRemaining ?? 0) > 0) {
      return ui.notifications.warn(game.i18n.localize('SKSK.Spell.Roll.AlreadyConcentrating'));
    }
    const choice = await chooseSpellCastOptions(actor, item);
    if (!choice) return;
    return item.roll(choice.overchargeCount, choice.extraCostTier, choice.altResourceIndex, choice.extraCostCounts, choice.variableMana, choice.castCount);
  }
  return item.roll();
}
