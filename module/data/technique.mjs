import SKSKItemBase from "./item-base.mjs";

/**
 * A "Technik" (Technique) - modifies a weapon/Martial Arts attack or a
 * spell cast (see helpers/actions.mjs#rollWeaponItem/rollMartialArtsAttack
 * and helpers/spell-rolls.mjs#renderSpellEffectParts; a target-"effect"
 * Technique's own linked ActiveEffect isn't actually applied to whoever
 * gets hit yet, for either path), belongs to exactly one Kampfstil
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
 * - "bonusDamage" (Bonusschaden): "primed" (active=true) ahead of a weapon/
 *   Martial Arts attack - costs apCost/manaCost to prime, no duration; the
 *   very next such attack this actor makes consumes it (adds
 *   bonusDamageAmount flat damage, or multiplies the attack's own damage by
 *   that amount, depending on bonusDamageMode), then starts cooldownRounds.
 *   Only one non-"stand" technique may be primed at a time.
 * - "effect" (Effekte): either behaves exactly like "stand" (effectTarget
 *   "self" - a self buff with duration, via its own linked ActiveEffect) or
 *   exactly like "bonusDamage" (effectTarget "attackTarget" - primed, then
 *   applies its linked ActiveEffect to whoever the next weapon/Martial Arts
 *   attack hits instead of adding damage), per-technique configurable.
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
      choices: ["stand", "bonusDamage", "effect"]
    });

    // Resolved against the "combatStyles" world setting's own {id, name}
    // list at render/roll time - blank until the GM has defined at least
    // one style and the player picks one.
    schema.combatStyle = new fields.StringField({ required: true, blank: true, initial: "" });

    schema.apCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.manaCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.cooldownRounds = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Only meaningful for "stand", and "effect" with effectTarget "self" -
    // "bonusDamage" and effectTarget "attackTarget" have no duration of
    // their own; they're consumed by the next attack instead.
    schema.durationRounds = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });

    // Only meaningful for category "bonusDamage".
    schema.bonusDamageMode = new fields.StringField({
      required: true, blank: false, initial: "flat", choices: ["flat", "multiply"]
    });
    // "flat" mode: a flat amount added to the next attack's own damage.
    // "multiply" mode: the factor the next attack's own damage is
    // multiplied by (e.g. 2 doubles it).
    schema.bonusDamageAmount = new fields.NumberField({ required: true, nullable: false, initial: 0 });

    // Only meaningful for category "effect" - who the linked ActiveEffect
    // (effectId below) ends up applied to.
    schema.effectTarget = new fields.StringField({
      required: true, blank: false, initial: "self", choices: ["self", "attackTarget"]
    });

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
    // stand/effect-self, or "primed, awaiting the next attack" for
    // bonusDamage/effect-attackTarget. roundsRemaining counts down the
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
}
