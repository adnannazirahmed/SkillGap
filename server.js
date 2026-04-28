// ══════════════════════════════════════════════
// SkillGap Analyzer – Backend Server
// Express + Gemini API + Adaptive IRT Engine
// ══════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const mammoth = require('mammoth');
const rateLimit = require('express-rate-limit');
const pdfParse = require('pdf-parse');
const db = require('./db');

const app = express();
app.use(express.json());

const APP_DIR = __dirname;
const STATIC_DIR = APP_DIR;
const DATA_DIR = path.resolve(process.env.DATA_DIR || APP_DIR);

function cloneFallback(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureSeededDataFile(fileName, fallbackValue) {
  const targetPath = path.join(DATA_DIR, fileName);
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  ensureDirectoryExists(DATA_DIR);

  const sourcePath = path.join(APP_DIR, fileName);
  if (sourcePath !== targetPath && fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
  } else {
    fs.writeFileSync(targetPath, JSON.stringify(fallbackValue, null, 2), 'utf8');
  }

  return targetPath;
}

function readJSONFile(filePath, fallbackValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${path.basename(filePath)}:`, err.message);
  }
  return cloneFallback(fallbackValue);
}

function writeJSONFile(filePath, data) {
  ensureDirectoryExists(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ── CORS Headers ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ── Rate Limiting ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes before trying again.' }
});

// ── Auth Token Store ──
// Maps token -> { userId, createdAt }
const authTokens = {};
const AUTH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Clean up expired auth tokens every hour
setInterval(() => {
  const now = Date.now();
  for (const token of Object.keys(authTokens)) {
    if (now - authTokens[token].createdAt > AUTH_TOKEN_MAX_AGE_MS) {
      delete authTokens[token];
    }
  }
}, 60 * 60 * 1000);

function generateAuthToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  authTokens[token] = { userId, createdAt: Date.now() };
  return token;
}

function verifyAuthToken(token) {
  const record = authTokens[token];
  if (!record) return null;
  if (Date.now() - record.createdAt > AUTH_TOKEN_MAX_AGE_MS) {
    delete authTokens[token];
    return null;
  }
  return record.userId;
}

// ── Auth Middleware (applied to protected API routes) ──
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const userId = verifyAuthToken(token);
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  }
  req.authenticatedUserId = userId;
  next();
}

app.use(express.static(STATIC_DIR));

// ── Global API Auth Guard ──
// All /api/ routes require a valid bearer token EXCEPT the whitelist below.
// Paths are relative to /api (the mount point), so /api/auth/login → /auth/login
const AUTH_PUBLIC_ROUTES = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/social',
  '/health',
  '/jobs',
  '/jobs/categories',
  '/news',
  '/skills',
  '/dashboard/leaderboard'
]);

app.use('/api', (req, res, next) => {
  const routePath = req.path;
  if (AUTH_PUBLIC_ROUTES.has(routePath)) return next();
  // Allow serving uploaded documents without auth (linked from profile)
  if (routePath.startsWith('/profile/documents/')) return next();
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  const userId = verifyAuthToken(token);
  if (!userId) return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  req.authenticatedUserId = userId;
  next();
});

// ── Load Question Bank ──
let questionBank = {};

// Step 1: Load main question-bank.json
const mainBankPath = path.join(APP_DIR, 'question-bank.json');
try {
  const mainData = JSON.parse(fs.readFileSync(mainBankPath, 'utf8'));
  if (Array.isArray(mainData)) {
    // Flat array format: group by skill
    mainData.forEach(q => {
      if (!questionBank[q.skill]) questionBank[q.skill] = [];
      questionBank[q.skill].push(q);
    });
  } else {
    // Object keyed by skill name
    questionBank = mainData;
  }
  const totalMain = Object.values(questionBank).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`   Loaded question-bank.json (${totalMain} questions across ${Object.keys(questionBank).length} skills)`);
} catch (err) {
  console.log(`   Failed to load question-bank.json: ${err.message}`);
}

// Step 2: Load supplementary question files and merge
const supplementaryFiles = [
  'questions-sql.json',
  'questions-react.json',
  'questions-statistics.json',
  'questions-cybersecurity.json',
  'questions-data-analysis.json',
  'questions-cloud.json',
  'questions-excel.json',
  'questions-javascript.json'
];

function mergeQuestionsFromArray(questions, sourceName) {
  questions.forEach(q => {
    const skill = q.skill;
    if (!skill) return;
    if (!questionBank[skill]) questionBank[skill] = [];
    const existingIds = new Set(questionBank[skill].map(x => x.id));
    if (!existingIds.has(q.id)) {
      questionBank[skill].push(q);
    }
  });
}

supplementaryFiles.forEach(file => {
  const filePath = path.join(APP_DIR, file);
  if (fs.existsSync(filePath)) {
    try {
      const questions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      mergeQuestionsFromArray(questions, file);
      console.log(`   Loaded ${file}`);
    } catch (e) {
      console.log(`   Failed to load ${file}: ${e.message}`);
    }
  }
});

// Step 3: Load question-banks/ subdirectory (additional curated banks)
const questionBanksDir = path.join(APP_DIR, 'question-banks');
if (fs.existsSync(questionBanksDir)) {
  fs.readdirSync(questionBanksDir).filter(f => f.endsWith('.json')).forEach(file => {
    const filePath = path.join(questionBanksDir, file);
    try {
      const questions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(questions)) {
        mergeQuestionsFromArray(questions, file);
        console.log(`   Loaded question-banks/${file}`);
      }
    } catch (e) {
      console.log(`   Failed to load question-banks/${file}: ${e.message}`);
    }
  });
}

// Log final question bank summary
Object.keys(questionBank).sort().forEach(skill => {
  console.log(`   * ${skill}: ${questionBank[skill].length} questions`);
});

// ── Assessment History (Supabase) ──
// History is now stored in the assessment_history table.
// db.getHistoryForUser(userId) and db.getAllHistory() are used directly in routes.

// ── In-Memory Session Store ──
const sessions = {};

// ── Config ──
const TOTAL_QUESTIONS = 12;
const SEED_QUESTIONS = 3;
const INITIAL_THETA = 5.0;
const INITIAL_STEP = 1.5;
const STEP_DECAY = 0.7;
const MIN_STEP = 0.3;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs';
const DEMO_ADMIN_EMAIL = (process.env.DEMO_ADMIN_EMAIL || 'vkulathunkal@clarku.edu').trim().toLowerCase();
const DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || '12345678';
const DEMO_ADMIN_NAME = process.env.DEMO_ADMIN_NAME || 'Vishnu Kulathunkal';

// ── Session Cleanup (every 10 minutes, removes sessions older than 1 hour) ──
const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const sessionId of Object.keys(sessions)) {
    if (now - sessions[sessionId].startTime > SESSION_MAX_AGE_MS) {
      delete sessions[sessionId];
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`Session cleanup: removed ${cleaned} expired session(s)`);
  }
}, CLEANUP_INTERVAL_MS);

// ── Helper: Generate UUID ──
function uuid() {
  return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

// ── Helper: Clamp ──
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ── Helper: Get skill level label ──
function getSkillLevel(score) {
  if (score <= 2) return 'Beginner';
  if (score <= 4) return 'Elementary';
  if (score <= 6) return 'Intermediate';
  if (score <= 8) return 'Advanced';
  return 'Expert';
}

// ── Helper: Find seed question (with preferredType support) ──
function findSeedQuestion(skill, targetDifficulty, usedIds, preferredType) {
  const bank = questionBank[skill];
  if (!bank || bank.length === 0) return null;

  const TOLERANCE = 1.5; // accept questions within ±1.5 difficulty

  // First pass: match both difficulty and type, randomized
  if (preferredType) {
    const candidates = bank.filter(q =>
      !usedIds.has(q.id) &&
      q.type === preferredType &&
      Math.abs(q.difficulty - targetDifficulty) <= TOLERANCE
    );
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    // Widen: any unused of preferred type, pick closest with random tiebreak
    const wideCandidates = bank.filter(q =>
      !usedIds.has(q.id) && q.type === preferredType
    );
    if (wideCandidates.length > 0) {
      wideCandidates.sort((a, b) => {
        const da = Math.abs(a.difficulty - targetDifficulty);
        const db = Math.abs(b.difficulty - targetDifficulty);
        return da - db || (Math.random() - 0.5);
      });
      return wideCandidates[0];
    }
  }

  // Second pass: any type within tolerance, randomized
  const candidates = bank.filter(q =>
    !usedIds.has(q.id) &&
    Math.abs(q.difficulty - targetDifficulty) <= TOLERANCE
  );
  if (candidates.length > 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Fallback: closest unused with random tiebreak
  const unused = bank.filter(q => !usedIds.has(q.id));
  if (unused.length === 0) return null;
  unused.sort((a, b) => {
    const da = Math.abs(a.difficulty - targetDifficulty);
    const db = Math.abs(b.difficulty - targetDifficulty);
    return da - db || (Math.random() - 0.5);
  });
  return unused[0];
}

// ── Helper: Call Gemini API for adaptive AI question ──
async function generateAIQuestion(skill, session) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    return null; // No API key configured
  }

  // Build question/answer history for the professor prompt
  let historyContext = '';
  for (const h of session.history) {
    const studentAnswer = h.timedOut ? 'No answer (timed out)' : h.selectedAnswer;
    historyContext += `Question: ${h.question}\nStudent's Answer: ${studentAnswer} — ${h.correct ? 'CORRECT' : 'INCORRECT'}\n\n`;
  }

  // Determine difficulty based on theta
  let calculatedDifficulty = 'intermediate';
  if (session.theta <= 3.5) calculatedDifficulty = 'easy';
  else if (session.theta >= 7) calculatedDifficulty = 'hard';

  const prompt = `You are an expert professor assessing a student's knowledge in ${skill}.

The student has answered the following questions so far:
${historyContext}
Based on their performance pattern, as a professor, what question would you ask next to better gauge their true skill level?

The question difficulty should be: ${calculatedDifficulty}

Generate ONE question in this JSON format:
{
  "type": "{one of: mcq, true_false, multiple_select, coding}",
  "question": "the question text",
  "codeSnippet": "optional code if relevant",
  "options": ["option A", "option B", "option C", "option D"],
  "correctIndex": 0,
  "explanation": "why this is correct"
}

For multiple_select type, correctIndex should be an array like [0, 2].
For coding type, include a codeSnippet with the code and ask what the output would be.
For true_false, only include 2 options: ["True", "False"].

Return ONLY the JSON, no other text.`;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024
        }
      })
    });

    if (!response.ok) {
      console.error('Gemini API error:', response.status);
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    // Extract JSON from response (handle possible markdown fences)
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate structure
    if (!parsed.question || !Array.isArray(parsed.options) || !parsed.type) {
      return null;
    }

    // Validate correct answer fields based on type
    if (parsed.type === 'multiple_select') {
      // The new prompt tells AI to put array in correctIndex for multiple_select
      // Normalize: accept correctIndex (array) or correctIndices (array)
      if (Array.isArray(parsed.correctIndex)) {
        parsed.correctIndices = parsed.correctIndex;
        delete parsed.correctIndex;
      }
      if (!Array.isArray(parsed.correctIndices) || parsed.correctIndices.length === 0) {
        return null;
      }
      for (const idx of parsed.correctIndices) {
        if (idx < 0 || idx >= parsed.options.length) return null;
      }
    } else {
      if (typeof parsed.correctIndex !== 'number') return null;
      if (parsed.correctIndex < 0 || parsed.correctIndex >= parsed.options.length) return null;
    }

    // Map difficulty string to numeric for theta calculation
    const difficultyMap = { easy: 3, intermediate: 6, hard: 9 };
    parsed.numericDifficulty = difficultyMap[parsed.difficulty] || 6;

    parsed.id = 'ai_' + Date.now().toString(36);
    parsed.source = 'gemini';
    return parsed;

  } catch (err) {
    console.error('Gemini generation error:', err.message);
    return null;
  }
}

// ── Helper: Determine question type ──
function pickQuestionType(skill, questionNumber) {
  const programmingSkills = ['Python', 'SQL', 'JavaScript', 'React'];
  if (programmingSkills.includes(skill) && questionNumber % 3 === 1) {
    return 'code_output';
  }
  if (questionNumber % 5 === 4) {
    return 'true_false';
  }
  return 'mcq';
}

// ── Helper: Build result object from session ──
function buildResult(session) {
  const finalScore = Math.round(clamp(session.theta, 1, 10));
  const correctCount = session.history.filter(h => h.correct).length;

  // Confidence calculation
  const last3 = session.history.slice(-3);
  let confidence = 'moderate';
  if (last3.length === 3) {
    const allSame = last3.every(h => h.correct) || last3.every(h => !h.correct);
    confidence = allSame ? 'high' : 'moderate';
    const thetaRange = Math.max(...last3.map(h => h.thetaAfter)) - Math.min(...last3.map(h => h.thetaAfter));
    if (thetaRange < 1) confidence = 'high';
  }

  // Recommendations based on score
  const recommendations = [];
  if (finalScore <= 3) {
    recommendations.push('Start with foundational courses and tutorials');
    recommendations.push('Practice basic concepts daily');
    recommendations.push('Join beginner-friendly communities and forums');
  } else if (finalScore <= 6) {
    recommendations.push('Work on intermediate projects to apply your knowledge');
    recommendations.push('Focus on areas where you struggled during the assessment');
    recommendations.push('Consider certification programs');
  } else if (finalScore <= 8) {
    recommendations.push('Tackle advanced topics and edge cases');
    recommendations.push('Contribute to open-source projects');
    recommendations.push('Mentor others to deepen your understanding');
  } else {
    recommendations.push('Explore cutting-edge research and papers');
    recommendations.push('Build complex real-world projects');
    recommendations.push('Consider teaching or creating content');
  }

  const duration = Math.round((Date.now() - session.startTime) / 1000);

  return {
    skill: session.skill,
    finalScore,
    outOf: 10,
    skillLevel: getSkillLevel(finalScore),
    confidence,
    correctCount,
    totalQuestions: session.totalQuestions,
    accuracy: Math.round((correctCount / session.totalQuestions) * 100),
    duration,
    thetaTrajectory: session.history.map(h => ({ q: h.questionNumber, theta: h.thetaAfter, correct: h.correct, difficulty: h.difficulty })),
    breakdown: session.history,
    recommendations
  };
}

