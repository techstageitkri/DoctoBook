# Software Requirements Specification

## Online Doctor Appointment Marketplace

Version: 1.0  
Date: 10 July 2026  
Prepared for: DoctoBook / TechStage IT  
Primary market: Sri Lanka  

---

## 1. Purpose

This Software Requirements Specification defines the functional, non-functional, architectural, and operational requirements for a multi-clinic doctor appointment booking marketplace.

The platform will allow patients to search clinics and doctors, view availability, book appointments, make payments when required, receive notifications, and leave reviews. Doctors, clinic administrators, receptionists, and super administrators will manage profiles, schedules, appointments, payments, refunds, reviews, and system configuration through role-based portals.

---

## 2. Product Scope

The product is a marketplace for many clinics and doctors. It is not limited to a single clinic.

The platform will include:

- Patient web portal
- Doctor portal
- Clinic admin portal
- Receptionist portal
- Super admin dashboard
- Backend API
- PostgreSQL database
- Redis caching and queue support
- Configurable email, SMS, push notification, and payment settings
- Future Flutter mobile apps for patients and doctors

The MVP will focus on the web platform and backend. Mobile apps can be built in a later phase after the core booking workflows are stable.

---

## 3. Technology Stack

### 3.1 Frontend

- Next.js for all web portals
- TypeScript
- Responsive UI for desktop, tablet, and mobile browser
- Multi-language-ready frontend architecture
- MVP portal architecture: one Next.js application with route groups for public, patient, doctor, clinic, reception, and super admin areas.

### 3.2 Backend

- NestJS
- TypeScript
- REST APIs
- Modular monolith architecture for MVP
- API versioning for future mobile app support

### 3.3 Database

- PostgreSQL
- Relational schema with strong constraints
- Database transactions for appointment booking
- Indexing for search, filtering, and reporting

### 3.4 Caching And Jobs

- Redis for caching, rate limiting, temporary locks, and shared state
- BullMQ for background jobs

### 3.5 External Services

- Primary MVP payment provider must be finalized before implementation. PayHere is recommended first for Sri Lankan LKR payments; Stripe can be added for international/USD payments.
- Firebase Cloud Messaging provider configuration shall be prepared in MVP. Actual mobile push delivery starts with Flutter apps in Phase 3 unless browser web push is explicitly approved for MVP.
- Configurable email provider. One primary MVP provider must be selected before notification implementation.
- Configurable SMS provider. One primary MVP provider must be selected before SMS delivery implementation.
- Object storage for documents and images

---

## 4. User Roles

Detailed role permissions are maintained in [PERMISSION_MATRIX.md](./PERMISSION_MATRIX.md). Backend authorization shall enforce both role and data scope.

### 4.1 Super Admin

The platform owner role. Super admin manages the full marketplace.

Responsibilities:

- Manage clinics
- Manage doctors
- Approve/reject/suspend doctors
- Manage patients
- Manage appointments across all clinics
- Manage payments and refunds
- Manage platform settings
- Manage notification provider credentials and global settings
- Manage payment gateway credentials and global settings
- Manage reviews and moderation
- View platform-wide reports
- Manage legal pages and content

### 4.2 Clinic Admin

Clinic-level manager role.

Responsibilities:

- Manage clinic profile
- Manage clinic locations
- Manage doctors attached to the clinic
- Manage receptionists
- View clinic appointments
- Manage appointment overrides
- View clinic payment records
- View clinic reports
- Configure clinic-level booking/payment preferences if permitted

### 4.3 Doctor

Healthcare provider role.

Responsibilities:

- Self-register
- Submit verification details
- Manage profile after approval
- Manage availability and holidays
- View appointment queue
- View patient appointment details
- Receive booking/cancellation notifications
- View reviews and ratings

### 4.4 Receptionist

Clinic front-desk role.

Responsibilities:

- View clinic appointment queue
- Create appointments for walk-in or phone patients
- Reschedule/cancel appointments based on permission
- Mark patient status: checked in, no-show, completed
- Manage offline payment status
- View daily doctor schedules

### 4.5 Patient

End-user role.

Responsibilities:

- Register/login
- Manage profile
- Search doctors and clinics
- View doctor availability
- Book appointments
- Reschedule/cancel appointments
- Pay online if required
- View appointment history
- Receive notifications
- Leave reviews after completed appointments

---

## 5. Core Business Rules

### 5.1 Marketplace Rules

- The platform must support many clinics.
- A clinic can have one or more locations.
- A doctor can belong to one or more clinics.
- A doctor can have different availability, services, fees, and appointment rules per clinic/location.
- Patients can search by doctor, specialty, clinic, location, availability, rating, and fee.

