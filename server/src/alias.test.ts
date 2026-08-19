import assert from "node:assert/strict";
import test from "node:test";
import { generateAlias, isCustomAlias, isSourceAlias } from "./alias";

const source = "ahmad.rizal@gmail.com";

test("generates valid dot, plus, and mixed Gmail aliases", () => {
  for (const type of ["dot", "plus", "mixed"] as const) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const alias = generateAlias(source, type);
      assert.equal(isSourceAlias(alias, source, type), true, `${type} alias was invalid: ${alias}`);
    }
  }
});

test("mixed aliases require both a dot and plus tag", () => {
  assert.equal(isSourceAlias("a.hmad.rizal+tag@gmail.com", source, "mixed"), true);
  assert.equal(isSourceAlias("ahmad+tag@gmail.com", source, "mixed"), false);
  assert.equal(isSourceAlias("a.hmad.rizal@gmail.com", source, "mixed"), false);
});

test("generates and validates custom-domain aliases", () => {
  const alias = generateAlias(source, "custom", "mail.example.com");
  assert.match(alias, /^[a-z0-9]{10}@mail\.example\.com$/);
  assert.equal(isCustomAlias(alias, "mail.example.com"), true);
  assert.equal(isCustomAlias(alias, "other.example.com"), false);
});
