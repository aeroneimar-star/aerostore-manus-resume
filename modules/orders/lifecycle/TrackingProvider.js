"use strict";

/**
 * Tracking Provider Interface
 * Contract for shipping tracking integration.
 * Currently NO real carrier integration — preparing the contract.
 * Timeline must accept: código, transportadora, URL futura.
 */

class TrackingProvider {
  /**
   * Get tracking info for a shipment.
   * @param {string} trackingCode
   * @returns {Promise<{status: string, events: Array, carrier: string, url: string}>}
   */
  async getTracking(trackingCode) {
    throw new Error("NOT_IMPLEMENTED");
  }

  /**
   * Create a tracking label.
   * @param {object} shipment
   * @returns {Promise<{trackingCode: string, labelUrl: string}>}
   */
  async createLabel(shipment) {
    throw new Error("NOT_IMPLEMENTED");
  }

  /**
   * Get carrier info.
   */
  getCarrierInfo() {
    return { name: "Unknown", url: "" };
  }
}

class MockTrackingProvider extends TrackingProvider {
  constructor() {
    super();
    this._trackings = new Map();
  }

  async getTracking(trackingCode) {
    const info = this._trackings.get(trackingCode);
    if (info) return info;

    // Simulate a default tracking response
    return {
      trackingCode,
      carrier: "Correios",
      url: `https://rastreamento.correios.com.br/app/resultado.php?objeto=${trackingCode}`,
      status: "IN_TRANSIT",
      events: [
        { at: "2026-08-01T10:00:00Z", description: "Objeto postado", location: "Centro de Distribuição SP" },
        { at: "2026-08-01T14:00:00Z", description: "Em trânsito para unidade de destino", location: "Centro de Distribuição SP" },
      ],
      estimatedDelivery: "2026-08-05",
    };
  }

  async createLabel(shipment) {
    const trackingCode = `BR${Date.now().toString().slice(-12)}AA`;
    this._trackings.set(trackingCode, {
      trackingCode,
      carrier: "Correios (Simulado)",
      url: `https://rastreamento.correios.com.br/app/resultado.php?objeto=${trackingCode}`,
      status: "LABEL_CREATED",
      events: [
        { at: new Date().toISOString(), description: "Etiqueta gerada", location: "CD São Paulo" },
      ],
      estimatedDelivery: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
    });
    return { trackingCode, labelUrl: `https://mock-labels.example.com/${trackingCode}.pdf` };
  }

  getCarrierInfo() {
    return { name: "Correios (Simulado)", url: "https://www.correios.com.br" };
  }

  /**
   * Seed mock data for testing.
   */
  seed(trackingCode, data) {
    this._trackings.set(trackingCode, data);
  }
}

module.exports = { TrackingProvider, MockTrackingProvider };
