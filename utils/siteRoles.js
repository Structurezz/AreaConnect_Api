// Roles inside a site, per site type: who a member is (patient, doctor,
// nurse, student, lecturer, hall warden, guest, housekeeping, employee,
// supervisor…), who they're assigned to (User.assignedTo — a patient's care
// team, a student's adviser, an employee's supervisor), and who answers an
// alert or a request. Everyone is still role 'resident' in the auth sense;
// User.siteRole says which of these they are.
//
// Role flags:
//   staff      — works at the site (can be assigned members, sees "my people")
//   responds   — alert types this role is sent (medical, security, fire, other)
//   scoped     — only for members in the same unit or block (a ward's nurses,
//                a class teacher, a hall's warden, a department's supervisor)
//   onCall     — has an on-call switch; on-call staff get alerts site-wide
//   assignable — members can be assigned to this role (care team, adviser…)
//   specialty  — has a specialty / subject field
//   rollcall   — can start an emergency roll-call

const R = (key, label, plural, extra = {}) => ({ key, label, plural, staff: false, responds: [], scoped: false, onCall: false, assignable: false, specialty: false, rollcall: false, ...extra });
const ALL_ALERTS = ['medical', 'security', 'fire', 'other'];

const ROLES = {
  estate: [R('resident', 'Resident', 'Residents')],
  hospital: [
    R('patient', 'Patient', 'Patients'),
    R('doctor', 'Doctor', 'Doctors', { staff: true, responds: ['medical'], onCall: true, assignable: true, specialty: true }),
    R('nurse', 'Nurse', 'Nurses', { staff: true, responds: ['medical'], scoped: true, onCall: true, assignable: true }),
    R('staff', 'Hospital staff', 'Hospital staff', { staff: true, rollcall: true }),
  ],
  university: [
    R('student', 'Student', 'Students'),
    R('lecturer', 'Lecturer', 'Lecturers', { staff: true, assignable: true, specialty: true }),
    R('warden', 'Hall warden / porter', 'Hall wardens & porters', { staff: true, responds: ALL_ALERTS, scoped: true, assignable: true, rollcall: true }),
    R('clinic', 'Clinic staff', 'Clinic staff', { staff: true, responds: ['medical'], onCall: true }),
    R('staff', 'University staff', 'University staff', { staff: true, rollcall: true }),
  ],
  school: [
    R('student', 'Student', 'Students'),
    R('teacher', 'Teacher', 'Teachers', { staff: true, responds: ['medical', 'security', 'other'], scoped: true, assignable: true, specialty: true, rollcall: true }),
    R('nurse', 'School nurse', 'School nurses', { staff: true, responds: ['medical'], onCall: true }),
    R('staff', 'School staff', 'School staff', { staff: true, rollcall: true }),
  ],
  hotel: [
    R('guest', 'Guest', 'Guests'),
    R('front_desk', 'Front desk', 'Front desk', { staff: true, responds: ['security', 'other'] }),
    R('housekeeping', 'Housekeeping', 'Housekeeping', { staff: true }),
    R('maintenance', 'Maintenance', 'Maintenance', { staff: true }),
    R('duty_manager', 'Duty manager', 'Duty managers', { staff: true, responds: ALL_ALERTS, onCall: true, rollcall: true }),
  ],
  industrial: [
    R('employee', 'Employee', 'Employees'),
    R('supervisor', 'Supervisor', 'Supervisors', { staff: true, responds: ALL_ALERTS, scoped: true, assignable: true, rollcall: true }),
    R('safety_officer', 'Safety officer', 'Safety officers', { staff: true, responds: ALL_ALERTS, onCall: true, rollcall: true }),
    R('first_aider', 'First aider', 'First aiders', { staff: true, responds: ['medical'], onCall: true }),
  ],
};

// Member-only features staff roles don't get (a porter, teacher, doctor or
// housekeeper doesn't pay student fees / patient bills, add family, or sell
// on the members' marketplace). Enforced in middleware/auth and hidden in
// the apps; staff are also never billed.
const STAFF_HIDDEN_MODULES = ['payments', 'household', 'marketplace'];
const hiddenModulesFor = (user, type) => (roleDef(type, user?.siteRole).staff ? STAFF_HIDDEN_MODULES : []);

