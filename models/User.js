const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  role: {
    type: String,
    enum: ['super_admin', 'estate_manager', 'resident', 'security'],
    default: 'resident',
  },
  estateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Estate' },
  managedEstates: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Estate' }],
  // Estate manager teams: 'owner' = full access (every manager before teams);
  // 'member' = invited teammate limited to `permissions` (utils/teamAccess AREAS).
  teamRole:    { type: String, enum: ['owner', 'member'], default: 'owner' },
  permissions: { type: [String], default: [] },
  invitedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit' },

  // Households: the resident the estate manager onboards is the household head
  // ('primary'). They can add family members ('member'), who share the head's
  // unit, are never billed, follow the head's dues status, and only reach the
  // features in `householdPermissions` (utils/householdAccess PERMISSIONS).
  householdRole:        { type: String, enum: ['primary', 'member'], default: 'primary' },
  householdHead:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  relationship:         { type: String, default: '' },
  householdPermissions: { type: [String], default: [] },
  // 'pending' = the head asked to add this person and the estate requires
  // manager approval (estate.settings.householdApproval). Pending accounts have
  // no estate/unit and can't sign in until approved; 'rejected' = declined.
  householdStatus:      { type: String, enum: ['active', 'pending', 'rejected'], default: 'active' },
  requestedEstateId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Estate', default: null },
  // Hotels (site module 'stays'): a guest can sign in from checkIn until
  // checkOut; at check-out their access ends and the room is freed.
  stay: {
    checkIn:  { type: Date, default: null },
    checkOut: { type: Date, default: null },
    status:   { type: String, enum: ['none', 'upcoming', 'in_house', 'checked_out'], default: 'none' },
    roomId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null }, // kept after check-out
  },
  // Schools / industry / hospitals (site module 'shifts'): working hours the
  // gate can check. days: 0 = Sunday … 6 = Saturday.
  shift: {
    start: { type: String, default: '' }, // HH:MM
    end:   { type: String, default: '' },
    days:  { type: [Number], default: [] },
  },
  // Role inside the site (utils/siteRoles): patient, doctor, nurse, student,
  // lecturer, warden, guest, housekeeping, employee, supervisor… Empty = the
  // site type's default member role.
  siteRole: { type: String, default: '' },
  roleInfo: {
    specialty:   { type: String, default: '' },   // e.g. Cardiology, Mathematics
    onCall:      { type: Boolean, default: false },
    onCallSince: { type: Date, default: null },
  },
  // Who looks after this member: a patient's doctor and nurse, a student's
  // adviser and warden, an employee's supervisor (staff accounts).
  assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Free-text profile bits per sector: staff ID, job title, a student's class.
  memberProfile: {
    idNumber: { type: String, default: '' },
    title:    { type: String, default: '' },
    className:{ type: String, default: '' },
  },
  profilePhoto: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  isDiscoverable: { type: Boolean, default: true },
  refreshToken: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now },
  walletBalance: { type: Number, default: 0 },
  // Prepaid credits for resident-to-resident calls (bought from AreaConnect).
  // Only ever changed through utils/credits.js so every change is ledgered.
  callCredits: { type: Number, default: 0, min: 0 },
  paystackRecipientCode: { type: String, default: null },
  bankCode: { type: String, default: '' },
  bankName: { type: String, default: '' },
  accountNumber: { type: String, default: '' },
  accountName: { type: String, default: '' },

  // Flipped true when an admin issues a temp password (invite or an approved
  // reset). Login still works, but the client should force a change-password
  // step before anything else.
  mustChangePassword: { type: Boolean, default: false },

  // Dues enforcement (utils/duesEnforcement). 'notice' = warned, nothing
  // restricted yet; 'active' = the listed services are paused until the
  // resident clears their overdue bills (lifted automatically on payment).
  duesRestriction: {
    status:      { type: String, enum: ['none', 'notice', 'active'], default: 'none' },
    services:    { type: [String], default: [] },
    amountOwed:  { type: Number, default: 0 },
    noticeAt:    { type: Date, default: null },
    effectiveAt: { type: Date, default: null },
    appliedAt:   { type: Date, default: null },
    note:        { type: String, default: '' },
    dispute:     { message: { type: String, default: '' }, at: { type: Date, default: null } },
  },
}, { timestamps: true });

userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.refreshToken;
  return obj;
};


// Lookups by estate are on nearly every request (lists, routing, counts)
userSchema.index({ estateId: 1, role: 1, name: 1 });
userSchema.index({ estateId: 1, siteRole: 1, isActive: 1 });
userSchema.index({ managedEstates: 1 });
userSchema.index({ assignedTo: 1 });
userSchema.index({ unitId: 1 });
userSchema.index({ householdHead: 1, householdRole: 1 });
userSchema.index({ requestedEstateId: 1, householdStatus: 1 });
userSchema.index({ 'stay.status': 1, 'stay.checkOut': 1 });
userSchema.index({ 'stay.status': 1, 'stay.checkIn': 1 });

// Keep the auth cache (utils/authCache) in step with writes
const bust = () => require('../utils/authCache');
userSchema.post('save', (doc) => bust().bustUser(doc._id));
userSchema.post(['updateOne', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne'], function () {
  const id = this.getFilter?.()?._id;
  if (id?.$in) id.$in.forEach((x) => bust().bustUser(x));
  else if (id) bust().bustUser(id);
  else bust().bustAllUsers();
});
userSchema.post(['updateMany', 'deleteMany'], () => bust().bustAllUsers());

module.exports = mongoose.model('User', userSchema);
