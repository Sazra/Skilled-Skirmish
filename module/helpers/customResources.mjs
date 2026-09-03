/**
 * "Zusätzliche Ressourcen als Mana-Alternative" - lets a custom resource
 * (data/actor-base.mjs#customResources) be spent instead of Mana, at either
 * a fixed conversion rate ("rate" mode) or, for spells only, a "1 resource
 * point per spell level" rate ("spellLevel" mode). See
 * data/actor-base.mjs#customResources.isManaAlternative/manaAlternativeMode
 * for the full field documentation.
 *
 * The resource is chosen at spell-cast time via the same Shift+Click dialog
 * as Überladen (helpers/spell-rolls.mjs#chooseSpellCastOptions) and applied
 * once, immediately, before the normal Mana payment (helpers/
 * statusEffects.mjs#payManaCost) - whatever the resource doesn't cover
 * falls back to being paid with Mana (then Life/Negative Life) as usual.
 */

/**
 * Every one of an actor's custom resources currently eligible to substitute
 * for Mana on a given kind of action, paired with its own array index (the
 * stable-enough reference for a single request/response round-trip - see
 * the file-level comment on why no persistent id field is needed).
 * @param {Actor} actor
 * @param {"spells"|"techniques"|"abilities"} usageType
 * @return {Array<{index: number, resource: object}>}
 */
export function getManaAlternativeResources(actor, usageType) {
  const result = [];
  (actor.system.customResources ?? []).forEach((resource, index) => {
    if (!resource.isManaAlternative) return;
    if (resource.manaAlternativeMode === 'spellLevel') {
      if (usageType === 'spells') result.push({ index, resource });
      return;
    }
    const flagKey = usageType === 'spells' ? 'manaAlternativeForSpells'
      : usageType === 'techniques' ? 'manaAlternativeForTechniques'
      : 'manaAlternativeForAbilities';
    if (resource[flagKey]) result.push({ index, resource });
  });
  return result;
}

/**
 * Compute how much of a Mana cost a given resource can cover, and how many
 * of its own points that takes - pure calculation, no actor mutation, safe
 * to call repeatedly for a live preview (see chooseSpellCastOptions's own
 * dropdown) and once more at commit time against the final cost.
 *
 * "rate" mode: a fixed manaAlternativeRateResource:manaAlternativeRateMana
 * conversion. "spellLevel" mode: the rate is derived per-call instead -
 * spellLevel resource points cover exactly manaCostToCover Mana (i.e. this
 * spell's own computed cost), so each point covers manaCostToCover/spellLevel
 * Mana - spending fewer points than spellLevel covers proportionally less.
 * @param {object} resource   An entry from Actor#system.customResources.
 * @param {number} manaCostToCover
 * @param {number|null} [spellLevel=null]   Required (and only meaningful)
 *   for "spellLevel" mode.
 * @return {{resourcePointsNeeded: number, resourcePointsSpent: number, manaCovered: number}}
 */
export function computeManaAlternativeCoverage(resource, manaCostToCover, spellLevel = null) {
  if (manaCostToCover <= 0) return { resourcePointsNeeded: 0, resourcePointsSpent: 0, manaCovered: 0 };

  const rateResource = resource.manaAlternativeMode === 'spellLevel'
    ? Math.max(1, spellLevel ?? 1)
    : Math.max(1, resource.manaAlternativeRateResource ?? 1);
  const rateMana = resource.manaAlternativeMode === 'spellLevel'
    ? manaCostToCover
    : Math.max(1, resource.manaAlternativeRateMana ?? 1);

  const resourcePointsNeeded = Math.ceil(manaCostToCover * rateResource / rateMana);
  const available = Math.max(0, resource.value ?? 0);
  const resourcePointsSpent = Math.min(resourcePointsNeeded, available);
  const manaCovered = Math.min(manaCostToCover, Math.floor(resourcePointsSpent * rateMana / rateResource));

  return { resourcePointsNeeded, resourcePointsSpent, manaCovered };
}

/**
 * Deduct spentPoints from one of an actor's custom resources (by array
 * index - see getManaAlternativeResources). A no-op for spentPoints <= 0 or
 * a since-removed index.
 * @param {Actor} actor
 * @param {number} resourceIndex
 * @param {number} spentPoints
 * @return {Promise<void>}
 */
export async function payWithManaAlternative(actor, resourceIndex, spentPoints) {
  if (spentPoints <= 0) return;
  const resources = foundry.utils.deepClone(actor.system.customResources ?? []);
  const entry = resources[resourceIndex];
  if (!entry) return;
  entry.value = Math.max(0, (entry.value ?? 0) - spentPoints);
  await actor.update({ 'system.customResources': resources });
}
