import assert from "node:assert/strict";
import test from "node:test";
import { isCustomAlias, isSourceAlias } from "./alias";

const source = "ahmad.rizal@gmail.com";

test("validates dot, plus, and mixed Gmail aliases", () => {
  assert.equal(isSourceAlias("a.hmadrizal@gmail.com", source, "dot"), true);
  assert.equal(isSourceAlias("ahmadrizal+tag123@gmail.com", source, "plus"), true);
  assert.equal(isSourceAlias("a.hmadrizal+tag123@gmail.com", source, "mixed"), true);
});

test("mixed aliases require both a dot and plus tag", () => {
  assert.equal(isSourceAlias("a.hmad.rizal+tag@gmail.com", source, "mixed"), true);
  assert.equal(isSourceAlias("ahmad+tag@gmail.com", source, "mixed"), false);
  assert.equal(isSourceAlias("a.hmad.rizal@gmail.com", source, "mixed"), false);
});

test("validates custom-domain aliases", () => {
  const alias = "tag1234567@mail.example.com";
  assert.equal(isCustomAlias(alias, "mail.example.com"), true);
  assert.equal(isCustomAlias(alias, "other.example.com"), false);
});
