# MACHECK — Pilot Release Candidate V3

ชุดพัฒนาต่อจาก Source Code ที่ได้รับ โดยยึดเป้าหมาย **ทดลองใช้กับโรงเรียนโยธินนุกูลก่อน (Single-school pilot)** รักษา HTML/JavaScript เดิมไว้เพื่อลดการรื้อระบบ และปรับทั้งหน้าจอ, Firebase integration และการควบคุมสิทธิ์

> **สถานะปัจจุบัน: Release Candidate สำหรับทดสอบ ไม่ใช่ Production-ready**  
> ตรวจ syntax, JSON configuration และ unit tests ของ QR helper แล้ว แต่ยังไม่ได้เชื่อม/Deploy เข้า Firebase จริง, ยังไม่ได้รัน Firebase Emulator หรือทดสอบ end-to-end บนอุปกรณ์จริง ห้ามใช้ข้อมูลนักเรียนจริงจนกว่าจะผ่าน checklist และได้รับอนุมัติจากโรงเรียน

## 1. ภาพรวมที่แก้ไขใน V3

### ประสบการณ์ตามอุปกรณ์

- **Desktop:** Teacher Command Center ใช้ Sidebar ทางซ้าย, Top bar, พื้นที่ทำงานแบบ Dashboard, QR คาบเรียนและสถิติการเข้าเรียน
- **Mobile – Student:** Student Fast-Pass เต็มหน้าจอมือถือ มีหัวสีม่วง, โลโก้บนพื้นขาวเพื่อให้อ่านชัด, บัตรนักเรียน, QR, สถานะเข้าเรียน และ Bottom Navigation
- **Mobile – Teacher:** ใช้เมนู Bottom Navigation เพื่อให้ครูเข้าถึงเมนูหลักได้สะดวกบนจอเล็ก
- เปลี่ยน `public/logo.png`, PWA icons และภาพอ้างอิงเป็นโลโก้ MACHECK ที่ผู้ใช้ส่งมา

### ระบบเดิมที่รักษาไว้

- Google Sign-In
- Student Fast-Pass
- Teacher Command Center
- สร้าง QR สำหรับคาบเรียนและเปิด/ปิดคาบ
- นักเรียนสแกน QR ของคาบเรียนเพื่อเช็กชื่อ
- Firestore real-time subscriptions
- รายการงานและสถานะส่งงาน (ผู้สั่งงานเป็นเจ้าของงาน; ผู้ดูแลระบบจัดการได้ทุกงาน)
- รายงาน CSV / JSON
- Custom Studio สำหรับธีมและโลโก้โรงเรียน

### งานแก้ไขหลัก

1. แก้ Selector `#sf` ของ Teacher Dashboard
2. นำ Creator Master Key ออกจาก Frontend และยกเลิกการสร้างสิทธิ์ครูจากค่าที่ผู้ใช้กรอก
3. Cloud account ต้องมีเอกสารผู้ใช้ที่โรงเรียน provision ไว้ และ `status: "active"`; บนมือถือใช้ Google Sign-In แบบ redirect เพื่อลดปัญหาหน้าต่าง popup
4. Cloud client queries จำกัดด้วย `schoolId = "yothin-nukul"`
5. ย้ายการสร้างคาบ, เปิด/ปิดคาบ, ต่ออายุ QR และ check-in ไป Cloud Functions
6. QR ใช้ random token 256-bit; เก็บเฉพาะ SHA-256 hash ใน Firestore; QR หมดอายุ 30 นาที
7. Cloud Function ตรวจสถานะบัญชี, role, โรงเรียน, ห้องเรียน, สถานะคาบ, token และการเช็กชื่อซ้ำ
8. เฉพาะครูผู้สร้างคาบหรือ admin เท่านั้นที่เปิด/ปิดคาบและออก QR ใหม่ได้
9. Firestore Rules ไม่อนุญาตให้นักเรียนแก้ `role`, `status`, `studentId`, `grade`, `track` หรือ `schoolId`
10. เพิ่มสคริปต์ migration และ provision บัญชี โดย dry-run เป็นค่าเริ่มต้น
11. เพิ่ม unit tests สำหรับสร้าง/ตรวจ token และ parse payload QR

