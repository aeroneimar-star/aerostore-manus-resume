"use strict";

const crypto = require("node:crypto");
const { normalizePhone, maskPhone, stableHash } = require("../app-access/appCustomerAccessService");
const { identifierLookupHash } = require("../master/backfill/customerMasterControlledApply");
const { evaluateAppCustomerEligibility } = require("../app-access/evaluateAppCustomerEligibility");
const { createWhatsAppOtpProvider, createTwilioVerifyProvider, protectProviderId } = require("./appOtpProviders");

const PURPOSES = new Set(["APP_LOGIN", "NEW_REGISTRATION", "PHONE_CHANGE", "ACCOUNT_RECOVERY"]);

class AppPhoneOtpError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function createAppPhoneOtpService(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) throw new Error("APP_PHONE_OTP_DB_REQUIRED");
  const pepper = String(options.pepper || process.env.APP_OTP_PEPPER || "");
  if (!pepper) throw new Error("APP_OTP_PEPPER_REQUIRED");
  const whatsapp = options.whatsapp || createWhatsAppOtpProvider(options.whatsappOptions);
  const sms = options.sms || createTwilioVerifyProvider(options.twilioOptions);
  const now = options.now || (() => new Date());
  const randomCode = options.randomCode || (() => String(crypto.randomInt(0, 1000000)).padStart(6, "0"));
  const audit = options.recordAudit || (() => undefined);
  const completeLogin = options.completeLogin || null;
  const limits = { expiry: 300, cooldown: 60, fallbackDelay: 30, maxAttempts: 5, maxResends: 3, perPhone: 5, perIp: 20, perDevice: 10, window: 3600, ...(options.limits || {}) };

  const hmac = (value) => crypto.createHmac("sha256", pepper).update(String(value)).digest("hex");
  const iso = (date) => date.toISOString();
  const addSeconds = (date, seconds) => new Date(date.getTime() + seconds * 1000);
  const encryptPhone = (phone) => {
    const iv = crypto.randomBytes(12); const key = crypto.createHash("sha256").update(pepper).digest();
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); const body = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
  };
  const decryptPhone = (value) => {
    const [iv, tag, body] = String(value).split(".").map((part) => Buffer.from(part, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.createHash("sha256").update(pepper).digest(), iv);
    decipher.setAuthTag(tag); return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  };
  const codeHash = (id, code) => hmac(`otp/v1|${id}|${code}`);
  const safeEqual = (left, right) => {
    const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const emit = (action, row, extra = {}) => Promise.resolve(audit({
    module: "app_phone_auth", action, entityType: "app_phone_verification", entityId: row.id,
    result: "success", includeBody: false, metadata: { channel: row.channel, purpose: row.purpose, phoneHash: row.phone_lookup_hash, ...extra }
  }));

  async function enforceRate(phoneHash, ipHash, deviceHash, currentIso) {
    const since = iso(addSeconds(new Date(currentIso), -limits.window));
    const row = await db.get(`SELECT
      SUM(CASE WHEN phone_lookup_hash = ? THEN 1 ELSE 0 END) phone_count,
      SUM(CASE WHEN request_ip_hash = ? THEN 1 ELSE 0 END) ip_count,
      SUM(CASE WHEN device_hash = ? THEN 1 ELSE 0 END) device_count
      FROM app_phone_verifications WHERE created_at >= ?`, [phoneHash, ipHash, deviceHash, since]);
    if (Number(row?.phone_count || 0) >= limits.perPhone || Number(row?.ip_count || 0) >= limits.perIp || Number(row?.device_count || 0) >= limits.perDevice) {
      throw new AppPhoneOtpError("OTP_RATE_LIMITED", 429);
    }
  }

  async function createChallenge(input, channel = "WHATSAPP", resendCount = 0) {
    let phone;
    try { phone = normalizePhone(input.phone); } catch { throw new AppPhoneOtpError("OTP_INVALID_REQUEST"); }
    const purpose = String(input.purpose || "APP_LOGIN").toUpperCase();
    if (!PURPOSES.has(purpose)) throw new AppPhoneOtpError("OTP_INVALID_REQUEST");
    const current = now(); const currentIso = iso(current); const id = crypto.randomUUID();
    const phoneHash = stableHash(phone), ipHash = hmac(`ip|${input.ip || "unknown"}`), deviceHash = hmac(`device|${input.deviceId || "unknown"}`);
    await enforceRate(phoneHash, ipHash, deviceHash, currentIso);
    const code = channel === "WHATSAPP" ? randomCode() : "";
    await db.run("BEGIN IMMEDIATE");
    try {
      await db.run("UPDATE app_phone_verifications SET status = 'CANCELLED', updated_at = ? WHERE phone_lookup_hash = ? AND purpose = ? AND status IN ('PENDING','SENT')", [currentIso, phoneHash, purpose]);
      await db.run(`INSERT INTO app_phone_verifications
        (id, account_id, phone_lookup_hash, phone_protected, phone_masked, channel, purpose, status, otp_hash,
         attempt_count, resend_count, expires_at, created_at, updated_at, request_ip_hash, device_hash, whatsapp_fallback_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, 'PENDING', ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [id, phoneHash, encryptPhone(phone), maskPhone(phone), channel, purpose, code ? codeHash(id, code) : "", resendCount,
        iso(addSeconds(current, limits.expiry)), currentIso, currentIso, ipHash, deviceHash, channel === "WHATSAPP" ? iso(addSeconds(current, limits.fallbackDelay)) : null]);
      await db.run("COMMIT");
    } catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }
    const created = await db.get("SELECT * FROM app_phone_verifications WHERE id = ?", [id]);
    await emit("OTP_CHALLENGE_CREATED", created);
    let result;
    try { result = channel === "SMS" ? await sms.send({ phone }) : await whatsapp.send({ phone, code }); }
    catch (error) { result = { success: false, errorCode: "PROVIDER_FAILURE" }; }
    const status = result.success ? "SENT" : "FAILED";
    await db.run(`UPDATE app_phone_verifications SET status = ?, provider_message_id = ?, provider_status = ?, last_error_code = ?, updated_at = ? WHERE id = ?`,
      [status, protectProviderId(result.messageId, pepper), String(result.status || ""), String(result.errorCode || ""), iso(now()), id]);
    const row = await db.get("SELECT * FROM app_phone_verifications WHERE id = ?", [id]);
    await emit(result.success ? (channel === "SMS" ? "OTP_SMS_REQUESTED" : "OTP_SENT_WHATSAPP") : "OTP_SEND_FAILED", row);
    return { challengeId: id, status: "CODE_REQUEST_ACCEPTED", phoneMasked: maskPhone(phone), channel, expiresIn: limits.expiry, resendAfter: limits.cooldown, smsSupported: Boolean(sms.available), smsAvailableAfter: channel === "WHATSAPP" && result.success ? limits.fallbackDelay : 0, smsAvailable: Boolean(sms.available && (channel === "SMS" || !result.success)) };
  }

  async function start(input = {}) { return createChallenge(input, "WHATSAPP", 0); }

  async function resend(input = {}) {
    const row = await db.get("SELECT * FROM app_phone_verifications WHERE id = ?", [String(input.challengeId || "")]);
    if (!row) throw new AppPhoneOtpError("OTP_CHALLENGE_NOT_FOUND", 404);
    if (Number(row.resend_count) >= limits.maxResends) throw new AppPhoneOtpError("OTP_RATE_LIMITED", 429);
    if ((now().getTime() - new Date(row.updated_at).getTime()) / 1000 < limits.cooldown) throw new AppPhoneOtpError("OTP_COOLDOWN", 429);
    return createChallenge({ phone: decryptPhone(row.phone_protected), purpose: row.purpose, ip: input.ip, deviceId: input.deviceId }, "WHATSAPP", Number(row.resend_count) + 1);
  }

  async function useSms(input = {}) {
    if (!sms.available) throw new AppPhoneOtpError("SMS_UNAVAILABLE", 503);
    const row = await db.get("SELECT * FROM app_phone_verifications WHERE id = ?", [String(input.challengeId || "")]);
    if (!row) throw new AppPhoneOtpError("OTP_CHALLENGE_NOT_FOUND", 404);
    if (Number(row.resend_count) >= limits.maxResends) throw new AppPhoneOtpError("OTP_RATE_LIMITED", 429);
    const eligible = row.status === "FAILED" || (row.whatsapp_fallback_at && now() >= new Date(row.whatsapp_fallback_at));
    if (!eligible) throw new AppPhoneOtpError("SMS_NOT_AVAILABLE_YET", 409);
    return createChallenge({ phone: decryptPhone(row.phone_protected), purpose: row.purpose, ip: input.ip, deviceId: input.deviceId }, "SMS", Number(row.resend_count) + 1);
  }

  async function affectedConflicts(masterIds) {
    if (!masterIds.length) return [];
    const marks = masterIds.map(() => "?").join(",");
    return db.all(`SELECT DISTINCT c.conflict_type AS type, c.severity,
      CASE WHEN c.severity = 'BLOCKING' OR EXISTS (SELECT 1 FROM customer_identity_case_conflicts cc JOIN customer_identity_cases ic ON ic.id=cc.case_id WHERE cc.conflict_id=c.id AND ic.blocking=1) THEN 1 ELSE 0 END blocking
      FROM customer_identity_conflicts c JOIN customer_identity_conflict_participants p ON p.conflict_id=c.id
      WHERE p.participant_type='MASTER' AND p.participant_id IN (${marks}) AND c.status NOT IN ('RESOLVED','ARCHIVED')`, masterIds);
  }

  async function fulfill(row) {
    const currentIso = iso(now()); let account = await db.get("SELECT * FROM app_customer_accounts WHERE phone_lookup_hash = ?", [row.phone_lookup_hash]);
    if (!account) {
      const accountId = crypto.randomUUID(), requestId = crypto.randomUUID();
      await db.run("BEGIN IMMEDIATE");
      try {
        await db.run(`INSERT INTO app_customer_accounts (id,phone_lookup_hash,phone_masked,phone_verified_at,email_lookup_hash,email_masked,account_status,access_status,version,created_at,updated_at) VALUES (?,?,?,?,?,'','ACTIVE','PENDING_APPROVAL',1,?,?)`, [accountId,row.phone_lookup_hash,row.phone_masked,currentIso,"",currentIso,currentIso]);
        await db.run(`INSERT INTO app_access_requests (id,account_id,request_type,status,submitted_profile_json,submitted_at,version,created_at,updated_at) VALUES (?,?,'EXISTING_CUSTOMER_LINK','PENDING_APPROVAL','{}',?,1,?,?)`, [requestId,accountId,currentIso,currentIso,currentIso]);
        await db.run("COMMIT");
      } catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }
      account = await db.get("SELECT * FROM app_customer_accounts WHERE id = ?", [accountId]);
      await emit("APP_ACCOUNT_CREATED", row, { accountId });
      await emit("APP_ACCESS_REQUEST_CREATED", row, { accountId });
    } else {
      await db.run("UPDATE app_customer_accounts SET phone_verified_at = COALESCE(phone_verified_at, ?), updated_at = ? WHERE id = ?", [currentIso,currentIso,account.id]);
      await db.run("UPDATE app_access_requests SET status = CASE WHEN status='PENDING_PHONE_VERIFICATION' THEN 'PENDING_APPROVAL' ELSE status END, updated_at=? WHERE account_id=?", [currentIso,account.id]);
    }
    await db.run("UPDATE app_phone_verifications SET account_id = ? WHERE id = ?", [account.id,row.id]);
    const masterHash = identifierLookupHash("PHONE", decryptPhone(row.phone_protected));
    const masters = await db.all(`SELECT DISTINCT m.id,m.status,m.deleted_at FROM customer_master_identifiers i JOIN customer_master_records m ON m.id=i.master_id WHERE i.identifier_type='PHONE' AND i.lookup_hash=? AND i.is_active=1`, [masterHash]);
    const conflicts = await affectedConflicts(masters.map((item) => item.id));
    const eligibility = evaluateAppCustomerEligibility({ phoneConfirmed: true, masterCandidates: masters, conflicts, accountStatus: account.account_status, links: [] });
    await emit("APP_AUTO_APPROVAL_EVALUATED", row, { outcome: eligibility.outcome, candidateCount: masters.length });
    for (const master of masters) await db.run(`INSERT OR IGNORE INTO app_customer_links (id,account_id,master_id,link_status,link_type,reason_code,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, [crypto.randomUUID(),account.id,master.id,eligibility.autoApprovalEligible?'ACTIVE':masters.length>1?'CONFLICT':'PENDING_REVIEW','PHONE_IDENTIFIER',eligibility.outcome,eligibility.autoApprovalEligible?100:50,currentIso,currentIso]);
    const canAutoApprove = eligibility.autoApprovalEligible && !["REJECTED"].includes(account.access_status);
    if (canAutoApprove && account.access_status !== "APPROVED") {
      const request = await db.get("SELECT * FROM app_access_requests WHERE account_id=? ORDER BY created_at DESC LIMIT 1", [account.id]);
      const decisionId=crypto.randomUUID();
      await db.run("BEGIN IMMEDIATE");
      try {
        await db.run("UPDATE app_customer_accounts SET access_status='APPROVED',version=version+1,updated_at=? WHERE id=?",[currentIso,account.id]);
        await db.run(`INSERT OR IGNORE INTO app_access_decisions (id,request_id,account_id,decision_type,actor_user_id,actor_role,reason,before_json,after_json,idempotency_key,created_at) VALUES (?,?,?,'AUTO_APPROVED_EXISTING_CUSTOMER',NULL,'SYSTEM','',?,?,?,?)`,[decisionId,request.id,account.id,JSON.stringify({accessStatus:account.access_status}),JSON.stringify({accessStatus:'APPROVED'}),stableHash(`otp-auto|${account.id}|${masters[0].id}`),currentIso]);
        await db.run("UPDATE app_access_requests SET status='APPROVED',reviewed_at=?,current_decision_id=?,version=version+1,updated_at=? WHERE id=?",[currentIso,decisionId,currentIso,request.id]);
        await db.run("COMMIT");
      } catch(error){await db.run("ROLLBACK").catch(()=>null);throw error;}
    }
    const accessStatus = ["SUSPENDED", "BLOCKED"].includes(account.account_status)
      ? account.account_status
      : (["APPROVED", "REJECTED"].includes(account.access_status) ? account.access_status : (canAutoApprove ? "APPROVED" : "PENDING_APPROVAL"));
    return { accountId: account.id, accessStatus, eligibility: eligibility.outcome };
  }

  function issueStatusToken(payload) {
    const body = Buffer.from(JSON.stringify({ ...payload, scope: "access-status:read", exp: Math.floor(now().getTime()/1000)+600 })).toString("base64url");
    return `${body}.${hmac(`status-token/v1|${body}`)}`;
  }
  function parseStatusToken(token) {
    const [body, signature] = String(token || "").split(".");
    if (!body || !safeEqual(signature, hmac(`status-token/v1|${body}`))) throw new AppPhoneOtpError("STATUS_TOKEN_INVALID", 401);
    const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
    if(payload.exp < Math.floor(now().getTime()/1000) || payload.scope!=="access-status:read") throw new AppPhoneOtpError("STATUS_TOKEN_INVALID",401);
    return payload;
  }

  async function verify(input = {}) {
    const row = await db.get("SELECT * FROM app_phone_verifications WHERE id=?",[String(input.challengeId||"")]);
    if(!row) throw new AppPhoneOtpError("OTP_INVALID_OR_EXPIRED",400);
    if(!["SENT","PENDING"].includes(row.status) || now() > new Date(row.expires_at)){ if(["SENT","PENDING"].includes(row.status)){await db.run("UPDATE app_phone_verifications SET status='EXPIRED',updated_at=? WHERE id=?",[iso(now()),row.id]);await emit("OTP_EXPIRED",row);} throw new AppPhoneOtpError("OTP_INVALID_OR_EXPIRED",400); }
    if(Number(row.attempt_count)>=limits.maxAttempts) throw new AppPhoneOtpError("OTP_LOCKED",429);
    const code=String(input.code||""); let valid=false;
    if(/^\d{6}$/.test(code)) valid=row.channel==="SMS" ? Boolean((await sms.verify({phone:decryptPhone(row.phone_protected),code})).success) : safeEqual(row.otp_hash,codeHash(row.id,code));
    if(!valid){ const attempts=Number(row.attempt_count)+1; await db.run("UPDATE app_phone_verifications SET attempt_count=?,status=?,locked_until=?,updated_at=? WHERE id=?",[attempts,attempts>=limits.maxAttempts?'LOCKED':row.status,attempts>=limits.maxAttempts?iso(addSeconds(now(),limits.cooldown)):null,iso(now()),row.id]); await emit(attempts>=limits.maxAttempts?"OTP_LOCKED":"OTP_INVALID",row,{attempts}); throw new AppPhoneOtpError(attempts>=limits.maxAttempts?"OTP_LOCKED":"OTP_INVALID_OR_EXPIRED",attempts>=limits.maxAttempts?429:400); }
    const changed=await db.run("UPDATE app_phone_verifications SET status='CONSUMED',consumed_at=?,updated_at=? WHERE id=? AND status IN ('SENT','PENDING')",[iso(now()),iso(now()),row.id]);
    if(Number(changed.changes)!==1) throw new AppPhoneOtpError("OTP_INVALID_OR_EXPIRED",400);
    const access=await fulfill(row); await emit("OTP_VERIFIED",row,{accessStatus:access.accessStatus});
    if (completeLogin) {
      const tokens = await completeLogin({ accountId: access.accountId, deviceId: input.deviceId, deviceName: input.deviceName, platform: input.platform, appVersion: input.appVersion, ip: input.ip, userAgent: input.userAgent });
      return { status:"PHONE_VERIFIED",accessStatus:access.accessStatus,...tokens };
    }
    return { status:"PHONE_VERIFIED",accessStatus:access.accessStatus,statusToken:issueStatusToken({accountId:access.accountId}) };
  }

  async function status(token){ const payload=parseStatusToken(token); const row=await db.get("SELECT access_status,account_status,phone_verified_at FROM app_customer_accounts WHERE id=?",[payload.accountId]); if(!row) throw new AppPhoneOtpError("STATUS_TOKEN_INVALID",401); return {phoneVerified:Boolean(row.phone_verified_at),accessStatus:row.access_status,accountStatus:row.account_status}; }
  return { start, resend, useSms, verify, status };
}

module.exports={ AppPhoneOtpError, createAppPhoneOtpService };
