/**
 * Zusatzschaden (extra damage) granted by Active Effects, and the "Bis
 * Nutzung" (until used) effect expiry.
 *
 * An Active Effect adds extra damage by targeting one of the keys of the
 * actor's "system.extraDamage" group (see buildExtraDamageSchema) with a
 * Value that is a flat number or a dice formula (e.g. "5", "1d6",
 * "1d6 + @attributes.wil.mod"). A damage type may be attached with Foundry's
 * flavor syntax - "1d6[fire]" - otherwise the extra damage has the damage
 * type of the attack it is added to. Terms of different types split into
 * separate damage entries ("1d6[fire] + 1d4[cold]").
 *
 * Keys (all under "system.extraDamage."):
 * - martialArts: every Martial Arts (Kampfkunst) attack.
 * - weaponsAll: every weapon attack - a Martial Arts attack only for HALF
 *   of the rolled amount (rounded up).
 * - weapons: every weapon attack, Martial Arts excluded.
 * - spells: every spell's damage (Systemless spells included).
 * - schools.<school>: damage of the spells of one Simple/Advanced/Combined
 *   magic school (Systemless spells belong to none).
 * - elements.<damageType>: every damage instance dealing that element,
 *   whether weapon, Martial Arts or spell.
 *
 * The extra damage is rolled once per damage instance (per weapon/Martial
 * Arts attack, per damage entry of a spell) and appears as its own roll plus
 * its own entries in the "Schaden anwenden" button, so Resistance/Weakness/
 * Immunity/Absorption treat it separately from the main damage.
 *
 * Every matching effect on the actor counts and stacks - the values are read
 * straight from each effect's changes (not from the prepared actor field,
 * which only exists so the keys are valid), which also tells the system WHICH
 * effect contributed - see consumeUsedEffects.
 */

/** The custom Active Effect expiry event "Bis Nutzung" (until used). */
export const EXTRA_DAMAGE_USE_EVENT = 'used';

const ROOT = 'system.extraDamage';

/**
 * The actor schema of the extra-damage keys - one text field (formula) each.
 * @param {object} fields   foundry.data.fields
 * @return {foundry.data.fields.SchemaField}
 */
export function buildExtraDamageSchema(fields) {
  const text = () => new fields.StringField({ required: true, blank: true, initial: '' });
  const group = (keys) => new fields.SchemaField(Object.fromEntries(keys.map(key => [key, text()])));
  return new fields.SchemaField({
    martialArts: text(),
    weaponsAll: text(),
    weapons: text(),
    spells: text(),
    schools: group([
      ...Object.keys(CONFIG.SKSK.simpleMagicSchools),
      ...Object.keys(CONFIG.SKSK.advancedMagicSchools),
      ...Object.keys(CONFIG.SKSK.combinedMagicSchools),
    ]),
    elements: group(Object.keys(CONFIG.SKSK.damageTypes)),
  });
}

/**
 * What a damage roll is, for matching extra damage: kind "weapon" (a weapon
 * item attack), "martialArts" or "spell".
 * @typedef {object} ExtraDamageContext
 * @property {"weapon"|"martialArts"|"spell"} kind
 * @property {string} damageType   The damage type of this damage instance.
 * @property {string|null} [school]   Spells only: the magic school key (null
 *   for a Systemless spell).
 * @property {string|null} [skillKey]   Weapons only: the weapon skill.
 * @property {string[]} [damageTypes]   Consumption only: every damage type
 *   the roll dealt.
 * @property {boolean} [rolled]   Consumption only: whether anything was
 *   actually rolled (an attack or a damage).
 * @property {boolean} [attackRolled]   Consumption only: whether an attack
 *   roll was made (the Vorteil/Nachteil recommendation keys count as used by it).
 */

/**
 * The extra-damage keys that apply to a damage instance.
 * @param {ExtraDamageContext} ctx
 * @return {Array<{key: string, halve: boolean}>}
 */
