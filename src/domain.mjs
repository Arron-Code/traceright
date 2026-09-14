export function calculateCompletion(checks) {
  const values = Object.values(checks);
  if (values.length === 0) {
    return 0;
  }

  const completed = values.filter(Boolean).length;
  return Math.round((completed / values.length) * 100);
}

export function validateMassBalance(inputs, outputs, toleranceKg = 0.01) {
  const sum = (items) => items.reduce((total, item) => total + item.quantityKg, 0);
  const inputKg = sum(inputs);
  const outputKg = sum(outputs);
  const differenceKg = Number((inputKg - outputKg).toFixed(3));

  return {
    inputKg,
    outputKg,
    differenceKg,
    balanced: Math.abs(differenceKg) <= toleranceKg
  };
}

export function riskStatus(score, requiresReview = false) {
  if (requiresReview || score >= 60) {
    return "review";
  }

  if (score >= 30) {
    return "attention";
  }

  return "low";
}
