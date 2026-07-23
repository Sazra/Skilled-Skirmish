/**
 * Render one formula-breakdown row - a label, its final contribution, and
 * (for rows scaled by level, e.g. Life/Mana components) the raw per-level
 * rate alongside it.
 * @param {{label: string, perLevel: (number|null), value: number}} row
 * @return {string}
 */
function renderRow(row) {
  const perLevelText = row.perLevel != null
    ? ` <span class="sksk-breakdown-perlevel">(${row.perLevel}/${game.i18n.localize('SKSK.Breakdown.Level')})</span>`
    : '';
  return `<div class="sksk-breakdown-row">`
    + `<span class="sksk-breakdown-label">${foundry.utils.escapeHTML(row.label)}</span>`
    + `<span class="sksk-breakdown-value">${row.value}${perLevelText}</span>`
    + `</div>`;
}

/**
 * Render one non-itemized summary line (a subtotal, multiplier, or total).
 * @param {string} label
 * @param {string} value
 * @param {string} [extraClass]
 * @return {string}
 */
function renderSummaryLine(label, value, extraClass = '') {
  return `<div class="sksk-breakdown-row ${extraClass}">`
    + `<span class="sksk-breakdown-label">${foundry.utils.escapeHTML(label)}</span>`
    + `<span class="sksk-breakdown-value">${value}</span>`
    + `</div>`;
}

/**
 * Render the HTML content for a hover tooltip breaking down one of the
 * actor sheet's computed resources (Life/Negative Life/Mana/AC/MR) into
 * its formula's individual components - see data-tooltip-html on the
 * relevant resource labels in resources.hbs/resources-npc.hbs. Handles
 * every breakdown shape returned by helpers/life.mjs, helpers/mana.mjs and
 * helpers/defense.mjs's getXBreakdown functions.
 * @param {string} title
 * @param {object} breakdown
 * @return {string}
 */
export function renderBreakdownHtml(title, breakdown) {
  const { rows, subtotal, multiplier, flatBonus, withoutToughness, withToughness, total } = breakdown;
  const lines = rows.map(renderRow);

  // Life/Mana-shaped breakdowns have an intermediate subtotal before any
  // multiplier/flat bonus is applied - AC/MR are purely additive and skip
  // straight from their rows to the total.
  if (subtotal !== undefined) {
    lines.push(renderSummaryLine(game.i18n.localize('SKSK.Breakdown.Subtotal'), subtotal, 'sksk-breakdown-subtotal'));
  }
  if (multiplier) {
    lines.push(renderSummaryLine(multiplier.label, `×${multiplier.factor}`));
  }
  // Negative Life-shaped only: the two candidate values before taking the
  // lower of the two as the final total.
  if (withoutToughness !== undefined) {
    lines.push(renderSummaryLine(game.i18n.localize('SKSK.Breakdown.NegativeLifeBaseline'), withoutToughness));
    lines.push(renderSummaryLine(game.i18n.localize('SKSK.Breakdown.ActualMaxLife'), withToughness));
  }
  if (flatBonus !== undefined) {
    lines.push(renderSummaryLine(game.i18n.localize('SKSK.Breakdown.EffectsBonus'), flatBonus));
  }
  lines.push(renderSummaryLine(game.i18n.localize('SKSK.Breakdown.Total'), total, 'sksk-breakdown-total'));

  return `<div class="sksk-breakdown-tooltip">`
    + `<div class="sksk-breakdown-title">${foundry.utils.escapeHTML(title)}</div>`
    + lines.join('')
    + `</div>`;
}
