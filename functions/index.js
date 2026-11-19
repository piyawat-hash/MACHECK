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
const { getAuth } = require('firebase-admin/auth');
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
  if (!['admin', 'owner'].includes(profile.role) && session.createdBy !== uid) {
    throw new HttpsError(
      'permission-denied',
      'เฉพาะครูผู้สร้างคาบหรือผู้ดูแลระบบเท่านั้นที่จัดการคาบนี้ได้',
    );
  }
}

exports.createAttendanceSession = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const classId = request.data?.classId ? requireText(request.data.classId, 'รหัสห้องเรียน', 100) : null;
  const classroom = classId ? await requireClassTeacher(profile, uid, classId) : null;
  const className = classroom ? classroom.data.name : requireText(request.data?.className, 'ห้องเรียน', 40);
  const subject = classroom ? classroom.data.subject : requireText(request.data?.subject, 'รายวิชา', 80);
  const sessionId = crypto.randomUUID();
  const qr = newQr();
  const now = FieldValue.serverTimestamp();

  await db.collection('attendance_sessions').doc(sessionId).create({
    schoolId: profile.schoolId,
    ...(classId ? { classId } : {}),
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
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
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
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
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

    if (session.classId) {
      const memberSnap = await tx.get(db.collection('class_members').doc(`${session.classId}_${uid}`));
      if (!memberSnap.exists || memberSnap.data().status !== 'active' || memberSnap.data().role !== 'student') {
        throw new HttpsError('permission-denied', 'คุณไม่ได้เป็นสมาชิกของห้องเรียนที่เปิดเช็กชื่อนี้');
      }
    } else {
      const studentClass = String(student.grade || '').trim();
      const sessionClass = String(session.className || '').trim();
      if (!studentClass || studentClass !== sessionClass) {
        throw new HttpsError('permission-denied', 'QR นี้ไม่ได้สร้างสำหรับห้องเรียนของคุณ');
      }
    }

    if (attendanceSnap.exists) return { alreadyCheckedIn: true };

    const createdAtMillis = session.createdAt?.toMillis?.() ?? Date.now();
    const status = Date.now() - createdAtMillis > LATE_AFTER_MS ? 'late' : 'present';
    tx.create(attendanceRef, {
      schoolId: profile.schoolId,
      sessionId,
      ...(session.classId ? { classId: session.classId } : {}),
      uid,
      studentId: student.studentId || '',
      name: student.name || request.auth.token.name || 'นักเรียน',
      status,
      ts: FieldValue.serverTimestamp(),
    });
    return { alreadyCheckedIn: false, status };
  });
});

// ---------- Classroom / assignments (MACHECK Classroom) ----------
const CLASS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeJoinCode() {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((byte) => CLASS_CODE_ALPHABET[byte % CLASS_CODE_ALPHABET.length]).join('');
}
function hashJoinCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}
function isPrivileged(profile) {
  return ['admin', 'owner'].includes(profile.role);
}
async function requireClassTeacher(profile, uid, classId) {
  const classRef = db.collection('classes').doc(classId);
  const snap = await classRef.get();
  if (!snap.exists || snap.data().schoolId !== profile.schoolId) {
    throw new HttpsError('not-found', 'ไม่พบห้องเรียนนี้');
  }
  const data = snap.data();
  if (isPrivileged(profile) || data.teacherUid === uid) return { ref: classRef, data };
  const member = await db.collection('class_members').doc(`${classId}_${uid}`).get();
  if (member.exists && member.data().status === 'active' && member.data().role === 'teacher') {
    return { ref: classRef, data };
  }
  throw new HttpsError('permission-denied', 'คุณไม่ใช่ครูผู้ดูแลห้องเรียนนี้');
}
async function requireClassStudent(profile, uid, classId) {
  const member = await db.collection('class_members').doc(`${classId}_${uid}`).get();
  if (!member.exists || member.data().schoolId !== profile.schoolId
    || member.data().status !== 'active' || member.data().role !== 'student') {
    throw new HttpsError('permission-denied', 'คุณยังไม่ได้เข้าร่วมห้องเรียนนี้');
  }
  return member;
}
function normalizeAttachments(value, classId, folder) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 5) {
    throw new HttpsError('invalid-argument', 'แนบไฟล์ได้ไม่เกิน 5 ไฟล์');
  }
  return value.map((item) => {
    const name = requireText(item?.name, 'ชื่อไฟล์', 120);
    const path = requireText(item?.path, 'ตำแหน่งไฟล์', 500);
    const contentType = requireText(item?.contentType, 'ชนิดไฟล์', 100);
    if (!path.startsWith(`schools/${SCHOOL_ID}/classes/${classId}/${folder}/`)) {
      throw new HttpsError('invalid-argument', 'ตำแหน่งไฟล์แนบไม่ถูกต้อง');
    }
    if (!/^(application\/pdf|image\/(png|jpeg|webp)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/msword)$/i.test(contentType)) {
      throw new HttpsError('invalid-argument', 'ชนิดไฟล์นี้ยังไม่รองรับ');
    }
    return { name, path, contentType, size: Number(item.size) || 0 };
  });
}

