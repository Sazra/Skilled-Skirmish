import SKSKItemBase from "./item-base.mjs";

/**
 * A "Technik" (Technique) - modifies a weapon/Martial Arts attack or a
 * spell cast (see helpers/actions.mjs#rollWeaponItem/rollMartialArtsAttack
 * and helpers/spell-rolls.mjs#renderSpellEffectParts), belongs to exactly
 * one Kampfstil
 * (combat/technique style - see apps/combat-styles-config.mjs, resolved by
 * id against the "combatStyles" world setting), and
 * comes in one of three categories with very different activation shapes:
 * - "stand" (Haltung): toggled active/inactive (like a Totem slot) - costs
 *   apCost/manaCost to activate, stays active for durationRounds (Combat
 *   rounds, ticked at this actor's own turn start - see helpers/
 *   statusEffects.mjs#handleTechniqueTurnStart), then auto-deactivates and
 *   starts cooldownRounds. Grants its own bonus while active via a linked,
 *   freely GM-authored ActiveEffect (effectId, same bind-then-toggle
 *   pattern as Totem); additionally grants same-Kampfstil techniques the
 *   styleAttackBonus/styleDamageBonus/styleApCostDiscount/
 *   styleManaCostDiscount fields below while active.
 * - "attackBonus" (Angriffsboni): "primed" (active=true) ahead of a weapon/
 *   Martial Arts attack or a spell cast - costs apCost/manaCost to prime, no
 *   duration; the very next such attack/cast this actor makes THAT this
 *   Technique is applicable to (applicableToWeapon/applicableToMartialArts/
 *   applicableToSpell - any combination, see helpers/technique-rolls.mjs#
 *   consumePrimedTechnique's own contextType filter) consumes it, then
 *   starts cooldownRounds. Up to three independent bonuses may each be
 *   configured (any combination, or none) - see helpers/technique-rolls.mjs#
 *   applyTechniqueDiceIncrease/applyTechniqueBonusDamage:
 *   - Trefferbonus (hitBonusAmount): a flat bonus added to the attack's own
 *     Angriffswurf (to-hit roll), applied at the call site directly (see
 *     helpers/actions.mjs/helpers/spell-rolls.mjs), same pattern as
 *     styleAttackBonus below.
 *   - Bonusschaden (bonusDamageMode/bonusDamageAmount/bonusDamageFormula):
 *     added to the attack's own already-rolled damage total.
 *   - Schadenswürfelerhöhung (diceIncreaseMode/diceIncreaseAmount): changes
 *     the NUMBER of the attack's own first damage dice term BEFORE it's
 *     rolled ("additive" adds diceIncreaseAmount more dice of that same
 *     size, "multiplicative" multiplies the die count by it).
 * - "effect" (Effekte): behaves exactly like "stand" (effectTarget "self" -
 *   a self buff with duration, via its own linked ActiveEffect, applied
 *   unconditionally, no saving throw), like "attackBonus" (effectTarget
 *   "attackTarget" - primed, then its effect(s) apply to whoever the next
 *   weapon/Martial Arts attack or spell cast hits), or immediately, with no
 *   priming and no connection to an attack/cast at all (effectTarget
 *   "direct" - applied right at activation to a resolved target, see
 *   helpers/technique-rolls.mjs#activateDirectEffectTechnique). Its
 *   effect(s) are its own linked freeform ActiveEffect (effectId) and/or a
 *   list of predefined status effects (effectStatusEffects) - both may be
 *   set at once. For effectTarget "attackTarget"/"direct", an optional
 *   saving throw (effectSavingThrowEnabled + fields below, same shape as
 *   Spell's own savingThrows entries minus the nested bonus lists) gates
 *   whether the effect(s) actually land - see helpers/technique-rolls.mjs#
 *   rollTechniqueEffectSaveFromChat; with no saving throw configured, the
 *   effect(s) apply unconditionally instead - via the normal Apply Damage/
 *   Effect chat button for "attackTarget" (see helpers/damageApplication.mjs#
 *   applyDamageFromChat), or immediately for "direct".
 *
 * Concurrency across an actor's own Techniques (see helpers/technique-
 * rolls.mjs#findPendingAttackSlotTechnique/toggleStandTechnique/
 * toggleSelfEffectTechnique): only one "stand" may ever be active at once
 * (activating a second one is blocked until the first is deactivated); an
 * unlimited number of different "effect"/"self" Techniques may be active
 * simultaneously, with each other and with a "stand"; exactly one
 * "attackBonus" OR "effect"/"attackTarget" Technique may be primed at a
 * time (they share the one "next attack/cast" slot) - but that single
 * primed one may coexist freely with an active "stand" and any number of
 * active "effect"/"self" Techniques. "effect"/"direct" never occupies any
 * slot at all - it resolves immediately, with no persistent state.
 *
 * No skill-level prerequisite - owning the Item is enough to use it, same
 * as Weapons.
 */
