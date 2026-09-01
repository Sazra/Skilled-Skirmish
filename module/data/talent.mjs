import SKSKItemBase from "./item-base.mjs";

export default class SKSKTalent extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.talentType = new fields.StringField({
      required: true, blank: false, initial: "level6",
      choices: ["level6", "level12", "level18", "level24", "mythic", "bonus", "bloodline"]
    });

    // Freeform, player-visible prerequisite text (minimum level, attribute/
    // skill minimums, other required talents, etc.) - shown on the Talent
    // tab, since a player needs to see this to know whether they can take
    // the talent (unlike gmNotes below, which is GM-only).
    schema.prerequisites = new fields.StringField({ required: true, blank: true });

    // Freeform GM-only notes - not mechanically enforced by anything, just
    // a place to jot down effects that don't cleanly map to a structured
    // field (see module/data/class.mjs#gmNotes for the same pattern).
    schema.gmNotes = new fields.StringField({ required: true, blank: true });

    // Bonuses to attributes. Player-extensible list, like species/class.
    schema.attributeBonuses = new fields.ArrayField(new fields.SchemaField({
      attribute: new fields.StringField({ required: true, blank: false, initial: "str" }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // Starting bonuses to skills, granted whenever this Talent is owned.
    // Player-extensible list; "skill" holds a key from CONFIG.SKSK.skills
    // (multi-level skills only, same as Species/Class). "bonus" is a number
    // of whole skill LEVELS granted, not skill points - see
    // helpers/skills.mjs#computeSkillBonusTotals.
    schema.skillBonuses = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // A talent grants exactly one ability, described here (no name needed).
    // Any Active Effects on the item itself belong to this ability.
    schema.ability = new fields.StringField({ required: true, blank: true });

    // A scaling life/mana bonus this ability always grants, supporting "L"
    // for the actor's level (e.g. "L * 2") - see
    // helpers/life.mjs#computeMaxLife and helpers/mana.mjs#computeMaxMana.
    schema.lifeBonusFormula = new fields.StringField({ required: true, blank: true, initial: "0" });
    schema.manaBonusFormula = new fields.StringField({ required: true, blank: true, initial: "0" });

    // Zero or more overrides granting the ability to cast spells from a
    // specific combined magic school (CONFIG.SKSK.combinedMagicSchools) up
    // to a computed max level, bypassing that school's spells' own
    // combinedSkills prerequisite entirely - e.g. a demon casting Demomancy
    // spells up to their Willpower modifier. baseFormula supports "L" for
    // the actor's level (e.g. "L / 2"); attributeBonuses/skillBonuses scale
    // the same way a spell's saving throws/damage do, each independently
    // via its own "@value" formula. An actor's effective max level for a
    // school is the highest of every matching override across every
    // Class/Species/Talent item they hold.
    schema.combinedSchoolOverrides = new fields.ArrayField(new fields.SchemaField({
      combinedSchool: new fields.StringField({ required: true, blank: false, initial: "stormancy" }),
      baseFormula: new fields.StringField({ required: true, blank: true, initial: "0" }),
      attributeBonuses: new fields.ArrayField(new fields.SchemaField({
        attribute: new fields.StringField({ required: true, blank: false, initial: "wil" }),
        useModifier: new fields.BooleanField({ initial: true }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
      skillBonuses: new fields.ArrayField(new fields.SchemaField({
        skill: new fields.StringField({ required: true, blank: false, initial: "magicControl" }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
    }));

    // Zero or more mana-cost discounts for a specific magic school (of any
    // spellType) - e.g. a demon's 50% discount on Demomancy spells, or a
    // flat -5 discount from a piece of gear. percent stacks additively with
    // every other source (including the caster's own Magic Control/
    // Ritualism-based discount); flatFormula supports "L" for the actor's
    // level. Flat reductions apply before percent ones, and the result
    // normally can't drop below 1 - allowBelowOne lets THIS entry's flat
    // reduction push it as low as 0. See helpers/spells.mjs#computeSpellManaCost.
    schema.manaCostReductions = new fields.ArrayField(new fields.SchemaField({
      spellType: new fields.StringField({
        required: true, blank: false, initial: "simple",
        choices: ["simple", "advanced", "combined", "systemless"]
      }),
      school: new fields.StringField({ required: true, blank: false, initial: "fire" }),
      percent: new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0, max: 100 }),
      flatFormula: new fields.StringField({ required: true, blank: true, initial: "0" }),
      allowBelowOne: new fields.BooleanField({ initial: false }),
    }));

    // Zero or more AP-cost discounts for a specific magic school (of any
    // spellType) - flat only (AP costs are small integers, a percentage
    // doesn't make sense here). Only ever applies to a spell that's
    // Mastered or otherwise has its prerequisites met/overridden - see
    // helpers/spells.mjs#computeSpellApCost, which also then applies the
    // caster's Chant Shortening skill on top (down to a floor of 2, unless
    // this reduction already got it lower).
    schema.apCostReductions = new fields.ArrayField(new fields.SchemaField({
      spellType: new fields.StringField({
        required: true, blank: false, initial: "simple",
        choices: ["simple", "advanced", "combined", "systemless"]
      }),
      school: new fields.StringField({ required: true, blank: false, initial: "fire" }),
      flatFormula: new fields.StringField({ required: true, blank: true, initial: "0" }),
    }));

    // Zero or more bonuses to a movement speed (CONFIG.SKSK.movementTypes),
    // or to all of them at once via "all". See
    // helpers/movement.mjs#computeMovementSpeeds.
    schema.movementBonuses = new fields.ArrayField(new fields.SchemaField({
      movementType: new fields.StringField({
        required: true, blank: false, initial: "all",
        choices: ["all", "walking", "flying", "hovering", "swimming", "climbing", "digging"]
      }),
      bonus: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
    }));

    // Zero or more bonuses to a general resource's max charges
    // (CONFIG.SKSK.chargeResources - Meditation/Regeneration/Inspiration/
    // Adrenalin/Luck). See helpers/generalResources.mjs.
    schema.chargeBonuses = new fields.ArrayField(new fields.SchemaField({
      resource: new fields.StringField({
        required: true, blank: false, initial: "meditation",
        choices: ["meditation", "regeneration", "inspiration", "adrenalin", "luck"]
      }),
      bonus: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
    }));

    // Zero or more adjustments to an attribute's natural maximum (20 + 1
    // per level of its own "Unbegrenzte X" skill + 5 if Umlimitiert is
    // active) - add/subtract entries across every source apply first,
    // then multiply/divide ones scale the result. See
    // helpers/attributes.mjs#computeAttributeMax.
    schema.attributeMaxModifiers = new fields.ArrayField(new fields.SchemaField({
      attribute: new fields.StringField({ required: true, blank: false, initial: "str" }),
      operation: new fields.StringField({
        required: true, blank: false, initial: "add",
        choices: ["add", "subtract", "multiply", "divide"]
      }),
      value: new fields.NumberField({ required: true, nullable: false, initial: 1 }),
    }));

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