### 5.2 Doctor Registration And Approval

- Doctors can self-register.
- A newly registered doctor shall remain inactive until identity and verification approval is completed by a Super Admin.
- An authorized Clinic Admin may approve only the doctor-clinic association when that permission is enabled.
- Doctor verification data should include license number, specialization, qualifications, experience, documents, clinic association request, and contact details.
- Super Admin can approve, reject, suspend, or request changes for doctor identity verification.

### 5.3 Clinic Association Rules

- Doctors may request association with a clinic/location.
- Clinic admins may invite doctors to join a clinic/location if this permission is enabled.
- A doctor-clinic association must be approved before the doctor can publish availability or receive appointments for that clinic/location.
- Future appointments must block removal of a doctor-clinic association unless an authorized admin cancels, transfers, or completes those appointments first.
- Association approval authority must be configurable as super-admin-only or clinic-admin-permitted.

### 5.4 Services And Fees

- Clinics and doctors shall support appointment services such as general consultation, follow-up consultation, specialist consultation, medical certificate appointment, and other configurable services.
- A service shall define name, duration, fee, currency, payment mode, active status, and clinic/location applicability.
- A doctor may offer different services, durations, and fees per clinic/location.
- Appointment booking shall capture the selected service and fee snapshot at the time of booking.

### 5.5 Patient Dependents And Family Booking

- The platform shall support booking for the logged-in patient and may support booking for dependents/family members.
- MVP decision required: enable dependents in MVP or defer to Phase 2.
- If enabled, each appointment shall store the attending person details separately from the account holder.

### 5.6 Payment Mode

Payment mode must be configurable.

Supported modes:

- Online payment mandatory before booking confirmation
- Pay at clinic
- Optional online payment

Configuration may exist at platform, clinic, doctor, or service level. The final hierarchy shall be:

1. Doctor-clinic-service setting
2. Doctor-clinic setting
3. Clinic setting
4. Platform default setting

### 5.7 Payment Settlement Model

- MVP shall avoid automated clinic/doctor payouts unless explicitly approved.
- MVP shall support payment transaction tracking, payment status, refund tracking, and settlement-ready reports.
- MVP may store disabled commission configuration for future use, but shall not calculate or settle platform commissions.
- Future phases may add platform commissions, clinic settlements, settlement items, invoices, reconciliation, tax handling, disputes, and chargebacks.

### 5.7A Timezone Policy

- All timestamps shall be stored in UTC using timezone-aware database fields.
- Each clinic location shall have an IANA timezone identifier.
- Appointment availability shall be calculated and displayed using the clinic location timezone.
- Initial Sri Lankan clinic locations shall use `Asia/Colombo` unless configured otherwise.
- Appointment times shall not be stored as local strings without timezone context.

### 5.8 Cancellation Policy

- Default cancellation window: 30 minutes before appointment time.
- Cancellation window must be admin-configurable.
- Admin users can override cancellation restrictions based on permission.

### 5.9 Rescheduling Policy

- Rescheduling deadline shall be configurable. Default shall match the cancellation window unless configured separately.
- Maximum patient-initiated reschedules per appointment shall be configurable.
- Rescheduling after check-in shall not be allowed except by authorized admin override.
- If the new service or slot has a higher fee, the system shall require additional payment when online payment is required.
- If the new service or slot has a lower fee, the system shall create a refund review item or credit note based on configured policy.
- Rescheduling shall be recorded in appointment status history and audit logs. The appointment status should not be set to `rescheduled` as a final state.

### 5.10 Refund Policy

- Default refund processing period: 7 days.
- Refund period must be admin-configurable.
- Refund records must track status: requested, under review, approved, rejected, processing, processed, failed.
- Refund decisions should be auditable.

### 5.11 Reviews And Ratings

- Patients can review doctors only after completed appointments.
- A patient can submit one review per completed appointment.
- Reviews should support rating and written feedback.
- Reviews require moderation before public display, unless admin changes this setting.
- Admin can approve, reject, hide, or edit moderation status.

### 5.12 Notifications

The system must support configurable notifications through:

- Email
- SMS
- Push notification

Notification events include:

- User registration
- Doctor approval/rejection
- Appointment booking
- Appointment reschedule
- Appointment cancellation
- Appointment reminder
- Payment success/failure
- Refund status update
- Review submitted
- Admin/manual notices

Provider credentials shall be Super Admin-only for MVP. Clinic admins may manage clinic-level notification events, templates, sender labels, and payment mode only if explicitly enabled by permission.

### 5.13 Medical Information In MVP

- Consultation notes are excluded from MVP.
- Patient profile shall not include unrestricted medical-history free text in MVP unless legal/compliance review approves its purpose, visibility, retention, and access rules.
- MVP may collect a limited reason for visit during booking.
- Receptionists shall not view sensitive patient medical information unless explicitly permitted by role and clinic scope.

