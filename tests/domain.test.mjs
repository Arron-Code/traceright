import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateCompletion,
  riskStatus,
  validateMassBalance
} from "../src/domain.mjs";

test("calculates rounded workflow completion", () => {
  assert.equal(
    calculateCompletion({ supplier: true, plots: true, evidence: false }),
    67
  );
  assert.equal(calculateCompletion({}), 0);
});

test("validates balanced coffee transformations", () => {
  const result = validateMassBalance(
    [{ quantityKg: 12000 }, { quantityKg: 7240 }],
    [{ quantityKg: 18500 }, { quantityKg: 740 }]
  );

  assert.deepEqual(result, {
    inputKg: 19240,
    outputKg: 19240,
    differenceKg: 0,
    balanced: true
  });
});

test("rejects unbalanced material lineage", () => {
  const result = validateMassBalance(
    [{ quantityKg: 19000 }],
    [{ quantityKg: 18500 }, { quantityKg: 400 }]
  );

  assert.equal(result.balanced, false);
  assert.equal(result.differenceKg, 100);
});

test("keeps human review separate from numeric risk", () => {
  assert.equal(riskStatus(10, true), "review");
  assert.equal(riskStatus(65), "review");
  assert.equal(riskStatus(35), "attention");
  assert.equal(riskStatus(10), "low");
});