exports.createClass = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const name = requireText(request.data?.name, 'ชื่อห้องเรียน', 80);
  const subject = requireText(request.data?.subject, 'รายวิชา', 100);
  const description = String(request.data?.description || '').trim().slice(0, 1000);
  let joinCode;
  let classRef;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    joinCode = makeJoinCode();
    const duplicate = await db.collection('classes').where('schoolId', '==', SCHOOL_ID)
      .where('joinCodeHash', '==', hashJoinCode(joinCode)).limit(1).get();
    if (duplicate.empty) break;
    joinCode = null;
  }
  if (!joinCode) throw new HttpsError('resource-exhausted', 'สร้างรหัสเข้าห้องไม่สำเร็จ กรุณาลองใหม่');
  classRef = db.collection('classes').doc();
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  batch.create(classRef, {
    schoolId: profile.schoolId, name, subject, description,
    teacherUid: uid, createdBy: uid, joinCodeHash: hashJoinCode(joinCode),
    joinCodeLast4: joinCode.slice(-4), status: 'active',
    createdAt: now, updatedAt: now,
  });
  batch.create(db.collection('class_members').doc(`${classRef.id}_${uid}`), {
    schoolId: profile.schoolId, classId: classRef.id, uid,
    role: 'teacher', status: 'active', joinedAt: now,
  });
  await batch.commit();
  return { classId: classRef.id, joinCode, name, subject };
});

exports.joinClass = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['student']);
  const code = requireText(request.data?.joinCode, 'รหัสเข้าร่วมห้อง', 16).toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'รูปแบบรหัสเข้าห้องไม่ถูกต้อง');
  }
  const matches = await db.collection('classes')
    .where('schoolId', '==', profile.schoolId)
    .where('joinCodeHash', '==', hashJoinCode(code))
    .where('status', '==', 'active').limit(2).get();
  if (matches.empty) throw new HttpsError('not-found', 'ไม่พบรหัสห้องเรียน หรือรหัสถูกยกเลิกแล้ว');
  const classroom = matches.docs[0];
  const memberRef = db.collection('class_members').doc(`${classroom.id}_${uid}`);
  await db.runTransaction(async (tx) => {
    const old = await tx.get(memberRef);
    if (old.exists && old.data().status === 'active') return;
    tx.set(memberRef, {
      schoolId: profile.schoolId, classId: classroom.id, uid,
      role: 'student', status: 'active',
      name: profile.name || '', studentId: profile.studentId || '',
      grade: profile.grade || '', track: profile.track || '', photo: profile.photo || '',
      joinedAt: FieldValue.serverTimestamp(),
    });
  });
  return { classId: classroom.id, className: classroom.data().name, subject: classroom.data().subject };
});