### 5.14 Multi-Language

- MVP will launch in English.
- The platform must be built with multi-language readiness.
- UI labels must use translation keys instead of hardcoded text.
- Future language support should include Tamil and potentially Sinhala.

---

## 6. Functional Requirements

## 6.1 Authentication And Authorization

### FR-AUTH-001 User Registration

The system shall allow patients and doctors to register using email and password.

### FR-AUTH-002 Login

The system shall allow users to login securely.

### FR-AUTH-003 Role-Based Access Control

The system shall restrict access by action-based permission and data scope. Role checks alone are not sufficient.

### FR-AUTH-003A Default Deny

Any action not explicitly granted by role, permission, and data scope shall be denied by default. When permissions conflict, the more restrictive rule shall apply unless a specific override permission exists.

### FR-AUTH-004 Password Security

The system shall hash passwords using a secure hashing algorithm.

### FR-AUTH-005 Account Status

The system shall support account statuses such as pending verification, pending approval, active, inactive, suspended, and deactivated. Account deletion shall be handled through a separate retention, anonymization, or legal-deletion process.

### FR-AUTH-006 Token Security

The backend shall use secure token-based authentication suitable for web and mobile clients.

### FR-AUTH-007 Session And Refresh Token Management

The backend shall store refresh-token sessions using hashed tokens only. Users shall be able to log out from one device, and authorized security actions such as password change, account suspension, and logout-all shall revoke active sessions.

### FR-AUTH-008 Verification And Reset Tokens

Email verification, phone verification, password reset, and invitation flows shall use short-lived one-time tokens stored as hashes.

---

## 6.2 Patient Portal

### FR-PAT-001 Patient Profile

Patients shall be able to manage name, email, phone, profile photo, date of birth, gender, and address. Free-text medical history is excluded from MVP unless approved during compliance review.

### FR-PAT-002 Doctor Search

Patients shall be able to search doctors by specialty, clinic, location, availability, rating, and consultation fee.

### FR-PAT-003 Clinic Search

Patients shall be able to search clinics by location, specialty, and available doctors.

### FR-PAT-004 Doctor Profile

Patients shall be able to view doctor profile, specialization, qualifications, clinics, availability, fees, ratings, and reviews.

### FR-PAT-005 Appointment Booking

Patients shall be able to select clinic, doctor, service, date, time slot, payment mode, attending person, and confirm an appointment.

### FR-PAT-006 Appointment History

Patients shall be able to view upcoming, completed, cancelled, no-show appointments, and appointments with related payment/refund records.

### FR-PAT-007 Reschedule Appointment

Patients shall be able to reschedule appointments subject to configured rules.

### FR-PAT-008 Cancel Appointment

Patients shall be able to cancel appointments subject to configured cancellation window.

### FR-PAT-009 Online Payment

Patients shall be able to pay online when the selected appointment requires or allows online payment.

### FR-PAT-010 Reviews

Patients shall be able to submit reviews after completed appointments.

### FR-PAT-011 Dependents

If dependents are enabled, patients shall be able to add, update, and select dependent/family profiles for appointment booking.

---

## 6.3 Doctor Portal

### FR-DOC-001 Doctor Self Registration

Doctors shall be able to submit registration and verification details.

### FR-DOC-002 Doctor Profile Management

Approved doctors shall be able to manage profile information, qualifications, experience, languages, specializations, and profile photo.

### FR-DOC-003 Clinic Association

Doctors shall be able to request association with one or more clinics.

### FR-DOC-004 Availability Management

Doctors shall be able to manage working hours, slot intervals, breaks, holidays, and unavailable dates per clinic/location. Appointment duration shall be determined by the configured doctor-clinic service.

### FR-DOC-004A Service Management

Doctors or authorized clinic admins shall be able to configure doctor services, durations, fees, and payment modes per clinic/location.

### FR-DOC-005 Appointment Queue

Doctors shall be able to view upcoming appointments and daily appointment queue.

### FR-DOC-006 Appointment Detail View

Doctors shall be able to view relevant patient appointment details.

### FR-DOC-007 Notification Preferences

Doctors shall receive notifications for bookings, cancellations, and reschedules.

---

## 6.4 Clinic Admin Portal

### FR-CLN-001 Clinic Profile

Clinic admins shall be able to manage clinic name, logo, address, contact details, opening hours, and description.

### FR-CLN-002 Clinic Locations

Clinic admins shall be able to manage multiple clinic locations.

### FR-CLN-003 Clinic Doctors

Clinic admins shall be able to view and manage doctors associated with the clinic.