// ── Helper: Save result to assessment_history ──
async function appendToHistory(userId, result) {
  await db.insertHistory(userId, result);
}

// ══════════════════════════════════════
// API ENDPOINTS
// ══════════════════════════════════════

// ── GET available skills ──
app.get('/api/skills', (req, res) => {
  const skills = Object.keys(questionBank);
  const skillInfo = skills.map(s => ({
    name: s,
    questionCount: questionBank[s].length,
    icon: getSkillIcon(s)
  }));
  res.json({ skills: skillInfo });
});

function getSkillIcon(skill) {
  const icons = {
    'Python': '🐍', 'SQL': '🗃️', 'JavaScript': '⚡', 'Machine Learning': '🤖',
    'Data Analysis': '📊', 'Excel': '📗', 'Statistics': '📈', 'React': '⚛️',
    'Cloud Computing': '☁️', 'Cybersecurity': '🔒'
  };
  return icons[skill] || '📚';
}

// ── POST /api/assessment/start ──
app.post('/api/assessment/start', (req, res) => {
  const { skill } = req.body;

  if (!skill || !questionBank[skill]) {
    return res.status(400).json({ error: 'Invalid skill. Available: ' + Object.keys(questionBank).join(', ') });
  }

  const sessionId = uuid();
  sessions[sessionId] = {
    skill,
    theta: INITIAL_THETA,
    step: INITIAL_STEP,
    questionNumber: 0,
    totalQuestions: TOTAL_QUESTIONS,
    seedQuestions: SEED_QUESTIONS,
    answered: 0,
    history: [],
    usedIds: new Set(),
    currentQuestion: null,
    questionStartTime: null,
    startTime: Date.now(),
    phase: 'seed'
  };

  res.json({
    sessionId,
    skill,
    totalQuestions: TOTAL_QUESTIONS,
    message: `Assessment started for ${skill}. Good luck!`
  });
});

// ── POST /api/assessment/next ──
app.post('/api/assessment/next', async (req, res) => {
  const { sessionId } = req.body;
  const session = sessions[sessionId];

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.questionNumber >= session.totalQuestions) {
    return res.status(400).json({ error: 'Assessment complete. Get results.' });
  }

  const questionNumber = session.questionNumber + 1;
  let question = null;

  if (session.phase === 'seed' && questionNumber <= session.seedQuestions) {
    // ── Phase 1: Seed questions (1-3) from bank ──
    // Q1: easy, Q2: intermediate, Q3: hard
    const seedDifficultyTargets = { 1: 3, 2: 6, 3: 9 };
    const targetDifficulty = seedDifficultyTargets[questionNumber] || 5;

    question = findSeedQuestion(session.skill, targetDifficulty, session.usedIds, null);

    // Fallback: any unused question from the bank
    if (!question) {
      const bank = questionBank[session.skill] || [];
      question = bank.find(q => !session.usedIds.has(q.id));
    }

    if (question) {
      // Map numeric difficulty to string label for seed questions
      let diffLabel = 'intermediate';
      if (question.difficulty <= 3) diffLabel = 'easy';
      else if (question.difficulty >= 7) diffLabel = 'hard';
      question.difficultyLabel = diffLabel;
      question.numericDifficulty = question.difficulty;
    }

    // Switch to AI phase after seed questions
    if (questionNumber >= session.seedQuestions) {
      session.phase = 'ai';
    }
  } else {
    // ── Phase 2: AI Generated questions (4-12) ──
    session.phase = 'ai';
    question = await generateAIQuestion(session.skill, session);

    // Fallback to seed question from bank if AI fails
    if (!question) {
      const targetDifficulty = Math.round(clamp(session.theta, 1, 10));
      question = findSeedQuestion(session.skill, targetDifficulty, session.usedIds, null);
      if (question) {
        let diffLabel = 'intermediate';
        if (question.difficulty <= 3) diffLabel = 'easy';
        else if (question.difficulty >= 7) diffLabel = 'hard';
        question.difficultyLabel = diffLabel;
        question.numericDifficulty = question.difficulty;
      }
    }

    // Fallback: any unused question from the bank
    if (!question) {
      const bank = questionBank[session.skill] || [];
      question = bank.find(q => !session.usedIds.has(q.id));
      if (question) {
        let diffLabel = 'intermediate';
        if (question.difficulty <= 3) diffLabel = 'easy';
        else if (question.difficulty >= 7) diffLabel = 'hard';
        question.difficultyLabel = diffLabel;
        question.numericDifficulty = question.difficulty;
      }
    }
  }

  // Ultimate fallback
  if (!question) {
    return res.status(500).json({ error: 'No questions available' });
  }

  if (question.id) {
    session.usedIds.add(question.id);
  }

  // For seed questions and bank fallbacks, shuffle options
  if (question.source !== 'gemini') {
    if (question.type === 'multiple_select' && Array.isArray(question.correctIndices)) {
      // Track correct options by value before shuffling
      const correctOptions = question.correctIndices.map(i => question.options[i]);
      const shuffledOptions = [...question.options];
      for (let i = shuffledOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
      }
      const shuffledCorrectIndices = correctOptions.map(opt => shuffledOptions.indexOf(opt));

      session.currentQuestion = {
        ...question,
        options: shuffledOptions,
        correctIndices: shuffledCorrectIndices
      };
    } else {
      const originalCorrect = question.options[question.correctIndex];
      const shuffledOptions = [...question.options];
      for (let i = shuffledOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
      }
      const shuffledCorrectIndex = shuffledOptions.indexOf(originalCorrect);

      session.currentQuestion = {
        ...question,
        options: shuffledOptions,
        correctIndex: shuffledCorrectIndex
      };
    }
  } else {
    // AI-generated question - store as-is
    session.currentQuestion = { ...question };
  }

  session.questionStartTime = Date.now();

  // Determine difficulty label and type for response
  const difficultyLabel = question.difficultyLabel || question.difficulty || 'intermediate';
  const questionType = question.type || 'mcq';

  // Send question WITHOUT correct answer (NEVER send correctIndex or correctIndices)
  res.json({
    questionNumber: questionNumber,
    totalQuestions: session.totalQuestions,
    type: questionType,
    difficulty: difficultyLabel,
    question: question.question || session.currentQuestion.question,
    codeSnippet: question.codeSnippet || null,
    options: session.currentQuestion.options,
    phase: session.phase === 'ai' && questionNumber > session.seedQuestions ? 'ai' : 'seed',
    timeLimit: 30
  });
});

// ── POST /api/assessment/answer ──
app.post('/api/assessment/answer', (req, res) => {
  const { sessionId, selectedIndex, selectedIndices } = req.body;
  const session = sessions[sessionId];

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!session.currentQuestion) {
    return res.status(400).json({ error: 'No active question. Call /next first.' });
  }

  const question = session.currentQuestion;
  const questionType = question.type || 'mcq';

  // Determine if timed out
  let timedOut = false;
  let correct = false;
  let selectedAnswer = 'No answer (timed out)';
  let correctAnswer = '';

  if (questionType === 'multiple_select') {
    // Multiple select: compare correctIndices arrays
    timedOut = !Array.isArray(selectedIndices) || selectedIndices.length === 0;
    if (!timedOut) {
      const sortedSelected = [...selectedIndices].sort((a, b) => a - b);
      const sortedCorrect = [...(question.correctIndices || [])].sort((a, b) => a - b);
      correct = sortedSelected.length === sortedCorrect.length &&
                sortedSelected.every((v, i) => v === sortedCorrect[i]);
      selectedAnswer = selectedIndices.map(i => question.options[i]).join(', ');
    }
    correctAnswer = (question.correctIndices || []).map(i => question.options[i]).join(', ');
  } else {
    // mcq, true_false, coding: use selectedIndex
    timedOut = selectedIndex === -1 || selectedIndex === null || selectedIndex === undefined;
    correct = !timedOut && selectedIndex === question.correctIndex;
    if (!timedOut) {
      selectedAnswer = question.options[selectedIndex] || 'Unknown';
    }
    correctAnswer = question.options[question.correctIndex] || 'Unknown';
  }

  // Calculate per-question time taken
  const timeTaken = session.questionStartTime
    ? Math.round((Date.now() - session.questionStartTime) / 1000)
    : null;

  // ── IRT Adaptive Update ──
  // Map difficulty strings to numeric values for theta calculation
  const difficultyMap = { easy: 3, intermediate: 6, hard: 9 };
  const numericDifficulty = question.numericDifficulty ||
    (typeof question.difficulty === 'string' ? (difficultyMap[question.difficulty] || 6) : question.difficulty) || 6;

  const direction = correct ? 1 : -1;
  session.theta = clamp(session.theta + (session.step * direction), 1, 10);
  session.step = Math.max(session.step * STEP_DECAY, MIN_STEP);
  session.questionNumber++;
  session.answered++;

  // Record history
  session.history.push({
    questionNumber: session.questionNumber,
    question: question.question,
    difficulty: question.difficultyLabel || question.difficulty,
    numericDifficulty: numericDifficulty,
    type: questionType,
    selectedIndex: questionType === 'multiple_select' ? undefined : (timedOut ? -1 : selectedIndex),
    selectedIndices: questionType === 'multiple_select' ? (timedOut ? [] : selectedIndices) : undefined,
    selectedAnswer: selectedAnswer,
    correctIndex: question.correctIndex,
    correctIndices: question.correctIndices,
    correct,
    timedOut,
    thetaAfter: Math.round(session.theta * 10) / 10,
    explanation: question.explanation,
    timeTaken
  });

  session.currentQuestion = null;
  session.questionStartTime = null;

  const isComplete = session.questionNumber >= session.totalQuestions;

  res.json({
    correct,
    correctIndex: questionType === 'multiple_select' ? undefined : question.correctIndex,
    correctIndices: questionType === 'multiple_select' ? question.correctIndices : undefined,
    explanation: question.explanation,
    selectedAnswer: selectedAnswer,
    correctAnswer: correctAnswer,
    currentQuestion: session.questionNumber,
    totalQuestions: session.totalQuestions,
    currentTheta: Math.round(session.theta * 10) / 10,
    timeTaken,
    timedOut,
    isComplete
  });
});

// ── GET /api/assessment/result (backward compatible) ──
app.get('/api/assessment/result', (req, res) => {
  const { sessionId } = req.query;
  const session = sessions[sessionId];

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const result = buildResult(session);
  res.json(result);
});

// ── POST /api/assessment/result (saves to Supabase) ──
app.post('/api/assessment/result', async (req, res) => {
  const { sessionId, userId } = req.body;
  const session = sessions[sessionId];

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const result = buildResult(session);

  try {
    await appendToHistory(userId, result);
  } catch (err) {
    console.error('Failed to save assessment history:', err.message);
  }

  res.json(result);
});

// ── GET /api/assessment/history ──
app.get('/api/assessment/history', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const userHistory = await db.getHistoryForUser(userId);
    res.json({ userId, assessments: userHistory });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load history', message: err.message });
  }
});

// ══════════════════════════════════════
// JOBS BOARD API – Proxy for The Muse + Arbeitnow
// ══════════════════════════════════════

// In-memory job cache (5 min TTL)
const jobCache = {};
const JOB_CACHE_TTL = 5 * 60 * 1000;

function getCacheKey(source, params) {
  return source + ':' + JSON.stringify(params);
}

// ── GET /api/jobs ── Unified job search endpoint
app.get('/api/jobs', async (req, res) => {
  const { search, category, level, location, page, source } = req.query;
  const pageNum = parseInt(page) || 1;

  try {
    // Fetch from all sources in parallel
    let jobs = [];
    let totalPages = 1;
    let totalJobs = 0;
    let sources = [];

    const [museResult, arbeitnowResult, adzunaResult] = await Promise.all([
      source !== 'arbeitnow' ? fetchMuseJobs({ search, category, level, location, page: pageNum }) : null,
      fetchArbeitnowJobs({ search, page: pageNum }),
      fetchAdzunaJobs({ search, location, category, page: pageNum })
    ]);

    // Primary: The Muse
    if (museResult && museResult.jobs.length > 0) {
      jobs = museResult.jobs;
      totalPages = museResult.totalPages;
      totalJobs = museResult.totalJobs;
      sources.push('The Muse');
    }

    // Merge Adzuna results
    if (adzunaResult && adzunaResult.jobs.length > 0) {
      if (jobs.length === 0) {
        jobs = adzunaResult.jobs;
        totalPages = adzunaResult.totalPages;
        totalJobs = adzunaResult.totalJobs;
        sources.push('Adzuna');
      } else {
        const existingTitles = new Set(jobs.map(j => j.title.toLowerCase()));
        const extras = adzunaResult.jobs.filter(j => !existingTitles.has(j.title.toLowerCase()));
        jobs = jobs.concat(extras.slice(0, 10));
        totalJobs += extras.length;
        if (extras.length > 0) sources.push('Adzuna');
      }
    }

    // Merge Arbeitnow results
    if (arbeitnowResult && arbeitnowResult.jobs.length > 0) {
      if (jobs.length === 0) {
        jobs = arbeitnowResult.jobs;
        totalPages = arbeitnowResult.totalPages;
        totalJobs = arbeitnowResult.totalJobs;
        sources.push('Arbeitnow');
      } else if (search) {
        const existingTitles = new Set(jobs.map(j => j.title.toLowerCase()));
        const extras = arbeitnowResult.jobs.filter(j => !existingTitles.has(j.title.toLowerCase()));
        jobs = jobs.concat(extras.slice(0, 10));
        totalJobs += extras.length;
        if (extras.length > 0) sources.push('Arbeitnow');
      }
    }

    const dataSource = sources.length > 0 ? sources.join(' + ') : 'none';

    res.json({
      jobs,
      page: pageNum,
      totalPages,
      totalJobs,
      source: dataSource
    });

  } catch (err) {
    console.error('Jobs API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch jobs', message: err.message });
  }
});