exports.addClassStudent = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const classId = requireText(request.data?.classId, 'รหัสห้อง', 100);
  const studentId = requireText(request.data?.studentId, 'รหัสนักเรียน', 10);
  if (!/^\d{3,10}$/.test(studentId)) throw new HttpsError('invalid-argument', 'รหัสนักเรียนต้องเป็นตัวเลข 3-10 หลัก');
  await requireClassTeacher(profile, uid, classId);
  const matches = await db.collection('users')
    .where('schoolId', '==', profile.schoolId)
    .where('studentId', '==', studentId)
    .where('role', '==', 'student')
    .limit(2).get();
  const target = matches.docs.find((doc) => doc.data().status === 'active');
  if (!target) throw new HttpsError('not-found', 'ไม่พบบัญชีนักเรียนที่ได้รับอนุมัติในโรงเรียนนี้');
  const student = target.data();
  const memberRef = db.collection('class_members').doc(`${classId}_${target.id}`);
  await memberRef.set({
    schoolId: profile.schoolId, classId, uid: target.id,
    role: 'student', status: 'active',
    name: student.name || '', studentId: student.studentId || '',
    grade: student.grade || '', track: student.track || '', photo: student.photo || '',
    joinedAt: FieldValue.serverTimestamp(), addedBy: uid, addedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { added: true, name: student.name || '', studentId };
});

exports.removeClassMember = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const classId = requireText(request.data?.classId, 'รหัสห้อง', 100);
  const memberUid = requireText(request.data?.memberUid, 'รหัสสมาชิก', 128);
  const classroom = await requireClassTeacher(profile, uid, classId);
  if (memberUid === classroom.data.teacherUid && !isPrivileged(profile)) {
    throw new HttpsError('permission-denied', 'ครูผู้สร้างห้องไม่สามารถนำตนเองออกจากห้องได้');
  }
  const memberRef = db.collection('class_members').doc(`${classId}_${memberUid}`);
  const member = await memberRef.get();
  if (!member.exists || member.data().role !== 'student') {
    throw new HttpsError('not-found', 'ไม่พบสมาชิกนักเรียน');
  }
  await memberRef.update({ status: 'removed', removedAt: FieldValue.serverTimestamp(), removedBy: uid });
  return { removed: true };
});

exports.createClassAssignment = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const classId = requireText(request.data?.classId, 'ห้องเรียน', 100);
  const classroom = await requireClassTeacher(profile, uid, classId);
  const title = requireText(request.data?.title, 'ชื่องาน', 160);
  const details = String(request.data?.details || '').trim().slice(0, 5000);
  const dueDate = request.data?.dueAt ? new Date(request.data.dueAt) : null;
  if (dueDate && !Number.isFinite(dueDate.getTime())) throw new HttpsError('invalid-argument', 'กำหนดส่งไม่ถูกต้อง');
  const dueAt = dueDate ? Timestamp.fromDate(dueDate) : null;
  const id = request.data?.assignmentId ? requireText(request.data.assignmentId, 'รหัสงาน', 100) : crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new HttpsError('invalid-argument', 'รูปแบบรหัสงานไม่ถูกต้อง');
  const attachments = normalizeAttachments(request.data?.attachments, classId, `assignments/${id}`);
  await db.collection('assignments').doc(id).create({
    schoolId: profile.schoolId, classId, className: classroom.data.name,
    title, details, dueAt, due: dueAt ? dueAt.toDate().toISOString() : '',
    attachments, createdBy: uid, ts: FieldValue.serverTimestamp(),
  });
  return { assignmentId: id };
});

