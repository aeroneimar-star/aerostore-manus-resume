"use strict";

function buildPdvMetricCards(metrics = []) {
  return metrics.map((metric) => ({
    label: metric.label,
    value: metric.value,
    helper: metric.helper || ""
  }));
}

function buildPdvRouteCards(routes = []) {
  return routes.map((route) => ({
    key: route.key,
    path: route.path,
    label: route.label,
    description: route.description
  }));
}

module.exports = {
  buildPdvMetricCards,
  buildPdvRouteCards
};
