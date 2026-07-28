"use strict";

module.exports = Object.freeze({
  metadata: Object.freeze({
    synthetic: true,
    containsRealCustomerData: false,
    purpose: "Deterministic unit fixtures for the Fase 3.1-A normalization contract."
  }),
  phones: Object.freeze({
    brazilMobile: "+55 (11) 90000-0001",
    brazilLandline: "(11) 3000-0001",
    carrierPrefix: "02111900000001",
    oldMobileAmbiguous: "(11) 8000-0001",
    international: "+1 202 555 0101",
    placeholder: "11 11111-1111",
    invalidDdd: "(10) 90000-0001",
    tooShort: "12345"
  }),
  documents: Object.freeze({
    validCpf: "123.456.789-09",
    invalidChecksum: "123.456.789-00",
    repeated: "111.111.111-11",
    otherDocument: "12.345.678/0001-00",
    ambiguous: "12345"
  }),
  emails: Object.freeze({
    valid: "  Cliente.Alfa@Example.invalid ",
    invalid: "cliente..alfa@example.invalid",
    placeholder: "sem@email"
  }),
  names: Object.freeze({
    valid: "  Cliente   Sintético   Alfa  ",
    abbreviation: "C. S. Alfa",
    placeholder: "Consumidor final",
    tooShort: "A"
  }),
  addresses: Object.freeze({
    complete: Object.freeze({
      source: "fixture:contacts:1",
      address: "Rua Sintética",
      number: "100",
      complement: "Sala A",
      neighborhood: "Bairro Exemplo",
      zipcode: "01001-000",
      city: "São Paulo",
      state: "sp"
    }),
    partial: Object.freeze({
      source: "fixture:crm_contacts:2",
      city: "Cidade Sintética",
      state: "XX",
      zipcode: "123"
    })
  })
});