// ── GET /api/jobs/categories ── Available job categories
app.get('/api/jobs/categories', async (req, res) => {
  const categories = [
    'Data Science', 'Engineering', 'Software Engineering', 'Data and Analytics',
    'Design and UX', 'IT', 'Product', 'Project Management',
    'Science and Engineering', 'Business Operations', 'Marketing',
    'Finance', 'HR', 'Education', 'Healthcare'
  ];
  res.json({ categories });
});

// ── Map search terms to Muse categories for better results ──
function searchToMuseCategory(search) {
  if (!search) return null;
  const q = search.toLowerCase();
  const mapping = {
    'data': 'Data Science', 'data scientist': 'Data Science', 'data analyst': 'Data and Analytics',
    'analytics': 'Data and Analytics', 'software': 'Software Engineering', 'developer': 'Software Engineering',
    'engineer': 'Engineering', 'frontend': 'Software Engineering', 'backend': 'Software Engineering',
    'fullstack': 'Software Engineering', 'full stack': 'Software Engineering',
    'devops': 'IT', 'cloud': 'IT', 'security': 'IT', 'cybersecurity': 'IT',
    'machine learning': 'Data Science', 'ml': 'Data Science', 'ai': 'Data Science',
    'product': 'Product', 'design': 'Design and UX', 'ux': 'Design and UX', 'ui': 'Design and UX',
    'marketing': 'Marketing', 'finance': 'Finance', 'project manager': 'Project Management',
    'python': 'Software Engineering', 'javascript': 'Software Engineering', 'react': 'Software Engineering',
  };
  for (const [key, cat] of Object.entries(mapping)) {
    if (q.includes(key)) return cat;
  }
  return null;
}

// ── Fetch from The Muse API ──
async function fetchMuseJobs({ search, category, level, location, page }) {
  // If search term provided but no category, try to map it
  if (search && !category) {
    category = searchToMuseCategory(search) || category;
  }

  const cacheKey = getCacheKey('muse', { search, category, level, location, page });
  if (jobCache[cacheKey] && Date.now() - jobCache[cacheKey].ts < JOB_CACHE_TTL) {
    return jobCache[cacheKey].data;
  }

  try {
    const params = new URLSearchParams();
    params.append('page', (page - 1).toString()); // Muse is 0-indexed
    if (category) params.append('category', category);
    if (level) params.append('level', level);
    if (location) params.append('location', location);

    const url = `https://www.themuse.com/api/public/jobs?${params.toString()}`;
    console.log('📡 Fetching Muse jobs:', url);

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.error('Muse API error:', response.status);
      return null;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) return null;

    // Normalize to our format
    let jobs = data.results.map(job => ({
      id: 'muse_' + job.id,
      title: job.name || 'Untitled',
      company: job.company?.name || 'Unknown',
      companyLogo: job.company?.short_name ? `https://avatars.githubusercontent.com/u/${Math.abs(hashCode(job.company.name)) % 100000000}?s=48` : null,
      location: (job.locations || []).map(l => l.name).join(', ') || 'Remote',
      type: job.type || 'Full-time',
      level: (job.levels || []).map(l => l.name).join(', ') || '',
      categories: (job.categories || []).map(c => c.name),
      publishedAt: job.publication_date || '',
      url: job.refs?.landing_page || '#',
      tags: (job.tags || []).map(t => t.name || t),
      source: 'themuse'
    }));

    // Additional keyword filter — only when search term is very specific
    if (search && category) {
      const q = search.toLowerCase();
      const filtered = jobs.filter(j =>
        j.title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        j.categories.some(c => c.toLowerCase().includes(q)) ||
        j.location.toLowerCase().includes(q)
      );
      // Only use filtered if we got some results, otherwise show category results
      if (filtered.length > 0) jobs = filtered;
    }

    const result = {
      jobs,
      totalPages: Math.ceil((data.page_count || 1)),
      totalJobs: data.total || jobs.length
    };

    jobCache[cacheKey] = { data: result, ts: Date.now() };
    return result;

  } catch (err) {
    console.error('Muse fetch error:', err.message);
    return null;
  }
}

// ── Fetch from Arbeitnow API (fallback) ──
async function fetchArbeitnowJobs({ search, page }) {
  const cacheKey = getCacheKey('arbeitnow', { search, page });
  if (jobCache[cacheKey] && Date.now() - jobCache[cacheKey].ts < JOB_CACHE_TTL) {
    return jobCache[cacheKey].data;
  }

  try {
    const url = `https://www.arbeitnow.com/api/job-board-api?page=${page}`;
    console.log('📡 Fetching Arbeitnow jobs:', url);

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.error('Arbeitnow API error:', response.status);
      return null;
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) return null;

    let jobs = data.data.map(job => ({
      id: 'arb_' + job.slug,
      title: job.title || 'Untitled',
      company: job.company_name || 'Unknown',
      companyLogo: null,
      location: job.location || 'Remote',
      type: (job.job_types || []).join(', ') || 'Full-time',
      level: '',
      categories: job.tags || [],
      publishedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : '',
      url: job.url || '#',
      tags: job.tags || [],
      remote: job.remote || false,
      source: 'arbeitnow'
    }));

    // Client-side search filter
    if (search) {
      const q = search.toLowerCase();
      jobs = jobs.filter(j =>
        j.title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        j.tags.some(t => t.toLowerCase().includes(q)) ||
        j.location.toLowerCase().includes(q)
      );
    }

    const result = {
      jobs,
      totalPages: data.meta?.last_page || Math.ceil((data.meta?.total || jobs.length) / 100),
      totalJobs: data.meta?.total || jobs.length
    };

    jobCache[cacheKey] = { data: result, ts: Date.now() };
    return result;

  } catch (err) {
    console.error('Arbeitnow fetch error:', err.message);
    return null;
  }
}

// ══════════════════════════════════════
// NEWS API – DEV.to + Hacker News
// ══════════════════════════════════════

const newsCache = { data: null, ts: 0 };
const NEWS_CACHE_TTL = 15 * 60 * 1000; // 15 min cache

