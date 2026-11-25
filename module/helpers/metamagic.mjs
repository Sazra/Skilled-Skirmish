/**
 * Metamagie: spells that change the NEXT spell their caster casts, whatever
 * that spell is (Distanziere, Erhöhe, Still, Verlängere, ...).
 *
 * A Metamagie spell is a normal spell item whose "Metamagie" option
 * (data/spell.mjs#metamagic) names the rule it stands for. Casting it costs
 * what it costs and puts a marker effect on the caster (placeMetamagicMarker)
 * - an Active Effect with the expiry "Bis Nutzung", carrying the rule and the
 * choice made while casting it (flags.sksk.metamagic.code).
 *
 * The next spell the caster casts finds these markers
 * (helpers/spellVariants.mjs#detectSpellVariants) and runs on a stand-in copy
 * of its data that applyMetamagic has modified - the same mechanism the
 * per-spell Varianten use, so every roll, button and pending (AP debt) cast
 * of that spell sees the changed spell. The markers are used up by that cast.
 *
 * The stand-in data carries a few transient values beyond the spell schema
 * (never stored):
 * - manaSurchargePercent / manaSurchargeFlat: added to the Mana cost, see
 *   helpers/spells.mjs#computeSpellManaCost.
 * - metaDurationMultiplier: multiplies the duration of the Foundry effects
 *   the cast applies (helpers/damageApplication.mjs#applySpellEffectGroup).
 * - metaOvercharge: Überladungen added to the cast (spell-rolls.mjs).
 * - metaDouble: the spell takes effect a second time on another target.
 *
 * A variant list entry (an index into spell.system.variants) is a small
 * number; a Metamagie entry is a code >= CODE_BASE (type and choice in it),
 * so both travel together through chat buttons and the pending-spell data.
 */

import { getActorSkillLevel } from './skills.mjs';
import { getLehrenDefinitions, getInvestedLehreLevel } from './lehren.mjs';
import { computeMaxOverchargeCount } from './spells.mjs';
import { EXTRA_DAMAGE_USE_EVENT } from './extraDamage.mjs';

/** The rules a spell's "Metamagie" option can name (order = code order). */
export const METAMAGIC_TYPES = [
  'distance', 'raise', 'element', 'hinder', 'silent', 'secure', 'immobile',
  'extend', 'overcharge', 'double', 'strengthen', 'maximize', 'transcend', 'hateful',
];

const CODE_BASE = 100000;

/**
 * Variant list entries from this value on are "next spell" Varianten (see
 * helpers/spellVariants.mjs - a variant stored on another spell that changes
 * whatever spell is cast next), not Metamagie.
 */
export const ENHANCEMENT_CODE_BASE = 1000000;

/**
 * Codes from this value on are Hasserfüllte Macht (type "hateful"): the whole
 * choice (which options, how many Life) is packed into the code itself - it
 * does not fit the 0-999 parameter of the other types - see
 * encodeHatefulOptions.
 */
export const HATEFUL_CODE_BASE = 10000000000;

/** @param {*} value   @return {boolean} */
export const isHatefulCode = (value) => Number.isInteger(value) && value >= HATEFUL_CODE_BASE;

/**
 * Pack the choices of Hasserfüllte Macht into one number: bit 0 targeted
 * (Gezielter Hass), 1 strengthened (Gestärkter Hass), 2 maximum (Maximaler
 * Hass), 3 infinite (Unendlicher Hass), bits 4-7 the penalty of Hartnäckiger
 * Hass (0 = not chosen), bits 8-14 the Life paid for Verzehrender Hass
 * (0 = not chosen).
 * @param {{targeted?: boolean, strengthened?: boolean, maximum?: boolean, infinite?: boolean, tenacious?: number, devouring?: number}} options
 * @return {number}
 */
export function encodeHatefulOptions(options = {}) {
  return (options.targeted ? 1 : 0) | (options.strengthened ? 2 : 0) | (options.maximum ? 4 : 0) | (options.infinite ? 8 : 0)
    | (Math.max(0, Math.min(15, Math.floor(options.tenacious ?? 0))) << 4)
    | (Math.max(0, Math.min(127, Math.floor(options.devouring ?? 0))) << 8);
}

/**
 * @param {number} param   See encodeHatefulOptions.
 * @return {{targeted: boolean, strengthened: boolean, maximum: boolean, infinite: boolean, tenacious: number, devouring: number}}
 */
