"use strict";

const crypto = require("node:crypto");

class AppSessionError extends Error {
  constructor(code, status = 401, accessStatus = null) {
    super(code); this.name = "AppSessionError"; this.code = code; this.status = status; this.accessStatus = accessStatus;
  }
}

function createAppSessionService(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) throw new Error("APP_SESSION_DB_REQUIRED");
  const jwtSecret = String(options.jwtSecret || process.env.APP_JWT_SECRET || "");
  const pepper = String(options.pepper || process.env.APP_SESSION_PEPPER || "");
  if (jwtSecret.length < 32) throw new Error("APP_JWT_SECRET_REQUIRED");
  if (pepper.length < 32) throw new Error("APP_SESSION_PEPPER_REQUIRED");
  const clock = options.now || (() => new Date());
  const randomToken = options.randomToken || (() => crypto.randomBytes(48).toString("base64url"));
  const audit = options.recordAudit || (() => undefined);
  const limits = { accessSeconds: 900, refreshSeconds: 30 * 86400, maxActiveSessions: 10, maxRefreshPerHour: 60, ...(options.limits || {}) };
  const hmac = (secret, value) => crypto.createHmac("sha256", secret).update(String(value)).digest("base64url");
  const protectedHash = (scope, value) => hmac(pepper, `${scope}/v1|${String(value || "unknown")}`);
  const refreshHash = (value) => protectedHash("refresh", value);
  const iso = (date) => date.toISOString();
  const addSeconds = (date, seconds) => new Date(date.getTime() + seconds * 1000);
  const clean = (value, max) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  const cleanDeviceName = (value) => clean(value,80)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g,"[phone]");
  const platform = (value) => ["IOS", "ANDROID", "WEB"].includes(String(value || "").toUpperCase()) ? String(value).toUpperCase() : "UNKNOWN";
  const safeEqual = (left, right) => {
    const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || ""));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const emit = (action, session, extra = {}) => Promise.resolve(audit({
    module: "app_sessions", action, entityType: "app_session", entityId: session.id,
    result: "success", includeBody: false,
    metadata: { accountId: session.account_id, sessionId: session.id, familyId: session.family_id, ...extra }
  }));

  function issueAccessToken({ account, masterId, session }) {
    const issued = Math.floor(clock().getTime() / 1000); const expires = issued + limits.accessSeconds;
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      account_id: account.id,
      master_id: masterId || null,
      session_id: session.id,
      access_status: account.access_status,
      issued_at: issued,
      expires_at: expires,
      token_version: Number(account.token_version),
      iat: issued,
      exp: expires
    })).toString("base64url");
    const content = `${header}.${payload}`;
    return `${content}.${hmac(jwtSecret, content)}`;
  }

  function parseAccessToken(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw new AppSessionError("ACCESS_TOKEN_INVALID");
    const [headerPart, payloadPart, signature] = parts; const content = `${headerPart}.${payloadPart}`;
    if (!safeEqual(signature, hmac(jwtSecret, content))) throw new AppSessionError("ACCESS_TOKEN_INVALID");
    let header; let payload;
    try { header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")); payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")); }
    catch { throw new AppSessionError("ACCESS_TOKEN_INVALID"); }
    if (header.alg !== "HS256" || header.typ !== "JWT") throw new AppSessionError("ACCESS_TOKEN_INVALID");
    if (!payload.account_id || !payload.session_id || !Number.isInteger(payload.token_version)) throw new AppSessionError("ACCESS_TOKEN_INVALID");
    const currentSeconds=Math.floor(clock().getTime()/1000);
    if (Number(payload.iat) > currentSeconds + 60) throw new AppSessionError("ACCESS_TOKEN_INVALID");
    if (Number(payload.exp) <= currentSeconds) throw new AppSessionError("ACCESS_TOKEN_EXPIRED");
    return payload;
  }

  async function accountContext(accountId) {
    const account = await db.get("SELECT id,account_status,access_status,phone_verified_at,token_version FROM app_customer_accounts WHERE id=?", [accountId]);
    if (!account) throw new AppSessionError("APP_ACCOUNT_NOT_FOUND");
    const link = await db.get("SELECT master_id FROM app_customer_links WHERE account_id=? AND link_status='ACTIVE' ORDER BY created_at ASC LIMIT 1", [accountId]);
    return { account, masterId: link?.master_id || null };
  }

  function accessState(account, allowPending = false) {
    if (["SUSPENDED", "BLOCKED", "CLOSED"].includes(account.account_status)) throw new AppSessionError("APP_ACCOUNT_RESTRICTED", 403, account.account_status === "CLOSED" ? "BLOCKED" : account.account_status);
    if (account.access_status === "REJECTED") throw new AppSessionError("APP_ACCESS_REJECTED", 403, "REJECTED");
    if (!allowPending && account.access_status !== "APPROVED") throw new AppSessionError("APP_ACCESS_NOT_APPROVED", 403, account.access_status);
  }

  async function createSession(input = {}) {
    const { account, masterId } = await accountContext(String(input.accountId || ""));
    if (!account.phone_verified_at) throw new AppSessionError("PHONE_NOT_VERIFIED", 403, account.access_status);
    const current = clock(); const currentIso = iso(current); const deviceHash = protectedHash("device", input.deviceId);
    const active = Number((await db.get("SELECT COUNT(*) total FROM app_sessions WHERE account_id=? AND status='ACTIVE'", [account.id]))?.total || 0);
    const sameDevice = await db.get("SELECT id FROM app_sessions WHERE account_id=? AND device_hash=? AND status='ACTIVE'", [account.id,deviceHash]);
    if (active >= limits.maxActiveSessions && !sameDevice) throw new AppSessionError("SESSION_LIMIT_REACHED", 429);
    const refreshToken = randomToken(); const id = crypto.randomUUID(); const familyId = crypto.randomUUID();
    const session = {
      id, family_id: familyId, account_id: account.id, device_hash: deviceHash,
      token_version: Number(account.token_version)
    };
    await db.run("BEGIN IMMEDIATE");
    try {
      await db.run("UPDATE app_sessions SET status='REVOKED',revoked_at=?,revoke_reason='REPLACED_BY_LOGIN',updated_at=? WHERE account_id=? AND device_hash=? AND status='ACTIVE'", [currentIso,currentIso,account.id,deviceHash]);
      await db.run(`INSERT INTO app_sessions
        (id,family_id,parent_session_id,account_id,refresh_hash,device_hash,device_name,platform,app_version,ip_hash,user_agent_hash,status,created_at,updated_at,last_seen_at,expires_at,token_version)
        VALUES (?,?,NULL,?,?,?,?,?,?,?,?, 'ACTIVE',?,?,?,?,?)`,
      [id,familyId,account.id,refreshHash(refreshToken),deviceHash,cleanDeviceName(input.deviceName),platform(input.platform),clean(input.appVersion,32),protectedHash("ip",input.ip),protectedHash("user-agent",input.userAgent),currentIso,currentIso,currentIso,iso(addSeconds(current,limits.refreshSeconds)),Number(account.token_version)]);
      await db.run("COMMIT");
    } catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }
    await emit("SESSION_CREATED", session); await emit("LOGIN_COMPLETED", session);
    return { accessToken: issueAccessToken({ account, masterId, session }), refreshToken, accessExpiresIn: limits.accessSeconds, refreshExpiresIn: limits.refreshSeconds, accessStatus: account.access_status };
  }

  async function revokeFamilyForReuse(session) {
    const currentIso = iso(clock());
    await db.run("BEGIN IMMEDIATE");
    try {
      await db.run("UPDATE app_sessions SET status='REVOKED',revoked_at=COALESCE(revoked_at,?),revoke_reason='REFRESH_REUSE',updated_at=? WHERE family_id=?", [currentIso,currentIso,session.family_id]);
      await db.run("UPDATE app_customer_accounts SET token_version=token_version+1,updated_at=? WHERE id=?", [currentIso,session.account_id]);
      await db.run("COMMIT");
    } catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }
    await emit("SESSION_REUSED", session);
  }

  async function refresh(input = {}) {
    const hash = refreshHash(input.refreshToken); let session = await db.get("SELECT * FROM app_sessions WHERE refresh_hash=?", [hash]);
    if (!session) throw new AppSessionError("REFRESH_TOKEN_INVALID");
    if (session.status !== "ACTIVE") { if (session.revoke_reason === "ROTATED") await revokeFamilyForReuse(session); throw new AppSessionError("REFRESH_TOKEN_REUSED"); }
    if (clock() >= new Date(session.expires_at)) {
      const at = iso(clock()); await db.run("UPDATE app_sessions SET status='EXPIRED',updated_at=?,revoked_at=?,revoke_reason='EXPIRED' WHERE id=? AND status='ACTIVE'", [at,at,session.id]);
      await emit("SESSION_EXPIRED", session); throw new AppSessionError("REFRESH_TOKEN_EXPIRED");
    }
    if (!safeEqual(session.device_hash, protectedHash("device", input.deviceId))) throw new AppSessionError("REFRESH_DEVICE_MISMATCH");
    const recent = Number((await db.get("SELECT COUNT(*) total FROM app_sessions WHERE family_id=? AND created_at>=?", [session.family_id,iso(addSeconds(clock(),-3600))]))?.total || 0);
    if (recent >= limits.maxRefreshPerHour) throw new AppSessionError("REFRESH_RATE_LIMITED", 429);
    const { account, masterId } = await accountContext(session.account_id); accessState(account, true);
    if (Number(account.token_version) !== Number(session.token_version)) throw new AppSessionError("TOKEN_VERSION_INVALID");
    const current=clock(), currentIso=iso(current), nextId=crypto.randomUUID(), nextRefresh=randomToken();
    const next={...session,id:nextId,parent_session_id:session.id};
    await db.run("BEGIN IMMEDIATE");
    try {
      const changed=await db.run("UPDATE app_sessions SET status='REVOKED',revoked_at=?,revoke_reason='ROTATED',updated_at=?,last_seen_at=? WHERE id=? AND status='ACTIVE'",[currentIso,currentIso,currentIso,session.id]);
      if(Number(changed.changes)!==1) throw new AppSessionError("REFRESH_CONFLICT",409);
      const currentAccount=await db.get("SELECT token_version FROM app_customer_accounts WHERE id=?",[session.account_id]);
      if(Number(currentAccount?.token_version)!==Number(account.token_version))throw new AppSessionError("TOKEN_VERSION_INVALID");
      await db.run(`INSERT INTO app_sessions
        (id,family_id,parent_session_id,account_id,refresh_hash,device_hash,device_name,platform,app_version,ip_hash,user_agent_hash,status,created_at,updated_at,last_seen_at,expires_at,token_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?)`,
      [nextId,session.family_id,session.id,session.account_id,refreshHash(nextRefresh),session.device_hash,session.device_name,session.platform,session.app_version,protectedHash("ip",input.ip),protectedHash("user-agent",input.userAgent),currentIso,currentIso,currentIso,iso(addSeconds(current,limits.refreshSeconds)),Number(account.token_version)]);
      await db.run("COMMIT");
    } catch(error){await db.run("ROLLBACK").catch(()=>null);throw error;}
    await emit("SESSION_REFRESHED",next,{previousSessionId:session.id});
    return {accessToken:issueAccessToken({account,masterId,session:next}),refreshToken:nextRefresh,accessExpiresIn:limits.accessSeconds,refreshExpiresIn:limits.refreshSeconds,accessStatus:account.access_status};
  }

  async function authenticateAccess(token, options = {}) {
    const payload=parseAccessToken(token); const session=await db.get("SELECT * FROM app_sessions WHERE id=?",[payload.session_id]);
    if(!session||session.status!=="ACTIVE"||session.revoked_at) throw new AppSessionError("SESSION_REVOKED");
    if(clock()>=new Date(session.expires_at)){const at=iso(clock());await db.run("UPDATE app_sessions SET status='EXPIRED',revoked_at=?,revoke_reason='EXPIRED',updated_at=? WHERE id=? AND status='ACTIVE'",[at,at,session.id]);await emit("SESSION_EXPIRED",session);throw new AppSessionError("SESSION_EXPIRED");}
    const {account,masterId}=await accountContext(payload.account_id);
    const versionMatches=Number(payload.token_version)===Number(account.token_version)&&Number(session.token_version)===Number(account.token_version);
    const restrictedStatusObservation=options.observeStatus===true&&["BLOCKED","CLOSED"].includes(account.account_status);
    if(session.account_id!==account.id||(!versionMatches&&!restrictedStatusObservation))throw new AppSessionError("TOKEN_VERSION_INVALID");
    if (options.observeStatus !== true) accessState(account,options.allowPending===true);
    await db.run("UPDATE app_sessions SET last_seen_at=?,updated_at=? WHERE id=?",[iso(clock()),iso(clock()),session.id]);
    return {account,masterId,session,payload};
  }

  async function logout(sessionId){const currentIso=iso(clock());const session=await db.get("SELECT * FROM app_sessions WHERE id=?",[sessionId]);if(!session)return;const changed=await db.run("UPDATE app_sessions SET status='REVOKED',revoked_at=?,revoke_reason='LOGOUT',updated_at=? WHERE id=? AND status='ACTIVE'",[currentIso,currentIso,sessionId]);if(Number(changed.changes)===1)await emit("SESSION_REVOKED",session,{reason:"LOGOUT"});}
  async function logoutAll(accountId){const currentIso=iso(clock());const rows=await db.all("SELECT * FROM app_sessions WHERE account_id=? AND status='ACTIVE'",[accountId]);await db.run("BEGIN IMMEDIATE");try{await db.run("UPDATE app_sessions SET status='REVOKED',revoked_at=?,revoke_reason='GLOBAL_LOGOUT',updated_at=? WHERE account_id=? AND status='ACTIVE'",[currentIso,currentIso,accountId]);await db.run("UPDATE app_customer_accounts SET token_version=token_version+1,updated_at=? WHERE id=?",[currentIso,accountId]);await db.run("COMMIT");}catch(error){await db.run("ROLLBACK").catch(()=>null);throw error;}for(const session of rows)await emit("SESSION_REVOKED",session,{reason:"GLOBAL_LOGOUT"});if(rows[0])await emit("GLOBAL_LOGOUT",rows[0],{sessionCount:rows.length});}
  async function getAccessStatus(context){return{phoneVerified:Boolean(context.account.phone_verified_at),accessStatus:context.account.access_status,accountStatus:context.account.account_status};}

  return {createSession,refresh,authenticateAccess,logout,logoutAll,getAccessStatus,parseAccessToken};
}

module.exports={AppSessionError,createAppSessionService};
