export const SKSK = {};

/**
 * The set of Attribute Scores used within the system.
 * @type {Object}
 */
SKSK.attributes = {
  str: 'SKSK.Attribute.Str.long',
  dex: 'SKSK.Attribute.Dex.long',
  con: 'SKSK.Attribute.Con.long',
  per: 'SKSK.Attribute.Per.long',
  wil: 'SKSK.Attribute.Wil.long',
  aur: 'SKSK.Attribute.Aur.long',
  cha: 'SKSK.Attribute.Cha.long',
  app: 'SKSK.Attribute.App.long',
};

// Used by the minimized-state attribute-roll bar (see actor-sheet.mjs#
// _renderFrame) - the ordinary attributes side-tab shows the full label
// instead, so this is the only place these matter.
SKSK.attributeIcons = {
  str: 'fa-dumbbell',
  dex: 'fa-person-running',
  con: 'fa-heart-pulse',
  per: 'fa-eye',
  wil: 'fa-brain',
  aur: 'fa-sun',
  cha: 'fa-comments',
  app: 'fa-face-smile',
};

// Each "Unbegrenzte X" skill (CONFIG.SKSK.skills.attribute) grants a bonus
// to that one attribute's own roll - not to skill checks that merely use
// the attribute as one of their modifiers - equal to its own skill level.
// See helpers/attributes.mjs#computeUnlimitedAttributeBonus.
SKSK.unlimitedAttributeSkills = {
  str: 'unlimitedStrength',
  dex: 'unlimitedDexterity',
  con: 'unlimitedConstitution',
  per: 'unlimitedPerception',
  wil: 'unlimitedWillpower',
  aur: 'unlimitedAura',
  cha: 'unlimitedCharisma',
  app: 'unlimitedAppearance',
};

// Character tab's Data section.
SKSK.genders = {
  male: 'SKSK.Gender.Male',
  female: 'SKSK.Gender.Female',
  hermaphrodite: 'SKSK.Gender.Hermaphrodite',
  genderless: 'SKSK.Gender.Genderless',
};

SKSK.speciesTypes = {
  main: 'SKSK.Species.Type.Main',
  sub: 'SKSK.Species.Type.Sub',
};

// The ways an actor can move, shown as a horizontal list on the General
// tab. Items (of any equippable type) can grant a bonus to one specific
// type, or to all of them at once via the special "all" entry below - see
// helpers/movement.mjs#computeMovementSpeeds.
SKSK.movementTypes = {
  walking: 'SKSK.Movement.Walking',
  flying: 'SKSK.Movement.Flying',
  hovering: 'SKSK.Movement.Hovering',
  swimming: 'SKSK.Movement.Swimming',
  climbing: 'SKSK.Movement.Climbing',
  digging: 'SKSK.Movement.Digging',
};

// A movement bonus entry's movementType field also accepts this, meaning
// the bonus applies to every movement type at once rather than just one.
SKSK.movementBonusAll = 'all';

// A Species' movementBonuses entry's mode field - see
// helpers/movement.mjs#computeMovementSpeeds.
SKSK.movementBonusModes = {
  bonus: 'SKSK.Movement.Mode.Bonus',
  override: 'SKSK.Movement.Mode.Override',
};

// A Species/Class/Talent's chargeBonuses entry's resource field - see
// helpers/generalResources.mjs.
SKSK.chargeResources = {
  meditation: 'SKSK.GeneralResource.Meditation',
  regeneration: 'SKSK.GeneralResource.Regeneration',
  inspiration: 'SKSK.GeneralResource.Inspiration',
  adrenalin: 'SKSK.GeneralResource.Adrenalin',
  luck: 'SKSK.GeneralResource.Luck',
};

// Status effects always present in a fresh/updated world (seeded into the
// "statusEffects" world setting by helpers/statusEffects.mjs#
// ensurePredefinedStatusEffects, then editable - besides their id, which
// every bespoke mechanical hook is keyed on - like any GM-added entry).
// GM-added custom entries get no "id" here (one is generated for them) and
// no automated mechanics - see helpers/statusEffects.mjs.
SKSK.predefinedStatusEffects = [
  {
    id: 'exhaustion', img: 'icons/svg/downgrade.svg',
    nameKey: 'SKSK.StatusEffect.Exhaustion.Name', descriptionKey: 'SKSK.StatusEffect.Exhaustion.Description',
  },
  {
    id: 'dazed', img: 'icons/svg/daze.svg',
    nameKey: 'SKSK.StatusEffect.Dazed.Name', descriptionKey: 'SKSK.StatusEffect.Dazed.Description',
  },
  {
    id: 'poisonMild', img: 'icons/svg/poison.svg',
    nameKey: 'SKSK.StatusEffect.PoisonMild.Name', descriptionKey: 'SKSK.StatusEffect.PoisonMild.Description',
  },
  {
    id: 'poisonMedium', img: 'icons/svg/poison.svg',
    nameKey: 'SKSK.StatusEffect.PoisonMedium.Name', descriptionKey: 'SKSK.StatusEffect.PoisonMedium.Description',
  },
  {
    id: 'poisonSevere', img: 'icons/svg/poison.svg',
    nameKey: 'SKSK.StatusEffect.PoisonSevere.Name', descriptionKey: 'SKSK.StatusEffect.PoisonSevere.Description',
  },
  {
    id: 'poisonDeadly', img: 'icons/svg/poison.svg',
    nameKey: 'SKSK.StatusEffect.PoisonDeadly.Name', descriptionKey: 'SKSK.StatusEffect.PoisonDeadly.Description',
  },
  {
    id: 'prone', img: 'icons/svg/falling.svg',
    nameKey: 'SKSK.StatusEffect.Prone.Name', descriptionKey: 'SKSK.StatusEffect.Prone.Description',
  },
  {
    id: 'restrained', img: 'icons/svg/net.svg',
    nameKey: 'SKSK.StatusEffect.Restrained.Name', descriptionKey: 'SKSK.StatusEffect.Restrained.Description',
  },
  {
    id: 'frostbite', img: 'icons/svg/frozen.svg',
    nameKey: 'SKSK.StatusEffect.Frostbite.Name', descriptionKey: 'SKSK.StatusEffect.Frostbite.Description',
  },
  {
    id: 'wound', img: 'icons/svg/blood.svg',
    nameKey: 'SKSK.StatusEffect.Wound.Name', descriptionKey: 'SKSK.StatusEffect.Wound.Description',
  },
  {
    id: 'maxLifeDamage', img: 'icons/svg/skull.svg',
    nameKey: 'SKSK.StatusEffect.MaxLifeDamage.Name', descriptionKey: 'SKSK.StatusEffect.MaxLifeDamage.Description',
  },
  {
    id: 'cauterization', img: 'icons/svg/fire.svg',
    nameKey: 'SKSK.StatusEffect.Cauterization.Name', descriptionKey: 'SKSK.StatusEffect.Cauterization.Description',
  },
  {
    id: 'adrenalinDamage', img: 'icons/svg/lightning.svg',
    nameKey: 'SKSK.StatusEffect.AdrenalinDamage.Name', descriptionKey: 'SKSK.StatusEffect.AdrenalinDamage.Description',
  },
  {
    id: 'charmed', img: 'icons/svg/eye.svg',
    nameKey: 'SKSK.StatusEffect.Charmed.Name', descriptionKey: 'SKSK.StatusEffect.Charmed.Description',
  },
  {
    id: 'feared', img: 'icons/svg/terror.svg',
    nameKey: 'SKSK.StatusEffect.Feared.Name', descriptionKey: 'SKSK.StatusEffect.Feared.Description',
  },
  {
    id: 'petrified', img: 'icons/svg/statue.svg',
    nameKey: 'SKSK.StatusEffect.Petrified.Name', descriptionKey: 'SKSK.StatusEffect.Petrified.Description',
  },
  {
    id: 'blind', img: 'icons/svg/blind.svg',
    nameKey: 'SKSK.StatusEffect.Blind.Name', descriptionKey: 'SKSK.StatusEffect.Blind.Description',
  },
  {
    id: 'concentration', img: 'icons/svg/aura.svg',
    nameKey: 'SKSK.StatusEffect.Concentration.Name', descriptionKey: 'SKSK.StatusEffect.Concentration.Description',
  },
  {
    id: 'concealed', img: 'icons/svg/invisible.svg',
    nameKey: 'SKSK.StatusEffect.Concealed.Name', descriptionKey: 'SKSK.StatusEffect.Concealed.Description',
  },
];

// Restrained's own escape-check timing choices - see
// helpers/statusEffects.mjs#setRestrainedConfig.
SKSK.restrainedTimingChoices = {
  apCost: 'SKSK.StatusEffect.Restrained.TimingApCost',
  start: 'SKSK.StatusEffect.Restrained.TimingStart',
  end: 'SKSK.StatusEffect.Restrained.TimingEnd',
};