### FR-CLN-003A Clinic Services

Clinic admins shall be able to manage clinic services and assign service availability to doctors.

### FR-CLN-004 Receptionist Management

Clinic admins shall be able to create, update, suspend, and assign receptionist accounts.

### FR-CLN-005 Clinic Appointments

Clinic admins shall be able to view, filter, reschedule, cancel, and override appointments for the clinic.

### FR-CLN-006 Clinic Reports

Clinic admins shall be able to view reports for appointments, revenue, doctor performance, and no-shows.

---

## 6.5 Receptionist Portal

### FR-REC-001 Daily Queue

Receptionists shall be able to view daily appointments by clinic, doctor, and status.

### FR-REC-002 Walk-In Booking

Receptionists shall be able to create appointments for walk-in or phone patients.

### FR-REC-003 Patient Check-In

Receptionists shall be able to mark patients as checked in.

### FR-REC-004 Appointment Status Update

Receptionists shall be able to mark appointments as waiting, in progress, completed, no-show, or cancelled based on permission.

### FR-REC-005 Offline Payment

Receptionists shall be able to mark pay-at-clinic payment status.

---

## 6.6 Super Admin Dashboard

### FR-ADM-001 Global Dashboard

Super admin shall be able to view marketplace-wide metrics: users, clinics, doctors, appointments, revenue, refunds, and reviews.

### FR-ADM-002 Doctor Approval

Super admin shall be able to approve, reject, suspend, and reactivate doctors.

### FR-ADM-003 Clinic Management

Super admin shall be able to create, update, verify, suspend, and delete clinics.

### FR-ADM-004 User Management

Super admin shall be able to manage patients, doctors, clinic admins, and receptionists.

### FR-ADM-005 Appointment Management

Super admin shall be able to view and override all appointments.

### FR-ADM-006 Payment Management

Super admin shall be able to monitor payment transactions and payment gateway results.

### FR-ADM-007 Refund Management

Super admin shall be able to review and process refund requests.

### FR-ADM-008 Review Moderation

Super admin shall be able to approve, reject, hide, or moderate reviews.

### FR-ADM-009 System Settings

Super admin shall be able to configure payment gateway credentials, email provider credentials, SMS provider credentials, Firebase credentials, cancellation policy, refund policy, notification templates, disabled future-use platform commission settings, and language settings.

---

## 6.7 Appointment Booking Engine

### FR-BOOK-001 Slot Generation

The system shall generate appointment slots based on clinic location operating hours, clinic closures, doctor availability, doctor breaks, doctor time off, service duration, slot interval, and existing bookings.

### FR-BOOK-002 Slot Locking

The system shall prevent double booking using database transactions and unique constraints.

### FR-BOOK-003 Temporary Reservation

When an appointment requires online payment, the system shall reserve the selected slot for a configurable period. The default reservation period shall be 10 minutes. The system shall automatically release the reservation when the payment period expires without successful payment.

### FR-BOOK-004 Booking Status

Appointments shall support statuses including pending payment, confirmed, checked in, waiting, in progress, completed, cancelled by patient, cancelled by clinic, cancelled by admin, no-show, and expired.

Refund and payment states shall not be stored as appointment statuses. Refund state shall be tracked in refund records, and payment state shall be tracked in payment records.

### FR-BOOK-005 Admin Override

Authorized admins shall be able to override appointment status or time with audit logging.

### FR-BOOK-006 Concurrent Booking Safety

The system shall prevent active appointments whose time ranges overlap for the same doctor, including appointments across different clinics or clinic locations. When competing booking requests overlap, only one booking shall succeed.

### FR-BOOK-007 Expired Payment Holds

Expired online-payment holds shall be released by a background job and the appointment shall move to expired status.

---

## 6.8 Payments And Refunds

### FR-PAY-001 Gateway Configuration

Super admin shall be able to configure payment gateway credentials securely. Clinic admins shall not access gateway credentials in MVP unless a clinic-owned merchant-account model is explicitly approved.

For MVP, payment provider credentials shall be platform-scoped only. Clinic-scoped payment credentials may be enabled later behind an approved feature flag or merchant-account model.

### FR-PAY-002 Payment Processing

The system shall process payments through configured gateways.

### FR-PAY-003 Payment Webhooks

The backend shall receive and validate gateway webhooks.

### FR-PAY-004 Payment Status

Payments shall track status: initiated, pending, successful, failed, cancelled, refunded, partially refunded.

### FR-PAY-005 Refund Request

The system shall create refund requests when eligible cancellations occur.

### FR-PAY-006 Refund Processing

Admin shall be able to approve, reject, or mark refunds as processed.

### FR-PAY-007 Settlement Reports