// What the onboarding form asks for each role (the apps render it):
//   unit        — label of the unit picker ('' = no unit needed)
//   stay        — ask for stay / admission dates
//   id / group  — labels for memberProfile.idNumber / className ('' = hide)
//   specialty   — label for roleInfo.specialty ('' = hide)
//   shift, onCall, assign (assigned staff), kin (next of kin / parent / companion)
//   emailOptional — can be added without an app login (e.g. a patient whose
//                   next of kin uses the app; a young pupil whose parents do)
const F = (o) => ({ unit: '', stay: false, id: '', group: '', specialty: '', shift: false, onCall: false, assign: false, kin: false, kinLabel: '', emailOptional: false, ...o });
const FORMS = {
  estate:     { resident: F({ unit: 'Apartment', kin: true, kinLabel: 'Family member' }) },
  hospital: {
    patient: F({ unit: 'Ward & bed', stay: true, id: 'Patient / hospital no.', assign: true, kin: true, kinLabel: 'Next of kin', emailOptional: true }),
    doctor:  F({ unit: 'Ward or department they work in', id: 'Staff ID', specialty: 'Specialty', shift: true, onCall: true }),
    nurse:   F({ unit: 'Ward they work in', id: 'Staff ID', shift: true, onCall: true }),
    staff:   F({ unit: 'Department', id: 'Staff ID', specialty: 'Job title', shift: true }),
  },
  university: {
    student:  F({ unit: 'Hall & room', stay: true, id: 'Matric number', group: 'Department & level', assign: true, kin: true, kinLabel: 'Parent / guardian' }),
    lecturer: F({ unit: 'Department / office', id: 'Staff ID', specialty: 'Department / course' }),
    warden:   F({ unit: 'Hall they cover', id: 'Staff ID', shift: true }),
    clinic:   F({ unit: 'Clinic', id: 'Staff ID', specialty: 'Role (doctor, nurse…)', shift: true, onCall: true }),
    staff:    F({ unit: 'Office', id: 'Staff ID', specialty: 'Job title', shift: true }),
  },
  school: {
    student: F({ unit: 'Class', id: 'Admission number', group: 'Arm / house', assign: true, kin: true, kinLabel: 'Parent / guardian', emailOptional: true }),
    teacher: F({ unit: 'Class they teach (form class)', id: 'Staff ID', specialty: 'Subject' }),
    nurse:   F({ unit: 'Sick bay', id: 'Staff ID', shift: true, onCall: true }),
    staff:   F({ unit: 'Office', id: 'Staff ID', specialty: 'Job title', shift: true }),
  },
  hotel: {
    guest:        F({ unit: 'Room', stay: true, kin: true, kinLabel: 'Companion' }),
    front_desk:   F({ unit: 'Desk / post', id: 'Staff ID', shift: true }),
    housekeeping: F({ unit: 'Floor / section', id: 'Staff ID', shift: true }),
    maintenance:  F({ unit: 'Workshop', id: 'Staff ID', specialty: 'Trade (electrical, plumbing…)', shift: true }),
    duty_manager: F({ unit: 'Office', id: 'Staff ID', shift: true, onCall: true }),
  },
  industrial: {
    employee:       F({ unit: 'Department', id: 'Staff ID', specialty: 'Job title', shift: true, assign: true }),
    supervisor:     F({ unit: 'Department they supervise', id: 'Staff ID', shift: true }),
    safety_officer: F({ unit: 'Office', id: 'Staff ID', shift: true, onCall: true }),
    first_aider:    F({ unit: 'Department', id: 'Staff ID', shift: true, onCall: true }),
  },
};

// What a member's assigned people are called
const ASSIGN_LABEL = {
  estate: '', hospital: 'Care team', university: 'Adviser & warden', school: 'Class teacher',
  hotel: '', industrial: 'Supervisor',
};

