/**
 * Autocomplete for the "Value" field of an effect change row: typing "@"
 * (or "@" followed by part of a name) offers every variable a value formula
 * may reference - an effect's Value is evaluated as a Roll formula against
 * its document's roll data (see data/actor-base.mjs#getRollData and
 * helpers/effects.mjs): the attribute values/modifiers, every leveled
 * skill's current level, the actor's level and initiative bonus, and - when
 * the effect sits on an actor - its custom resources' abbreviations.
 * Searchable by German label, path and category; picking one replaces just
 * the "@..." text being typed, leaving the rest of the formula alone.
 * Attached to the stock Active Effect Config sheet (renderActiveEffectConfig,
 * which also covers item/template effects) and to the system's own Status
 * Effects settings window - re-run on every render, so rows added later get
 * it too. Looks and behaves like helpers/effectKeyAutocomplete.mjs.
 */

const MAX_RESULTS = 40;

// The attribute fields of the roll data (data/actor-base.mjs attribute
// schema) worth offering - each with its own label key.
const ATTRIBUTE_FIELDS = [
  ['mod', 'SKSK.EffectValue.AttributeMod'],
  ['baseMod', 'SKSK.EffectValue.AttributeBaseMod'],
  ['modExcludingSpecial', 'SKSK.EffectValue.AttributeModExcludingSpecial'],
  ['value', 'SKSK.EffectValue.AttributeValue'],
  ['baseValue', 'SKSK.EffectValue.AttributeBaseValue'],
  ['max', 'SKSK.EffectValue.AttributeMax'],
];

let dropdown = null;

/**
 * Every variable offerable for an effect on the given document.
 * @param {Document|null} owner   The Actor (or Item) the effect sits on.
 * @return {Array<{label: string, path: string, category: string, haystack: string}>}
 */
function buildCatalog(owner) {
  const entries = [];
  const add = (label, path, category) => entries.push({
    label, path, category,
    haystack: `${label} ${path} ${category}`.toLowerCase(),
  });

  const general = game.i18n.localize('SKSK.EffectValue.CategoryGeneral');
  add(game.i18n.localize('SKSK.EffectValue.Level'), '@lvl', general);
  add(game.i18n.localize('SKSK.EffectValue.InitiativeBonus'), '@initiativeBonus', general);

  const attributesCategory = game.i18n.localize('SKSK.EffectValue.CategoryAttributes');
  for (const [key, labelKey] of Object.entries(CONFIG.SKSK.attributes)) {
    const attributeLabel = game.i18n.localize(labelKey);
    for (const [field, fieldLabelKey] of ATTRIBUTE_FIELDS) {
      add(`${attributeLabel}: ${game.i18n.localize(fieldLabelKey)}`, `@attributes.${key}.${field}`, attributesCategory);
    }
  }

  for (const [category, skills] of Object.entries(CONFIG.SKSK.skills)) {
    const categoryLabel = `${game.i18n.localize('SKSK.EffectValue.CategorySkills')} - ${game.i18n.localize(CONFIG.SKSK.skillCategories[category] ?? category)}`;
    for (const [key, def] of Object.entries(skills)) {
      // Binary/stackable skills have no level (their roll-data value is
      // always 0), so there's nothing useful to reference.
      if (def.maxLevel !== 5 && def.maxLevel !== 10) continue;
      add(game.i18n.format('SKSK.EffectValue.SkillLevel', { skill: game.i18n.localize(def.label) }), `@skills.${key}`, categoryLabel);
    }
  }

  const actor = owner?.documentName === 'Actor' ? owner : owner?.parent?.documentName === 'Actor' ? owner.parent : null;
  const resourcesCategory = game.i18n.localize('SKSK.EffectValue.CategoryResources');
  for (const resource of actor?.system?.customResources ?? []) {
    if (!resource.abbreviation) continue;
    add(game.i18n.format('SKSK.EffectValue.CustomResource', { name: resource.name || resource.abbreviation }),
      `@${resource.abbreviation.toLowerCase()}`, resourcesCategory);
  }
  return entries;
}

/**
 * Entries matching every whitespace-separated token of what was typed after
 * the "@"; ones whose path or label starts with it rank first.
 * @param {Array} catalog
 * @param {string} query
 * @return {Array}
 */