## 2. Hosting และ Repository

แนวทางสำหรับ Repository ปัจจุบันและ Pilot:

- **GitHub Pages:** เผยแพร่หน้าเว็บจาก `index.html` ที่ราก Repository โดยรองรับ URL แบบ Project Pages (`/MACHECK/`)
- **GitHub:** เก็บ source code, version history, Pull Request และ CI checks
- **Firebase Hosting:** เป็นตัวเลือกสำหรับ Production/โดเมนโรงเรียนเมื่อโรงเรียนพร้อมย้าย Hosting; ใช้ `public/` เป็น web root
- **Firebase:** ให้บริการ Authentication, Firestore, Cloud Functions และ Storage
- **Firebase Authentication:** Google Sign-In
- **Cloud Firestore:** ฐานข้อมูล
- **Cloud Functions:** ตรวจสอบสิทธิ์และทำรายการสำคัญฝั่ง server
- **Firebase Storage:** เตรียม Security Rules สำหรับไฟล์ผู้ใช้; ยังไม่มี workflow อัปโหลดไฟล์งานใน V3

GitHub ไม่ใช่ฐานข้อมูลของ MACHECK; Firebase เป็นฐานข้อมูลและ Backend

## 3. ค่าคงที่ของ Pilot

ค่าที่ต้องตรงกันทุกส่วน:

- Firebase Project ID: `macheck1`
- School ID: `yothin-nukul`
- Cloud Functions Region: `asia-southeast1`
- QR lifetime: 30 นาที (เป็นค่าตั้งต้นของ Pilot; โรงเรียนควรประเมินช่วงเวลาให้เหมาะกับการเช็กชื่อ)
- Late threshold ปัจจุบัน: 15 นาทีหลังสร้างคาบ (ควรให้โรงเรียนยืนยันเกณฑ์ก่อนใช้จริง)

หากเปลี่ยน Project ID หรือ School ID ต้องแก้ค่าใน `public/index.html`, `functions/index.js`, `functions/scripts/migrate-school-id.js`, `functions/scripts/provision-users.js` และทดสอบ Security Rules ใหม่ทั้งหมด

## 4. โครงสร้างโครงการ

```text
MACHECK-release-v3/
├── index.html                 # GitHub Pages project root
├── manifest.json              # GitHub Pages PWA manifest
├── logo.png / crest.png / icon-*.png
├── public/
│   ├── index.html
│   ├── logo.png
│   ├── crest.png
│   ├── icon-192.png
│   ├── icon-512.png
│   └── manifest.json
├── functions/
│   ├── index.js
│   ├── lib/qr.js
│   ├── test/qr.test.js
│   ├── scripts/
│   │   ├── migrate-school-id.js
│   │   ├── provision-users.js
│   │   └── users-to-provision.sample.json
│   └── package.json
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── firebase.json
├── .firebaserc.example
└── README_TH.md
```

## 5. ก่อนติดตั้ง

ให้ผู้ดูแลระบบ/ครูที่โรงเรียนได้รับมอบหมายเป็นผู้ดำเนินการ Firebase Project, Billing, การสำรองข้อมูล และการอนุมัติข้อมูลนักเรียน

