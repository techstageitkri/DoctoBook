# Permission Matrix

## Online Doctor Appointment Marketplace

Version: 1.0  
Date: 10 July 2026  

---

## 1. Roles

- Super Admin: Platform owner with global access.
- Clinic Admin: Clinic-level manager.
- Doctor: Healthcare provider.
- Receptionist: Clinic front-desk operator.
- Patient: End user booking appointments.

Permission scope keywords:

- Global: All platform records.
- Own clinic: Records belonging to the user's assigned clinic.
- Own location: Records belonging to the receptionist's assigned clinic location.
- Own profile: The user's own account/profile.
- Own appointments: Appointments assigned to the doctor or booked by the patient.
- Associated clinics: Clinics where the doctor has an approved or pending association.
- Public: Publicly visible data only.
- System: Internal system-only operation.
- Configurable: Permission can be enabled/disabled by Super Admin or Clinic Admin based on role policy.

---

## 2. Permission Model

Backend authorization shall use action-based permissions plus data scope. Role checks alone are not sufficient.

Example permission format:

```text
Permission: appointment.read
Scope: CLINIC
Scope ID: clinic_123
```

Recommended scopes:

```text
GLOBAL
CLINIC
LOCATION
DOCTOR
PATIENT
SELF
PUBLIC
SYSTEM
```

Rules:

- Any action not explicitly granted by role, permission, and data scope shall be denied by default.
- When a granted role permission conflicts with an explicit restriction, the more restrictive rule shall apply unless a specific authorized override permission exists.
- Frontend menus may use the same permission metadata, but NestJS guards must enforce the real authorization decision.
- Permission and scope changes shall be audit logged.

Recommended action codes:

```text
clinic.read
clinic.create
clinic.update
clinic.suspend
doctor.read
doctor.account.verify
doctor.account.suspend
doctor.documents.upload
doctor.documents.review_for_clinic
doctor.documents.verify_platform
doctor_clinic.request
doctor_clinic.approve
doctor_clinic.disable
service.manage
appointment.read
appointment.create
appointment.reschedule
appointment.cancel
appointment.override_cancellation
appointment.status.check_in
appointment.status.complete
payment.read
payment.offline_mark
payment.webhook.process
payment.settings.manage
payment.credentials.manage
notification.settings.manage
notification.templates.manage
notification.credentials.manage
refund.request
refund.approve
refund.reject
refund.process
refund.partial
refund.override_policy
review.moderate
audit.read
permission.read
permission.grant
permission.revoke
role.manage
```

---

## 3. Matrix

