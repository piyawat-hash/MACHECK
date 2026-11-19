'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(projectRoot, 'public/index.html'), 'utf8');
const rules = fs.readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8');

test('frontend provides a real QR check-in handler for cloud and demo modes', () => {
  assert.match(html, /async function checkin\(payload\)/);
  assert.match(html, /callServer\('checkIn',\s*\{\s*sessionId,\s*token\s*\}\)/);
  assert.match(html, /D\.checkin\(id,/);
  assert.match(html, /MACHECK\\\|\(\[A-Za-z0-9_\-\]/);
});

test('frontend does not ship the legacy Creator Master Key', () => {
  assert.doesNotMatch(html, /ADMIN_KEY|YN-CREATOR-2026|Creator Master Key/);
  assert.match(html, /status!=='active'/);
});

test('desktop and mobile layouts use the approved MACHECK logo asset', () => {
  assert.match(html, /class="sb teacher-sidebar hidden lg:flex/);
  assert.match(html, /class="student-shell min-h-screen/);
  assert.match(html, /class="bn student-bottom-nav/);
  assert.match(html, /class="bn teacher-mobile-nav/);
  assert.ok(fs.existsSync(path.join(projectRoot, 'public/logo.png')));
});

test('mobile cloud sign-in uses redirect without storing student identifiers', () => {
  assert.match(html, /signInWithRedirect\(auth,provider\)/);
  assert.match(html, /mc_pending_role/);
  assert.doesNotMatch(html, /sessionStorage\.setItem\([^,]+,\s*pending\.studentId/);
});

test('assignment creation records an owner and Firestore enforces owner/admin delete access', () => {
  assert.match(html, /createdBy:me\.uid/);
  assert.match(rules, /resource\.data\.createdBy == request\.auth\.uid \|\| isAdmin\(resource\.data\.schoolId\)/);
});

test('legacy accounts are not reactivated without an explicit approval record', () => {
  const migration = fs.readFileSync(path.join(projectRoot, 'functions/scripts/migrate-school-id.js'), 'utf8');
  const provisioning = fs.readFileSync(path.join(projectRoot, 'functions/scripts/provision-users.js'), 'utf8');
  assert.match(migration, /!data\.approvedAt[\s\S]*?update\.status = 'pending'/);
  assert.match(migration, /update\.mk = FieldValue\.delete\(\)/);
  assert.match(provisioning, /--approved-by=/);
  assert.match(provisioning, /approvedBy: approverEmail/);
});

test('administrator gets a director overview with school-level attendance indicators', () => {
  assert.match(html, /function tDirectorHome\(\)/);
  assert.match(html, /DIRECTOR OVERVIEW/);
  assert.match(html, /นับนักเรียนไม่ซ้ำคน/);
  assert.match(html, /ยังไม่พบการเช็กชื่อ/);
  assert.match(html, /สรุปตามห้องเรียน/);
  assert.match(html, /if\(isAdminRole\(\)\)return tDirectorHome\(\)/);
});

test('GitHub Pages project-path assets and public search indexing are configured', () => {
  const rootHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'public/manifest.json'), 'utf8'));
  assert.doesNotMatch(html, /name="robots" content="noindex/);
  assert.match(html, /href="\.\/manifest\.json"/);
  assert.match(rootHtml, /href="\.\/manifest\.json"/);
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
});


test('shareable demo mode is isolated to local storage and seeds synthetic records', () => {
  assert.match(html, /new URLSearchParams\(location\.search\)\.get\('demo'\)/);
  assert.match(html, /pageMode==='1'\)localStorage\.setItem\('mc_mode','demo'\)/);
  assert.match(html, /dm:\(\)=>\{localStorage\.setItem\('mc_mode','demo'\)/);
  assert.match(html, /function seedDemoData\(\)/);
  assert.match(html, /นักเรียนตัวอย่าง/);
  assert.match(html, /โหมดทดลองเท่านั้น: ข้อมูลเก็บในเบราว์เซอร์นี้/);
  assert.match(html, /value="admin">ผู้อำนวยการ \/ ผู้ดูแลระบบ/);
});

test('owner and Google Classroom-style workflows are present and class scoped', () => {
  const backend = fs.readFileSync(path.join(projectRoot, 'functions/index.js'), 'utf8');
  const provisioning = fs.readFileSync(path.join(projectRoot, 'functions/scripts/provision-users.js'), 'utf8');
  assert.match(html, /function tClasses\(\)/);
  assert.match(html, /createClass/);
  assert.match(html, /joinClass/);
  assert.match(html, /addStudent/);
  assert.match(html, /removeMember/);
  assert.match(html, /createClassAssignment/);
  assert.match(html, /submitClassAssignment/);
  assert.match(html, /gradeClassSubmission/);
  assert.match(html, /createClassAnnouncement/);
  assert.match(html, /data-filepath/);
  assert.match(html, /getBlob\(storageRef\(storage/);
  assert.match(backend, /exports\.createClass = onCall/);
  assert.match(backend, /exports\.addClassStudent = onCall/);
  assert.match(backend, /exports\.gradeClassSubmission = onCall/);
  assert.match(backend, /exports\.updateClassAssignment = onCall/);
  assert.match(backend, /exports\.cancelClassAssignment = onCall/);
  assert.match(backend, /assignment\.status === 'CANCELLED'/);
  assert.match(html, /editAssignment:async/);
  assert.match(html, /cancelAssignment:async/);
  assert.match(html, /ยกเลิกงานแล้ว/);
  assert.match(backend, /session\.classId/);
  assert.match(provisioning, /'owner'/);
  assert.match(provisioning, /--owner-email=/);
  assert.match(rules, /'owner'/);
});


test('student and teacher registration collects profile details and supports email/password or Google', () => {
  const backend = fs.readFileSync(path.join(projectRoot, 'functions/index.js'), 'utf8');
  assert.match(html, /data-a="apply"/);
  assert.match(html, /data-a="applyGoogle"/);
  assert.match(html, /function openAccessRequestForm/);
  assert.match(html, /function openEmailSignupForm/);
  assert.match(html, /rg-first/);
  assert.match(html, /rg-last/);
  assert.match(html, /rg-nick/);
  assert.match(html, /rg-student-id/);
  assert.match(html, /rg-subjects/);
  assert.match(html, /rg-password/);
  assert.match(html, /rg-confirm/);
  assert.match(html, /createUserWithEmailAndPassword/);
  assert.match(html, /signInWithEmailAndPassword/);
  assert.match(html, /sendEmailVerification/);
  assert.match(html, /identityCheckMethod:'school-roster'/);
  assert.match(html, /ไม่สแกนใบหน้าหรือเก็บข้อมูลชีวมิติ/);
  assert.match(html, /callServer\('submitAccountRequest'/);
  assert.match(html, /D\.sub\('access_requests'/);
  assert.match(html, /reviewAccountRequest/);
  assert.match(backend, /exports\.submitAccountRequest = onCall/);
  assert.match(backend, /exports\.reviewAccountRequest = onCall/);
  assert.match(backend, /\['google\.com', 'password'\]\.includes\(providerId\)/);
  assert.match(backend, /hasSupportedProvider/);
  assert.match(backend, /authUser\.emailVerified/);
  assert.match(backend, /firstName/);
  assert.match(backend, /lastName/);
  assert.match(backend, /nickname/);
  assert.match(backend, /identityVerifiedAt/);
  assert.match(backend, /requireProfile\(reviewerUid, \['admin', 'owner'\]\)/);
  assert.match(backend, /\['student', 'teacher'\]\.includes\(role\)/);
  assert.match(rules, /match \/access_requests\/\{uid\}/);
  assert.match(rules, /allow create, update, delete: if false/);
});