1. สำรอง Firestore Database ก่อนแก้ Rules หรือย้ายข้อมูล
2. ตรวจสอบว่า `macheck1` เป็น Firebase Project ที่โรงเรียนใช้จริง
3. เปิด Google provider ใน Firebase Authentication
4. เพิ่ม `piyawat-hash.github.io` และโดเมน Firebase Hosting (ถ้าใช้) ใน Firebase Authentication > Authorized domains
5. สร้าง Firestore Database
6. หากใช้ Cloud Functions ให้เตรียม Blaze Plan และตั้ง Budget Alerts ก่อน deploy เพราะอาจมีค่าใช้จ่ายตามการใช้งาน
7. ตรวจสอบ Privacy Notice, สิทธิ์เข้าถึง, ระยะเวลาเก็บข้อมูล และผู้รับผิดชอบข้อมูลของโรงเรียนก่อนนำข้อมูลจริงเข้า

Firebase Web Config ในหน้าเว็บเป็นค่าตั้งต้นสำหรับ Firebase Web SDK ไม่ใช่ Service Account Private Key แต่ควรตั้ง Authorized domains, Security Rules และ App Check ให้เหมาะสม

ก่อน Deploy ควรตรวจชุดไฟล์ด้วยคำสั่ง `node scripts/verify-release.mjs` จากโฟลเดอร์ราก ซึ่งตรวจไฟล์ที่จำเป็น, inline module syntax, Firebase JSON และ security markers เบื้องต้น

## ทดลองระบบเพื่อสาธิต (Demo mode)

เปิดลิงก์ GitHub Pages พร้อมพารามิเตอร์ `?demo=1` เพื่อเข้าโหมดตัวอย่างได้ทันที: `https://piyawat-hash.github.io/MACHECK/?demo=1`

- เลือก “ผู้อำนวยการ / ผู้ดูแลระบบ” เพื่อดู Director Overview ที่มีข้อมูลจำลอง หรือเลือก “ครูผู้สอน” เพื่อทดสอบหน้าครู
- เลือก “นักเรียน” และใช้รหัสตัวอย่าง `12345` เพื่อทดสอบ Student Fast-Pass
- Demo จะสร้างข้อมูลตัวอย่าง 12 คน, ห้องเรียน, คาบเรียน, ประวัติการเช็กชื่อ และงานตัวอย่างใน `localStorage` ของเบราว์เซอร์เท่านั้น
- Demo ไม่ส่งหรือบันทึกข้อมูลตัวอย่างเข้า Firebase; อย่าใช้ข้อมูลนักเรียนจริงในโหมดนี้
- เปลี่ยนกลับ Cloud mode ได้โดยใช้ปุ่มโหมดทดสอบ/โหมดจริงหลังเข้าสู่หน้า หรือเปิดลิงก์ด้วย `?demo=0`

## ทดลองหน้าจอในเครื่องก่อน Deploy (Demo mode)

วิธีนี้ทดสอบหน้าจอและ flow จำลองเท่านั้น ข้อมูลจะอยู่ใน `localStorage` ของเบราว์เซอร์ ไม่ใช่ Firebase และห้ามกรอกข้อมูลนักเรียนจริง

1. เปิด Terminal ในโฟลเดอร์ `public`
2. รันเว็บเซิร์ฟเวอร์แบบง่าย:

```bash
python -m http.server 5500
```

3. เปิด `http://localhost:5500` ใน Chrome หรือ Edge
4. เปิด Developer Tools > Console แล้วรัน:

```javascript
localStorage.setItem('mc_mode', 'demo');
location.reload();
```

5. เลือกโหมดนักเรียนหรือครูเพื่อทดลองหน้าจอและข้อมูลตัวอย่าง

กลับไป Cloud mode ให้รัน:

```javascript
localStorage.removeItem('mc_mode');
location.reload();
```

อย่าเปิดไฟล์ `index.html` ด้วยการดับเบิลคลิก `file://` เพราะหน้าเว็บใช้ JavaScript ES Modules และ Firebase SDK ที่ควรให้บริการผ่าน `localhost` หรือ HTTPS

## 6. ติดตั้งและตรวจโค้ดในเครื่อง

ต้องมี Node.js 22 และ Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

คัดลอก `.firebaserc.example` เป็น `.firebaserc` และตรวจ Project ID ให้ถูกต้อง:

```bash
cp .firebaserc.example .firebaserc
firebase use macheck1
```

Windows PowerShell ใช้:

```powershell
Copy-Item .firebaserc.example .firebaserc
firebase use macheck1
```

ติดตั้งและตรวจ Backend:

```bash
cd functions
npm install
npm run lint
npm test
cd ..
```

ผลการทดสอบ V3 ล่าสุด: 9 tests ผ่าน (`node --test test/*.test.js`)

## 7. สำรองและ Migration ข้อมูลเดิม

**อย่าข้ามขั้นตอนนี้** เพราะ Security Rules V3 กำหนดให้เอกสารมี `schoolId` และบัญชีมี `status: "active"`

ให้ผู้ดูแล Firebase ใช้บัญชี Google ที่ได้รับสิทธิ์และ Application Default Credentials โดยไม่จำเป็นต้องเก็บ Service Account JSON ใน GitHub:

```bash
gcloud auth application-default login
gcloud config set project macheck1
```

เรียก dry-run ก่อนเสมอ:

```bash
cd functions
node scripts/migrate-school-id.js
```

ตรวจผล dry-run และยืนยันทั้งหมดนี้ก่อน:

- Collections เดิม `users`, `settings`, `attendance_sessions`, `attendance_logs`, `assignments`, `submissions` เป็นข้อมูลของโรงเรียนโยธินนุกูลเท่านั้น
- สำรอง Firestore เรียบร้อยและทดสอบว่า backup ใช้งานได้
- ไม่มีเอกสารที่มี `schoolId` ของโรงเรียนอื่น

เมื่อตรวจสอบและได้รับอนุมัติแล้วจึงใช้:

```bash
node scripts/migrate-school-id.js --apply --confirm-single-school --backup-confirmed
```

สคริปต์จะเติม `schoolId` ให้เอกสารที่ยังไม่มี, กำหนด `status: "pending"` ให้บัญชีเดิมที่มี role แต่ยังไม่มีหลักฐานการอนุมัติ `approvedAt` (รวมบัญชีที่เคยเป็น active แต่ไม่พบประวัติอนุมัติ) และลบฟิลด์ `mk` แบบเก่าจาก user documents. จากนั้นใช้ `provision-users.js` เปิดใช้งานเฉพาะบัญชีที่โรงเรียนตรวจสอบและอนุมัติแล้ว

หากฐานข้อมูลมีหลายโรงเรียนหรือไม่แน่ใจว่า collection เป็นของโรงเรียนใด **ห้ามใช้ `--apply`**; ต้องแยกตรวจทีละรายการก่อน

ก่อนใช้ QR V3 ให้ผู้ดูแลปิดคาบเก่าที่ยังค้างอยู่และสร้างคาบใหม่ เพราะ QR รูปแบบเดิม (`SES-...`) ไม่ใช่ token แบบใหม่และไม่สามารถใช้เช็กชื่อผ่าน V3 ได้

## 8. เตรียมบัญชีครูและนักเรียน

Cloud login ไม่เปิดให้ผู้ใช้สร้างบัญชีหรือกำหนด role เอง ต้องให้โรงเรียนอนุมัติบัญชีจาก Firebase Admin SDK

1. เปิด Google provider ใน Firebase Authentication และตรวจ Authorized domains
2. ตรวจว่าบัญชี Google ของครู/นักเรียนมี Firebase Authentication identity แล้ว
3. คัดลอก `functions/scripts/users-to-provision.sample.json` เป็น `functions/scripts/users-to-provision.json`
4. กรอก email, role, name และสำหรับนักเรียนให้กรอก studentId, grade, track
   - บทบาท `owner` สงวนสำหรับเจ้าของระบบเพียงหนึ่งบัญชี ต้องระบุ `--owner-email` ให้ตรงกับ email ในไฟล์ด้วย
   - ตัวอย่างบัญชีผู้สร้างระบบให้ใช้ `role: "owner"` ไม่ใช่ `admin`; ห้าม commit ไฟล์รายชื่อจริงขึ้น GitHub
