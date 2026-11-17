'use strict';

// Run only after a complete Firestore export/backup.
// This script is intentionally dry-run by default.
// It assumes the existing project contains data for Yothin Nukul School only.

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const SCHOOL_ID = 'yothin-nukul';
const COLLECTIONS = [
  'users',
  'settings',
  'attendance_sessions',
  'attendance_logs',
  'assignments',
  'submissions',
];
const APPLY = process.argv.includes('--apply');
const CONFIRM_SINGLE_SCHOOL = process.argv.includes('--confirm-single-school');
const BACKUP_CONFIRMED = process.argv.includes('--backup-confirmed');

async function main() {
  if (APPLY && (!CONFIRM_SINGLE_SCHOOL || !BACKUP_CONFIRMED)) {
    throw new Error('ก่อน --apply ต้องใส่ --confirm-single-school และ --backup-confirmed หลังตรวจ backup และยืนยันว่า collections เป็นของโรงเรียนนี้เท่านั้น');
  }
  console.log(`Mode: ${APPLY ? 'APPLY CHANGES' : 'DRY RUN (no writes)'}`);
  console.log(`Target schoolId: ${SCHOOL_ID}`);
  console.log('IMPORTANT: use only when these collections belong to Yothin Nukul School.');

  let total = 0;
  let batch = db.batch();
  let batchWrites = 0;

  for (const collectionName of COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();
    let needsUpdate = 0;
    for (const document of snapshot.docs) {
      const data = document.data();
      if (data.schoolId && data.schoolId !== SCHOOL_ID) {
        console.warn(`SKIP ${collectionName}/${document.id}: existing schoolId=${data.schoolId}`);
        continue;
      }
      const update = {};
      if (!data.schoolId) update.schoolId = SCHOOL_ID;
      // Remove the legacy plaintext creator key from user records.
      if (collectionName === 'users') {
        if (Object.prototype.hasOwnProperty.call(data, 'mk')) update.mk = FieldValue.delete();
        // Legacy roles were created with a client-visible master key. Do not silently trust them.
        // Any profile without an approval record must be reviewed and provisioned again.
        if (['student', 'teacher', 'admin'].includes(data.role) && !data.approvedAt && data.status !== 'pending') {
          update.status = 'pending';
        }
      }
      if (Object.keys(update).length === 0) continue;
      needsUpdate += 1;
      total += 1;
      if (APPLY) {
        batch.update(document.ref, update);
        batchWrites += 1;
        if (batchWrites >= 450) {
          await batch.commit();
          batch = db.batch();
          batchWrites = 0;
        }
      }
    }
    console.log(`${collectionName}: ${snapshot.size} documents, ${needsUpdate} need update`);
  }

  if (APPLY && batchWrites > 0) await batch.commit();
  console.log(`Total documents requiring migration: ${total}`);
  if (!APPLY) console.log('No data changed. Re-run with --apply --confirm-single-school --backup-confirmed only after reviewing the report and backup.');
  else console.log('Migration complete. Verify records in Firestore before deploying the new app.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});