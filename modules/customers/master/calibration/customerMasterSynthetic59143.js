"use strict";

const {
  runCustomerMasterBackfillDryRun
} = require("../backfill/customerMasterDryRunService");

const SYNTHETIC_TOTAL = 59143;
const SYNTHETIC_CONTACTS = 36502;
const SYNTHETIC_CRM_CONTACTS = 22641;
const REPRESENTATIVE_PAIR_COUNT = 1000;
const SYNTHETIC_CODE_VERSION = "customer-master-synthetic-59143/v1";

function cpfCheckDigit(base) {
  let sum = 0;
  for (let index = 0; index < base.length; index += 1) {
    sum += Number(base[index]) * (base.length + 1 - index);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

function deterministicCpf(index) {
  const base = String(100000000 + Number(index)).padStart(9, "0").slice(-9);
  const first = cpfCheckDigit(base);
  const second = cpfCheckDigit(`${base}${first}`);
  return `${base}${first}${second}`;
}

function deterministicPhone(index) {
  return `119${String(index).padStart(8, "0").slice(-8)}`;
}

function baseRow(sourceType, index) {
  const id = `${sourceType === "contacts" ? "contact" : "crm"}-${String(index).padStart(6, "0")}`;
  return {
    id,
    name: `Synthetic Customer ${String(index).padStart(6, "0")}`,
    phone: deterministicPhone(sourceType === "contacts" ? index : SYNTHETIC_CONTACTS + index),
    mobile: "",
    document: "",
    email: `${id}@example.invalid`,
    birth_date: "",
    address: "",
    neighborhood: "",
    zipcode: "",
    city: "",
    state: "",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  };
}

function buildRepresentativeDataset(options = {}) {
  const contactsCount = Number(options.contactsCount ?? SYNTHETIC_CONTACTS);
  const crmContactsCount = Number(options.crmContactsCount ?? SYNTHETIC_CRM_CONTACTS);
  const pairCount = Math.min(
    Number(options.pairCount ?? REPRESENTATIVE_PAIR_COUNT),
    contactsCount,
    crmContactsCount
  );
  const contacts = Array.from({ length: contactsCount }, (_, offset) => {
    const index = offset + 1;
    const row = {
      ...baseRow("contacts", index),
      mobile_normalized: "",
      phone_fixed: "",
      source: "synthetic",
      deleted_at: null
    };
    if (index <= pairCount) row.document = deterministicCpf(index);
    if (index <= 2) row.status = "inactive";
    if (index > 2 && index <= 8) row.deleted_at = "2026-01-02T00:00:00.000Z";
    return row;
  });
  const crmContacts = Array.from({ length: crmContactsCount }, (_, offset) => {
    const index = offset + 1;
    const row = {
      ...baseRow("crm_contacts", index),
      external_id: "",
      external_code: "",
      fantasy_name: "",
      person_type: "F",
      number: "",
      complement: "",
      source_file: "synthetic.csv",
      source_row: String(index),
      import_hash: ""
    };
    if (index <= pairCount) {
      row.name = contacts[index - 1].name;
      row.document = deterministicCpf(index);
    }
    if (index <= 72) row.status = "inactive";
    return row;
  });
  return { contacts, crmContacts };
}

function buildStressDataset(options = {}) {
  const dataset = buildRepresentativeDataset(options);
  const bucketSize = Number(options.bucketSize ?? 51);
  const sharedCpf = deterministicCpf(900000);
  for (let index = 0; index < Math.min(bucketSize, dataset.contacts.length); index += 1) {
    dataset.contacts[index].document = sharedCpf;
    dataset.contacts[index].name = "Synthetic Stress Bucket";
  }
  return dataset;
}

function createSyntheticReader(dataset) {
  return {
    async getSourceSchemaSummary() {
      return {
        contacts: { exists: true, softDeleteField: "deleted_at" },
        crm_contacts: { exists: true, softDeleteField: null }
      };
    },
    async countContacts() {
      return dataset.contacts.length;
    },
    async countCrmContacts() {
      return dataset.crmContacts.length;
    },
    async readContactsPage({ offset, limit }) {
      return dataset.contacts.slice(offset, offset + limit);
    },
    async readCrmContactsPage({ offset, limit }) {
      return dataset.crmContacts.slice(offset, offset + limit);
    }
  };
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external
  };
}

function summarizeClusters(candidates = []) {
  let largest = 0;
  const histogram = {};
  candidates.forEach((candidate) => {
    const size = Number(candidate.sourceCount || 0);
    largest = Math.max(largest, size);
    histogram[size] = Number(histogram[size] || 0) + 1;
  });
  return { largest, histogram };
}

async function runSyntheticCalibration(options = {}) {
  const scenario = options.scenario === "stress" ? "stress" : "representative";
  const initialMemory = memorySnapshot();
  const startedAt = process.hrtime.bigint();
  const dataset = scenario === "stress"
    ? buildStressDataset(options.dataset)
    : buildRepresentativeDataset(options.dataset);
  const afterDatasetMemory = memorySnapshot();
  const report = await runCustomerMasterBackfillDryRun(
    createSyntheticReader(dataset),
    {
      codeVersion: SYNTHETIC_CODE_VERSION,
      limits: options.limits
    }
  );
  const finishedAt = process.hrtime.bigint();
  if (options.collectGarbage === true && typeof global.gc === "function") global.gc();
  const finalMemory = memorySnapshot();
  const maxRssBytes = Number(process.resourceUsage().maxRSS) * 1024;
  const clusters = summarizeClusters(report.candidates);
  const oversizedBuckets = (report.errors?.[0]?.details?.buckets || []).map((bucket) => ({
    type: String(bucket.type || "UNKNOWN"),
    size: Number(bucket.size || 0)
  }));
  oversizedBuckets.forEach((bucket) => {
    clusters.largest = Math.max(clusters.largest, bucket.size);
  });
  clusters.oversizedBuckets = oversizedBuckets;
  const total = dataset.contacts.length + dataset.crmContacts.length;
  return {
    scenario,
    syntheticOnly: true,
    volume: {
      total,
      contacts: dataset.contacts.length,
      crm_contacts: dataset.crmContacts.length
    },
    status: report.status,
    errorCode: report.errors?.[0]?.code || null,
    durationMs: Number(finishedAt - startedAt) / 1e6,
    costPerThousandMs: total ? (Number(finishedAt - startedAt) / 1e6) * 1000 / total : 0,
    memory: {
      initial: initialMemory,
      afterDataset: afterDatasetMemory,
      peakRssBytes: Math.max(maxRssBytes, initialMemory.rssBytes, finalMemory.rssBytes),
      final: finalMemory,
      approximateRecordsBytes: report.performance?.approximateMemoryBytes ?? null
    },
    performance: {
      operations: report.performance?.operations ?? null,
      comparisons: report.performance?.comparisons ?? null,
      pages: report.performance?.pages ?? null
    },
    candidates: {
      groups: report.counts?.candidateGroups ?? null,
      isolated: report.counts?.isolated ?? null,
      safe: report.counts?.safeCandidates ?? null,
      reviewRequired: report.counts?.reviewRequired ?? null,
      conflicting: report.counts?.conflictingCandidates ?? null
    },
    clusters,
    conflicts: {
      total: report.counts?.conflicts ?? null,
      byType: report.counts?.conflictsByType ?? {}
    },
    fingerprint: report.fingerprint,
    warnings: report.warnings || []
  };
}

module.exports = {
  SYNTHETIC_TOTAL,
  SYNTHETIC_CONTACTS,
  SYNTHETIC_CRM_CONTACTS,
  REPRESENTATIVE_PAIR_COUNT,
  SYNTHETIC_CODE_VERSION,
  deterministicCpf,
  deterministicPhone,
  buildRepresentativeDataset,
  buildStressDataset,
  createSyntheticReader,
  runSyntheticCalibration
};
