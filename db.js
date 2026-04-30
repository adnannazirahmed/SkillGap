'use strict';
// ══════════════════════════════════════════════
// db.js – Supabase data access layer
// All functions are async and map between the app's camelCase format
// and Supabase's snake_case column names.
// ══════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY env vars are required');
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

// ──────────────────────────────────────────────
// ASSESSMENT HISTORY
// ──────────────────────────────────────────────
async function getHistoryForUser(userId) {
  const { data, error } = await getClient()
    .from('assessment_history')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToHistory);
}

async function getAllHistory() {
  const { data, error } = await getClient()
    .from('assessment_history')
    .select('*')
    .order('timestamp', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToHistory);
}

async function insertHistory(userId, result) {
  const { error } = await getClient()
    .from('assessment_history')
    .insert({
      user_id: userId || 'anonymous',
      skill: result.skill,
      score: result.finalScore,
      skill_level: result.skillLevel,
      accuracy: result.accuracy,
      duration: result.duration,
      breakdown: result.breakdown || [],
      timestamp: new Date().toISOString()
    });
  if (error) throw error;
}

function rowToHistory(row) {
  return {
    userId: row.user_id,
    skill: row.skill,
    score: row.score,
    skillLevel: row.skill_level,
    accuracy: row.accuracy,
    duration: row.duration,
    timestamp: row.timestamp,
    breakdown: row.breakdown || []
  };
}

// ──────────────────────────────────────────────
// AUTH USERS
// ──────────────────────────────────────────────
async function getAuthUser(email) {
  const { data, error } = await getClient()
    .from('auth_users')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToAuthUser(data) : null;
}

async function upsertAuthUser(email, fields) {
  const row = { email };
  if (fields.name        !== undefined) row.name          = fields.name;
  if (fields.role        !== undefined) row.role          = fields.role;
  if (fields.provider    !== undefined) row.provider      = fields.provider;
  if (fields.salt        !== undefined) row.salt          = fields.salt;
  if (fields.passwordHash !== undefined) row.password_hash = fields.passwordHash;
  if (fields.createdAt   !== undefined) row.created_at    = fields.createdAt;
  if (fields.updatedAt   !== undefined) row.updated_at    = fields.updatedAt;
  if (fields.lastLoginAt !== undefined) row.last_login_at = fields.lastLoginAt;

  const { data, error } = await getClient()
    .from('auth_users')
    .upsert(row, { onConflict: 'email' })
    .select()
    .single();
  if (error) throw error;
  return rowToAuthUser(data);
}

function rowToAuthUser(row) {
  if (!row) return null;
  return {
    email:        row.email,
    name:         row.name,
    role:         row.role,
    provider:     row.provider,
    salt:         row.salt,
    passwordHash: row.password_hash,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
    lastLoginAt:  row.last_login_at
  };
}

// ──────────────────────────────────────────────
// PROFILES
// ──────────────────────────────────────────────
async function getProfile(userId) {
  const { data, error } = await getClient()
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProfile(data) : null;
}

async function getAllProfiles() {
  const { data, error } = await getClient()
    .from('profiles')
    .select('*');
  if (error) throw error;
  const result = {};
  (data || []).forEach(row => { result[row.user_id] = rowToProfile(row); });
  return result;
}