exports.updateClassAssignment = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const assignmentId = requireText(request.data?.assignmentId, 'รหัสงาน', 100);
  const ref = db.collection('assignments').doc(assignmentId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().schoolId !== profile.schoolId || !snap.data().classId) {
    throw new HttpsError('not-found', 'ไม่พบงานในห้องเรียนนี้');
  }
  const assignment = snap.data();
  await requireClassTeacher(profile, uid, assignment.classId);
  if (!isPrivileged(profile) && assignment.createdBy !== uid) {
    throw new HttpsError('permission-denied', 'เฉพาะครูผู้สร้างงานเท่านั้นที่แก้ไขได้');
  }
  if (assignment.status === 'CANCELLED') {
    throw new HttpsError('failed-precondition', 'งานนี้ถูกยกเลิกแล้ว');
  }
  const title = requireText(request.data?.title, 'ชื่องาน', 160);
  const details = String(request.data?.details || '').trim().slice(0, 5000);
  const dueDate = request.data?.dueAt ? new Date(request.data.dueAt) : null;
  if (dueDate && !Number.isFinite(dueDate.getTime())) {
    throw new HttpsError('invalid-argument', 'กำหนดส่งไม่ถูกต้อง');
  }
  await ref.update({
    title, details,
    dueAt: dueDate ? Timestamp.fromDate(dueDate) : null,
    due: dueDate ? dueDate.toISOString() : '',
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  });
  return { updated: true };
});

exports.cancelClassAssignment = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const assignmentId = requireText(request.data?.assignmentId, 'รหัสงาน', 100);
  const ref = db.collection('assignments').doc(assignmentId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().schoolId !== profile.schoolId || !snap.data().classId) {
    throw new HttpsError('not-found', 'ไม่พบงานในห้องเรียนนี้');
  }
  const assignment = snap.data();
  await requireClassTeacher(profile, uid, assignment.classId);
  if (!isPrivileged(profile) && assignment.createdBy !== uid) {
    throw new HttpsError('permission-denied', 'เฉพาะครูผู้สร้างงานเท่านั้นที่ยกเลิกได้');
  }
  await ref.update({
    status: 'CANCELLED',
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { cancelled: true };
});

exports.submitClassAssignment = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['student']);
  const assignmentId = requireText(request.data?.assignmentId, 'รหัสงาน', 100);
  const assignmentRef = db.collection('assignments').doc(assignmentId);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists || assignmentSnap.data().schoolId !== profile.schoolId || !assignmentSnap.data().classId) {
    throw new HttpsError('not-found', 'ไม่พบงานที่มอบหมาย');
  }
  const assignment = assignmentSnap.data();
  if (assignment.status === 'CANCELLED') throw new HttpsError('failed-precondition', 'งานนี้ถูกยกเลิกแล้ว');
  await requireClassStudent(profile, uid, assignment.classId);
  const text = String(request.data?.text || '').trim().slice(0, 5000);
  const attachments = normalizeAttachments(request.data?.attachments, assignment.classId, `submissions/${assignmentId}/${uid}`);
  if (!text && attachments.length === 0) throw new HttpsError('invalid-argument', 'กรุณาเขียนคำตอบหรือแนบไฟล์ก่อนส่ง');
  const id = `${assignmentId}_${uid}`;
  const ref = db.collection('submissions').doc(id);
  const existing = await ref.get();
  if (existing.exists && existing.data().status === 'GRADED') {
    throw new HttpsError('failed-precondition', 'งานนี้ได้รับการตรวจแล้ว ไม่สามารถส่งซ้ำได้');
  }
  const late = assignment.dueAt?.toMillis && Date.now() > assignment.dueAt.toMillis();
  await ref.set({
    schoolId: profile.schoolId, assignmentId, classId: assignment.classId,
    uid, studentId: profile.studentId || '', studentName: profile.name || '',
    text, attachments, status: late ? 'LATE' : 'SUBMITTED',
    score: null, feedback: '', submittedAt: FieldValue.serverTimestamp(),
    ts: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { status: late ? 'LATE' : 'SUBMITTED' };
});

