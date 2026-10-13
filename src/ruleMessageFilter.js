// Which yellow warnings the Resident submit page shows.
// A blocked form shows only the red reasons; "already met" is shown by the green level notice instead of a second box.
export function visibleRuleWarnings(rules, { hideAlreadyMet = false } = {}) {
  if (rules.reasons.length) return [];
  return rules.warnings.filter((item) => !(hideAlreadyMet && item.code === "already-met"));
}
