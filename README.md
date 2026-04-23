<div align="center">

```
 ____  _    _ _ _  ____
/ ___|| | _(_) | |/ ___|  __ _ _ __
\___ \| |/ / | | | |  _ / _` | '_ \
 ___) |   <| | | | |_| | (_| | |_) |
|____/|_|\_\_|_|_|\____|\__,_| .__/
                               |_|
```

# SkillGap Analyzer

**Career Intelligence Platform — Know Where You Stand. Know Where to Go.**

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Render](https://img.shields.io/badge/Deployed_on-Render-46E3B7?style=flat-square&logo=render&logoColor=white)](https://render.com)
[![Gemini AI](https://img.shields.io/badge/AI-Gemini_API-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

</div>

---

## What is SkillGap?

SkillGap Analyzer is a full-stack career intelligence web app that helps students and early-career professionals **identify skill gaps, benchmark their knowledge, and build a clear path to their dream role.**

It combines adaptive skill assessments, AI-driven gap analysis, live job listings, peer coaching with real-time chat, and personalized learning roadmaps — all in one platform.

---

## Features

| Module | What it does |
|---|---|
| 🎯 **Skill Assessments** | 12-question adaptive quizzes (IRT algorithm) across 10 technical domains. Scored out of 10 with ability trajectory tracking. |
| 🤖 **AI Resume Analyzer** | Upload a resume (PDF/DOCX) and a target role — Gemini AI identifies your skill gaps and ranks priorities. |
| 🗺️ **Learning Roadmap** | Skill-specific paths from beginner to mastery. Each milestone links directly to curated courses, docs, and YouTube resources. |
| 💼 **Job Discovery** | Live listings via Adzuna API + one-click search on Google Jobs, Indeed, Glassdoor, Wellfound, and Remotive. |
| 🤝 **Peer Coaching** | Score 8+ on an assessment → become a verified coach. Learners book sessions, both sides rate and review. Built-in chat per session. |
| 👤 **Profile & Portfolio** | Public profile with skills, experience, education, document uploads (Supabase Storage), and GitHub/portfolio links. |
| 📊 **Dashboard** | Skill matrix heatmap, milestone tracker, trending skills feed, and recent job cards — all personalized to your assessment history. |
| 🌙 **Dark Mode** | Full dark/light theme toggle, persisted across sessions. |

---

## Tech Stack

```
Frontend   →  Vanilla HTML + CSS + JavaScript (SPA, no framework)
Backend    →  Node.js + Express.js
Database   →  Supabase (PostgreSQL + Storage)
AI         →  Google Gemini API (adaptive question generation + gap analysis)
Jobs API   →  Adzuna
Auth       →  Email/password (bcrypt) + Google OAuth (via server-side flow)
Hosting    →  Render (web service, free tier)
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Gemini API key](https://ai.google.dev) (optional — enables AI questions)
- An [Adzuna API key](https://developer.adzuna.com) (optional — enables live job listings)

### 1. Clone & Install

```bash
git clone https://github.com/adnannazirahmed/SkillGap.git
cd SkillGap
npm install
```

### 2. Configure Environment

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

```env
PORT=8080

# Supabase (required)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here

# Google Gemini (optional — adaptive questions)
GEMINI_API_KEY=your_gemini_api_key_here

# Adzuna (optional — live job listings)
ADZUNA_APP_ID=your_adzuna_app_id_here
ADZUNA_APP_KEY=your_adzuna_app_key_here

# Demo admin account
DEMO_ADMIN_EMAIL=admin@example.com
DEMO_ADMIN_PASSWORD=yourpassword
DEMO_ADMIN_NAME=Admin Name
```

### 3. Set Up the Database

In your Supabase project → **SQL Editor**, paste and run the contents of [`schema.sql`](schema.sql).

Then go to **Storage** → create a new public bucket named exactly: `documents`

### 4. Run Locally

```bash
npm start
```

Open [http://localhost:8080](http://localhost:8080)

---

## Deploying to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New Web Service → connect your repo
3. Render auto-detects the `render.yaml` config
4. Add your environment variables in the Render dashboard under **Environment**
5. Deploy — it runs `npm install && npm start` automatically

---

## Project Structure

```
SkillGap/
├── server.js          # Express API (auth, assessments, coaching, jobs, analyzer)
├── db.js              # Supabase data access layer (all async CRUD)
├── schema.sql         # PostgreSQL schema — run once in Supabase SQL Editor
├── app.js             # Frontend SPA logic (~3800 lines)
├── index.html         # Main app shell (single-page application)
├── login.html         # Authentication page
├── styles.css         # Complete styling with dark mode
├── render.yaml        # Render deployment config
├── .env.example       # Environment variable template
└── question-banks/    # JSON question banks for each skill domain
    ├── questions-python.json
    ├── questions-sql.json
    ├── questions-javascript.json
    └── ...
```

---

## Skill Domains

The platform currently supports adaptive assessments across:

`Python` · `SQL` · `JavaScript` · `React` · `Machine Learning` · `Data Analysis` · `Statistics` · `Excel` · `Cloud Computing` · `Cybersecurity`

---

## How Peer Coaching Works

```
1. Take a skill assessment
2. Score 8 or higher → automatically verified as a coach for that skill
3. Set up your coach profile (headline, bio, session lengths)
4. Learners discover you and book a session
5. Accept or decline requests from "My Sessions"
6. Chat with your learner directly in the platform
7. Mark the session complete → learner leaves a review
```

---

## License

MIT © [Adnan Nazir](https://github.com/adnannazirahmed)
