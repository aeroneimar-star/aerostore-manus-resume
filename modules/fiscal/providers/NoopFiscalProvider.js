"use strict";

/**
 * Provider Stage 1: nenhum contato externo (SEFAZ/provedor/SDK).
 * Existe apenas para deixar explícito que emissão/consulta estão bloqueadas.
 */
class NoopFiscalProvider {
  constructor() {
    this.name = "noop";
    this.externalCalls = 0;
  }

  assertBlocked(operation) {
    this.externalCalls += 1;
    const error = new Error(
      `FiscalProvider noop: operacao '${operation}' bloqueada no Stage 1 (sem transmissao).`
    );
    error.code = "FISCAL_PROVIDER_BLOCKED";
    error.statusCode = 501;
    throw error;
  }

  emit() {
    return this.assertBlocked("emit");
  }

  query() {
    return this.assertBlocked("query");
  }

  cancel() {
    return this.assertBlocked("cancel");
  }

  inutilize() {
    return this.assertBlocked("inutilize");
  }

  correctionLetter() {
    return this.assertBlocked("correctionLetter");
  }

  getStatus() {
    return this.assertBlocked("getStatus");
  }

  getXml() {
    return this.assertBlocked("getXml");
  }

  getDanfe() {
    return this.assertBlocked("getDanfe");
  }
}

module.exports = {
  NoopFiscalProvider
};
