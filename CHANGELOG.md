# MACHECK V3 — Change Log

## V3 Release Candidate

- Applied desktop Teacher Command Center layout with left sidebar.
- Applied mobile-first Student Fast-Pass layout and teacher bottom navigation.
- Applied approved MACHECK logo asset to app, PWA icons and design reference assets.
- Fixed teacher status panel selector usage and added safer localStorage parsing.
- Removed frontend Creator Master Key access path and made legacy accounts pending until explicitly approved.
- Added mobile Google Sign-In redirect while keeping only the selected role (not student identifiers) in session storage.
- Required active, pre-provisioned cloud user profiles.
- Made class/roster attributes server-managed; client profile update restricted to name/photo.
- Added QR token helper module and unit tests.
- Reworked Cloud Functions to use cryptographically random 256-bit QR tokens, SHA-256 token hashes, 30-minute expiry, school/class checks, duplicate check-in transactions, and session ownership checks.
- Tightened Firestore and Storage Security Rules; restricted assignment management to the creator or school admin.
- Added safe dry-run-by-default roster provisioning script.
- Strengthened legacy migration with explicit backup and single-school confirmation flags.
- Added QR expiry indicator, implemented the previously missing student `checkin()` handler, and improved scanner teardown handling.
- Used server-returned attendance status when displaying present/late results.

## Scope remains intentionally single-school

V3 is for a supervised pilot at Yothin Nukul School. It is not yet a multi-school SaaS or production deployment.

## Release branch follow-up

- Added role-aware Director Overview for school administrators, including unique-student daily attendance, active sessions, class summaries and recent sessions.
- Added an explicit note that students without a check-in record are not automatically confirmed absent.
- Prepared GitHub Pages root entry/assets alongside Firebase Hosting `public/` output.
- Removed `noindex` from the public Pages release and made manifest asset paths relative to the project site root.
- Added CI checks for Pages entry point and Director Overview.
- Added shareable Demo Mode (`?demo=1`) with synthetic school/class/attendance/task records isolated to browser localStorage and role selection for principal, teacher and student demonstrations.