| Action | Super Admin | Clinic Admin | Doctor | Receptionist | Patient |
|---|---|---|---|---|---|
| View public doctors/clinics | Global | Public | Public | Public | Public |
| Register as patient | No | No | No | No | Yes |
| Register as doctor | No | No | Yes | No | No |
| Login | Yes | Yes | Yes | Yes | Yes |
| Manage own account | Own profile | Own profile | Own profile | Own profile | Own profile |
| Manage platform settings | Global | No | No | No | No |
| Manage payment operational settings | Global | Configurable own clinic payment mode only | No | No | No |
| Manage payment credentials | Global | No for MVP | No | No | No |
| Manage email/SMS/push operational settings | Global | Configurable own clinic events/templates only | No | No | No |
| Manage email/SMS/push credentials | Global | No for MVP | No | No | No |
| Manage notification templates | Global | Configurable own clinic | No | No | No |
| View clinics | Global | Own clinic | Associated clinics | Own clinic | Public |
| Create clinic | Yes | No | No | No | No |
| Update clinic profile | Global | Own clinic | No | No | No |
| Suspend/reactivate clinic | Global | No | No | No | No |
| Manage clinic locations | Global | Own clinic | No | Configurable own location | No |
| Create clinic admin | Global | No | No | No | No |
| Manage receptionists | Global | Own clinic | No | No | No |
| View doctors | Global | Own clinic/associated requests | Public/own profile | Own clinic | Public |
| Approve/reject doctor account identity | Global only | No | No | No | No |
| Suspend doctor account globally | Global only | No | No | No | No |
| Disable doctor at own clinic | Global | Own clinic subject to appointment rules | No | No | No |
| View doctor verification documents | Global | Configurable own clinic | Own documents | No | No |
| Upload doctor documents | Global audited | Optional own clinic audited | Own documents | No | No |
| Delete doctor documents | Restricted global | No or configurable before verification | Own unsubmitted documents only | No | No |
| Review doctor documents for clinic association | Global | Configurable own clinic | No | No | No |
| Verify doctor documents for platform identity | Global only | No | No | No | No |
| Request clinic association | No | No | Yes | No | No |
| Approve clinic association | Global | Configurable own clinic | No | No | No |
| Invite doctor to clinic | Global | Own clinic | No | No | No |
| Remove doctor from clinic | Global | Own clinic if no blocking appointments | Leave request only | No | No |
| Manage specialties | Global | No | No | No | Public view |
| Manage services | Global | Own clinic | Configurable own services | No | Public view |
| Manage doctor service fee | Global | Own clinic | Configurable own services | No | No |
| Manage doctor availability | Global | Own clinic doctors | Own availability | No | No |
| View availability | Global | Own clinic | Own availability | Own clinic | Public |
| Create appointment for self | No | No | No | No | Yes |
| Create appointment for patient | Global | Own clinic | No | Own clinic/location | No |
| Book for dependent | No | No | No | No | If enabled |
| View all platform appointments | Global | No | No | No | No |
| View clinic appointments | Global | Own clinic | Own appointments | Own clinic/location | No |
| View own appointments | No | No | Own appointments | No | Own appointments |
| View patient basic identity | Global | Own clinic appointments | Own appointments | Own clinic/location appointments | Self/dependents |
| View patient contact | Global | Own clinic appointments | Own appointments if needed | Own clinic/location appointments | Self/dependents |
| View patient booking reason | Global | Own clinic appointments | Own appointments | Own clinic/location appointments | Self/dependents |
| View patient medical information | Global if enabled | Configurable own clinic | Own appointments for configured access period if enabled | No by default | Self |
| View patient payment information | Global | Own clinic payment summary | No | Own clinic/location payment status only | Own payments |
| View patient documents | Global if enabled | Configurable own clinic | Own appointments if enabled | No by default | Self |
| Reschedule appointment | Global | Own clinic | Configurable own appointments | Configurable own clinic/location | Own appointments within policy |
| Cancel appointment | Global | Own clinic | Configurable own appointments | Configurable own clinic/location | Own appointments within policy |
| Override cancellation window | Global | Configurable own clinic | No | Configurable own clinic/location | No |
| Mark checked-in | Global | Own clinic | No | Own clinic/location | No |
| Mark waiting/in progress/completed | Global | Own clinic | Own appointments | Configurable own clinic/location | No |
| Mark no-show | Global | Own clinic | Own appointments | Own clinic/location | No |
| Manage queue/token | Global | Own clinic | View own queue | Own clinic/location | View own token if enabled |
| Initiate online payment | No | No | No | No | Own appointments |
| Mark offline payment | Global | Own clinic | No | Own clinic/location | No |
| View payments | Global | Own clinic | Own appointment payments summary | Own clinic/location if permitted | Own payments |
| Process payment webhook | System | No | No | No | No |
| Request refund | Global | Own clinic on behalf of patient | No | Configurable own clinic/location | Own eligible payment |
| Approve/reject refund | Global | Configurable own clinic within policy | No | No | No |
| Approve partial refund | Global | Configurable own clinic within threshold | No | No | No |
| Override refund policy | Global | No for MVP | No | No | No |
| Mark refund processed | Global/System | No for MVP | No | No | No |
| View settlement reports | Global | Own clinic | Configurable own revenue | No | No |
| Submit review | No | No | No | No | Completed own appointment |
| Moderate review | Global | Configurable own clinic | No | No | No |
| View approved reviews | Public | Public | Own public reviews | Public | Public |
| View audit logs | Global | Configurable own clinic | No | No | No |
| Manage global roles | Restricted global | No | No | No | No |
| Read permissions | Global | Own clinic delegated permissions | No | No | No |
| Grant clinic-level permissions | Global | Own clinic receptionist permissions only | No | No | No |
| Revoke clinic-level permissions | Global | Own clinic receptionist permissions only | No | No | No |
| Grant Super Admin permissions | Restricted global | No | No | No | No |
| Export data | Global | Configurable own clinic | Own operational export if enabled | No | Own data if required |
| Delete/anonymize patient data | Global by policy | No | No | No | Request only |