// Per-severity damage die / DC / recheck interval (in rounds) for the
// Vergiftung (Poison) status effects - see helpers/statusEffects.mjs.
// Mild has no interval - it triggers every round of the poisoned
// creature's own turn, unconditionally.
SKSK.poisonSeverities = {
  poisonMild: { damageDie: 4, dc: 10, intervalRounds: 1 },
  poisonMedium: { damageDie: 6, dc: 13, intervalRounds: 3 },
  poisonSevere: { damageDie: 8, dc: 16, intervalRounds: 5 },
  poisonDeadly: { damageDie: 10, dc: 19, intervalRounds: 10 },
};

// A creature's size category - defaults per Species (see species.mjs),
// shown as a simple readonly indicator on the General tab.
SKSK.sizeCategories = {
  tiny: 'SKSK.Size.Tiny',
  small: 'SKSK.Size.Small',
  medium: 'SKSK.Size.Medium',
  large: 'SKSK.Size.Large',
  huge: 'SKSK.Size.Huge',
  gigantic: 'SKSK.Size.Gigantic',
  titanic: 'SKSK.Size.Titanic',
};

SKSK.classTypes = {
  first: 'SKSK.Class.Type.First',
  second: 'SKSK.Class.Type.Second',
  third: 'SKSK.Class.Type.Third',
  advanced: 'SKSK.Class.Type.Advanced',
};

SKSK.skillCategories = {
  weapons: 'SKSK.SkillCategory.Weapons',
  armors: 'SKSK.SkillCategory.Armors',
  production: 'SKSK.SkillCategory.Production',
  rogue: 'SKSK.SkillCategory.Rogue',
  magicSchools: 'SKSK.SkillCategory.MagicSchools',
  magic: 'SKSK.SkillCategory.Magic',
  fighter: 'SKSK.SkillCategory.Fighter',
  misc: 'SKSK.SkillCategory.Misc',
  attribute: 'SKSK.SkillCategory.Attribute',
  resistances: 'SKSK.SkillCategory.Resistances',
  weaknesses: 'SKSK.SkillCategory.Weaknesses',
  immunity: 'SKSK.SkillCategory.Immunity',
  absorb: 'SKSK.SkillCategory.Absorb',
  special: 'SKSK.SkillCategory.Special',
};

// What a Lehre's (Lore's) bonus row actually adjusts - see
// helpers/lehren.mjs#computeLehrenTargetBonus. attackBonus/damageBonus rows
// also carry a "scope" (see SKSK.lehrenBonusScopes below); every other
// target is inherently actor-wide and ignores scope entirely.
SKSK.lehrenBonusTargets = {
  attackBonus: 'SKSK.LehrenConfig.Target.AttackBonus',
  damageBonus: 'SKSK.LehrenConfig.Target.DamageBonus',
  armorClass: 'SKSK.LehrenConfig.Target.ArmorClass',
  magicResistance: 'SKSK.LehrenConfig.Target.MagicResistance',
  life: 'SKSK.LehrenConfig.Target.Life',
  mana: 'SKSK.LehrenConfig.Target.Mana',
  actionPoints: 'SKSK.LehrenConfig.Target.ActionPoints',
  reactionPoints: 'SKSK.LehrenConfig.Target.ReactionPoints',
  allRolls: 'SKSK.LehrenConfig.Target.AllRolls',
};

// Which rolls/attacks a Lehre's attackBonus/damageBonus row applies to -
// only shown/meaningful for those two targets (see SKSK.lehrenBonusTargets).
SKSK.lehrenBonusScopes = {
  thisSkill: 'SKSK.LehrenConfig.Scope.ThisSkill',
  allWeapons: 'SKSK.LehrenConfig.Scope.AllWeapons',
  allSpells: 'SKSK.LehrenConfig.Scope.AllSpells',
  everything: 'SKSK.LehrenConfig.Scope.Everything',
};

// How a Species/Class/Talent's attributeMaxModifiers entry adjusts an
// attribute's natural maximum - see helpers/attributes.mjs#computeAttributeMax.
SKSK.attributeMaxOperations = {
  add: 'SKSK.AttributeMax.Operation.Add',
  subtract: 'SKSK.AttributeMax.Operation.Subtract',
  multiply: 'SKSK.AttributeMax.Operation.Multiply',
  divide: 'SKSK.AttributeMax.Operation.Divide',
};

// How a fpGainBonuses entry (item- or status-effect-authored) adjusts a
// skill's pending FP gain - see helpers/skillFp.mjs#applySkillFpGainBonus.
SKSK.fpGainBonusTypes = {
  positive: 'SKSK.FpGainBonus.Type.Positive',
  negative: 'SKSK.FpGainBonus.Type.Negative',
  multiplicative: 'SKSK.FpGainBonus.Type.Multiplicative',
  forceZero: 'SKSK.FpGainBonus.Type.ForceZero',
};

SKSK.spellTypes = {
  simple: 'SKSK.Spell.Type.Simple',
  advanced: 'SKSK.Spell.Type.Advanced',
  combined: 'SKSK.Spell.Type.Combined',
  systemless: 'SKSK.Spell.Type.Systemless',
};

// Simple/Advanced spells belong to exactly one magic school. These reuse
// the same skill keys/labels as CONFIG.SKSK.skills (magicSchools category,
// plus martialArts from weapons for Kampfkunst's dual role), so a spell's
// school always lines up with an actual skill for later level checks.
SKSK.simpleMagicSchools = {
  fire: 'SKSK.Skill.MagicSchool.Fire',
  water: 'SKSK.Skill.MagicSchool.Water',
  earth: 'SKSK.Skill.MagicSchool.Earth',
  air: 'SKSK.Skill.MagicSchool.Air',
  life: 'SKSK.Skill.MagicSchool.Life',
  death: 'SKSK.Skill.MagicSchool.Death',
  light: 'SKSK.Skill.MagicSchool.Light',
  nature: 'SKSK.Skill.MagicSchool.Nature',
  dark: 'SKSK.Skill.MagicSchool.Dark',
  trickery: 'SKSK.Skill.MagicSchool.Trickery',
};

SKSK.advancedMagicSchools = {
  martialArts: 'SKSK.Skill.Weapon.MartialArts',
  bardic: 'SKSK.Skill.MagicSchool.Bardic',
  space: 'SKSK.Skill.MagicSchool.Space',
  time: 'SKSK.Skill.MagicSchool.Time',
  blood: 'SKSK.Skill.MagicSchool.Blood',
  divination: 'SKSK.Skill.MagicSchool.Divination',
};

// Combined spells don't belong to a Simple/Advanced magic school (they're
// defined by a combination of required skills instead - see
// SKSKSpell#combinedSkills), but still need a category of their own for
// organizing the actor sheet's Spells tab.
SKSK.combinedMagicSchools = {
  stormancy: 'SKSK.Spell.CombinedSchool.Stormancy',
  chaomancy: 'SKSK.Spell.CombinedSchool.Chaomancy',
  demomancy: 'SKSK.Spell.CombinedSchool.Demomancy',
  drakomancy: 'SKSK.Spell.CombinedSchool.Drakomancy',
  necromancy: 'SKSK.Spell.CombinedSchool.Necromancy',
  miracles: 'SKSK.Spell.CombinedSchool.Miracles',
  feymancy: 'SKSK.Spell.CombinedSchool.Feymancy',
  geomancy: 'SKSK.Spell.CombinedSchool.Geomancy',
  biomancy: 'SKSK.Spell.CombinedSchool.Biomancy',
  cryomancy: 'SKSK.Spell.CombinedSchool.Cryomancy',
  witchery: 'SKSK.Spell.CombinedSchool.Witchery',
};

// Systemless spells belong to no magic school at all, but are still
// organized into one of these categories on the actor sheet's Spells tab.
SKSK.systemlessMagicCategories = {
  household: 'SKSK.Spell.SystemlessCategory.Household',
  special: 'SKSK.Spell.SystemlessCategory.Special',
  magicalBody: 'SKSK.Spell.SystemlessCategory.MagicalBody',
  general: 'SKSK.Spell.SystemlessCategory.General',
};

// The indicator paired with each of a spell's ranges - e.g. a fireball is
// a 30m Projectile followed by a 6m Radius explosion.
SKSK.rangeIndicators = {
  self: 'SKSK.Spell.RangeIndicator.Self',
  touch: 'SKSK.Spell.RangeIndicator.Touch',
  targeted: 'SKSK.Spell.RangeIndicator.Targeted',
  projectile: 'SKSK.Spell.RangeIndicator.Projectile',
  line: 'SKSK.Spell.RangeIndicator.Line',
  radius: 'SKSK.Spell.RangeIndicator.Radius',
  cone: 'SKSK.Spell.RangeIndicator.Cone',
  square: 'SKSK.Spell.RangeIndicator.Square',
};

