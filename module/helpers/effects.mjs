/**
 * Manage Active Effect instances through an Actor or Item Sheet via effect control buttons.
 * @param {MouseEvent} event      The left-click event on the effect control
 * @param {Actor|Item} owner      The owning document which manages this effect
 * @param {HTMLElement} [element] The clicked control element (required for ApplicationV2 actions)
 */
export function onManageActiveEffect(event, owner, element) {
  event.preventDefault();
  const a = element ?? event.currentTarget;
  const li = a.closest('li');
  const effect = li.dataset.effectId
    ? owner.effects.get(li.dataset.effectId)
    : null;
  switch (a.dataset.action) {
    case 'create':
      return owner.createEmbeddedDocuments('ActiveEffect', [
        {
          name: game.i18n.format('DOCUMENT.New', {
            type: game.i18n.localize('DOCUMENT.ActiveEffect'),
          }),
          img: 'icons/svg/aura.svg',
          origin: owner.uuid,
          'duration.rounds':
            li.dataset.effectType === 'temporary' ? 1 : undefined,
          disabled: li.dataset.effectType === 'inactive',
        },
      ]);
    case 'edit':
      return effect.sheet.render(true);
    case 'delete':
      return effect.delete();
    case 'toggle':
      return effect.update({ disabled: !effect.disabled });
  }
}

/**
 * Foundry's own stock Active Effect Config sheet lets a GM edit every
 * Change's Key/Type/Value/Priority, but its own "Phase" (initial/final -
 * see foundry.documents.ActiveEffect.CHANGE_PHASES) only ever round-trips
 * as a hidden form field - there's no visible control to actually pick it.
 * That matters here: a Change whose own Value formula references another,
 * derived-only key (e.g. "@attributes.dex.mod" - only computed in
 * prepareDerivedData, not a real stored field) needs Phase "final" to read
 * a reliably up-to-date value; the default "initial" phase applies BEFORE
 * that computation has run for the current data-preparation pass, and
 * silently resolves the reference to 0 instead (no warning - see
 * helpers/skillRollCost.mjs's own live-testing session that uncovered
 * this). This swaps each row's hidden phase input for a visible <select>,
 * keeping its exact "name" attribute so the sheet's own default form
 * submission picks it up completely unchanged - nothing else needs to know
 * this exists. Re-run on every render (full or partial, e.g. after "Add
 * Change") via the renderActiveEffectConfig hook - see sksk.mjs. A no-op
 * if the sheet's own markup ever stops matching what's queried here
 * (e.g. a future Foundry version restructuring this tab), rather than
 * throwing - the hidden field still round-trips on its own regardless.
 * @param {HTMLElement} element   The Active Effect Config sheet's root element.
 */