export function decodeHatefulOptions(param) {
  return {
    targeted: !!(param & 1), strengthened: !!(param & 2), maximum: !!(param & 4), infinite: !!(param & 8),
    tenacious: (param >> 4) & 15, devouring: (param >> 8) & 127,
  };
}

/** Elements Elementarisierung offers; the second group from Magiekontrolle 5. */
export const METAMAGIC_ELEMENTS = ['fire', 'water', 'earth', 'air', 'dark', 'light', 'nature', 'mental', 'life', 'death'];
export const METAMAGIC_ELEMENTS_ADVANCED = ['electricity', 'acid', 'poison', 'piercing', 'sharp', 'blunt'];

const RAISE_DICE_SINGLE = { 2: 2, 3: 3, 4: 7, 5: 10, 6: 13, 7: 17, 8: 22, 9: 28, 10: 35 };
const RAISE_DICE_MULTI = { 2: 2, 3: 3, 4: 5, 5: 7, 6: 9, 7: 12, 8: 15, 9: 18, 10: 22 };
const AREA_INDICATORS = new Set(['radius', 'sphere', 'cuboid', 'cone', 'line', 'square']);
const DIRECT_INDICATORS = new Set(['targeted', 'touch', 'projectile']);

/**
 * @param {string} type   One of METAMAGIC_TYPES.
 * @param {number} [param=0]   The choice made while casting (0-999).
 * @return {number}
 */
export function encodeMetamagic(type, param = 0) {
  const index = METAMAGIC_TYPES.indexOf(type);
  if (index < 0) throw new Error(`Unknown metamagic type ${type}`);
  if (type === 'hateful') return HATEFUL_CODE_BASE + Math.max(0, Math.floor(param));
  return CODE_BASE + index * 1000 + Math.max(0, Math.min(999, Math.floor(param)));
}

/** @param {*} value   @return {boolean} */
export function isMetamagicCode(value) {
  return (Number.isInteger(value) && value >= CODE_BASE && value < ENHANCEMENT_CODE_BASE) || isHatefulCode(value);
}

/**
 * @param {number} code
 * @return {{type: string, param: number}|null}
 */
export function decodeMetamagic(code) {
  if (!isMetamagicCode(code)) return null;
  if (isHatefulCode(code)) return { type: 'hateful', param: code - HATEFUL_CODE_BASE };
  const type = METAMAGIC_TYPES[Math.floor((code - CODE_BASE) / 1000)];
  return type ? { type, param: (code - CODE_BASE) % 1000 } : null;
}

// ------------------------------------------------------------------ helpers

const DICE = /(\d+)d(\d+)/gi;

function mapDice(formula, fn) {
  return String(formula ?? '').replace(DICE, (match, count, faces) => fn(Number(count), Number(faces)));
}

function countDice(formula) {
  let total = 0;
  mapDice(formula, (count) => { total += count; return ''; });
  return total;
}

const roundUpToEven = (value) => {
  const whole = Math.ceil(value - 1e-9);
  return whole % 2 === 0 ? whole : whole + 1;
};

const DURATION_UNITS = [
  { key: 'second', seconds: 1, re: 'Sekunden?', one: 'Sekunde', many: 'Sekunden' },
  { key: 'round', seconds: 6, re: 'Runden?', one: 'Runde', many: 'Runden' },
  { key: 'minute', seconds: 60, re: 'Minuten?', one: 'Minute', many: 'Minuten' },
  { key: 'hour', seconds: 3600, re: 'Stunden?', one: 'Stunde', many: 'Stunden' },
  { key: 'day', seconds: 86400, re: 'Tagen?|Tage', one: 'Tag', many: 'Tage' },
  { key: 'week', seconds: 604800, re: 'Wochen?', one: 'Woche', many: 'Wochen' },
  { key: 'month', seconds: 2592000, re: 'Monate?n?', one: 'Monat', many: 'Monate' },
];

/**
 * Multiply the first "<number> <unit>" in a duration text.
 * @param {string} text
 * @param {number} factor
 * @param {number|null} capSeconds   Longest allowed result (null = none).
 * @return {{text: string, from: string, to: string, seconds: number}|null}
 *   null if the text has no duration to scale (or it already reaches the cap).
 */
