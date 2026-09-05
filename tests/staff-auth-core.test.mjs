import assert from "node:assert/strict";
import { test } from "node:test";
import { submitStaffStudyRoom } from "../src/lib/staff-study-room-intake.mjs";
import { loginStaff, requireStaff, logoutStaff, isStaffSameOrigin, staffCookieOptions,
  transitionStaffStudyRoom, listStaffStudyRoom } from "../src/lib/staff-auth-core.mjs";

const user = "00000000-0000-0000-0000-000000000001";
const sessionId = "00000000-0000-0000-0000-000000000002";
const token = (sub = user, session = sessionId) => `header.${Buffer.from(JSON.stringify({ sub, session_id: session })).toString("base64url")}.signature`;
const session = { access_token: token(), refresh_token: "rotated" };
const staff = { staffId: "staff", expiresAt: "2030-01-01T00:00:00Z" };
function fixture() {
  const calls = [];
  const identityClient = { auth: {
    getUser: async value => { calls.push(["verify", value]); return { data: { user: { id: user } } }; },
    signInWithPassword: async value => { calls.push(["password", value]); return { data: { user: { id: user }, session } }; },
    refreshSession: async value => { calls.push(["refresh", value]); return { data: { session } }; },
  } };
  const adminClient = { auth: { admin: { signOut: async (...args) => { calls.push(["logout", ...args]); return {}; } } } };
  const dataClient = { rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: name === "staff_login_target" ? { email: "staff@example.invalid", authUserId: user } : staff };
  } };
  return { calls, identityClient, adminClient, dataClient, accessToken: token(), refreshToken: "refresh" };
}
const status = expected => error => error.status === expected;

