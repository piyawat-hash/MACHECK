'use strict';

const crypto = require('node:crypto');
const {
  createQrToken,
  hashQrToken,
  verifyQrToken,
  makeSessionQrPayload,
} = require('./lib/qr');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');

initializeApp();
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });

const db = getFirestore();
const SCHOOL_ID = 'yothin-nukul';
const QR_TTL_MS = 30 * 60 * 1000;
const LATE_AFTER_MS = 15 * 60 * 1000;

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบก่อนใช้งาน');
  return uid;
}

async function requireProfile(uid, allowedRoles) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'ไม่พบบัญชีที่โรงเรียนอนุมัติ');
  }
  const profile = snap.data();
  if (profile.schoolId !== SCHOOL_ID || profile.status !== 'active') {
    throw new HttpsError('permission-denied', 'บัญชีนี้ไม่มีสิทธิ์ใช้งานโรงเรียนนี้หรือยังไม่ได้รับอนุมัติ');
  }
  if (!allowedRoles.includes(profile.role)) {
    throw new HttpsError('permission-denied', 'ไม่มีสิทธิ์ดำเนินการนี้');
  }
  return profile;
}

function requireText(value, field, maxLength) {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `ข้อมูล ${field} ไม่ถูกต้อง`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `กรุณาระบุ ${field} ไม่เกิน ${maxLength} ตัวอักษร`);
  }
  return normalized;
}

function requireSessionId(value) {
  const sessionId = requireText(value, 'รหัสคาบเรียน', 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) {
    throw new HttpsError('invalid-argument', 'รูปแบบรหัสคาบเรียนไม่ถูกต้อง');
  }
  return sessionId;
}

function requireQrToken(value) {
  const token = requireText(value, 'QR Token', 120);
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(token)) {
    throw new HttpsError('invalid-argument', 'รูปแบบ QR Token ไม่ถูกต้อง');
  }
  return token;
}

function newQr() {
  const token = createQrToken();
  return {
    token,
    tokenHash: hashQrToken(token),
    expiresAt: Timestamp.fromMillis(Date.now() + QR_TTL_MS),
  };
}

function assertSessionOwner(profile, uid, session) {
  // Old records without createdBy can only be managed by an admin.
  if (profile.role !== 'admin' && session.createdBy !== uid) {
    throw new HttpsError(
      'permission-denied',
      'เฉพาะครูผู้สร้างคาบหรือผู้ดูแลระบบเท่านั้นที่จัดการคาบนี้ได้',
    );
  }
}

exports.createAttendanceSession = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin']);
  const className = requireText(request.data?.className, 'ห้องเรียน', 40);
  const subject = requireText(request.data?.subject, 'รายวิชา', 80);
  const sessionId = crypto.randomUUID();
  const qr = newQr();
  const now = FieldValue.serverTimestamp();

  await db.collection('attendance_sessions').doc(sessionId).create({
    schoolId: profile.schoolId,
    className,
    subject,
    active: true,
    createdBy: uid,
    createdAt: now,
    ts: now,
    qrTokenHash: qr.tokenHash,
    expiresAt: qr.expiresAt,
  });

  return {
    sessionId,
    qrPayload: makeSessionQrPayload(sessionId, qr.token),
    expiresAt: qr.expiresAt.toMillis(),
  };
});

exports.setAttendanceSessionActive = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin']);
  const sessionId = requireSessionId(request.data?.sessionId);
  const active = request.data?.active;
  if (typeof active !== 'boolean') {
    throw new HttpsError('invalid-argument', 'สถานะคาบเรียนไม่ถูกต้อง');
  }

  const ref = db.collection('attendance_sessions').doc(sessionId);
  const qr = active ? newQr() : null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().schoolId !== profile.schoolId) {
      throw new HttpsError('not-found', 'ไม่พบคาบเรียนนี้');
    }
    const session = snap.data();
    assertSessionOwner(profile, uid, session);
    tx.update(ref, {
      active,
      updatedAt: FieldValue.serverTimestamp(),
      qrTokenHash: qr ? qr.tokenHash : FieldValue.delete(),
      expiresAt: qr ? qr.expiresAt : FieldValue.delete(),
    });
  });

  return {
    active,
    qrPayload: qr ? makeSessionQrPayload(sessionId, qr.token) : null,
    expiresAt: qr?.expiresAt.toMillis() ?? null,
  };
});