5. เก็บไฟล์จริงไว้ในเครื่องผู้ดูแลเท่านั้น ไฟล์ `users-to-provision.json` อยู่ใน `.gitignore` และห้าม commit ขึ้น GitHub
6. รัน dry-run:

```bash
cd functions
node scripts/provision-users.js
```

7. ตรวจชื่อ อีเมล role ห้องเรียน และรหัสนักเรียนกับทะเบียนที่โรงเรียนอนุมัติ หากถูกต้องและได้รับอนุมัติแล้วจึงรัน:

```bash
node scripts/provision-users.js --apply --approved-by=schooladmin@example.org --owner-email=owner@example.org
```

สคริปต์จะไม่สร้างบัญชี Google ให้ แต่จะค้นหา Firebase Auth user ที่มี Google provider อยู่แล้ว จากนั้นสร้าง/อัปเดต `users/{uid}` ด้วย `schoolId`, `role`, `status: "active"` และข้อมูลที่จำเป็น. การใช้ `--apply` คือการอนุมัติบัญชีอย่างชัดแจ้งโดยผู้ดูแล จึงต้องตรวจไฟล์รายชื่อและได้รับอนุมัติจากโรงเรียนก่อน โดยต้องระบุ `--approved-by` เพื่อบันทึกอีเมลผู้อนุมัติลงในโปรไฟล์. บัญชีที่ถูก `suspended` จะถูกข้าม เว้นแต่ผู้ดูแลจะระบุ `--reactivate-suspended` หลังได้รับอนุมัติให้เปิดใช้งานอีกครั้ง หากพบ role ขัดแย้งหรือรหัสนักเรียนซ้ำ จะข้ามรายการเพื่อให้ผู้ดูแลตรวจสอบ สำหรับ `owner` สคริปต์ยอมให้เลื่อนบัญชีเดิมจาก `admin` เป็น `owner` ได้เมื่อระบุ `--owner-email` ตรงกัน และป้องกันการมี owner ซ้ำในโรงเรียน

## 9. Deploy

เมื่อ migration และ provision เสร็จและผ่านการตรวจสอบแล้ว:

```bash
firebase deploy --only functions,firestore:rules,firestore:indexes,storage
```

เมื่อ Backend และ Rules deploy สำเร็จ หากเลือกใช้ Firebase Hosting:

```bash
firebase deploy --only hosting
```

GitHub Pages จะเผยแพร่ไฟล์ `index.html` และ assets ที่ root เมื่อ merge release เข้า `main` และเปิด Settings > Pages > Deploy from a branch > `main` / `/(root)` ไว้แล้ว; การ Push เข้า branch ตรวจสอบยังไม่เปลี่ยนเว็บไซต์สาธารณะ

ห้ามแก้ปัญหา `permission-denied` ด้วยการเปิด Rules เป็น public ให้ตรวจ `users/{uid}`, `schoolId`, `role`, `status`, query constraints และ index ก่อน

## 10. Data collections ปัจจุบัน

- `users`
- `settings`
- `attendance_sessions`
- `attendance_logs`
- `classes`
- `class_members`
- `assignments`
- `submissions`
- `announcements`

ทุกเอกสารของ Pilot ต้องมี `schoolId: "yothin-nukul"`. เอกสารงานใหม่ต้องมี `createdBy`; ครูจัดการงานของตัวเอง ส่วน admin จัดการงานได้ทั้งหมด

## 11. Checklist ทดสอบก่อน Pilot

### บัญชีและสิทธิ์