MVP shall provide settlement-ready reports for clinics/doctors, but automated payouts are out of MVP unless approved separately.

---

## 6.9 Notification Management

### FR-NOT-001 Notification Templates

Admin shall be able to manage templates for email, SMS, and push notifications.

### FR-NOT-002 Channel Configuration

Admin shall be able to enable or disable notification channels per event.

### FR-NOT-003 Background Delivery

Notifications shall be processed through background jobs.

### FR-NOT-004 Retry Handling

Failed notifications shall be retried based on configurable retry rules.

---

## 6.10 Reviews And Ratings

### FR-REV-001 Review Submission

Patients shall be able to submit a review after a completed appointment.

### FR-REV-002 Review Moderation

Reviews shall be moderated before public display unless configured otherwise.

### FR-REV-003 Rating Calculation

Doctor rating averages shall update after approved reviews.

---

## 7. Non-Functional Requirements

## 7.1 Security

- All production traffic must use HTTPS.
- Passwords must be hashed.
- Sensitive provider keys must be encrypted or stored in a secure secrets manager.
- APIs must validate input.
- Role-based access must be enforced on backend APIs.
- Sensitive actions must be audit logged.
- Rate limiting must be applied to login, registration, booking, and public search APIs.
- SQL injection must be prevented through ORM/query parameterization.
- XSS protection must be applied on web surfaces.

## 7.2 Privacy And Legal

- The system must collect user consent for privacy policy and terms.
- Patient data access must be restricted to relevant users only.
- Doctor/receptionist access must be scoped by clinic and appointment.
- Audit logs must record access and changes to sensitive records.
- The product must be planned against applicable Sri Lankan healthcare, data protection, and consumer/payment regulations before launch, including Sri Lanka's Personal Data Protection Act requirements where applicable.
- The product must be built with HIPAA-grade healthcare privacy and security controls even if HIPAA is not legally mandatory for the initial Sri Lankan launch.
- HIPAA compliance is mandatory if the platform serves US healthcare providers, US patients, US protected health information, or acts as a business associate for a US covered entity.
- The platform must avoid storing raw card data. Payment processing should use hosted or tokenized gateway flows.
- The system must support data minimization, consent tracking, access control, audit trails, secure backups, breach investigation support, and secure data deletion/anonymization workflows where legally required.

## 7.2.1 Compliance Requirements

- Compliance baseline for initial Sri Lankan launch: Sri Lankan data protection and healthcare privacy obligations, plus platform terms, privacy policy, consent capture, and payment gateway compliance.
- Security baseline: HIPAA-grade controls for PHI-style data, including encryption in transit, encryption at rest where supported, role-based access, least privilege, audit logs, secure backups, and incident response readiness.
- Legal review requirement: A qualified legal/compliance reviewer must validate the final policy, consent wording, data retention rules, and launch jurisdiction requirements before production launch.
- Infrastructure requirement: Hosting, database, object storage, email, SMS, push, analytics, and monitoring providers must be reviewed for healthcare data suitability before production use.
- Business agreements: If HIPAA applies, required business associate agreements and vendor agreements must be completed before handling production PHI.

## 7.3 Performance

- Public doctor/clinic search API shall return 95% of successful requests within 1.5 seconds under the agreed MVP load target.
- Doctor availability API shall return 95% of successful requests within 1 second under the agreed MVP load target.
- Booking confirmation API shall complete 95% of non-payment-gateway processing within 3 seconds.
- Normal admin portal pages shall load required API data within 2 seconds for 95% of requests under the agreed MVP load target.
- Main booking notifications shall be queued within 30 seconds after the triggering event.
- Reports expected to exceed 5 seconds shall run asynchronously.
- Frequently accessed public data such as specialties, clinic profiles, doctor profiles, and settings shall be cacheable.
- Booking write operations must prioritize consistency over speed.

## 7.4 Scalability

The system should be designed to support long-term growth toward millions of registered users.

Scale-ready foundations:

- Stateless NestJS API servers
- Load balancer support
- Redis caching
- BullMQ background jobs
- PostgreSQL indexes and connection pooling
- Read replica readiness
- CDN caching for public Next.js pages
- Search abstraction for future Meilisearch, Elasticsearch, or OpenSearch

## 7.5 Availability

- Target production uptime: 99.5% for initial launch.
- Database backups must be automated with at least daily full backups for MVP.
- MVP recovery point objective shall be defined before production launch. Initial target: maximum 24 hours data loss for non-transactional backups, with payment and appointment records protected by transactional database backups.
- MVP recovery time objective shall be defined before production launch. Initial target: restore critical service within 8 hours.
- Deployment should support rollback.
- Health check endpoints must exist for API services.