exports.refreshAttendanceQr = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin']);
  const sessionId = requireSessionId(request.data?.sessionId);
  const ref = db.collection('attendance_sessions').doc(sessionId);
  const qr = newQr();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().schoolId !== profile.schoolId) {
      throw new HttpsError('not-found', 'ไม่พบคาบเรียนนี้');
    }
    const session = snap.data();
    assertSessionOwner(profile, uid, session);
    if (!session.active) {
      throw new HttpsError('failed-precondition', 'กรุณาเปิดคาบเรียนก่อนสร้าง QR');
    }
    tx.update(ref, {
      qrTokenHash: qr.tokenHash,
      expiresAt: qr.expiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    qrPayload: makeSessionQrPayload(sessionId, qr.token),
    expiresAt: qr.expiresAt.toMillis(),
  };
});

exports.checkIn = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['student']);
  const sessionId = requireSessionId(request.data?.sessionId);
  const token = requireQrToken(request.data?.token);
  const sessionRef = db.collection('attendance_sessions').doc(sessionId);
  const userRef = db.collection('users').doc(uid);
  const attendanceId = `${sessionId}_${uid}`;
  const attendanceRef = db.collection('attendance_logs').doc(attendanceId);

  return db.runTransaction(async (tx) => {
    const [sessionSnap, userSnap, attendanceSnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(userRef),
      tx.get(attendanceRef),
    ]);

    if (!sessionSnap.exists) throw new HttpsError('not-found', 'ไม่พบคาบเรียนนี้');
    if (!userSnap.exists) throw new HttpsError('permission-denied', 'ไม่พบบัญชีนักเรียน');

    const session = sessionSnap.data();
    const student = userSnap.data();

    if (session.schoolId !== profile.schoolId || student.schoolId !== profile.schoolId) {
      throw new HttpsError('permission-denied', 'ไม่สามารถเช็กชื่อข้ามโรงเรียนได้');
    }
    if (student.role !== 'student' || student.status !== 'active') {
      throw new HttpsError('permission-denied', 'บัญชีนักเรียนนี้ไม่ได้รับอนุญาตให้เช็กชื่อ');
    }
    if (!session.active) throw new HttpsError('failed-precondition', 'คาบเรียนนี้ปิดแล้ว');
    if (!session.expiresAt || session.expiresAt.toMillis() <= Date.now()) {
      throw new HttpsError('deadline-exceeded', 'QR หมดอายุ กรุณาขอ QR ใหม่จากครู');
    }
    if (!verifyQrToken(token, session.qrTokenHash)) {
      throw new HttpsError('permission-denied', 'QR ไม่ถูกต้องหรือถูกเปลี่ยนแล้ว');
    }

    const studentClass = String(student.grade || '').trim();
    const sessionClass = String(session.className || '').trim();
    if (!studentClass || studentClass !== sessionClass) {
      throw new HttpsError('permission-denied', 'QR นี้ไม่ได้สร้างสำหรับห้องเรียนของคุณ');
    }

    if (attendanceSnap.exists) return { alreadyCheckedIn: true };

    const createdAtMillis = session.createdAt?.toMillis?.() ?? Date.now();
    const status = Date.now() - createdAtMillis > LATE_AFTER_MS ? 'late' : 'present';
    tx.create(attendanceRef, {
      schoolId: profile.schoolId,
      sessionId,
      uid,
      studentId: student.studentId || '',
      name: student.name || request.auth.token.name || 'นักเรียน',
      status,
      ts: FieldValue.serverTimestamp(),
    });
    return { alreadyCheckedIn: false, status };
  });
});