export function scaleDurationText(text, factor, capSeconds = null) {
  const pattern = new RegExp(`(\\d+|eine[rnm]?)\\s*(${DURATION_UNITS.map(unit => `(?:${unit.re})`).join('|')})\\b`, 'i');
  const match = String(text ?? '').match(pattern);
  if (!match) return null;
  const value = /^\d+$/.test(match[1]) ? Number(match[1]) : 1;
  const unit = DURATION_UNITS.find(entry => new RegExp(`^(?:${entry.re})$`, 'i').test(match[2]));
  if (!unit) return null;
  const total = value * unit.seconds;
  if (capSeconds !== null && total >= capSeconds) return null;
  let newTotal = total * factor;
  if (capSeconds !== null) newTotal = Math.min(newTotal, capSeconds);
  const newValue = Math.max(1, Math.floor(newTotal / unit.seconds));
  const word = (amount) => (amount === 1 ? unit.one : unit.many);
  const from = `${value} ${word(value)}`;
  const to = `${newValue} ${word(newValue)}`;
  return { text: String(text).replace(match[0], to), from, to, seconds: newTotal };
}

// ------------------------------------------------------------------ core

/**
 * Apply the given Metamagie codes to a plain copy of a spell's data.
 * @param {object} data   The spell's system data copy - modified in place.
 * @param {number[]} codes
 * @param {Actor|null} actor   The caster.
 * @param {object} [env]   Overrides for testing: mk (Magiekontrolle level),
 *   schoolLevel (level of the spell's school skill), wil (Willenskraft
 *   modifier), maxOvercharge.
 * @return {{notes: Array<{key: string, data: object}>}}   What happened, as
 *   localization keys under SKSK.Metamagic.Note with their values.
 */
