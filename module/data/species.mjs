import SKSKItemBase from "./item-base.mjs";

export default class SKSKSpecies extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // A species is either used directly (main) or stacked onto a main
    // species as an extension (sub), e.g. main species Orc + sub-species
    // Cambion (half-demon).
    schema.speciesType = new fields.StringField({
      required: true, blank: false, initial: "main", choices: ["main", "sub"]
    });

    // Base value granted to the Aura attribute. A character's Aura is the
    // sum of this value from their main species and (if any) sub-species.
    // The field's own min covers a Sub-Species (0 - it doesn't have to add
    // anything to Aura, but still can); a Main Species' stricter minimum
    // of 8 is enforced separately below in validateJoint, since it depends
    // on speciesType.
    schema.aura = new fields.NumberField({ ...requiredInteger, initial: 10, min: 0, max: 20 });

    // The size category (CONFIG.SKSK.sizeCategories) a character of this
    // species defaults to - only the main species' value is used (see
    // helpers/movement.mjs#getActorSizeCategory), not any sub-species.
    schema.sizeCategory = new fields.StringField({
      required: true, blank: false, initial: "medium",
      choices: ["tiny", "small", "medium", "large", "huge", "gigantic", "titanic"]
    });

    // Bonuses to attributes other than Aura. Player-extensible list.
    schema.attributeBonuses = new fields.ArrayField(new fields.SchemaField({
      attribute: new fields.StringField({ required: true, blank: false, initial: "str" }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // Starting bonuses to skills, always granted. Player-extensible list;
    // "skill" holds a key from CONFIG.SKSK.skills (multi-level skills only).
    // "bonus" is a number of whole skill LEVELS granted (e.g. bonus 1 on
    // Axe grants Axe at level 1), not skill points.
    schema.skillBonuses = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
      bonus: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }));

    // 1-3 species abilities, each a freeform description (passive or
    // actively used).
    schema.abilities = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      description: new fields.StringField({ required: true, blank: true }),
      // A scaling life/mana bonus this ability always grants, supporting
      // "L" for the actor's level (e.g. "L * 2") - see
      // helpers/life.mjs#computeMaxLife and helpers/mana.mjs#computeMaxMana.
      lifeBonusFormula: new fields.StringField({ required: true, blank: true, initial: "0" }),
      manaBonusFormula: new fields.StringField({ required: true, blank: true, initial: "0" })
    }));

    // Zero or more overrides granting the ability to cast spells from a
    // specific combined magic school (CONFIG.SKSK.combinedMagicSchools) up
    // to a computed max level, bypassing that school's spells' own
    // combinedSkills prerequisite entirely - e.g. a Dragon casting
    // Drakomancy spells up to half their level. baseFormula supports "L"
    // for the actor's level (e.g. "L / 2"); attributeBonuses/skillBonuses
    // scale the same way a spell's saving throws/damage do, each
    // independently via its own "@value" formula. An actor's effective max
    // level for a school is the highest of every matching override across
    // every Class/Species/Talent item they hold.
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
    // or to all of them at once via "all" - e.g. a Dragon's flying bonus,
    // or a general speed bonus from a swift species. See
    // helpers/movement.mjs#computeMovementSpeeds.
    schema.movementBonuses = new fields.ArrayField(new fields.SchemaField({
      movementType: new fields.StringField({
        required: true, blank: false, initial: "all",
        choices: ["all", "walking", "flying", "hovering", "swimming", "climbing", "digging"]
      }),
      // "bonus" adds this value on top of every other source as before;
      // "override" replaces the actor's own base speed for this movement
      // type outright (before every item's "bonus"-mode entry is summed on
      // top) - e.g. a species whose innate speed isn't a mere bonus but a
      // wholesale replacement of the default. See
      // helpers/movement.mjs#computeMovementSpeeds.
      mode: new fields.StringField({
        required: true, blank: false, initial: "bonus", choices: ["bonus", "override"]
      }),
      bonus: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
      // Marks this movement type as one the species actually grants access
      // to at all (e.g. a species can fly) - unlocked types are floored to
      // a minimum speed based on the actor's size category, applied after
      // every bonus/override above. See helpers/movement.mjs.
      unlocked: new fields.BooleanField({ initial: false }),
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

    return schema;
  }

  /** @override */
  static validateJoint(data) {
    super.validateJoint(data);
    if (data.speciesType === "main" && data.aura < 8) {
      throw new Error("Main Species Aura must be at least 8 (only a Sub-Species may go as low as 0)");
    }
  }
}
