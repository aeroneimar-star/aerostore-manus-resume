const { all, run } = require("../../db");
const { getNotificationService, getCashbackBalance, getNotificationDryRunDefault } = require("./NotificationService");
const { isValidWhatsAppPhone } = require("./providers/WhatsAppCloudProvider");

function formatDateLocal(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addLocalDays(days = 0, baseDate = new Date()) {
  const date = new Date(baseDate.getTime());
  date.setDate(date.getDate() + Number(days || 0));
  return formatDateLocal(date);
}

function parseCashbackDateToLocal(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return formatDateLocal(date);
}

class CashbackScheduler {
  constructor(options = {}) {
    this.service = options.service || getNotificationService();
    this.batchLimit = Number(options.batchLimit || process.env.NOTIFICATION_CASHBACK_BATCH_LIMIT || 50);
  }

  hasSaldo(cashback = {}) {
    const status = String(cashback.status || "").trim().toLowerCase();
    if (!["disponivel", "available", "ativo", "active"].includes(status)) return false;
    if (cashback.used_at || cashback.canceled_at || cashback.cancelled_at || cashback.expired_at) return false;
    return getCashbackBalance(cashback) > 0;
  }

  async loadActiveCashbacks() {
    return all(
      `SELECT *
       FROM cashbacks
       WHERE COALESCE(expires_at, '') <> ''
         AND COALESCE(customer_phone, '') <> ''
         AND available_balance > 0
         AND status IN ('disponivel', 'available', 'ativo', 'active')
       ORDER BY expires_at ASC, id ASC`
    );
  }

  async runDailyCheck(options = {}) {
    const expired = await this.markExpiredCashbacks();
    const aviso10 = await this.checkAndNotify10Days(options);
    const aviso3 = await this.checkAndNotify3Days(options);
    return { expired, aviso10, aviso3 };
  }

  async checkAndNotify10Days(options = {}) {
    return this.checkAndNotifyByDays(10, options);
  }

  async checkAndNotify3Days(options = {}) {
    return this.checkAndNotifyByDays(3, options);
  }

  async checkAndNotifyByDays(days, options = {}) {
    const targetDate = addLocalDays(days);
    const dryRun = options.dryRun ?? getNotificationDryRunDefault();
    const rows = await this.loadActiveCashbacks();
    const targetRows = rows.filter((cashback) => {
      if (parseCashbackDateToLocal(cashback.expires_at) !== targetDate) return false;
      if (!this.hasSaldo(cashback)) return false;
      return isValidWhatsAppPhone(cashback.customer_phone || "");
    }).slice(0, this.batchLimit);

    const results = [];
    for (const cashback of targetRows) {
      const result = days === 10
        ? await this.service.sendCashbackAviso10Dias(cashback, { dryRun })
        : await this.service.sendCashbackAviso3Dias(cashback, { dryRun });
      results.push({ cashbackId: cashback.id, status: result.status, success: result.success });
    }
    return {
      days,
      targetDate,
      checked: rows.length,
      eligible: targetRows.length,
      batchLimit: this.batchLimit,
      results
    };
  }

  async markExpiredCashbacks() {
    const today = formatDateLocal(new Date());
    const result = await run(
      `UPDATE cashbacks
       SET lost_value = lost_value + available_balance,
           available_balance = 0,
           status = 'vencido',
           updated_at = datetime('now')
       WHERE status IN ('disponivel', 'available', 'ativo', 'active')
         AND COALESCE(expires_at, '') <> ''
         AND substr(expires_at, 1, 10) < ?
         AND available_balance > 0`,
      [today]
    ).catch(() => ({ changes: 0 }));
    return { date: today, markedExpired: Number(result?.changes || 0) };
  }
}

let schedulerStarted = false;
let lastCashbackReminderRunDate = null;

function startCashbackReminderScheduler(options = {}) {
  if (schedulerStarted) return false;
  const enabled = String(process.env.NOTIFICATION_SCHEDULER_ENABLED || "false").trim().toLowerCase() === "true";
  if (!enabled) return false;
  schedulerStarted = true;
  const scheduler = options.scheduler || new CashbackScheduler();
  const dryRun = options.dryRun ?? getNotificationDryRunDefault();

  setInterval(async () => {
    const now = new Date();
    const today = formatDateLocal(now);
    const hour = Number(new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false
    }).format(now));
    const minute = Number(new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      minute: "2-digit"
    }).format(now));

    if (hour === 9 && minute === 0 && lastCashbackReminderRunDate !== today) {
      lastCashbackReminderRunDate = today;
      try {
        await scheduler.runDailyCheck({ dryRun });
      } catch (error) {
        console.error("[NOTIFICATION SCHEDULER] cashback daily check failed", {
          error: String(error.message || error).slice(0, 160)
        });
      }
    }
  }, 60000);
  return true;
}

module.exports = {
  CashbackScheduler,
  startCashbackReminderScheduler,
  formatDateLocal,
  addLocalDays,
  parseCashbackDateToLocal
};