export function applyMetamagic(data, codes, actor, env = {}) {
  const notes = [];
  const mk = env.mk ?? (actor ? getActorSkillLevel(actor, 'magicControl') : 0);
  const rules = (codes ?? []).map(decodeMetamagic).filter(Boolean);
  if (!rules.length) return { notes };

  const isSchoolSpell = data.spellType === 'simple' || data.spellType === 'advanced';
  const schoolLevel = env.schoolLevel ?? ((actor && isSchoolSpell) ? getActorSkillLevel(actor, data.magicSchool) : 99);
  const isMartial = isSchoolSpell && data.magicSchool === 'martialArts';
  const isBardic = isSchoolSpell && data.magicSchool === 'bardic';
  const isDraconic = data.spellType === 'combined' && data.combinedSchool === 'drakomancy';
  const baseMana = () => (data.manaCostVariable ? (data.variableManaPaid ?? 0) : (data.manaCost ?? 0));
  const addPercent = (value) => { data.manaSurchargePercent = (data.manaSurchargePercent ?? 0) + value; };
  const addFlat = (value) => { data.manaSurchargeFlat = (data.manaSurchargeFlat ?? 0) + value; };
  const note = (type, key, values = {}) => notes.push({ key: `${type}.${key}`, data: values });
  const none = (type, reason) => note(type, `None.${reason}`);
  const dealsDice = () => (data.damages ?? []).some(damage => countDice(damage.formula) > 0);

  // The order matters: level/element/DC first, then the dice, then the
  // multiplications, then the costs of the parts that were saved.
  const ORDER = ['raise', 'element', 'hinder', 'strengthen', 'maximize', 'hateful', 'transcend', 'extend', 'distance', 'silent', 'immobile', 'secure', 'double', 'overcharge'];
  const sorted = [...rules].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));

  for (const { type, param } of sorted) {
    switch (type) {
      case 'raise': {
        const level = data.spellLevel ?? 1;
        const maxByMk = mk;
        const maxByLevel = 10 - level;
        const maxBySchool = isSchoolSpell ? (3 + schoolLevel) - level : 99;
        const levels = Math.min(param, maxByMk, maxByLevel, maxBySchool);
        if (levels <= 0) { none(type, 'Limit'); break; }
        const newLevel = level + levels;
        const multi = (data.ranges ?? []).some(range => AREA_INDICATORS.has(range.indicator));
        const table = multi ? RAISE_DICE_MULTI : RAISE_DICE_SINGLE;
        const dice = table[newLevel];
        data.spellLevel = newLevel;
        for (const save of data.savingThrows ?? []) save.baseValue = (save.baseValue ?? 0) + 2 * levels;
        if (dice) {
          // The table gives the dice of the spell's (main) damage: the first dice term.
          let replaced = false;
          for (const damage of data.damages ?? []) {
            damage.formula = mapDice(damage.formula, (count, faces) => {
              if (replaced) return `${count}d${faces}`;
              replaced = true;
              return `${Math.max(count, dice)}d${faces}`;
            });
          }
        }
        addPercent((Math.pow(1.5, levels) - 1) * 100);
        note(type, 'Applied', { from: level, to: newLevel, dice: dice ?? '-' });
        if (levels < param) note(type, 'Clamped', { wanted: param, got: levels });
        break;
      }
      case 'element': {
        const options = [...METAMAGIC_ELEMENTS, ...(mk >= 5 ? METAMAGIC_ELEMENTS_ADVANCED : [])];
        const element = options[param];
        if (!element) { none(type, 'Choice'); break; }
        // Barrier entries ("@barrier") are no damage and keep their kind.
        const damaging = (data.damages ?? []).filter(damage => damage.damageType !== '@barrier' && damage.damageType !== '@manaRestore');
        if (!damaging.length) { none(type, 'Damage'); break; }
        const wasLife = damaging.some(damage => damage.damageType === 'life');
        for (const damage of damaging) damage.damageType = element;
        if (element === 'life' && !wasLife) {
          // Element Leben: the damage needs neither an attack roll nor a saving
          // throw - it applies unconditionally. An attack roll that is still
          // needed for a status/Foundry effect stays.
          for (const damage of damaging) {
            if (damage.trigger === 'attack' || damage.trigger === 'save') { damage.trigger = 'unconditional'; damage.savingThrowIndex = null; }
          }
          const needsAttack = [...(data.statusEffects ?? []), ...(data.foundryEffects ?? [])].some(entry => entry.trigger === 'attack');
          if (data.attackRoll && !needsAttack) data.attackRoll.enabled = false;
          note(type, 'LifeNoRoll');
        } else if (wasLife && element !== 'life') {
          // A spell that was Leben before now needs an attack roll against the
          // target's Magieresistenz.
          for (const damage of damaging) {
            if (damage.trigger === 'unconditional') damage.trigger = 'attack';
          }
          data.attackRoll = { ...(data.attackRoll ?? {}), enabled: true, count: Math.max(1, data.attackRoll?.count ?? 1) };
          note(type, 'FromLife');
        }
        if (isSchoolSpell && ['fire', 'water', 'earth', 'air', 'life', 'death', 'light', 'nature', 'dark'].includes(element)) {
          data.magicSchool = element;
        }
        addPercent(20 * (data.spellLevel ?? 1));
        note(type, 'Applied', { element });
        break;
      }
      case 'hinder': {
        const delta = Math.floor(mk / 2);
        if (!(data.savingThrows ?? []).length) { none(type, 'Save'); break; }
        if (delta <= 0) { none(type, 'Limit'); break; }
        const sign = param === 1 ? -1 : 1;
        for (const save of data.savingThrows) save.baseValue = Math.max(0, (save.baseValue ?? 0) + sign * delta);
        const highest = Math.max(...data.savingThrows.map(save => save.baseValue ?? 0));
        addFlat(highest * 5);
        note(type, 'Applied', { delta: sign * delta, dc: highest });
        break;
      }
      case 'strengthen': {
        if (!dealsDice()) { none(type, 'Dice'); break; }
        let total = 0;
        for (const damage of data.damages) {
          damage.formula = mapDice(damage.formula, (count, faces) => {
            total += count;
            return `${count}d${faces}min${Math.ceil(faces / 2)}`;
          });
        }
        addFlat(Math.max(1, total * 5 - mk));
        note(type, 'Applied', { dice: total });
        break;
      }
      case 'maximize': {
        if (!dealsDice()) { none(type, 'Dice'); break; }
        for (const damage of data.damages) damage.formula = mapDice(damage.formula, (count, faces) => String(count * faces));
        addFlat(Math.max(1, Math.floor(0.25 * baseMana() * (data.spellLevel ?? 1) - mk)));
        note(type, 'Applied');
        break;
      }
      case 'hateful': {
        // Hasserfüllte Macht: only an attack spell can be changed. The Life it
        // costs is paid with the cast (data.hatefulLifeCost, see
        // helpers/spell-rolls.mjs#paySpellCast); it depends on this spell's level.
        if (!data.attackRoll?.enabled) { none(type, 'Attack'); break; }
        const options = decodeHatefulOptions(param);
        const level = Math.max(1, data.spellLevel ?? 1);
        const parts = [];
        let life = 0;
        if (options.targeted) {
          data.metaAutoHit = true;
          life += Math.max(3, 3 * level);
          parts.push(game.i18n.localize('SKSK.Metamagic.Hateful.Targeted'));
        }
        if (options.maximum) {
          data.metaAutoHit = true;
          for (const damage of data.damages ?? []) damage.formula = mapDice(damage.formula, (count, faces) => String(count * faces));
          life += 6 * level;
          parts.push(game.i18n.localize('SKSK.Metamagic.Hateful.Maximum'));
        }
        if (options.strengthened) {
          const paid = Math.max(2, 2 * level);
          const target = (data.damages ?? []).find(damage => damage.trigger === 'attack') ?? (data.damages ?? [])[0];
          if (target) target.formula = `${target.formula} + ${3 * paid}`;
          life += paid;
          parts.push(game.i18n.format('SKSK.Metamagic.Hateful.Strengthened', { damage: 3 * paid }));
        }
        if (options.tenacious) {
          const penalty = Math.max(1, Math.min(options.tenacious, Math.ceil(mk / 2)));
          for (const save of data.savingThrows ?? []) save.baseValue = Math.max(0, (save.baseValue ?? 0) + penalty);
          life += 6 * penalty;
          parts.push(game.i18n.format('SKSK.Metamagic.Hateful.Tenacious', { penalty }));
        }
        if (options.devouring) {
          const darkLevel = actor ? getActorSkillLevel(actor, 'dark') : 0;
          const bloodLevel = actor ? getActorSkillLevel(actor, 'blood') : 0;
          const paid = Math.max(1, Math.min(options.devouring, mk + darkLevel + bloodLevel));
          addFlat(-2 * paid);
          life += paid;
          parts.push(game.i18n.format('SKSK.Metamagic.Hateful.Devouring', { mana: 2 * paid }));
        }
        if (options.infinite) {
          const factor = 1 + level;
          const scaled = scaleDurationText(data.duration, factor);
          if (scaled) data.duration = scaled.text;
          data.metaDurationMultiplier = (data.metaDurationMultiplier ?? 1) * factor;
          life += 3 * level;
          parts.push(game.i18n.format('SKSK.Metamagic.Hateful.Infinite', { factor }));
        }
        data.hatefulLifeCost = (data.hatefulLifeCost ?? 0) + life;
        note(type, 'Applied', { life, options: parts.join(', ') });
        break;
      }
      case 'transcend': {
        let applied = false;
        if (dealsDice()) {
          for (const damage of data.damages) damage.formula = mapDice(damage.formula, (count, faces) => `${count * 2}d${faces}`);
          applied = true;
        }
        let saved = 0;
        if ((data.apCostUnit ?? 'ap') === 'ap') {
          const before = data.apCost ?? 1;
          data.apCost = 1;
          saved = Math.max(1, before - 1);
          applied = true;
        }
        const scaled = scaleDurationText(data.duration, 2);
        if (scaled) { data.duration = scaled.text; data.metaDurationMultiplier = (data.metaDurationMultiplier ?? 1) * 2; applied = true; }
        let rangeSum = 0;
        for (const range of data.ranges ?? []) {
          if (range.indicator === 'self') continue;
          range.distance = (range.distance ?? 0) * 2;
          rangeSum += range.distance;
          applied = true;
        }
        if (!applied) { none(type, 'Nothing'); break; }
        addFlat((data.spellLevel ?? 1) * saved + Math.floor(rangeSum / 2));
        note(type, 'Applied');
        break;
      }
      case 'extend': {
        const factor = mk >= 10 ? 4 : (mk >= 5 ? 3 : 2);
        const scaled = scaleDurationText(data.duration, factor, 86400);
        if (!scaled) { none(type, 'Duration'); break; }
        data.duration = scaled.text;
        data.metaDurationMultiplier = (data.metaDurationMultiplier ?? 1) * factor;
        addFlat(Math.max(1, (data.spellLevel ?? 1) * 10 - mk));
        note(type, 'Applied', { factor, from: scaled.from, to: scaled.to });
        break;
      }
      case 'distance': {
        if (isMartial || isDraconic) { none(type, 'Excluded'); break; }
        const ranges = data.ranges ?? [];
        let target = ranges.find(range => range.indicator !== 'self' && (range.distance ?? 0) > 0);
        if (!target) target = ranges.find(range => range.indicator === 'touch');
        if (!target && mk >= 5) target = ranges.find(range => range.indicator === 'self');
        if (!target) { none(type, 'Range'); break; }
        const before = `${target.distance ?? 0} m`;
        if (target.indicator === 'self') {
          target.indicator = 'touch';
          target.distance = mk >= 10 ? 8 : 4;
          addPercent(5 * mk);
        } else if (target.indicator === 'touch') {
          if (mk < 5) { none(type, 'Limit'); break; }
          target.distance = Math.max(target.distance ?? 0, mk >= 10 ? 8 : 4);
        } else {
          const current = target.distance ?? 0;
          const added = Math.max(2, current * 0.1 * mk);
          target.distance = roundUpToEven(current + added);
        }
        note(type, 'Applied', { from: before, to: `${target.distance} m` });
        break;
      }
      case 'silent':
      case 'immobile': {
        const method = type === 'silent' ? 'vocal' : 'movement';
        if ((type === 'silent' && isBardic) || (type === 'immobile' && isMartial)) { none(type, 'Excluded'); break; }
        const methods = data.castingMethods ?? {};
        if (!methods[method]) { none(type, 'Method'); break; }
        const others = Object.entries(methods).filter(([key, value]) => key !== method && value === true && key !== 'ritual').length;
        const before = data.apCost ?? 1;
        const isAp = (data.apCostUnit ?? 'ap') === 'ap';
        methods[method] = false;
        let saved = 0;
        if (!others) {
          methods.runes = true;
          if (isAp) { data.apCost = Math.max(1, Math.ceil(before / 2)); saved = before - data.apCost; }
        } else if (isAp) {
          data.apCost = Math.max(1, before - 1);
          saved = before - data.apCost;
        }
        if (saved > 0) addPercent(10 * saved);
        note(type, others ? 'Applied' : 'AppliedRunes', { saved });
        break;
      }
      case 'secure': {
        addFlat((data.spellLevel ?? 1) * 5);
        note(type, 'Applied', { count: (env.wil !== undefined || actor) ? mk * (mk >= 10 ? Math.max(1, env.wil ?? actor?.system?.attributes?.wil?.mod ?? 1) : 1) : mk, rounds: Math.floor(mk / 2) });
        break;
      }
      case 'double': {
        const direct = (data.ranges ?? []).some(range => DIRECT_INDICATORS.has(range.indicator));
        if (!direct) { none(type, 'Range'); break; }
        data.metaDouble = true;
        addPercent(mk >= 5 ? 50 : 100);
        note(type, 'Applied');
        break;
      }
      case 'overcharge': {
        const max = Math.min(env.maxOvercharge ?? (actor ? computeMaxOverchargeCount(actor) : 1), Math.max(1, mk));
        const count = Math.min(param, max);
        if (count <= 0) { none(type, 'Limit'); break; }
        data.metaOvercharge = (data.metaOvercharge ?? 0) + count;
        data.overcharge = { ...(data.overcharge ?? {}), manaPercent: 50, manaFlat: 0, apCost: 0 };
        note(type, 'Applied', { count });
        break;
      }
      default:
        break;
    }
  }
  return { notes };
}