- [ ] ผู้ใช้ไม่มีเอกสาร `users/{uid}` เข้าไม่ได้
- [ ] ผู้ใช้ `status` ไม่ใช่ `active` เข้าไม่ได้
- [ ] Student เข้า Teacher Dashboard ไม่ได้
- [ ] Teacher เข้า Student Fast-Pass ไม่ได้
- [ ] Student แก้ role/status/studentId/grade/track/schoolId ไม่ได้
- [ ] Teacher ไม่สามารถแก้ไขคาบที่ครูคนอื่นสร้างได้
- [ ] ผู้ใช้จาก schoolId อื่นอ่านข้อมูลโรงเรียนนี้ไม่ได้

### QR / Attendance

- [ ] ครูสร้างคาบและเห็น QR ได้
- [ ] QR ใช้งานได้ภายใน 30 นาที
- [ ] QR หมดอายุแล้ว check-in ไม่ผ่าน
- [ ] QR เก่าถูกปฏิเสธหลังต่ออายุ
- [ ] นักเรียนชั้นอื่นใช้ QR ไม่ได้
- [ ] นักเรียนเช็กชื่อคาบเดิมซ้ำไม่ได้
- [ ] ปิดคาบแล้วเช็กชื่อไม่ได้
- [ ] ทดสอบกล้องบน Android/iOS ผ่าน HTTPS

### งานและรายงาน

- [ ] ครูสร้าง/ลบได้เฉพาะงานของตนเอง และผู้ดูแลจัดการได้ทุกงาน
- [ ] นักเรียนเห็นงานของโรงเรียนตนเอง
- [ ] นักเรียนส่งสถานะงานของบัญชีตัวเองได้
- [ ] CSV แสดงข้อมูลตรงกับฐานข้อมูล
- [ ] ไม่มีสูตร CSV ที่สามารถรันเป็นสูตรอันตราย

### ระบบและความพร้อม

- [ ] ทดสอบ desktop, tablet และ mobile
- [ ] ทดสอบ Firebase Emulator / Rules tests
- [ ] ตรวจ Cloud Functions logs และ Firestore usage
- [ ] ตั้ง Budget Alerts
- [ ] ทดสอบ backup / restore
- [ ] โรงเรียนอนุมัติแนวทางคุ้มครองข้อมูลและ Pilot แล้ว

## 12. ข้อจำกัดที่ยังเหลือ — ต้องทราบก่อนนำเสนอ

