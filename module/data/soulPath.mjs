import SKSKItemBase from "./item-base.mjs";

/**
 * A "Seelenpfad" (Soul Path) - a GM-authored progression path bound to a
 * single actor (see helpers/soulPathRolls.mjs#getSoulPathItem; enforced as
 * at most one per actor by sheets/actor-sheet.mjs's own creation/drop
 * guards), unlocked once Seelenstärke reaches level 5 or the GM tab's own
 * soulPowerResourceEnabled switch is on (data/actor-base.mjs). Made up of:
 * - A handful of Properties (elements, pathType, description).
 * - A list of "Pfadfähigkeiten" (path abilities, see pathAbilities below),
 *   either freely usable (once unlocked) or gated behind a specific
 *   Durchbruch (breakthrough).
 * - 5 ordered progression stages (sammlung/staerkung/kristallisierung/
 *   erwachen/aufstieg - see helpers/config.mjs#soulPathStages), each a list
 *   of Durchbrüche the actor attempts, in order, spending their own
 *   Seelenmacht (soulPower) pool on a d100 check - see helpers/
 *   soulPathRolls.mjs#attemptBreakthrough for the full mechanic (entire
 *   pool consumed, roll + bonuses vs difficulty).
 */
export default class SKSKSoulPath extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // Multi-select - every damage type/magic school this path is attuned
    // to, plus "mana" itself - see helpers/config.mjs#pathElements.
    schema.elements = new fields.ArrayField(new fields.StringField({ required: true, blank: false }));

    schema.pathType = new fields.StringField({
      required: true, blank: false, initial: "weapon",
      choices: ["weapon", "body", "magic", "hybridWeaponBody", "hybridWeaponMagic", "hybridBodyMagic", "hybridAll"],
    });

    // A Path Ability's own linked ActiveEffect (effectId below) always
    // lives on the actor that owns this Item (same actor this Soul Path is
    // bound to) - created disabled, same bind-then-toggle pattern as
    // helpers/totem.mjs's own per-slot effectId. "active" ones toggle it
    // on/off exactly like a Technique "stand" (apCost/manaCost/
    // durationRounds/cooldownRounds/active/roundsRemaining - see
    // data/technique.mjs); "passive" ones just enable it permanently the
    // moment the ability becomes visible (unlocked).
    schema.pathAbilities = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true, initial: "" }),
      description: new fields.StringField({ required: true, blank: true, initial: "" }),
      type: new fields.StringField({ required: true, blank: false, initial: "passive", choices: ["active", "passive"] }),
      apCost: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      manaCost: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      durationRounds: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      cooldownRounds: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      active: new fields.BooleanField({ initial: false }),
      roundsRemaining: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      effectId: new fields.StringField({ required: true, blank: true, initial: "" }),
      // Whether this ability stays hidden on the actor sheet until a
      // specific Durchbruch (requiredStage + requiredBreakthroughIndex,
      // resolved against this same Item's own stage arrays below) has
      // completedCount >= 1 - see helpers/soulPathRolls.mjs#
      // isPathAbilityVisible. Blank requiredStage = never locked.
      lockedBehindBreakthrough: new fields.BooleanField({ initial: false }),
      requiredStage: new fields.StringField({
        required: true, blank: true, initial: "",
        choices: ["", "sammlung", "staerkung", "kristallisierung", "erwachen", "aufstieg"],
      }),
      requiredBreakthroughIndex: new fields.NumberField({ required: true, nullable: true, integer: true, initial: null, min: 0 }),
    }));

    // One shared shape for every stage's own Durchbruch (breakthrough)
    // entries - see helpers/soulPathRolls.mjs#attemptBreakthrough for how
    // cost/difficulty/mode/completedCount interact. completedCount is the
    // single source of truth for every unlock/attemptability check
    // (helpers/soulPathRolls.mjs#isBreakthroughUnlocked/
    // isBreakthroughAttemptable) regardless of mode; "completed" is kept
    // purely as a human-readable flag for "once"-mode entries.
    const breakthroughEntry = () => new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true, initial: "" }),
      description: new fields.StringField({ required: true, blank: true, initial: "" }),
      // Own linked ActiveEffect (actor-side, Totem-style bind-then-toggle)
      // - auto-enabled the moment completedCount first reaches 1, never
      // re-toggled on later completions of a repeatable entry.
      effectId: new fields.StringField({ required: true, blank: true, initial: "" }),
      cost: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      difficulty: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      mode: new fields.StringField({
        required: true, blank: false, initial: "once",
        choices: ["once", "repeatableUntilNext", "repeatable"],
      }),
      completed: new fields.BooleanField({ initial: false }),
      completedCount: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // Only meaningful for the two repeatable modes - added on top of
      // cost/difficulty, scaled by completedCount, for each further
      // attempt (see helpers/soulPathRolls.mjs#getBreakthroughEffectiveValues).
      costIncreasePerCompletion: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      difficultyIncreasePerCompletion: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    });

    schema.sammlung = new fields.ArrayField(breakthroughEntry());
    schema.staerkung = new fields.ArrayField(breakthroughEntry());
    schema.kristallisierung = new fields.ArrayField(breakthroughEntry());
    schema.erwachen = new fields.ArrayField(breakthroughEntry());
    schema.aufstieg = new fields.ArrayField(breakthroughEntry());

    // Zero or more bonuses adjusting a specific skill's pending FP gain
    // ("gain" - see actor-base.mjs) whenever it's granted - positive/negative
    // flat amounts, a multiplicative percentage (multiple multiplicative
    // entries combine additively before applying), or an unconditional
    // "forceZero" override. See helpers/skillFp.mjs#applySkillFpGainBonus.
    schema.fpGainBonuses = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: true, initial: "" }),
      bonusType: new fields.StringField({
        required: true, blank: false, initial: "positive",
        choices: ["positive", "negative", "multiplicative", "forceZero"]
      }),
      amount: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
      allowZero: new fields.BooleanField({ initial: false }),
    }));

    return schema;
  }
}