---

## 4. Patient Data Visibility

Patient data shall be divided into permission categories:

- `patient.basic_identity.view`: name, age/date of birth where needed, gender where needed.
- `patient.contact.view`: phone, email, emergency contact.
- `patient.booking_reason.view`: reason for visit and appointment notes collected for that booking.
- `patient.medical_information.view`: sensitive medical details, excluded from MVP unless compliance review approves.
- `patient.payment_information.view`: payment method summary, payment status, refund status, receipt references.
- `patient.documents.view`: patient-uploaded medical or identity documents if introduced later.

Receptionists should normally see only basic identity, contact, appointment details, check-in status, queue status, and offline payment status. They should not see sensitive medical information, private documents, full payment history, or appointments from other clinics.

Doctors can access required patient and appointment information before the appointment, during the appointment, and for a configured period after completion. The post-completion access period must be finalized before launch if sensitive medical information is introduced.

---

## 5. Refund Control Rules

- Refund amount must not exceed the original paid amount minus already processed refunds.
- Refund reason shall be mandatory.
- Partial refunds require the `refund.partial` permission.
- Refunds outside policy require the `refund.override_policy` permission.
- Refund approval thresholds shall be configurable.
- MVP recommended workflow: Patient/Clinic Admin/Receptionist requests refund, Super Admin approves or rejects, System or Super Admin marks processing/processed.
- Automated gateway refunds are out of MVP unless explicitly approved.

---

## 6. Implementation Notes

- Backend authorization must be enforced in NestJS. Frontend hiding of UI controls is not sufficient.
- Every protected endpoint shall check both action permission and data scope.
- Clinic admins and receptionists must never access records outside their assigned clinic/location unless explicitly granted.
- Doctor account approval, global doctor suspension, and platform credential management shall remain Super Admin-only for MVP.
- Clinic admins may disable a doctor within their own clinic only when appointment rules permit it.
- Patient access shall be limited to the patient's own account and approved dependents.
- Super Admin can delegate selected clinic-level permissions, but delegated permissions must be explicit.
- Permission changes, credential changes, document verification, refund decisions, and on-behalf-of document uploads shall be audit logged.
- User impersonation is out of MVP. If introduced later, it shall require a `user.impersonate` permission, Super Admin-only access, mandatory reason, strong audit logging, visible impersonation banner, payment-credential restrictions, and short session expiry.

---

## 7. Open Permission Decisions

- Clinic admins shall not approve doctor accounts globally; they may approve doctor-clinic association requests only if enabled.
- Doctors may update their own fees only if enabled; fee changes may require clinic-admin approval.
- Receptionist cancellation/rescheduling shall be configurable and enabled by clinic admin or super admin.
- Clinic admins may request or approve refunds within policy if enabled; actual gateway processing remains centrally controlled for MVP.
- Doctors may mark their own appointments completed unless clinic workflow disables this.
- Patient data export/delete shall be manual admin-managed workflow initially unless MVP legal review requires self-service.
- User impersonation is excluded from MVP unless explicitly approved and specified.