app.get('/api/news', async (req, res) => {
  // Return cached if fresh
  if (newsCache.data && Date.now() - newsCache.ts < NEWS_CACHE_TTL) {
    return res.json(newsCache.data);
  }

  try {
    // Fetch from DEV.to – multiple tags in parallel
    const [careerArticles, techArticles, aiArticles, hnTopIds] = await Promise.all([
      fetchDevToArticles('career', 4),
      fetchDevToArticles('programming', 4),
      fetchDevToArticles('ai', 4),
      fetchHNTopStories(6)
    ]);

    // Merge & deduplicate DEV.to articles
    const allDevTo = [...(careerArticles || []), ...(techArticles || []), ...(aiArticles || [])];
    const seen = new Set();
    const uniqueDevTo = allDevTo.filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    // Sort by date, take top 6
    uniqueDevTo.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const devToFinal = uniqueDevTo.slice(0, 6);

    const result = {
      articles: devToFinal,
      hnStories: hnTopIds || [],
      fetchedAt: new Date().toISOString()
    };

    newsCache.data = result;
    newsCache.ts = Date.now();
    res.json(result);

  } catch (err) {
    console.error('News API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

async function fetchDevToArticles(tag, count) {
  try {
    const resp = await fetch(`https://dev.to/api/articles?tag=${tag}&per_page=${count}&top=7`);
    if (!resp.ok) return [];
    const articles = await resp.json();
    return articles.map(a => ({
      id: 'devto_' + a.id,
      title: a.title,
      description: a.description || '',
      url: a.url,
      image: a.cover_image || a.social_image || null,
      publishedAt: a.published_at,
      readableDate: a.readable_publish_date,
      readingTime: a.reading_time_minutes,
      reactions: a.public_reactions_count || 0,
      comments: a.comments_count || 0,
      tags: a.tag_list || [],
      author: {
        name: a.user?.name || a.user?.username || 'Unknown',
        avatar: a.user?.profile_image_90 || null
      },
      source: 'devto'
    }));
  } catch (err) {
    console.error('DEV.to fetch error:', err.message);
    return [];
  }
}

async function fetchHNTopStories(count) {
  try {
    const resp = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    if (!resp.ok) return [];
    const ids = await resp.json();
    const topIds = ids.slice(0, count);

    // Fetch each story in parallel
    const stories = await Promise.all(
      topIds.map(async id => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          const s = await r.json();
          return {
            id: 'hn_' + s.id,
            title: s.title,
            url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
            score: s.score,
            comments: s.descendants || 0,
            author: { name: s.by },
            publishedAt: new Date(s.time * 1000).toISOString(),
            source: 'hackernews'
          };
        } catch { return null; }
      })
    );
    return stories.filter(Boolean);
  } catch (err) {
    console.error('HN fetch error:', err.message);
    return [];
  }
}

// ── Fetch from Adzuna API ──
async function fetchAdzunaJobs({ search, location, category, page }) {
  if (!ADZUNA_APP_ID || ADZUNA_APP_ID === 'your_adzuna_app_id_here') {
    return null; // Not configured
  }

  const cacheKey = getCacheKey('adzuna', { search, location, category, page });
  if (jobCache[cacheKey] && Date.now() - jobCache[cacheKey].ts < JOB_CACHE_TTL) {
    return jobCache[cacheKey].data;
  }

  try {
    const params = new URLSearchParams();
    params.append('app_id', ADZUNA_APP_ID);
    params.append('app_key', ADZUNA_APP_KEY);
    params.append('results_per_page', '20');
    params.append('sort_by', 'date');
    if (search) params.append('what', search);
    if (location) params.append('where', location);
    if (category) {
      // Map our categories to Adzuna tags
      const adzunaCategories = {
        'Software Engineering': 'it-jobs',
        'Data Science': 'it-jobs',
        'Data and Analytics': 'it-jobs',
        'Engineering': 'engineering-jobs',
        'Design and UX': 'creative-design-jobs',
        'IT': 'it-jobs',
        'Product': 'consultancy-jobs',
        'Marketing': 'marketing-jobs',
        'Finance': 'accounting-finance-jobs',
        'HR': 'hr-jobs',
        'Healthcare': 'healthcare-nursing-jobs',
        'Education': 'teaching-jobs'
      };
      const adzCat = adzunaCategories[category];
      if (adzCat) params.append('category', adzCat);
    }

    const url = `${ADZUNA_BASE}/us/search/${page}?${params.toString()}`;
    console.log('📡 Fetching Adzuna jobs:', url.replace(ADZUNA_APP_KEY, '***'));

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.error('Adzuna API error:', response.status);
      return null;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) return null;

    const jobs = data.results.map(job => ({
      id: 'adz_' + job.id,
      title: job.title || 'Untitled',
      company: job.company?.display_name || 'Unknown',
      companyLogo: null,
      location: job.location?.display_name || 'Not specified',
      type: job.contract_time === 'full_time' ? 'Full-time' : job.contract_time === 'part_time' ? 'Part-time' : job.contract_type === 'contract' ? 'Contract' : 'Full-time',
      level: '',
      categories: job.category ? [job.category.label] : [],
      publishedAt: job.created || '',
      url: job.redirect_url || '#',
      tags: job.category ? [job.category.label] : [],
      salary: (job.salary_min && job.salary_max) ? `$${Math.round(job.salary_min/1000)}k - $${Math.round(job.salary_max/1000)}k` : (job.salary_is_predicted === '1' && job.salary_min ? `~$${Math.round(job.salary_min/1000)}k (est.)` : ''),
      source: 'adzuna'
    }));

    const result = {
      jobs,
      totalPages: Math.ceil((data.count || jobs.length) / 20),
      totalJobs: data.count || jobs.length
    };

    jobCache[cacheKey] = { data: result, ts: Date.now() };
    return result;

  } catch (err) {
    console.error('Adzuna fetch error:', err.message);
    return null;
  }
}

// ── Simple hash for generating deterministic avatar URLs ──
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

// ══════════════════════════════════════
// DASHBOARD API
// ══════════════════════════════════════

// ── Helper: relative time string ──
function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins === 1 ? '1 minute ago' : `${diffMins} minutes ago`;
  if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

// ── Helper: badge for assessed skill count ──
function getBadge(assessedCount) {
  if (assessedCount <= 1) return 'Newcomer';
  if (assessedCount <= 3) return 'Rising Analyst';
  if (assessedCount <= 5) return 'Skilled Practitioner';
  if (assessedCount <= 7) return 'Expert Analyst';
  if (assessedCount <= 9) return 'Elite Performer';
  return 'Grand Master';
}

// ── GET /api/dashboard ──
app.get('/api/dashboard', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const userHistory = await db.getHistoryForUser(userId);

    // ── 1. Milestone ──
    const allSkills = Object.keys(questionBank);
    const totalSkills = allSkills.length;
    const assessedSkillSet = new Set(userHistory.map(h => h.skill));
    const assessedSkills = assessedSkillSet.size;
    const completionPct = totalSkills > 0 ? Math.round((assessedSkills / totalSkills) * 100) : 0;
    const level = Math.floor(assessedSkills / 2) + 1;
    const nextBadge = getBadge(assessedSkills);

    const milestone = {
      totalSkills,
      assessedSkills,
      completionPct,
      level,
      nextBadge
    };

    // ── 2. Skill Matrix ──
    // For each assessed skill, get the LATEST score
    const latestBySkill = {};
    for (const entry of userHistory) {
      if (!latestBySkill[entry.skill] || new Date(entry.timestamp) > new Date(latestBySkill[entry.skill].timestamp)) {
        latestBySkill[entry.skill] = entry;
      }
    }

    const skillMatrix = Object.values(latestBySkill).map(entry => ({
      name: entry.skill,
      score: entry.score,
      max: 10,
      verified: entry.score >= 7
    }));

    // ── 3. Recent Benchmarks ──
    const sorted = [...userHistory].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const recentBenchmarks = sorted.slice(0, 3).map(entry => ({
      skill: entry.skill,
      score: entry.score,
      level: entry.skillLevel,
      date: entry.timestamp ? entry.timestamp.split('T')[0] : '',
      daysAgo: timeAgo(entry.timestamp)
    }));

    // ── 4. Trending (computed from real assessment activity) ──
    const allHistory = await db.getAllHistory();
    const skillStats = {};
    for (const entry of allHistory) {
      if (!skillStats[entry.skill]) skillStats[entry.skill] = { count: 0, totalScore: 0 };
      skillStats[entry.skill].count++;
      skillStats[entry.skill].totalScore += entry.score;
    }

    // Sort by assessment count (demand proxy), normalise to 0-100 demand score
    const maxCount = Math.max(1, ...Object.values(skillStats).map(s => s.count));
    const trendingRaw = Object.entries(skillStats)
      .map(([name, s]) => ({
        name,
        demand: Math.round((s.count / maxCount) * 100),
        avgScore: Math.round((s.totalScore / s.count) * 10) / 10,
        count: s.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // If no real data yet, fall back to static defaults
    const trending = trendingRaw.length > 0
      ? trendingRaw.map(t => ({ name: t.name, demand: t.demand, change: `+${t.count} assessments`, dir: 'up' }))
      : [
          { name: 'Python', demand: 95, change: '+12%', dir: 'up' },
          { name: 'JavaScript', demand: 92, change: '+8%', dir: 'up' },
          { name: 'Machine Learning', demand: 89, change: '+15%', dir: 'up' },
          { name: 'Cloud Computing', demand: 87, change: '+10%', dir: 'up' },
          { name: 'SQL', demand: 84, change: '+5%', dir: 'up' },
          { name: 'Cybersecurity', demand: 82, change: '+18%', dir: 'up' }
        ];

    // ── 5. Stats – newJobsCount ──
    let newJobsCount = 0;
    try {
      const museResp = await fetch('https://www.themuse.com/api/public/jobs?page=0', {
        headers: { 'Accept': 'application/json' }
      });
      if (museResp.ok) {
        const museData = await museResp.json();
        newJobsCount = museData.total || museData.results?.length || 0;
      }
    } catch (err) {
      console.error('Dashboard: failed to fetch job count:', err.message);
      newJobsCount = 0;
    }

    res.json({
      milestone,
      skillMatrix,
      recentBenchmarks,
      trending,
      stats: { newJobsCount }
    });

  } catch (err) {
    console.error('Dashboard API error:', err.message);
    res.status(500).json({ error: 'Failed to build dashboard', message: err.message });
  }
});

// ── GET /api/dashboard/leaderboard ──
app.get('/api/dashboard/leaderboard', async (req, res) => {
  try {
  const [history, profiles] = await Promise.all([db.getAllHistory(), db.getAllProfiles()]);

  // Aggregate per user: unique skills assessed and average score across latest per skill
  const userMap = {};
  for (const entry of history) {
    const uid = entry.userId;
    if (!uid || uid === 'anonymous') continue;
    if (!userMap[uid]) userMap[uid] = {};
    // Keep only the latest score per skill
    if (!userMap[uid][entry.skill] || new Date(entry.timestamp) > new Date(userMap[uid][entry.skill].timestamp)) {
      userMap[uid][entry.skill] = { score: entry.score, timestamp: entry.timestamp };
    }
  }

  const rows = Object.entries(userMap).map(([uid, skillMap]) => {
    const scores = Object.values(skillMap).map(s => s.score);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const skillCount = scores.length;
    const profile = profiles[uid] || {};
    const name = profile.name || uid.split('@')[0];
    const initials = name.split(/\s+/).filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
    return { userId: uid, name, initials, avgScore, skills: skillCount, badge: getBadge(skillCount) };
  });

  // Sort by avgScore desc, then skills desc
  rows.sort((a, b) => b.avgScore - a.avgScore || b.skills - a.skills);
  const top10 = rows.slice(0, 10).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    avatar: r.initials,
    score: r.avgScore,
    skills: r.skills,
    badge: r.badge
  }));

  res.json({ leaderboard: top10 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load leaderboard', message: err.message });
  }
});

// ══════════════════════════════════════
// PROFILE API (Supabase)
// ══════════════════════════════════════

function getDefaultProfile(userId) {
  return {
    userId: userId,
    email: userId,
    name: '',
    title: 'Aspiring Data Professional',
    bio: '',
    location: '',
    skills: [],
    experience: [],
    education: [],
    documents: [],
    social: { linkedin: '', github: '', portfolio: '' },
    role: 'scholar',
    provider: 'local',
    analyzerReports: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeProfile(profile, userId) {
  const defaults = getDefaultProfile(userId);
  const source = profile || {};

  return {
    ...defaults,
    ...source,
    userId: userId,
    email: source.email || defaults.email,
    name: source.name || defaults.name,
    title: source.title || defaults.title,
    bio: source.bio || defaults.bio,
    location: source.location || defaults.location,
    skills: Array.isArray(source.skills) ? source.skills : defaults.skills,
    experience: Array.isArray(source.experience) ? source.experience : defaults.experience,
    education: Array.isArray(source.education) ? source.education : defaults.education,
    documents: Array.isArray(source.documents) ? source.documents : defaults.documents,
    analyzerReports: Array.isArray(source.analyzerReports) ? source.analyzerReports : defaults.analyzerReports,
    social: {
      ...defaults.social,
      ...(source.social || {})
    },
    role: source.role || defaults.role,
    provider: source.provider || defaults.provider,
    createdAt: source.createdAt || defaults.createdAt,
    updatedAt: source.updatedAt || defaults.updatedAt
  };
}

function normalizeEmailAddress(email) {
  return (email || '').trim().toLowerCase();
}

function buildPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, passwordHash };
}

function verifyPassword(password, user) {
  if (!password || !user || !user.salt || !user.passwordHash) return false;
  const candidateHash = crypto.scryptSync(password, user.salt, 64).toString('hex');
  return crypto.timingSafeEqual(
    Buffer.from(candidateHash, 'hex'),
    Buffer.from(user.passwordHash, 'hex')
  );
}

function buildSessionUser(user) {
  return {
    name: user.name || '',
    email: normalizeEmailAddress(user.email),
    role: user.role || 'scholar',
    provider: user.provider || 'local',
    createdAt: user.createdAt || new Date().toISOString(),
    lastLoginAt: user.lastLoginAt || new Date().toISOString()
  };
}

async function upsertUserProfile(user, overrides) {
  const userId = normalizeEmailAddress(user.email);
  const now = new Date().toISOString();
  const existing = normalizeProfile(await db.getProfile(userId), userId);
  const merged = normalizeProfile({
    ...existing,
    name: overrides && overrides.name !== undefined ? overrides.name : (existing.name || user.name || ''),
    email: userId,
    role: user.role || existing.role,
    provider: user.provider || existing.provider,
    title: overrides && overrides.title !== undefined ? overrides.title : existing.title,
    bio: overrides && overrides.bio !== undefined ? overrides.bio : existing.bio,
    location: overrides && overrides.location !== undefined ? overrides.location : existing.location,
    social: {
      ...(existing.social || {}),
      ...((overrides && overrides.social) || {})
    },
    createdAt: existing.createdAt || user.createdAt || now,
    updatedAt: now
  }, userId);

  return await db.upsertProfile(userId, merged);
}

function prettyProviderName(provider) {
  const normalized = (provider || '').trim().toLowerCase();
  if (normalized === 'google') return 'Google';
  if (normalized === 'linkedin') return 'LinkedIn';
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Social';
}

// ── Auth API ──
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = normalizeEmailAddress(req.body.email);
    const password = req.body.password || '';

    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (email === DEMO_ADMIN_EMAIL) return res.status(400).json({ error: 'This email is reserved. Please sign in instead.' });

    const existingUser = await db.getAuthUser(email);
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const now = new Date().toISOString();
    const pwRecord = buildPasswordRecord(password);
    const newUser = {
      email, name, role: 'scholar', provider: 'local',
      createdAt: now, updatedAt: now, lastLoginAt: now, ...pwRecord
    };
    await db.upsertAuthUser(email, newUser);

    const profile = await upsertUserProfile(newUser, {
      title: 'Aspiring SkillGap Scholar',
      bio: 'New SkillGap member focused on building verified skills and career readiness.',
      location: ''
    });

    const sessionUser = buildSessionUser({ ...newUser, name: profile.name });
    const token = generateAuthToken(email);
    res.status(201).json({ user: sessionUser, profile, token });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = normalizeEmailAddress(req.body.email);
    const password = req.body.password || '';

    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' });
    if (!password) return res.status(400).json({ error: 'Password is required.' });

    if (email === DEMO_ADMIN_EMAIL && password === DEMO_ADMIN_PASSWORD) {
      const adminUser = {
        email: DEMO_ADMIN_EMAIL,
        name: DEMO_ADMIN_NAME,
        role: 'admin',
        provider: 'local',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      const profile = await upsertUserProfile(adminUser, { name: DEMO_ADMIN_NAME });
      const token = generateAuthToken(DEMO_ADMIN_EMAIL);
      return res.json({ user: buildSessionUser({ ...adminUser, name: profile.name }), profile, token });
    }

    const user = await db.getAuthUser(email);
    if (!user || user.provider !== 'local' || !verifyPassword(password, user)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const now = new Date().toISOString();
    await db.upsertAuthUser(email, { ...user, lastLoginAt: now, updatedAt: now });

    const profile = await upsertUserProfile({ ...user, lastLoginAt: now });
    const token = generateAuthToken(email);
    res.json({ user: buildSessionUser({ ...user, name: profile.name }), profile, token });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Failed to sign in.' });
  }
});

app.post('/api/auth/social', authLimiter, async (req, res) => {
  try {
    const provider = (req.body.provider || '').trim().toLowerCase();
    if (!provider) return res.status(400).json({ error: 'Provider is required.' });

    const email = normalizeEmailAddress(req.body.email || ('user@' + provider + '.com'));
    const displayProvider = prettyProviderName(provider);
    const name = (req.body.name || (displayProvider + ' User')).trim();

    const existing = await db.getAuthUser(email) || {};
    const now = new Date().toISOString();

    const userRecord = {
      ...existing,
      email, name,
      role: existing.role || 'scholar',
      provider,
      createdAt: existing.createdAt || now,
      updatedAt: now,
      lastLoginAt: now
    };
    await db.upsertAuthUser(email, userRecord);

    const profile = await upsertUserProfile(userRecord, {
      title: displayProvider + ' Scholar',
      bio: 'Signed in with ' + displayProvider + ' and ready to build verified skills.',
      location: ''
    });

    const token = generateAuthToken(email);
    res.json({ user: buildSessionUser({ ...userRecord, name: profile.name }), profile, token });
  } catch (err) {
    console.error('Social auth error:', err.message);
    res.status(500).json({ error: 'Failed to complete social sign-in.' });
  }
});

function calculateStrength(profile, assessmentHistory) {
  let strength = 0;
  const breakdown = {};
  const tips = [];

  // Has name: +10
  breakdown.name = !!(profile.name && profile.name.trim().length > 0);
  if (breakdown.name) {
    strength += 10;
  } else {
    tips.push('Add your name to improve your profile');
  }

  // Has title (not default): +5
  breakdown.title = !!(profile.title && profile.title.trim().length > 0 && profile.title !== 'Aspiring Data Professional');
  if (breakdown.title) {
    strength += 5;
  } else {
    tips.push('Update your title to reflect your current role');
  }

  // Has bio (>20 chars): +10
  breakdown.bio = !!(profile.bio && profile.bio.trim().length > 20);
  if (breakdown.bio) {
    strength += 10;
  } else {
    tips.push('Add a bio to improve your profile');
  }

  // Has location: +5
  breakdown.location = !!(profile.location && profile.location.trim().length > 0);
  if (breakdown.location) {
    strength += 5;
  }

  // Has skills: 3+ = +10, 5+ = +15, 8+ = +20
  const skillCount = (profile.skills || []).length;
  breakdown.skills = skillCount;
  if (skillCount >= 8) {
    strength += 20;
  } else if (skillCount >= 5) {
    strength += 15;
  } else if (skillCount >= 3) {
    strength += 10;
  } else {
    tips.push('Add at least 3 skills to strengthen your profile');
  }

  // Has experience: 1+ = +15, 2+ = +20
  const expCount = (profile.experience || []).length;
  breakdown.experience = expCount;
  if (expCount >= 2) {
    strength += 20;
  } else if (expCount >= 1) {
    strength += 15;
  } else {
    tips.push('Add your work experience');
  }

  // Has education: +10
  breakdown.education = (profile.education || []).length > 0;
  if (breakdown.education) {
    strength += 10;
  } else {
    tips.push('Add your education background');
  }

  // Has 1+ document: +5
  breakdown.documents = (profile.documents || []).length > 0;
  if (breakdown.documents) {
    strength += 5;
  } else {
    tips.push('Upload a resume or certificate');
  }

  // Has assessment scores: +5 per unique skill assessed, max +15
  const userAssessments = assessmentHistory.filter(h => h.userId === profile.userId);
  const uniqueAssessedSkills = new Set(userAssessments.map(h => h.skill));
  const assessmentPoints = Math.min(uniqueAssessedSkills.size * 5, 15);
  breakdown.assessments = uniqueAssessedSkills.size;
  if (assessmentPoints > 0) {
    strength += assessmentPoints;
  } else {
    tips.push('Take skill assessments to boost your profile');
  }

  // Has social links (any): +5
  const social = profile.social || {};
  breakdown.social = !!(social.linkedin || social.github || social.portfolio);
  if (breakdown.social) {
    strength += 5;
  } else {
    tips.push('Add social links (LinkedIn, GitHub, or portfolio)');
  }

  // Cap at 100
  strength = Math.min(strength, 100);

  return { strength, breakdown, tips };
}

// ── GET /api/profile ──
app.get('/api/profile', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const raw = await db.getProfile(userId);
    const profile = normalizeProfile(raw, userId);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile', message: err.message });
  }
});