// How a spell can be cast; a spell may use multiple of these at once.
SKSK.castingMethods = {
  vocal: 'SKSK.Spell.CastingMethod.Vocal',
  runes: 'SKSK.Spell.CastingMethod.Runes',
  movement: 'SKSK.Spell.CastingMethod.Movement',
  sacrifice: 'SKSK.Spell.CastingMethod.Sacrifice',
  medium: 'SKSK.Spell.CastingMethod.Medium',
  ritual: 'SKSK.Spell.CastingMethod.Ritual',
  concentration: 'SKSK.Spell.CastingMethod.Concentration',
};

// What a spell's own apCost number counts - see data/spell.mjs#apCostUnit.
SKSK.apCostUnits = {
  ap: 'SKSK.Spell.ApCostUnit.Ap',
  minutes: 'SKSK.Spell.ApCostUnit.Minutes',
  hours: 'SKSK.Spell.ApCostUnit.Hours',
  days: 'SKSK.Spell.ApCostUnit.Days',
};

// A Technique's own category - see data/technique.mjs#category.
SKSK.techniqueCategories = {
  stand: 'SKSK.Technique.Category.Stand',
  attackBonus: 'SKSK.Technique.Category.AttackBonus',
  effect: 'SKSK.Technique.Category.Effect',
};

// An "attackBonus" Technique's own Bonusschaden mode - see data/
// technique.mjs#bonusDamageMode.
SKSK.bonusDamageModes = {
  none: 'SKSK.Technique.BonusDamageMode.None',
  flat: 'SKSK.Technique.BonusDamageMode.Flat',
  multiply: 'SKSK.Technique.BonusDamageMode.Multiply',
  formula: 'SKSK.Technique.BonusDamageMode.Formula',
};

// An "attackBonus" Technique's own Schadenswürfelerhöhung mode - see
// data/technique.mjs#diceIncreaseMode.
SKSK.diceIncreaseModes = {
  none: 'SKSK.Technique.DiceIncreaseMode.None',
  additive: 'SKSK.Technique.DiceIncreaseMode.Additive',
  multiplicative: 'SKSK.Technique.DiceIncreaseMode.Multiplicative',
};

// An "effect" Technique's own target - see data/technique.mjs#effectTarget.
SKSK.techniqueEffectTargets = {
  self: 'SKSK.Technique.EffectTarget.Self',
  attackTarget: 'SKSK.Technique.EffectTarget.AttackTarget',
  direct: 'SKSK.Technique.EffectTarget.Direct',
};

// The elements a spell's Damage entries can deal - the same 20 elements
// used by the Resistance/Weakness/Immunity/Absorb skill categories, so a
// spell's damage type always lines up with an actor's defenses, PLUS
// "aether" - this system's own "true damage" equivalent, deliberately NOT
// paired with an aetherResistance/aetherWeakness/aetherImmunity/
// aetherAbsorption skill entry in any of the four skill categories below,
// so it can never be mitigated: helpers/defense.mjs#applyElementalDefense
// looks up "aetherResistance" etc. via helpers/skills.mjs#
// findSkillDefinition, which returns null for a skill key that doesn't
// exist in CONFIG.SKSK.skills at all - every one of
// getActorSkillLevel/isActorSkillUnlocked/getSkillStacks already handles
// that by returning 0/false, so Aether damage always passes through
// applyElementalDefense completely unmodified, with no dedicated code path
// needed here. Every damage-type dropdown in the system (weapon/armor
// property overrides, Spell Damage entries, Martial Arts Attacks,
// technique-rolls.mjs, Models config) reads this same object directly, so
// adding it here alone makes it selectable everywhere at once.
SKSK.damageTypes = {
  fire: 'SKSK.DamageType.Fire',
  water: 'SKSK.DamageType.Water',
  earth: 'SKSK.DamageType.Earth',
  air: 'SKSK.DamageType.Air',
  light: 'SKSK.DamageType.Light',
  dark: 'SKSK.DamageType.Dark',
  life: 'SKSK.DamageType.Life',
  death: 'SKSK.DamageType.Death',
  mental: 'SKSK.DamageType.Mental',
  nature: 'SKSK.DamageType.Nature',
  cold: 'SKSK.DamageType.Cold',
  heat: 'SKSK.DamageType.Heat',
  blunt: 'SKSK.DamageType.Blunt',
  sharp: 'SKSK.DamageType.Sharp',
  piercing: 'SKSK.DamageType.Piercing',
  poison: 'SKSK.DamageType.Poison',
  acid: 'SKSK.DamageType.Acid',
  electricity: 'SKSK.DamageType.Electricity',
  ice: 'SKSK.DamageType.Ice',
  disease: 'SKSK.DamageType.Disease',
  aether: 'SKSK.DamageType.Aether',
};

// What a spell's Damage/Status Effect entries can be coupled to: the
// attack roll, one specific saving throw, or nothing at all.
SKSK.spellTriggers = {
  attack: 'SKSK.Spell.Trigger.Attack',
  save: 'SKSK.Spell.Trigger.Save',
  unconditional: 'SKSK.Spell.Trigger.Unconditional',
};

// How a Martial Arts Attack's selected attribute switches (see
// data/actor-base.mjs#martialArtsAttacks) combine into a single modifier -
// mirrors the Refined/Masterful/Specialized Model properties' wording,
// generalized to any number of selected attributes. See
// helpers/actions.mjs#resolveMartialArtsAttributeBonus.
SKSK.attributeUsageTypes = {
  highestSingle: 'SKSK.AttributeUsage.HighestSingle',
  all: 'SKSK.AttributeUsage.All',
  highestMultiple: 'SKSK.AttributeUsage.HighestMultiple',
};

// The GM-tab preset for generic (non-Angriffswurf) D20 rolls that trigger
// fully automatically - see data/actor-base.mjs#genericCriticalRollMode/
// helpers/criticalRolls.mjs#evaluateD20WithMode.
SKSK.genericRollModes = {
  neutral: 'SKSK.GenericRoll.ModeNeutral',
  advantage: 'SKSK.GenericRoll.ModeAdvantage',
  disadvantage: 'SKSK.GenericRoll.ModeDisadvantage',
};

SKSK.talentTypes = {
  level6: 'SKSK.Talent.Type.Level6',
  level12: 'SKSK.Talent.Type.Level12',
  level18: 'SKSK.Talent.Type.Level18',
  level24: 'SKSK.Talent.Type.Level24',
  mythic: 'SKSK.Talent.Type.Mythic',
  bonus: 'SKSK.Talent.Type.Bonus',
  bloodline: 'SKSK.Talent.Type.Bloodline',
};

SKSK.attributeAbbreviations = {
  str: 'SKSK.Attribute.Str.abbr',
  dex: 'SKSK.Attribute.Dex.abbr',
  con: 'SKSK.Attribute.Con.abbr',
  per: 'SKSK.Attribute.Per.abbr',
  wil: 'SKSK.Attribute.Wil.abbr',
  aur: 'SKSK.Attribute.Aur.abbr',
  cha: 'SKSK.Attribute.Cha.abbr',
  app: 'SKSK.Attribute.App.abbr',
};

/**
 * Armor item "Rüstungsart" dropdown choices - deliberately separate from
 * SKSK.skills.armors below (which drives actual spendable armor skills):
 * Cloth has no armor skill of its own, so it must never appear in
 * SKSK.skills.armors (that would wrongly make it a spendable/FP-tracked
 * skill on every actor sheet) while still needing its own entry on the
 * Armor item sheet's Rüstungsart dropdown. See sheets/item-sheet.mjs's
 * typeChoices and helpers/defense.mjs#computeArmorClassComponents.
 * @type {Object}
 */
SKSK.armorTypes = {
  lightArmor: 'SKSK.ArmorType.LightArmor',
  heavyArmor: 'SKSK.ArmorType.HeavyArmor',
  shield: 'SKSK.ArmorType.Shield',
  cloth: 'SKSK.ArmorType.Cloth',
};