exports.gradeClassSubmission = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const submissionId = requireText(request.data?.submissionId, 'รหัสงานที่ส่ง', 220);
  const score = Number(request.data?.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new HttpsError('invalid-argument', 'คะแนนต้องอยู่ระหว่าง 0 ถึง 100');
  const feedback = String(request.data?.feedback || '').trim().slice(0, 2000);
  const ref = db.collection('submissions').doc(submissionId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().schoolId !== profile.schoolId || !snap.data().classId) {
    throw new HttpsError('not-found', 'ไม่พบงานที่นักเรียนส่ง');
  }
  await requireClassTeacher(profile, uid, snap.data().classId);
  await ref.update({ score, feedback, status: 'GRADED', gradedBy: uid, gradedAt: FieldValue.serverTimestamp() });
  return { graded: true };
});

exports.createClassAnnouncement = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const classId = requireText(request.data?.classId, 'ห้องเรียน', 100);
  const classroom = await requireClassTeacher(profile, uid, classId);
  const title = requireText(request.data?.title, 'หัวข้อประกาศ', 160);
  const message = requireText(request.data?.message, 'ข้อความประกาศ', 3000);
  const ref = db.collection('announcements').doc();
  await ref.create({ schoolId: profile.schoolId, classId, title, message, createdBy: uid, createdAt: FieldValue.serverTimestamp() });
  return { announcementId: ref.id, className: classroom.data.name };
});

exports.rotateClassJoinCode = onCall(async (request) => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, ['teacher', 'admin', 'owner']);
  const classId = requireText(request.data?.classId, 'รหัสห้อง', 100);
  const classroom = await requireClassTeacher(profile, uid, classId);
  let joinCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = makeJoinCode();
    const duplicate = await db.collection('classes').where('schoolId', '==', SCHOOL_ID)
      .where('joinCodeHash', '==', hashJoinCode(candidate)).limit(1).get();
    if (duplicate.empty) { joinCode = candidate; break; }
  }
  if (!joinCode) throw new HttpsError('resource-exhausted', 'สร้างรหัสเข้าห้องไม่สำเร็จ');
  await classroom.ref.update({
    joinCodeHash: hashJoinCode(joinCode),
    joinCodeLast4: joinCode.slice(-4),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { joinCode };
});


