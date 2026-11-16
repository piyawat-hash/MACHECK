'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const db = getFirestore();
const SCHOOL_ID = 'yothin-nukul';
const APPLY = process.argv.includes('--apply');
const ALLOW_REACTIVATE_SUSPENDED = process.argv.includes('--reactivate-suspended');
const approverArg = process.argv.find((arg) => arg.startsWith('--approved-by='));
const approverEmail = approverArg ? approverArg.slice('--approved-by='.length).trim().toLowerCase() : '';
if (APPLY && !/^\S+@\S+\.\S+$/.test(approverEmail)) {
  throw new Error('เมื่อใช้ --apply ต้องระบุผู้อนุมัติด้วย --approved-by=email');
}
const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
const inputFile = fileArg ? path.resolve(process.cwd(), fileArg.slice('--file='.length)) : path.join(__dirname, 'users-to-provision.json');
const ALLOWED_ROLES = new Set(['student', 'teacher', 'admin']);

function validateRows(rows) {
  if (!Array.isArray(rows)) throw new Error('ไฟล์บัญชีต้องเป็น JSON Array');
  const emails = new Set();
  const studentIds = new Set();
  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    if (!row || typeof row !== 'object') throw new Error(`รายการที่ ${line} ไม่ถูกต้อง`);
    const email = String(row.email || '').trim().toLowerCase();
    const role = String(row.role || '').trim();
    const name = String(row.name || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error(`รายการที่ ${line}: email ไม่ถูกต้อง`);
    if (!ALLOWED_ROLES.has(role)) throw new Error(`รายการที่ ${line}: role ต้องเป็น student, teacher หรือ admin`);
    if (!name || name.length > 120) throw new Error(`รายการที่ ${line}: กรุณาระบุชื่อไม่เกิน 120 ตัวอักษร`);
    if (emails.has(email)) throw new Error(`อีเมลซ้ำในไฟล์: ${email}`);
    emails.add(email);
    if (role === 'student') {
      const studentId = String(row.studentId || '').trim();
      if (!/^\d{3,10}$/.test(studentId)) throw new Error(`รายการที่ ${line}: studentId ต้องเป็นตัวเลข 3-10 หลัก`);
      if (!String(row.grade || '').trim()) throw new Error(`รายการที่ ${line}: นักเรียนต้องระบุ grade เช่น ม.6/2`);
      if (studentIds.has(studentId)) throw new Error(`รหัสนักเรียนซ้ำในไฟล์: ${studentId}`);
      studentIds.add(studentId);
    }
  }
}

async function main() {
  if (!fs.existsSync(inputFile)) throw new Error(`ไม่พบไฟล์รายการบัญชี: ${inputFile}`);
  const rows = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  validateRows(rows);
  console.log(`Mode: ${APPLY ? 'APPLY CHANGES' : 'DRY RUN (no writes)'}`);
  if (APPLY) console.log(`Approved by: ${approverEmail}`);
  console.log(`School: ${SCHOOL_ID}`);
  console.log(`Accounts in file: ${rows.length}`);

  let ready = 0;
  let skipped = 0;
  for (const row of rows) {
    const email = String(row.email).trim().toLowerCase();
    let authUser;
    try {
      authUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.warn(`SKIP ${email}: ยังไม่มีบัญชี Google/Firebase Authentication โปรดให้เจ้าของบัญชีลงชื่อเข้าใช้หนึ่งครั้งก่อน`);
        skipped += 1;
        continue;
      }
      throw error;
    }

    const hasGoogleProvider = (authUser.providerData || []).some((provider) => provider.providerId === 'google.com');
    if (!hasGoogleProvider) {
      console.warn(`SKIP ${email}: บัญชี Authentication นี้ยังไม่มี Google provider ซึ่งเป็นวิธีเข้าสู่ระบบของ MACHECK`);
      skipped += 1;
      continue;
    }

    const userRef = db.collection('users').doc(authUser.uid);
    const existingSnap = await userRef.get();
    const existing = existingSnap.exists ? existingSnap.data() : {};
    if (existing.schoolId && existing.schoolId !== SCHOOL_ID) {
      console.warn(`SKIP ${email}: เอกสารผู้ใช้นี้อยู่ใน schoolId อื่น (${existing.schoolId})`);
      skipped += 1;
      continue;
    }
    if (existing.role && existing.role !== row.role) {
      console.warn(`SKIP ${email}: role เดิม (${existing.role}) ไม่ตรงกับไฟล์ (${row.role}) ต้องให้ผู้ดูแลตรวจสอบก่อน`);
      skipped += 1;
      continue;
    }
    if (existing.status === 'suspended' && !ALLOW_REACTIVATE_SUSPENDED) {
      console.warn(`SKIP ${email}: บัญชีถูกระงับอยู่ หากโรงเรียนอนุมัติให้เปิดใช้งานอีกครั้งจึงค่อยใช้ --reactivate-suspended`);
      skipped += 1;
      continue;
    }
    if (row.role === 'student') {
      const collision = await db.collection('users')
        .where('schoolId', '==', SCHOOL_ID)
        .where('studentId', '==', String(row.studentId).trim())
        .get();
      if (collision.docs.some((doc) => doc.id !== authUser.uid)) {
        console.warn(`SKIP ${email}: รหัสนักเรียน ${row.studentId} ถูกผูกกับบัญชีอื่นแล้ว`);
        skipped += 1;
        continue;
      }
    }

    const profile = {
      schoolId: SCHOOL_ID,
      role: row.role,
      status: 'active',
      name: String(row.name).trim(),
      email,
      photo: existing.photo || authUser.photoURL || '',
      updatedAt: FieldValue.serverTimestamp(),
      approvedAt: existing.approvedAt || FieldValue.serverTimestamp(),
      ...(APPLY ? { approvedBy: approverEmail, approvalSource: 'school-roster' } : {}),
    };
    if (!existingSnap.exists) profile.createdAt = FieldValue.serverTimestamp();
    if (row.role === 'student') {
      profile.studentId = String(row.studentId).trim();
      profile.grade = String(row.grade).trim();
      profile.track = String(row.track || '').trim();
      // This QR is a student badge identifier only, not an authentication credential.
      profile.qr = existing.qr || `YN-${profile.studentId}-${crypto.randomUUID()}`;
    }

    ready += 1;
    console.log(`${APPLY ? 'UPSERT' : 'READY'} ${email} [${row.role}] uid=${authUser.uid}`);
    if (APPLY) await userRef.set(profile, { merge: true });
  }

  console.log(`Ready: ${ready}; skipped: ${skipped}`);
  if (!APPLY) console.log('No writes made. Review the list, then rerun with --apply.');
  else console.log('Provisioning completed. Approval metadata was recorded; verify each profile and role in Firestore before allowing sign-in.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});