function search(catalog, query) {
  const q = query.trim().toLowerCase();
  if (!q) return catalog.slice(0, MAX_RESULTS);
  const tokens = q.split(/\s+/);
  const hits = catalog.filter(entry => tokens.every(token => entry.haystack.includes(token)));
  const rank = entry => {
    const path = entry.path.toLowerCase().slice(1);
    const label = entry.label.toLowerCase();
    return path.startsWith(q) || label.startsWith(q) ? 0 : path.includes(q) || label.includes(q) ? 1 : 2;
  };
  hits.sort((a, b) => rank(a) - rank(b));
  return hits.slice(0, MAX_RESULTS);
}

function closeDropdown() {
  dropdown?.remove();
  dropdown = null;
}

/**
 * The "@..." fragment being typed right at the caret, if any.
 * @param {HTMLInputElement} input
 * @return {{start: number, end: number, query: string}|null}
 */
function getTypedReference(input) {
  const caret = input.selectionStart ?? input.value.length;
  const match = /@([\p{L}\p{N}_.]*)$/u.exec(input.value.slice(0, caret));
  return match ? { start: match.index, end: caret, query: match[1] } : null;
}

/**
 * @param {HTMLElement} element   The window's root element.
 * @param {Document|null} [owner] The document the effect(s) sit on, if any.
 */
export function attachEffectValueAutocomplete(element, owner = null) {
  const valueInputs = element.querySelectorAll(
    'input[name^="system.changes."][name$=".value"], input[name^="statusEffects."][name$=".value"]'
  );
  for (const input of valueInputs) {
    if (!/\.changes\.\d+\.value$|\.keyChanges\.\d+\.value$/.test(input.name)) continue;
    if (input.dataset.skskValueAutocomplete) continue;
    input.dataset.skskValueAutocomplete = '1';
    input.setAttribute('autocomplete', 'off');

    let results = [];
    let active = -1;
    let reference = null;

    const pick = (entry) => {
      if (!reference) return closeDropdown();
      const before = input.value.slice(0, reference.start);
      const after = input.value.slice(reference.end);
      input.value = `${before}${entry.path}${after}`;
      const caret = before.length + entry.path.length;
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closeDropdown();
    };

    const highlight = (index) => {
      if (!dropdown) return;
      active = index;
      [...dropdown.children].forEach((child, i) => child.classList.toggle('active', i === index));
      dropdown.children[index]?.scrollIntoView({ block: 'nearest' });
    };

    const open = () => {
      reference = getTypedReference(input);
      closeDropdown();
      if (!reference) return;
      results = search(buildCatalog(owner), reference.query);
      active = results.length ? 0 : -1;
      if (!results.length) return;

      dropdown = document.createElement('div');
      dropdown.className = 'sksk-key-autocomplete';
      for (const [i, entry] of results.entries()) {
        const row = document.createElement('div');
        row.className = 'sksk-key-autocomplete-row';
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = entry.label;
        const path = document.createElement('code');
        path.textContent = entry.path;
        const category = document.createElement('div');
        category.className = 'category';
        category.textContent = entry.category;
        row.append(label, path, category);
        // mousedown (not click) so it fires before the input's own blur.
        row.addEventListener('mousedown', (event) => { event.preventDefault(); pick(entry); });
        row.addEventListener('mouseenter', () => highlight(i));
        dropdown.append(row);
      }
      document.body.append(dropdown);

      const rect = input.getBoundingClientRect();
      const width = Math.max(rect.width, 420);
      const left = Math.min(rect.left, window.innerWidth - width - 8);
      dropdown.style.left = `${Math.max(8, left)}px`;
      dropdown.style.width = `${width}px`;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      if (spaceBelow < 160 && rect.top > spaceBelow) {
        dropdown.style.bottom = `${window.innerHeight - rect.top + 2}px`;
        dropdown.style.maxHeight = `${Math.min(320, rect.top - 8)}px`;
      } else {
        dropdown.style.top = `${rect.bottom + 2}px`;
        dropdown.style.maxHeight = `${Math.min(320, spaceBelow)}px`;
      }
      highlight(0);
    };

    // Suggestions only ever appear while an "@..." fragment sits at the
    // caret - everything else typed in the field is left completely alone.
    input.addEventListener('input', open);
    input.addEventListener('blur', closeDropdown);
    input.addEventListener('keydown', (event) => {
      if (!dropdown) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        highlight((active + 1) % results.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        highlight((active - 1 + results.length) % results.length);
      } else if ((event.key === 'Enter' || event.key === 'Tab') && active >= 0) {
        event.preventDefault();
        pick(results[active]);
      } else if (event.key === 'Escape') {
        // Close only the list, not the whole window.
        event.preventDefault();
        event.stopPropagation();
        closeDropdown();
      }
    });
  }
}