- V3 เป็น **Pilot สำหรับโรงเรียนเดียว** ยังไม่ใช่ระบบ Multi-School สำหรับขายหลายโรงเรียน
- เพิ่ม Demo Launcher ผ่าน `?demo=1` พร้อมข้อมูลตัวอย่างใน localStorage (แยกจาก Firebase) และเลือกบทบาทผู้ดูแล/ครู/นักเรียนได้
- เพิ่ม Director Overview สำหรับบัญชี `admin` แล้ว: แสดงภาพรวมรายวัน สรุปตามห้อง และคาบเรียนวันนี้; ตัวเลข “ยังไม่พบการเช็กชื่อ” ไม่ควรตีความเป็นการขาดเรียนอย่างเป็นทางการ
- ยังไม่มี Parent Portal
- ระบบห้องเรียนรุ่นนี้เพิ่มการสร้างห้อง/รหัสเข้าร่วม, roster สมาชิก, งานรายห้อง, การส่งข้อความและไฟล์แนบ, การให้คะแนน/feedback และประกาศ; ต้องตั้งค่า `storageBucket` ใน Firebase Web config และ Deploy Storage Rules ก่อนอัปโหลดไฟล์จริง
- QR นักเรียนบน Fast-Pass เป็นรหัสประจำตัวที่สุ่มสร้างเพื่อแสดงบนบัตร แต่ flow เช็กชื่อปัจจุบันใช้ QR คาบเรียนที่ครูสร้างและนักเรียนสแกน ไม่ได้ใช้ QR ประจำตัวนี้ให้ครูสแกน; จึงยังไม่ควรโฆษณาว่ามีระบบสแกนบัตรนักเรียนที่ฝั่งครู
- งานเดิมที่ไม่มี `createdBy` ให้ผู้ดูแลระบบตรวจสอบ/จัดการ; ครูทั่วไปไม่สามารถลบงานเก่าเหล่านั้นได้
- ครูอ่าน roster และงานในห้องที่ตนเองเป็นสมาชิกผ่าน `class_members`; การเช็กชื่อ QR ที่สร้างจากห้องจะตรวจ membership ฝั่ง Cloud Function ก่อนบันทึก
- เกณฑ์ “สาย” ปัจจุบันคือ 15 นาทีหลังสร้างคาบ ต้องให้โรงเรียนยืนยันหรือเปลี่ยนเป็นเวลาเริ่มเรียนจริงก่อน Pilot
- QR ที่ยังไม่หมดอายุสามารถถูกส่งต่อเป็นภาพ/ข้อความให้เพื่อนในห้องเดียวกันได้; Token หมดอายุและป้องกันเช็กชื่อซ้ำช่วยลดความเสี่ยง แต่ไม่ใช่หลักฐานยืนยันตำแหน่งของนักเรียน จึงควรให้ครูดูแลการเช็กชื่อและพิจารณาเพิ่มการยืนยันโดยครูก่อนใช้งานจริง
- ยังไม่ได้เปิด Firebase App Check เพราะต้องตั้งค่า provider/site key ให้ตรงกับโดเมนจริง; ควรเปิดก่อนใช้งานกับผู้ใช้ภายนอก
- หน้าเว็บยังโหลด Tailwind, Font Awesome, Google Fonts และ QR libraries จาก CDN; ต้องมีอินเทอร์เน็ตและควรพิจารณา build assets ภายในก่อนใช้งาน production ขนาดใหญ่
- ยังไม่มี pagination/analytics dashboard ระดับผู้บริหาร และยังไม่ได้ทดสอบ load หลายห้องพร้อมกัน
- ยังไม่ได้รัน browser end-to-end test, Firebase Emulator Rules tests หรือ Deploy Firebase จริงในสภาพแวดล้อมของโรงเรียน
- สคริปต์รองรับ role `owner` แล้ว แต่ยังไม่ถือว่าบัญชีเจ้าของระบบถูกเปิดใช้งานจนกว่าจะรัน provisioning กับ Firebase Authentication/Firestore จริงสำเร็จ
- การแนบไฟล์จริงต้องมี `storageBucket` ใน `firebaseConfig`; ค่า bucket ต้องคัดลอกจาก Firebase Console ห้ามเดาชื่อ bucket
- `index.html` ที่ root ใช้สำหรับ GitHub Pages ส่วน `public/index.html` เป็นไฟล์เดียวกันสำหรับ Firebase Hosting; ให้ CI ตรวจว่าเป็นรุ่นเดียวกันก่อน merge

## 13. ข้อมูลและความปลอดภัย

MACHECK ประมวลผลข้อมูลนักเรียน จึงต้องให้ผู้บริหาร/ครูที่รับผิดชอบระบบสารสนเทศและผู้รับผิดชอบข้อมูลของโรงเรียนอนุมัติการทดลองใช้ กำหนด Privacy Notice, สิทธิ์เข้าถึง, ระยะเวลาเก็บรักษา, การสำรอง/ลบข้อมูล และกระบวนการตอบคำขอของเจ้าของข้อมูล

- ห้าม commit `users-to-provision.json`, service account keys, private keys หรือรหัสผ่าน
- Master Key เดิมเคยอยู่ใน JavaScript ฝั่ง browser จึงไม่ควรนำกลับมาใช้ และควรตรวจประวัติ Git เดิมหากเคยเผยแพร่ repository แบบสาธารณะ
- ให้โรงเรียนเป็นผู้ควบคุมบัญชี Firebase, Billing และสิทธิ์เข้าถึงข้อมูลนักเรียน