function matchingKeys(ctx) {
  const keys = [];
  if (ctx.kind === 'weapon') {
    keys.push({ key: `${ROOT}.weapons`, halve: false }, { key: `${ROOT}.weaponsAll`, halve: false });
  } else if (ctx.kind === 'martialArts') {
    keys.push({ key: `${ROOT}.martialArts`, halve: false }, { key: `${ROOT}.weaponsAll`, halve: true });
  } else if (ctx.kind === 'spell') {
    keys.push({ key: `${ROOT}.spells`, halve: false });
    if (ctx.school) keys.push({ key: `${ROOT}.schools.${ctx.school}`, halve: false });
  }
  if (ctx.damageType) keys.push({ key: `${ROOT}.elements.${ctx.damageType}`, halve: false });
  return keys;
}

/**
 * A damage type from a formula flavor ("fire", or its localized name).
 * @param {string|undefined} flavor
 * @return {string|null}
 */
function resolveFlavorType(flavor) {
  const text = String(flavor ?? '').trim().toLowerCase();
  if (!text) return null;
  for (const [key, label] of Object.entries(CONFIG.SKSK.damageTypes)) {
    if (key.toLowerCase() === text || game.i18n.localize(label).toLowerCase() === text) return key;
  }
  return null;
}

/**
 * Roll one extra-damage formula and split it into per-type amounts.
 * @param {string} formula
 * @param {object} rollData
 * @param {string} defaultType
 * @return {Promise<{roll: Roll, amounts: Map<string, number>}|null>}   null
 *   if the formula is not a valid roll.
 */
async function evaluateExtraFormula(formula, rollData, defaultType) {
  let roll;
  try {
    roll = await new Roll(String(formula), rollData).evaluate();
  } catch (error) {
    console.warn(`SKSK | Invalid extra damage formula "${formula}"`, error);
    return null;
  }

  const amounts = new Map();
  const { OperatorTerm } = foundry.dice.terms;
  let sign = 1;
  let splittable = true;
  for (const term of roll.terms) {
    if (term instanceof OperatorTerm) {
      if (term.operator === '+') sign = 1;
      else if (term.operator === '-') sign = -1;
      else splittable = false; // multiplication/division: no per-type split
      continue;
    }
    const type = resolveFlavorType(term.options?.flavor) ?? defaultType;
    amounts.set(type, (amounts.get(type) ?? 0) + sign * (Number(term.total) || 0));
    sign = 1;
  }
  if (!splittable) {
    amounts.clear();
    amounts.set(defaultType, Number(roll.total) || 0);
  }
  return { roll, amounts };
}

/**
 * Roll every extra-damage source that applies to one damage instance.
 * @param {Actor|null} actor
 * @param {ExtraDamageContext} ctx
 * @param {object} [options]
 * @param {object} [options.entryFlags]   Merged into every produced entry
 *   (e.g. {ignoresBarrier: true}).
 * @param {Set<string>} [options.used]   Collects the ids of the effects that
 *   contributed (see consumeUsedEffects).
 * @return {Promise<{html: string, entries: Array<{damageType: string, amount: number}>}>}
 */
export async function rollExtraDamage(actor, ctx, { entryFlags = {}, used = null } = {}) {
  const result = { html: '', entries: [] };
  if (!actor) return result;

  const matches = matchingKeys(ctx);
  if (!matches.length) return result;
  const rollData = actor.getRollData();

  for (const effect of actor.appliedEffects) {
    for (const change of effect.changes ?? []) {
      const match = matches.find(entry => entry.key === change.key);
      const formula = String(change.value ?? '').trim();
      if (!match || !formula) continue;

      const evaluated = await evaluateExtraFormula(formula, rollData, ctx.damageType);
      if (!evaluated) continue;
      used?.add(effect.id);

      const lines = [];
      for (const [damageType, total] of evaluated.amounts) {
        const amount = Math.max(0, match.halve ? Math.ceil(total / 2) : total);
        result.entries.push({ damageType, amount, ...entryFlags });
        const label = game.i18n.localize(CONFIG.SKSK.damageTypes[damageType] ?? damageType);
        lines.push(`<div class="sksk-roll-line">${label}: <strong>${amount}</strong>${match.halve ? ` (${game.i18n.localize('SKSK.Roll.ExtraDamageHalved')})` : ''}</div>`);
      }
      result.html += `<div class="sksk-roll-damage sksk-roll-extra-damage"><strong>${game.i18n.localize('SKSK.Roll.ExtraDamage')}</strong> (${foundry.utils.escapeHTML(effect.name)})</div>${await evaluated.roll.render()}${lines.join('')}`;
    }
  }
  return result;
}

