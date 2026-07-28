"use strict";

const NORMALIZATION_VERSION = "customer-identity-normalization/v1";

const CLASSIFICATIONS = Object.freeze({
  EMPTY: "EMPTY",
  VALID: "VALID",
  INVALID: "INVALID",
  AMBIGUOUS: "AMBIGUOUS",
  PLACEHOLDER: "PLACEHOLDER",
  BRAZIL_MOBILE: "BRAZIL_MOBILE",
  BRAZIL_LANDLINE: "BRAZIL_LANDLINE",
  INTERNATIONAL_VALID: "INTERNATIONAL_VALID",
  CPF_VALID: "CPF_VALID",
  CPF_INVALID: "CPF_INVALID",
  OTHER_DOCUMENT: "OTHER_DOCUMENT",
  EMAIL_VALID: "EMAIL_VALID",
  EMAIL_INVALID: "EMAIL_INVALID",
  NAME_VALID: "NAME_VALID",
  NAME_INVALID: "NAME_INVALID",
  ADDRESS_VALID: "ADDRESS_VALID",
  ADDRESS_PARTIAL: "ADDRESS_PARTIAL"
});

const REASON_CODES = Object.freeze({
  VALUE_EMPTY: "VALUE_EMPTY",
  UNSUPPORTED_VALUE_TYPE: "UNSUPPORTED_VALUE_TYPE",
  PHONE_INVALID_LENGTH: "PHONE_INVALID_LENGTH",
  PHONE_INVALID_DDD: "PHONE_INVALID_DDD",
  PHONE_INVALID_PATTERN: "PHONE_INVALID_PATTERN",
  PHONE_PLACEHOLDER: "PHONE_PLACEHOLDER",
  PHONE_AMBIGUOUS_FORMAT: "PHONE_AMBIGUOUS_FORMAT",
  PHONE_INTERNATIONAL_UNSUPPORTED: "PHONE_INTERNATIONAL_UNSUPPORTED",
  PHONE_CARRIER_PREFIX_REMOVED: "PHONE_CARRIER_PREFIX_REMOVED",
  CPF_INVALID_LENGTH: "CPF_INVALID_LENGTH",
  CPF_REPEATED_DIGITS: "CPF_REPEATED_DIGITS",
  CPF_INVALID_CHECKSUM: "CPF_INVALID_CHECKSUM",
  DOCUMENT_TYPE_UNKNOWN: "DOCUMENT_TYPE_UNKNOWN",
  EMAIL_INVALID_FORMAT: "EMAIL_INVALID_FORMAT",
  EMAIL_PLACEHOLDER: "EMAIL_PLACEHOLDER",
  NAME_TOO_SHORT: "NAME_TOO_SHORT",
  NAME_PLACEHOLDER: "NAME_PLACEHOLDER",
  ZIP_INVALID: "ZIP_INVALID",
  STATE_INVALID: "STATE_INVALID",
  ADDRESS_INCOMPLETE: "ADDRESS_INCOMPLETE"
});

const VALID_BRAZIL_DDDS = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99"
]);

const VALID_BRAZIL_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO"
]);

const NAME_PLACEHOLDERS = new Set([
  "cliente",
  "cliente final",
  "consumidor final",
  "nao informado",
  "sem nome"
]);

function isScalar(value) {
  return value == null || ["string", "number", "bigint"].includes(typeof value);
}

function rawString(value) {
  return value == null ? "" : String(value);
}