// ── PUT /api/profile ──
app.put('/api/profile', async (req, res) => {
  const { userId, ...profileFields } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required in request body' });
  }

  try {
    const raw = await db.getProfile(userId);
    const existing = normalizeProfile(raw, userId);

    // Merge: only update fields that are provided
    for (const key of Object.keys(profileFields)) {
      if (key === 'social' && typeof profileFields.social === 'object') {
        existing.social = { ...(existing.social || {}), ...profileFields.social };
      } else {
        existing[key] = profileFields[key];
      }
    }

    existing.userId = userId;
    existing.email = existing.email || userId;
    existing.updatedAt = new Date().toISOString();
    const updated = await db.upsertProfile(userId, normalizeProfile(existing, userId));

    // Keep auth_users name/role in sync
    const authUser = await db.getAuthUser(userId);
    if (authUser) {
      await db.upsertAuthUser(userId, {
        ...authUser,
        name: updated.name || authUser.name,
        role: updated.role || authUser.role,
        updatedAt: updated.updatedAt
      });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile', message: err.message });
  }
});

// ── GET /api/profile/strength ──
app.get('/api/profile/strength', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const [raw, assessmentHistory] = await Promise.all([
      db.getProfile(userId),
      db.getHistoryForUser(userId)
    ]);
    const profile = normalizeProfile(raw, userId);
    res.json(calculateStrength(profile, assessmentHistory));
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute strength', message: err.message });
  }
});

// ── GET /api/skills-lab ──
app.get('/api/skills-lab', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const [userAssessments, rawProfile] = await Promise.all([
      db.getHistoryForUser(userId),
      db.getProfile(userId)
    ]);
    const profile = normalizeProfile(rawProfile, userId);

    // Group by skill and find latest assessment per skill
    const skillMap = {};
    for (const assessment of userAssessments) {
      const skill = assessment.skill;
      if (!skillMap[skill]) {
        skillMap[skill] = [];
      }
      skillMap[skill].push(assessment);
    }

    // Build skill matrix
    const skillMatrix = [];
    for (const [skillName, assessments] of Object.entries(skillMap)) {
      // Sort by timestamp descending to find latest
      assessments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const latest = assessments[0];
      const score = latest.score;
      const level = getSkillLevel(score);
      const lastAssessed = latest.timestamp.split('T')[0];

      skillMatrix.push({
        name: skillName,
        score: score,
        maxScore: 10,
        verified: score >= 7,
        level: level,
        lastAssessed: lastAssessed,
        attempts: assessments.length
      });
    }

    // Sort skill matrix by score descending
    skillMatrix.sort((a, b) => b.score - a.score);

    // Top strength and growth area
    const topStrength = skillMatrix.length > 0
      ? { name: skillMatrix[0].name, score: skillMatrix[0].score, maxScore: 10 }
      : null;
    const growthArea = skillMatrix.length > 0
      ? { name: skillMatrix[skillMatrix.length - 1].name, score: skillMatrix[skillMatrix.length - 1].score, maxScore: 10 }
      : null;

    // Generate insight
    let insight = '';
    if (topStrength && growthArea) {
      if (topStrength.name === growthArea.name) {
        insight = `Your strongest skill is ${topStrength.name} at ${getSkillLevel(topStrength.score)} level. Keep practicing to reach the next level.`;
      } else {
        const growthCurrentLevel = getSkillLevel(growthArea.score);
        const growthNextLevel = getSkillLevel(Math.min(growthArea.score + 2, 10));
        const suffix = growthCurrentLevel === growthNextLevel
          ? 'by practicing more challenging problems.'
          : `from ${growthCurrentLevel} to ${growthNextLevel} by practicing data structures and algorithms.`;
        insight = `Your strongest skill is ${topStrength.name} at ${getSkillLevel(topStrength.score)} level. Focus on improving ${growthArea.name} ${suffix}`;
      }
    } else {
      insight = 'Start taking assessments to build your skill profile.';
    }

    // Benchmarks: last 5 assessments sorted by date desc
    const sortedAssessments = [...userAssessments].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const benchmarks = sortedAssessments.slice(0, 5).map(a => ({
      skill: a.skill,
      score: a.score,
      level: getSkillLevel(a.score),
      date: a.timestamp.split('T')[0],
      daysAgo: timeAgo(a.timestamp),
      percentile: Math.min(99, Math.round(a.score * 10))
    }));

    // Available skills: skills in question bank not yet assessed by user
    const assessedSkillNames = new Set(Object.keys(skillMap));
    const availableSkills = Object.keys(questionBank).filter(s => !assessedSkillNames.has(s));

    // Stats
    const totalAssessments = userAssessments.length;
    const avgScore = totalAssessments > 0
      ? Math.round((userAssessments.reduce((sum, a) => sum + a.score, 0) / totalAssessments) * 10) / 10
      : 0;
    const skillsCovered = assessedSkillNames.size;
    const totalSkills = Object.keys(questionBank).length;

    res.json({
      skillMatrix,
      availableSkills,
      topStrength,
      growthArea,
      insight,
      benchmarks,
      stats: {
        totalAssessments,
        avgScore,
        skillsCovered,
        totalSkills
      }
    });
  } catch (err) {
    console.error('Error in /api/skills-lab:', err.message);
    res.status(500).json({ error: 'Failed to generate skills lab data' });
  }
});

// ══════════════════════════════════════
// ANALYZER API – Resume Parsing & Gap Analysis
// ══════════════════════════════════════

// Resume analyzer: keep in memory (parse only, don't persist)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Profile document uploads: use Supabase Storage (in-memory multer)
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// ── POST /api/profile/upload-document ──
app.post('/api/profile/upload-document', documentUpload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded or file type not allowed.' });

    const userId = req.body.userId || req.authenticatedUserId;
    if (!userId) return res.status(400).json({ error: 'userId is required.' });

    const docId = Date.now().toString(36);
    const ext = path.extname(req.file.originalname).toLowerCase();
    const safeFilename = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) + ext;

    const { filePath, publicUrl } = await db.uploadDocument(
      userId, docId, safeFilename, req.file.buffer, req.file.mimetype
    );

    const rawProfile = await db.getProfile(userId);
    const profile = normalizeProfile(rawProfile, userId);

    const doc = {
      id: docId,
      name: req.file.originalname,
      filePath,
      size: req.file.size,
      type: ext.slice(1),
      url: publicUrl,
      uploadedAt: new Date().toISOString()
    };

    profile.documents = [...(profile.documents || []), doc];
    profile.updatedAt = new Date().toISOString();
    await db.upsertProfile(userId, profile);

    res.json({ success: true, document: doc });
  } catch (err) {
    console.error('Document upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload document.' });
  }
});

// ── GET /api/profile/documents/:filename – documents now served from Supabase Storage directly ──
// This route kept for backwards compatibility; new uploads return a direct Supabase URL.
app.get('/api/profile/documents/:filename', (req, res) => {
  res.status(410).json({ error: 'Documents are now served directly from storage. Use the url field from the document object.' });
});

// ── DELETE /api/profile/documents/:docId ──
app.delete('/api/profile/documents/:docId', async (req, res) => {
  try {
    const userId = req.query.userId || req.authenticatedUserId;
    if (!userId) return res.status(400).json({ error: 'userId is required.' });

    const rawProfile = await db.getProfile(userId);
    const profile = normalizeProfile(rawProfile, userId);

    const docId = req.params.docId;
    const doc = (profile.documents || []).find(d => d.id === docId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    if (doc.filePath) {
      try { await db.deleteDocument(doc.filePath); } catch (_) {}
    }

    profile.documents = profile.documents.filter(d => d.id !== docId);
    profile.updatedAt = new Date().toISOString();
    await db.upsertProfile(userId, profile);

    res.json({ success: true });
  } catch (err) {
    console.error('Document delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete document.' });
  }
});