// Account onboarding: new accounts remain pending until a school administrator approves them.
exports.submitAccountRequest = onCall(async (request) => {
  const uid = requireAuth(request);
  const token = request.auth.token || {};
  const providerId = token.firebase?.sign_in_provider;
  if (!['google.com', 'password'].includes(providerId)) {
    throw new HttpsError('permission-denied', 'กรุณาใช้ Google หรืออีเมลและรหัสผ่านที่รองรับ');
  }
  if (providerId === 'google.com' && token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'กรุณาใช้บัญชี Google ที่ยืนยันอีเมลแล้ว');
  }
  const email = requireText(token.email, 'อีเมล', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'ไม่พบอีเมลที่ถูกต้อง');
  }
  const firstName = requireText(request.data?.firstName, 'ชื่อจริง', 60);
  const lastName = requireText(request.data?.lastName, 'นามสกุล', 80);
  const nickname = requireText(request.data?.nickname, 'ชื่อเล่น', 40);
  const name = (firstName + ' ' + lastName).slice(0, 120);
  const role = request.data?.role;
  if (!['student', 'teacher'].includes(role)) {
    throw new HttpsError('permission-denied', 'เปิดคำขอได้เฉพาะบัญชีนักเรียนหรือครูเท่านั้น');
  }

  const userRef = db.collection('users').doc(uid);
  const existingUser = await userRef.get();
  if (existingUser.exists && existingUser.data().status === 'active') {
    throw new HttpsError('already-exists', 'บัญชีนี้ได้รับอนุมัติแล้ว กรุณาเข้าสู่ระบบตามปกติ');
  }

  let details;
  if (role === 'student') {
    const studentId = requireText(request.data?.studentId, 'รหัสนักเรียน', 10);
    const grade = requireText(request.data?.grade, 'ชั้นและห้อง', 12);
    const track = requireText(request.data?.track, 'แผนการเรียน', 120);
    const identityCheckMethod = request.data?.identityCheckMethod;
    if (!/^\d{3,10}$/.test(studentId)) throw new HttpsError('invalid-argument', 'รหัสนักเรียนต้องเป็นตัวเลข 3-10 หลัก');
    if (!/^(ป|ม)\.[1-6]\/\d{1,2}$/.test(grade)) throw new HttpsError('invalid-argument', 'รูปแบบชั้นและห้องไม่ถูกต้อง');
    if (identityCheckMethod !== 'school-roster') {
      throw new HttpsError('failed-precondition', 'ต้องยืนยันตัวตนกับทะเบียนโรงเรียน');
    }
    const existingStudent = await db.collection('users').where('studentId', '==', studentId).limit(10).get();
    if (existingStudent.docs.some((doc) => doc.id !== uid && doc.data().schoolId === SCHOOL_ID)) {
      throw new HttpsError('already-exists', 'รหัสนักเรียนนี้ถูกใช้ในระบบแล้ว กรุณาติดต่อผู้ดูแล');
    }
    const pendingStudent = await db.collection('access_requests').where('studentId', '==', studentId).limit(10).get();
    if (pendingStudent.docs.some((doc) => doc.id !== uid && doc.data().schoolId === SCHOOL_ID && doc.data().status === 'pending')) {
      throw new HttpsError('already-exists', 'รหัสนักเรียนนี้มีคำขอรอตรวจสอบแล้ว กรุณาติดต่อโรงเรียน');
    }
    details = { studentId, grade, track, identityCheckMethod };
  } else {
    const subjects = requireText(request.data?.subjects, 'วิชาที่สอนประจำ', 300);
    details = { subjects };
  }

  const requestRef = db.collection('access_requests').doc(uid);
  const previous = await requestRef.get();
  if (previous.exists && previous.data().status === 'pending') {
    return { submitted: false, alreadyPending: true, status: 'pending' };
  }
  const now = FieldValue.serverTimestamp();
  await requestRef.set({
    schoolId: SCHOOL_ID,
    uid,
    role,
    firstName,
    lastName,
    nickname,
    name,
    email,
    authProvider: providerId,
    emailVerifiedAtSubmission: token.email_verified === true,
    photo: String(token.picture || '').slice(0, 1000),
    ...details,
    status: 'pending',
    consentVersion: '2026-11',
    submittedAt: now,
    updatedAt: now,
    ts: now,
    reviewNote: FieldValue.delete(),
    reviewedBy: FieldValue.delete(),
    reviewedByEmail: FieldValue.delete(),
    reviewedAt: FieldValue.delete(),
  }, { merge: true });
  return { submitted: true, status: 'pending', emailVerificationRequired: providerId === 'password' };
});