function normalizeSpaces(value) {
  return rawString(value).replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value) {
  return normalizeSpaces(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function result(rawValue, values = {}) {
  return {
    version: NORMALIZATION_VERSION,
    rawValue: isScalar(rawValue) ? rawString(rawValue) : "",
    normalizedValue: "",
    canonicalValue: null,
    classification: CLASSIFICATIONS.INVALID,
    isValid: false,
    reasons: [],
    warnings: [],
    maskedValue: "",
    ...values
  };
}

function invalidType(value) {
  if (isScalar(value)) return null;
  return result(value, {
    reasons: [REASON_CODES.UNSUPPORTED_VALUE_TYPE]
  });
}

function maskPhone(digits) {
  if (!digits) return "";
  const visible = digits.slice(-4);
  return `${"*".repeat(Math.max(4, digits.length - 4))}${visible}`;
}

function stripBrazilDialPrefixes(digits) {
  if (/^0\d{2}\d{10,11}$/.test(digits)) {
    return {
      digits: digits.slice(3),
      warning: REASON_CODES.PHONE_CARRIER_PREFIX_REMOVED
    };
  }
  if (/^0\d{10,11}$/.test(digits)) {
    return {
      digits: digits.slice(1),
      warning: REASON_CODES.PHONE_CARRIER_PREFIX_REMOVED
    };
  }
  return { digits, warning: null };
}

function isPhonePlaceholder(digits) {
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  return /^(\d)\1+$/.test(national)
    || ["0123456789", "01234567890", "1234567890", "12345678901"].includes(national);
}

function normalizePhone(value) {
  const typedError = invalidType(value);
  if (typedError) return typedError;

  const raw = normalizeSpaces(value);
  if (!raw) {
    return result(value, {
      classification: CLASSIFICATIONS.EMPTY,
      reasons: [REASON_CODES.VALUE_EMPTY]
    });
  }

  const explicitlyInternational = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  const dialPrefix = stripBrazilDialPrefixes(digits);
  digits = dialPrefix.digits;
  const warnings = dialPrefix.warning ? [dialPrefix.warning] : [];

  if (!digits) {
    return result(value, {
      reasons: [REASON_CODES.PHONE_INVALID_LENGTH]
    });
  }
  if (isPhonePlaceholder(digits)) {
    return result(value, {
      normalizedValue: digits,
      classification: CLASSIFICATIONS.PLACEHOLDER,
      reasons: [REASON_CODES.PHONE_PLACEHOLDER],
      warnings,
      maskedValue: maskPhone(digits)
    });
  }

  if (explicitlyInternational && !digits.startsWith("55")) {
    if (/^[1-9]\d{7,14}$/.test(digits)) {
      return result(value, {
        normalizedValue: digits,
        canonicalValue: `+${digits}`,
        classification: CLASSIFICATIONS.INTERNATIONAL_VALID,
        isValid: true,
        warnings,
        maskedValue: maskPhone(digits)
      });
    }
    return result(value, {
      normalizedValue: digits,
      reasons: [REASON_CODES.PHONE_INTERNATIONAL_UNSUPPORTED],
      warnings,
      maskedValue: maskPhone(digits)
    });
  }

  let national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.startsWith("0")) {
    const stripped = stripBrazilDialPrefixes(national);
    national = stripped.digits;
    if (stripped.warning && !warnings.includes(stripped.warning)) warnings.push(stripped.warning);
  }

  if (!/^\d{10,11}$/.test(national)) {
    return result(value, {
      normalizedValue: national,
      classification: national.length === 10 && /^[1-9]\d[6-9]\d{7}$/.test(national)
        ? CLASSIFICATIONS.AMBIGUOUS
        : CLASSIFICATIONS.INVALID,
      reasons: [REASON_CODES.PHONE_INVALID_LENGTH],
      warnings,
      maskedValue: maskPhone(national)
    });
  }

  const ddd = national.slice(0, 2);
  const subscriber = national.slice(2);
  if (!VALID_BRAZIL_DDDS.has(ddd)) {
    return result(value, {
      normalizedValue: national,
      reasons: [REASON_CODES.PHONE_INVALID_DDD],
      warnings,
      maskedValue: maskPhone(national)
    });
  }

  if (subscriber.length === 9 && subscriber.startsWith("9")) {
    const canonical = `55${national}`;
    return result(value, {
      normalizedValue: canonical,
      canonicalValue: `+${canonical}`,
      classification: CLASSIFICATIONS.BRAZIL_MOBILE,
      isValid: true,
      warnings,
      maskedValue: maskPhone(canonical)
    });
  }

  if (subscriber.length === 8 && /^[2-5]/.test(subscriber)) {
    const canonical = `55${national}`;
    return result(value, {
      normalizedValue: canonical,
      canonicalValue: `+${canonical}`,
      classification: CLASSIFICATIONS.BRAZIL_LANDLINE,
      isValid: true,
      warnings,
      maskedValue: maskPhone(canonical)
    });
  }

  if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) {
    return result(value, {
      normalizedValue: national,
      classification: CLASSIFICATIONS.AMBIGUOUS,
      reasons: [REASON_CODES.PHONE_AMBIGUOUS_FORMAT],
      warnings,
      maskedValue: maskPhone(national)
    });
  }

  return result(value, {
    normalizedValue: national,
    reasons: [REASON_CODES.PHONE_INVALID_PATTERN],
    warnings,
    maskedValue: maskPhone(national)
  });
}