// ── POST /api/analyzer/parse-resume ──
app.post('/api/analyzer/parse-resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded. Use field name "resume".' });
    }

    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();
    let resumeText = '';

    // Extract text based on file type
    if (ext === '.txt') {
      resumeText = file.buffer.toString('utf8');
    } else if (ext === '.pdf') {
      try {
        const pdfData = await pdfParse(file.buffer);
        resumeText = pdfData.text || '';
      } catch (pdfErr) {
        console.error('PDF parse error:', pdfErr.message);
        return res.status(400).json({ error: 'Failed to parse PDF file. Please try a .docx or .txt version.' });
      }
    } else if (ext === '.docx') {
      try {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        resumeText = result.value || '';
      } catch (docxErr) {
        console.error('DOCX extraction error:', docxErr.message);
        return res.status(400).json({ error: 'Failed to parse DOCX file.' });
      }
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Supported: .txt, .pdf, .docx' });
    }

    if (!resumeText || resumeText.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract text from the uploaded file.' });
    }

    // Try Gemini API for full structured resume extraction
    let skills = [];
    let parsedResume = {};
    let geminiError = null;
    if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
      try {
        const prompt = `Extract ALL structured information from this resume. Return ONLY a valid JSON object with no markdown or code fences:
{
  "name": "Full Name or empty string",
  "email": "email or empty string",
  "phone": "phone or empty string",
  "linkedin": "linkedin URL/username or empty string",
  "github": "github URL/username or empty string",
  "summary": "2-3 sentence professional summary or empty string",
  "skills": ["Python", "SQL", "Machine Learning"],
  "education": [{"school":"University Name","degree":"Degree Title","dates":"2020 - 2024","gpa":"","courses":""}],
  "experience": [{"title":"Job Title","company":"Company Name","dates":"Jan 2022 - Dec 2023","description":"Key responsibilities","tags":"skill1, skill2"}],
  "certifications": ["AWS Certified Solutions Architect"],
  "projects": [{"name":"Project Name","description":"What it does","technologies":"tech1, tech2"}]
}
IMPORTANT RULES:
- education: scan every section of the resume for any university, college, school, degree, major, GPA, graduation year — include ALL of them
- experience: scan every section for any job title, company, employer, internship, assistantship, freelance work, or volunteer role — include ALL of them
- Use empty strings for missing scalar fields, empty arrays for missing list fields
- Include all roles, internships, and projects
- Only include single-letter items in skills (like "R") if the resume explicitly mentions them as a programming language or tool — never infer them from partial words

Resume text:
${resumeText.slice(0, 10000)}`;

        const GEMINI_FALLBACK_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
        const geminiBody = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' }
        });

        let response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody
        });

        // 503 = model overloaded (preview capacity) — retry with stable 2.0-flash
        if (response.status === 503) {
          console.warn('gemini-2.5-flash 503, retrying with gemini-2.0-flash');
          response = await fetch(`${GEMINI_FALLBACK_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody
          });
        }

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            // Extract JSON — responseMimeType forces raw JSON, regex is safety net
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsedResume = JSON.parse(jsonMatch[0]);
              if (Array.isArray(parsedResume.skills)) {
                skills = parsedResume.skills.filter(s => typeof s === 'string' && s.trim().length > 0);
              }
            } else {
              geminiError = 'no_json_in_response: ' + text.slice(0, 300);
              console.error('Gemini resume parse: no JSON in response:', text.slice(0, 300));
            }
          } else {
            const finishReason = data.candidates?.[0]?.finishReason;
            geminiError = 'no_text_in_response, finishReason=' + finishReason + ', full=' + JSON.stringify(data).slice(0, 300);
            console.error('Gemini resume parse: no text, finishReason:', finishReason, JSON.stringify(data).slice(0, 300));
          }
        } else {
          const errText = await response.text();
          geminiError = 'http_' + response.status + ': ' + errText.slice(0, 300);
          console.error('Gemini resume parse HTTP error:', response.status, errText.slice(0, 300));
        }
      } catch (geminiErr) {
        geminiError = geminiErr.message;
        console.error('Gemini resume parse error:', geminiErr.message);
      }
    }

    // Fallback: basic keyword extraction if Gemini failed
    if (skills.length === 0) {
      const knownSkills = [
        'Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin',
        'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch',
        'React', 'Angular', 'Vue', 'Node.js', 'Express', 'Django', 'Flask', 'Spring', 'Laravel',
        'HTML', 'CSS', 'SASS', 'Tailwind', 'Bootstrap',
        'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Jenkins', 'CI/CD',
        'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'TensorFlow', 'PyTorch', 'Scikit-learn',
        'Data Analysis', 'Data Science', 'Pandas', 'NumPy', 'Tableau', 'Power BI', 'Excel',
        'Git', 'GitHub', 'Linux', 'Agile', 'Scrum', 'Jira',
        'REST', 'GraphQL', 'Microservices', 'API', 'OAuth',
        'Cybersecurity', 'Networking', 'Cloud Computing', 'DevOps',
        'Statistics', 'MATLAB', 'Spark', 'Hadoop', 'Kafka',
        'Figma', 'Sketch', 'Adobe XD', 'UI/UX', 'Product Management',
        'Communication', 'Leadership', 'Project Management', 'Problem Solving', 'Teamwork'
      ];
      // Use word-boundary matching so short tokens like 'Go' or 'R' don't match inside longer words
      skills = knownSkills.filter(skill => {
        const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('\\b' + escaped + '\\b', 'i').test(resumeText);
      });
    }

    const rawText = resumeText.substring(0, 200);

    res.json({
      skills,
      rawText,
      _geminiError:   geminiError || undefined,
      name:           parsedResume.name           || '',
      email:          parsedResume.email          || '',
      phone:          parsedResume.phone          || '',
      linkedin:       parsedResume.linkedin       || '',
      github:         parsedResume.github         || '',
      summary:        parsedResume.summary        || '',
      education:      Array.isArray(parsedResume.education)      ? parsedResume.education      : [],
      experience:     Array.isArray(parsedResume.experience)     ? parsedResume.experience     : [],
      certifications: Array.isArray(parsedResume.certifications) ? parsedResume.certifications : [],
      projects:       Array.isArray(parsedResume.projects)       ? parsedResume.projects       : []
    });

  } catch (err) {
    console.error('Resume parse error:', err.message);
    res.status(500).json({ error: 'Failed to parse resume', message: err.message });
  }
});

// ── POST /api/analyzer/analyze ──
app.post('/api/analyzer/analyze', async (req, res) => {
  const { userSkills, targetRole, region, userId, jobDescription } = req.body;

  if (!targetRole) {
    return res.status(400).json({ error: 'targetRole is required' });
  }

  const jobDescText = (jobDescription || '').trim().slice(0, 4000);

  try {
    // Load user's assessment history and profile in parallel
    const [userAssessments, rawProfile] = await Promise.all([
      userId ? db.getHistoryForUser(userId) : Promise.resolve([]),
      userId ? db.getProfile(userId) : Promise.resolve(null)
    ]);
    const profile = rawProfile || {};
    const profileSkills = profile.skills || [];

    // Build a map of latest assessment scores per skill
    const assessmentScores = {};
    for (const assessment of userAssessments) {
      if (!assessmentScores[assessment.skill] || new Date(assessment.timestamp) > new Date(assessmentScores[assessment.skill].timestamp)) {
        assessmentScores[assessment.skill] = assessment;
      }
    }

    // Combine skills: start with provided userSkills, enrich with assessment scores and profile
    const combinedSkills = [];
    const skillSet = new Set();

    // Add user-provided skills
    if (Array.isArray(userSkills)) {
      for (const s of userSkills) {
        const name = typeof s === 'string' ? s : s.name;
        const score = typeof s === 'object' ? s.score : null;
        if (name && !skillSet.has(name.toLowerCase())) {
          skillSet.add(name.toLowerCase());
          // Use assessment score if available, otherwise provided score
          const assessmentEntry = assessmentScores[name];
          combinedSkills.push({
            name,
            score: assessmentEntry ? assessmentEntry.score : score,
            source: assessmentEntry ? 'assessment' : 'provided'
          });
        }
      }
    }

    // Add assessment skills not already included
    for (const [skill, entry] of Object.entries(assessmentScores)) {
      if (!skillSet.has(skill.toLowerCase())) {
        skillSet.add(skill.toLowerCase());
        combinedSkills.push({
          name: skill,
          score: entry.score,
          source: 'assessment'
        });
      }
    }

    // Add profile skills not already included
    for (const skill of profileSkills) {
      const name = typeof skill === 'string' ? skill : skill.name;
      if (name && !skillSet.has(name.toLowerCase())) {
        skillSet.add(name.toLowerCase());
        combinedSkills.push({
          name,
          score: null,
          source: 'profile'
        });
      }
    }

    // Format skills for prompt
    const skillsForPrompt = combinedSkills.map(s => {
      if (s.score !== null && s.score !== undefined) {
        return `${s.name}: ${s.score}/10 (${s.source})`;
      }
      return `${s.name}: not assessed (${s.source})`;
    }).join('\n');

    // Try Gemini API for analysis
    if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
      try {
        const jobFitBlock = jobDescText
          ? `\n\nThe candidate also pasted a SPECIFIC job posting. Score how likely they are to get THIS exact job (not just the general role) and explain why. Job posting:\n"""\n${jobDescText}\n"""\n\nAdd a "jobFit" object to the response: {"likelihood": 0-100, "label": "Strong Fit"|"Moderate Fit"|"Weak Fit"|"Long Shot", "reason": "1-2 sentence assessment", "blockers": ["Missing skill X", "..."]}.`
          : '';

        const prompt = `You are a career skills gap analyzer. Analyze the gap between a candidate's current skills and their target role.

Candidate's Skills (with assessment scores where available, out of 10):
${skillsForPrompt}

Target Role: ${targetRole}
Region: ${region || 'Global'}${jobFitBlock}

Return a JSON object with this EXACT structure:
{
  "matchScore": 65,
  "summary": "Brief 2-sentence analysis",
  "matchedSkills": [{"name": "Python", "score": 6, "demandPct": 95, "verdict": "Good foundation, needs Advanced level"}],
  "missingSkills": [{"name": "TensorFlow", "priority": "high", "demandPct": 85, "reason": "Required for ML model deployment"}],
  "learningPath": [{"skill": "TensorFlow", "timeEstimate": "4-6 weeks", "resources": [{"title": "TensorFlow Developer Certificate", "type": "Certification", "url": "https://www.tensorflow.org/certificate"}, {"title": "Deep Learning Specialization", "type": "Course", "platform": "Coursera"}]}],
  "assessmentSuggestions": ["Machine Learning", "Python"],
  "salaryInsight": "$75,000 - $95,000 based on current skill level",
  "competitiveness": "Above Average"${jobDescText ? ',\n  "jobFit": {"likelihood": 72, "label": "Moderate Fit", "reason": "...", "blockers": ["..."]}' : ''}
}

IMPORTANT: Return ONLY valid JSON with no markdown formatting, no code fences, just raw JSON.`;

        const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 2048
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            let jsonStr = text.trim();
            if (jsonStr.startsWith('```')) {
              jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            }
            const parsed = JSON.parse(jsonStr);

            // Validate structure
            if (parsed.matchScore !== undefined && parsed.summary) {
              return res.json({
                matchScore: parsed.matchScore || 0,
                summary: parsed.summary || '',
                matchedSkills: parsed.matchedSkills || [],
                missingSkills: parsed.missingSkills || [],
                learningPath: parsed.learningPath || [],
                assessmentSuggestions: parsed.assessmentSuggestions || [],
                salaryInsight: parsed.salaryInsight || 'Not available',
                competitiveness: parsed.competitiveness || 'Not assessed',
                jobFit: jobDescText ? (parsed.jobFit || null) : null
              });
            }
          }
        }
      } catch (geminiErr) {
        console.error('Gemini analyze error:', geminiErr.message);
      }
    }

    // ── Fallback: hardcoded ROLE_DATA matching logic ──
    const ROLE_DATA = {
      'Data Scientist': {
        requiredSkills: ['Python', 'Machine Learning', 'Statistics', 'SQL', 'Data Analysis'],
        optionalSkills: ['Deep Learning', 'TensorFlow', 'PyTorch', 'NLP', 'Spark'],
        salaryRange: '$85,000 - $130,000'
      },
      'Software Engineer': {
        requiredSkills: ['JavaScript', 'Python', 'Git', 'REST', 'SQL'],
        optionalSkills: ['React', 'Node.js', 'Docker', 'Kubernetes', 'TypeScript', 'AWS'],
        salaryRange: '$80,000 - $140,000'
      },
      'Data Analyst': {
        requiredSkills: ['SQL', 'Excel', 'Data Analysis', 'Statistics', 'Python'],
        optionalSkills: ['Tableau', 'Power BI', 'Pandas', 'NumPy'],
        salaryRange: '$55,000 - $85,000'
      },
      'ML Engineer': {
        requiredSkills: ['Python', 'Machine Learning', 'TensorFlow', 'Docker', 'SQL'],
        optionalSkills: ['PyTorch', 'Kubernetes', 'AWS', 'Spark', 'Deep Learning'],
        salaryRange: '$95,000 - $150,000'
      },
      'Frontend Developer': {
        requiredSkills: ['JavaScript', 'React', 'HTML', 'CSS', 'Git'],
        optionalSkills: ['TypeScript', 'Vue', 'Angular', 'Tailwind', 'Node.js'],
        salaryRange: '$70,000 - $120,000'
      },
      'Cloud Engineer': {
        requiredSkills: ['AWS', 'Docker', 'Linux', 'Kubernetes', 'Terraform'],
        optionalSkills: ['Azure', 'GCP', 'CI/CD', 'Python', 'Networking'],
        salaryRange: '$90,000 - $145,000'
      },
      'Cybersecurity Analyst': {
        requiredSkills: ['Cybersecurity', 'Networking', 'Linux', 'Python', 'Cloud Computing'],
        optionalSkills: ['AWS', 'Docker', 'SQL', 'Git', 'Agile'],
        salaryRange: '$70,000 - $120,000'
      },
      'UX Designer': {
        requiredSkills: ['Figma', 'UI/UX', 'Prototyping', 'User Research', 'Sketch'],
        optionalSkills: ['Adobe XD', 'HTML', 'CSS', 'JavaScript', 'Accessibility'],
        salaryRange: '$70,000 - $120,000'
      },
      'Product Manager': {
        requiredSkills: ['Product Management', 'Agile', 'Scrum', 'Communication', 'Problem Solving'],
        optionalSkills: ['SQL', 'Python', 'Figma', 'Jira', 'Leadership'],
        salaryRange: '$95,000 - $150,000'
      },
      'Backend Developer': {
        requiredSkills: ['Python', 'SQL', 'REST', 'Git', 'Docker'],
        optionalSkills: ['Node.js', 'AWS', 'Kubernetes', 'PostgreSQL', 'Redis'],
        salaryRange: '$80,000 - $140,000'
      },
      'DevOps Engineer': {
        requiredSkills: ['Docker', 'Kubernetes', 'CI/CD', 'Linux', 'AWS'],
        optionalSkills: ['Terraform', 'Python', 'Ansible', 'Git', 'Monitoring'],
        salaryRange: '$85,000 - $145,000'
      }
    };

    // Find closest matching role (exact → partial → null for unknown roles)
    const roleKey = Object.keys(ROLE_DATA).find(r => r.toLowerCase() === targetRole.toLowerCase())
      || Object.keys(ROLE_DATA).find(r => targetRole.toLowerCase().includes(r.toLowerCase().split(' ')[0]))
      || null;

    // When no matching role found, return a skill-agnostic response using the user's own skills
    if (!roleKey) {
      const matchScore = combinedSkills.length > 0 ? Math.min(100, combinedSkills.length * 8) : 0;
      return res.json({
        matchScore,
        summary: `You have ${combinedSkills.length} skills on your profile. Add more skills and run assessments to get a detailed gap analysis for ${targetRole}.`,
        matchedSkills: combinedSkills.map(s => ({ name: s.name, score: s.score || null, demandPct: 70, verdict: 'Listed on profile' })),
        missingSkills: [],
        learningPath: [],
        assessmentSuggestions: combinedSkills.slice(0, 5).map(s => s.name),
        salaryInsight: 'Search job boards for current salary data',
        competitiveness: 'Not assessed',
        jobFit: null
      });
    }

    const roleInfo = ROLE_DATA[roleKey];

    const matchedSkills = [];
    const missingSkills = [];
    let matchCount = 0;

    const allRequired = [...roleInfo.requiredSkills, ...roleInfo.optionalSkills];

    for (const reqSkill of roleInfo.requiredSkills) {
      const found = combinedSkills.find(s => s.name.toLowerCase() === reqSkill.toLowerCase());
      if (found) {
        matchCount++;
        matchedSkills.push({
          name: reqSkill,
          score: found.score || null,
          demandPct: 90,
          verdict: found.score >= 7 ? 'Strong match' : found.score >= 4 ? 'Good foundation, needs improvement' : 'Needs significant improvement'
        });
      } else {
        missingSkills.push({
          name: reqSkill,
          priority: 'high',
          demandPct: 90,
          reason: `Core requirement for ${targetRole}`
        });
      }
    }

    for (const optSkill of roleInfo.optionalSkills) {
      const found = combinedSkills.find(s => s.name.toLowerCase() === optSkill.toLowerCase());
      if (found) {
        matchCount++;
        matchedSkills.push({
          name: optSkill,
          score: found.score || null,
          demandPct: 65,
          verdict: found.score >= 7 ? 'Strong match' : 'Adequate'
        });
      } else {
        missingSkills.push({
          name: optSkill,
          priority: 'medium',
          demandPct: 65,
          reason: `Beneficial for ${targetRole}`
        });
      }
    }

    const matchScore = allRequired.length > 0 ? Math.round((matchCount / allRequired.length) * 100) : 0;

    const learningPath = missingSkills.filter(s => s.priority === 'high').map(s => ({
      skill: s.name,
      timeEstimate: '4-8 weeks',
      resources: [
        { title: `Learn ${s.name}`, type: 'Course', platform: 'Coursera' },
        { title: `${s.name} Documentation`, type: 'Documentation', url: '#' }
      ]
    }));

    const assessmentSuggestions = allRequired
      .filter(s => {
        const found = combinedSkills.find(cs => cs.name.toLowerCase() === s.toLowerCase());
        return !found || found.score === null;
      })
      .slice(0, 5);

    let fallbackJobFit = null;
    if (jobDescText) {
      const jdLower = jobDescText.toLowerCase();
      let jdMatched = 0;
      let jdTotal = 0;
      const blockers = [];
      for (const reqSkill of allRequired) {
        if (jdLower.includes(reqSkill.toLowerCase())) {
          jdTotal++;
          const found = combinedSkills.find(s => s.name.toLowerCase() === reqSkill.toLowerCase());
          if (found) jdMatched++;
          else blockers.push(reqSkill);
        }
      }
      const likelihood = jdTotal > 0 ? Math.round((jdMatched / jdTotal) * 100) : matchScore;
      fallbackJobFit = {
        likelihood,
        label: likelihood >= 75 ? 'Strong Fit' : likelihood >= 50 ? 'Moderate Fit' : likelihood >= 25 ? 'Weak Fit' : 'Long Shot',
        reason: `You match ${jdMatched} of ${jdTotal} skills explicitly mentioned in this posting.`,
        blockers: blockers.slice(0, 5)
      };
    }

    res.json({
      matchScore,
      summary: `You match ${matchScore}% of the skills required for a ${targetRole} role. ${missingSkills.filter(s => s.priority === 'high').length} critical skills need attention.`,
      matchedSkills,
      missingSkills,
      learningPath,
      assessmentSuggestions,
      salaryInsight: roleInfo.salaryRange,
      competitiveness: matchScore >= 75 ? 'Strong' : matchScore >= 50 ? 'Above Average' : matchScore >= 25 ? 'Average' : 'Below Average',
      jobFit: fallbackJobFit
    });

  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: 'Failed to analyze skills gap', message: err.message });
  }
});