// ------------------------------------------------------------------ detection

/**
 * The Metamagie markers on a caster that will change their next spell.
 * @param {Actor} actor
 * @param {Item|null} [item]   The spell about to be cast (a Hasserfüllte Macht marker only applies to one with an attack roll).
 * @return {{codes: number[], markerIds: string[]}}
 */
export function findMetamagicMarkers(actor, item = null) {
  const result = { codes: [], markerIds: [] };
  if (!actor) return result;
  for (const effect of actor.appliedEffects) {
    const code = effect.getFlag('sksk', 'metamagic')?.code;
    if (!isMetamagicCode(code)) continue;
    // Hasserfüllte Macht waits for the next spell that has an attack roll.
    if (isHatefulCode(code) && item && !item.system.attackRoll?.enabled) continue;
    result.codes.push(code);
    result.markerIds.push(effect.id);
  }
  return result;
}

// ------------------------------------------------------------------ casting the Metamagie spell

/**
 * Ask for the choice a Metamagie spell needs while it is cast.
 * @param {Item} item   A spell with a "metamagic" rule.
 * @return {Promise<number|null>}   The choice (0 if none is needed), null if
 *   the dialog was closed.
 */
export async function promptMetamagicChoice(item) {
  const type = item.system.metamagic;
  const actor = item.actor;
  const mk = actor ? getActorSkillLevel(actor, 'magicControl') : 0;
  const L = (key, values) => (values ? game.i18n.format(key, values) : game.i18n.localize(key));
  let field = '';
  if (type === 'raise') {
    field = `<label>${L('SKSK.Metamagic.Prompt.Levels', { max: mk })}</label>
      <input type="number" name="choice" value="1" min="1" max="${Math.max(1, mk)}" step="1" autofocus />`;
  } else if (type === 'overcharge') {
    const max = Math.max(1, Math.min(actor ? computeMaxOverchargeCount(actor) : 1, mk));
    field = `<label>${L('SKSK.Metamagic.Prompt.Overcharge', { max })}</label>
      <input type="number" name="choice" value="1" min="1" max="${max}" step="1" autofocus />`;
  } else if (type === 'element') {
    const options = [...METAMAGIC_ELEMENTS, ...(mk >= 5 ? METAMAGIC_ELEMENTS_ADVANCED : [])]
      .map((key, index) => `<option value="${index}">${game.i18n.localize(CONFIG.SKSK.damageTypes[key] ?? key)}</option>`).join('');
    field = `<label>${L('SKSK.Metamagic.Prompt.Element')}</label><select name="choice">${options}</select>`;
  } else if (type === 'hateful') {
    return promptHatefulChoice(item);
  } else if (type === 'hinder') {
    field = `<label>${L('SKSK.Metamagic.Prompt.Hinder')}</label><select name="choice">
      <option value="0">${L('SKSK.Metamagic.Prompt.HinderHarder')}</option>
      <option value="1">${L('SKSK.Metamagic.Prompt.HinderEasier')}</option></select>`;
  }
  if (!field) return 0;

  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: L('SKSK.Metamagic.Prompt.Title', { name: item.name }) },
    content: `<div class="form-group">${field}</div>`,
    ok: {
      label: L('SKSK.Metamagic.Prompt.Confirm'),
      callback: (event, button) => Number(button.form?.elements?.choice?.value ?? 0),
    },
    rejectClose: false,
  });
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(0, Math.floor(value));
}

