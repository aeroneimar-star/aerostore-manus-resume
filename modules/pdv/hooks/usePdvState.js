"use strict";

function createPdvInitialState() {
  return {
    route: "/pdv/dashboard",
    manifestLoaded: false,
    manifest: null,
    loading: false,
    error: null
  };
}

module.exports = {
  createPdvInitialState
};
