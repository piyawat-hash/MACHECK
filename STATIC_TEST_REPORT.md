# MACHECK V3 — Static Test Report

วันที่ตรวจ: 16 พฤศจิกายน 2026

## ผลที่รันจริงในชุดไฟล์ V3

ขอบเขต: Static checks และ Node.js unit/contract tests

- `cd functions && npm run lint` — ผ่าน: Node.js syntax checks ของ Cloud Functions, QR helper, migration script และ provisioning script
- `cd functions && npm test` — ผ่าน 11/11 tests: QR token helper, payload parser, frontend check-in contract, removal of legacy master key, responsive UI/logo contract, mobile sign-in redirect, assignment ownership และ approval/migration contract
- `node scripts/verify-release.mjs` — ผ่าน: required files, inline HTML module syntax, frontend/backend call contract, critical security markers
- JSON parse — ผ่าน: `firebase.json`, `firestore.indexes.json`, `functions/package.json`, `public/manifest.json` และ `.firebaserc.example`

## สิ่งที่การทดสอบครอบคลุม

- หน้าเว็บมี desktop sidebar และ mobile Student Fast-Pass / bottom navigation
- หน้าเว็บใช้ `public/logo.png` ซึ่งเป็นโลโก้ที่ผู้ใช้อนุมัติ
- มี `checkin(payload)` ที่ส่งข้อมูลไป Cloud Function ใน Cloud mode และตรวจ session/expiry/class/duplicate ใน Demo mode
- ไม่มี `ADMIN_KEY`, `YN-CREATOR-2026` หรือ Creator Master Key ใน Frontend
- mobile Cloud sign-in ใช้ redirect โดยเก็บเฉพาะ role ชั่วคราว ไม่เก็บ student ID ลง session storage
- วันที่/เวลาเช็กชื่อแสดงผลตามเขตเวลาโรงเรียน Asia/Bangkok และหน้า QR ครูจะเปลี่ยนเป็นสถานะหมดอายุเมื่อถึงกำหนด
- การสร้างงานกำหนด `createdBy`; Firestore Rules จำกัดให้ผู้สร้างหรือ admin จัดการงาน
- Legacy accounts ที่ไม่มี `approvedAt` ถูกย้ายเป็น `pending`; provisioning ต้องระบุผู้อนุมัติ

## ยังไม่ได้ทดสอบและห้ามอ้างว่าผ่าน

- ยังไม่ได้เปิดระบบแบบ interactive ใน Chrome/Safari/Firefox และยังไม่มีภาพ screenshot จากอุปกรณ์จริง
- ยังไม่ได้ทดสอบ Firebase Emulator Suite หรือ compile/deploy Firestore / Storage Rules กับโปรเจกต์จริง
- ยังไม่ได้ Deploy Hosting / Cloud Functions หรือเชื่อมบัญชี Firebase ด้วย credentials ของโรงเรียน
- ยังไม่ได้ทดสอบบัญชีนักเรียน/ครู/admin จริง, mobile camera, Google redirect บน iOS/Android, QR expiry ในเวลาจริง หรือการใช้งานพร้อมกัน
- ยังไม่ได้ตรวจค่าใช้จ่าย, App Check, backup/restore และ PDPA workflow ของโรงเรียน

## สรุป

ผลที่ผ่านทั้งหมดเป็น static checks และ unit/contract tests ที่รันในชุดไฟล์เท่านั้น ไม่ใช่การรับรอง Production readiness. MACHECK V3 เป็น Pilot Release Candidate สำหรับนำไปทดสอบภายใต้การดูแลของโรงเรียนเท่านั้น ห้ามใช้ข้อมูลนักเรียนจริงจนกว่า Firebase Emulator / Rules tests, deployment, account approval และ supervised pilot checklist จะผ่านครบ

- Director Overview contract test: verifies administrator-specific dashboard, class rollup and safe wording around unmatched check-ins.
- GitHub Pages contract test: verifies root page/relative manifest and removes `noindex`.
- Release verification now checks root assets and the root GitHub Pages entry.