// Each skill maps to its localization key and its maximum level
// ("Stufenzahl" per the design spreadsheet). maxLevel: 1 marks a binary
// skill (either possessed or not) rather than a point-scaled one.
SKSK.skills = {
  weapons: {
    axe: { label: 'SKSK.Skill.Weapon.Axe', maxLevel: 10, attributes: ['str'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['str', 'con'] }, { level: 10, mode: 'choice', attributes: ['str', 'con'] }] },
    bow: { label: 'SKSK.Skill.Weapon.Bow', maxLevel: 10, attributes: ['dex'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'per'] }, { level: 10, mode: 'choice', attributes: ['dex', 'per'] }] },
    bluntWeapon: { label: 'SKSK.Skill.Weapon.BluntWeapon', maxLevel: 10, attributes: ['str'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['str', 'con'] }, { level: 10, mode: 'choice', attributes: ['str', 'con'] }] },
    dagger: { label: 'SKSK.Skill.Weapon.Dagger', maxLevel: 10, attributes: ['dex'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'cha'] }, { level: 10, mode: 'choice', attributes: ['dex', 'cha'] }] },
    firearms: { label: 'SKSK.Skill.Weapon.Firearms', maxLevel: 10, attributes: ['dex'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['per', 'dex'] }, { level: 10, mode: 'choice', attributes: ['per', 'dex'] }] },
    martialArts: { label: 'SKSK.Skill.Weapon.MartialArts', maxLevel: 10, attributes: ['str', 'dex'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'str'] }, { level: 10, mode: 'choice', attributes: ['dex', 'str'] }] },
    polearms: { label: 'SKSK.Skill.Weapon.Polearm', maxLevel: 10, attributes: ['dex'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'con'] }, { level: 10, mode: 'choice', attributes: ['dex', 'con'] }] },
    sword: { label: 'SKSK.Skill.Weapon.Sword', maxLevel: 10, attributes: ['str', 'dex'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'str'] }, { level: 10, mode: 'choice', attributes: ['dex', 'str'] }] },
  },
  armors: {
    heavyArmor: { label: 'SKSK.Skill.Armor.HeavyArmor', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'str'] }, { level: 10, mode: 'choice', attributes: ['con', 'str'] }] },
    lightArmor: { label: 'SKSK.Skill.Armor.LightArmor', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'dex'] }, { level: 10, mode: 'choice', attributes: ['con', 'dex'] }] },
    shield: { label: 'SKSK.Skill.Armor.Shield', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['str', 'con'] }, { level: 10, mode: 'choice', attributes: ['dex', 'con'] }] },
  },
  production: {
    alchemy: { label: 'SKSK.Skill.Crafting.Alchemy', maxLevel: 5, attributes: ['dex', 'per'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['dex', 'per'] }, { level: 5, mode: 'choice', attributes: ['dex', 'per'] }] },
    crafting: { label: 'SKSK.Skill.Crafting.Crafting', maxLevel: 5, attributes: ['dex', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['dex', 'con'] }, { level: 5, mode: 'choice', attributes: ['dex', 'per'] }] },
    cooking: { label: 'SKSK.Skill.Crafting.Cooking', maxLevel: 5, attributes: ['dex', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['dex', 'con'] }, { level: 5, mode: 'choice', attributes: ['dex', 'con'] }] },
    enchanting: { label: 'SKSK.Skill.Crafting.Enchanting', maxLevel: 5, attributes: ['wil', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['wil', 'con'] }, { level: 5, mode: 'choice', attributes: ['wil', 'con'] }] },
  },
  rogue: {
    assassination: { label: 'SKSK.Skill.Rogue.Assassination', maxLevel: 5, attributes: ['dex', 'per'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['dex', 'per'] }, { level: 5, mode: 'choice', attributes: ['dex', 'per', 'cha'] }] },
    traps: { label: 'SKSK.Skill.Rogue.Traps', maxLevel: 10, attributes: ['dex'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'per'] }, { level: 10, mode: 'choice', attributes: ['dex', 'per'] }] },
    stealth: { label: 'SKSK.Skill.Rogue.Stealth', maxLevel: 10, attributes: ['dex'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'cha'] }, { level: 10, mode: 'choice', attributes: ['dex', 'cha'] }] },
    sleightOfHand: { label: 'SKSK.Skill.Rogue.SleightOfHand', maxLevel: 10, attributes: ['dex'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'per'] }, { level: 10, mode: 'choice', attributes: ['dex', 'per'] }] },
  },
  magicSchools: {
    fire: { label: 'SKSK.Skill.MagicSchool.Fire', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'cha'] }, { level: 10, mode: 'choice', attributes: ['cha', 'wil', 'aur'] }] },
    water: { label: 'SKSK.Skill.MagicSchool.Water', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'dex'] }, { level: 10, mode: 'choice', attributes: ['dex', 'wil', 'aur'] }] },
    earth: { label: 'SKSK.Skill.MagicSchool.Earth', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'con'] }, { level: 10, mode: 'choice', attributes: ['con', 'wil', 'aur'] }] },
    air: { label: 'SKSK.Skill.MagicSchool.Air', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'dex'] }, { level: 10, mode: 'choice', attributes: ['dex', 'wil', 'aur'] }] },
    light: { label: 'SKSK.Skill.MagicSchool.Light', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'aur'] }, { level: 10, mode: 'choice', attributes: ['wil', 'aur'] }] },
    dark: { label: 'SKSK.Skill.MagicSchool.Dark', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'aur'] }, { level: 10, mode: 'choice', attributes: ['wil', 'aur'] }] },
    life: { label: 'SKSK.Skill.MagicSchool.Life', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'con'] }, { level: 10, mode: 'choice', attributes: ['con', 'wil', 'aur'] }] },
    death: { label: 'SKSK.Skill.MagicSchool.Death', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'con'] }, { level: 10, mode: 'choice', attributes: ['con', 'wil', 'aur'] }] },
    trickery: { label: 'SKSK.Skill.MagicSchool.Trickery', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['cha', 'app'] }, { level: 10, mode: 'choice', attributes: ['cha', 'app', 'wil', 'aur'] }] },
    nature: { label: 'SKSK.Skill.MagicSchool.Nature', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'app'] }, { level: 10, mode: 'choice', attributes: ['app', 'wil', 'aur'] }] },
    bardic: { label: 'SKSK.Skill.MagicSchool.Bardic', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['cha', 'wil'] }, { level: 10, mode: 'choice', attributes: ['cha', 'wil', 'aur'] }] },
    divination: { label: 'SKSK.Skill.MagicSchool.Divination', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['per', 'wil'] }, { level: 10, mode: 'choice', attributes: ['per', 'wil', 'aur'] }] },
    space: { label: 'SKSK.Skill.MagicSchool.Space', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'per'] }, { level: 10, mode: 'choice', attributes: ['per', 'wil', 'aur'] }] },
    time: { label: 'SKSK.Skill.MagicSchool.Time', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'per'] }, { level: 10, mode: 'choice', attributes: ['per', 'wil', 'aur'] }] },
    blood: { label: 'SKSK.Skill.MagicSchool.Blood', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'wil'] }, { level: 10, mode: 'choice', attributes: ['con', 'wil'] }] },
  },
  magic: {
    concentration: { label: 'SKSK.Skill.Magic.Concentration', maxLevel: 10, attributes: ['con', 'wil'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'wil'] }, { level: 10, mode: 'choice', attributes: ['con', 'wil'] }] },
    meditation: { label: 'SKSK.Skill.Magic.Meditation', maxLevel: 10, attributes: ['per', 'wil'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'per'] }, { level: 10, mode: 'choice', attributes: ['wil', 'per'] }] },
    summoning: { label: 'SKSK.Skill.Magic.Summoning', maxLevel: 10, attributes: ['wil', 'cha'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['cha', 'wil'] }, { level: 10, mode: 'choice', attributes: ['cha', 'wil'] }] },
    magicControl: { label: 'SKSK.Skill.Magic.Control', maxLevel: 10, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'per'] }, { level: 10, mode: 'choice', attributes: ['wil', 'con'] }] },
    manaCapacity: { label: 'SKSK.Skill.Magic.ManaCapacity', maxLevel: 10, attributes: ['aur'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['aur', 'con'] }, { level: 10, mode: 'choice', attributes: ['aur', 'con'] }] },
    manaRegeneration: { label: 'SKSK.Skill.Magic.ManaRegeneration', maxLevel: 10, attributes: ['aur'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['aur', 'con'] }, { level: 10, mode: 'choice', attributes: ['aur', 'con'] }] },
    manaCore: { label: 'SKSK.Skill.Magic.ManaCore', maxLevel: 10, attributes: ['aur', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['aur', 'con'] }, { level: 10, mode: 'choice', attributes: ['aur', 'con'] }] },
    ritualism: { label: 'SKSK.Skill.Magic.Ritualism', maxLevel: 5, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['con', 'wil'] }, { level: 5, mode: 'choice', attributes: ['wil', 'aur'] }] },
    chantShortening: { label: 'SKSK.Skill.Magic.ChantShortening', maxLevel: 10, attributes: ['cha', 'wil'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['cha', 'wil'] }, { level: 10, mode: 'choice', attributes: ['cha', 'wil'] }] },
    overcharge: { label: 'SKSK.Skill.Magic.Overcharge', maxLevel: 5, attributes: ['wil', 'aur'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['wil', 'con'] }, { level: 5, mode: 'choice', attributes: ['wil', 'aur'] }] },
    sourceBound: { label: 'SKSK.Skill.Magic.SourceBound', maxLevel: 10, attributes: ['aur', 'wil'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['aur', 'con'] }, { level: 10, mode: 'choice', attributes: ['aur', 'con'] }] },
    etherBound: { label: 'SKSK.Skill.Magic.EtherBound', maxLevel: 10, attributes: ['wil'], attributeBonusThresholds: [{ level: 2, mode: 'choice', attributes: ['aur', 'con'] }, { level: 4, mode: 'choice', attributes: ['aur', 'con'] }, { level: 6, mode: 'choice', attributes: ['aur', 'wil'] }, { level: 8, mode: 'choice', attributes: ['aur', 'wil'] }, { level: 10, mode: 'choice', attributes: ['aur', 'wil'] }] },
    chantless: { label: 'SKSK.Skill.Magic.Chantless', maxLevel: 1, attributeBonusThresholds: [{ level: 1, mode: 'and', attributes: ['wil', 'aur'] }] },
  },
  fighter: {
    health: { label: 'SKSK.Skill.Fighter.Health', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'and', attributes: ['con'] }, { level: 10, mode: 'and', attributes: ['con'] }] },
    stamina: { label: 'SKSK.Skill.Fighter.Stamina', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'con'] }, { level: 10, mode: 'choice', attributes: ['dex', 'con'] }] },
    technique: { label: 'SKSK.Skill.Fighter.Technique', maxLevel: 5, attributes: ['dex'], attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['dex', 'str'] }, { level: 5, mode: 'choice', attributes: ['dex', 'str'] }] },
    reflexes: { label: 'SKSK.Skill.Fighter.Reflexes', maxLevel: 5, attributes: ['dex'], attributeBonusThresholds: [{ level: 3, mode: 'and', attributes: ['dex'] }, { level: 5, mode: 'and', attributes: ['dex'] }] },
    precision: { label: 'SKSK.Skill.Fighter.Precision', maxLevel: 5, attributes: ['per'], attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['per', 'dex'] }, { level: 5, mode: 'choice', attributes: ['per', 'dex'] }] },
    brutality: { label: 'SKSK.Skill.Fighter.Brutality', maxLevel: 5, attributes: ['str', 'dex'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['str', 'dex'] }, { level: 5, mode: 'choice', attributes: ['str', 'dex'] }] },
    adrenalin: { label: 'SKSK.Skill.Fighter.Adrenalin', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'and', attributes: ['con'] }, { level: 10, mode: 'and', attributes: ['con'] }] },
    ambidextrous: { label: 'SKSK.Skill.Fighter.Ambidextrous', maxLevel: 5, attributes: ['dex'], attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['dex', 'per'] }, { level: 5, mode: 'choice', attributes: ['dex', 'per'] }] },
  },
  misc: {
    observation: { label: 'SKSK.Skill.Misc.Observation', maxLevel: 10, attributes: ['per'], attributeBonusThresholds: [{ level: 5, mode: 'and', attributes: ['per'] }, { level: 10, mode: 'and', attributes: ['per'] }] },
    faith: { label: 'SKSK.Skill.Misc.Faith', maxLevel: 10, attributes: ['cha'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'] }, { level: 10, mode: 'choice', attributes: ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'] }] },
    rhetoric: { label: 'SKSK.Skill.Misc.Rhetoric', maxLevel: 10, attributes: ['cha', 'app'], attributeMode: 'combine', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['cha', 'app'] }, { level: 10, mode: 'choice', attributes: ['cha', 'app'] }] },
    healer: { label: 'SKSK.Skill.Misc.Healer', maxLevel: 10, attributes: ['dex', 'per', 'wil'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'per'] }, { level: 10, mode: 'choice', attributes: ['dex', 'per'] }] },
    singing: { label: 'SKSK.Skill.Misc.Singing', maxLevel: 10, attributes: ['cha', 'app'], attributeMode: 'combine', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['cha', 'app'] }, { level: 10, mode: 'choice', attributes: ['cha', 'app'] }] },
    tactic: { label: 'SKSK.Skill.Misc.Tactic', maxLevel: 10, attributes: ['per'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'per'] }, { level: 10, mode: 'choice', attributes: ['dex', 'per'] }] },
    survival: { label: 'SKSK.Skill.Misc.Survival', maxLevel: 10, attributes: ['con', 'per'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'per'] }, { level: 10, mode: 'choice', attributes: ['con', 'per'] }] },
    disguise: { label: 'SKSK.Skill.Misc.Disguise', maxLevel: 10, attributes: ['cha', 'app'], attributeMode: 'combine', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['dex', 'cha'] }, { level: 10, mode: 'choice', attributes: ['dex', 'cha'] }] },
    intimidation: { label: 'SKSK.Skill.Misc.Intimidation', maxLevel: 10, attributes: ['str', 'app', 'cha'], attributeMode: 'combine', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['cha', 'str'] }, { level: 10, mode: 'choice', attributes: ['cha', 'str'] }] },
    inspiration: { label: 'SKSK.Skill.Misc.Inspiration', maxLevel: 5, attributes: ['cha', 'app'], attributeMode: 'combine', attributeBonusThresholds: [{ level: 3, mode: 'and', attributes: ['cha'] }, { level: 5, mode: 'and', attributes: ['cha'] }] },
    totem: { label: 'SKSK.Skill.Misc.Totem', maxLevel: 5, attributes: ['wil', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'] }, { level: 5, mode: 'choice', attributes: ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'] }] },
    tenacity: { label: 'SKSK.Skill.Misc.Tenacity', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'and', attributes: ['con'] }, { level: 10, mode: 'and', attributes: ['con'] }] },
  },
  attribute: {
    unlimitedStrength: { label: 'SKSK.Skill.Attribute.UnlimitedStrength', maxLevel: 5, attributeBonusThresholds: [{ level: 1, mode: 'and', attributes: ['str'] }, { level: 3, mode: 'and', attributes: ['str'] }, { level: 5, mode: 'and', attributes: ['str'] }] },
    unlimitedDexterity: { label: 'SKSK.Skill.Attribute.UnlimitedDexterity', maxLevel: 5, attributeBonusThresholds: [{ level: 1, mode: 'and', attributes: ['dex'] }, { level: 3, mode: 'and', attributes: ['dex'] }, { level: 5, mode: 'and', attributes: ['dex'] }] },
    unlimitedConstitution: { label: 'SKSK.Skill.Attribute.UnlimitedConstitution', maxLevel: 5, attributeBonusThresholds: [{ level: 1, mode: 'and', attributes: ['con'] }, { level: 3, mode: 'and', attributes: ['con'] }, { level: 5, mode: 'and', attributes: ['con'] }] },
    unlimitedPerception: { label: 'SKSK.Skill.Attribute.UnlimitedPerception', maxLevel: 5, attributeBonusThresholds: [{ level: 1, mode: 'and', attributes: ['per'] }, { level: 3, mode: 'and', attributes: ['per'] }, { level: 5, mode: 'and', attributes: ['per'] }] },
    unlimitedWillpower: { label: 'SKSK.Skill.Attribute.UnlimitedWillpower', maxLevel: 5, attributeBonusThresholds: [{ level: 1, mode: 'and', attributes: ['wil'] }, { level: 3, mode: 'and', attributes: ['wil'] }, { level: 5, mode: 'and', attributes: ['wil'] }] },
    unlimitedAura: { label: 'SKSK.Skill.Attribute.UnlimitedAura', maxLevel: 5, attributeBonusThresholds: [{ level: 1, mode: 'and', attributes: ['aur'] }, { level: 3, mode: 'and', attributes: ['aur'] }, { level: 5, mode: 'and', attributes: ['aur'] }] },
    unlimitedCharisma: { label: 'SKSK.Skill.Attribute.UnlimitedCharisma', maxLevel: 5, attributeBonusThresholds: [{ level: 1, mode: 'and', attributes: ['cha'] }, { level: 3, mode: 'and', attributes: ['cha'] }, { level: 5, mode: 'and', attributes: ['cha'] }] },
    unlimitedAppearance: { label: 'SKSK.Skill.Attribute.UnlimitedAppearance', maxLevel: 5, attributeBonusThresholds: [{ level: 1, mode: 'and', attributes: ['app'] }, { level: 3, mode: 'and', attributes: ['app'] }, { level: 5, mode: 'and', attributes: ['app'] }] },
    unlimited: { label: 'SKSK.Skill.Attribute.Unlimited', maxLevel: 1, attributeBonusThresholds: [{ level: 1, mode: 'all', attributes: [] }] },
  },
  resistances: {
    fireResistance: { label: 'SKSK.Skill.Resistance.FireResistance', maxLevel: 10, attributes: ['aur', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'str'] }, { level: 10, mode: 'choice', attributes: ['con', 'str', 'aur'] }] },
    waterResistance: { label: 'SKSK.Skill.Resistance.WaterResistance', maxLevel: 10, attributes: ['aur'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['str', 'con'] }, { level: 10, mode: 'choice', attributes: ['str', 'con', 'aur'] }] },
    earthResistance: { label: 'SKSK.Skill.Resistance.EarthResistance', maxLevel: 10, attributes: ['aur'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['str', 'con'] }, { level: 10, mode: 'choice', attributes: ['str', 'con', 'aur'] }] },
    airResistance: { label: 'SKSK.Skill.Resistance.AirResistance', maxLevel: 10, attributes: ['aur'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['str', 'dex'] }, { level: 10, mode: 'choice', attributes: ['str', 'dex', 'aur'] }] },
    lightResistance: { label: 'SKSK.Skill.Resistance.LightResistance', maxLevel: 10, attributes: ['aur'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'aur'] }, { level: 10, mode: 'choice', attributes: ['wil', 'aur'] }] },
    darkResistance: { label: 'SKSK.Skill.Resistance.DarkResistance', maxLevel: 10, attributes: ['aur'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['wil', 'aur'] }, { level: 10, mode: 'choice', attributes: ['wil', 'aur'] }] },
    lifeResistance: { label: 'SKSK.Skill.Resistance.LifeResistance', maxLevel: 10, attributes: ['aur', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'aur'] }, { level: 10, mode: 'choice', attributes: ['con', 'aur'] }] },
    deathResistance: { label: 'SKSK.Skill.Resistance.DeathResistance', maxLevel: 10, attributes: ['aur', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'aur'] }, { level: 10, mode: 'choice', attributes: ['con', 'wil', 'aur'] }] },
    mentalResistance: { label: 'SKSK.Skill.Resistance.MentalResistance', maxLevel: 10, attributes: ['aur', 'wil'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['per', 'wil'] }, { level: 10, mode: 'choice', attributes: ['per', 'wil'] }] },
    natureResistance: { label: 'SKSK.Skill.Resistance.NatureResistance', maxLevel: 10, attributes: ['aur'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['str', 'con'] }, { level: 10, mode: 'choice', attributes: ['str', 'con', 'aur'] }] },
    coldResistance: { label: 'SKSK.Skill.Resistance.ColdResistance', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'wil'] }, { level: 10, mode: 'choice', attributes: ['con', 'wil'] }] },
    heatResistance: { label: 'SKSK.Skill.Resistance.HeatResistance', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'wil'] }, { level: 10, mode: 'choice', attributes: ['con', 'wil'] }] },
    bluntResistance: { label: 'SKSK.Skill.Resistance.BluntResistance', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'and', attributes: ['con'] }, { level: 10, mode: 'and', attributes: ['con'] }] },
    sharpResistance: { label: 'SKSK.Skill.Resistance.SharpResistance', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'and', attributes: ['con'] }, { level: 10, mode: 'and', attributes: ['con'] }] },
    piercingResistance: { label: 'SKSK.Skill.Resistance.PiercingResistance', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'and', attributes: ['con'] }, { level: 10, mode: 'and', attributes: ['con'] }] },
    poisonResistance: { label: 'SKSK.Skill.Resistance.PoisonResistance', maxLevel: 10, attributes: ['aur', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'and', attributes: ['con'] }, { level: 10, mode: 'and', attributes: ['con'] }] },
    acidResistance: { label: 'SKSK.Skill.Resistance.AcidResistance', maxLevel: 10, attributes: ['aur', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'and', attributes: ['con'] }, { level: 10, mode: 'and', attributes: ['con'] }] },
    electricityResistance: { label: 'SKSK.Skill.Resistance.ElectricityResistance', maxLevel: 10, attributes: ['aur', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'aur'] }, { level: 10, mode: 'choice', attributes: ['con', 'aur'] }] },
    iceResistance: { label: 'SKSK.Skill.Resistance.IceResistance', maxLevel: 10, attributes: ['aur'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'aur'] }, { level: 10, mode: 'choice', attributes: ['con', 'aur'] }] },
    diseaseResistance: { label: 'SKSK.Skill.Resistance.DiseaseResistance', maxLevel: 10, attributes: ['con'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['con', 'aur'] }, { level: 10, mode: 'choice', attributes: ['con', 'aur'] }] },
  },
  // Weaknesses aren't leveled skills but a stackable status effect: each
  // instance adds +100% damage taken from that element. Not entered as a
  // skill level, so no maxLevel - see the "stackable" flag instead.
  weaknesses: {
    fireWeakness: { label: 'SKSK.Skill.Weakness.FireWeakness', stackable: true },
    waterWeakness: { label: 'SKSK.Skill.Weakness.WaterWeakness', stackable: true },
    earthWeakness: { label: 'SKSK.Skill.Weakness.EarthWeakness', stackable: true },
    airWeakness: { label: 'SKSK.Skill.Weakness.AirWeakness', stackable: true },
    lightWeakness: { label: 'SKSK.Skill.Weakness.LightWeakness', stackable: true },
    darkWeakness: { label: 'SKSK.Skill.Weakness.DarkWeakness', stackable: true },
    lifeWeakness: { label: 'SKSK.Skill.Weakness.LifeWeakness', stackable: true },
    deathWeakness: { label: 'SKSK.Skill.Weakness.DeathWeakness', stackable: true },
    mentalWeakness: { label: 'SKSK.Skill.Weakness.MentalWeakness', stackable: true },
    natureWeakness: { label: 'SKSK.Skill.Weakness.NatureWeakness', stackable: true },
    coldWeakness: { label: 'SKSK.Skill.Weakness.ColdWeakness', stackable: true },
    heatWeakness: { label: 'SKSK.Skill.Weakness.HeatWeakness', stackable: true },
    bluntWeakness: { label: 'SKSK.Skill.Weakness.BluntWeakness', stackable: true },
    sharpWeakness: { label: 'SKSK.Skill.Weakness.SharpWeakness', stackable: true },
    piercingWeakness: { label: 'SKSK.Skill.Weakness.PiercingWeakness', stackable: true },
    poisonWeakness: { label: 'SKSK.Skill.Weakness.PoisonWeakness', stackable: true },
    acidWeakness: { label: 'SKSK.Skill.Weakness.AcidWeakness', stackable: true },
    electricityWeakness: { label: 'SKSK.Skill.Weakness.ElectricityWeakness', stackable: true },
    iceWeakness: { label: 'SKSK.Skill.Weakness.IceWeakness', stackable: true },
    diseaseWeakness: { label: 'SKSK.Skill.Weakness.DiseaseWeakness', stackable: true },
  },
  // Immunity/Absorption are pure on-off switches (maxLevel 1), not
  // point-scaled skills - see the Weaknesses category above for stacking.
  immunity: {
    fireImmunity: { label: 'SKSK.Skill.Immunity.FireImmunity', maxLevel: 1 },
    waterImmunity: { label: 'SKSK.Skill.Immunity.WaterImmunity', maxLevel: 1 },
    earthImmunity: { label: 'SKSK.Skill.Immunity.EarthImmunity', maxLevel: 1 },
    airImmunity: { label: 'SKSK.Skill.Immunity.AirImmunity', maxLevel: 1 },
    lightImmunity: { label: 'SKSK.Skill.Immunity.LightImmunity', maxLevel: 1 },
    darkImmunity: { label: 'SKSK.Skill.Immunity.DarkImmunity', maxLevel: 1 },
    lifeImmunity: { label: 'SKSK.Skill.Immunity.LifeImmunity', maxLevel: 1 },
    deathImmunity: { label: 'SKSK.Skill.Immunity.DeathImmunity', maxLevel: 1 },
    mentalImmunity: { label: 'SKSK.Skill.Immunity.MentalImmunity', maxLevel: 1 },
    natureImmunity: { label: 'SKSK.Skill.Immunity.NatureImmunity', maxLevel: 1 },
    coldImmunity: { label: 'SKSK.Skill.Immunity.ColdImmunity', maxLevel: 1 },
    heatImmunity: { label: 'SKSK.Skill.Immunity.HeatImmunity', maxLevel: 1 },
    bluntImmunity: { label: 'SKSK.Skill.Immunity.BluntImmunity', maxLevel: 1 },
    sharpImmunity: { label: 'SKSK.Skill.Immunity.SharpImmunity', maxLevel: 1 },
    piercingImmunity: { label: 'SKSK.Skill.Immunity.PiercingImmunity', maxLevel: 1 },
    poisonImmunity: { label: 'SKSK.Skill.Immunity.PoisonImmunity', maxLevel: 1 },
    acidImmunity: { label: 'SKSK.Skill.Immunity.AcidImmunity', maxLevel: 1 },
    electricityImmunity: { label: 'SKSK.Skill.Immunity.ElectricityImmunity', maxLevel: 1 },
    iceImmunity: { label: 'SKSK.Skill.Immunity.IceImmunity', maxLevel: 1 },
    diseaseImmunity: { label: 'SKSK.Skill.Immunity.DiseaseImmunity', maxLevel: 1 },
  },
  absorb: {
    fireAbsorption: { label: 'SKSK.Skill.Absorb.FireAbsorption', maxLevel: 1 },
    waterAbsorption: { label: 'SKSK.Skill.Absorb.WaterAbsorption', maxLevel: 1 },
    earthAbsorption: { label: 'SKSK.Skill.Absorb.EarthAbsorption', maxLevel: 1 },
    airAbsorption: { label: 'SKSK.Skill.Absorb.AirAbsorption', maxLevel: 1 },
    lightAbsorption: { label: 'SKSK.Skill.Absorb.LightAbsorption', maxLevel: 1 },
    darkAbsorption: { label: 'SKSK.Skill.Absorb.DarkAbsorption', maxLevel: 1 },
    lifeAbsorption: { label: 'SKSK.Skill.Absorb.LifeAbsorption', maxLevel: 1 },
    deathAbsorption: { label: 'SKSK.Skill.Absorb.DeathAbsorption', maxLevel: 1 },
    mentalAbsorption: { label: 'SKSK.Skill.Absorb.MentalAbsorption', maxLevel: 1 },
    natureAbsorption: { label: 'SKSK.Skill.Absorb.NatureAbsorption', maxLevel: 1 },
    coldAbsorption: { label: 'SKSK.Skill.Absorb.ColdAbsorption', maxLevel: 1 },
    heatAbsorption: { label: 'SKSK.Skill.Absorb.HeatAbsorption', maxLevel: 1 },
    bluntAbsorption: { label: 'SKSK.Skill.Absorb.BluntAbsorption', maxLevel: 1 },
    sharpAbsorption: { label: 'SKSK.Skill.Absorb.SharpAbsorption', maxLevel: 1 },
    piercingAbsorption: { label: 'SKSK.Skill.Absorb.PiercingAbsorption', maxLevel: 1 },
    poisonAbsorption: { label: 'SKSK.Skill.Absorb.PoisonAbsorption', maxLevel: 1 },
    acidAbsorption: { label: 'SKSK.Skill.Absorb.AcidAbsorption', maxLevel: 1 },
    electricityAbsorption: { label: 'SKSK.Skill.Absorb.ElectricityAbsorption', maxLevel: 1 },
    iceAbsorption: { label: 'SKSK.Skill.Absorb.IceAbsorption', maxLevel: 1 },
  },
  special: {
    luck: { label: 'SKSK.Skill.Special.Luck', maxLevel: 5 },
    massacre: { label: 'SKSK.Skill.Special.Massacre', maxLevel: 5, attributeBonusThresholds: [{ level: 1, mode: 'choice', attributes: ['str', 'dex', 'wil'] }, { level: 3, mode: 'choice', attributes: ['str', 'dex', 'wil'] }, { level: 5, mode: 'choice', attributes: ['str', 'dex', 'wil'] }] },
    soulforce: { label: 'SKSK.Skill.Special.SoulForce', maxLevel: 5, attributes: ['wil', 'con'], attributeMode: 'choice', attributeBonusThresholds: [{ level: 1, mode: 'choice', attributes: ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'] }, { level: 3, mode: 'all', attributes: [] }, { level: 5, mode: 'all', attributes: [] }] },
    hitCorrection: { label: 'SKSK.Skill.Special.HitCorrection', maxLevel: 10, attributes: ['per'], attributeBonusThresholds: [{ level: 5, mode: 'choice', attributes: ['str', 'dex'] }, { level: 10, mode: 'choice', attributes: ['str', 'dex'] }] },
    defenseCorrection: { label: 'SKSK.Skill.Special.DefenseCorrection', maxLevel: 5, attributes: ['per'], attributeBonusThresholds: [{ level: 3, mode: 'choice', attributes: ['con', 'per'] }, { level: 5, mode: 'choice', attributes: ['con', 'per'] }] },
    corpusImmortalis: { label: 'SKSK.Skill.Special.CorpusImmortalis', maxLevel: 10, attributeBonusThresholds: [{ level: 2, mode: 'choice', attributes: ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'] }, { level: 4, mode: 'choice', attributes: ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'] }, { level: 5, mode: 'all', attributes: [] }, { level: 6, mode: 'choice', attributes: ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'] }, { level: 8, mode: 'choice', attributes: ['str', 'dex', 'con', 'per', 'wil', 'aur', 'cha', 'app'] }, { level: 10, mode: 'all', attributes: [] }] },
    immortal: { label: 'SKSK.Skill.Special.Immortal', maxLevel: 1, attributeBonusThresholds: [{ level: 1, mode: 'all', attributes: [] }] },
  },
};

// Selectable properties for Weapon/Armor Models and Materials (see
// apps/models-config.mjs, apps/materials-config.mjs, helpers/models.mjs,
// helpers/materials.mjs). appliesTo restricts which item categories a
// property can be picked for on a MODEL: "weapon" (any weapon type),
// "lightArmor"/"heavyArmor" (armor models of that type), "shield". Sourced
// from the design spreadsheet's "Modelleigenschaften" list, using its own
// "Kann angewandt werden auf" column - Schild is kept distinct from
// Rüstung throughout, matching the sheet (a handful of Rüstung-only
// properties, e.g. Hart, Laut, don't list Schild even though they'd read
// as plausible on one).
// sources marks whether a property can be granted via a Model, a
// Material, or both ("model" if omitted - most properties are Model-only;
// Antimagic/Silvered turned out to be Material traits, not Model traits,
// so they're "material"-only despite living in this same registry).
// Properties with sources including "material" ignore appliesTo there -
// Materials apply to Items/Armor/Weapons generically, not split by type.
// A Weapon/Armor's own propertyOverrides (see helpers/properties.mjs) can
// add/remove ANY property applicable to its category regardless of
// sources, since an override is a manual GM call, not derived from a
// Material/Model at all.
SKSK.modelProperties = {
  // Vorraussetzungsmodifikator - minimum attribute score needed to use the
  // item effectively; also restricts two-handed weapons to one-handed use
  // below a (further raised) threshold. Originally 3 fixed-threshold tiers
  // each (Heavy/Heavy (Reduced)/Heavy (Increased), etc.) - collapsed into
  // one property with a GM-entered number (see data/model.mjs#
  // heavyRequirement/demandingRequirement/drainingRequirement, mirrored on
  // Materials), since the exact threshold matters more than picking from 3
  // preset tiers.
  heavy: { label: 'SKSK.ModelProperty.Heavy.Name', hint: 'SKSK.ModelProperty.Heavy.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor'], hasRequirement: true, sources: ['model', 'material'] },
  demanding: { label: 'SKSK.ModelProperty.Demanding.Name', hint: 'SKSK.ModelProperty.Demanding.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor'], hasRequirement: true, sources: ['model', 'material'] },
  draining: { label: 'SKSK.ModelProperty.Draining.Name', hint: 'SKSK.ModelProperty.Draining.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor'], hasRequirement: true, sources: ['model', 'material'] },
  // Wertnutzungsmodifikator - how a weapon's multiple selected attribute
  // modifiers (see data/model.mjs#attributes) combine; mutually exclusive
  // with each other in practice, but not enforced here.
  refined: { label: 'SKSK.ModelProperty.Refined.Name', hint: 'SKSK.ModelProperty.Refined.Hint', appliesTo: ['weapon'] },
  specialized: { label: 'SKSK.ModelProperty.Specialized.Name', hint: 'SKSK.ModelProperty.Specialized.Hint', appliesTo: ['weapon'] },
  masterful: { label: 'SKSK.ModelProperty.Masterful.Name', hint: 'SKSK.ModelProperty.Masterful.Hint', appliesTo: ['weapon'] },
  // Allgemein.
  rending: { label: 'SKSK.ModelProperty.Rending.Name', hint: 'SKSK.ModelProperty.Rending.Hint', appliesTo: ['weapon'] },
  stunning: { label: 'SKSK.ModelProperty.Stunning.Name', hint: 'SKSK.ModelProperty.Stunning.Hint', appliesTo: ['weapon'] },
  disarming: { label: 'SKSK.ModelProperty.Disarming.Name', hint: 'SKSK.ModelProperty.Disarming.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor'] },
  ranged: { label: 'SKSK.ModelProperty.Ranged.Name', hint: 'SKSK.ModelProperty.Ranged.Hint', appliesTo: ['weapon'], hasRange: true },
  flexible: { label: 'SKSK.ModelProperty.Flexible.Name', hint: 'SKSK.ModelProperty.Flexible.Hint', appliesTo: ['weapon'] },
  shapeshifting: { label: 'SKSK.ModelProperty.Shapeshifting.Name', hint: 'SKSK.ModelProperty.Shapeshifting.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor'], sources: ['model', 'material'] },
  infusion: { label: 'SKSK.ModelProperty.Infusion.Name', hint: 'SKSK.ModelProperty.Infusion.Hint', appliesTo: ['weapon'], sources: ['model', 'material'] },
  unstable: { label: 'SKSK.ModelProperty.Unstable.Name', hint: 'SKSK.ModelProperty.Unstable.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor'], sources: ['model', 'material'] },
  long: { label: 'SKSK.ModelProperty.Long.Name', hint: 'SKSK.ModelProperty.Long.Hint', appliesTo: ['weapon'] },
  light: { label: 'SKSK.ModelProperty.Light.Name', hint: 'SKSK.ModelProperty.Light.Hint', appliesTo: ['weapon'], sources: ['model', 'material'] },
  // Material-only (moved off Models - these turned out to be traits of the
  // material an item is made from, not of its Model).
  antimagic: { label: 'SKSK.ModelProperty.Antimagic.Name', hint: 'SKSK.ModelProperty.Antimagic.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor'], sources: ['material'] },
  reach: { label: 'SKSK.ModelProperty.Reach.Name', hint: 'SKSK.ModelProperty.Reach.Hint', appliesTo: ['weapon'], hasRange: true },
  giantSlayer: { label: 'SKSK.ModelProperty.GiantSlayer.Name', hint: 'SKSK.ModelProperty.GiantSlayer.Hint', appliesTo: ['weapon'] },
  veryLong: { label: 'SKSK.ModelProperty.VeryLong.Name', hint: 'SKSK.ModelProperty.VeryLong.Hint', appliesTo: ['weapon'] },
  simple: { label: 'SKSK.ModelProperty.Simple.Name', hint: 'SKSK.ModelProperty.Simple.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor'] },
  redirection: { label: 'SKSK.ModelProperty.Redirection.Name', hint: 'SKSK.ModelProperty.Redirection.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor'] },
  silvered: { label: 'SKSK.ModelProperty.Silvered.Name', hint: 'SKSK.ModelProperty.Silvered.Hint', appliesTo: ['weapon', 'lightArmor', 'heavyArmor', 'shield'], sources: ['material'] },
  concealed: { label: 'SKSK.ModelProperty.Concealed.Name', hint: 'SKSK.ModelProperty.Concealed.Hint', appliesTo: ['weapon'] },
  wounding: { label: 'SKSK.ModelProperty.Wounding.Name', hint: 'SKSK.ModelProperty.Wounding.Hint', appliesTo: ['weapon'] },
  throwable: { label: 'SKSK.ModelProperty.Throwable.Name', hint: 'SKSK.ModelProperty.Throwable.Hint', appliesTo: ['weapon'] },
  shattering: { label: 'SKSK.ModelProperty.Shattering.Name', hint: 'SKSK.ModelProperty.Shattering.Hint', appliesTo: ['weapon'] },
  twoHanded: { label: 'SKSK.ModelProperty.TwoHanded.Name', hint: 'SKSK.ModelProperty.TwoHanded.Hint', appliesTo: ['weapon'] },
  // Shield/Armor-specific.
  deployable: { label: 'SKSK.ModelProperty.Deployable.Name', hint: 'SKSK.ModelProperty.Deployable.Hint', appliesTo: ['shield'] },
  armBound: { label: 'SKSK.ModelProperty.ArmBound.Name', hint: 'SKSK.ModelProperty.ArmBound.Hint', appliesTo: ['shield'] },
  hardened: { label: 'SKSK.ModelProperty.Hardened.Name', hint: 'SKSK.ModelProperty.Hardened.Hint', appliesTo: ['lightArmor', 'heavyArmor'] },
  loud: { label: 'SKSK.ModelProperty.Loud.Name', hint: 'SKSK.ModelProperty.Loud.Hint', appliesTo: ['lightArmor', 'heavyArmor'] },
  reflective: { label: 'SKSK.ModelProperty.Reflective.Name', hint: 'SKSK.ModelProperty.Reflective.Hint', appliesTo: ['lightArmor', 'heavyArmor'] },
  flawless: { label: 'SKSK.ModelProperty.Flawless.Name', hint: 'SKSK.ModelProperty.Flawless.Hint', appliesTo: ['lightArmor', 'heavyArmor'] },
  spiky: { label: 'SKSK.ModelProperty.Spiky.Name', hint: 'SKSK.ModelProperty.Spiky.Hint', appliesTo: ['lightArmor', 'heavyArmor'] },
};

