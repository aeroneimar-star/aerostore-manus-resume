"use strict";

const { getPdvFoundationManifest } = require("../services/pdvFoundationService");

function getPdvFoundationPage() {
  const manifest = getPdvFoundationManifest();
  return {
    id: "pdv-foundation",
    title: manifest.title,
    subtitle: manifest.subtitle,
    description: manifest.description
  };
}

module.exports = {
  getPdvFoundationPage
};
