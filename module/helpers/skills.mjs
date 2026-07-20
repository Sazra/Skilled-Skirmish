/**
 * Skill points required to REACH a given level of a skill.
 * 5-level skills: the level 1 cost doubles for every subsequent level.
 * 10-level skills: the level 1 cost is added again for every subsequent level.
 * @param {number} level     The level being checked (1-based).
 * @param {number} maxLevel  The skill's maximum level (5 or 10).
 * @return {number|null}     Points required, or null for binary (maxLevel 1) skills.
 */
export function getSkillPointThreshold(level, maxLevel) {
  if (maxLevel === 5) {
    const base = game.settings.get('sksk', 'skillPointsLevel5');
    return base * Math.pow(2, level - 1);
  }
  if (maxLevel === 10) {
    const base = game.settings.get('sksk', 'skillPointsLevel10');
    return base * level;
  }
  return null;
}

/**
 * Derive the current level of a multi-level skill from accumulated points.
 * @param {number} points
 * @param {number} maxLevel
 * @return {number} The current level (0 if below the level 1 threshold).
 */
export function getSkillLevel(points, maxLevel) {
  if (maxLevel <= 1) return 0;
  let level = 0;
  for (let l = 1; l <= maxLevel; l++) {
    if (points >= getSkillPointThreshold(l, maxLevel)) level = l;
    else break;
  }
  return level;
}

/**
 * Evaluate a simple arithmetic expression (+, -, *, /, ^, parentheses).
 * A small hand-written recursive-descent parser rather than Foundry's Roll
 * class, since Roll's grammar has no exponentiation operator, and rather
 * than Function/eval, to avoid executing arbitrary GM-entered text.
 * @param {string} expression
 * @return {number}
 */
function evaluateArithmetic(expression) {
  const tokens = expression.match(/\d+\.?\d*|[+\-*/^()]/g) ?? [];
  if (tokens.join('') !== expression.replace(/\s+/g, '')) {
    throw new Error(`Invalid characters in expression: ${expression}`);
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // Precedence, low to high: +/- , * / , ^ (right-associative), unary +/-.
  function parseExpression() {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      value = next() === '+' ? value + parseTerm() : value - parseTerm();
    }
    return value;
  }

  function parseTerm() {
    let value = parseExponent();
    while (peek() === '*' || peek() === '/') {
      value = next() === '*' ? value * parseExponent() : value / parseExponent();
    }
    return value;
  }

  function parseExponent() {
    const base = parseUnary();
    if (peek() === '^') {
      next();
      return Math.pow(base, parseExponent());
    }
    return base;
  }

  function parseUnary() {
    if (peek() === '-') { next(); return -parseUnary(); }
    if (peek() === '+') { next(); return parseUnary(); }
    return parsePrimary();
  }

  function parsePrimary() {
    if (peek() === '(') {
      next();
      const value = parseExpression();
      if (next() !== ')') throw new Error('Expected ")"');
      return value;
    }
    const token = next();
    const num = Number(token);
    if (token === undefined || Number.isNaN(num)) throw new Error(`Unexpected token: ${token}`);
    return num;
  }

  const result = parseExpression();
  if (pos !== tokens.length) throw new Error('Unexpected trailing characters');
  return result;
}

/**
 * Flat, UI-friendly list of skill choices for the skill-bonus pickers on
 * Species and Class items. Restricted to multi-level (5 or 10) skills;
 * binary (maxLevel 1) skills like Chantless, Immunity or Absorption don't
 * take level bonuses, and stackable skills like Weaknesses aren't leveled
 * skills at all. Each entry carries a `group` (its category) so a single
 * `<select>` can render them as `<optgroup>`s instead of one long flat list.
 * @return {Array<{value: string, label: string, group: string}>}
 */