exports.reviewAccountRequest = onCall(async (request) => {
  const reviewerUid = requireAuth(request);
  const reviewer = await requireProfile(reviewerUid, ['admin', 'owner']);
  const targetUid = requireText(request.data?.uid, 'รหัสบัญชี', 128);
  const decision = request.data?.decision;
  if (!['approved', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'คำสั่งตรวจสอบไม่ถูกต้อง');
  }
  const note = String(request.data?.note || '').trim().slice(0, 500);
  const requestRef = db.collection('access_requests').doc(targetUid);
  const snapshot = await requestRef.get();
  if (!snapshot.exists || snapshot.data().schoolId !== reviewer.schoolId) {
    throw new HttpsError('not-found', 'ไม่พบคำขอของโรงเรียนนี้');
  }
  const application = snapshot.data();
  if (application.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'คำขอนี้ถูกตรวจสอบไปแล้ว');
  }
  if (!['student', 'teacher'].includes(application.role)) {
    throw new HttpsError('permission-denied', 'ประเภทบัญชีในคำขอไม่ถูกต้อง');
  }

  const authUser = await getAuth().getUser(targetUid);
  const hasSupportedProvider = (authUser.providerData || []).some((provider) => ['google.com', 'password'].includes(provider.providerId));
  if (!hasSupportedProvider || !authUser.emailVerified
      || String(authUser.email || '').toLowerCase() !== String(application.email || '').toLowerCase()) {
    throw new HttpsError('failed-precondition', 'กรุณายืนยันอีเมลก่อนผู้ดูแลอนุมัติบัญชี');
  }

  if (decision === 'rejected') {
    await requestRef.update({
      status: 'rejected',
      reviewNote: note,
      reviewedBy: reviewerUid,
      reviewedByEmail: reviewer.email || '',
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { reviewed: true, status: 'rejected' };
  }

  const userRef = db.collection('users').doc(targetUid);
  const existingProfile = await userRef.get();
  if (existingProfile.exists && existingProfile.data().status === 'active') {
    throw new HttpsError('already-exists', 'บัญชีนี้มีโปรไฟล์ที่ใช้งานอยู่แล้ว');
  }
  const profile = {
    schoolId: SCHOOL_ID,
    role: application.role,
    status: 'active',
    name: application.name,
    firstName: application.firstName,
    lastName: application.lastName,
    nickname: application.nickname,
    email: application.email,
    photo: application.photo || authUser.photoURL || '',
    approvedAt: FieldValue.serverTimestamp(),
    approvedBy: reviewerUid,
    approvalSource: 'account-request',
    updatedAt: FieldValue.serverTimestamp(),
    ...(application.role === 'student'
      ? {
        studentId: application.studentId,
        grade: application.grade,
        track: application.track,
        identityCheckMethod: application.identityCheckMethod,
        identityVerifiedAt: FieldValue.serverTimestamp(),
        identityVerifiedBy: reviewerUid,
      }
      : { subjects: application.subjects }),
  };

  const registryRef = application.role === 'student'
    ? db.collection('student_id_registry').doc(String(application.studentId))
    : null;
  if (application.role === 'student') {
    const matchingProfiles = await db.collection('users').where('studentId', '==', application.studentId).limit(10).get();
    if (matchingProfiles.docs.some((doc) => doc.id !== targetUid && doc.data().schoolId === SCHOOL_ID)) {
      throw new HttpsError('already-exists', 'รหัสนักเรียนนี้ถูกผูกกับบัญชีอื่นแล้ว');
    }
  }
  await db.runTransaction(async (transaction) => {
    const latestRequest = await transaction.get(requestRef);
    const latestProfile = await transaction.get(userRef);
    if (!latestRequest.exists || latestRequest.data().status !== 'pending') {
      throw new HttpsError('failed-precondition', 'คำขอนี้ถูกตรวจสอบไปแล้ว');
    }
    if (latestProfile.exists && latestProfile.data().status === 'active') {
      throw new HttpsError('already-exists', 'บัญชีนี้มีโปรไฟล์ที่ใช้งานอยู่แล้ว');
    }
    if (registryRef) {
      const registry = await transaction.get(registryRef);
      if (registry.exists && registry.data().uid !== targetUid) {
        throw new HttpsError('already-exists', 'รหัสนักเรียนนี้ถูกผูกกับบัญชีอื่นแล้ว');
      }
      transaction.set(registryRef, {
        schoolId: SCHOOL_ID,
        studentId: application.studentId,
        uid: targetUid,
        assignedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    transaction.set(userRef, profile, { merge: true });
    transaction.update(requestRef, {
      status: 'approved',
      reviewNote: note,
      reviewedBy: reviewerUid,
      reviewedByEmail: reviewer.email || '',
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { reviewed: true, status: 'approved', role: application.role };
});
