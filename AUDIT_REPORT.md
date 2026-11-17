# MACHECK V3 — Audit Summary

## Input reviewed

- User-provided single-file HTML/JavaScript prototype.
- Previous generated V1/V2 project files and the user-approved MACHECK transparent logo.

## Material issues addressed

1. Frontend contained a plaintext Creator Master Key and created teacher profile records from that secret. V3 removes that flow and requires pre-provisioned Firebase user profiles.
2. Client check-in previously wrote attendance records directly to Firestore. V3 routes cloud check-in through a callable Cloud Function.
3. QR payloads are now random 256-bit tokens; only SHA-256 hashes are stored server-side; QR expires after 30 minutes.
4. Cloud Functions validate active user, role, school, class, active session, expiry, token and duplicate check-in.
5. Session activate/refresh is restricted to the session creator or school admin.
6. Firestore Rules restrict profile self-updates to display name and photo; school membership, role, status and student roster attributes cannot be changed by the user.
7. Student submission document IDs are constrained to one record per assignment/student identity.
8. Legacy migration requires explicit backup and single-school confirmation flags; old accounts without an approval status are set to `pending`, not automatically trusted.
9. Added account provisioning script; it is dry-run by default and skips cross-school conflicts, role conflicts, duplicate student IDs and users without Google provider.
10. Added mobile scanner startup/teardown handling, a real frontend `checkin()` handler, QR expiry status display and Asia/Bangkok date/time formatting.
11. Added mobile Google Sign-In redirect while persisting only the selected role temporarily.
12. Added assignment creator ownership checks in the frontend and Firestore Rules.
13. Migration now places legacy profiles without `approvedAt` into `pending`; the provisioning tool records an approving email and does not reactivate suspended users without an explicit flag.

## Automated checks executed

- Node.js syntax checks for app module, Cloud Functions and scripts.
- QR token helper unit tests.
- Verified the frontend calls a defined `checkin()` handler for both Cloud Functions and local demo mode.
- JSON parse checks for Firebase config, indexes, package and manifest.
- Static project consistency checks for logo, responsive layout, server-only attendance flow and critical security markers.

See `STATIC_TEST_REPORT.md` for the exact results.

## Not verified

- Firebase project connectivity, Firestore Rules deployment/compilation, Storage Rules deployment, Functions deployment, billing configuration, Authentication provider setup, actual data migration, and browser/mobile end-to-end behavior were not verified because the project account and deployment credentials were not provided.
- V3 must not be represented to a school as certified or production-ready until the supervised pilot checklist passes.

## Additional release preparation

- Added a role-aware Director Overview for the administrator account. It shows unique students checked in today, current sessions and class-level rollups. It explicitly labels the unmatched count as students with no check-in record, not confirmed absences.
- Added GitHub Pages root entry and relative PWA paths while preserving `public/` for optional Firebase Hosting.
- Removed the inherited `noindex` setting from the public release.
- The production `main` branch was not modified; release changes are staged in a review branch and a draft Pull Request.
- Added a shareable local Demo Mode with synthetic student/session/attendance/task records. It does not write to Firebase and is explicitly labelled as sample data.