// A Seelenpfad (Soul Path)'s own "Elemente" multi-select - every damage
// type and magic school (simple/advanced/combined) it can be attuned to,
// plus the special "mana" element - see data/soulPath.mjs#elements. A
// plain merge (damageTypes' own labels win on the handful of overlapping
// keys - fire/water/earth/air/life/death/light/nature/dark exist in both
// damageTypes and simpleMagicSchools with near-identical German/English
// text either way).
SKSK.pathElements = {
  ...SKSK.damageTypes,
  ...SKSK.simpleMagicSchools,
  ...SKSK.advancedMagicSchools,
  ...SKSK.combinedMagicSchools,
  mana: 'SKSK.PathElement.Mana',
};

// A Seelenpfad's own type - see data/soulPath.mjs#pathType.
SKSK.pathTypes = {
  weapon: 'SKSK.SoulPath.Type.Weapon',
  body: 'SKSK.SoulPath.Type.Body',
  magic: 'SKSK.SoulPath.Type.Magic',
  hybridWeaponBody: 'SKSK.SoulPath.Type.HybridWeaponBody',
  hybridWeaponMagic: 'SKSK.SoulPath.Type.HybridWeaponMagic',
  hybridBodyMagic: 'SKSK.SoulPath.Type.HybridBodyMagic',
  hybridAll: 'SKSK.SoulPath.Type.HybridAll',
};