function cpfCheckDigit(base) {
  let sum = 0;
  for (let index = 0; index < base.length; index += 1) {
    sum += Number(base[index]) * (base.length + 1 - index);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

function isValidCpf(digits) {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const first = cpfCheckDigit(digits.slice(0, 9));
  const second = cpfCheckDigit(`${digits.slice(0, 9)}${first}`);
  return digits.endsWith(`${first}${second}`);
}

function maskDocument(digits) {
  if (!digits) return "";
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

function normalizeDocument(value) {
  const typedError = invalidType(value);
  if (typedError) return typedError;

  const raw = normalizeSpaces(value);
  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return result(value, {
      classification: CLASSIFICATIONS.EMPTY,
      reasons: [REASON_CODES.VALUE_EMPTY]
    });
  }

  if (digits.length === 11) {
    if (/^(\d)\1{10}$/.test(digits)) {
      return result(value, {
        normalizedValue: digits,
        classification: CLASSIFICATIONS.CPF_INVALID,
        reasons: [REASON_CODES.CPF_REPEATED_DIGITS],
        maskedValue: maskDocument(digits)
      });
    }
    if (!isValidCpf(digits)) {
      return result(value, {
        normalizedValue: digits,
        classification: CLASSIFICATIONS.CPF_INVALID,
        reasons: [REASON_CODES.CPF_INVALID_CHECKSUM],
        maskedValue: maskDocument(digits)
      });
    }
    return result(value, {
      normalizedValue: digits,
      canonicalValue: digits,
      classification: CLASSIFICATIONS.CPF_VALID,
      isValid: true,
      maskedValue: maskDocument(digits)
    });
  }

  if (digits.length === 14) {
    return result(value, {
      normalizedValue: digits,
      classification: CLASSIFICATIONS.OTHER_DOCUMENT,
      reasons: [REASON_CODES.DOCUMENT_TYPE_UNKNOWN],
      maskedValue: maskDocument(digits)
    });
  }

  return result(value, {
    normalizedValue: digits,
    classification: CLASSIFICATIONS.AMBIGUOUS,
    reasons: [REASON_CODES.CPF_INVALID_LENGTH, REASON_CODES.DOCUMENT_TYPE_UNKNOWN],
    maskedValue: maskDocument(digits)
  });
}

function maskEmail(email) {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "";
  return `${local.slice(0, 1) || "*"}***@${domain}`;
}

function normalizeEmail(value) {
  const typedError = invalidType(value);
  if (typedError) return typedError;

  const email = normalizeSpaces(value).toLowerCase();
  if (!email) {
    return result(value, {
      classification: CLASSIFICATIONS.EMPTY,
      reasons: [REASON_CODES.VALUE_EMPTY]
    });
  }

  if (["nao@informado", "sem@email", "teste@teste"].includes(email)) {
    return result(value, {
      normalizedValue: email,
      classification: CLASSIFICATIONS.PLACEHOLDER,
      reasons: [REASON_CODES.EMAIL_PLACEHOLDER],
      maskedValue: maskEmail(email)
    });
  }

  const valid = email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    && !email.includes("..");
  return result(value, {
    normalizedValue: email,
    canonicalValue: valid ? email : null,
    classification: valid ? CLASSIFICATIONS.EMAIL_VALID : CLASSIFICATIONS.EMAIL_INVALID,
    isValid: valid,
    reasons: valid ? [] : [REASON_CODES.EMAIL_INVALID_FORMAT],
    maskedValue: maskEmail(email)
  });
}

function maskName(name) {
  if (!name) return "";
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0]}${part.length > 1 ? "***" : ""}`)
    .join(" ");
}

function normalizeName(value) {
  const typedError = invalidType(value);
  if (typedError) return typedError;

  const name = normalizeSpaces(value);
  const searchValue = normalizeSearchText(name);
  if (!name) {
    return {
      ...result(value, {
        classification: CLASSIFICATIONS.EMPTY,
        reasons: [REASON_CODES.VALUE_EMPTY]
      }),
      searchValue: ""
    };
  }

  if (NAME_PLACEHOLDERS.has(searchValue)) {
    return {
      ...result(value, {
        normalizedValue: name,
        classification: CLASSIFICATIONS.PLACEHOLDER,
        reasons: [REASON_CODES.NAME_PLACEHOLDER],
        maskedValue: maskName(name)
      }),
      searchValue
    };
  }

  const valid = searchValue.replace(/\s/g, "").length >= 2;
  return {
    ...result(value, {
      normalizedValue: name,
      canonicalValue: valid ? name : null,
      classification: valid ? CLASSIFICATIONS.NAME_VALID : CLASSIFICATIONS.NAME_INVALID,
      isValid: valid,
      reasons: valid ? [] : [REASON_CODES.NAME_TOO_SHORT],
      maskedValue: maskName(name)
    }),
    searchValue
  };
}

function normalizeAddress(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      version: NORMALIZATION_VERSION,
      source: "",
      fields: {},
      classification: CLASSIFICATIONS.INVALID,
      isValid: false,
      reasons: [REASON_CODES.UNSUPPORTED_VALUE_TYPE],
      warnings: []
    };
  }

  const source = normalizeSpaces(value.source);
  const state = normalizeSpaces(value.state).toUpperCase();
  const zipcode = rawString(value.zipcode).replace(/\D/g, "");
  const fields = {
    address: normalizeSpaces(value.address),
    number: normalizeSpaces(value.number),
    complement: normalizeSpaces(value.complement),
    neighborhood: normalizeSpaces(value.neighborhood),
    zipcode,
    city: normalizeSpaces(value.city),
    state
  };
  const hasAny = Object.values(fields).some(Boolean);
  const reasons = [];
  if (!hasAny) reasons.push(REASON_CODES.VALUE_EMPTY);
  if (zipcode && !/^\d{8}$/.test(zipcode)) reasons.push(REASON_CODES.ZIP_INVALID);
  if (state && !VALID_BRAZIL_STATES.has(state)) reasons.push(REASON_CODES.STATE_INVALID);
  const complete = Boolean(fields.address && fields.city && VALID_BRAZIL_STATES.has(state));
  if (hasAny && !complete) reasons.push(REASON_CODES.ADDRESS_INCOMPLETE);

  return {
    version: NORMALIZATION_VERSION,
    source,
    fields,
    classification: !hasAny
      ? CLASSIFICATIONS.EMPTY
      : complete && !reasons.length
        ? CLASSIFICATIONS.ADDRESS_VALID
        : CLASSIFICATIONS.ADDRESS_PARTIAL,
    isValid: complete && !reasons.length,
    reasons,
    warnings: [],
    primary: false
  };
}

module.exports = {
  NORMALIZATION_VERSION,
  CLASSIFICATIONS,
  REASON_CODES,
  normalizeSpaces,
  normalizeSearchText,
  normalizePhone,
  normalizeDocument,
  normalizeEmail,
  normalizeName,
  normalizeAddress,
  isValidCpf
};