export function getSkillBonusChoices() {
  const choices = [];
  for (const [category, categorySkills] of Object.entries(CONFIG.SKSK.skills)) {
    for (const [key, def] of Object.entries(categorySkills)) {
      if (def.maxLevel !== 5 && def.maxLevel !== 10) continue;
      choices.push({ value: key, label: def.label, group: CONFIG.SKSK.skillCategories[category] });
    }
  }
  return choices;
}

/**
 * Sum starting skill LEVEL bonuses granted to an actor by its equipped
 * Species and (first-only) Class items. Each entry's "bonus" is a number of
 * whole skill levels (e.g. an Axe bonus of 1 grants Axe at level 1), not
 * skill points - it's added on top of the level derived from entered
 * points/formula, not blended into the point total. Species always grant
 * their bonuses; Class items only grant theirs when classType is "first" -
 * second, third and advanced classes instead treat the same list as
 * prerequisites.
 * @param {Actor} actor
 * @return {Object<string, number>} Summed level bonus per skill key.
 */
export function computeSkillBonusTotals(actor) {
  const totals = {};
  for (const item of actor.items) {
    const grants = item.type === 'species'
      || (item.type === 'class' && item.system.classType === 'first');
    if (!grants) continue;
    for (const entry of item.system.skillBonuses ?? []) {
      if (!entry.skill) continue;
      totals[entry.skill] = (totals[entry.skill] ?? 0) + (entry.bonus ?? 0);
    }
  }
  return totals;
}

/**
 * Safely evaluate a NPC skill formula supporting +, -, *, /, ^ and
 * parentheses. The letter "L" stands in for the actor's level (substituted
 * before evaluation), so GMs can write non-linear formulas as well, e.g.
 * "2^L * 40" or "L * L", not just a flat "L * 10".
 * @param {string} formula
 * @param {object} rollData   Must include `lvl`, the actor's current level.
 * @return {number} The numeric result, or 0 if the formula is empty/invalid.
 */
export function evaluateSkillFormula(formula, rollData) {
  if (!formula) return 0;
  try {
    const level = rollData?.lvl ?? 0;
    const withLevel = formula.replace(/\bL\b/g, String(level));
    return evaluateArithmetic(withLevel);
  } catch (e) {
    return 0;
  }
}

/**
 * Evaluate a bonus-scaling formula where "@value" stands for the
 * underlying number being scaled (an attribute's value/modifier, or a
 * skill's current level) - e.g. "@value / 2" for half that number.
 * @param {string} formula
 * @param {number} value
 * @return {number} The numeric result, or 0 if the formula is empty/invalid.
 */
export function evaluateBonusFormula(formula, value) {
  if (!formula) return 0;
  try {
    return evaluateArithmetic(formula.replace(/@value/g, String(value)));
  } catch (e) {
    return 0;
  }
}

/**
 * Look up a skill's definition (label/maxLevel/stackable) by key across
 * every category in CONFIG.SKSK.skills.
 * @param {string} skillKey
 * @return {object|null}
 */
function findSkillDefinition(skillKey) {
  for (const category of Object.values(CONFIG.SKSK.skills)) {
    if (category[skillKey]) return category[skillKey];
  }
  return null;
}

/**
 * Current level of a single multi-level skill on an actor, including
 * starting bonuses from equipped Species/Class items - the same
 * derivation the actor sheet's Skills tab uses per row. Only meaningful
 * for 5- or 10-level skills; binary or stackable skills have no "level"
 * and always return 0.
 * @param {Actor} actor
 * @param {string} skillKey
 * @return {number}
 */
export function getActorSkillLevel(actor, skillKey) {
  const def = findSkillDefinition(skillKey);
  if (!def || (def.maxLevel !== 5 && def.maxLevel !== 10)) return 0;

  const data = actor.system.skills?.[skillKey] ?? {};
  const bonus = computeSkillBonusTotals(actor)[skillKey] ?? 0;
  const points = actor.type === 'npc'
    ? evaluateSkillFormula(data.formula ?? '', actor.getRollData())
    : (data.points ?? 0);

  return Math.min(def.maxLevel, getSkillLevel(points, def.maxLevel) + bonus);
}
