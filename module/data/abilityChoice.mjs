/**
 * The extra fields of a Class/Species ability for ability choices ("Wähle eine
 * der folgenden Fähigkeiten"), see helpers/abilityChoice.mjs:
 *
 * - optionOf: -1 for a normal ability; for an option the index (into the same
 *   abilities array) of the ability it is an option of.
 * - chosen: runtime state on the actor's copy - an option only counts once chosen.
 * - choiceCount: a formula (like the charges one) - how many options of this
 *   ability may be chosen; blank = it has no options.
 * - choiceExtraFrom: indexes (comma separated) of other abilities whose options
 *   may also be chosen here once their own slots are full.
 *
 * @param {object} fields   foundry.data.fields
 * @return {Object<string, foundry.data.fields.DataField>}
 */
export function buildChoiceAbilityFields(fields) {
  return {
    optionOf: new fields.NumberField({ required: true, nullable: false, integer: true, initial: -1, min: -1 }),
    chosen: new fields.BooleanField({ initial: false }),
    choiceCount: new fields.StringField({ required: true, blank: true, initial: "" }),
    choiceExtraFrom: new fields.StringField({ required: true, blank: true, initial: "" }),
  };
}

/** The blank values of those fields, for a Class's spelled-out default ability entries. */
export const CHOICE_ABILITY_DEFAULTS = Object.freeze({
  optionOf: -1, chosen: false, choiceCount: "", choiceExtraFrom: "",
});