export function addPhaseSelectToActiveEffectChanges(element) {
  const changesSection = element.querySelector('section[data-tab="changes"]');
  if (!changesSection) return;

  const header = changesSection.querySelector('header');
  if (header && !header.querySelector('.phase')) {
    const phaseHeader = document.createElement('div');
    phaseHeader.className = 'phase';
    phaseHeader.textContent = game.i18n.localize('SKSK.EffectPhase.Label');
    const priorityHeader = header.querySelector('.priority');
    if (priorityHeader) header.insertBefore(phaseHeader, priorityHeader);
    else header.appendChild(phaseHeader);
  }

  const list = changesSection.querySelector('ol[data-changes]');
  for (const hidden of changesSection.querySelectorAll('input[type="hidden"][name$=".phase"]')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'phase';
    const select = document.createElement('select');
    select.name = hidden.name;
    select.title = game.i18n.localize('SKSK.EffectPhase.Hint');
    for (const [value, labelKey] of [
      ['initial', 'EFFECT.CHANGES.PHASES.initial.label'],
      ['final', 'EFFECT.CHANGES.PHASES.final.label'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = game.i18n.localize(labelKey);
      option.selected = (hidden.value || 'initial') === value;
      select.append(option);
    }
    wrapper.append(select);
    hidden.replaceWith(wrapper);
  }

  // Widen the grid by one track for the new column, inserted just before
  // "Priority" - reads whatever column widths this Foundry version
  // actually uses right now instead of hardcoding them, so a future
  // version's own column widths/count still get a sensible result.
  for (const gridEl of [header, list]) {
    if (!gridEl) continue;
    const columns = getComputedStyle(gridEl).gridTemplateColumns.split(' ');
    if (columns.length === 5) {
      columns.splice(3, 0, '90px');
      gridEl.style.gridTemplateColumns = columns.join(' ');
    }
  }
}

/**
 * Handles Foundry's "Custom" Active Effect change type ("Type": "Custom" in
 * an Effect's own Changes tab) - core Foundry never applies a Custom change
 * on its own; it only fires the "applyActiveEffect" hook and expects a
 * system (this function, registered in sksk.mjs) to actually do the work.
 * Without this, a Custom-type change is a silent no-op.
 *
 * By the time this hook fires, Foundry has ALREADY evaluated the change's
 * own "Value" field as a Roll formula against the document's current roll
 * data (Roll.replaceFormulaData, the same @-syntax used everywhere in this
 * system's own roll formulas - see helpers/skillRolls.mjs and
 * documents/actor.mjs#getRollData) if it's a string, and passed the result
 * in as `delta` - e.g. a Value of "@attributes.dex.mod" arrives here as
 * whatever the actor's current Dexterity modifier actually is. This
 * function's own job is just to add that onto the change's target key.
 *
 * Note: for a key that resolves to a real, persisted schema field (e.g.
 * "system.attributeBonuses.str.modifier"), Foundry already performs this
 * exact @-formula evaluation for the plain "Add"/"Override" modes too, no
 * Custom type or this hook required at all. Custom mode's own distinct use
 * is a key that ISN'T a real field - one recomputed fresh every
 * prepareDerivedData call instead (e.g. "system.attributes.str.mod" itself)
 * - which Foundry can't resolve a field for, so nothing auto-applies there
 * without this hook. A change targeting a value like that must also set
 * its own "phase" to "final" (not yet exposed in Foundry's stock Active
 * Effect sheet, so only reachable by editing the effect's raw data) so it
 * applies AFTER prepareDerivedData has already computed that value, rather
 * than immediately being overwritten by it.
 * @param {Actor|Item} document
 * @param {EffectChangeData} change
 * @param {*} current   The document's own current value at change.key.
 * @param {*} delta      change.value, already Roll-evaluated/cast to
 *   current's own data type.
 */
export function applyCustomActiveEffectChange(document, change, current, delta) {
  if (change.type !== 'custom') return;
  foundry.utils.setProperty(document, change.key, (current ?? 0) + delta);
}

/**
 * Prepare the data structure for Active Effects which are currently embedded in an Actor or Item.
 * @param {ActiveEffect[]} effects    A collection or generator of Active Effect documents to prepare sheet data for
 * @return {object}                   Data for rendering
 */
export function prepareActiveEffectCategories(effects) {
  // Define effect header categories
  const categories = {
    temporary: {
      type: 'temporary',
      label: game.i18n.localize('SKSK.Effect.Temporary'),
      effects: [],
    },
    passive: {
      type: 'passive',
      label: game.i18n.localize('SKSK.Effect.Passive'),
      effects: [],
    },
    inactive: {
      type: 'inactive',
      label: game.i18n.localize('SKSK.Effect.Inactive'),
      effects: [],
    },
  };

  // Iterate over active effects, classifying them into categories
  for (let e of effects) {
    if (e.disabled) categories.inactive.effects.push(e);
    else if (e.isTemporary) categories.temporary.effects.push(e);
    else categories.passive.effects.push(e);
  }
  return categories;
}
