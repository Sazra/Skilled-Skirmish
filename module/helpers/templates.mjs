/**
 * Define a set of template paths to pre-load
 * Pre-loaded templates are compiled and cached for fast access when rendering
 * @return {Promise}
 */
export const preloadHandlebarsTemplates = async function () {
  return foundry.applications.handlebars.loadTemplates([
    // Actor partials.
    'systems/sksk/templates/actor/parts/actor-items.hbs',
    'systems/sksk/templates/actor/parts/actor-spells.hbs',
    'systems/sksk/templates/actor/parts/actor-effects.hbs',
    // Item partials
    'systems/sksk/templates/item/parts/item-effects.hbs',
    'systems/sksk/templates/item/parts/material-section.hbs',
  ]);
};