/**
 * The level of the caster's "Lehre der Dunkelheit" (the Lehre of Dunkle Magie
 * whose name contains "Dunkelheit"), 0 if there is none or it is not invested.
 * @param {Actor|null} actor
 * @return {number}
 */
export function getDarknessLehreLevel(actor) {
  if (!actor) return 0;
  const lehre = getLehrenDefinitions('dark').find(entry => /dunkelheit|darkness/i.test(entry.name ?? ''));
  return lehre ? getInvestedLehreLevel(actor, 'dark', lehre.id) : 0;
}

/**
 * The options dialog of Hasserfüllte Macht: which hatreds to pay Life for. The
 * Life itself is paid with the next attack spell (its level sets the cost).
 * @param {Item} item
 * @return {Promise<number|null>}   The packed choice (see encodeHatefulOptions), null if closed or nothing was chosen.
 */
async function promptHatefulChoice(item) {
  const actor = item.actor;
  const L = (key, values) => (values ? game.i18n.format(key, values) : game.i18n.localize(key));
  const mk = actor ? getActorSkillLevel(actor, 'magicControl') : 0;
  const darkLevel = actor ? getActorSkillLevel(actor, 'dark') : 0;
  const bloodLevel = actor ? getActorSkillLevel(actor, 'blood') : 0;
  // Maximaler/Verzehrender/Unendlicher Hass need the Lehre der Dunkelheit on level 3.
  const advanced = getDarknessLehreLevel(actor) >= 3;
  const maxPenalty = Math.max(1, Math.ceil(mk / 2));
  const maxDevour = Math.max(1, mk + darkLevel + bloodLevel);
  const box = (name, label, locked) => `<div class="form-group"><label class="checkbox"><input type="checkbox" name="${name}" ${locked ? 'disabled' : ''} /> ${label}${locked ? ` <em>(${L('SKSK.Metamagic.Hateful.NeedsDark')})</em>` : ''}</label></div>`;
  const content = `<p>${L('SKSK.Metamagic.Hateful.Intro')}</p>
    ${box('targeted', L('SKSK.Metamagic.Hateful.TargetedCost'), false)}
    ${box('strengthened', L('SKSK.Metamagic.Hateful.StrengthenedCost'), false)}
    <div class="form-group"><label class="checkbox"><input type="checkbox" name="tenaciousOn" /> ${L('SKSK.Metamagic.Hateful.TenaciousCost')}</label>
      <input type="number" name="tenacious" value="1" min="1" max="${maxPenalty}" step="1" style="max-width:4em" /></div>
    ${box('maximum', L('SKSK.Metamagic.Hateful.MaximumCost'), !advanced)}
    <div class="form-group"><label class="checkbox"><input type="checkbox" name="devouringOn" ${advanced ? '' : 'disabled'} /> ${L('SKSK.Metamagic.Hateful.DevouringCost', { max: maxDevour })}${advanced ? '' : ` <em>(${L('SKSK.Metamagic.Hateful.NeedsDark')})</em>`}</label>
      <input type="number" name="devouring" value="1" min="1" max="${maxDevour}" step="1" style="max-width:4em" ${advanced ? '' : 'disabled'} /></div>
    ${box('infinite', L('SKSK.Metamagic.Hateful.InfiniteCost'), !advanced)}`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: L('SKSK.Metamagic.Prompt.Title', { name: item.name }) },
    content,
    ok: {
      label: L('SKSK.Metamagic.Prompt.Confirm'),
      callback: (event, button) => {
        const el = button.form.elements;
        return {
          targeted: el.targeted.checked, strengthened: el.strengthened.checked, maximum: el.maximum.checked, infinite: el.infinite.checked,
          tenacious: el.tenaciousOn.checked ? Math.max(1, Math.min(maxPenalty, Number(el.tenacious.value) || 1)) : 0,
          devouring: el.devouringOn.checked ? Math.max(1, Math.min(maxDevour, Number(el.devouring.value) || 1)) : 0,
        };
      },
    },
    rejectClose: false,
  });
  if (!result) return null;
  const packed = encodeHatefulOptions(result);
  if (!packed) {
    ui.notifications.warn(L('SKSK.Metamagic.Hateful.NothingChosen'));
    return null;
  }
  return packed;
}

