/**
 * The extra fields of a Class/Species/Talent ability of the type "once"
 * ("Aktiv (einmaliger Effekt)": a one-off activation like casting a spell, see
 * helpers/abilityRolls.mjs#useOnceAbility). Shared by the Class/Species
 * ability array entries (plain names) and the Talent's own single ability
 * (the same names prefixed with "ability", see prefixOnceAbilityFields).
 *
 * - effectSpellUuid: a Spell item (anywhere, by UUID) whose effect (attack,
 *   damage, saving throws, status/Foundry effects, variants, ...) is rolled
 *   through the normal spell logic on activation - costs, charges and
 *   cooldown always come from the ability itself, never from that spell.
 * - chargesFormula: the maximum number of charges, a formula ("L / 2",
 *   "@attributes.str.mod * L", "@skills.adrenalin * @attributes.con.mod");
 *   blank = the ability has no charges.
 * - chargesUsed: how many of those charges are currently spent.
 * - chargeRecovery: how spent charges come back (see helpers/
 *   abilityCharges.mjs).
 *
 * @param {object} fields   foundry.data.fields
 * @param {object} requiredInteger
 * @return {Object<string, foundry.data.fields.DataField>}
 */
export function buildOnceAbilityFields(fields, requiredInteger) {
  return {
    effectSpellUuid: new fields.StringField({ required: true, blank: true, initial: "" }),
    chargesFormula: new fields.StringField({ required: true, blank: true, initial: "" }),
    chargesUsed: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    chargeRecovery: new fields.ArrayField(new fields.SchemaField({
      // "turnStart": at the start of the ability owner's Combat turn.
      // "segments": per interval Abschnitte (30 min) of a Pause.
      // "day": at the change of day (Calendaria; without it after an
      //   Anpassungspause).
      // "time": per interval minutes/hours/days of passing world time.
      mode: new fields.StringField({ required: true, blank: false, initial: "turnStart", choices: ["turnStart", "segments", "day", "time"] }),
      // Only for "segments" (that many Abschnitte) and "time" (that many units).
      interval: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      unit: new fields.StringField({ required: true, blank: false, initial: "hours", choices: ["minutes", "hours", "days"] }),
      // How many charges come back each time - a formula like chargesFormula,
      // so it may depend on an attribute modifier or a skill level.
      amountFormula: new fields.StringField({ required: true, blank: true, initial: "1" }),
      // Runtime state - not meant to be hand-edited: the world time (seconds)
      // a "time" recovery last ticked, and the Abschnitte of a "segments"
      // recovery not yet adding up to a whole interval.
      clock: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
      carry: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    })),
    // "Treffer erzwingen" (Zielsicher): a charge of this ability may turn the
    // miss of a weapon/Martial Arts attack into a hit that cannot be averted
    // (see helpers/forceHit.mjs). Needs charges.
    forceHit: new fields.BooleanField({ initial: false }),
  };
}

/**
 * The same fields for the Talent, whose single ability lives directly on the
 * item's root with an "ability" prefix (abilityEffectSpellUuid, ...).
 * @param {object} fields
 * @param {object} requiredInteger
 * @return {Object<string, foundry.data.fields.DataField>}
 */
export function buildTalentOnceAbilityFields(fields, requiredInteger) {
  return Object.fromEntries(Object.entries(buildOnceAbilityFields(fields, requiredInteger))
    .map(([key, field]) => [`ability${key[0].toUpperCase()}${key.slice(1)}`, field]));
}

/**
 * The blank values of those fields, for a Class's spelled-out default
 * ability entries (a partial entry fails validation, see data/class.mjs).
 */
export const ONCE_ABILITY_DEFAULTS = Object.freeze({
  effectSpellUuid: "", chargesFormula: "", chargesUsed: 0, chargeRecovery: [], forceHit: false,
});