// ── POST /api/analyzer/save-report — save a report to user's profile ──
app.post('/api/analyzer/save-report', requireAuth, async (req, res) => {
  const userId = req.authenticatedUserId;
  const { report } = req.body;
  if (!report || typeof report !== 'object') {
    return res.status(400).json({ error: 'report is required' });
  }
  try {
    const profile = normalizeProfile(await db.getProfile(userId), userId);
    const reports = Array.isArray(profile.analyzerReports) ? profile.analyzerReports.slice() : [];
    const meta = report._meta || {};
    const fullJd = meta.jobDescription ? String(meta.jobDescription).slice(0, 4000) : '';
    const existingId = meta.existingId || null;
    const existingIdx = existingId ? reports.findIndex(r => r.id === existingId) : -1;
    const slim = {
      id: existingIdx !== -1 ? existingId : ('rpt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      role: meta.role || '',
      region: meta.region || '',
      date: meta.date || new Date().toISOString(),
      hasJobDescription: !!fullJd,
      jobDescription: fullJd,
      jobDescriptionPreview: fullJd ? fullJd.slice(0, 200) : '',
      matchScore: report.matchScore || 0,
      jobFit: report.jobFit || null,
      summary: report.summary || '',
      matchedSkills: report.matchedSkills || [],
      missingSkills: report.missingSkills || [],
      learningPath: report.learningPath || [],
      assessmentSuggestions: report.assessmentSuggestions || [],
      salaryInsight: report.salaryInsight || '',
      competitiveness: report.competitiveness || ''
    };
    if (existingIdx !== -1) {
      reports.splice(existingIdx, 1, slim); // Update in place
    } else {
      reports.unshift(slim); // New report
    }
    profile.analyzerReports = reports.slice(0, 50);
    const saved = await db.upsertProfile(userId, profile);
    if (saved._droppedColumns && saved._droppedColumns.indexOf('analyzerReports') !== -1) {
      // The save silently dropped the report data because the DB is missing
      // the analyzer_reports column. Return a real error so the client can
      // surface it instead of pretending the save worked.
      return res.status(503).json({
        error: 'Saved reports require a one-time database migration. Ask the admin to run this SQL in Supabase: ALTER TABLE profiles ADD COLUMN IF NOT EXISTS analyzer_reports JSONB DEFAULT \'[]\'::jsonb;',
        needsMigration: true
      });
    }
    res.json({ success: true, report: slim, count: profile.analyzerReports.length });
  } catch (err) {
    console.error('Save report error:', err.message);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

// ── DELETE /api/analyzer/reports/:id ──
app.delete('/api/analyzer/reports/:id', requireAuth, async (req, res) => {
  const userId = req.authenticatedUserId;
  try {
    const profile = normalizeProfile(await db.getProfile(userId), userId);
    const reports = (profile.analyzerReports || []).filter(r => r.id !== req.params.id);
    profile.analyzerReports = reports;
    await db.upsertProfile(userId, profile);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete report error:', err.message);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// ── GET /api/analyzer/user-skills ──
app.get('/api/analyzer/user-skills', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const [userAssessments, rawProfile] = await Promise.all([
      db.getHistoryForUser(userId),
      db.getProfile(userId)
    ]);
    const profile = rawProfile || {};
    const profileSkills = profile.skills || [];

    // Get latest assessment score per skill
    const assessmentScores = {};
    for (const assessment of userAssessments) {
      if (!assessmentScores[assessment.skill] || new Date(assessment.timestamp) > new Date(assessmentScores[assessment.skill].timestamp)) {
        assessmentScores[assessment.skill] = assessment;
      }
    }

    // Combine skills - assessment scores take priority
    const skills = [];
    const skillSet = new Set();

    // Add assessment skills first (they have real scores)
    for (const [skillName, entry] of Object.entries(assessmentScores)) {
      skillSet.add(skillName.toLowerCase());
      skills.push({
        name: skillName,
        score: entry.score,
        level: getSkillLevel(entry.score),
        source: 'assessment'
      });
    }

    // Add profile skills not already covered by assessments
    for (const skill of profileSkills) {
      const name = typeof skill === 'string' ? skill : skill.name;
      if (name && !skillSet.has(name.toLowerCase())) {
        skillSet.add(name.toLowerCase());
        skills.push({
          name,
          score: null,
          level: null,
          source: 'profile'
        });
      }
    }

    res.json({ skills });

  } catch (err) {
    console.error('User skills error:', err.message);
    res.status(500).json({ error: 'Failed to load user skills', message: err.message });
  }
});

// ══════════════════════════════════════════════
// ── Peer Coaching Module (Supabase)
// ══════════════════════════════════════════════

// ── Eligibility: check which skills user can coach (8+) and needs help (<=5) ──
app.get('/api/peer-coaching/eligibility', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const [history, coach] = await Promise.all([
      db.getHistoryForUser(userId),
      db.getCoach(userId)
    ]);

    // Get latest score per skill for this user
    const latestScores = {};
    history.forEach(h => {
      if (!latestScores[h.skill] || new Date(h.timestamp) > new Date(latestScores[h.skill].timestamp)) {
        latestScores[h.skill] = { score: h.score, timestamp: h.timestamp, level: h.skillLevel };
      }
    });

    const canCoach = [];
    const needsHelp = [];

    Object.entries(latestScores).forEach(([skill, data]) => {
      if (data.score >= 8) canCoach.push({ skill, score: data.score, level: data.level, verifiedAt: data.timestamp });
      if (data.score <= 5) needsHelp.push({ skill, score: data.score, level: data.level });
    });

    res.json({ canCoach, needsHelp, hasProfile: !!coach, latestScores });
  } catch (err) {
    res.status(500).json({ error: 'Eligibility check failed', message: err.message });
  }
});

// ── Save/update coach profile ──
app.post('/api/peer-coaching/coach-profile', async (req, res) => {
  try {
    const { userId, skillsOffered, headline, bio, sessionLengths } = req.body;
    if (!userId || !skillsOffered || skillsOffered.length === 0) {
      return res.status(400).json({ error: 'userId and at least one skill required' });
    }

    const cleanHeadline = (headline || '').slice(0, 80);
    const cleanBio = (bio || '').slice(0, 300);

    const [history, profile, existing] = await Promise.all([
      db.getHistoryForUser(userId),
      db.getProfile(userId),
      db.getCoach(userId)
    ]);

    const latestScores = {};
    history.forEach(h => {
      if (!latestScores[h.skill] || new Date(h.timestamp) > new Date(latestScores[h.skill].timestamp)) {
        latestScores[h.skill] = { score: h.score, timestamp: h.timestamp };
      }
    });

    const verifiedSkills = [];
    skillsOffered.forEach(skill => {
      if (latestScores[skill] && latestScores[skill].score >= 8) {
        verifiedSkills.push({ skill, score: latestScores[skill].score, verifiedAt: latestScores[skill].timestamp });
      }
    });

    if (verifiedSkills.length === 0) {
      return res.status(403).json({ error: 'No verified skills (score 8+) among selected skills' });
    }

    const displayName = profile?.name || userId.split('@')[0];
    const coach = await db.upsertCoach(userId, {
      userId,
      name: displayName,
      avatar: displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
      skillsOffered: verifiedSkills.map(v => v.skill),
      headline: cleanHeadline,
      bio: cleanBio,
      verifiedSkills,
      sessionLengths: sessionLengths || [15, 20],
      active: true,
      createdAt: existing?.createdAt || new Date().toISOString()
    });

    res.json({ success: true, coach });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save coach profile', message: err.message });
  }
});

// ── Get coach profile ──
app.get('/api/peer-coaching/coach-profile', async (req, res) => {
  try {
    const userId = req.query.userId;
    const coach = userId ? await db.getCoach(userId) : null;
    res.json({ coach: coach || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load coach profile' });
  }
});

// ── List coaches (with optional skill filter) ──
app.get('/api/peer-coaching/coaches', async (req, res) => {
  try {
    const skill = req.query.skill;
    const sort = req.query.sort || 'match';
    const userId = req.query.userId;

    const [coachMap, reviews, bookings] = await Promise.all([
      db.getAllCoaches(), db.getAllReviews(), db.getAllBookings()
    ]);
    const coaches = coachMap;

    // Compute stats per coach
    let coachList = Object.values(coaches).filter(c => c.active);

    // Exclude current user from results
    if (userId) coachList = coachList.filter(c => c.userId !== userId);

    // Filter by skill
    if (skill) coachList = coachList.filter(c => c.skillsOffered.includes(skill));

    // Enrich with stats
    coachList = coachList.map(c => {
      const coachReviews = reviews.filter(r => r.coachUserId === c.userId);
      const avgRating = coachReviews.length > 0
        ? coachReviews.reduce((sum, r) => sum + r.rating, 0) / coachReviews.length
        : 0;
      const sessionCount = bookings.filter(b => b.coachUserId === c.userId && b.status === 'completed').length;
      const topScore = c.verifiedSkills.reduce((max, v) => Math.max(max, v.score), 0);

      return {
        ...c,
        avgRating: Math.round(avgRating * 10) / 10,
        reviewCount: coachReviews.length,
        sessionCount,
        topScore,
        matchScore: topScore * 0.5 + avgRating * 0.3 + Math.min(sessionCount, 10) * 0.2
      };
    });

    // Sort
    if (sort === 'rating') coachList.sort((a, b) => b.avgRating - a.avgRating);
    else if (sort === 'score') coachList.sort((a, b) => b.topScore - a.topScore);
    else if (sort === 'recent') coachList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    else coachList.sort((a, b) => b.matchScore - a.matchScore);

    res.json({ coaches: coachList });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load coaches', message: err.message });
  }
});

// ── Book a session ──
app.post('/api/peer-coaching/book', async (req, res) => {
  try {
    const { skill, coachUserId, learnerUserId, actorUserId, duration, scheduledAt, goal } = req.body;
    const requesterId = actorUserId || learnerUserId;
    if (!skill || !coachUserId || !requesterId) {
      return res.status(400).json({ error: 'skill, coachUserId, and actorUserId required' });
    }
    if (coachUserId === requesterId) {
      return res.status(400).json({ error: 'You cannot book a session with yourself' });
    }

    const [coach, bookings] = await Promise.all([db.getCoach(coachUserId), db.getAllBookings()]);
    if (!coach || !coach.skillsOffered.includes(skill)) {
      return res.status(400).json({ error: 'Coach does not offer this skill' });
    }

    const existingActive = bookings.find(b =>
      b.coachUserId === coachUserId &&
      b.learnerUserId === requesterId &&
      b.skill === skill &&
      ['pending', 'confirmed'].includes(b.status)
    );
    if (existingActive) {
      return res.status(400).json({ error: 'You already have an active session request for this coach and skill' });
    }

    const booking = await db.insertBooking({
      id: 'BK-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      skill,
      coachUserId,
      learnerUserId: requesterId,
      status: 'pending',
      scheduledAt: scheduledAt || null,
      duration: duration || 20,
      goal: goal || '',
      createdAt: new Date().toISOString()
    });

    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ error: 'Booking failed', message: err.message });
  }
});

// ── Get bookings for a user ──
app.get('/api/peer-coaching/bookings', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const [allBookings, coaches, profiles, reviews] = await Promise.all([
      db.getAllBookings(), db.getAllCoaches(), db.getAllProfiles(), db.getAllReviews()
    ]);

    const userBookings = allBookings.filter(b => b.coachUserId === userId || b.learnerUserId === userId);

    const enriched = userBookings.map(b => {
      const coachName = coaches[b.coachUserId]?.name || profiles[b.coachUserId]?.name || b.coachUserId;
      const learnerName = profiles[b.learnerUserId]?.name || b.learnerUserId;
      const role = b.coachUserId === userId ? 'coach' : 'learner';
      const hasReview = reviews.some(r => r.bookingId === b.id && r.learnerUserId === b.learnerUserId);
      return { ...b, coachName, learnerName, role, hasReview };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ bookings: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bookings', message: err.message });
  }
});

// ── Update booking status ──
app.put('/api/peer-coaching/bookings/:id', async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { status, actorUserId } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (!actorUserId) {
      return res.status(400).json({ error: 'actorUserId required' });
    }

    const booking = await db.getBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isCoach = booking.coachUserId === actorUserId;
    const isLearner = booking.learnerUserId === actorUserId;
    if (!isCoach && !isLearner) {
      return res.status(403).json({ error: 'You are not allowed to update this booking' });
    }

    const transitionRules = {
      pending:   { confirmed: isCoach, cancelled: isCoach || isLearner },
      confirmed: { completed: isCoach, cancelled: isCoach || isLearner },
      completed: {}, cancelled: {}
    };
    if (!transitionRules[booking.status]?.[status]) {
      return res.status(400).json({ error: 'Invalid status transition for this user' });
    }

    const updated = await db.updateBooking(bookingId, { status });
    res.json({ success: true, booking: updated });
  } catch (err) {
    res.status(500).json({ error: 'Update failed', message: err.message });
  }
});

// ── Submit review ──
app.post('/api/peer-coaching/review', async (req, res) => {
  try {
    const { bookingId, actorUserId, rating, feedback, wouldRecommend } = req.body;
    if (!bookingId || rating === undefined || rating === null) return res.status(400).json({ error: 'bookingId and rating required' });
    if (!actorUserId) return res.status(400).json({ error: 'actorUserId required' });
    const parsedRating = parseInt(rating);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ error: 'Rating must be a number between 1 and 5' });
    }

    const [booking, reviews] = await Promise.all([db.getBookingById(bookingId), db.getAllReviews()]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.learnerUserId !== actorUserId) {
      return res.status(403).json({ error: 'Only the learner can review this session' });
    }
    if (booking.status !== 'completed') {
      return res.status(400).json({ error: 'Session must be completed before it can be reviewed' });
    }
    if (reviews.find(r => r.bookingId === bookingId && r.learnerUserId === actorUserId)) {
      return res.status(400).json({ error: 'Already reviewed this session' });
    }

    await db.insertReview({
      bookingId,
      coachUserId: booking.coachUserId,
      learnerUserId: booking.learnerUserId,
      rating: parsedRating,
      feedback: feedback || '',
      wouldRecommend: wouldRecommend !== false,
      createdAt: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Review failed', message: err.message });
  }
});

