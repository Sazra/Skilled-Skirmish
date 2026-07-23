/**
 * Sum of the Aura value granted by every Species item (main and sub) an
 * actor holds - see data/species.mjs#aura. Written back to
 * system.attributes.aur.value whenever a Species item is added (see
 * sksk.mjs's "createItem" hook), rather than recomputed on every data
 * preparation, since Aura otherwise stays a normal user-editable attribute.
 * @param {Actor} actor
 * @return {number}
 */
export function computeSpeciesAura(actor) {
  return actor.items
    .filter(i => i.type === 'species')
    .reduce((sum, i) => sum + (i.system.aura ?? 0), 0);
}