async function upsertProfile(userId, profile) {
  const row = {
    user_id:    userId,
    email:      profile.email    || userId,
    name:       profile.name     || '',
    title:      profile.title    || 'Aspiring Data Professional',
    bio:        profile.bio      || '',
    location:   profile.location || '',
    skills:     profile.skills     || [],
    experience: profile.experience || [],
    education:  profile.education  || [],
    documents:  profile.documents  || [],
    social:     profile.social     || { linkedin: '', github: '', portfolio: '' },
    role:       profile.role     || 'scholar',
    provider:   profile.provider || 'local',
    analyzer_reports: profile.analyzerReports || [],
    created_at: profile.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  let { data, error } = await getClient()
    .from('profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single();

  // Fallback for installs that haven't run the analyzer_reports migration yet.
  // Supabase/PostgREST returns PGRST204 (or PG 42703) when the column is missing.
  // We retry without the column so signup/login still works, but we annotate
  // the result so callers can warn the user that data was silently dropped.
  let droppedColumns = [];
  if (error && (error.code === 'PGRST204' || error.code === '42703' ||
                /analyzer_reports/i.test(error.message || ''))) {
    console.warn('upsertProfile: analyzer_reports column missing, retrying without it. Run: ALTER TABLE profiles ADD COLUMN IF NOT EXISTS analyzer_reports JSONB DEFAULT \'[]\'::jsonb;');
    droppedColumns.push('analyzerReports');
    const { analyzer_reports, ...rowSansReports } = row;
    ({ data, error } = await getClient()
      .from('profiles')
      .upsert(rowSansReports, { onConflict: 'user_id' })
      .select()
      .single());
  }

  if (error) throw error;
  const result = rowToProfile(data);
  if (droppedColumns.length > 0) {
    Object.defineProperty(result, '_droppedColumns', { value: droppedColumns, enumerable: false });
  }
  return result;
}

function rowToProfile(row) {
  if (!row) return null;
  return {
    userId:     row.user_id,
    email:      row.email,
    name:       row.name,
    title:      row.title,
    bio:        row.bio,
    location:   row.location,
    skills:     row.skills     || [],
    experience: row.experience || [],
    education:  row.education  || [],
    documents:  row.documents  || [],
    social:     row.social     || { linkedin: '', github: '', portfolio: '' },
    role:       row.role,
    provider:   row.provider,
    analyzerReports: row.analyzer_reports || [],
    createdAt:  row.created_at,
    updatedAt:  row.updated_at
  };
}

// ──────────────────────────────────────────────
// PEER COACHES
// ──────────────────────────────────────────────
async function getAllCoaches() {
  const { data, error } = await getClient()
    .from('peer_coaches')
    .select('*');
  if (error) throw error;
  const result = {};
  (data || []).forEach(row => { result[row.user_id] = rowToCoach(row); });
  return result;
}

async function getCoach(userId) {
  const { data, error } = await getClient()
    .from('peer_coaches')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToCoach(data) : null;
}

async function upsertCoach(userId, coach) {
  const row = {
    user_id:        userId,
    name:           coach.name           || '',
    avatar:         coach.avatar         || '',
    skills_offered: coach.skillsOffered  || [],
    headline:       coach.headline       || '',
    bio:            coach.bio            || '',
    verified_skills: coach.verifiedSkills || [],
    session_lengths: coach.sessionLengths || [],
    active:         coach.active !== undefined ? coach.active : true,
    created_at:     coach.createdAt || new Date().toISOString(),
    updated_at:     new Date().toISOString()
  };
  const { data, error } = await getClient()
    .from('peer_coaches')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return rowToCoach(data);
}

function rowToCoach(row) {
  return {
    userId:         row.user_id,
    name:           row.name,
    avatar:         row.avatar,
    skillsOffered:  row.skills_offered  || [],
    headline:       row.headline,
    bio:            row.bio,
    verifiedSkills: row.verified_skills || [],
    sessionLengths: row.session_lengths || [],
    active:         row.active,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at
  };
}

// ──────────────────────────────────────────────
// PEER BOOKINGS
// ──────────────────────────────────────────────
async function getAllBookings() {
  const { data, error } = await getClient()
    .from('peer_bookings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToBooking);
}

async function getBookingById(id) {
  const { data, error } = await getClient()
    .from('peer_bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToBooking(data) : null;
}

async function insertBooking(booking) {
  const { data, error } = await getClient()
    .from('peer_bookings')
    .insert({
      id:              booking.id,
      skill:           booking.skill,
      coach_user_id:   booking.coachUserId,
      learner_user_id: booking.learnerUserId,
      status:          booking.status    || 'pending',
      scheduled_at:    booking.scheduledAt || null,
      duration:        booking.duration  || 20,
      goal:            booking.goal      || '',
      created_at:      booking.createdAt || new Date().toISOString(),
      updated_at:      new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return rowToBooking(data);
}

async function updateBooking(id, updates) {
  const row = { updated_at: new Date().toISOString() };
  if (updates.status      !== undefined) row.status       = updates.status;
  if (updates.scheduledAt !== undefined) row.scheduled_at = updates.scheduledAt;
  if (updates.goal        !== undefined) row.goal         = updates.goal;

  const { data, error } = await getClient()
    .from('peer_bookings')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToBooking(data);
}

function rowToBooking(row) {
  return {
    id:           row.id,
    skill:        row.skill,
    coachUserId:  row.coach_user_id,
    learnerUserId: row.learner_user_id,
    status:       row.status,
    scheduledAt:  row.scheduled_at,
    duration:     row.duration,
    goal:         row.goal,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at
  };
}

// ──────────────────────────────────────────────
// PEER REVIEWS
// ──────────────────────────────────────────────
async function getAllReviews() {
  const { data, error } = await getClient()
    .from('peer_reviews')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToReview);
}

async function insertReview(review) {
  const { error } = await getClient()
    .from('peer_reviews')
    .insert({
      booking_id:      review.bookingId,
      coach_user_id:   review.coachUserId,
      learner_user_id: review.learnerUserId,
      rating:          review.rating,
      feedback:        review.feedback        || '',
      would_recommend: review.wouldRecommend !== false,
      created_at:      review.createdAt      || new Date().toISOString()
    });
  if (error) throw error;
}

function rowToReview(row) {
  return {
    bookingId:      row.booking_id,
    coachUserId:    row.coach_user_id,
    learnerUserId:  row.learner_user_id,
    rating:         row.rating,
    feedback:       row.feedback,
    wouldRecommend: row.would_recommend,
    createdAt:      row.created_at
  };
}

// ──────────────────────────────────────────────
// STORAGE – Document uploads
// ──────────────────────────────────────────────
async function uploadDocument(userId, docId, filename, buffer, mimetype) {
  const filePath = `${userId}/${docId}-${filename}`;
  const { error } = await getClient()
    .storage
    .from('documents')
    .upload(filePath, buffer, { contentType: mimetype, upsert: true });
  if (error) throw error;
  const { data } = getClient().storage.from('documents').getPublicUrl(filePath);
  return { filePath, publicUrl: data.publicUrl };
}

async function deleteDocument(filePath) {
  const { error } = await getClient()
    .storage
    .from('documents')
    .remove([filePath]);
  if (error) throw error;
}

// ──────────────────────────────────────────────
// CHAT MESSAGES
// ──────────────────────────────────────────────
async function getChatMessages(bookingId) {
  const { data, error } = await getClient()
    .from('chat_messages')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToMessage);
}

async function insertChatMessage(bookingId, senderId, content) {
  const { data, error } = await getClient()
    .from('chat_messages')
    .insert({ booking_id: bookingId, sender_id: senderId, content })
    .select()
    .single();
  if (error) throw error;
  return rowToMessage(data);
}

// Returns ALL inquiry-thread messages (booking_id like 'inquiry__%').
// Caller filters to threads where the user is a participant; volume here is small.
async function getAllInquiryMessages() {
  const { data, error } = await getClient()
    .from('chat_messages')
    .select('*')
    .like('booking_id', 'inquiry__%')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToMessage);
}

function rowToMessage(row) {
  return {
    id:        row.id,
    bookingId: row.booking_id,
    senderId:  row.sender_id,
    content:   row.content,
    createdAt: row.created_at
  };
}

// ──────────────────────────────────────────────
// JOB APPLICATION TRACKER
// ──────────────────────────────────────────────
async function getJobApplications(userId) {
  const { data, error } = await getClient()
    .from('job_applications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToJobApp);
}

async function insertJobApplication(userId, job) {
  const { data, error } = await getClient()
    .from('job_applications')
    .insert({
      user_id:    userId,
      job_title:  job.jobTitle  || '',
      company:    job.company   || '',
      location:   job.location  || '',
      url:        job.url       || '',
      status:     job.status    || 'saved',
      notes:      job.notes     || '',
      applied_at: job.status === 'applied' ? new Date().toISOString() : null,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return rowToJobApp(data);
}

async function updateJobApplication(id, userId, updates) {
  const row = {};
  if (updates.status !== undefined) {
    row.status = updates.status;
    if (updates.status === 'applied' && updates.appliedAt === undefined) {
      row.applied_at = new Date().toISOString();
    }
  }
  if (updates.notes      !== undefined) row.notes      = updates.notes;
  if (updates.appliedAt  !== undefined) row.applied_at = updates.appliedAt;

  const { data, error } = await getClient()
    .from('job_applications')
    .update(row)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return rowToJobApp(data);
}

async function deleteJobApplication(id, userId) {
  const { error } = await getClient()
    .from('job_applications')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

function rowToJobApp(row) {
  return {
    id:        row.id,
    userId:    row.user_id,
    jobTitle:  row.job_title,
    company:   row.company,
    location:  row.location,
    url:       row.url,
    status:    row.status,
    notes:     row.notes,
    appliedAt: row.applied_at,
    createdAt: row.created_at
  };
}

// ──────────────────────────────────────────────
// CERTIFICATES
// ──────────────────────────────────────────────
async function insertCertificate(userId, userName, skill, score) {
  const { data, error } = await getClient()
    .from('certificates')
    .insert({
      user_id:   userId,
      user_name: userName || userId,
      skill:     skill,
      score:     score,
      issued_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return rowToCertificate(data);
}

async function getCertificate(id) {
  const { data, error } = await getClient()
    .from('certificates')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToCertificate(data) : null;
}

function rowToCertificate(row) {
  return {
    id:       row.id,
    userId:   row.user_id,
    userName: row.user_name,
    skill:    row.skill,
    score:    row.score,
    issuedAt: row.issued_at
  };
}

module.exports = {
  getHistoryForUser,
  getAllHistory,
  insertHistory,
  getAuthUser,
  upsertAuthUser,
  getProfile,
  getAllProfiles,
  upsertProfile,
  getAllCoaches,
  getCoach,
  upsertCoach,
  getAllBookings,
  getBookingById,
  insertBooking,
  updateBooking,
  getAllReviews,
  insertReview,
  uploadDocument,
  deleteDocument,
  getChatMessages,
  insertChatMessage,
  getAllInquiryMessages,
  getJobApplications,
  insertJobApplication,
  updateJobApplication,
  deleteJobApplication,
  insertCertificate,
  getCertificate
};