// ── Recommendations: suggest coaches based on user's weak skills ──
app.get('/api/peer-coaching/recommendations', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const [history, coaches, reviews, bookings] = await Promise.all([
      db.getHistoryForUser(userId), db.getAllCoaches(), db.getAllReviews(), db.getAllBookings()
    ]);

    const latestScores = {};
    history.forEach(h => {
      if (!latestScores[h.skill] || new Date(h.timestamp) > new Date(latestScores[h.skill].timestamp)) {
        latestScores[h.skill] = { score: h.score, timestamp: h.timestamp };
      }
    });

    const weakSkills = Object.entries(latestScores)
      .filter(([_, d]) => d.score <= 5)
      .map(([skill, d]) => ({ skill, score: d.score }));

    if (weakSkills.length === 0) return res.json({ recommendations: [] });

    // Find coaches for these skills
    const recommendations = [];
    weakSkills.forEach(ws => {
      const skillCoaches = Object.values(coaches)
        .filter(c => c.active && c.userId !== userId && c.skillsOffered.includes(ws.skill))
        .map(c => {
          const coachReviews = reviews.filter(r => r.coachUserId === c.userId);
          const avgRating = coachReviews.length > 0
            ? coachReviews.reduce((s, r) => s + r.rating, 0) / coachReviews.length : 0;
          const skillVerified = c.verifiedSkills.find(v => v.skill === ws.skill);
          const coachScore = skillVerified ? skillVerified.score : 0;
          const sessCount = bookings.filter(b => b.coachUserId === c.userId && b.status === 'completed').length;

          return {
            ...c,
            matchSkill: ws.skill,
            learnerScore: ws.score,
            coachScore,
            avgRating: Math.round(avgRating * 10) / 10,
            sessionCount: sessCount,
            matchScore: coachScore * 5 + avgRating * 3 + Math.min(sessCount, 10) * 2
          };
        })
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 3);

      recommendations.push({ skill: ws.skill, learnerScore: ws.score, coaches: skillCoaches });
    });

    res.json({ recommendations });
  } catch (err) {
    res.status(500).json({ error: 'Recommendations failed', message: err.message });
  }
});

// ── Coaching analytics (for dashboard / demo) ──
app.get('/api/peer-coaching/analytics', async (req, res) => {
  try {
    const [coaches, bookings, reviews, history] = await Promise.all([
      db.getAllCoaches(), db.getAllBookings(), db.getAllReviews(), db.getAllHistory()
    ]);

    const activeCoaches = Object.values(coaches).filter(c => c.active).length;
    const totalBookings = bookings.length;
    const completedSessions = bookings.filter(b => b.status === 'completed').length;
    const avgRating = reviews.length > 0
      ? Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length * 10) / 10
      : 0;

    // Most requested skills
    const skillDemand = {};
    bookings.forEach(b => { skillDemand[b.skill] = (skillDemand[b.skill] || 0) + 1; });
    const topSkills = Object.entries(skillDemand)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([skill, count]) => ({ skill, count }));

    res.json({
      activeCoaches,
      totalBookings,
      completedSessions,
      avgRating,
      totalReviews: reviews.length,
      topSkills
    });
  } catch (err) {
    res.status(500).json({ error: 'Analytics failed' });
  }
});

// ── Peer Chat ──
// Pre-booking inquiry threads use a synthetic bookingId of the form
// "inquiry__<coachId>__<learnerId>". They reuse chat_messages without needing
// a real booking row. parseInquiryBookingId returns null for normal booking ids.
function parseInquiryBookingId(bookingId) {
  if (typeof bookingId !== 'string' || !bookingId.startsWith('inquiry__')) return null;
  const rest = bookingId.slice('inquiry__'.length);
  const sep = rest.indexOf('__');
  if (sep < 0) return null;
  const coachId = rest.slice(0, sep);
  const learnerId = rest.slice(sep + 2);
  if (!coachId || !learnerId) return null;
  return { coachId: coachId.toLowerCase(), learnerId: learnerId.toLowerCase() };
}

async function authorizeChatAccess(bookingId, userId) {
  const inquiry = parseInquiryBookingId(bookingId);
  if (inquiry) {
    const u = (userId || '').toLowerCase();
    if (u !== inquiry.coachId && u !== inquiry.learnerId) {
      return { ok: false, status: 403, error: 'Access denied' };
    }
    // The "coach" side of an inquiry must be a registered, active coach.
    // Without this check, the inquiry channel becomes a backdoor DM where any
    // logged-in user could spam any other email by claiming they're a coach.
    const coach = await db.getCoach(inquiry.coachId);
    if (!coach || coach.active === false) {
      return { ok: false, status: 404, error: 'This coach is not available for messages.' };
    }
    return { ok: true, isInquiry: true, inquiry };
  }
  const booking = await db.getBookingById(bookingId);
  if (!booking) return { ok: false, status: 404, error: 'Booking not found' };
  if (booking.coachUserId !== userId && booking.learnerUserId !== userId) {
    return { ok: false, status: 403, error: 'Access denied' };
  }
  return { ok: true, isInquiry: false, booking };
}

app.get('/api/chat/:bookingId', requireAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.authenticatedUserId;
    const auth = await authorizeChatAccess(bookingId, userId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const messages = await db.getChatMessages(bookingId);
    res.json({ messages });
  } catch (err) {
    console.error('GET /api/chat error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/chat/:bookingId', requireAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.authenticatedUserId;
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
    const auth = await authorizeChatAccess(bookingId, userId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const message = await db.insertChatMessage(bookingId, userId, content.trim());
    res.json({ message });
  } catch (err) {
    console.error('POST /api/chat error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── GET /api/chat/recent — latest message per booking for the current user ──
app.get('/api/chat/recent', requireAuth, async (req, res) => {
  try {
    const userId = req.authenticatedUserId;
    const userIdLower = (userId || '').toLowerCase();
    const [allBookings, coaches, profiles, inquiryMessages] = await Promise.all([
      db.getAllBookings(), db.getAllCoaches(), db.getAllProfiles(), db.getAllInquiryMessages()
    ]);
    const userBookings = allBookings.filter(b => b.coachUserId === userId || b.learnerUserId === userId);
    const items = [];
    for (const booking of userBookings) {
      const messages = await db.getChatMessages(booking.id);
      if (messages.length === 0) continue;
      const last = messages[messages.length - 1];
      const isCoach = booking.coachUserId === userId;
      const otherName = isCoach
        ? (profiles[booking.learnerUserId]?.name || booking.learnerUserId)
        : (coaches[booking.coachUserId]?.name || profiles[booking.coachUserId]?.name || booking.coachUserId);
      items.push({
        bookingId: booking.id,
        skill: booking.skill,
        kind: 'session',
        lastMessageAt: last.createdAt,
        lastSenderId: last.senderId,
        preview: last.content.slice(0, 80),
        otherPersonName: otherName
      });
    }

    // Surface inquiry threads (pre-booking chats) too
    const inquiryThreads = new Map();
    for (const m of inquiryMessages) {
      const parsed = parseInquiryBookingId(m.bookingId);
      if (!parsed) continue;
      if (parsed.coachId !== userIdLower && parsed.learnerId !== userIdLower) continue;
      // keep latest message per thread
      const prev = inquiryThreads.get(m.bookingId);
      if (!prev || new Date(m.createdAt) > new Date(prev.createdAt)) {
        inquiryThreads.set(m.bookingId, m);
      }
    }
    for (const [bookingId, last] of inquiryThreads) {
      const parsed = parseInquiryBookingId(bookingId);
      const isCoach = parsed.coachId === userIdLower;
      const otherId = isCoach ? parsed.learnerId : parsed.coachId;
      const otherName = (coaches[otherId]?.name) || (profiles[otherId]?.name) || otherId;
      items.push({
        bookingId,
        skill: 'Inquiry',
        kind: 'inquiry',
        lastMessageAt: last.createdAt,
        lastSenderId: last.senderId,
        preview: last.content.slice(0, 80),
        otherPersonName: otherName
      });
    }

    res.json({ items });
  } catch (err) {
    console.error('GET /api/chat/recent error:', err);
    res.status(500).json({ error: 'Failed to fetch recent chats' });
  }
});

// ── POST /api/profile/upload-resume — upload resume + AI-extract education & experience ──
app.post('/api/profile/upload-resume', requireAuth, documentUpload.single('resume'), async (req, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded. Supported formats: PDF, DOCX.' });

    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.pdf', '.docx', '.doc'].includes(ext)) {
      return res.status(400).json({ error: 'Only PDF and DOCX files are supported.' });
    }

    // Extract raw text
    let resumeText = '';
    if (ext === '.pdf') {
      try {
        const pdfData = await pdfParse(file.buffer);
        resumeText = pdfData.text || '';
      } catch (e) { console.error('PDF parse error:', e.message); }
    } else {
      try {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        resumeText = result.value || '';
      } catch (e) { console.error('DOCX parse error:', e.message); }
    }

    // Upload file to Supabase Storage. We catch failure here so a missing
    // bucket / RLS policy / wrong key doesn't prevent the rest of the flow
    // (AI extraction + profile save) from working. Without this, any storage
    // hiccup blocked the resume from being recorded at all.
    const docId = Date.now().toString(36);
    const safeFilename = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) + ext;
    let filePath = null;
    let publicUrl = null;
    let storageWarning = null;
    try {
      const uploaded = await db.uploadDocument(userId, docId, safeFilename, file.buffer, file.mimetype);
      filePath = uploaded.filePath;
      publicUrl = uploaded.publicUrl;
    } catch (storageErr) {
      console.error('Storage upload failed (continuing without file save):', storageErr.message || storageErr);
      storageWarning = 'File scanned successfully, but the original could not be saved to storage. ' +
        'You will not be able to download it later. (Server log has details.)';
    }
    const doc = {
      id: docId, name: file.originalname, filePath,
      size: file.size, type: ext.slice(1), url: publicUrl,
      uploadedAt: new Date().toISOString()
    };

    // Load profile and add document
    const rawProfile = await db.getProfile(userId);
    const profile = normalizeProfile(rawProfile, userId);
    profile.documents = [...(profile.documents || []), doc];
    profile.updatedAt = new Date().toISOString();

    // AI: extract education, experience, and skills in one call
    let extractedEducation = [];
    let extractedExperience = [];
    let extractedSkills = [];
    if (resumeText.trim().length > 0 && GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
      try {
        const prompt = `Extract education, work/internship experience, and professional skills from this resume.
Return ONLY a valid JSON object with no other text, markdown, or code fences:
{
  "education": [{"school":"...","degree":"...","dates":"e.g. 2020 - 2024","gpa":"","courses":""}],
  "experience": [{"title":"...","company":"...","dates":"e.g. 2022 - 2023","description":"...","tags":"comma-separated skills"}],
  "skills": ["Python", "SQL", "Machine Learning"]
}
IMPORTANT: scan the ENTIRE resume for any university, college, job, internship, or role — include ALL of them. If a field is unknown leave it as an empty string.

Resume:
${resumeText.slice(0, 10000)}`;
        const GEMINI_FALLBACK_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
        const geminiBody = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' } });
        let response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody
        });
        if (response.status === 503) {
          console.warn('gemini-2.5-flash 503 on profile upload, retrying with gemini-2.0-flash');
          response = await fetch(`${GEMINI_FALLBACK_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody
          });
        }
        if (response.ok) {
          const aiData = await response.json();
          const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
            if (parsed && Array.isArray(parsed.education)) {
              extractedEducation = parsed.education.filter(e => e && e.school && e.degree);
            }
            if (parsed && Array.isArray(parsed.experience)) {
              extractedExperience = parsed.experience.filter(e => e && e.title && e.company);
            }
            if (parsed && Array.isArray(parsed.skills)) {
              extractedSkills = parsed.skills.filter(s => typeof s === 'string' && s.trim());
            }
          }
        }
      } catch (e) { console.error('Resume AI extraction error:', e.message); }
    }

    // Merge extracted education into profile (deduplicated)
    extractedEducation.forEach(edu => {
      const exists = profile.education.some(e => e.school === edu.school && e.degree === edu.degree);
      if (!exists) profile.education.push({ school: edu.school || '', degree: edu.degree || '', dates: edu.dates || '', gpa: edu.gpa || '', courses: edu.courses || '' });
    });

    // Merge extracted experience into profile (deduplicated)
    extractedExperience.forEach(exp => {
      const exists = profile.experience.some(e => e.title === exp.title && e.company === exp.company);
      if (!exists) profile.experience.push({
        title: exp.title || '',
        company: exp.company || '',
        dates: exp.dates || '',
        description: exp.description || '',
        tags: typeof exp.tags === 'string' ? exp.tags.split(',').map(t => t.trim()).filter(Boolean) : (Array.isArray(exp.tags) ? exp.tags : [])
      });
    });

    // Merge extracted skills into profile (deduplicated, case-insensitive)
    const existingSkillNames = new Set(profile.skills.map(s => (typeof s === 'string' ? s : s.name || '').toLowerCase()));
    extractedSkills.forEach(skillName => {
      if (!existingSkillNames.has(skillName.toLowerCase())) {
        profile.skills.push({ name: skillName, mastery: null });
        existingSkillNames.add(skillName.toLowerCase());
      }
    });

    await db.upsertProfile(userId, profile);
    res.json({ success: true, document: doc, extractedEducation, extractedExperience, extractedSkills, storageWarning });
  } catch (err) {
    console.error('Resume upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload resume: ' + err.message });
  }
});

// ── Health Check (useful for Railway / Render) ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    dataDir: DATA_DIR,
    geminiConfigured: !!(GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here'),
    adzunaConfigured: !!(ADZUNA_APP_ID && ADZUNA_APP_ID !== 'your_adzuna_app_id_here')
  });
});

// ── Catch-all: serve index.html for SPA ──
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ── Start Server ──
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🚀 SkillGap Analyzer server running at http://localhost:${PORT}`);
  console.log(`💾 Data directory: ${DATA_DIR}`);
  console.log(`📚 Question bank loaded: ${Object.keys(questionBank).length} skills`);
  Object.keys(questionBank).forEach(skill => {
    console.log(`   • ${skill}: ${questionBank[skill].length} questions`);
  });
  console.log(`📝 Assessment: ${TOTAL_QUESTIONS} questions (${SEED_QUESTIONS} seed + ${TOTAL_QUESTIONS - SEED_QUESTIONS} AI-generated)`);
  console.log(`🤖 Gemini API: ${GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here' ? 'Configured ✓' : 'Not configured (using seed questions only)'}`);
  console.log(`💼 Adzuna API: ${ADZUNA_APP_ID && ADZUNA_APP_ID !== 'your_adzuna_app_id_here' ? 'Configured ✓' : 'Not configured (using Muse + Arbeitnow only)'}`);
  console.log(`🧹 Session cleanup: every 10 minutes (max age: 1 hour)`);
  console.log('');
});