## 7.6 Maintainability

- Codebase must use TypeScript.
- Backend modules must be separated by domain.
- APIs must be documented.
- Environment variables and secrets must be managed clearly.
- Business rules must not be duplicated between Next.js and NestJS.

## 7.7 Audit Logging

The system shall audit at least the following events:

- Doctor approval, rejection, suspension, and reactivation
- Clinic creation, update, suspension, and reactivation
- User suspension and permission changes
- Appointment creation, cancellation, reschedule, status override, and cancellation override
- Payment status changes and payment webhook processing
- Refund approval, rejection, and processed status changes
- Provider credential and system setting changes
- Review moderation
- Patient data access where legally or operationally required
- Data export, deletion, or anonymization

Audit records shall include actor user, actor role, action, entity type, entity ID, clinic scope where relevant, previous value, new value, reason, IP address, user agent, timestamp, and correlation ID where available. Audit records shall not be editable through normal application operations.

## 7.8 Accessibility And Browser Support

- Web portals shall support current stable versions of Chrome, Safari, Firefox, and Edge.
- Web portals shall support responsive layouts for desktop, tablet, and mobile browsers.
- Forms shall provide accessible labels, keyboard navigation, visible focus states, and usable validation messages.
- Color contrast shall be suitable for healthcare/admin workflows.
- Date, time, phone, and currency formatting shall be locale-ready.

## 7.9 Logging, Monitoring, And Error Handling

- Backend services shall emit structured logs with correlation IDs.
- Payment webhooks and booking requests shall be idempotent.
- Failed background jobs shall support retries and dead-letter handling.
- Production shall include error monitoring, uptime monitoring, and operational alerts before launch.

---

## 8. High-Level Architecture

```text
Patient / Doctor / Clinic / Receptionist / Super Admin
                    |
                    v
              Next.js Web App
    (/public, /patient, /doctor, /clinic,
        /reception, /admin route groups)
                    |
                    v
             NestJS REST API
                    |
        +-----------+-----------+
        |           |           |
        v           v           v
   PostgreSQL     Redis       BullMQ
        |                       |
        v                       v
  Core Data Store        Background Workers
                                |
              +-----------------+-----------------+
              |                 |                 |
              v                 v                 v
           Email              SMS              Firebase

Payments:
NestJS API <-> PayHere / Stripe
```

---

## 9. Suggested Backend Modules

- Auth module
- Users module
- Roles and permissions module
- Patients module
- Doctors module
- Clinics module
- Specialties module
- Services module
- Availability module
- Appointments module
- Payments module
- Refunds module
- Reviews module
- Notifications module
- Settings module
- Reports module
- Audit logs module
- Files/documents module

---

## 10. Suggested Database Entities

Initial entities:

- users
- auth_sessions
- verification_tokens
- roles
- permissions
- user_roles
- role_permissions
- user_permission_grants
- patients
- patient_dependents
- doctors
- doctor_documents
- doctor_document_clinic_reviews
- clinics
- clinic_locations
- clinic_location_hours
- clinic_location_closures
- clinic_admins
- receptionists
- specialties
- services
- clinic_services
- doctor_specialties
- doctor_clinics
- doctor_clinic_services
- doctor_availability_rules
- doctor_availability_breaks
- doctor_time_off
- appointment_slots
- appointment_slot_holds
- appointments
- appointment_status_history
- appointment_reschedule_requests
- payments
- payment_webhook_events
- refunds
- payment_status_history
- refund_status_history
- reviews
- notification_templates
- notification_logs
- user_push_tokens
- system_settings
- provider_configurations
- audit_logs
- consent_records
- uploaded_files
- translations

---

## 11. Suggested API Groups

### Auth APIs

- Register patient
- Register doctor
- Login
- Logout
- Refresh token
- Forgot password
- Reset password
- Verify email/phone

### Public Marketplace APIs

- List specialties
- Search doctors
- Search clinics
- View doctor profile
- View clinic profile
- View doctor availability
- View doctor services and fees

### Patient APIs

- Manage profile
- Book appointment
- Reschedule appointment
- Cancel appointment
- View appointment history
- Make payment
- Submit review
- Manage dependents if enabled

### Doctor APIs

- Manage profile
- Manage documents
- Manage clinic associations
- Manage services if permitted
- Manage availability
- View appointments
- View reviews

### Clinic Admin APIs

- Manage clinic profile
- Manage locations
- Manage doctors
- Manage services
- Manage receptionists
- Manage clinic appointments
- View clinic reports

### Receptionist APIs

- View daily queue
- Create appointment
- Update appointment status
- Mark offline payment
- Reschedule/cancel appointment

### Super Admin APIs