test("same-origin mutation and cookie protection", () => {
  const request = (origin, site) => ({ headers: new Headers({ origin, "sec-fetch-site": site }) });
  assert.equal(isStaffSameOrigin(request("https://school.example", "same-origin"), "https://school.example"), true);
  for (const [origin, site, expected] of [["https://other.example", "same-origin", "https://school.example"],
    ["https://school.example", "cross-site", "https://school.example"],
    ["http://school.example", "same-origin", "http://school.example"],
    ["https://school.example", "same-origin", "https://school.example/path"]]) {
    assert.equal(isStaffSameOrigin(request(origin, site), expected), false);
  }
  assert.deepEqual(staffCookieOptions(10), { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 10 });
});
test("login verifies managed token before initializing DB session", async () => {
  const f = fixture();
  const result = await loginStaff({ ...f, staffCode: " OFFICE ", password: " secret " });
  assert.deepEqual(f.calls.map(c => c[0]), ["staff_login_target", "password", "verify", "staff_authorize"]);
  assert.equal(f.calls[1][1].password, " secret ");
  assert.equal(f.calls[3][1].p_initialize, true);
  assert.deepEqual(result.staff, staff);
});
test("unknown and mismatched staff credentials never initialize a session", async () => {
  for (const target of [{}, { email: "staff@example.invalid", authUserId: sessionId }]) {
    const f = fixture(); f.dataClient.rpc = async () => ({ data: target });
    await assert.rejects(loginStaff({ ...f, staffCode: "missing", password: "secret" }), status(401));
    assert.deepEqual(f.calls.map(c => c[0]), ["password"]);
  }
});
test("rate limiting stops password verification", async () => {
  const f = fixture(); f.dataClient.rpc = async () => ({ data: { limited: true } });
  await assert.rejects(loginStaff({ ...f, staffCode: "office", password: "secret" }), status(429));
  assert.equal(f.calls.length, 0);
});
test("unverified or mismatched token claims never reach database", async () => {
  for (const value of ["malformed", token(sessionId), token(user, "bad-session")]) {
    const f = fixture();
    await assert.rejects(requireStaff({ ...f, accessToken: value, refreshToken: undefined }), status(401));
    assert.deepEqual(f.calls.map(c => c[0]), ["verify"]);
  }
  const f = fixture(); f.identityClient.auth.getUser = async () => ({ error: { status: 401 } });
  await assert.rejects(requireStaff({ ...f, refreshToken: undefined }), status(401));
  assert.equal(f.calls.length, 0);
});
test("expired access refreshes and re-verifies without reinitializing activity", async () => {
  const f = fixture(); const verify = f.identityClient.auth.getUser;
  f.identityClient.auth.getUser = async value => value === "expired" ? { error: { status: 401 } } : verify(value);
  const result = await requireStaff({ ...f, accessToken: "expired" });
  assert.equal(result.session.refresh_token, "rotated");
  assert.deepEqual(f.calls.map(c => c[0]), ["refresh", "verify", "staff_authorize"]);
  assert.equal(f.calls[2][1].p_initialize, false);
});
test("provider outage does not refresh or authorize", async () => {
  const f = fixture(); f.identityClient.auth.getUser = async () => ({ error: { name: "AuthRetryableFetchError" } });
  await assert.rejects(requireStaff(f), status(503));
  assert.equal(f.calls.length, 0);
});
test("logout refreshes expired access then revokes only this verified session", async () => {
  const f = fixture(); const verify = f.identityClient.auth.getUser;
  f.identityClient.auth.getUser = async value => value === "expired" ? { error: { status: 401 } } : verify(value);
  await logoutStaff({ ...f, accessToken: "expired" });
  assert.deepEqual(f.calls.map(c => c[0]), ["refresh", "verify", "logout"]);
  assert.deepEqual(f.calls[2], ["logout", token(), "local"]);
});
test("logout errors never claim managed revocation succeeded", async () => {
  for (const error of [{ status: 401 }, { status: 503 }, { name: "AuthRetryableFetchError" }]) {
    const f = fixture(); f.adminClient.auth.admin.signOut = async () => ({ error });
    await assert.rejects(logoutStaff(f), status(503));
  }
  const f = fixture(); f.identityClient.auth.refreshSession = async () => ({ error: { name: "AuthRetryableFetchError" } });
  await assert.rejects(logoutStaff({ ...f, accessToken: undefined }), status(503));
});
test("already invalid refresh or absent cookies need no admin operation", async () => {
  const f = fixture(); f.identityClient.auth.refreshSession = async () => ({ error: { code: "refresh_token_not_found" } });
  await logoutStaff({ ...f, accessToken: undefined });
  await logoutStaff({ ...f, accessToken: undefined, refreshToken: undefined });
  assert.equal(f.calls.length, 0);
});
test("approval uses verified actor, ignores claimed approver, validates before RPC", async () => {
  const f = fixture();
  const input = { operationKey: sessionId, requestId: user, expectedVersion: 1, action: "approve", actorId: "forged" };
  await transitionStaffStudyRoom(f.dataClient, { authUserId: user, authSessionId: sessionId }, input);
  assert.equal(f.calls[0][1].p_auth_user_id, user);
  assert.equal("actorId" in f.calls[0][1], false);
  await assert.rejects(transitionStaffStudyRoom(f.dataClient, {}, { ...input, expectedVersion: 0 }), status(400));
  assert.equal(f.calls.length, 1);
});
test("request list validates date, filter and pagination before RPC", async () => {
  const f = fixture(); const identity = { authUserId: user, authSessionId: sessionId };
  for (const input of [{ date: "2030-02-30" }, { date: "2030-01-01", status: "unknown" },
    { date: "2030-01-01", offset: -1 }, { date: "2030-01-01", offset: 0.5 }]) {
    await assert.rejects(listStaffStudyRoom(f.dataClient, identity, input), status(400));
  }
  assert.equal(f.calls.length, 0);
  await listStaffStudyRoom(f.dataClient, identity, { date: "2030-01-01", offset: 50, status: "pending" });
  assert.deepEqual(f.calls[0], ["staff_study_room_requests", { p_auth_user_id: user,
    p_auth_session_id: sessionId, p_date: "2030-01-01", p_status: "pending", p_offset: 50 }]);
});
test("proxy submission validates input and always uses verified identity", async () => {
  const f = fixture(); const identity = { authUserId:user,authSessionId:sessionId };
  const input = { operationKey:sessionId,studentNumber:'test',date:'2030-01-01',seat:1,
    slotIds:['14:55-16:25'],contactChannel:'line_message',note:'Confirmed by staff',actorId:'forged' };
  for (const change of [{ note:'' },{ contactChannel:'line_screen' },{ slotIds:[] },{ seat:11 },{ date:'2030-02-30' }]) {
    await assert.rejects(submitStaffStudyRoom(f.dataClient,identity,{...input,...change}),status(400));
  }
  assert.equal(f.calls.length,0);
  await submitStaffStudyRoom(f.dataClient,identity,input);
  assert.equal(f.calls[0][0],'staff_study_room_submit');
  assert.equal(f.calls[0][1].p_auth_user_id,user);
  assert.equal('actorId' in f.calls[0][1],false);
  f.dataClient.rpc = async () => ({ error:{message:'pending_student_slot_conflict'} });
  await assert.rejects(submitStaffStudyRoom(f.dataClient,identity,input),status(409));
});