// FontAwesome (solid) icon class per pathType/element, shown flanking the
// bound Soul Path's own name on the actor sheet's Soul Path tab (see
// sheets/actor-sheet.mjs#_prepareSoulPath) - no image-asset precedent
// exists anywhere else in this codebase for this kind of badge, so these
// are a best-effort pick; swap any that render as an empty box in-browser.
SKSK.pathTypeIcons = {
  weapon: 'fa-khanda',
  body: 'fa-person-running',
  magic: 'fa-wand-magic-sparkles',
  hybridWeaponBody: 'fa-shield-halved',
  hybridWeaponMagic: 'fa-explosion',
  hybridBodyMagic: 'fa-person-rays',
  hybridAll: 'fa-infinity',
};
SKSK.pathElementIcons = {
  fire: 'fa-fire', water: 'fa-droplet', earth: 'fa-mountain', air: 'fa-wind',
  light: 'fa-sun', dark: 'fa-moon', life: 'fa-heart', death: 'fa-skull',
  mental: 'fa-brain', nature: 'fa-leaf', cold: 'fa-snowflake', heat: 'fa-temperature-high',
  blunt: 'fa-hammer', sharp: 'fa-scissors', piercing: 'fa-bullseye', poison: 'fa-flask',
  acid: 'fa-vial', electricity: 'fa-bolt', ice: 'fa-icicles', disease: 'fa-virus',
  trickery: 'fa-masks-theater', martialArts: 'fa-hand-fist', bardic: 'fa-music',
  space: 'fa-atom', time: 'fa-clock', blood: 'fa-heart-pulse', divination: 'fa-eye',
  stormancy: 'fa-cloud-bolt', chaomancy: 'fa-dice', demomancy: 'fa-fire-flame-curved',
  drakomancy: 'fa-dragon', necromancy: 'fa-skull-crossbones', miracles: 'fa-hands-praying',
  feymancy: 'fa-hat-wizard', geomancy: 'fa-gem', biomancy: 'fa-dna',
  cryomancy: 'fa-temperature-arrow-down', witchery: 'fa-broom', mana: 'fa-circle-nodes',
};

