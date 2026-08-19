import assert from "node:assert/strict";
import test from "node:test";
import { generateAlias } from "./alias-generator";

test("generates frontend aliases without a server call", () => {
  const sourceLocalParts = ["ahmadrizal"];
  const customDomains = ["mail.example.com"];

  assert.match(generateAlias("dot", sourceLocalParts, customDomains), /^[a-z.]+@gmail\.com$/);
  assert.match(generateAlias("plus", sourceLocalParts, customDomains), /^ahmadrizal\+[a-z0-9]+@gmail\.com$/);
  assert.match(generateAlias("mixed", sourceLocalParts, customDomains), /^[a-z.]+\+[a-z0-9]+@gmail\.com$/);
  assert.match(generateAlias("custom", sourceLocalParts, customDomains), /^[a-z0-9]{10}@mail\.example\.com$/);
});
