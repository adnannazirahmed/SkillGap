-- ══════════════════════════════════════════════
-- SkillGap Analyzer – Supabase Schema
-- Run this in the Supabase SQL Editor
-- ══════════════════════════════════════════════

-- Auth users (credentials + metadata)
CREATE TABLE IF NOT EXISTS auth_users (
  email            TEXT PRIMARY KEY,
  name             TEXT NOT NULL DEFAULT '',
  role             TEXT NOT NULL DEFAULT 'scholar',
  provider         TEXT NOT NULL DEFAULT 'local',
  password_hash    TEXT,
  salt             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  last_login_at    TIMESTAMPTZ DEFAULT NOW()
);

-- User profiles (public-facing data)
CREATE TABLE IF NOT EXISTS profiles (
  user_id     TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT DEFAULT '',
  title       TEXT DEFAULT 'Aspiring Data Professional',
  bio         TEXT DEFAULT '',
  location    TEXT DEFAULT '',
  skills      JSONB DEFAULT '[]'::jsonb,
  experience  JSONB DEFAULT '[]'::jsonb,
  education   JSONB DEFAULT '[]'::jsonb,
  documents   JSONB DEFAULT '[]'::jsonb,
  social      JSONB DEFAULT '{"linkedin":"","github":"","portfolio":""}'::jsonb,
  role        TEXT DEFAULT 'scholar',
  provider    TEXT DEFAULT 'local',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Assessment history (one row per completed assessment)
CREATE TABLE IF NOT EXISTS assessment_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT NOT NULL,
  skill       TEXT NOT NULL,
  score       NUMERIC NOT NULL,
  skill_level TEXT,
  accuracy    NUMERIC,
  duration    INTEGER,
  breakdown   JSONB DEFAULT '[]'::jsonb,
  timestamp   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_user ON assessment_history(user_id);
CREATE INDEX IF NOT EXISTS idx_assessment_skill ON assessment_history(skill);

-- Peer coaches
CREATE TABLE IF NOT EXISTS peer_coaches (
  user_id         TEXT PRIMARY KEY,
  name            TEXT DEFAULT '',
  avatar          TEXT DEFAULT '',
  skills_offered  JSONB DEFAULT '[]'::jsonb,
  headline        TEXT DEFAULT '',
  bio             TEXT DEFAULT '',
  verified_skills JSONB DEFAULT '[]'::jsonb,
  session_lengths JSONB DEFAULT '[15, 20]'::jsonb,
  active          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Peer session bookings
CREATE TABLE IF NOT EXISTS peer_bookings (
  id               TEXT PRIMARY KEY,
  skill            TEXT NOT NULL,
  coach_user_id    TEXT NOT NULL,
  learner_user_id  TEXT NOT NULL,
  status           TEXT DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','completed','cancelled')),
  scheduled_at     TEXT,
  duration         INTEGER DEFAULT 20,
  goal             TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_coach   ON peer_bookings(coach_user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_learner ON peer_bookings(learner_user_id);

-- Peer session reviews
CREATE TABLE IF NOT EXISTS peer_reviews (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id       TEXT NOT NULL,
  coach_user_id    TEXT NOT NULL,
  learner_user_id  TEXT NOT NULL,
  rating           INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback         TEXT DEFAULT '',
  would_recommend  BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Storage ──
-- In the Supabase dashboard → Storage, create a public bucket named: documents
-- (this cannot be done via SQL)