- Manage clinics
- Manage users
- Approve/reject doctors
- Manage appointments
- Manage payments
- Manage refunds
- Moderate reviews
- Manage system settings
- Manage notification templates
- View reports

---

## 12. Page And Screen List

## 12.1 Public Pages

- Home/search page
- Doctor listing page
- Clinic listing page
- Doctor profile page
- Clinic profile page
- Specialty/location landing pages
- Login
- Register as patient
- Register as doctor
- Terms and conditions
- Privacy policy

## 12.2 Patient Portal

- Patient dashboard
- Profile
- Search doctors
- Doctor details
- Book appointment
- Payment screen
- Appointment history
- Appointment detail
- Dependents/family profiles if enabled
- Review submission
- Notifications

## 12.3 Doctor Portal

- Doctor dashboard
- Registration/verification status
- Profile management
- Clinic associations
- Services and fees
- Availability management
- Appointment queue
- Appointment detail
- Reviews
- Notifications

## 12.4 Clinic Admin Portal

- Clinic dashboard
- Clinic profile
- Locations
- Doctors
- Services
- Receptionists
- Appointments
- Payments
- Reports
- Settings

## 12.5 Receptionist Portal

- Reception dashboard
- Daily queue
- Create appointment
- Patient check-in
- Appointment detail
- Offline payment status

## 12.6 Super Admin Dashboard

- Global dashboard
- Clinics
- Doctors
- Doctor approvals
- Patients
- Clinic admins
- Receptionists
- Appointments
- Payments
- Refunds
- Reviews
- Reports
- Notification templates
- System settings
- Audit logs

---

## 12.7 State Transitions

### Appointment States

Allowed appointment states:

- pending payment
- confirmed
- checked in
- waiting
- in progress
- completed
- cancelled by patient
- cancelled by clinic
- cancelled by admin
- no-show
- expired

State rules:

- `pending payment` can move to `confirmed`, `expired`, or a cancellation state.
- `confirmed` can move to `checked in`, `cancelled by patient`, `cancelled by clinic`, `cancelled by admin`, `no-show`, or `completed`.
- `checked in` can move to `waiting`, `in progress`, `completed`, or admin cancellation.
- `waiting` can move to `in progress`, `completed`, or admin cancellation.
- `in progress` can move to `completed`.
- Terminal states are `completed`, cancellation states, `no-show`, and `expired`.
- Rescheduling shall be recorded as a history event and time-slot change, not as a terminal appointment status.

### Payment States

Allowed payment states:

- initiated
- pending
- successful
- failed
- cancelled
- partially refunded
- refunded

Payment transition rules:

- `initiated` can move to `pending` or `failed`.
- `pending` can move to `successful`, `failed`, or `cancelled`.
- `successful` can move to `partially refunded` or `refunded`.
- `partially refunded` can move to `refunded`.
- Invalid payment transitions shall be rejected.
- Every payment transition shall be recorded.
- Duplicate payment webhooks shall not repeat a transition.

### Refund States

Allowed refund states:

- requested
- under review
- approved
- rejected
- processing
- processed
- failed

Refund transition rules:

- `requested` can move to `under review`.
- `under review` can move to `approved` or `rejected`.
- `approved` can move to `processing`.
- `processing` can move to `processed` or `failed`.
- `failed` can move back to `processing`.
- `processed` is terminal and shall not return to an approval state.
- Invalid refund transitions shall be rejected.
- Every refund transition shall be recorded.

## 12.8 Scenario Acceptance Criteria

### Appointment Booking

- Given an approved doctor has an available service slot, when a patient selects that slot and completes all required booking steps, then the appointment shall be created and the slot shall no longer be available.
- Given two patients attempt to confirm overlapping time ranges for the same doctor, including across different clinics or clinic locations, when both requests reach the backend, then only one appointment shall be confirmed.
- Given online payment is mandatory, when payment is not completed within the configured reservation period, then the slot hold shall expire and the slot shall become available again.

### Cancellation

- Given the cancellation window is 30 minutes, when a patient attempts to cancel more than 30 minutes before the appointment, then cancellation shall be permitted.
- Given the cancellation window is 30 minutes, when a patient attempts to cancel within 30 minutes of the appointment, then cancellation shall be rejected unless an authorized admin overrides the rule.

### Reviews

- Given an appointment is completed, when the patient submits one review, then the review shall enter the configured moderation state.
- Given a review already exists for an appointment, when the same patient attempts to review the same appointment again, then the system shall reject the second review.

---

## 13. MVP Scope

The first MVP should include:

- Next.js web app
- NestJS backend
- PostgreSQL database
- Redis and BullMQ setup
- Patient registration/login
- Patient dependent/family booking decision finalized
- Doctor registration with approval
- Clinic management
- Clinic service and doctor service management
- Doctor profile and availability
- Patient doctor search
- Appointment booking
- Configurable payment mode
- Basic payment integration
- Cancellation rule
- Refund request tracking
- Receptionist daily queue and walk-in booking
- Email notification foundation
- SMS/push provider configuration structure
- Admin settings
- Review submission and moderation
- Basic reports
- English UI with multi-language-ready structure

---

## 14. Phase Plan

### Phase 1: Foundation And MVP Web

- Project setup
- Database schema
- Auth and RBAC
- Super admin dashboard foundation
- Clinic and doctor management
- Doctor approval workflow
- Availability and appointment booking
- Patient search and booking
- Receptionist portal
- Basic payments
- Basic refund request tracking
- Basic review moderation
- Core notification templates
- Required admin-configurable settings
- Essential security audit logs
- Basic notifications

### Phase 2: Operations And Automation

- Automated refunds
- Audit-log export and advanced searching
- Template versioning
- Advanced notification routing
- Advanced moderation and reporting
- SMS and push delivery
- Advanced reports
- Performance optimization

### Phase 3: Mobile Apps

- Flutter patient app
- Flutter doctor app
- Push notifications
- Mobile booking and appointment management

### Phase 4: Marketplace Growth

- Platform commission
- Clinic subscriptions
- Featured doctors/clinics
- Advanced analytics
- Search engine integration
- Read replicas and advanced scaling improvements

---

## 15. Assumptions

- MVP launches in English only.
- Multi-language architecture is required from the start.
- Consultation notes are not included in MVP.
- SMS will be configurable, but provider selection must be finalized.
- Payment gateway selection must be finalized before payment implementation.
- Hosting provider must be selected before production deployment planning.
- Legal review for healthcare privacy, Sri Lankan data/payment compliance, and HIPAA applicability is required before launch.
- MVP payment settlement shall be report-based/manual unless automated payouts are approved separately.
- MVP shall use one Next.js application with route groups unless deployment requirements force separate applications.

---

## 16. Open Decisions

The following decisions must be finalized before development or during discovery:

- Exact SMS provider
- Exact email provider
- Whether OTP login is required
- Whether patient phone verification is mandatory
- Whether doctor license document upload is mandatory
- Whether clinics can self-register or only super admin creates clinics
- Whether clinic admins can approve doctor-clinic association requests or only Super Admin can approve associations
- Payment gateway priority: PayHere first, Stripe first, or both
- Platform commission model
- Whether online refunds are automatic or admin-marked manual refunds for MVP
- Whether patient dependents/family booking is included in MVP or Phase 2
- Whether any patient medical history is included in MVP after compliance review
- Exact service and fee model for MVP appointment types
- Maximum patient-initiated reschedules per appointment
- Rescheduling deadline and fee-difference handling rules
- Whether additional clinic timezones beyond `Asia/Colombo` are needed at launch
- Hosting provider and deployment target
- Whether the product will serve only Sri Lanka initially or must support US/HIPAA-regulated customers from day one
- Data retention period for patient, appointment, payment, refund, audit, and notification records
- Whether patient data export/delete/anonymization workflows are required in MVP or Phase 2
- Whether browser web push is included in MVP or only mobile push in Phase 3
- Whether clinic/doctor payouts, invoices, disputes, and tax handling are excluded from MVP or partially included

---

## 17. Acceptance Criteria

The MVP can be accepted when:

- Patients can register, search doctors, view availability, book appointments, and view history.
- Doctors can register, wait for approval, manage profile, manage availability, and view appointments.
- Super admin can approve doctor identity verification, manage clinics, manage users, manage appointments, configure core settings, and moderate reviews.
- Clinic admins can manage clinic-level operational data.
- Receptionists can manage daily queue and walk-in bookings.
- Appointment booking includes selected service, fee snapshot, clinic/location, doctor, attending person, and time slot.
- Concurrent appointment slot conflicts are prevented by backend/database controls.
- Online-payment slot holds expire automatically when payment is not completed within the configured reservation period.
- Payment mode is configurable.
- Cancellation rules are enforced.
- Rescheduling rules are enforced or explicitly deferred from MVP.
- Refund requests are tracked.
- Notifications are generated for main appointment events.
- Reviews are restricted to completed appointments and can be moderated.
- Role-based access is enforced by the backend.
- Performance, backup, audit, and monitoring targets are verified for MVP staging.
- Privacy policy, terms consent, audit logs, role-scoped patient data access, and compliance-ready security controls are implemented.
- HIPAA applicability has been assessed before production launch.
- API documentation exists.
- The platform is deployable to staging.