/**
 * Put the marker of a cast Metamagie spell on its caster.
 * @param {Actor} actor
 * @param {Item} item   The Metamagie spell.
 * @param {number} choice   See promptMetamagicChoice.
 * @return {Promise<string>}   A chat line announcing the marker.
 */
export async function placeMetamagicMarker(actor, item, choice) {
  const code = encodeMetamagic(item.system.metamagic, choice);
  await actor.createEmbeddedDocuments('ActiveEffect', [{
    name: item.name,
    img: item.img,
    origin: item.uuid,
    disabled: false,
    transfer: false,
    duration: { expiry: EXTRA_DAMAGE_USE_EVENT },
    flags: { sksk: { metamagic: { code } } },
  }]);
  return `<div class="sksk-roll-line sksk-roll-metamagic">${game.i18n.format('SKSK.Metamagic.MarkerPlaced', { name: foundry.utils.escapeHTML(item.name) })}</div>`;
}

/**
 * Chat lines describing what the Metamagie of a cast did to the spell.
 * @param {Item} realItem   The spell as stored.
 * @param {number[]} codes
 * @return {string}
 */
export function renderMetamagicLines(realItem, codes) {
  const metaCodes = (codes ?? []).filter(isMetamagicCode);
  if (!metaCodes.length) return '';
  const data = realItem.system.toObject();
  const { notes } = applyMetamagic(data, metaCodes, realItem.actor);
  return notes.map(({ key, data: values }) => {
    const type = key.split('.')[0];
    const label = game.i18n.localize(`SKSK.Metamagic.Type.${type}`);
    const values2 = { ...values };
    if (values2.element) values2.element = game.i18n.localize(CONFIG.SKSK.damageTypes[values2.element] ?? values2.element);
    return `<div class="sksk-roll-line sksk-roll-metamagic"><strong>${label}:</strong> ${game.i18n.format(`SKSK.Metamagic.Note.${key}`, values2)}</div>`;
  }).join('');
}
