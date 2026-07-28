import SKSKItemBase from "./item-base.mjs";

export default class SKSKClass extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.classType = new fields.StringField({
      required: true, blank: false, initial: "first", choices: ["first", "second", "third", "advanced"]
    });

    // A character/NPC's base life is the first + second class's life
    // values added together, multiplied by level.
    schema.life = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Starting bonuses to skills. Player-extensible list; "skill" holds a
    // key from CONFIG.SKSK.skills (multi-level skills only). "bonus" is a
    // number of whole skill LEVELS granted (e.g. bonus 1 on Axe grants Axe
    // at level 1), not skill points. Only granted when classType is "first"
    // - for second/third/advanced classes the sheet instead presents this
    // same list as skill prerequisites.
    schema.skillBonuses = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // A class always has exactly 3 abilities, each a freeform description
    // that can carry its own Active Effects.
    schema.abilities = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      description: new fields.StringField({ required: true, blank: true }),
      // A scaling life/mana bonus this ability grants once unlocked,
      // supporting "L" for the actor's level (e.g. "L * 2") - see
      // helpers/life.mjs#computeMaxLife and helpers/mana.mjs#computeMaxMana.
      lifeBonusFormula: new fields.StringField({ required: true, blank: true, initial: "0" }),
      manaBonusFormula: new fields.StringField({ required: true, blank: true, initial: "0" })
    }), {
      initial: [
        { name: "", description: "", lifeBonusFormula: "0", manaBonusFormula: "0" },
        { name: "", description: "", lifeBonusFormula: "0", manaBonusFormula: "0" },
        { name: "", description: "", lifeBonusFormula: "0", manaBonusFormula: "0" }
      ]
    });

    // Zero or more overrides granting the ability to cast spells from a
    // specific combined magic school (CONFIG.SKSK.combinedMagicSchools) up
    // to a computed max level, bypassing that school's spells' own
    // combinedSkills prerequisite entirely - e.g. a Priest of Light casting
    // Miracles up to their Light skill's level, regardless of what any
    // individual Miracle spell's own combinedSkills demands. baseFormula
    // supports "L" for the actor's level (e.g. "L / 2"); attributeBonuses/
    // skillBonuses scale the same way a spell's saving throws/damage do,
    // each independently via its own "@value" formula. An actor's effective
    // max level for a school is the highest of every matching override
    // across every Class/Species/Talent item they hold.
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
    // spellType) - e.g. a Priest of Light's flat "character level" discount
    // on Light spells and Miracles, or a Necromancer's 50% discount on
    // Necromancy. percent stacks additively with every other source
    // (including the caster's own Magic Control/Ritualism-based discount);
    // flatFormula supports "L" for the actor's level. Flat reductions apply
    // before percent ones, and the result normally can't drop below 1 -
    // allowBelowOne lets THIS entry's flat reduction push it as low as 0.
    // See helpers/spells.mjs#computeSpellManaCost.
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
    // Adrenalin, but not Luck, which can't be increased). See
    // helpers/generalResources.mjs.
    schema.chargeBonuses = new fields.ArrayField(new fields.SchemaField({
      resource: new fields.StringField({
        required: true, blank: false, initial: "meditation",
        choices: ["meditation", "regeneration", "inspiration", "adrenalin"]
      }),
      bonus: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
    }));

    return schema;
  }
}