export default class SKSKTechnique extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.category = new fields.StringField({
      required: true, blank: false, initial: "stand",
      choices: ["stand", "attackBonus", "effect"]
    });

    // Resolved against the "combatStyles" world setting's own {id, name}
    // list at render/roll time - blank until the GM has defined at least
    // one style and the player picks one.
    schema.combatStyle = new fields.StringField({ required: true, blank: true, initial: "" });

    schema.apCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.manaCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.cooldownRounds = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Only meaningful for "stand", and "effect" with effectTarget "self" -
    // "attackBonus" and effectTarget "attackTarget" have no duration of
    // their own; they're consumed by the next attack/cast instead.
    schema.durationRounds = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });

    // Only meaningful for category "attackBonus" - the Bonusschaden block.
    // "none": disabled. "flat": bonusDamageAmount added to the attack's own
    // damage. "multiply": the attack's own damage multiplied by
    // bonusDamageAmount (rounded). "formula": bonusDamageFormula (e.g.
    // "2d6") rolled fresh and added.
    schema.bonusDamageMode = new fields.StringField({
      required: true, blank: false, initial: "none", choices: ["none", "flat", "multiply", "formula"]
    });
    schema.bonusDamageAmount = new fields.NumberField({ required: true, nullable: false, initial: 0 });
    schema.bonusDamageFormula = new fields.StringField({ required: true, blank: true, initial: "" });

    // Only meaningful for category "attackBonus" - the Schadenswürfelerhöhung
    // block, independent of Bonusschaden above (both may be active at once).
    // "none": disabled. "additive": diceIncreaseAmount more dice of the
    // attack's own first damage die size. "multiplicative": that die's own
    // count multiplied by diceIncreaseAmount (rounded).
    schema.diceIncreaseMode = new fields.StringField({
      required: true, blank: false, initial: "none", choices: ["none", "additive", "multiplicative"]
    });
    schema.diceIncreaseAmount = new fields.NumberField({ required: true, nullable: false, initial: 0 });

    // Only meaningful for category "attackBonus" - Trefferbonus (hit bonus):
    // a flat bonus added to the primed attack's own Angriffswurf (to-hit
    // roll), independent of Bonusschaden/Schadenswürfelerhöhung above (all
    // three may be set at once).
    schema.hitBonusAmount = new fields.NumberField({ required: true, nullable: false, initial: 0 });

    // Only meaningful for category "attackBonus" - which kind(s) of attack
    // this Technique may be primed for/consumed by; at least one should be
    // checked for the Technique to ever actually apply (see helpers/
    // technique-rolls.mjs#consumePrimedTechnique's own contextType filter).
    // Default true on all three so existing Techniques (authored before this
    // split existed) keep applying to every attack type, as before.
    schema.applicableToWeapon = new fields.BooleanField({ initial: true });
    schema.applicableToMartialArts = new fields.BooleanField({ initial: true });
    schema.applicableToSpell = new fields.BooleanField({ initial: true });

    // Only meaningful for category "effect" - who effectId/effectStatusEffects
    // below end up applied to. "direct": applied immediately on activation,
    // to a resolved target (helpers/damageApplication.mjs#
    // resolveClickDefender) - no priming, no connection to a weapon/Martial
    // Arts attack or spell cast at all (unlike "attackTarget").
    schema.effectTarget = new fields.StringField({
      required: true, blank: false, initial: "self", choices: ["self", "attackTarget", "direct"]
    });

    // Only meaningful for category "effect" - a list of predefined status
    // effects (resolved by id against the "statusEffects" world setting,
    // same list apps/status-effects-config.mjs edits) this Technique applies,
    // alongside/instead of its own freeform linked ActiveEffect (effectId
    // below). May be combined with effectId - both apply together.
    schema.effectStatusEffects = new fields.ArrayField(new fields.SchemaField({
      statusId: new fields.StringField({ required: true, blank: true, initial: "" }),
      stacks: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
    }));

    // Only meaningful for category "effect" with effectTarget "attackTarget"
    // or "direct" - whether landing effectId/effectStatusEffects requires
    // the target to first fail a saving throw (see helpers/technique-
    // rolls.mjs#rollTechniqueEffectSaveFromChat). A deliberately simplified
    // version of
    // Spell's own savingThrows entry shape (data/spell.mjs) - no nested
    // attribute/skill bonus lists, just a flat DC and which attribute/skill
    // the target may test with.
    schema.effectSavingThrowEnabled = new fields.BooleanField({ initial: false });
    schema.effectSavingThrowBaseValue = new fields.NumberField({ ...requiredInteger, initial: 10 });
    schema.effectSavingThrowTestAttributes = new fields.SchemaField({
      str: new fields.BooleanField({ initial: false }),
      dex: new fields.BooleanField({ initial: false }),
      con: new fields.BooleanField({ initial: false }),
      per: new fields.BooleanField({ initial: false }),
      wil: new fields.BooleanField({ initial: false }),
      aur: new fields.BooleanField({ initial: false }),
      cha: new fields.BooleanField({ initial: false }),
      app: new fields.BooleanField({ initial: false }),
    });
    schema.effectSavingThrowTestSkills = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false, initial: "stealth" })
    );

    // Only meaningful for category "stand" - the flat bonus every OTHER
    // technique of the same combatStyle gets while this stand is active,
    // applied at that other technique's own activation/consumption time
    // (see helpers/technique-rolls.mjs). Everything else a stand might
    // grant (AC/MR, resource points, attribute/skill boosts, ...) goes
    // through its own linked ActiveEffect (effectId) instead - freeform,
    // via Foundry's native effect editor.
    schema.styleAttackBonus = new fields.NumberField({ required: true, nullable: false, initial: 0 });
    schema.styleDamageBonus = new fields.NumberField({ required: true, nullable: false, initial: 0 });
    schema.styleApCostDiscount = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.styleManaCostDiscount = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Runtime state - not meant to be hand-edited via the sheet's own form,
    // only via the Activate/Deactivate button and the turn-start cooldown/
    // duration tick (helpers/technique-rolls.mjs, helpers/statusEffects.mjs#
    // handleTechniqueTurnStart). "active" means "currently in effect" for
    // stand/effect-self, or "primed, awaiting the next attack/cast" for
    // attackBonus/effect-attackTarget. roundsRemaining counts down the
    // duration while active, then (once inactive) the cooldown - both share
    // the one field since a technique is never simultaneously active and on
    // cooldown.
    schema.active = new fields.BooleanField({ initial: false });
    schema.roundsRemaining = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // The linked ActiveEffect (stand's/self-effect's own bonus-while-active,
    // or attackTarget-effect's payload applied to whoever gets hit) - blank
    // until first activated, same bind-then-toggle pattern as Totem.
    schema.effectId = new fields.StringField({ required: true, blank: true, initial: "" });

    return schema;
  }

  /**
   * Migrate the old "bonusDamage" category value (renamed to "attackBonus"
   * when Bonusschaden/Schadenswürfelerhöhung became independently
   * configurable) on any Technique still carrying it in stored data.
   * @override
   */
  static migrateData(source) {
    if (source.category === 'bonusDamage') source.category = 'attackBonus';
    return super.migrateData(source);
  }
}
