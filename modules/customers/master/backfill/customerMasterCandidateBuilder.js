"use strict";

const CANDIDATE_RULE_VERSION = "customer-master-candidate-rules/v1";

function sourceKey(record) {
  return `${record.sourceType}:${record.sourceId}`;
}

function candidateIdFor(record) {
  return `dryrun:${record.sourceType}:${record.sourceId}`;
}

function validIdentifiers(record, type) {
  return record.normalizedIdentity.identifiers
    .filter((identifier) => identifier.type === type && identifier.valid && identifier.canonicalValue);
}

function exactSecondSignals(a, b) {
  const signals = [];
  const nameA = a.normalizedIdentity.name;
  const nameB = b.normalizedIdentity.name;
  if (nameA.isValid && nameB.isValid && nameA.searchValue === nameB.searchValue) signals.push("EXACT_NORMALIZED_NAME");

  const emailsA = new Set(validIdentifiers(a, "EMAIL").map((item) => item.canonicalValue));
  if (validIdentifiers(b, "EMAIL").some((item) => emailsA.has(item.canonicalValue))) signals.push("EXACT_VALID_EMAIL");

  const externalA = new Set(a.normalizedIdentity.externalValues.map((value) => `${a.sourceType}:${value}`));
  if (b.normalizedIdentity.externalValues.some((value) => externalA.has(`${b.sourceType}:${value}`))) {
    signals.push("EXACT_EXTERNAL_ID_NAMESPACE");
  }
  if (
    a.normalizedIdentity.birthDate
    && a.normalizedIdentity.birthDate === b.normalizedIdentity.birthDate
  ) {
    signals.push("EXACT_BIRTH_DATE");
  }
  return signals;
}

function buildBuckets(records, type) {
  const buckets = new Map();
  records.forEach((record, index) => {
    for (const identifier of validIdentifiers(record, type)) {
      const key = identifier.canonicalValue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(index);
    }
  });
  return buckets;
}

function buildCandidateGraph(records, options = {}) {
  const maxClusterSize = Math.max(2, Number(options.maxClusterSize || 50));
  const edges = [];
  const directPairs = new Set();
  const oversizedBuckets = [];
  let comparisons = 0;

  function addEdge(left, right, rule, secondSignals) {
    const pair = left < right ? `${left}:${right}` : `${right}:${left}`;
    if (!directPairs.has(pair)) {
      directPairs.add(pair);
      edges.push({ left, right, rule, secondSignals });
    }
  }

  const sourceBuckets = new Map();
  records.forEach((record, index) => {
    const key = sourceKey(record);
    if (!sourceBuckets.has(key)) sourceBuckets.set(key, []);
    sourceBuckets.get(key).push(index);
  });
  for (const indexes of sourceBuckets.values()) {
    if (indexes.length > maxClusterSize) {
      oversizedBuckets.push({ type: "SOURCE_ID", size: indexes.length });
      continue;
    }
    for (let index = 1; index < indexes.length; index += 1) {
      comparisons += 1;
      addEdge(indexes[0], indexes[index], "SAME_SOURCE_LINK", ["SOURCE_ID"]);
    }
  }

  const externalBuckets = new Map();
  records.forEach((record, index) => {
    for (const value of record.normalizedIdentity.externalValues) {
      const key = `${record.sourceType}:${value}`;
      if (!externalBuckets.has(key)) externalBuckets.set(key, []);
      externalBuckets.get(key).push(index);
    }
  });
  for (const indexes of externalBuckets.values()) {
    if (indexes.length > maxClusterSize) {
      oversizedBuckets.push({ type: "EXTERNAL_ID", size: indexes.length });
      continue;
    }
    for (let left = 0; left < indexes.length; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        comparisons += 1;
        addEdge(indexes[left], indexes[right], "EXTERNAL_ID_NAMESPACE", ["EXACT_EXTERNAL_ID_NAMESPACE"]);
      }
    }
  }

  const cpfBuckets = buildBuckets(records, "CPF");
  for (const indexes of cpfBuckets.values()) {
    if (indexes.length > maxClusterSize) {
      oversizedBuckets.push({ type: "CPF", size: indexes.length });
      continue;
    }
    for (let left = 0; left < indexes.length; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        comparisons += 1;
        const signals = exactSecondSignals(records[indexes[left]], records[indexes[right]]);
        if (signals.length) addEdge(indexes[left], indexes[right], "CPF_WITH_SECOND_SIGNAL", signals);
      }
    }
  }

  const phoneBuckets = buildBuckets(records, "PHONE");
  for (const indexes of phoneBuckets.values()) {
    if (indexes.length > maxClusterSize) {
      oversizedBuckets.push({ type: "PHONE", size: indexes.length });
      continue;
    }
    if (indexes.length !== 2) continue;
    comparisons += 1;
    const signals = exactSecondSignals(records[indexes[0]], records[indexes[1]]);
    if (signals.length) addEdge(indexes[0], indexes[1], "UNIQUE_PHONE_WITH_SECOND_SIGNAL", signals);
  }

  const emailBuckets = buildBuckets(records, "EMAIL");
  for (const indexes of emailBuckets.values()) {
    if (indexes.length > maxClusterSize) {
      oversizedBuckets.push({ type: "EMAIL", size: indexes.length });
    }
  }

  return {
    ruleVersion: CANDIDATE_RULE_VERSION,
    edges,
    directPairs,
    sourceBuckets,
    cpfBuckets,
    phoneBuckets,
    emailBuckets,
    oversizedBuckets,
    comparisons
  };
}

function buildCandidateClusters(records, graph) {
  const parent = records.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  graph.edges.forEach((edge) => union(edge.left, edge.right));
  const groups = new Map();
  records.forEach((record, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(index);
  });
  return Array.from(groups.values())
    .map((indexes) => ({
      id: indexes.length === 1
        ? candidateIdFor(records[indexes[0]])
        : `dryrun:group:${indexes.map((index) => sourceKey(records[index])).sort().join("|")}`,
      recordIndexes: indexes,
      sourceRefs: indexes.map((index) => sourceKey(records[index])).sort(),
      classification: indexes.some((index) => !records[index].sourceId)
        ? "INVALID_SOURCE"
        : indexes.length === 1 ? "ISOLATED" : "SAFE_CANDIDATE",
      ruleVersion: graph.ruleVersion
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = {
  CANDIDATE_RULE_VERSION,
  sourceKey,
  candidateIdFor,
  validIdentifiers,
  exactSecondSignals,
  buildBuckets,
  buildCandidateGraph,
  buildCandidateClusters
};