/**
 * The bonus keys (beyond the extra-damage ones) whose effect counts as "used"
 * by a roll of this kind - the existing attack/damage bonus keys.
 * @param {ExtraDamageContext} ctx
 * @return {Set<string>}
 */
function usageKeys(ctx) {
  const keys = new Set();
  const types = ctx.damageTypes?.length ? ctx.damageTypes : (ctx.damageType ? [ctx.damageType] : []);
  for (const type of types) {
    keys.add(`system.damageBonus.${type}`);
    for (const { key } of matchingKeys({ ...ctx, damageType: type })) keys.add(key);
  }
  if (ctx.attackRolled) {
    keys.add('system.attackAdvantageAll');
    if (ctx.kind === 'spell') keys.add('system.spellAttackAdvantageAll');
    else {
      keys.add('system.weaponAttackAdvantageAll');
      const advantageSkill = ctx.kind === 'martialArts' ? 'martialArts' : ctx.skillKey;
      if (advantageSkill) keys.add(`system.weaponAttackAdvantage.${advantageSkill}`);
    }
  }
  if (ctx.kind === 'weapon' || ctx.kind === 'martialArts') {
    const skill = ctx.kind === 'martialArts' ? 'martialArts' : ctx.skillKey;
    keys.add('system.weaponAttackBonusAll');
    keys.add('system.damageBonusAll');
    if (skill) {
      keys.add(`system.weaponAttackBonus.${skill}`);
      keys.add(`system.weaponDamageBonus.${skill}`);
    }
    for (const { key } of matchingKeys({ ...ctx, damageType: null })) keys.add(key);
  } else if (ctx.kind === 'spell') {
    keys.add('system.spellAttackBonusAll');
    keys.add('system.spellDamageBonusAll');
    for (const { key } of matchingKeys({ ...ctx, damageType: null })) keys.add(key);
    if (ctx.school) {
      for (const group of ['magicSchoolAttackBonus', 'magicSchoolDamageBonus', 'combinedMagicSchoolAttackBonus', 'combinedMagicSchoolDamageBonus']) {
        keys.add(`system.${group}.${ctx.school}`);
      }
    }
  }
  return keys;
}

/**
 * "Bis Nutzung": remove the actor's effects whose expiry is "used" once a
 * roll has used them - the effects that contributed extra damage (`used`),
 * and - if something was rolled - those with a matching attack/damage bonus
 * key (see usageKeys). Only the actor's own, enabled effects count.
 * @param {Actor|null} actor
 * @param {ExtraDamageContext} ctx
 * @param {Set<string>} [used]   The effect ids rollExtraDamage collected.
 * @return {Promise<string>}   Chat lines naming the removed effects.
 */
export async function consumeUsedEffects(actor, ctx, used = new Set()) {
  if (!actor) return '';
  const relevant = ctx.rolled ? usageKeys(ctx) : new Set();
  const consumed = actor.effects.filter(effect => {
    if (!effect.active || effect.duration?.expiry !== EXTRA_DAMAGE_USE_EVENT) return false;
    return used.has(effect.id) || (effect.changes ?? []).some(change => relevant.has(change.key));
  });
  if (!consumed.length) return '';

  try {
    await actor.deleteEmbeddedDocuments('ActiveEffect', consumed.map(effect => effect.id));
  } catch (error) {
    console.warn('SKSK | Could not remove used effects', error);
    return '';
  }
  return consumed
    .map(effect => `<div class="sksk-roll-line sksk-roll-effect-consumed">${game.i18n.format('SKSK.Roll.EffectConsumed', { name: foundry.utils.escapeHTML(effect.name) })}</div>`)
    .join('');
}
