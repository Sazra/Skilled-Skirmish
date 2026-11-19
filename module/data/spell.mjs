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
    // "?" as Mana cost: the caster picks the base Mana amount every time the
    // spell is cast (helpers/spell-rolls.mjs#rollSpellItem asks for it; the
    // Mana Cost field's own "?" is converted to this switch by the item
    // sheet). manaCost itself is ignored while this is on. Extra-cost tiers,
    // reductions and Überladen still apply on top of the chosen amount.
    schema.manaCostVariable = new fields.BooleanField({ required: true, initial: false });
    // The base amount chosen at the last cast - the default of the next
    // prompt, and the per-round amount while a manaCostPerRound spell is
    // being sustained.
    schema.variableManaPaid = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
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
    // "?" as Unterhalt: the amount is entered every time the spell is
    // switched to "sustaining" (helpers/spell-rolls.mjs#setSpellSustaining
    // asks for it; the Upkeep field's own "?" is converted to this switch by
    // the item sheet). upkeep itself is ignored while this is on -
    // variableUpkeepPaid is the amount entered at the last activation (the
    // default of the next prompt, and what is currently reducing maximum
    // mana while the spell sustains). See helpers/spells.mjs#getSpellUpkeep.
    schema.upkeepVariable = new fields.BooleanField({ required: true, initial: false });
    schema.variableUpkeepPaid = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Unterhalt that scales with the "?" Mana cost: this many Unterhalt per
    // Mana of the base amount chosen at cast time (e.g. 3 = "3 Unterhalt pro
    // Mana", 0.5 = "50 % der Kosten"); added to upkeep / the amount entered
    // for a "?" Unterhalt, rounded up. Only counts with a "?" Mana cost
    // (manaCostVariable). See helpers/spells.mjs#getSpellUpkeep.
    schema.upkeepPerMana = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });
    // Unterhalt added by the extra-cost steps (extraManaCosts[].upkeepBonus)
    // paid at the last cast - stored at cast time (helpers/spell-rolls.mjs#
    // rollSpellItem), because the spell is only switched to "sustaining"
    // afterwards and the chosen steps would be forgotten by then.
    schema.extraUpkeepPaid = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Whether this spell's ongoing effect (and therefore its
    // manaCostPerRound/upkeep, if either is set) is currently active on its
    // owning actor. Toggled manually - e.g. once a spell's own stated
    // Duration has run out and the caster chooses to keep sustaining it,
    // per a "kann aufrecht erhalten werden" ("can be sustained") duration -
    // since Duration below is freeform text, not a tracked countdown, this
    // transition isn't automatic.
    schema.sustaining = new fields.BooleanField({ initial: false });
    // min 0 (not 1): a spell that also has its own rpCost set below may
    // have this dropped all the way to 0, signaling it has no real AP
    // payment path of its own at all - it's meant to only ever actually be
    // cast via that RP cost instead (see helpers/spells.mjs#
    // computeSpellApCost, which enforces the usual floor of 1 for every
    // other spell).
    schema.apCost = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    // "?" as AP cost (apCostUnit "ap" only): the caster picks the AP amount
    // every time the spell is cast (helpers/spell-rolls.mjs#rollSpellItem
    // asks for it; the AP Cost field's own "?" is converted to this switch
    // by the item sheet). apCost itself is ignored while this is on -
    // apCostMin is the lowest amount the caster may pick, and
    // variableApPaid the amount chosen at the last cast (the default of the
    // next prompt). AP reductions still apply on top of the chosen amount.
    schema.apCostVariable = new fields.BooleanField({ required: true, initial: false });
    schema.apCostMin = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    schema.variableApPaid = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Switch: this spell's AP cost can't be reduced - neither by the school/
    // Active-Effect AP reductions nor by Chant Shortening (see helpers/
    // spells.mjs#computeSpellApCost). Überladen's surcharge still applies.
    schema.apCostFixed = new fields.BooleanField({ required: true, initial: false });
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

    // "Es kann mehr Mana gezahlt werden" - a cumulative list of extra-cost
    // tiers a caster may additionally pay when casting, on top of manaCost.
    // Paying tier N (1-based) implies every tier below it (1..N-1) is paid
    // too - see helpers/spells.mjs#computeExtraManaCostSum, which sums
    // tiers[0..tier-1]. Chosen at cast time via the same dialog as Überladen
    // (Overcharge) - see helpers/spell-rolls.mjs#chooseSpellCastOptions. A
    // damages entry can gate on a specific tier via trigger "extraCost" +
    // extraCostIndex below (0-based, i.e. extraCostIndex 0 = tier 1).
    schema.extraManaCosts = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      manaCost: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // "Kann mehrfach gewählt werden": the step may be paid several times in
      // one cast (its cost then counts that many times in the cumulative
      // sum, see helpers/spells.mjs#computeExtraManaCostSum), up to
      // maxRepeats uses in total. Only the cost scales - tier-gated damage
      // entries still depend on the tier reached, not on the repeat count.
      repeatable: new fields.BooleanField({ required: true, initial: false }),
      maxRepeats: new fields.NumberField({ ...requiredInteger, initial: 2, min: 1 }),
      // What else paying this step (or a higher one - cumulative like the
      // cost) changes about the spell, see helpers/spells.mjs#
      // computeExtraCostEffects. All of it counts once per time a
      // repeatable step was chosen.
      // - extraAttacks: additional attack rolls (turns the attack roll on
      //   if the spell has none of its own).
      // - rangeChanges: adds distance to / replaces the indicator of one of
      //   the spell's ranges (rangeIndex is 0-based into "ranges"; a blank
      //   indicator keeps the existing one).
      // - saveDcChanges: raises/lowers the DC of one saving throw
      //   (savingThrowIndex is 0-based into "savingThrows").
      extraAttacks: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // Additional Unterhalt (maximum-Mana reduction while sustaining) per
      // time this step was chosen - see computeExtraUpkeep.
      upkeepBonus: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      rangeChanges: new fields.ArrayField(new fields.SchemaField({
        rangeIndex: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        // Fractions allowed (e.g. 0.5 m, or 0.25 m³ for a cuboid).
        distanceBonus: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
        indicator: new fields.StringField({ required: true, blank: true, initial: "" }),
      })),
      saveDcChanges: new fields.ArrayField(new fields.SchemaField({
        savingThrowIndex: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        dcBonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      })),
      // Extra stacks of one of the spell's own statusEffects entries
      // (statusIndex is 0-based into "statusEffects") - on top of that
      // entry's own stacks, once per time this step was chosen.
      statusStackBonuses: new fields.ArrayField(new fields.SchemaField({
        statusIndex: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        stacks: new fields.NumberField({ ...requiredInteger, initial: 1 }),
      })),
    }));

    // Manakern's own flat FP grant (to the "manaCore" skill) whenever this
    // spell is cast - a designer-set value on the item itself, not a GM-
    // configured rate. See helpers/skillFp.mjs#grantFlatSkillFp.
    schema.manaCoreFpGrant = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });

    // One or more ranges, each paired with the indicator describing how
    // that leg of the spell travels/applies (e.g. a fireball is a 30m
    // Projectile followed by a 6m Radius explosion).
    // distance is in metres - fractions allowed (e.g. 2.5) - except for the
    // "cuboid" indicator (Quader), where it is a volume in m³ (also with
    // fractions); "sphere" (Kugel) is a radius in metres.
    schema.ranges = new fields.ArrayField(new fields.SchemaField({
      distance: new fields.NumberField({ required: true, nullable: false, initial: 10, min: 0 }),
      indicator: new fields.StringField({
        required: true, blank: false, initial: "projectile",
        choices: ["self", "touch", "targeted", "sight", "hearing", "projectile", "line", "radius", "sphere", "cuboid", "cone", "square"]
      }),
      // Only used by a spell with a "?" Mana cost (manaCostVariable): extra
      // metres (m³ for a cuboid) per Mana of the base amount chosen at cast
      // time (e.g. 2 = "2 m per Mana"), added on top of distance. Fractions
      // allowed; a fractional product keeps up to 2 decimals (rounded
      // down), a whole-number coefficient still yields whole metres.
      distancePerMana: new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 })
    }), {
      initial: [{ distance: 10, indicator: "projectile", distancePerMana: 0 }]
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

    // Per-spell Überladen (Overcharge) rules - see helpers/spells.mjs#
    // getOverchargeSettings. The defaults are the general rules, so a spell
    // that never touches these behaves exactly as before.
    // - effect "scaling": each Überladung scales saving-throw DC, ranges and
    //   damage (gated by overchargeAutoEffects above). "extraAttack":
    //   instead, each Überladung adds one more attack roll (with the
    //   attack's own damage; no additional FP) and none of that scaling
    //   applies.
    // - The costs (extra Mana, extra AP) always apply, whatever the effect.
    // - durationText: shown as an extra "Dauer (überladen)" chat line; "{n}"
    //   is the number of Überladungen, "{...}" may hold a small formula in n
    //   (e.g. "{2+n} Runden").
    schema.overcharge = new fields.SchemaField({
      effect: new fields.StringField({ required: true, blank: false, initial: "scaling", choices: ["scaling", "extraAttack"] }),
      manaPercent: new fields.NumberField({ required: true, nullable: false, initial: 20, min: 0 }),
      manaFlat: new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 }),
      apCost: new fields.NumberField({ required: true, nullable: false, initial: 1, min: 0 }),
      dcBonus: new fields.NumberField({ required: true, nullable: false, initial: 1 }),
      rangePercent: new fields.NumberField({ required: true, nullable: false, initial: 20, min: 0 }),
      rangeFlat: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
      damagePercent: new fields.NumberField({ required: true, nullable: false, initial: 50, min: 0 }),
      durationText: new fields.StringField({ required: true, blank: true, initial: "" }),
    });

    // An element picked (or rolled) for every single cast, which the spell's
    // effect then adapts to - see helpers/spells.mjs#SPELL_ELEMENT/
    // resolveSpellDamages and helpers/damageApplication.mjs#
    // applySpellEffectGroup:
    // - Damage entries whose type is "Gewähltes Element" deal that element.
    // - "{element}" in the key/value/name of a Foundry effect's changes is
    //   replaced by the element's key when it is applied (e.g. key
    //   "system.skillLevelBonus.{element}Resistance" = a resistance to
    //   whichever element was chosen).
    // mode: "none" (off), "choice" (the caster picks one of the allowed
    // elements at cast time - optionally with a "random" option too, for
    // spells where choosing is gated by a check) or "random" (rolled by the
    // system, 1dN over the allowed elements, again for every cast).
    schema.elementChoice = new fields.SchemaField({
      mode: new fields.StringField({ required: true, blank: false, initial: "none", choices: ["none", "choice", "random"] }),
      allowRandom: new fields.BooleanField({ required: true, initial: false }),
      // Which elements may be chosen/rolled (a damage type each, see
      // CONFIG.SKSK.damageTypes) - all of them by default.
      allowed: new fields.SchemaField(Object.fromEntries(
        Object.keys(CONFIG.SKSK.damageTypes).map(key => [key, new fields.BooleanField({ required: true, initial: true })])
      )),
    });

    // Switch: this spell's damage ignores the target's Barrier and goes
    // straight to Life - see helpers/damageApplication.mjs#
    // applyResolvedDamageEntries (damage entries carry it as ignoresBarrier).
    schema.ignoresBarrier = new fields.BooleanField({ initial: false });

    // Whether the spell needs an attack roll at all, against the target's
    // Magic Resistance - independent of, and combinable with, the saving
    // throws below (see helpers/spell-rolls.mjs#renderSpellEffectParts,
    // helpers/attackRolls.mjs#computeSpellAttackBonus/rollAttackPair). Some
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
      // Set (0-based extra-cost step): this saving throw only exists once
      // that step (or a higher one) was paid at cast time - an additional
      // save an "Es kann mehr Mana gezahlt werden" step makes necessary.
      // null = always.
      extraCostIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
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
      // "extraCost": gated on extraManaCosts (see above) instead of the
      // attack roll/a saving throw/nothing - applies whenever the tier paid
      // at cast time is at least extraCostIndex + 1 (cumulative, so a higher
      // paid tier also includes every lower-indexed "extraCost" entry).
      trigger: new fields.StringField({
        required: true, blank: false, initial: "unconditional",
        choices: ["attack", "save", "unconditional", "extraCost"]
      }),
      savingThrowIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      extraCostIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      // Only for damageType "@barrier" ("Barriere": the roll is not damage
      // but Barrier this spell grants, see helpers/barrier.mjs): whether it
      // stacks with other stackable Barrier (default: no), and how long it
      // lasts - barrierDuration 0 = unlimited, else that many
      // barrierDurationUnit ("rounds", "minutes", "hours", "days").
      barrierStackable: new fields.BooleanField({ initial: false }),
      barrierDuration: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      barrierDurationUnit: new fields.StringField({
        required: true, blank: false, initial: "rounds", choices: ["rounds", "minutes", "hours", "days"]
      }),
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
      // Set (0-based extra-cost step): this entry is only applied once that
      // step (or a higher one) was paid at cast time, and its stacks count
      // once per time that step was chosen. null = always.
      extraCostIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
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
      // Same gate as statusEffects.extraCostIndex above.
      extraCostIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      trigger: new fields.StringField({
        required: true, blank: false, initial: "unconditional",
        choices: ["attack", "save", "unconditional"]
      }),
      savingThrowIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
    }));

    // Varianten: extra effects this spell triggers when a marker is present
    // on the caster - e.g. the Trickkunst "Infusion" spells or "Wasser
    // sammeln" (which merely put a status/effect on the caster) change the
    // NEXT spell cast. A variant is active while ALL its conditions are met
    // by the caster's active effects/statuses; its changes then apply to
    // this cast only (see helpers/spellVariants.mjs):
    // - changes: edits of any option of the spell, addressed by a path into
    //   its system data (e.g. "manaCost", "ranges.0.distance",
    //   "damages.0.formula", "duration") - set / add / multiply / append.
    // - addDamages/addStatusEffects: extra Damage/Status Effect entries.
    // - note: a free text line shown on the chat card.
    // A matching marker with the duration option "Bis Nutzung" is removed
    // once it was used by a cast; one with any other duration triggers the
    // variant on every cast while it lasts.
    // Metamagie: the rule this spell stands for when it changes the NEXT spell
    // its caster casts, whatever that is (see helpers/metamagic.mjs). Blank for
    // an ordinary spell.
    schema.metamagic = new fields.StringField({
      required: true, blank: true, initial: "",
      choices: ["", "distance", "raise", "element", "hinder", "silent", "secure", "immobile", "extend", "overcharge", "double", "strengthen", "maximize", "transcend"]
    });

    // Scope "next" (Nächster Zauber): the variant is stored on THIS spell but
    // changes whatever spell its caster casts next - a general
    // infusion/enhancement layer that needs no code per spell (see
    // helpers/spellVariants.mjs#findEnhancements). It applies while its
    // conditions are met (blank = while this spell's own marker effect is on
    // the caster) and the next spell passes its filter; the marker (duration
    // option "Bis Nutzung") is used up by that next spell, also when the
    // filter does not match (consumeOnMismatch).
    schema.variants = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true, initial: "" }),
      note: new fields.StringField({ required: true, blank: true, initial: "" }),
      scope: new fields.StringField({ required: true, blank: false, initial: "spell", choices: ["spell", "next"] }),
      // Only for scope "next". Every list is comma separated, blank = no
      // restriction; all given restrictions must hold.
      filter: new fields.SchemaField({
        spellNames: new fields.StringField({ required: true, blank: true, initial: "" }),
        spellTypes: new fields.StringField({ required: true, blank: true, initial: "" }),
        schools: new fields.StringField({ required: true, blank: true, initial: "" }),
        excludeSchools: new fields.StringField({ required: true, blank: true, initial: "" }),
        damageTypes: new fields.StringField({ required: true, blank: true, initial: "" }),
        excludeDamageTypes: new fields.StringField({ required: true, blank: true, initial: "" }),
        requiresAttack: new fields.BooleanField({ initial: false }),
        requiresDamage: new fields.BooleanField({ initial: false }),
        requiresSavingThrow: new fields.BooleanField({ initial: false }),
        consumeOnMismatch: new fields.BooleanField({ initial: true }),
      }),
      conditions: new fields.ArrayField(new fields.SchemaField({
        // "status": a status effect id (see the world's Status Effects);
        // "effect": an Active Effect with exactly this name.
        kind: new fields.StringField({ required: true, blank: false, initial: "status", choices: ["status", "effect"] }),
        key: new fields.StringField({ required: true, blank: true, initial: "" }),
      })),
      changes: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ required: true, blank: true, initial: "" }),
        type: new fields.StringField({ required: true, blank: false, initial: "add", choices: ["set", "add", "multiply", "append"] }),
        value: new fields.StringField({ required: true, blank: true, initial: "" }),
      })),
      addDamages: new fields.ArrayField(new fields.SchemaField({
        formula: new fields.StringField({ required: true, blank: true, initial: "1d6" }),
        damageType: new fields.StringField({ required: true, blank: false, initial: "fire" }),
        trigger: new fields.StringField({ required: true, blank: false, initial: "unconditional", choices: ["attack", "save", "unconditional"] }),
        savingThrowIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
        extraCostIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
        // Only for damageType "@barrier" - see damages above.
        barrierStackable: new fields.BooleanField({ initial: false }),
        barrierDuration: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        barrierDurationUnit: new fields.StringField({
          required: true, blank: false, initial: "rounds", choices: ["rounds", "minutes", "hours", "days"]
        }),
        attributeBonuses: new fields.ArrayField(new fields.SchemaField({
          attribute: new fields.StringField({ required: true, blank: false, initial: "str" }),
          useModifier: new fields.BooleanField({ initial: true }),
          formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
        })),
        skillBonuses: new fields.ArrayField(new fields.SchemaField({
          skill: new fields.StringField({ required: true, blank: false, initial: "axe" }),
          formula: new fields.StringField({ required: true, blank: true, initial: "@value" }),
        })),
      })),
      addStatusEffects: new fields.ArrayField(new fields.SchemaField({
        statusId: new fields.StringField({ required: true, blank: true, initial: "" }),
        stacks: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
        extraCostIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
        trigger: new fields.StringField({ required: true, blank: false, initial: "unconditional", choices: ["attack", "save", "unconditional"] }),
        savingThrowIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      })),
    }));

    return schema;
  }
}
