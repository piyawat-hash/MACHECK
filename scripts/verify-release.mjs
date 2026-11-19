import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'index.html', 'public/index.html', 'manifest.json', 'logo.png', 'crest.png', 'icon-192.png', 'icon-512.png', 'public/logo.png', 'public/crest.png', 'public/manifest.json',
  'functions/index.js', 'functions/lib/qr.js', 'functions/test/qr.test.js',
  'functions/test/client-contract.test.js', 'functions/scripts/migrate-school-id.js',
  'functions/scripts/provision-users.js', 'firestore.rules', 'firestore.indexes.json',
  'storage.rules', 'firebase.json', 'README_TH.md', 'AUDIT_REPORT.md',
];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing required file: ${relative}`);
}

const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const rootHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (rootHtml !== html) throw new Error('GitHub Pages and Firebase Hosting HTML files must be byte-identical');
if (!/^\\s*<!doctype html>/i.test(html)) throw new Error('HTML document must begin with a doctype; code before the doctype is forbidden');
const scripts = [...html.matchAll(/<script\\s+type="module">([\\s\\S]*?)<\\/script>/gi)];
if (scripts.length !== 1) throw new Error(`Expected one inline module script, found ${scripts.length}`);
const moduleStart = html.indexOf(scripts[0][0]);
const moduleEnd = moduleStart + scripts[0][0].length;
const tClassesAt = html.indexOf('function tClasses');
if (tClassesAt < moduleStart || tClassesAt >= moduleEnd) throw new Error('tClasses must remain inside the module script');
if (!html.includes('name="macheck-build" content="2026.11.19.1"')) throw new Error('Missing expected cache diagnostic build marker');
if (/ADMIN_KEY|YN-CREATOR-2026|Creator Master Key/.test(html)) throw new Error('Legacy Creator Master Key remains in frontend');
if (/<meta name="robots" content="noindex/.test(html)) throw new Error('Public Pages build must not carry noindex metadata');
if (!fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('DIRECTOR OVERVIEW')) throw new Error('GitHub Pages root index is not the updated release');
if (!html.includes("$('#sf').innerHTML")) throw new Error('Teacher dashboard #sf selector is not present');
if (!html.includes('async function checkin(payload)')) throw new Error('Frontend checkin handler is missing');
if (!html.includes('signInWithRedirect(auth,provider)')) throw new Error('Mobile sign-in redirect is missing');
if (!html.includes("callServer('checkIn',{sessionId,token})")) throw new Error('Cloud check-in callable is missing');

const temp = path.join(os.tmpdir(), `macheck-module-${process.pid}.mjs`);
fs.writeFileSync(temp, scripts[0][1]);
const moduleCheck = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
fs.rmSync(temp, { force: true });
if (moduleCheck.status !== 0) throw new Error(moduleCheck.stderr || moduleCheck.stdout || 'Frontend module syntax check failed');

for (const relative of ['firebase.json', 'firestore.indexes.json', 'functions/package.json', 'public/manifest.json', '.firebaserc.example']) {
  JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

const functionsSource = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
for (const name of ['createAttendanceSession', 'setAttendanceSessionActive', 'refreshAttendanceQr', 'checkIn']) {
  if (!functionsSource.includes(`exports.${name} =`)) throw new Error(`Missing Cloud Function: ${name}`);
}
if (!functionsSource.includes('verifyQrToken(token, session.qrTokenHash)')) throw new Error('Cloud check-in does not verify QR token hash');

const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
if (!rules.includes("affectedKeys().hasOnly(['name', 'photo'])")) throw new Error('User self-update restriction missing');
if (!rules.includes('resource.data.createdBy == request.auth.uid || isAdmin(resource.data.schoolId)')) throw new Error('Assignment owner restriction missing');
if (!rules.includes("allow write: if false;")) throw new Error('Server-only write restriction missing');

console.log('MACHECK release verification passed.');
console.log(`Required files: ${required.length}`);
console.log('Frontend module syntax: PASS');
console.log('Firebase JSON config parse: PASS');
console.log('Cloud Function contracts: PASS');
console.log('Critical frontend/security markers: PASS');
console.log('GitHub Pages root entry and public indexing: PASS');