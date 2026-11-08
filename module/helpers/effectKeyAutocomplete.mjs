import { SKSKEffectKeyReference } from '../apps/effect-key-reference.mjs';

/**
 * Autocomplete for the "Attribute Key" field of every Active Effect Change
 * row in the stock Active Effect Config sheet (actor effects, item effects,
 * templates - it is one and the same sheet) and of the key changes in the
 * system's own Status Effects settings window. Suggests every key from the
 * Effect Key Reference catalog (apps/effect-key-reference.mjs), searchable
 * by German label, key and category; picking one fills the field. Free text
 * stays possible (any other path, e.g. "flags.*", is left alone).
 * Attached via the renderActiveEffectConfig/renderSKSKStatusEffectsConfig
 * hooks (sksk.mjs) - re-run on every render, so rows added by "Add Change"
 * get it too.
 */

const MAX_RESULTS = 40;
let catalog = null;
let dropdown = null;

/** The flat, lower-cased search index of the whole catalog, built once. */
function getCatalog() {
  if (catalog) return catalog;
  catalog = SKSKEffectKeyReference.buildCategories().flatMap(category => {
    const categoryLabel = game.i18n.localize(category.title);
    return category.rows.map(row => ({
      label: row.label, key: row.key, category: categoryLabel,
      keyLower: row.key.toLowerCase(),
      labelLower: String(row.label).toLowerCase(),
      haystack: `${row.label} ${row.key} ${categoryLabel}`.toLowerCase(),
    }));
  });
  return catalog;
}

/**
 * Entries matching every whitespace-separated token of the query; ones whose
 * key or label starts with the query rank first.
 * @param {string} query
 * @return {Array}
 */
function search(query) {
  const q = query.trim().toLowerCase();
  const entries = getCatalog();
  if (!q) return entries.slice(0, MAX_RESULTS);
  const tokens = q.split(/\s+/);
  const hits = entries.filter(entry => tokens.every(token => entry.haystack.includes(token)));
  const rank = entry => (entry.keyLower.startsWith(q) || entry.labelLower.startsWith(q) ? 0
    : entry.keyLower.includes(q) || entry.labelLower.includes(q) ? 1 : 2);
  hits.sort((a, b) => rank(a) - rank(b));
  return hits.slice(0, MAX_RESULTS);
}

function closeDropdown() {
  dropdown?.remove();
  dropdown = null;
}

/**
 * @param {HTMLElement} element   The Active Effect Config sheet's root element.
 */
export function attachEffectKeyAutocomplete(element) {
  const keyInputs = element.querySelectorAll(
    'input[name^="system.changes."][name$=".key"], input[name^="statusEffects."][name$=".key"]'
  );
  for (const input of keyInputs) {
    // Only the Active Effect sheet's change rows and the Status Effects
    // window's own key-change rows - not any other "...key" input.
    if (!/\.changes\.\d+\.key$|\.keyChanges\.\d+\.key$/.test(input.name)) continue;
    if (input.dataset.skskAutocomplete) continue;
    input.dataset.skskAutocomplete = '1';
    input.setAttribute('autocomplete', 'off');

    let results = [];
    let active = -1;

    const pick = (entry) => {
      input.value = entry.key;
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
      results = search(input.value);
      active = results.length ? 0 : -1;
      closeDropdown();
      if (!results.length) return;

      dropdown = document.createElement('div');
      dropdown.className = 'sksk-key-autocomplete';
      for (const [i, entry] of results.entries()) {
        const row = document.createElement('div');
        row.className = 'sksk-key-autocomplete-row';
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = entry.label;
        const key = document.createElement('code');
        key.textContent = entry.key;
        const category = document.createElement('div');
        category.className = 'category';
        category.textContent = entry.category;
        row.append(label, key, category);
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

    input.addEventListener('input', open);
    // An untouched, already filled field just focuses quietly - suggestions
    // appear on typing or ArrowDown; an empty one offers the whole list.
    input.addEventListener('focus', () => { if (!input.value) open(); });
    input.addEventListener('blur', closeDropdown);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!dropdown) open();
        else highlight((active + 1) % results.length);
      } else if (event.key === 'ArrowUp' && dropdown) {
        event.preventDefault();
        highlight((active - 1 + results.length) % results.length);
      } else if ((event.key === 'Enter' || event.key === 'Tab') && dropdown && active >= 0) {
        event.preventDefault();
        pick(results[active]);
      } else if (event.key === 'Escape' && dropdown) {
        // Close only the list, not the whole sheet.
        event.preventDefault();
        event.stopPropagation();
        closeDropdown();
      }
    });
  }
}
