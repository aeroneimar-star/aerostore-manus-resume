"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("../fixtures/syntheticCustomerIdentityFixtures");
const {
  NORMALIZATION_VERSION,
  CLASSIFICATIONS,
  REASON_CODES,
  normalizePhone,
  normalizeDocument,
  normalizeEmail,
  normalizeName,
  normalizeAddress
} = require("../normalization");

test("fixtures are explicitly synthetic", () => {
  assert.equal(fixtures.metadata.synthetic, true);
  assert.equal(fixtures.metadata.containsRealCustomerData, false);
});

test("normalizes valid Brazilian mobile, landline and carrier prefix", () => {
  const mobile = normalizePhone(fixtures.phones.brazilMobile);
  assert.equal(mobile.version, NORMALIZATION_VERSION);
  assert.equal(mobile.classification, CLASSIFICATIONS.BRAZIL_MOBILE);
  assert.equal(mobile.canonicalValue, "+5511900000001");
  assert.equal(mobile.isValid, true);
  assert.notEqual(mobile.maskedValue, mobile.canonicalValue);

  const landline = normalizePhone(fixtures.phones.brazilLandline);
  assert.equal(landline.classification, CLASSIFICATIONS.BRAZIL_LANDLINE);
  assert.equal(landline.canonicalValue, "+551130000001");

  const carrier = normalizePhone(fixtures.phones.carrierPrefix);
  assert.equal(carrier.canonicalValue, "+5511900000001");
  assert.deepEqual(carrier.warnings, [REASON_CODES.PHONE_CARRIER_PREFIX_REMOVED]);
});

test("does not silently convert an old eight-digit mobile", () => {
  const value = normalizePhone(fixtures.phones.oldMobileAmbiguous);
  assert.equal(value.classification, CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(value.isValid, false);
  assert.deepEqual(value.reasons, [REASON_CODES.PHONE_AMBIGUOUS_FORMAT]);
  assert.equal(value.canonicalValue, null);
});

test("classifies international, placeholder, invalid DDD and invalid length", () => {
  assert.equal(normalizePhone(fixtures.phones.international).classification, CLASSIFICATIONS.INTERNATIONAL_VALID);
  assert.equal(normalizePhone(fixtures.phones.placeholder).classification, CLASSIFICATIONS.PLACEHOLDER);
  assert.deepEqual(normalizePhone(fixtures.phones.invalidDdd).reasons, [REASON_CODES.PHONE_INVALID_DDD]);
  assert.deepEqual(normalizePhone(fixtures.phones.tooShort).reasons, [REASON_CODES.PHONE_INVALID_LENGTH]);
  assert.equal(normalizePhone("").classification, CLASSIFICATIONS.EMPTY);
});

test("validates CPF checksum without treating other documents as CPF", () => {
  const valid = normalizeDocument(fixtures.documents.validCpf);
  assert.equal(valid.classification, CLASSIFICATIONS.CPF_VALID);
  assert.equal(valid.canonicalValue, "12345678909");
  assert.equal(valid.maskedValue, "***.***.***-09");

  assert.deepEqual(
    normalizeDocument(fixtures.documents.invalidChecksum).reasons,
    [REASON_CODES.CPF_INVALID_CHECKSUM]
  );
  assert.deepEqual(
    normalizeDocument(fixtures.documents.repeated).reasons,
    [REASON_CODES.CPF_REPEATED_DIGITS]
  );
  assert.equal(normalizeDocument(fixtures.documents.otherDocument).classification, CLASSIFICATIONS.OTHER_DOCUMENT);
  assert.equal(normalizeDocument(fixtures.documents.ambiguous).classification, CLASSIFICATIONS.AMBIGUOUS);
});

test("normalizes email and never exposes it as the masked representation", () => {
  const valid = normalizeEmail(fixtures.emails.valid);
  assert.equal(valid.classification, CLASSIFICATIONS.EMAIL_VALID);
  assert.equal(valid.canonicalValue, "cliente.alfa@example.invalid");
  assert.equal(valid.maskedValue, "c***@example.invalid");
  assert.equal(normalizeEmail(fixtures.emails.invalid).classification, CLASSIFICATIONS.EMAIL_INVALID);
  assert.equal(normalizeEmail(fixtures.emails.placeholder).classification, CLASSIFICATIONS.PLACEHOLDER);
});

test("normalizes names for display and search without expanding abbreviations", () => {
  const valid = normalizeName(fixtures.names.valid);
  assert.equal(valid.normalizedValue, "Cliente Sintético Alfa");
  assert.equal(valid.searchValue, "cliente sintetico alfa");
  assert.equal(valid.classification, CLASSIFICATIONS.NAME_VALID);

  const abbreviation = normalizeName(fixtures.names.abbreviation);
  assert.equal(abbreviation.normalizedValue, "C. S. Alfa");
  assert.equal(abbreviation.searchValue, "c s alfa");
  assert.equal(normalizeName(fixtures.names.placeholder).classification, CLASSIFICATIONS.PLACEHOLDER);
  assert.deepEqual(normalizeName(fixtures.names.tooShort).reasons, [REASON_CODES.NAME_TOO_SHORT]);
});

test("preserves each address source and never elects a primary address", () => {
  const complete = normalizeAddress(fixtures.addresses.complete);
  assert.equal(complete.source, "fixture:contacts:1");
  assert.equal(complete.fields.zipcode, "01001000");
  assert.equal(complete.fields.state, "SP");
  assert.equal(complete.classification, CLASSIFICATIONS.ADDRESS_VALID);
  assert.equal(complete.primary, false);

  const partial = normalizeAddress(fixtures.addresses.partial);
  assert.equal(partial.source, "fixture:crm_contacts:2");
  assert.equal(partial.classification, CLASSIFICATIONS.ADDRESS_PARTIAL);
  assert.equal(partial.reasons.includes(REASON_CODES.ZIP_INVALID), true);
  assert.equal(partial.reasons.includes(REASON_CODES.STATE_INVALID), true);
  assert.equal(partial.reasons.includes(REASON_CODES.ADDRESS_INCOMPLETE), true);
});

test("common malformed values serialize and do not throw", () => {
  const values = [null, undefined, "", {}, [], { nested: true }];
  for (const value of values) {
    for (const normalize of [normalizePhone, normalizeDocument, normalizeEmail, normalizeName]) {
      assert.doesNotThrow(() => JSON.stringify(normalize(value)));
      assert.equal(normalize(value).isValid, false);
    }
  }
  assert.doesNotThrow(() => JSON.stringify(normalizeAddress(null)));
});
