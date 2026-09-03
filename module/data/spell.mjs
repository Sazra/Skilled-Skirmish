import SKSKItemBase from "./item-base.mjs";

export default class SKSKSpell extends SKSKItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // Simple/Advanced spells belong to a single magic school (see
    // CONFIG.SKSK.simpleMagicSchools / advancedMagicSchools); Combined
    // spells instead require levels in a combination of skills; Systemless
    // spells belong to no school at all.
    schema.spellType = new fields.StringField({
      required: true, blank: false, initial: "simple",
      choices: ["simple", "advanced", "combined", "systemless"]
    });

    // Drives sort order on the actor sheet's Spells tab (level first, then
    // alphabetically) - not tied to character level or anything else.
    schema.spellLevel = new fields.NumberField({ ...requiredInteger, initial: 1, min: 1, max: 10 });

    // Only meaningful for spellType "simple" or "advanced" - a skill key
    // from that tier's magic-school list.
    schema.magicSchool = new fields.StringField({ required: true, blank: false, initial: "fire" });

    // Only meaningful for spellType "combined": the skills (any category,
    // not just magic schools) and levels required to cast this spell.
    schema.combinedSkills = new fields.ArrayField(new fields.SchemaField({
      skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
      level: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 })
    }));

    // Only meaningful for spellType "combined" - one of CONFIG.SKSK.
    // combinedMagicSchools, purely for organizing the actor sheet's Spells
    // tab (independent of the actual combinedSkills requirements above).
    schema.combinedSchool = new fields.StringField({ required: true, blank: false, initial: "stormancy" });

    // Only meaningful for spellType "systemless" - one of CONFIG.SKSK.
    // systemlessMagicCategories, likewise only for actor-sheet organization.
    schema.systemlessCategory = new fields.StringField({ required: true, blank: false, initial: "general" });

    // Pure lore/flavor flags from the design sheet ("verlorene Kunst"/
    // "verbotene Kunst") - not mechanically enforced by anything, just GM-
    // facing categorization (e.g. for filtering which spells are common
    // knowledge vs. rare/taboo).
    schema.isLostArt = new fields.BooleanField({ initial: false });
    schema.isForbiddenArt = new fields.BooleanField({ initial: false });

    schema.manaCost = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    // Whether manaCost is drained every round (from the caster's CURRENT
    // mana) for as long as this spell is sustaining, instead of only once
    // at cast time - same per-round-drain/auto-deactivate-on-insufficient-
    // mana pattern as Totem (see helpers/statusEffects.mjs#
    // handleTotemTurnStart/handleSpellUpkeepTurnStart), just reusing
    // manaCost itself as the per-round amount rather than a separate field.
    schema.manaCostPerRound = new fields.BooleanField({ initial: false });
    // A continuous mana-CAPACITY cost while this spell is sustaining -
    // reduces the caster's MAXIMUM mana for as long as it's active (not a
    // per-round drain from current mana), summed across every sustaining
    // spell on the actor and capped so it can never push max mana below 0.
    // See helpers/mana.mjs#computeMaxMana.
    schema.upkeep = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Whether this spell's ongoing effect (and therefore its
    // manaCostPerRound/upkeep, if either is set) is currently active on its
    // owning actor. Toggled manually - e.g. once a spell's own stated
    // Duration has run out and the caster chooses to keep sustaining it,
    // per a "kann aufrecht erhalten werden" ("can be sustained") duration -
    // since Duration below is freeform text, not a tracked countdown, this
    // transition isn't automatic.
    schema.sustaining = new fields.BooleanField({ initial: false });
    schema.apCost = new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 });
    // What apCost's own number actually counts - a flat AP amount (the
    // default), a casting time in minutes/hours/days, or a flat RP amount
    // (unit "rp" - see rpCost below for the different, additive-RP case).
    // Minutes drains all of the caster's AP every Combat round for
    // apCost*10 rounds (see helpers/spell-rolls.mjs#rollSpellItem/
    // handlePendingSpellTurnStart); hours/days are pure downtime - no AP
    // cost, no Combat-round tie-in at all. Only ever affects Ritualism's
    // own "hours spent" FP once a "Ritual" casting-method spell resolves
    // (see helpers/spells.mjs#computeRitualHours) for non-"ap" units. Unit
    // "rp" makes apCost a pure Reaction Point cost instead - such a spell
    // has no AP payment path at all, so it can only ever be cast outside
    // the caster's own turn (see helpers/spell-rolls.mjs#rollSpellItem).
    schema.apCostUnit = new fields.StringField({
      required: true, blank: false, initial: "ap",
      choices: ["ap", "minutes", "hours", "days", "rp"]
    });
    // An additional, independent RP cost - only meaningful alongside
    // apCostUnit "ap" (a spell that costs AP on the caster's own turn, but
    // a separately-priced RP amount when cast as a reaction outside it). 0
    // means "not set", which mirrors apCost above instead. RP is never
    // spent on the caster's own turn, and AP is never spent off it -
    // alternate payment paths, not a combined cost.
    schema.rpCost = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Manakern's own flat FP grant (to the "manaCore" skill) whenever this
    // spell is cast - a designer-set value on the item itself, not a GM-
    // configured rate. See helpers/skillFp.mjs#grantFlatSkillFp.
    schema.manaCoreFpGrant = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });

    // One or more ranges, each paired with the indicator describing how
    // that leg of the spell travels/applies (e.g. a fireball is a 30m
    // Projectile followed by a 6m Radius explosion).
    schema.ranges = new fields.ArrayField(new fields.SchemaField({
      distance: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
      indicator: new fields.StringField({
        required: true, blank: false, initial: "projectile",
        choices: ["self", "touch", "targeted", "sight", "hearing", "projectile", "line", "radius", "cone", "square"]
      })
    }), {
      initial: [{ distance: 10, indicator: "projectile" }]
    });

    schema.duration = new fields.StringField({ required: true, blank: true });

    // How the spell is cast; multiple methods can be selected at once.
    schema.castingMethods = new fields.SchemaField({
      vocal: new fields.BooleanField({ initial: false }),
      runes: new fields.BooleanField({ initial: false }),
      movement: new fields.BooleanField({ initial: false }),
      sacrifice: new fields.BooleanField({ initial: false }),
      medium: new fields.BooleanField({ initial: false }),
      ritual: new fields.BooleanField({ initial: false }),
      concentration: new fields.BooleanField({ initial: false }),
    });
    schema.sacrificeDescription = new fields.StringField({ required: true, blank: true });
    schema.mediumDescription = new fields.StringField({ required: true, blank: true });

    // A Mastered spell bypasses every casting prerequisite outright - for
    // Combined spells that means both its own combinedSkills requirement
    // and any Class/Species/Talent combinedSchoolOverrides check (see
    // helpers/spells.mjs#checkCombinedSpellPrerequisite).
    schema.mastered = new fields.BooleanField({ initial: false });

    // Whether Überladen (Overcharge)'s automatic effect scaling (saving
    // throw DC +1, ranges +20%, damage +50%, all per Überladung - see
    // helpers/spell-rolls.mjs#renderSpellEffectParts) applies to this
    // spell. On by default; turn off for a spell whose Overcharge effect
    // is custom/hand-written (e.g. a status effect with no clean formula)
    // - the caster still pays Overcharge's increased AP/Mana cost either
    // way (see helpers/spells.mjs#computeSpellApCost/computeSpellManaCost),
    // just without any automatic scaling - the GM adjusts it manually.
    schema.overchargeAutoEffects = new fields.BooleanField({ initial: true });

    // Whether the spell needs an attack roll at all (vs. the target's
    // Magic Resistance) is left as a placeholder switch for now - the
    // actual roll formula/resolution is built out in a later step. Some
    // spells fire more than one separate attack (e.g. multiple bolts),
    // hence a count rather than a plain toggle.
    schema.attackRoll = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      count: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
    });

    // Zero or more saving throws the target must beat. Each starts from a
    // flat base (usually 10) plus any number of attribute- and skill-based
    // bonuses. Every bonus is scaled by its own formula, where "@value"
    // stands for the chosen attribute's value/modifier or the chosen
    // skill's current level - e.g. a base of 10, an attribute bonus of the
    // Willpower modifier (formula "@value"), and a skill bonus of half the
    // Magic Control level (formula "@value / 2").
    schema.savingThrows = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      baseValue: new fields.NumberField({ ...requiredInteger, initial: 10 }),
      // "Wettstreit" (contest): instead of resolving against a fixed DC
      // (baseValue, ignored while this is on), the caster's own d20 + this
      // save's attribute-/skill-bonuses is rolled once, right when the
      // saving-throw button is rendered in chat, and whoever clicks that
      // button rolls their own d20 + testAttributes/testSkills against
      // that fixed roll instead of a DC - see helpers/spell-rolls.mjs#
      // renderSavingThrowButton/resolveAndRollSavingThrow.
      contest: new fields.BooleanField({ initial: false }),
      attributeBonuses: new fields.ArrayField(new fields.SchemaField({
        attribute: new fields.StringField({ required: true, blank: false, initial: "wil" }),
        // true: the attribute's modifier: false: its full value.
        useModifier: new fields.BooleanField({ initial: true }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
      skillBonuses: new fields.ArrayField(new fields.SchemaField({
        skill: new fields.StringField({ required: true, blank: false, initial: "magicControl" }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
      // What the TARGET rolls to resist this saving throw (d20 + that
      // attribute's modifier, or that skill's level, vs. the value above).
      // Any number of either may be set - the target may use whichever
      // they have. Attributes are a fixed checkbox set (only 8); skills
      // are an open list since there are 100+.
      testAttributes: new fields.SchemaField({
        str: new fields.BooleanField({ initial: false }),
        dex: new fields.BooleanField({ initial: false }),
        con: new fields.BooleanField({ initial: false }),
        per: new fields.BooleanField({ initial: false }),
        wil: new fields.BooleanField({ initial: false }),
        aur: new fields.BooleanField({ initial: false }),
        cha: new fields.BooleanField({ initial: false }),
        app: new fields.BooleanField({ initial: false }),
      }),
      testSkills: new fields.ArrayField(new fields.StringField({ required: true, blank: false, initial: "stealth" })),
    }));

    // Zero or more damage instances. Each is independently tied to the
    // attack roll, to one specific saving throw (by index into
    // savingThrows above), or applied unconditionally. attributeBonuses/
    // skillBonuses scale the damage the same way a saving throw's bonuses
    // scale its value - a flat number to add once the formula is actually
    // rolled, each independently scaled by its own "@value" formula.
    schema.damages = new fields.ArrayField(new fields.SchemaField({
      formula: new fields.StringField({ required: true, blank: true, initial: "1d6" }),
      damageType: new fields.StringField({ required: true, blank: false, initial: "fire" }),
      trigger: new fields.StringField({
        required: true, blank: false, initial: "unconditional",
        choices: ["attack", "save", "unconditional"]
      }),
      savingThrowIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      attributeBonuses: new fields.ArrayField(new fields.SchemaField({
        attribute: new fields.StringField({ required: true, blank: false, initial: "str" }),
        useModifier: new fields.BooleanField({ initial: true }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
      skillBonuses: new fields.ArrayField(new fields.SchemaField({
        skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
        formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
      })),
    }));

    // Zero or more predefined status effects (from the world's Status
    // Effects list) this spell applies - each independently tied to the
    // attack roll, a specific saving throw (by index into savingThrows
    // above), or unconditional, same trigger coupling as Damage above. See
    // helpers/damageApplication.mjs#applySpellEffectGroup - entries sharing
    // the same trigger+savingThrowIndex are applied together via one
    // button (see helpers/spell-rolls.mjs#renderSpellEffectSaveButtonHTML
    // for "save", renderSpellEffectApplyButtonHTML for "attack"/
    // "unconditional").
    schema.statusEffects = new fields.ArrayField(new fields.SchemaField({
      statusId: new fields.StringField({ required: true, blank: true, initial: "" }),
      stacks: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      trigger: new fields.StringField({
        required: true, blank: false, initial: "unconditional",
        choices: ["attack", "save", "unconditional"]
      }),
      savingThrowIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
    }));

    // Zero or more freeform Active Effects this spell applies - each its
    // own linked ActiveEffect (effectId, bind-then-toggle pattern like
    // Technique's own effectId - see helpers/spell-rolls.mjs#
    // ensureLinkedSpellEffect), living as a disabled template on the
    // CASTER's own actor until copied onto whoever it lands on. Same
    // trigger coupling as statusEffects above; "name" is just a friendly
    // label for the GM's own list (also the copied effect's default name
    // until renamed in Foundry's own effect editor).
    schema.foundryEffects = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true, initial: "" }),
      effectId: new fields.StringField({ required: true, blank: true, initial: "" }),
      trigger: new fields.StringField({
        required: true, blank: false, initial: "unconditional",
        choices: ["attack", "save", "unconditional"]
      }),
      savingThrowIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
    }));

    return schema;
  }
}