// A Path Ability's own type - see data/soulPath.mjs#pathAbilities.
SKSK.pathAbilityTypes = {
  active: 'SKSK.SoulPath.AbilityType.Active',
  passive: 'SKSK.SoulPath.AbilityType.Passive',
};

// A Durchbruch (breakthrough) entry's own repeat mode - see
// data/soulPath.mjs.
SKSK.soulPathBreakthroughModes = {
  once: 'SKSK.SoulPath.BreakthroughMode.Once',
  repeatableUntilNext: 'SKSK.SoulPath.BreakthroughMode.RepeatableUntilNext',
  repeatable: 'SKSK.SoulPath.BreakthroughMode.Repeatable',
};

// The 5 progression stages, in this exact order - both the Item sheet's
// own tab order and data/soulPath.mjs's own schema keys, and the order
// helpers/soulPathRolls.mjs's sequential-unlock logic walks through.
SKSK.soulPathStages = {
  sammlung: 'SKSK.SoulPath.Stage.Sammlung',
  staerkung: 'SKSK.SoulPath.Stage.Staerkung',
  kristallisierung: 'SKSK.SoulPath.Stage.Kristallisierung',
  erwachen: 'SKSK.SoulPath.Stage.Erwachen',
  aufstieg: 'SKSK.SoulPath.Stage.Aufstieg',
};