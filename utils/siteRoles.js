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

// What a member's assigned people are called
const ASSIGN_LABEL = {
  estate: '', hospital: 'Care team', university: 'Adviser & warden', school: 'Class teacher',
  hotel: '', industrial: 'Supervisor',
};

// Requests members can send, per type, and which roles receive them.
const REQUEST_KINDS = {
  estate: [],
  hospital: [
    { key: 'call_nurse', label: 'Call a nurse',        roles: ['nurse'],  urgent: true },
    { key: 'assistance', label: 'Help with something', roles: ['nurse'] },
    { key: 'meal',       label: 'Food & drink',        roles: ['staff'] },
    { key: 'other',      label: 'Something else',      roles: ['staff', 'nurse'] },
  ],
  university: [
    { key: 'hostel_repair', label: 'Hostel repair',      roles: ['warden'] },
    { key: 'clinic',        label: 'See the clinic',     roles: ['clinic'] },
    { key: 'other',         label: 'Ask the hall office', roles: ['warden'] },
  ],
  school: [
    { key: 'sick_bay', label: 'Sick bay',             roles: ['nurse'], urgent: true },
    { key: 'teacher',  label: 'Message the teacher',  roles: ['teacher'] },
    { key: 'other',    label: 'School office',        roles: ['staff'] },
  ],
  hotel: [
    { key: 'housekeeping', label: 'Housekeeping',  roles: ['housekeeping'] },
    { key: 'maintenance',  label: 'Repairs',       roles: ['maintenance'] },
    { key: 'room_service', label: 'Room service',  roles: ['front_desk'] },
    { key: 'concierge',    label: 'Concierge',     roles: ['front_desk'] },
    { key: 'other',        label: 'Something else', roles: ['front_desk', 'duty_manager'] },
  ],
  industrial: [
    { key: 'incident',  label: 'Report an injury or incident', roles: ['supervisor', 'safety_officer', 'first_aider'], urgent: true },
    { key: 'hazard',    label: 'Report a hazard',               roles: ['safety_officer', 'supervisor'] },
    { key: 'equipment', label: 'Equipment fault',               roles: ['supervisor'] },
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

// Config for the apps
function rolesConfig(type) {
  const t = normType(type);
  return {
    roles: rolesFor(t),
    defaultRole: defaultRole(t),
    assignLabel: ASSIGN_LABEL[t] || '',
    requestKinds: REQUEST_KINDS[t] || [],
  };
}

module.exports = { ROLES, ASSIGN_LABEL, REQUEST_KINDS, rolesFor, defaultRole, roleDef, roleOf, isStaff, requestKind, rolesConfig };