// Requests members can send, per type, and which roles receive them.
// `managers: true` goes to the site's managers. A member's own assigned
// staff with a matching role (their doctor, their supervisor) get it first.
const REQUEST_KINDS = {
  estate: [],
  hospital: [
    { key: 'call_nurse',  label: 'Call a nurse',        roles: ['nurse'],  urgent: true },
    { key: 'call_doctor', label: 'Call a doctor',       roles: ['doctor'], urgent: true },
    { key: 'assistance',  label: 'Help with something', roles: ['nurse'] },
    { key: 'meal',        label: 'Food & drink',        roles: ['staff'] },
    { key: 'management',  label: 'Hospital management', roles: [], managers: true },
    { key: 'other',       label: 'Something else',      roles: ['staff', 'nurse'] },
  ],
  university: [
    { key: 'hostel_repair', label: 'Hostel repair',      roles: ['warden'] },
    { key: 'clinic',        label: 'See the clinic',     roles: ['clinic'] },
    { key: 'other',         label: 'Ask the hall office', roles: ['warden'] },
    { key: 'management',    label: 'Student affairs',     roles: [], managers: true },
  ],
  school: [
    { key: 'sick_bay', label: 'Sick bay',             roles: ['nurse'], urgent: true },
    { key: 'teacher',  label: 'Message the teacher',  roles: ['teacher'] },
    { key: 'other',    label: 'School office',        roles: ['staff'] },
    { key: 'management', label: 'School management',  roles: [], managers: true },
  ],
  hotel: [
    { key: 'housekeeping', label: 'Housekeeping',  roles: ['housekeeping'] },
    { key: 'maintenance',  label: 'Repairs',       roles: ['maintenance'] },
    { key: 'room_service', label: 'Room service',  roles: ['front_desk'] },
    { key: 'concierge',    label: 'Concierge',     roles: ['front_desk'] },
    { key: 'other',        label: 'Something else', roles: ['front_desk', 'duty_manager'] },
    { key: 'management',   label: 'Hotel management', roles: [], managers: true },
  ],
  industrial: [
    { key: 'incident',  label: 'Report an injury or incident', roles: ['supervisor', 'safety_officer', 'first_aider'], urgent: true },
    { key: 'hazard',    label: 'Report a hazard',               roles: ['safety_officer', 'supervisor'] },
    { key: 'equipment', label: 'Equipment fault',               roles: ['supervisor'] },
    { key: 'management', label: 'Site management',              roles: [], managers: true },
  ],
};

const { normType } = require('./siteTypes');

const rolesFor = (type) => ROLES[normType(type)] || ROLES.estate;
const defaultRole = (type) => rolesFor(type)[0].key;
const roleDef = (type, key) => rolesFor(type).find(r => r.key === key) || rolesFor(type)[0];
// A member's role on this site (unknown / unset → the type's default role)
const roleOf = (user, type) => roleDef(type, user?.siteRole).key;
const isStaff = (user, type) => roleDef(type, user?.siteRole).staff;
const requestKind = (type, key) => (REQUEST_KINDS[normType(type)] || []).find(k => k.key === key);

// Label for anyone on a site: guards are Security, managers the site's
// manager word (Administrator / Front desk…), members their site role.
function roleLabelFor(user, type) {
  if (user?.role === 'security') return 'Security';
  if (user?.role === 'estate_manager' || user?.role === 'super_admin') return require('./siteTypes').TERMS[normType(type)].manager;
  return roleDef(type, user?.siteRole).label;
}

// Config for the apps
function rolesConfig(type) {
  const t = normType(type);
  return {
    roles: rolesFor(t).map(r => ({ ...r, form: (FORMS[t] || {})[r.key] || F({ unit: 'Unit' }), hide: r.staff ? STAFF_HIDDEN_MODULES : [] })),
    defaultRole: defaultRole(t),
    assignLabel: ASSIGN_LABEL[t] || '',
    requestKinds: REQUEST_KINDS[t] || [],
  };
}

module.exports = { STAFF_HIDDEN_MODULES, hiddenModulesFor, roleLabelFor, FORMS, ROLES, ASSIGN_LABEL, REQUEST_KINDS, rolesFor, defaultRole, roleDef, roleOf, isStaff, requestKind, rolesConfig };
