// ══════════════════════════════════════
// SkillGap Analyzer – Universal App JS
// ══════════════════════════════════════

// ── App Dialog & Toast (replaces native confirm/alert) ──
// showAppToast: non-blocking notification, auto-dismisses.
// showAppConfirm: returns Promise<boolean>; callers must await.
// window.alert is overridden to use showAppToast (alert has no return value).
// window.confirm is NOT overridden — it's synchronous and async modals can't
// emulate that. All callers have been migrated to await showAppConfirm().
var _appToastTimer = null;
function showAppToast(msg, type) {
  type = type || 'info';
  var el = document.getElementById('appToast');
  var msgEl = document.getElementById('appToastMsg');
  var iconEl = document.getElementById('appToastIcon');
  if (!el || !msgEl) { console.log('[' + type + '] ' + msg); return; }
  msgEl.textContent = String(msg);
  el.className = 'app-toast app-toast-' + type;
  el.style.display = 'flex';
  if (iconEl) iconEl.textContent = type === 'error' ? '!' : type === 'success' ? '✓' : type === 'warn' ? '!' : 'i';
  if (_appToastTimer) clearTimeout(_appToastTimer);
  var ttl = (type === 'error' || (msg && String(msg).length > 80)) ? 5500 : 3500;
  _appToastTimer = setTimeout(function() { el.style.display = 'none'; }, ttl);
}
function dismissAppToast() {
  var el = document.getElementById('appToast');
  if (el) el.style.display = 'none';
  if (_appToastTimer) { clearTimeout(_appToastTimer); _appToastTimer = null; }
}
function showAppConfirm(message, opts) {
  opts = opts || {};
  return new Promise(function(resolve) {
    var modal = document.getElementById('appDialog');
    var titleEl = document.getElementById('appDialogTitle');
    var msgEl = document.getElementById('appDialogMessage');
    var iconEl = document.getElementById('appDialogIcon');
    var cancelBtn = document.getElementById('appDialogCancel');
    var okBtn = document.getElementById('appDialogOk');
    if (!modal) { resolve(window.confirm(message)); return; } // SSR / missing markup fallback

    titleEl.textContent = opts.title || 'Confirm';
    msgEl.textContent = String(message);
    iconEl.textContent = opts.danger ? '!' : opts.success ? '✓' : '?';
    iconEl.className = 'app-dialog-icon' + (opts.danger ? ' danger' : opts.success ? ' success' : '');
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';
    okBtn.textContent = opts.okLabel || 'OK';
    okBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    cancelBtn.style.display = opts.alertOnly ? 'none' : '';
    modal.style.display = 'flex';
    setTimeout(function() { okBtn.focus(); }, 50);

    function cleanup(result) {
      modal.style.display = 'none';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', escHandler);
      resolve(result);
    }
    function escHandler(e) {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    }
    okBtn.onclick = function() { cleanup(true); };
    cancelBtn.onclick = function() { cleanup(false); };
    modal.onclick = function(e) { if (e.target === modal) cleanup(false); };
    document.addEventListener('keydown', escHandler);
  });
}
// Override native alert. We can't override confirm — synchronous return required.
window.alert = function(msg) {
  var s = String(msg || '');
  var type = /(fail|error|cannot|invalid|denied)/i.test(s) ? 'error' : 'info';
  showAppToast(s, type);
};

function parseStoredJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

// ── Auth Token Interceptor ──
// Automatically attaches the stored bearer token to all /api/ requests.
(function() {
  const _fetch = window.fetch.bind(window);
  window.fetch = function(url, options) {
    const urlStr = typeof url === 'string' ? url : (url && url.url) || '';
    if (urlStr.startsWith('/api/')) {
      const token = localStorage.getItem('sgaAuthToken') || sessionStorage.getItem('sgaAuthToken');
      if (token) {
        options = options ? Object.assign({}, options) : {};
        options.headers = Object.assign({}, options.headers || {}, { 'Authorization': 'Bearer ' + token });
      }
    }
    return _fetch(url, options);
  };
})();

function getActiveUser() {
  return parseStoredJson(localStorage.getItem('sgaCurrentUser'), null) ||
    parseStoredJson(sessionStorage.getItem('sgaCurrentUser'), null);
}

// ── Auth Guard ──
var currentUser = getActiveUser();
if (!currentUser || !currentUser.email) { window.location.href = 'login.html'; }
currentUser = currentUser || { name: '', email: '', role: 'scholar' };

// ── Dark Mode ──
function initDarkMode() {
  var saved = localStorage.getItem('sgaDarkMode');
  if (saved === 'true') {
    document.body.classList.add('dark-mode');
    updateDarkModeIcons(true);
  }
}

function toggleDarkMode() {
  var isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('sgaDarkMode', isDark);
  updateDarkModeIcons(isDark);
}

function updateDarkModeIcons(isDark) {
  var sun = document.getElementById('darkModeIconSun');
  var moon = document.getElementById('darkModeIconMoon');
  if (sun && moon) {
    sun.style.display = isDark ? 'block' : 'none';
    moon.style.display = isDark ? 'none' : 'block';
  }
}

// Initialize dark mode immediately
initDarkMode();

// ── Dashboard Data Cache ──
let dashboardData = null;
let dashboardFetchPromise = null;

function fetchDashboard() {
  if (dashboardData) return Promise.resolve(dashboardData);
  if (dashboardFetchPromise) return dashboardFetchPromise;

  dashboardFetchPromise = fetch('/api/dashboard?userId=' + encodeURIComponent(currentUser.email))
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      dashboardData = data;
      return data;
    })
    .catch(function(err) {
      console.error('fetchDashboard error:', err);
      dashboardFetchPromise = null; // allow retry on failure
      throw err;
    });

  return dashboardFetchPromise;
}

// ── User Info Setup ──
function initUser() {
  if (!currentUser) return;
  const displayName = currentUser.name || 'Scholar';
  const firstName = displayName.split(' ')[0];
  const initials = displayName.split(/\s+/).filter(Boolean).map(n => n[0]).join('').toUpperCase() || 'SG';

  document.getElementById('topUserName').textContent = displayName;
  document.getElementById('topAvatar').textContent = initials;
  document.getElementById('topUserRole').textContent = currentUser.role === 'admin' ? 'Admin' : 'Scholar';

  // Home page
  const welcomeMsg = document.getElementById('welcomeMsg');
  if (welcomeMsg) welcomeMsg.textContent = 'Welcome back, ' + firstName + '. Your future is glowing.';

  // Profile page
  const profileName = document.getElementById('profileName');
  if (profileName) profileName.textContent = displayName;
  const profileInitials = document.getElementById('profileInitials');
  if (profileInitials) profileInitials.textContent = initials;
  const profileEmail = document.getElementById('profileEmail');
  if (profileEmail) {
    var svgs = profileEmail.querySelectorAll('svg');
    var svgHtml = svgs.length > 0 ? svgs[0].outerHTML : '';
    profileEmail.innerHTML = svgHtml + ' ' + (currentUser.email || '');
  }
}

function logout() {
  localStorage.removeItem('sgaCurrentUser');
  sessionStorage.removeItem('sgaCurrentUser');
  localStorage.removeItem('sgaUser');
  sessionStorage.removeItem('sgaUser');
  localStorage.removeItem('sgaAuthToken');
  sessionStorage.removeItem('sgaAuthToken');
  window.location.href = 'login.html';
}

// ── SPA Navigation ──
function toggleMobileSidebar() {
  var sidebar = document.querySelector('.sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('visible');
}

function closeMobileSidebar() {
  var sidebar = document.querySelector('.sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
}

function navigateTo(page) {
  // Hide all pages
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  // Deactivate all nav items
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));

  // Show target page
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  // Persist so reload returns to this page
  localStorage.setItem('sgaLastPage', page);

  // Activate nav item
  const navItem = document.querySelector('.nav-item[data-page="' + page + '"]');
  if (navItem) navItem.classList.add('active');

  // Update page title
  const titles = { home: 'Dashboard', jobs: 'Jobs', profile: 'Profile', analyzer: 'Analyzer', assessment: 'Assessment', roadmap: 'Roadmap', coaching: 'Peer Coaching' };
  document.title = 'SkillGap Analyzer - ' + (titles[page] || 'Dashboard');

  // Initialize assessment page when navigating to it
  if (page === 'assessment') {
    initAssessment();
  }

  // Initialize jobs page when navigating to it
  if (page === 'jobs') {
    initJobsPage();
  }

  // Initialize profile page when navigating to it
  if (page === 'profile') {
    initProfile();
  }

  // Initialize skills lab when navigating to it
  if (page === 'skills') {
    initSkillsLabMatrix();
  }

  // Initialize analyzer when navigating to it
  if (page === 'analyzer') {
    initAnalyzer();
  }
  if (page === 'roadmap') {
    initRoadmap();
  }
  if (page === 'coaching') {
    initCoaching();
  }

  // Scroll to top
  window.scrollTo(0, 0);
}

// ── Home Page: Skill Matrix (dynamic from API) ──
function initSkillMatrix() {
  var el = document.getElementById('skillMatrix');
  if (!el) return;

  el.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px;">Loading skill matrix...</div>';

  fetchDashboard().then(function(response) {
    var data = response.skillMatrix;
    if (!data || data.length === 0) {
      el.innerHTML =
        '<div style="text-align:center;padding:24px;">' +
          '<p style="color:#64748b;font-size:14px;margin-bottom:12px;">Take skill assessments to build your matrix</p>' +
          '<button onclick="navigateTo(\'assessment\')" style="background:#4f46e5;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;">Start Assessment</button>' +
        '</div>';
      return;
    }
    el.innerHTML = '';
    data.forEach(function(s) {
      var pct = (s.score / s.max) * 100;
      el.innerHTML += '<div class="skill-row"><div class="skill-row-header"><span class="skill-row-name">' + s.name + '</span><span class="skill-row-score">' + s.score + ' / ' + s.max + '</span></div><div class="skill-bar"><div class="skill-bar-fill" style="width:' + pct + '%"></div></div></div>';
    });
  }).catch(function() {
    el.innerHTML =
      '<div style="text-align:center;padding:24px;">' +
        '<p style="color:#64748b;font-size:14px;margin-bottom:12px;">Take skill assessments to build your matrix</p>' +
        '<button onclick="navigateTo(\'assessment\')" style="background:#4f46e5;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;">Start Assessment</button>' +
      '</div>';
  });
}

// ── Home Page: User Skills ──
function initUserSkills() {
  const el = document.getElementById('userSkillChips');
  if (!el) return;

  var user = getActiveUser() || {};
  var email = user.email || '';

  fetch('/api/profile?userId=' + encodeURIComponent(email))
    .then(function(r) { return r.json(); })
    .then(function(profile) {
      var skills = profile.skills || [];
      el.innerHTML = '';
      if (skills.length === 0) {
        el.innerHTML = '<span style="color:#94a3b8;font-size:13px;">No skills added yet.</span>';
      } else {
        skills.forEach(function(s) {
          el.innerHTML += '<span class="skill-chip">' + s + '</span>';
        });
      }
      el.innerHTML += '<span class="add-skill-btn" onclick="navigateTo(\'profile\')">+ Add Skill</span>';
      displayPastAssessmentScores();
    })
    .catch(function() {
      el.innerHTML = '<span class="add-skill-btn" onclick="navigateTo(\'profile\')">+ Add Skill</span>';
      displayPastAssessmentScores();
    });
}

function editSkillsPrompt() { alert('Skill editing coming soon!'); }

// ── Home Page: Trending Skills (dynamic from API) ──
function initTrending() {
  var el = document.getElementById('trendingList');
  if (!el) return;

  el.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px;">Loading trends...</div>';

  fetchDashboard().then(function(response) {
    var data = response.trending;
    if (!data || data.length === 0) {
      // Fallback to static data if API returns nothing
      data = [
        { name: 'Neural Networks', change: '+15%', dir: 'up' },
        { name: 'Data Ethics', change: '+12%', dir: 'up' },
        { name: 'Grant Writing', change: '+9%', dir: 'up' },
        { name: 'Climate Modeling', change: '+8%', dir: 'up' },
        { name: 'Quantum Computing', change: '+7%', dir: 'up' },
      ];
    }
    el.innerHTML = '';
    data.forEach(function(t, i) {
      el.innerHTML += '<div class="trending-item"><div class="trending-rank">' + (i + 1) + '</div><div class="trending-name">' + t.name + '</div><div class="trending-change ' + t.dir + '">↑ ' + t.change + '</div></div>';
    });
  }).catch(function() {
    // Fallback to static data on error
    var data = [
      { name: 'Neural Networks', change: '+15%', dir: 'up' },
      { name: 'Data Ethics', change: '+12%', dir: 'up' },
      { name: 'Grant Writing', change: '+9%', dir: 'up' },
      { name: 'Climate Modeling', change: '+8%', dir: 'up' },
      { name: 'Quantum Computing', change: '+7%', dir: 'up' },
    ];
    el.innerHTML = '';
    data.forEach(function(t, i) {
      el.innerHTML += '<div class="trending-item"><div class="trending-rank">' + (i + 1) + '</div><div class="trending-name">' + t.name + '</div><div class="trending-change ' + t.dir + '">↑ ' + t.change + '</div></div>';
    });
  });
}

// ── Home Page: Milestone (dynamic from API) ──
function initMilestone() {
  fetchDashboard().then(function(response) {
    // Update milestone progress
    var progressFill = document.querySelector('.progress-fill');
    var milestonePct = document.querySelector('.milestone-pct');
    var milestoneLevel = document.querySelector('.milestone-level');
    var milestoneTitle = document.querySelector('.milestone-title');
    var milestoneHint = document.querySelector('.milestone-hint');
    var statNum = document.querySelector('.stat-num');

    if (response.milestone) {
      var m = response.milestone;
      var pct = m.completionPct || 0;
      if (progressFill) progressFill.style.width = pct + '%';
      if (milestonePct) milestonePct.textContent = pct + '%';
      if (milestoneLevel) milestoneLevel.textContent = m.level || 1;
      if (milestoneTitle) milestoneTitle.textContent = m.nextBadge || 'Newcomer';
      if (milestoneHint) milestoneHint.textContent = m.assessedSkills + ' of ' + m.totalSkills + ' skills assessed';
    }

    if (response.stats && response.stats.newJobsCount != null && statNum) {
      statNum.textContent = response.stats.newJobsCount.toLocaleString();
    }
  }).catch(function(err) {
    console.error('initMilestone error:', err);
  });
}

// ── Home Page: Recent Benchmarks (dynamic from API) ──
function initRecentBenchmarks() {
  fetchDashboard().then(function(response) {
    var benchmarks = response.recentBenchmarks;
    var cards = document.querySelectorAll('.benchmark-card');
    if (!cards || cards.length === 0) return;

    if (!benchmarks || benchmarks.length === 0) {
      // Dim existing placeholder cards if no real data
      cards.forEach(function(card) {
        card.style.opacity = '0.5';
      });
      return;
    }

    // Update each benchmark card with real data
    benchmarks.forEach(function(b, i) {
      if (i >= cards.length) return;
      var card = cards[i];
      card.style.opacity = '1';

      var titleEl = card.querySelector('.benchmark-title, h4, .card-title');
      var scoreEl = card.querySelector('.benchmark-score, .score, .card-score');
      var levelEl = card.querySelector('.benchmark-level, .level, .card-level');
      var dateEl = card.querySelector('.benchmark-date, .date, .card-date');

      if (titleEl) titleEl.textContent = b.skill || b.title || '';
      if (scoreEl) scoreEl.textContent = (b.score != null ? b.score + '/10' : '');
      if (levelEl) levelEl.textContent = b.level || '';
      if (dateEl) dateEl.textContent = b.date || '';
    });
  }).catch(function(err) {
    console.error('initRecentBenchmarks error:', err);
    // Dim placeholder cards on error
    var cards = document.querySelectorAll('.benchmark-card');
    if (cards) {
      cards.forEach(function(card) {
        card.style.opacity = '0.5';
      });
    }
  });
}

// ── Skills Lab: Skill Matrix (dynamic from API) ──
function initSkillsLabMatrix() {
  var currentUser = getActiveUser() || {};
  var email = currentUser.email || '';

  fetch('/api/skills-lab?userId=' + encodeURIComponent(email))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      // 1. Render skill matrix in #skillsLabMatrix
      var matrixEl = document.getElementById('skillsLabMatrix');
      if (matrixEl && data.skillMatrix && data.skillMatrix.length > 0) {
        matrixEl.innerHTML = data.skillMatrix.map(function(s) {
          var pct = (s.score / s.maxScore) * 100;
          return '<div class="skill-row">' +
            '<span class="skill-name">' + s.name + (s.verified ? ' <svg class="verified" viewBox="0 0 24 24" fill="#4f46e5"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' : '') + '</span>' +
            '<div class="skill-bar-track"><div class="skill-bar-fill" style="width:' + pct + '%"></div></div>' +
            '<span class="skill-score">' + s.score.toFixed(1) + '/' + s.maxScore + '</span>' +
            '</div>';
        }).join('');
      } else if (matrixEl) {
        matrixEl.innerHTML = '<p style="color:#94a3b8;font-size:13px;padding:10px;">Take skill assessments to build your matrix.</p>';
      }

      // 2. Update Top Strength
      if (data.topStrength) {
        var tsName = document.getElementById('slTopStrengthName');
        var tsScore = document.getElementById('slTopStrengthScore');
        if (tsName) tsName.textContent = data.topStrength.name;
        if (tsScore) tsScore.textContent = data.topStrength.score.toFixed(1);
      }

      // 3. Update Growth Area
      if (data.growthArea) {
        var gaName = document.getElementById('slGrowthName');
        var gaScore = document.getElementById('slGrowthScore');
        if (gaName) gaName.textContent = data.growthArea.name;
        if (gaScore) gaScore.textContent = data.growthArea.score.toFixed(1);
      }

      // 4. Update Insight
      if (data.insight) {
        var insightText = document.getElementById('slInsightText');
        if (insightText) insightText.textContent = data.insight;
      }

      // 5. Render benchmarks
      if (data.benchmarks) {
        var benchEl = document.getElementById('slBenchmarks');
        if (benchEl) {
          if (data.benchmarks.length > 0) {
            benchEl.innerHTML = data.benchmarks.map(function(b) {
              return '<div class="bench-card">' +
                '<div class="bench-date">' + b.daysAgo + '</div>' +
                '<div class="bench-icon">📊</div>' +
                '<div class="bench-name">' + b.skill + '</div>' +
                '<div class="bench-label">' + b.level + '</div>' +
                '<div class="bench-pct">' + b.score + '/10</div>' +
                '</div>';
            }).join('');
          }
        }
      }

      // 6. Update stats
      if (data.stats) {
        var totalEl = document.getElementById('slTotalAssessments');
        var avgEl = document.getElementById('slAvgScore');
        var coveredEl = document.getElementById('slSkillsCovered');
        if (totalEl) totalEl.textContent = data.stats.totalAssessments;
        if (avgEl) avgEl.textContent = data.stats.avgScore.toFixed(1) + '/10';
        if (coveredEl) coveredEl.textContent = data.stats.skillsCovered + ' / ' + data.stats.totalSkills;
      }

      // 7. Render available skills
      if (data.availableSkills) {
        var availEl = document.getElementById('slAvailableSkills');
        if (availEl) {
          if (data.availableSkills.length > 0) {
            var skillIcons = { 'Python': '🐍', 'SQL': '🗃️', 'JavaScript': '⚡', 'Machine Learning': '🤖', 'Data Analysis': '📊', 'Excel': '📗', 'Statistics': '📈', 'React': '⚛️', 'Cloud Computing': '☁️', 'Cybersecurity': '🔒' };
            availEl.innerHTML = data.availableSkills.map(function(skillName) {
              var icon = skillIcons[skillName] || '📝';
              return '<div class="skill-card" onclick="navigateTo(\'assessment\')">' +
                '<div class="skill-card-icon">' + icon + '</div>' +
                '<div class="skill-card-name">' + skillName + '</div>' +
                '<div class="skill-card-btn">Take Test →</div>' +
                '</div>';
            }).join('');
          } else {
            availEl.innerHTML = '<p style="color:#10b981;font-size:13px;padding:10px;">🎉 You\'ve assessed all available skills!</p>';
          }
        }
      }
    })
    .catch(function(err) {
      console.error('Skills Lab load error:', err);
    });
}

// ── Wire Skills Lab Assessment Button ──
function wireSkillsLabAssessmentButton() {
  var btns = document.querySelectorAll('.skills-page .btn, .skills-page button, [data-page="skills"] ~ * button');
  btns.forEach(function(btn) {
    var text = btn.textContent.trim().toLowerCase();
    if (text.indexOf('start') !== -1 && text.indexOf('assessment') !== -1) {
      btn.onclick = function() { navigateTo('assessment'); };
    }
  });
  // Also try by ID
  var startBtn = document.getElementById('startAssessmentBtn');
  if (startBtn) {
    startBtn.onclick = function() { navigateTo('assessment'); };
  }
}

// ── Analyzer: State ──
var analyzerState = {
  autoSkills: [],      // from profile/assessments with scores
  resumeSkills: [],    // from resume parsing
  manualSkills: [],    // typed in manually
  allSkills: [],       // combined
  lastResult: null,    // last analysis result for export
  resumeData: null,    // full parsed resume data (name, education, experience, etc.)
  _pendingFile: null   // file object kept for potential re-upload
};

// ── Analyzer: Init (called when navigating to analyzer page) ──
function initAnalyzer() {
  // Load user's skills from the API
  var currentUser = getActiveUser() || {};
  var email = currentUser.email || '';

  fetch('/api/analyzer/user-skills?userId=' + encodeURIComponent(email))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      analyzerState.autoSkills = data.skills || [];
      var container = document.getElementById('azAutoSkills');
      if (!container) return;

      if (analyzerState.autoSkills.length > 0) {
        container.innerHTML = analyzerState.autoSkills.map(function(s) {
          var scoreHtml = s.score ? ' <strong>' + s.score + '/10</strong>' : '';
          var cls = s.source === 'assessment' ? 'skill-tag match' : 'skill-tag';
          return '<span class="' + cls + '">' + s.name + scoreHtml + '</span>';
        }).join('');
      } else {
        container.innerHTML = '<span style="color:#94a3b8;font-size:13px;">No skills found. Upload a resume or enter skills manually below.</span>';
      }
    })
    .catch(function(err) {
      console.error('Failed to load user skills:', err);
      var container = document.getElementById('azAutoSkills');
      if (container) container.innerHTML = '<span style="color:#94a3b8;font-size:13px;">Enter your skills manually below.</span>';
    });

  initUploadArea();
}

// ── Analyzer: Upload Area with AI Parsing ──
function initUploadArea() {
  var uploadArea = document.getElementById('uploadArea');
  var resumeFile = document.getElementById('resumeFile');
  if (!uploadArea || !resumeFile) return;

  uploadArea.onclick = function() { resumeFile.click(); };

  resumeFile.onchange = function() {
    if (resumeFile.files.length === 0) return;
    var file = resumeFile.files[0];
    analyzerState._pendingFile = file;
    uploadArea.classList.add('has-file');
    document.getElementById('uploadText').textContent = '⏳ Parsing ' + file.name + '...';

    var previewEl = document.getElementById('azResumePreview');
    var statusEl = document.getElementById('azImportStatus');
    if (previewEl) previewEl.style.display = 'none';
    if (statusEl) statusEl.style.display = 'none';

    var formData = new FormData();
    formData.append('resume', file);

    fetch('/api/analyzer/parse-resume', { method: 'POST', body: formData })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          document.getElementById('uploadText').textContent = '❌ ' + data.error;
          return;
        }
        analyzerState.resumeSkills = data.skills || [];
        analyzerState.resumeData = data;
        document.getElementById('uploadText').textContent = '✅ ' + file.name + ' — ' + analyzerState.resumeSkills.length + ' skills found';

        var resumeSection = document.getElementById('azResumeSkills');
        var resumeTags = document.getElementById('azResumeSkillTags');
        if (resumeSection && resumeTags && analyzerState.resumeSkills.length > 0) {
          resumeSection.style.display = 'block';
          resumeTags.innerHTML = analyzerState.resumeSkills.map(function(s) {
            return '<span class="skill-tag">' + s + '</span>';
          }).join('');
        }

        renderResumePreview(data);
        syncAnalyzerResumeToProfile({ auto: true, data: data });
      })
      .catch(function(err) {
        document.getElementById('uploadText').textContent = '❌ Failed to parse. Try entering skills manually.';
        console.error('Resume parse error:', err);
      });
  };
}

// ── Analyzer: Step Navigation ──
function analyzerGoToStep(step) {
  document.querySelectorAll('.analyzer-page .section').forEach(function(s) { s.classList.remove('visible'); });
  document.querySelectorAll('.analyzer-page .step').forEach(function(s) { s.classList.remove('active'); s.classList.remove('done'); });

  if (step === 1) {
    document.getElementById('az-step1').classList.add('visible');
    document.getElementById('az-step1-ind').classList.add('active');
  } else if (step === 2) {
    // Gather all skills
    var manual = document.getElementById('manualSkills').value.trim();
    analyzerState.manualSkills = manual ? manual.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; }) : [];

    // Combine all skills (dedup)
    var seen = {};
    analyzerState.allSkills = [];

    // Add auto skills first (they have scores)
    analyzerState.autoSkills.forEach(function(s) {
      var key = s.name.toLowerCase();
      if (!seen[key]) { seen[key] = true; analyzerState.allSkills.push(s); }
    });

    // Add resume skills
    analyzerState.resumeSkills.forEach(function(name) {
      var key = name.toLowerCase();
      if (!seen[key]) { seen[key] = true; analyzerState.allSkills.push({ name: name, score: null, source: 'resume' }); }
    });

    // Add manual skills
    analyzerState.manualSkills.forEach(function(name) {
      var key = name.toLowerCase();
      if (!seen[key]) { seen[key] = true; analyzerState.allSkills.push({ name: name, score: null, source: 'manual' }); }
    });

    if (analyzerState.allSkills.length === 0) {
      alert('Please add at least one skill — upload a resume, enter skills manually, or take an assessment first.');
      document.getElementById('az-step1').classList.add('visible');
      document.getElementById('az-step1-ind').classList.add('active');
      return;
    }

    // Show skills summary on step 2
    var summaryEl = document.getElementById('azAllSkillsList');
    if (summaryEl) {
      summaryEl.innerHTML = analyzerState.allSkills.map(function(s) {
        var scoreHtml = s.score ? ' <strong>' + s.score + '/10</strong>' : '';
        var sourceIcon = s.source === 'assessment' ? '📊 ' : s.source === 'resume' ? '📄 ' : '';
        return '<span class="skill-tag">' + sourceIcon + s.name + scoreHtml + '</span>';
      }).join('');
    }

    document.getElementById('az-step2').classList.add('visible');
    document.getElementById('az-step1-ind').classList.add('done');
    document.getElementById('az-step2-ind').classList.add('active');
  }
}

// ── Analyzer: Run AI Analysis ──
function runAnalysis() {
  var role = document.getElementById('targetRole').value;
  var region = document.getElementById('region').value;
  if (!role) { alert('Please select a target role.'); return; }
  if (!region) { alert('Please select a region.'); return; }

  // Show loading
  document.querySelectorAll('.analyzer-page .section').forEach(function(s) { s.classList.remove('visible'); });
  document.getElementById('az-loading').classList.add('visible');

  var loadingMsg = document.getElementById('azLoadingMsg');
  var messages = [
    'Comparing your skills against market demand...',
    'Analyzing skill gaps with AI...',
    'Generating personalized learning path...',
    'Calculating competitiveness score...'
  ];
  var msgIdx = 0;
  var msgInterval = setInterval(function() {
    msgIdx = (msgIdx + 1) % messages.length;
    if (loadingMsg) loadingMsg.textContent = messages[msgIdx];
  }, 2000);

  var currentUser = getActiveUser() || {};
  var jobDescEl = document.getElementById('azJobDescription');
  var jobDescription = jobDescEl ? (jobDescEl.value || '').trim() : '';

  var payload = {
    userSkills: analyzerState.allSkills.map(function(s) { return { name: s.name, score: s.score }; }),
    targetRole: role,
    region: region,
    userId: currentUser.email || '',
    jobDescription: jobDescription
  };

  fetch('/api/analyzer/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(function(r) { return r.json(); })
  .then(function(result) {
    clearInterval(msgInterval);
    analyzerState.lastResult = result;
    analyzerState.lastResult._meta = { role: role, region: region, date: new Date().toISOString(), jobDescription: jobDescription };
    showAnalysisResults(result, role, region);
  })
  .catch(function(err) {
    clearInterval(msgInterval);
    console.error('Analysis error:', err);
    alert('Analysis failed. Please try again.');
    analyzerGoToStep(2);
  });
}

// ── Analyzer: Show AI Results ──
function showAnalysisResults(result, role, region) {
  // Update step indicators
  document.querySelectorAll('.analyzer-page .step').forEach(function(s) { s.classList.remove('active'); s.classList.remove('done'); });
  document.getElementById('az-step1-ind').classList.add('done');
  document.getElementById('az-step2-ind').classList.add('done');
  document.getElementById('az-step3-ind').classList.add('active');

  // Match Score
  var scoreEl = document.getElementById('matchScore');
  var score = result.matchScore || 0;
  scoreEl.textContent = score + '%';
  scoreEl.style.color = score >= 70 ? '#16a34a' : score >= 40 ? '#f59e0b' : '#ef4444';

  // Gap Count
  var missingCount = (result.missingSkills || []).length;
  document.getElementById('gapCount').textContent = missingCount;

  // Competitiveness
  var compEl = document.getElementById('azCompetitiveness');
  if (compEl) compEl.textContent = result.competitiveness || 'N/A';

  // Salary
  var salEl = document.getElementById('azSalary');
  if (salEl) salEl.textContent = result.salaryInsight || 'N/A';

  // Subtitle
  document.getElementById('resultsSubtitle').textContent = role + ' • ' + region + ' • Analyzed ' + new Date().toLocaleDateString();

  // Summary
  var summaryEl = document.getElementById('azSummaryText');
  if (summaryEl) summaryEl.textContent = result.summary || '';

  // Job-fit card (only if user pasted a JD)
  var jobFitCard = document.getElementById('azJobFitCard');
  var jf = result.jobFit;
  if (jobFitCard) {
    if (jf && typeof jf.likelihood === 'number') {
      jobFitCard.style.display = '';
      var pct = Math.max(0, Math.min(100, jf.likelihood));
      var jfScoreEl = document.getElementById('azJobFitScore');
      var jfLabelEl = document.getElementById('azJobFitLabel');
      var jfReasonEl = document.getElementById('azJobFitReason');
      var jfBlockersEl = document.getElementById('azJobFitBlockers');
      if (jfScoreEl) {
        jfScoreEl.textContent = pct + '%';
        jfScoreEl.style.color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#f59e0b' : '#ef4444';
      }
      if (jfLabelEl) jfLabelEl.textContent = jf.label || '';
      if (jfReasonEl) jfReasonEl.textContent = jf.reason || '';
      if (jfBlockersEl) {
        var blockers = Array.isArray(jf.blockers) ? jf.blockers : [];
        if (blockers.length > 0) {
          jfBlockersEl.innerHTML = '<div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:6px;">Top blockers:</div>' +
            blockers.map(function(b) { return '<span class="skill-tag missing" style="margin:2px 4px 2px 0;">' + escapeHtml(b) + '</span>'; }).join('');
        } else {
          jfBlockersEl.innerHTML = '';
        }
      }
    } else {
      jobFitCard.style.display = 'none';
    }
  }

  // Reset save button label (in case this is a re-run of the same session)
  var saveBtn = document.getElementById('azSaveReportBtn');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save to Profile';
  }

  // Matched Skills
  var matchedEl = document.getElementById('matchedSkills');
  if (matchedEl) {
    var matched = result.matchedSkills || [];
    if (matched.length > 0) {
      matchedEl.innerHTML = matched.map(function(s) {
        var scoreHtml = s.score ? ' <strong>' + s.score + '/10</strong>' : '';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;">' +
          '<div><span class="skill-tag match">' + s.name + scoreHtml + '</span></div>' +
          '<div style="font-size:11px;color:#64748b;">' + (s.verdict || '') + '</div>' +
        '</div>';
      }).join('');
    } else {
      matchedEl.innerHTML = '<span style="color:#94a3b8;font-size:13px;">No matching skills found</span>';
    }
  }

  // Missing Skills
  var missingEl = document.getElementById('missingSkills');
  if (missingEl) {
    var missing = result.missingSkills || [];
    missingEl.innerHTML = missing.map(function(s) {
      var priorityColor = s.priority === 'high' ? '#ef4444' : s.priority === 'medium' ? '#f59e0b' : '#94a3b8';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;">' +
        '<div><span class="skill-tag missing">' + s.name + '</span>' +
        '<span style="font-size:10px;font-weight:600;color:' + priorityColor + ';margin-left:6px;text-transform:uppercase;">' + (s.priority || '') + '</span></div>' +
        '<div style="font-size:11px;color:#64748b;">' + (s.demandPct || 0) + '% demand</div>' +
      '</div>';
    }).join('');
  }

  // Gap Bars
  var gapBarsEl = document.getElementById('gapBars');
  if (gapBarsEl) {
    var allGaps = (result.missingSkills || []).sort(function(a, b) { return (b.demandPct || 0) - (a.demandPct || 0); });
    gapBarsEl.innerHTML = allGaps.map(function(s) {
      var demand = s.demandPct || 50;
      var level = demand >= 70 ? 'high' : demand >= 50 ? 'medium' : 'low';
      return '<div class="gap-item">' +
        '<div class="gap-item-header"><span class="gname">' + s.name + '</span><span class="demand">' + demand + '% demand</span></div>' +
        '<div class="gap-bar"><div class="gap-bar-fill ' + level + '" style="width:' + demand + '%"></div></div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:2px;">' + (s.reason || '') + '</div>' +
      '</div>';
    }).join('');
  }

  // Learning Path
  var lpEl = document.getElementById('azLearningPath');
  if (lpEl) {
    var path = result.learningPath || [];
    if (path.length > 0) {
      lpEl.innerHTML = path.map(function(item, idx) {
        var resourcesHtml = (item.resources || []).map(function(r) {
          var link = r.url ? '<a href="' + r.url + '" target="_blank" style="color:#4f46e5;text-decoration:none;font-size:12px;">' + r.title + '</a>' : '<span style="font-size:12px;">' + r.title + '</span>';
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">' +
            '<span style="font-size:10px;padding:2px 8px;background:#f0f0ff;color:#4f46e5;border-radius:4px;font-weight:600;">' + (r.type || 'Resource') + '</span>' +
            link +
            (r.platform ? '<span style="font-size:10px;color:#94a3b8;">on ' + r.platform + '</span>' : '') +
          '</div>';
        }).join('');

        return '<div style="padding:16px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<div><span style="background:#4f46e5;color:#fff;border-radius:50%;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin-right:8px;">' + (idx + 1) + '</span>' +
            '<strong style="font-size:14px;">' + item.skill + '</strong></div>' +
            '<span style="font-size:11px;color:#64748b;">⏱ ' + (item.timeEstimate || 'N/A') + '</span>' +
          '</div>' +
          resourcesHtml +
        '</div>';
      }).join('');
    } else {
      lpEl.innerHTML = '<p style="color:#94a3b8;font-size:13px;">No specific learning path generated.</p>';
    }
  }

  // Assessment Suggestions
  var assessEl = document.getElementById('azAssessmentSuggestions');
  if (assessEl) {
    var suggestions = result.assessmentSuggestions || [];
    // Filter to only show skills we actually have assessments for
    var availableAssessments = ['Python', 'SQL', 'JavaScript', 'Machine Learning', 'Data Analysis', 'Excel', 'Statistics', 'React', 'Cloud Computing', 'Cybersecurity'];
    var filtered = suggestions.filter(function(s) { return availableAssessments.indexOf(s) !== -1; });

    if (filtered.length > 0) {
      assessEl.innerHTML = filtered.map(function(skill) {
        return '<button class="btn btn-primary" style="font-size:12px;padding:8px 16px;" onclick="navigateTo(\'assessment\')">' +
          '📝 Take ' + skill + ' Assessment</button>';
      }).join('');
    } else {
      document.getElementById('azAssessCard').style.display = 'none';
    }
  }

  // Show results
  document.querySelectorAll('.analyzer-page .section').forEach(function(s) { s.classList.remove('visible'); });
  document.getElementById('az-step3').classList.add('visible');
}

// ── Analyzer: View a saved report ──
async function viewSavedReport(reportId) {
  try {
    var profileData = await fetchProfileRecord();
    var reports = Array.isArray(profileData.analyzerReports) ? profileData.analyzerReports : [];
    var rep = reports.find(function(r) { return r.id === reportId; });
    if (!rep) { alert('Report not found.'); return; }
    analyzerState.lastResult = {
      matchScore: rep.matchScore,
      summary: rep.summary,
      matchedSkills: rep.matchedSkills,
      missingSkills: rep.missingSkills,
      learningPath: rep.learningPath,
      assessmentSuggestions: rep.assessmentSuggestions,
      salaryInsight: rep.salaryInsight,
      competitiveness: rep.competitiveness,
      jobFit: rep.jobFit,
      _meta: { role: rep.role, region: rep.region, date: rep.date, jobDescription: rep.jobDescription || rep.jobDescriptionPreview || '', existingId: rep.id }
    };
    navigateTo('analyzer');
    setTimeout(function() {
      showAnalysisResults(analyzerState.lastResult, rep.role, rep.region);
    }, 50);
  } catch (err) {
    console.error('viewSavedReport error:', err);
    alert('Could not open report.');
  }
}

async function deleteSavedReport(reportId) {
  if (!await showAppConfirm('Delete this saved report? This cannot be undone.', { title: 'Delete report', okLabel: 'Delete', danger: true })) return;
  try {
    var res = await fetch('/api/analyzer/reports/' + encodeURIComponent(reportId), {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Delete failed');
    if (profileState && profileState.data !== undefined) profileState.data = null;
    initProfile();
  } catch (err) {
    console.error('deleteSavedReport error:', err);
    alert('Could not delete report.');
  }
}

// ── Analyzer: Save Report to Profile ──
async function saveAnalysisReport() {
  if (!analyzerState.lastResult) { alert('No analysis to save.'); return; }
  var btn = document.getElementById('azSaveReportBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    var r = await fetch('/api/analyzer/save-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ report: analyzerState.lastResult })
    });
    var data = await r.json();
    if (!r.ok) throw new Error((data && data.error) || 'Save failed');

    // Also sync resume education/experience to profile if available and not yet synced
    if (analyzerState.resumeData &&
        ((analyzerState.resumeData.education && analyzerState.resumeData.education.length > 0) ||
         (analyzerState.resumeData.experience && analyzerState.resumeData.experience.length > 0))) {
      await syncAnalyzerResumeToProfile({ auto: false, data: analyzerState.resumeData });
    }

    if (btn) { btn.textContent = '✅ Saved — Open Profile'; }
    if (profileState && profileState.data !== undefined) profileState.data = null;
    setTimeout(function() { navigateTo('profile'); }, 600);
  } catch (err) {
    console.error('Save report error:', err);
    alert('Could not save report: ' + (err.message || 'Unknown error'));
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save to Profile'; }
  }
}

// ── Analyzer: Export Report ──
function exportAnalysisReport() {
  if (!analyzerState.lastResult) { alert('No analysis to export.'); return; }
  var r = analyzerState.lastResult;
  var meta = r._meta || {};

  var lines = [];
  lines.push('SKILLGAP ANALYZER - SKILL GAP REPORT');
  lines.push('═'.repeat(50));
  lines.push('Date: ' + new Date(meta.date || Date.now()).toLocaleDateString());
  lines.push('Target Role: ' + (meta.role || 'N/A'));
  lines.push('Region: ' + (meta.region || 'N/A'));
  lines.push('');
  lines.push('MATCH SCORE: ' + (r.matchScore || 0) + '%');
  lines.push('COMPETITIVENESS: ' + (r.competitiveness || 'N/A'));
  lines.push('SALARY RANGE: ' + (r.salaryInsight || 'N/A'));
  lines.push('');
  lines.push('SUMMARY');
  lines.push('-'.repeat(30));
  lines.push(r.summary || '');
  lines.push('');
  lines.push('MATCHED SKILLS');
  lines.push('-'.repeat(30));
  (r.matchedSkills || []).forEach(function(s) {
    lines.push('  ✅ ' + s.name + (s.score ? ' (' + s.score + '/10)' : '') + ' — ' + (s.verdict || ''));
  });
  lines.push('');
  lines.push('SKILLS TO DEVELOP');
  lines.push('-'.repeat(30));
  (r.missingSkills || []).forEach(function(s) {
    lines.push('  ❌ ' + s.name + ' [' + (s.priority || 'medium').toUpperCase() + '] — ' + (s.demandPct || 0) + '% demand — ' + (s.reason || ''));
  });
  lines.push('');
  lines.push('LEARNING PATH');
  lines.push('-'.repeat(30));
  (r.learningPath || []).forEach(function(item, idx) {
    lines.push('  ' + (idx + 1) + '. ' + item.skill + ' (' + (item.timeEstimate || 'N/A') + ')');
    (item.resources || []).forEach(function(res) {
      lines.push('     - [' + (res.type || 'Resource') + '] ' + res.title + (res.url ? ' (' + res.url + ')' : ''));
    });
  });
  lines.push('');
  lines.push('Generated by SkillGap Analyzer');

  var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'SkillGap_Report_' + (meta.role || 'Report').replace(/\s+/g, '_') + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════
// ASSESSMENT ENGINE (Client-Side)
// ══════════════════════════════════════

let assessSessionId = null;
let assessCurrentSkill = null;
let assessSelectedIndex = null;
let assessSelectedIndices = [];
let assessCurrentQuestionType = null;
let assessIsComplete = false;
let assessTimerInterval = null;
let assessTimeLeft = 30;
const QUESTION_TIME_LIMIT = 30;

// ── Inject Assessment CSS for new question types ──
(function injectAssessmentCSS() {
  var style = document.createElement('style');
  style.textContent =
    '.phase-badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:600; letter-spacing:0.3px; margin-left:8px; vertical-align:middle; }' +
    '.phase-badge.seed { background:#dbeafe; color:#1d4ed8; }' +
    '.phase-badge.ai { background:#ede9fe; color:#7c3aed; }' +
    '.quiz-timer { display:inline-flex; align-items:center; justify-content:center; font-size:28px; font-weight:700; font-variant-numeric:tabular-nums; color:#16a34a; min-width:60px; }' +
    '.quiz-timer.warning { color:#f59e0b; }' +
    '.quiz-timer.danger { color:#ef4444; }' +
    '.option-btn.checkbox { position:relative; padding-left:40px; text-align:left; }' +
    '.option-btn.checkbox::before { content:""; position:absolute; left:12px; top:50%; transform:translateY(-50%); width:18px; height:18px; border:2px solid #cbd5e1; border-radius:4px; background:#fff; transition:all 0.15s; }' +
    '.option-btn.checkbox.selected::before { background:#4f46e5; border-color:#4f46e5; }' +
    '.option-btn.checkbox.selected::after { content:"\\2713"; position:absolute; left:15px; top:50%; transform:translateY(-50%); color:#fff; font-size:13px; font-weight:700; }' +
    '.multiple-select-hint { color:#94a3b8; font-size:13px; font-style:italic; margin:8px 0 4px 0; }' +
    '.submit-selection-btn { display:none; margin-top:12px; padding:10px 28px; background:#4f46e5; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; transition:background 0.15s; }' +
    '.submit-selection-btn:hover { background:#4338ca; }' +
    '.submit-selection-btn:disabled { background:#94a3b8; cursor:not-allowed; }' +
    '.code-snippet-block { background:#1e293b; color:#e2e8f0; padding:16px 20px; border-radius:10px; font-family:"Fira Code","Cascadia Code","Consolas",monospace; font-size:13px; line-height:1.6; overflow-x:auto; margin:12px 0; white-space:pre-wrap; word-break:break-word; border:1px solid #334155; }' +
    '.code-snippet-block .kw { color:#c084fc; }' +
    '.code-snippet-block .str { color:#86efac; }' +
    '.code-snippet-block .num { color:#fbbf24; }' +
    '.code-snippet-block .cmt { color:#64748b; font-style:italic; }' +
    '.question-type-breakdown { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }' +
    '.question-type-breakdown .qtype-chip { padding:4px 12px; border-radius:6px; font-size:12px; font-weight:500; background:#f1f5f9; color:#475569; }' +
    '.question-type-breakdown .qtype-chip.mcq { background:#dbeafe; color:#1d4ed8; }' +
    '.question-type-breakdown .qtype-chip.true_false { background:#fef3c7; color:#92400e; }' +
    '.question-type-breakdown .qtype-chip.multiple_select { background:#ede9fe; color:#7c3aed; }' +
    '.question-type-breakdown .qtype-chip.coding { background:#d1fae5; color:#065f46; }';
  document.head.appendChild(style);
})();

function startQuestionTimer() {
  clearInterval(assessTimerInterval);
  assessTimeLeft = QUESTION_TIME_LIMIT;
  const timerText = document.getElementById('timerText');
  const timerCircle = document.getElementById('timerCircle');
  const timerWrap = document.getElementById('quizTimer');
  const circumference = 106.8; // 2 * PI * 17

  timerText.textContent = assessTimeLeft;
  timerCircle.style.strokeDashoffset = '0';
  timerWrap.classList.remove('warning');

  assessTimerInterval = setInterval(() => {
    assessTimeLeft--;
    timerText.textContent = assessTimeLeft;

    // Update circle
    const offset = circumference * (1 - assessTimeLeft / QUESTION_TIME_LIMIT);
    timerCircle.style.strokeDashoffset = offset;

    // Color transitions: green > 15s, yellow 15-5s, red < 5s
    timerWrap.classList.remove('warning', 'danger');
    if (assessTimeLeft <= 5) {
      timerWrap.classList.add('danger');
    } else if (assessTimeLeft <= 15) {
      timerWrap.classList.add('warning');
    }

    // Time's up — auto-submit or skip
    if (assessTimeLeft <= 0) {
      clearInterval(assessTimerInterval);
      var hasSelection = assessCurrentQuestionType === 'multiple_select'
        ? assessSelectedIndices.length > 0
        : assessSelectedIndex !== null;
      if (hasSelection) {
        submitAssessmentAnswer(); // submit whatever they selected
      } else {
        autoSkipQuestion(); // no selection = wrong answer
      }
    }
  }, 1000);
}

function stopQuestionTimer() {
  clearInterval(assessTimerInterval);
}

async function autoSkipQuestion() {
  // Submit index -1 to indicate timeout/no answer
  document.getElementById('quizSubmitBtn').disabled = true;
  var msSubmitBtn = document.getElementById('multiSelectSubmitBtn');
  if (msSubmitBtn) msSubmitBtn.disabled = true;
  try {
    var skipPayload = { sessionId: assessSessionId };
    if (assessCurrentQuestionType === 'multiple_select') {
      skipPayload.selectedIndices = [];
    } else {
      skipPayload.selectedIndex = -1;
    }
    const resp = await fetch('/api/assessment/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skipPayload)
    });
    const data = await resp.json();
    assessIsComplete = data.isComplete;

    showAssessScreen('assess-feedback');
    const feedbackCard = document.getElementById('feedbackCard');
    feedbackCard.className = 'feedback-card wrong';
    document.getElementById('feedbackIcon').textContent = '⏱';
    document.getElementById('feedbackTitle').textContent = 'Time\'s Up!';
    document.getElementById('feedbackYourAnswer').innerHTML =
      '<span class="feedback-label">Your Answer:</span> No answer (timed out)';
    document.getElementById('feedbackCorrectAnswer').innerHTML =
      '<span class="feedback-label">Correct Answer:</span> ' + data.correctAnswer;
    document.getElementById('feedbackExplanation').textContent = data.explanation || '';
    document.getElementById('feedbackTheta').textContent = data.currentTheta + ' / 10';

    const nextBtn = document.getElementById('feedbackNextBtn');
    if (data.isComplete) {
      nextBtn.textContent = 'View Results →';
      nextBtn.onclick = showAssessmentResults;
    } else {
      nextBtn.textContent = 'Next Question →';
      nextBtn.onclick = loadNextAssessmentQuestion;
    }
    document.getElementById('quizSubmitBtn').textContent = 'Submit Answer';
  } catch (err) {
    console.error('autoSkipQuestion error:', err);
    loadNextAssessmentQuestion();
  }
}

// ── Show/Hide Assessment Screens ──
function showAssessScreen(screenId) {
  ['assess-select', 'assess-quiz', 'assess-feedback', 'assess-results'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById(screenId).style.display = 'block';
}

// ── Initialize Assessment: Load Skills from API ──
async function initAssessment() {
  const grid = document.getElementById('skillSelectorGrid');
  if (!grid) return;

  grid.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">Loading skills...</div>';

  try {
    const resp = await fetch('/api/skills');
    const data = await resp.json();

    if (!data.skills || data.skills.length === 0) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">No skills available.</div>';
      return;
    }

    grid.innerHTML = '';
    data.skills.forEach(skill => {
      const card = document.createElement('div');
      card.className = 'skill-selector-card';
      card.onclick = () => startAssessment(skill.name);
      card.innerHTML =
        '<div class="skill-selector-icon">' + skill.icon + '</div>' +
        '<div class="skill-selector-name">' + skill.name + '</div>' +
        '<div class="skill-selector-count">' + skill.questionCount + ' questions</div>';
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">Failed to load skills. Make sure the server is running.</div>';
    console.error('initAssessment error:', err);
  }
}

// ── Start Assessment for a Skill ──
async function startAssessment(skill) {
  try {
    const resp = await fetch('/api/assessment/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill })
    });
    const data = await resp.json();

    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }

    assessSessionId = data.sessionId;
    assessCurrentSkill = skill;
    assessIsComplete = false;

    document.getElementById('quizSkillName').textContent = skill;
    showAssessScreen('assess-quiz');
    loadNextAssessmentQuestion();
  } catch (err) {
    alert('Failed to start assessment. Is the server running?');
    console.error('startAssessment error:', err);
  }
}

// ── Load Next Question ──
async function loadNextAssessmentQuestion() {
  if (assessIsComplete) {
    showAssessmentResults();
    return;
  }

  showAssessScreen('assess-quiz');
  assessSelectedIndex = null;
  assessSelectedIndices = [];
  assessCurrentQuestionType = null;
  document.getElementById('quizSubmitBtn').disabled = true;

  // Show loading state
  document.getElementById('quizQuestion').textContent = 'Loading question...';
  document.getElementById('quizOptions').innerHTML = '';
  document.getElementById('quizCode').style.display = 'none';

  // Remove any previous multiple-select hint or submit-selection button
  var oldHint = document.getElementById('multiSelectHint');
  if (oldHint) oldHint.remove();
  var oldMsBtn = document.getElementById('multiSelectSubmitBtn');
  if (oldMsBtn) oldMsBtn.remove();

  try {
    const resp = await fetch('/api/assessment/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: assessSessionId })
    });
    const data = await resp.json();

    if (data.error) {
      if (data.error.includes('complete')) {
        showAssessmentResults();
        return;
      }
      alert('Error: ' + data.error);
      return;
    }

    // Determine question type (default to mcq for backwards compatibility)
    var qType = data.type || 'mcq';
    assessCurrentQuestionType = qType;

    // Update progress
    document.getElementById('quizQNum').textContent = data.questionNumber;
    document.getElementById('quizQTotal').textContent = data.totalQuestions;
    const pct = (data.questionNumber / data.totalQuestions) * 100;
    document.getElementById('quizProgressFill').style.width = pct + '%';

    // Update difficulty badge
    const diffEl = document.getElementById('quizDifficulty');
    diffEl.textContent = 'Difficulty: ' + data.difficulty + '/10';
    diffEl.className = 'quiz-difficulty-badge diff-' + (data.difficulty <= 3 ? 'easy' : data.difficulty <= 6 ? 'medium' : 'hard');

    // Phase badge (seed vs AI generated)
    var phaseBadgeHtml = '';
    if (data.phase === 'seed' || data.source === 'seed' || data.aiGenerated === false || data.questionNumber <= 3) {
      phaseBadgeHtml = ' <span class="phase-badge seed">\u{1F4DA} From Question Bank</span>';
    } else if (data.phase === 'ai' || data.source === 'gemini' || data.source === 'ai' || data.aiGenerated === true || data.questionNumber > 3) {
      phaseBadgeHtml = ' <span class="phase-badge ai">\u{1F916} AI Generated</span>';
    }

    // Render skill name with phase badge
    document.getElementById('quizSkillName').innerHTML = assessCurrentSkill + phaseBadgeHtml;

    // Timer display — update existing or inject
    var timerWrap = document.getElementById('quizTimer');
    if (timerWrap) {
      timerWrap.classList.remove('warning', 'danger');
    }

    // Render question
    document.getElementById('quizQuestion').textContent = data.question;

    // Code snippet — enhanced for coding type
    if (data.codeSnippet || qType === 'coding') {
      var codeEl = document.getElementById('quizCode');
      var snippetText = data.codeSnippet || '';
      if (qType === 'coding') {
        // Render with styled code block
        codeEl.className = 'code-snippet-block';
        codeEl.innerHTML = syntaxHighlightCode(snippetText);
      } else {
        codeEl.className = '';
        codeEl.textContent = snippetText;
      }
      codeEl.style.display = 'block';
    } else {
      document.getElementById('quizCode').style.display = 'none';
    }

    // Render options based on question type
    const optionsEl = document.getElementById('quizOptions');
    optionsEl.innerHTML = '';

    if (qType === 'multiple_select') {
      // Add instruction hint
      var hint = document.createElement('div');
      hint.className = 'multiple-select-hint';
      hint.id = 'multiSelectHint';
      hint.textContent = 'Select all that apply';
      optionsEl.parentNode.insertBefore(hint, optionsEl);

      // Render checkbox-style buttons
      data.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn checkbox';
        btn.textContent = String.fromCharCode(65 + idx) + '. ' + opt;
        btn.onclick = () => toggleAssessMultiOption(idx);
        optionsEl.appendChild(btn);
      });

      // Add "Submit Selection" button for multiple select
      var msSubmitBtn = document.createElement('button');
      msSubmitBtn.className = 'submit-selection-btn';
      msSubmitBtn.id = 'multiSelectSubmitBtn';
      msSubmitBtn.textContent = 'Submit Selection';
      msSubmitBtn.disabled = true;
      msSubmitBtn.onclick = () => submitAssessmentAnswer();
      optionsEl.parentNode.insertBefore(msSubmitBtn, optionsEl.nextSibling);

      // Hide the main submit button for multiple_select (use the dedicated one)
      document.getElementById('quizSubmitBtn').style.display = 'none';
    } else {
      // mcq, true_false, coding — single select buttons
      document.getElementById('quizSubmitBtn').style.display = '';
      data.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = String.fromCharCode(65 + idx) + '. ' + opt;
        btn.onclick = () => selectAssessOption(idx);
        optionsEl.appendChild(btn);
      });
    }

    // Start 30-second timer
    startQuestionTimer();

  } catch (err) {
    alert('Failed to load question. Check server connection.');
    console.error('loadNextAssessmentQuestion error:', err);
  }
}

// ── Simple syntax highlighting for code snippets ──
function syntaxHighlightCode(code) {
  if (!code) return '';
  // Escape HTML first
  var escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Highlight keywords
  escaped = escaped.replace(/\b(function|var|let|const|if|else|for|while|return|class|import|export|from|def|print|True|False|None|int|float|str|list|dict|try|except|finally|async|await|yield|lambda|new|this|self)\b/g, '<span class="kw">$1</span>');
  // Highlight strings
  escaped = escaped.replace(/(["'`])(?:(?!\1|\\).|\\.)*?\1/g, '<span class="str">$&</span>');
  // Highlight numbers
  escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>');
  // Highlight comments (// and #)
  escaped = escaped.replace(/(\/\/.*$|#.*$)/gm, '<span class="cmt">$1</span>');
  return escaped;
}

// ── Select an Option (single select for mcq / true_false / coding) ──
function selectAssessOption(index) {
  assessSelectedIndex = index;
  document.querySelectorAll('#quizOptions .option-btn').forEach((btn, i) => {
    btn.classList.toggle('selected', i === index);
  });
  document.getElementById('quizSubmitBtn').disabled = false;
}

// ── Toggle Option (multiple select) ──
function toggleAssessMultiOption(index) {
  var pos = assessSelectedIndices.indexOf(index);
  if (pos === -1) {
    assessSelectedIndices.push(index);
  } else {
    assessSelectedIndices.splice(pos, 1);
  }

  // Update visual state
  document.querySelectorAll('#quizOptions .option-btn.checkbox').forEach((btn, i) => {
    btn.classList.toggle('selected', assessSelectedIndices.indexOf(i) !== -1);
  });

  // Enable/disable + show/hide the submit selection button
  var msSubmitBtn = document.getElementById('multiSelectSubmitBtn');
  if (msSubmitBtn) {
    var hasSelection = assessSelectedIndices.length > 0;
    msSubmitBtn.disabled = !hasSelection;
    msSubmitBtn.style.display = hasSelection ? 'inline-block' : 'none';
  }
}

// ── Submit Answer ──
async function submitAssessmentAnswer() {
  // Validate selection based on question type
  if (assessCurrentQuestionType === 'multiple_select') {
    if (assessSelectedIndices.length === 0) return;
  } else {
    if (assessSelectedIndex === null) return;
  }

  stopQuestionTimer();

  // Disable all submit buttons
  document.getElementById('quizSubmitBtn').disabled = true;
  document.getElementById('quizSubmitBtn').textContent = 'Submitting...';
  var msSubmitBtn = document.getElementById('multiSelectSubmitBtn');
  if (msSubmitBtn) {
    msSubmitBtn.disabled = true;
    msSubmitBtn.textContent = 'Submitting...';
  }

  // Build payload based on question type
  var payload = { sessionId: assessSessionId };
  if (assessCurrentQuestionType === 'multiple_select') {
    payload.selectedIndices = assessSelectedIndices.slice().sort();
  } else {
    payload.selectedIndex = assessSelectedIndex;
  }

  try {
    const resp = await fetch('/api/assessment/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();

    if (data.error) {
      alert('Error: ' + data.error);
      document.getElementById('quizSubmitBtn').disabled = false;
      document.getElementById('quizSubmitBtn').textContent = 'Submit Answer';
      if (msSubmitBtn) { msSubmitBtn.disabled = false; msSubmitBtn.textContent = 'Submit Selection'; }
      return;
    }

    assessIsComplete = data.isComplete;

    // Show feedback screen
    showAssessScreen('assess-feedback');
    const feedbackCard = document.getElementById('feedbackCard');
    feedbackCard.className = 'feedback-card ' + (data.correct ? 'correct' : 'wrong');

    document.getElementById('feedbackIcon').textContent = data.correct ? '✓' : '✗';
    document.getElementById('feedbackTitle').textContent = data.correct ? 'Correct!' : 'Incorrect';

    document.getElementById('feedbackYourAnswer').innerHTML =
      '<span class="feedback-label">Your Answer:</span> ' + data.selectedAnswer;
    document.getElementById('feedbackCorrectAnswer').innerHTML =
      '<span class="feedback-label">Correct Answer:</span> ' + data.correctAnswer;

    document.getElementById('feedbackExplanation').textContent = data.explanation || '';
    document.getElementById('feedbackTheta').textContent = data.currentTheta + ' / 10';

    // Update next button text
    const nextBtn = document.getElementById('feedbackNextBtn');
    if (data.isComplete) {
      nextBtn.textContent = 'View Results →';
      nextBtn.onclick = showAssessmentResults;
    } else {
      nextBtn.textContent = 'Next Question →';
      nextBtn.onclick = loadNextAssessmentQuestion;
    }

    // Reset submit button text and visibility
    document.getElementById('quizSubmitBtn').textContent = 'Submit Answer';
    document.getElementById('quizSubmitBtn').style.display = '';
    if (msSubmitBtn) msSubmitBtn.remove();
    var hint = document.getElementById('multiSelectHint');
    if (hint) hint.remove();

  } catch (err) {
    alert('Failed to submit answer.');
    document.getElementById('quizSubmitBtn').disabled = false;
    document.getElementById('quizSubmitBtn').textContent = 'Submit Answer';
    if (msSubmitBtn) { msSubmitBtn.disabled = false; msSubmitBtn.textContent = 'Submit Selection'; }
    console.error('submitAssessmentAnswer error:', err);
  }
}

// ── Show Assessment Results ──
async function showAssessmentResults() {
  showAssessScreen('assess-results');

  try {
    const resp = await fetch('/api/assessment/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: assessSessionId, userId: currentUser.email })
    });
    const data = await resp.json();

    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }

    // Skill name
    document.getElementById('assessResultSkill').textContent = data.skill + ' Assessment';

    // Score gauge animation
    const gaugeText = document.getElementById('scoreGaugeText');
    const gaugeCircle = document.getElementById('scoreGaugeCircle');
    const circumference = 2 * Math.PI * 85; // ~534
    const targetOffset = circumference - (circumference * (data.finalScore / 10));

    // Animate score number
    let currentScore = 0;
    const scoreInterval = setInterval(() => {
      currentScore++;
      gaugeText.textContent = currentScore;
      if (currentScore >= data.finalScore) clearInterval(scoreInterval);
    }, 80);

    // Animate gauge circle
    gaugeCircle.style.transition = 'stroke-dashoffset 1.2s ease-out';
    gaugeCircle.style.strokeDashoffset = targetOffset;

    // Color based on score
    const gaugeColor = data.finalScore >= 8 ? '#16a34a' : data.finalScore >= 5 ? '#4f46e5' : data.finalScore >= 3 ? '#f59e0b' : '#ef4444';
    gaugeCircle.setAttribute('stroke', gaugeColor);

    // Meta cards
    document.getElementById('assessSkillLevel').textContent = data.skillLevel;
    document.getElementById('assessAccuracy').textContent = data.accuracy + '%';
    document.getElementById('assessConfidence').textContent = data.confidence.charAt(0).toUpperCase() + data.confidence.slice(1);

    const mins = Math.floor(data.duration / 60);
    const secs = data.duration % 60;
    document.getElementById('assessDuration').textContent = mins + 'm ' + secs + 's';

    // Theta trajectory chart
    renderThetaChart(data.thetaTrajectory);

    // Question type breakdown summary
    var typeCounts = { mcq: 0, true_false: 0, multiple_select: 0, coding: 0 };
    var seedCount = 0;
    var aiCount = 0;
    data.breakdown.forEach(function(item) {
      var qtype = item.type || 'mcq';
      if (typeCounts.hasOwnProperty(qtype)) typeCounts[qtype]++;
      else typeCounts.mcq++;
      if (item.phase === 'seed' || item.source === 'seed') seedCount++;
      else if (item.phase === 'ai' || item.source === 'gemini' || item.source === 'ai') aiCount++;
    });

    var typeLabels = { mcq: 'MCQ', true_false: 'T/F', multiple_select: 'Multi-Select', coding: 'Coding' };
    var typeBreakdownHtml = '<div class="question-type-breakdown">';
    Object.keys(typeCounts).forEach(function(t) {
      if (typeCounts[t] > 0) {
        typeBreakdownHtml += '<span class="qtype-chip ' + t + '">' + typeLabels[t] + ': ' + typeCounts[t] + '</span>';
      }
    });
    if (seedCount > 0) typeBreakdownHtml += '<span class="qtype-chip"><span class="phase-badge seed" style="margin:0;">\u{1F4DA} Question Bank</span> ' + seedCount + '</span>';
    if (aiCount > 0) typeBreakdownHtml += '<span class="qtype-chip"><span class="phase-badge ai" style="margin:0;">\u{1F916} AI Generated</span> ' + aiCount + '</span>';
    typeBreakdownHtml += '</div>';

    // Insert type breakdown before the question list
    const breakdownEl = document.getElementById('assessBreakdown');
    breakdownEl.innerHTML = typeBreakdownHtml;

    // Question breakdown (supports 12 questions)
    data.breakdown.forEach(item => {
      const div = document.createElement('div');
      div.className = 'breakdown-item ' + (item.correct ? 'correct' : 'wrong');
      var timeTakenHtml = item.timeTaken != null ? '<span class="breakdown-time">' + item.timeTaken + 's</span>' : '';
      var typeLabel = typeLabels[item.type || 'mcq'] || 'MCQ';
      var phaseBadge = '';
      if (item.phase === 'seed' || item.source === 'seed') {
        phaseBadge = ' <span class="phase-badge seed">\u{1F4DA} Question Bank</span>';
      } else if (item.phase === 'ai' || item.source === 'gemini' || item.source === 'ai') {
        phaseBadge = ' <span class="phase-badge ai">\u{1F916} AI</span>';
      }
      div.innerHTML =
        '<div class="breakdown-header">' +
          '<span class="breakdown-num">Q' + item.questionNumber + '</span>' +
          '<span class="breakdown-result">' + (item.correct ? '✓ Correct' : '✗ Wrong') + '</span>' +
          '<span class="breakdown-diff">Difficulty ' + item.difficulty + '</span>' +
          '<span style="font-size:11px;color:#64748b;">' + typeLabel + '</span>' +
          phaseBadge +
          timeTakenHtml +
        '</div>' +
        '<div class="breakdown-question">' + item.question + '</div>' +
        (item.explanation ? '<div class="breakdown-explanation">' + item.explanation + '</div>' : '');
      breakdownEl.appendChild(div);
    });

    // Recommendations
    const recsEl = document.getElementById('assessRecommendations');
    recsEl.innerHTML = '';
    data.recommendations.forEach(rec => {
      const li = document.createElement('li');
      li.textContent = rec;
      li.style.marginBottom = '8px';
      li.style.color = '#475569';
      recsEl.appendChild(li);
    });

    // Coaching CTA based on score
    var coachingCta = document.getElementById('assessCoachingCta');
    if (!coachingCta) {
      coachingCta = document.createElement('div');
      coachingCta.id = 'assessCoachingCta';
      recsEl.parentNode.insertBefore(coachingCta, recsEl.nextSibling);
    }
    if (data.finalScore >= 8) {
      coachingCta.innerHTML = '<div style="margin-top:16px;padding:14px 18px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1px solid #6ee7b7;border-radius:12px;display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:24px;">&#127891;</span>' +
        '<div><strong style="color:#065f46;">You can coach others in ' + escHtml(data.skill) + '!</strong>' +
        '<div style="font-size:13px;color:#047857;margin-top:2px;">Your score qualifies you to become a verified peer coach.</div></div>' +
        '<button class="btn btn-primary" onclick="navigateTo(\'coaching\')" style="margin-left:auto;white-space:nowrap;">Become a Coach</button>' +
      '</div>';
    } else if (data.finalScore <= 5) {
      coachingCta.innerHTML = '<div style="margin-top:16px;padding:14px 18px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #93c5fd;border-radius:12px;display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:24px;">&#128218;</span>' +
        '<div><strong style="color:#1e40af;">Get help from a peer coach</strong>' +
        '<div style="font-size:13px;color:#2563eb;margin-top:2px;">Connect with verified coaches who scored 8+ in ' + escHtml(data.skill) + '.</div></div>' +
        '<button class="btn btn-primary" onclick="navigateTo(\'coaching\')" style="margin-left:auto;white-space:nowrap;">Find a Coach</button>' +
      '</div>';
    } else {
      coachingCta.innerHTML = '';
    }

    // Save score to localStorage
    saveAssessmentScore(data.skill, data.finalScore, data.skillLevel);

    // Load and display assessment history
    loadAssessmentHistory(data.skill);

  } catch (err) {
    alert('Failed to load results.');
    console.error('showAssessmentResults error:', err);
  }
}

// ── Render Theta Trajectory Chart (Canvas) ──
function renderThetaChart(trajectory) {
  const canvas = document.getElementById('thetaChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Set canvas size
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 200 * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = 200;
  const padding = { top: 20, right: 30, bottom: 35, left: 40 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i += 2) {
    const y = padding.top + plotH - (i / 10) * plotH;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();

    // Y-axis labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(i, padding.left - 8, y + 4);
  }

  if (!trajectory || trajectory.length === 0) return;

  // Plot points and line
  const points = trajectory.map((t, i) => ({
    x: padding.left + (i / (trajectory.length - 1 || 1)) * plotW,
    y: padding.top + plotH - ((t.theta / 10) * plotH),
    correct: t.correct,
    theta: t.theta,
    q: t.q
  }));

  // Draw line
  ctx.beginPath();
  ctx.strokeStyle = '#4f46e5';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();

  // Draw dots
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = p.correct ? '#16a34a' : '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // X-axis labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  points.forEach(p => {
    ctx.fillText('Q' + p.q, p.x, h - padding.bottom + 18);
  });

  // Legend
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'left';

  ctx.beginPath();
  ctx.arc(w - 160, padding.top, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#16a34a';
  ctx.fill();
  ctx.fillStyle = '#64748b';
  ctx.fillText('Correct', w - 152, padding.top + 4);

  ctx.beginPath();
  ctx.arc(w - 90, padding.top, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ef4444';
  ctx.fill();
  ctx.fillStyle = '#64748b';
  ctx.fillText('Wrong', w - 82, padding.top + 4);
}

// ── Save Assessment Score to localStorage ──
function saveAssessmentScore(skill, score, level) {
  var scores = JSON.parse(localStorage.getItem('sgaSkillScores') || '{}');
  scores[skill] = {
    score: score,
    level: level,
    date: new Date().toISOString().split('T')[0]
  };
  localStorage.setItem('sgaSkillScores', JSON.stringify(scores));
}

// ── Load Assessment History on Results Page ──
async function loadAssessmentHistory(skill) {
  try {
    var historyContainer = document.getElementById('assessHistorySection');
    if (!historyContainer) {
      // Create the history section after recommendations
      var recsEl = document.getElementById('assessRecommendations');
      if (!recsEl) return;
      historyContainer = document.createElement('div');
      historyContainer.id = 'assessHistorySection';
      historyContainer.style.marginTop = '32px';
      recsEl.parentNode.insertBefore(historyContainer, recsEl.nextSibling);
    }
    historyContainer.innerHTML = '<h3 style="font-size:16px;font-weight:600;color:#1e293b;margin-bottom:12px;">Assessment History</h3><div style="color:#94a3b8;font-size:13px;">Loading history...</div>';

    var resp = await fetch('/api/assessment/history?userId=' + encodeURIComponent(currentUser.email));
    var histData = await resp.json();

    var attempts = (histData.history || []).filter(function(h) { return h.skill === skill; });

    if (attempts.length === 0) {
      historyContainer.innerHTML = '<h3 style="font-size:16px;font-weight:600;color:#1e293b;margin-bottom:12px;">Assessment History</h3><div style="color:#94a3b8;font-size:13px;">No previous attempts for this skill.</div>';
      return;
    }

    var listHtml = attempts.map(function(a) {
      var dateStr = a.date || 'N/A';
      return '<div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">' +
        '<span style="color:#64748b;">' + dateStr + '</span>' +
        '<span style="color:#1e293b;font-weight:500;">' + (a.score != null ? a.score + '/10' : 'N/A') + '</span>' +
        '<span style="color:#4f46e5;">' + (a.level || 'N/A') + '</span>' +
      '</div>';
    }).join('');

    historyContainer.innerHTML = '<h3 style="font-size:16px;font-weight:600;color:#1e293b;margin-bottom:12px;">Assessment History</h3>' +
      '<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">' +
        '<div style="display:flex;justify-content:space-between;padding:8px 12px;background:#f8fafc;font-size:12px;font-weight:600;color:#64748b;">' +
          '<span>Date</span><span>Score</span><span>Level</span>' +
        '</div>' + listHtml +
      '</div>';
  } catch (err) {
    console.error('loadAssessmentHistory error:', err);
    if (historyContainer) {
      historyContainer.innerHTML = '<h3 style="font-size:16px;font-weight:600;color:#1e293b;margin-bottom:12px;">Assessment History</h3><div style="color:#94a3b8;font-size:13px;">Could not load history.</div>';
    }
  }
}

// ── Display Past Assessment Scores on Home Page ──
function displayPastAssessmentScores() {
  var scores = JSON.parse(localStorage.getItem('sgaSkillScores') || '{}');
  var skillNames = Object.keys(scores);
  if (skillNames.length === 0) return;

  var el = document.getElementById('userSkillChips');
  if (!el) return;

  // Create or find the scores container
  var scoresSection = document.getElementById('pastAssessmentScores');
  if (!scoresSection) {
    scoresSection = document.createElement('div');
    scoresSection.id = 'pastAssessmentScores';
    scoresSection.style.marginTop = '16px';
    el.parentNode.insertBefore(scoresSection, el.nextSibling);
  }

  var heading = '<div style="font-size:14px;font-weight:600;color:#1e293b;margin-bottom:10px;">Assessment Scores</div>';
  var cards = skillNames.map(function(name) {
    var s = scores[name];
    var scoreColor = s.score >= 8 ? '#16a34a' : s.score >= 5 ? '#4f46e5' : s.score >= 3 ? '#f59e0b' : '#ef4444';
    return '<div style="display:inline-flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;margin:4px;font-size:13px;">' +
      '<span style="font-weight:600;color:#1e293b;">' + name + '</span>' +
      '<span style="color:' + scoreColor + ';font-weight:700;">' + s.score + '/10</span>' +
      '<span style="color:#64748b;">' + s.level + '</span>' +
    '</div>';
  }).join('');

  scoresSection.innerHTML = heading + '<div>' + cards + '</div>';
}

// ── Navigation Helpers ──
function confirmQuitAssessment() {
  var modal = document.getElementById('quitAssessModal');
  if (modal) modal.style.display = 'flex';
}

function closeQuitModal() {
  var modal = document.getElementById('quitAssessModal');
  if (modal) modal.style.display = 'none';
}

function doQuitAssessment() {
  closeQuitModal();
  showAssessmentSelect();
}

function showAssessmentSelect() {
  assessSessionId = null;
  assessCurrentSkill = null;
  assessSelectedIndex = null;
  assessSelectedIndices = [];
  assessCurrentQuestionType = null;
  assessIsComplete = false;
  stopQuestionTimer();
  showAssessScreen('assess-select');
  // Reset gauge for next time
  const gaugeCircle = document.getElementById('scoreGaugeCircle');
  if (gaugeCircle) {
    gaugeCircle.style.transition = 'none';
    gaugeCircle.style.strokeDashoffset = '534';
  }
  initAssessment();
}

function retakeAssessment() {
  if (assessCurrentSkill) {
    // Reset gauge
    const gaugeCircle = document.getElementById('scoreGaugeCircle');
    if (gaugeCircle) {
      gaugeCircle.style.transition = 'none';
      gaugeCircle.style.strokeDashoffset = '534';
    }
    startAssessment(assessCurrentSkill);
  } else {
    showAssessmentSelect();
  }
}

// ══════════════════════════════════════
// JOBS BOARD – Live Job Listings
// ══════════════════════════════════════

let jobsCurrentPage = 1;
let jobsTotalPages = 1;
let jobsInitialized = false;

function initJobsPage() {
  if (jobsInitialized) return;
  jobsInitialized = true;

  // Populate skill-based search tags from assessment scores
  const scores = JSON.parse(localStorage.getItem('sgaSkillScores') || '{}');
  const skillTags = document.getElementById('skillBasedTags');
  if (skillTags) {
    const skillNames = Object.keys(scores);
    if (skillNames.length > 0) {
      skillTags.innerHTML = skillNames.map(function(s) {
        return '<span class="filter-tag" onclick="quickSearch(\'' + s + '\')">' + s + '</span>';
      }).join('');
    } else {
      skillTags.innerHTML = '<span style="font-size:12px;color:#94a3b8;">Complete assessments to see skill-based suggestions</span>';
    }
  }

  // Enter key triggers search
  var searchInput = document.getElementById('jobSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') searchJobs(1);
    });
  }

  // Load initial jobs
  searchJobs(1);
}

function quickSearch(term) {
  var searchInput = document.getElementById('jobSearchInput');
  if (searchInput) searchInput.value = term;
  searchJobs(1);
}

function clearJobFilters() {
  var searchInput = document.getElementById('jobSearchInput');
  var categoryFilter = document.getElementById('jobCategoryFilter');
  var levelFilter = document.getElementById('jobLevelFilter');
  var locationFilter = document.getElementById('jobLocationFilter');
  if (searchInput) searchInput.value = '';
  if (categoryFilter) categoryFilter.value = '';
  if (levelFilter) levelFilter.value = '';
  if (locationFilter) locationFilter.value = '';
  searchJobs(1);
}

async function searchJobs(page) {
  jobsCurrentPage = page;
  var listingsEl = document.getElementById('jobListings');
  if (!listingsEl) return;

  // Show loading
  listingsEl.innerHTML =
    '<div class="jobs-loading">' +
    '<div class="spinner" style="display:inline-block;width:32px;height:32px;border:3px solid #e2e8f0;border-top-color:#4f46e5;border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
    '<p style="margin-top:12px;color:#94a3b8;">Fetching live job listings...</p>' +
    '</div>';

  var search = (document.getElementById('jobSearchInput') || {}).value || '';
  var category = (document.getElementById('jobCategoryFilter') || {}).value || '';
  var level = (document.getElementById('jobLevelFilter') || {}).value || '';
  var location = (document.getElementById('jobLocationFilter') || {}).value || '';

  var params = new URLSearchParams();
  if (search) params.append('search', search);
  if (category) params.append('category', category);
  if (level) params.append('level', level);
  if (location) params.append('location', location);
  params.append('page', page.toString());

  try {
    var resp = await fetch('/api/jobs?' + params.toString());
    var data = await resp.json();

    if (data.error) {
      listingsEl.innerHTML = '<div class="jobs-loading"><p style="color:#ef4444;">Error: ' + data.error + '</p></div>';
      return;
    }

    jobsTotalPages = data.totalPages || 1;

    // Update summary
    var countEl = document.getElementById('jobsCount');
    var sourceEl = document.getElementById('jobsSource');
    if (countEl) countEl.textContent = 'Found ' + (data.totalJobs || data.jobs.length) + ' jobs' + (search ? ' for "' + search + '"' : '');
    if (sourceEl) {
      sourceEl.textContent = '📡 ' + data.source;
      sourceEl.style.display = 'inline-block';
    }

    if (!data.jobs || data.jobs.length === 0) {
      listingsEl.innerHTML =
        '<div class="jobs-loading">' +
        '<p style="color:#64748b;font-size:16px;">No jobs found</p>' +
        '<p style="color:#94a3b8;font-size:13px;margin-top:8px;">Try a different search term or category</p>' +
        '</div>';
      document.getElementById('jobsPagination').style.display = 'none';
      return;
    }

    // Store jobs for modal access
    window._currentJobs = data.jobs;

    // Render job cards
    listingsEl.innerHTML = data.jobs.map(function(job, idx) {
      var icon = getJobIcon(job.title, job.categories);
      var timeAgo = job.publishedAt ? getTimeAgo(job.publishedAt) : '';
      var locationText = job.location || 'Not specified';
      var levelText = job.level || '';
      var tags = [];

      if (job.type) tags.push(job.type);
      if (locationText.toLowerCase().includes('remote') || job.remote) tags.push('Remote');
      if (levelText) tags.push(levelText);
      if (job.categories && job.categories.length > 0) tags.push(job.categories[0]);

      var isNew = false;
      if (job.publishedAt) {
        var daysDiff = (Date.now() - new Date(job.publishedAt).getTime()) / (1000 * 60 * 60 * 24);
        isNew = daysDiff <= 3;
      }

      var tagsHtml = tags.slice(0, 4).map(function(t) {
        return '<span class="job-tag">' + escapeHtml(t) + '</span>';
      }).join('');
      if (isNew) tagsHtml += '<span class="job-tag new">New</span>';
      if (job.salary) tagsHtml += '<span class="job-tag salary">' + escapeHtml(job.salary) + '</span>';

      return '<div class="job-card" onclick="openJobModal(window._currentJobs[' + idx + '])" style="cursor:pointer;">' +
        '<div class="job-top">' +
          '<div class="job-logo">' + icon + '</div>' +
          '<div>' +
            '<div class="job-title">' + escapeHtml(job.title) + '</div>' +
            '<div class="job-company">' + escapeHtml(job.company) + ' • ' + escapeHtml(locationText) + '</div>' +
            (timeAgo ? '<div class="job-time">' + timeAgo + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="job-tags">' + tagsHtml + '</div>' +
        '<div class="job-bottom">' +
          '<a href="' + escapeHtml(job.url) + '" target="_blank" rel="noopener" class="job-apply" onclick="event.stopPropagation()">View Original →</a>' +
          '<div class="job-bookmark" onclick="event.stopPropagation();toggleBookmark(this)" title="Save job">☆</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Pagination
    var paginationEl = document.getElementById('jobsPagination');
    if (paginationEl) {
      paginationEl.style.display = 'flex';
      document.getElementById('jobsPrevBtn').disabled = (page <= 1);
      document.getElementById('jobsNextBtn').disabled = (page >= jobsTotalPages);
      document.getElementById('jobsPageInfo').textContent = 'Page ' + page + ' of ' + jobsTotalPages;
    }

  } catch (err) {
    console.error('searchJobs error:', err);
    listingsEl.innerHTML =
      '<div class="jobs-loading">' +
      '<p style="color:#ef4444;">Failed to load jobs</p>' +
      '<p style="color:#94a3b8;font-size:13px;margin-top:8px;">Make sure the server is running at localhost:8080</p>' +
      '</div>';
  }
}

function loadJobPage(direction) {
  var newPage = jobsCurrentPage + direction;
  if (newPage >= 1 && newPage <= jobsTotalPages) {
    searchJobs(newPage);
    // Scroll to top of jobs section
    var jobsSection = document.getElementById('page-jobs');
    if (jobsSection) jobsSection.scrollIntoView({ behavior: 'smooth' });
  }
}

function toggleBookmark(el) {
  el.textContent = el.textContent === '☆' ? '★' : '☆';
  el.style.color = el.textContent === '★' ? '#4f46e5' : '';
}

function getJobIcon(title, categories) {
  var t = (title || '').toLowerCase();
  var cats = (categories || []).join(' ').toLowerCase();
  if (t.includes('data') || cats.includes('data')) return '📊';
  if (t.includes('machine learning') || t.includes(' ml ') || t.includes('ai ') || cats.includes('ai')) return '🤖';
  if (t.includes('frontend') || t.includes('front-end') || t.includes('react') || t.includes('ui')) return '🎨';
  if (t.includes('backend') || t.includes('back-end') || t.includes('server')) return '⚙️';
  if (t.includes('cloud') || t.includes('devops') || t.includes('infrastructure')) return '☁️';
  if (t.includes('security') || t.includes('cyber')) return '🔒';
  if (t.includes('product') || t.includes('manager')) return '📋';
  if (t.includes('design') || cats.includes('design')) return '✏️';
  if (t.includes('engineer') || t.includes('developer') || t.includes('software')) return '💻';
  if (t.includes('marketing')) return '📢';
  if (t.includes('finance') || t.includes('analyst')) return '📈';
  return '💼';
}

function getTimeAgo(dateStr) {
  var diff = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(diff / 60000);
  var hrs = Math.floor(diff / 3600000);
  var days = Math.floor(diff / 86400000);
  if (days > 30) return Math.floor(days / 30) + ' months ago';
  if (days > 0) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
  if (hrs > 0) return hrs + ' hour' + (hrs > 1 ? 's' : '') + ' ago';
  if (mins > 0) return mins + ' min ago';
  return 'Just now';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ══════════════════════════════════════
// NEWS – Live Tech & Career News
// ══════════════════════════════════════

async function loadNewsArticles() {
  var grid = document.getElementById('newsGrid');
  if (!grid) return;

  grid.innerHTML = '<div class="news-card" style="grid-column:1/-1;text-align:center;padding:40px;"><p style="color:#94a3b8;">Loading latest articles...</p></div>';

  try {
    var resp = await fetch('/api/news');
    var data = await resp.json();

    if (data.error) {
      grid.innerHTML = '<div class="news-card" style="grid-column:1/-1;text-align:center;padding:30px;"><p style="color:#ef4444;">Failed to load news</p></div>';
      return;
    }

    var articles = data.articles || [];
    var hnStories = data.hnStories || [];
    var html = '';

    // DEV.to articles (with images)
    var gradients = [
      'linear-gradient(135deg,#1e1b4b,#4338ca)',
      'linear-gradient(135deg,#7f1d1d,#dc2626)',
      'linear-gradient(135deg,#064e3b,#059669)',
      'linear-gradient(135deg,#78350f,#d97706)',
      'linear-gradient(135deg,#581c87,#9333ea)',
      'linear-gradient(135deg,#0c4a6e,#0284c7)'
    ];

    articles.slice(0, 4).forEach(function(article, i) {
      var bgStyle = article.image
        ? 'background-image:url(' + escapeHtml(article.image) + ');background-size:cover;background-position:center;'
        : 'background:' + gradients[i % gradients.length] + ';';

      var tagLabel = (article.tags && article.tags[0]) || 'Tech';
      var tagClass = tagLabel.toLowerCase().includes('career') ? 'careers' :
                     tagLabel.toLowerCase().includes('ai') ? 'research' : 'tech';

      html += '<a href="' + escapeHtml(article.url) + '" target="_blank" rel="noopener" class="news-card" style="text-decoration:none;color:inherit;">' +
        '<div class="news-img" style="' + bgStyle + '">' +
          '<span class="news-badge ' + tagClass + '">' + escapeHtml(tagLabel) + '</span>' +
        '</div>' +
        '<div class="news-body">' +
          '<div class="news-date">' + escapeHtml(article.readableDate || '') + ' • ' + (article.readingTime || '?') + ' min read</div>' +
          '<div class="news-title">' + escapeHtml(article.title) + '</div>' +
          '<div class="news-excerpt">' + escapeHtml(article.description.substring(0, 80)) + (article.description.length > 80 ? '...' : '') + '</div>' +
          '<div class="news-author">' +
            (article.author.avatar ? '<img src="' + escapeHtml(article.author.avatar) + '" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:4px;">' : '') +
            escapeHtml(article.author.name) +
            '<span style="margin-left:auto;color:#94a3b8;font-size:11px;">❤️ ' + article.reactions + ' 💬 ' + article.comments + '</span>' +
          '</div>' +
        '</div>' +
      '</a>';
    });

    // Hacker News stories (compact list below)
    if (hnStories.length > 0) {
      html += '<div style="grid-column:1/-1;border-top:1px solid #f1f5f9;padding-top:12px;">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">' +
          '<span style="font-size:14px;color:#ff6600;">Y</span>' +
          '<span style="font-size:12px;font-weight:600;color:#64748b;">Trending on Hacker News</span>' +
        '</div>';

      hnStories.slice(0, 5).forEach(function(story) {
        html += '<a href="' + escapeHtml(story.url) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:6px 0;text-decoration:none;color:inherit;border-bottom:1px solid #f8fafc;">' +
          '<span style="font-size:12px;font-weight:700;color:#ff6600;min-width:32px;">▲ ' + story.score + '</span>' +
          '<span style="font-size:13px;color:#1e293b;line-height:1.3;">' + escapeHtml(story.title) + '</span>' +
          '<span style="margin-left:auto;font-size:11px;color:#94a3b8;white-space:nowrap;">💬 ' + story.comments + '</span>' +
        '</a>';
      });

      html += '</div>';
    }

    grid.innerHTML = html || '<div class="news-card" style="grid-column:1/-1;text-align:center;padding:30px;"><p style="color:#94a3b8;">No news available</p></div>';

  } catch (err) {
    console.error('loadNewsArticles error:', err);
    grid.innerHTML = '<div class="news-card" style="grid-column:1/-1;text-align:center;padding:30px;"><p style="color:#ef4444;">Failed to load news. Server may be offline.</p></div>';
  }
}

// ── Platform Search Integration ──
function searchOnPlatform(platform) {
  var query = (document.getElementById('platformSearchQuery') || {}).value || '';
  var location = (document.getElementById('platformSearchLocation') || {}).value || '';
  // Also grab from main search bar if platform bar is empty
  if (!query) query = (document.getElementById('jobSearchInput') || {}).value || 'software engineer';

  var fullQuery = query + (location ? ' in ' + location : '');
  var url = '';

  switch (platform) {
    case 'google':
      url = 'https://www.google.com/search?q=' + encodeURIComponent(fullQuery + ' jobs') + '&ibp=htl;jobs';
      break;
    case 'indeed':
      url = 'https://www.indeed.com/jobs?q=' + encodeURIComponent(query) + (location ? '&l=' + encodeURIComponent(location) : '');
      break;
    case 'glassdoor':
      url = 'https://www.glassdoor.com/Job/jobs.htm?sc.keyword=' + encodeURIComponent(query) + (location ? '&locT=C&locKeyword=' + encodeURIComponent(location) : '');
      break;
    case 'wellfound':
      url = 'https://wellfound.com/jobs?q=' + encodeURIComponent(query);
      break;
    case 'remotive':
      url = 'https://remotive.com/remote-jobs/software-dev?query=' + encodeURIComponent(query);
      break;
    default:
      url = 'https://www.google.com/search?q=' + encodeURIComponent(fullQuery + ' jobs') + '&ibp=htl;jobs';
  }

  window.open(url, '_blank', 'noopener');
}

// ── Job Detail Modal ──
function openJobModal(job) {
  var overlay = document.getElementById('jobModalOverlay');
  var icon = getJobIcon(job.title, job.categories);

  document.getElementById('jobModalIcon').textContent = icon;
  document.getElementById('jobModalTitle').textContent = job.title;
  document.getElementById('jobModalCompany').textContent = job.company + ' • ' + (job.location || 'Not specified');
  document.getElementById('jobModalApplyLink').href = job.url;

  // Tags
  var tags = [];
  if (job.type) tags.push(job.type);
  if (job.level) tags.push(job.level);
  if (job.categories && job.categories[0]) tags.push(job.categories[0]);
  if (job.salary) tags.push(job.salary);

  document.getElementById('jobModalTags').innerHTML = tags.map(function(t) {
    return '<span class="job-tag">' + escapeHtml(t) + '</span>';
  }).join('');

  // Meta
  var timeAgo = job.publishedAt ? getTimeAgo(job.publishedAt) : '';
  document.getElementById('jobModalMeta').textContent = (timeAgo ? 'Posted ' + timeAgo : '') + ' • Source: ' + (job.source || 'API');

  // Platform search links for this specific job
  var searchTerm = encodeURIComponent(job.title);
  var platformsHtml =
    '<a href="https://www.google.com/search?q=' + searchTerm + '+jobs&ibp=htl;jobs" target="_blank" rel="noopener" class="job-modal-platform-btn"><span>🔍</span> Google Jobs</a>' +
    '<a href="https://www.indeed.com/jobs?q=' + searchTerm + '" target="_blank" rel="noopener" class="job-modal-platform-btn"><span>🔵</span> Indeed</a>' +
    '<a href="https://www.glassdoor.com/Job/jobs.htm?sc.keyword=' + searchTerm + '" target="_blank" rel="noopener" class="job-modal-platform-btn"><span>🟢</span> Glassdoor</a>';

  document.getElementById('jobModalPlatforms').innerHTML = platformsHtml;

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeJobModal(event) {
  if (event && event.target !== document.getElementById('jobModalOverlay')) return;
  document.getElementById('jobModalOverlay').classList.remove('active');
  document.body.style.overflow = '';
}
// Close on escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeJobModal();
});

// Also update home page job cards to show real jobs
async function initJobCardsFromAPI() {
  var el = document.getElementById('jobList');
  if (!el) return;

  try {
    var resp = await fetch('/api/jobs?category=Software+Engineering&page=1');
    var data = await resp.json();

    if (data.jobs && data.jobs.length > 0) {
      el.innerHTML = '';
      data.jobs.slice(0, 3).forEach(function(job) {
        var icon = getJobIcon(job.title, job.categories);
        var tags = [];
        if (job.type) tags.push(job.type);
        if (job.location) tags.push(job.location.split(',')[0]);

        var tagsHtml = tags.slice(0, 2).map(function(t) {
          return '<span class="job-tag">' + escapeHtml(t) + '</span>';
        }).join('');

        el.innerHTML +=
          '<div class="job-card">' +
          '<div class="job-card-top">' +
            '<div class="job-icon" style="background:#eef2ff;">' + icon + '</div>' +
            '<div>' +
              '<div class="job-title">' + escapeHtml(job.title) + '</div>' +
              '<div class="job-company">' + escapeHtml(job.company) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="job-tags">' + tagsHtml + '</div>' +
          '<div class="job-actions">' +
            '<a href="' + escapeHtml(job.url) + '" target="_blank" rel="noopener" class="job-apply">View Job</a>' +
            '<span class="job-save" onclick="this.textContent=\'★ Saved\';this.style.color=\'#4f46e5\'">☆ Save</span>' +
          '</div>' +
          '</div>';
      });
    } else {
      // No jobs from API — show fallback message
      el.innerHTML =
        '<div style="text-align:center;padding:24px;">' +
          '<p style="color:#64748b;font-size:14px;margin-bottom:12px;">Browse Jobs to see listings</p>' +
          '<button onclick="navigateTo(\'jobs\')" style="background:#4f46e5;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;">Browse Jobs</button>' +
        '</div>';
    }
  } catch (err) {
    // API call failed — show fallback message
    console.log('Job cards API failed, showing fallback');
    el.innerHTML =
      '<div style="text-align:center;padding:24px;">' +
        '<p style="color:#64748b;font-size:14px;margin-bottom:12px;">Browse Jobs to see listings</p>' +
        '<button onclick="navigateTo(\'jobs\')" style="background:#4f46e5;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;">Browse Jobs</button>' +
      '</div>';
  }
}

// ══════════════════════════════════════
// PROFILE PAGE – Dynamic Data
// ══════════════════════════════════════

var profileState = {
  data: null,
  strength: null,
  skillsLab: null
};

function getStoredSkillScores() {
  return parseStoredJson(localStorage.getItem('sgaSkillScores'), {}) || {};
}

function persistCurrentUserSession() {
  var serialized = JSON.stringify(currentUser);
  var updated = false;

  if (localStorage.getItem('sgaCurrentUser')) {
    localStorage.setItem('sgaCurrentUser', serialized);
    updated = true;
  }
  if (sessionStorage.getItem('sgaCurrentUser')) {
    sessionStorage.setItem('sgaCurrentUser', serialized);
    updated = true;
  }
  if (!updated) {
    localStorage.setItem('sgaCurrentUser', serialized);
  }
}

function updateCurrentUserSession(updates) {
  Object.keys(updates || {}).forEach(function(key) {
    if (updates[key] !== undefined) {
      currentUser[key] = updates[key];
    }
  });
  persistCurrentUserSession();
  initUser();
}

function ensureAbsoluteUrl(url) {
  var trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed.replace(/^\/+/, '');
}

function buildProfileScoreMap(skillsLabData) {
  var scoreMap = {};
  var skillMatrix = skillsLabData && Array.isArray(skillsLabData.skillMatrix) ? skillsLabData.skillMatrix : [];

  skillMatrix.forEach(function(entry) {
    scoreMap[entry.name] = {
      score: entry.score,
      level: entry.level,
      date: entry.lastAssessed,
      attempts: entry.attempts,
      verified: entry.verified
    };
  });

  var localScores = getStoredSkillScores();
  Object.keys(localScores).forEach(function(skillName) {
    if (!scoreMap[skillName]) {
      scoreMap[skillName] = localScores[skillName];
    }
  });

  return scoreMap;
}

function getProfileEmptyState(title, description, actionLabel, action) {
  var actionHtml = actionLabel && action
    ? '<button class="profile-empty-action" onclick="' + action + '">' + escapeHtml(actionLabel) + '</button>'
    : '';

  return '<div class="profile-empty-state">' +
    '<div class="profile-empty-title">' + escapeHtml(title) + '</div>' +
    '<div class="profile-empty-copy">' + escapeHtml(description) + '</div>' +
    actionHtml +
  '</div>';
}

function renderProfileSocialLinks(social) {
  var socialEl = document.getElementById('profileSocial');
  if (!socialEl) return;

  var links = [
    { key: 'github', label: 'GitHub' },
    { key: 'portfolio', label: 'Portfolio' }
  ].filter(function(item) {
    return social && social[item.key];
  }).map(function(item) {
    var url = ensureAbsoluteUrl(social[item.key]);
    return '<a class="profile-social-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + item.label + '</a>';
  });

  socialEl.innerHTML = links.join('');
}

function buildProfileChecklist(profileData, strengthData, scoreMap) {
  var skills = Array.isArray(profileData.skills) ? profileData.skills : [];
  var experience = Array.isArray(profileData.experience) ? profileData.experience : [];
  var assessmentsCount = Object.keys(scoreMap).length ||
    ((strengthData && strengthData.breakdown && strengthData.breakdown.assessments) || 0);
  var social = profileData.social || {};

  return [
    {
      done: !!(profileData.name && profileData.name.trim() && profileData.bio && profileData.bio.trim().length > 20 && profileData.title && profileData.title !== 'Aspiring Data Professional' && profileData.location),
      title: 'Complete your professional summary',
      copy: 'Add a real headline, location, bio, and links so the platform has context about you.',
      actionLabel: 'Edit summary',
      action: 'profileEditBasics()'
    },
    {
      done: skills.length >= 3,
      title: 'Add at least 3 core skills',
      copy: 'These power role matching, verified readiness, and peer coaching recommendations.',
      actionLabel: 'Add skill',
      action: 'profileAddSkill()'
    },
    {
      done: experience.length >= 1,
      title: 'Add one project or experience entry',
      copy: 'A single internship, assistantship, or course project makes the profile feel much more credible.',
      actionLabel: 'Add experience',
      action: 'profileAddExperience()'
    },
    {
      done: assessmentsCount >= 1,
      title: 'Take your first verified assessment',
      copy: 'Assessments turn the profile from self-reported into something you can actually trust.',
      actionLabel: 'Start assessment',
      action: "navigateTo('assessment')"
    },
    {
      done: !!(social.github || social.portfolio),
      title: 'Attach at least one proof link',
      copy: 'A GitHub profile or portfolio gives recruiters and reviewers a proof trail.',
      actionLabel: 'Add links',
      action: 'profileEditBasics()'
    }
  ];
}

function renderProfileOnboarding(profileData, strengthData, scoreMap) {
  var host = document.getElementById('profileOnboarding');
  if (!host) return;

  var checklist = buildProfileChecklist(profileData, strengthData, scoreMap);
  var completed = checklist.filter(function(item) { return item.done; }).length;
  var pending = checklist.filter(function(item) { return !item.done; });
  var strength = strengthData && typeof strengthData.strength === 'number' ? strengthData.strength : 0;

  if (pending.length === 0) {
    host.innerHTML = '<div class="profile-onboarding profile-onboarding-ready">' +
      '<div class="profile-onboarding-header">' +
        '<div>' +
          '<div class="profile-onboarding-kicker">Profile Ready</div>' +
          '<h3>Everything important is in place.</h3>' +
          '<p>Your profile is ready for deeper role analysis, assessments, and peer coaching.</p>' +
        '</div>' +
        '<div class="profile-onboarding-meter">' +
          '<span>' + strength + '% strength</span>' +
          '<strong>5/5 complete</strong>' +
        '</div>' +
      '</div>' +
      '<div class="profile-onboarding-actions">' +
        '<button class="profile-primary-action" onclick="navigateTo(\'analyzer\')">Run role analysis</button>' +
        '<button class="profile-secondary-action" onclick="navigateTo(\'coaching\')">Explore peer coaching</button>' +
      '</div>' +
    '</div>';
    return;
  }

  host.innerHTML = '<div class="profile-onboarding">' +
    '<div class="profile-onboarding-header">' +
      '<div>' +
        '<div class="profile-onboarding-kicker">Quick Start</div>' +
        '<h3>Finish the few things that make this profile useful.</h3>' +
        '<p>' + pending.length + ' step' + (pending.length === 1 ? '' : 's') + ' left before your profile feels recruiter-ready and fully personalized.</p>' +
      '</div>' +
      '<div class="profile-onboarding-meter">' +
        '<span>' + strength + '% strength</span>' +
        '<strong>' + completed + '/5 complete</strong>' +
      '</div>' +
    '</div>' +
    '<div class="profile-checklist">' +
      checklist.map(function(item, index) {
        return '<div class="profile-check-item">' +
          '<div class="profile-check-icon ' + (item.done ? 'done' : 'pending') + '">' + (item.done ? '✓' : (index + 1)) + '</div>' +
          '<div class="profile-check-copywrap">' +
            '<div class="profile-check-title">' + escapeHtml(item.title) + '</div>' +
            '<div class="profile-check-copy">' + escapeHtml(item.copy) + '</div>' +
          '</div>' +
          (item.done
            ? '<span class="profile-check-status done">Done</span>'
            : '<button class="profile-check-action" onclick="' + item.action + '">' + escapeHtml(item.actionLabel) + '</button>') +
        '</div>';
      }).join('') +
    '</div>' +
  '</div>';
}

async function fetchProfileRecord() {
  if (!currentUser || !currentUser.email) {
    throw new Error('No active user');
  }

  if (profileState.data && profileState.data.userId === currentUser.email) {
    return profileState.data;
  }

  var response = await fetch('/api/profile?userId=' + encodeURIComponent(currentUser.email));
  var data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || 'Failed to load profile');
  }

  profileState.data = data;
  return data;
}

async function saveProfilePatch(profileFields) {
  if (!currentUser || !currentUser.email) {
    throw new Error('No active user');
  }

  var response = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ userId: currentUser.email }, profileFields))
  });
  var data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || 'Failed to save profile');
  }

  profileState.data = data;
  if (data.name || data.email || data.role) {
    updateCurrentUserSession({
      name: data.name || currentUser.name,
      email: data.email || currentUser.email,
      role: data.role || currentUser.role
    });
  }
  return data;
}

async function initProfile() {
  var email = currentUser ? currentUser.email : '';
  if (!email) return;

  var profileData = null;
  var strengthData = null;
  var skillsLabData = null;

  try {
    var results = await Promise.allSettled([
      fetch('/api/profile?userId=' + encodeURIComponent(email)).then(function(r) { return r.json(); }),
      fetch('/api/profile/strength?userId=' + encodeURIComponent(email)).then(function(r) { return r.json(); }),
      fetch('/api/skills-lab?userId=' + encodeURIComponent(email)).then(function(r) { return r.json(); })
    ]);

    if (results[0].status === 'fulfilled' && !results[0].value.error) profileData = results[0].value;
    if (results[1].status === 'fulfilled' && !results[1].value.error) strengthData = results[1].value;
    if (results[2].status === 'fulfilled' && !results[2].value.error) skillsLabData = results[2].value;
  } catch (err) {
    console.error('initProfile fetch error:', err);
  }

  profileData = profileData || {
    name: currentUser.name || '',
    email: email,
    title: 'Aspiring Data Professional',
    bio: '',
    location: '',
    skills: [],
    experience: [],
    education: [],
    documents: [],
    social: {}
  };

  profileState.data = profileData;
  profileState.strength = strengthData;
  profileState.skillsLab = skillsLabData;

  var scoreMap = buildProfileScoreMap(skillsLabData);

  if (profileData.name && profileData.name !== currentUser.name) {
    updateCurrentUserSession({ name: profileData.name });
  }

  var displayName = profileData.name || currentUser.name || 'Your Profile';
  var initials = displayName.split(/\s+/).filter(Boolean).map(function(part) { return part[0]; }).join('').toUpperCase().slice(0, 2) || 'SG';

  var nameEl = document.getElementById('profileName');
  if (nameEl) nameEl.textContent = displayName;

  var initialsEl = document.getElementById('profileInitials');
  if (initialsEl) initialsEl.textContent = initials;

  var emailEl = document.getElementById('profileEmail');
  if (emailEl) {
    var svgs = emailEl.querySelectorAll('svg');
    var svgHtml = svgs.length > 0 ? svgs[0].outerHTML : '';
    emailEl.innerHTML = svgHtml + ' ' + (profileData.email || currentUser.email || '');
  }

  var titleEl = document.getElementById('profileTitle');
  if (titleEl) titleEl.textContent = profileData.title || 'Aspiring Data Professional';

  var bioEl = document.getElementById('profileBio');
  if (bioEl) {
    bioEl.textContent = profileData.bio && profileData.bio.trim()
      ? profileData.bio
      : 'Use this space to tell people what you are building toward, what you are good at, and what kind of work you want next.';
  }

  var locationEl = document.getElementById('profileLocation');
  if (locationEl) {
    var locSvgs = locationEl.querySelectorAll('svg');
    var locSvgHtml = locSvgs.length > 0 ? locSvgs[0].outerHTML : '';
    locationEl.innerHTML = locSvgHtml + ' ' + (profileData.location || 'Add your location');
    locationEl.style.cursor = 'pointer';
    locationEl.title = 'Click to edit location';
    locationEl.onclick = function() { profileEditBasics(); };
  }

  renderProfileSocialLinks(profileData.social || {});

  if (strengthData) {
    var strength = strengthData.strength || strengthData.score || 0;
    var pctEl = document.getElementById('profileStrengthPct');
    if (pctEl) pctEl.textContent = strength + '%';

    var ring = document.getElementById('profileStrengthRing');
    if (ring) {
      var offset = 220 - (220 * strength / 100);
      ring.setAttribute('stroke-dashoffset', offset);
    }

    var hintEl = document.getElementById('profileStrengthHint');
    var tips = strengthData.tips || strengthData.suggestions || [];
    if (hintEl) {
      hintEl.textContent = tips.length > 0
        ? tips[0]
        : 'Your profile is in strong shape. Keep assessing and updating it as you improve.';
    }
  }

  var strengthSubEl = document.getElementById('profileStrengthSub');
  if (strengthSubEl) {
    var hasDocs = Array.isArray(profileData.documents) && profileData.documents.length > 0;
    strengthSubEl.textContent = hasDocs ? 'Resume Scanned' : 'No Resume Yet';
    strengthSubEl.style.color = hasDocs ? '' : '#94a3b8';
  }

  renderProfileOnboarding(profileData, strengthData, scoreMap);

  var skillChipsEl = document.getElementById('profileSkills');
  if (skillChipsEl) {
    var orderedSkills = []; // [{name, mastery, idx}]
    var seenSkills = {};
    var rawSkills = Array.isArray(profileData.skills) ? profileData.skills : [];

    rawSkills.forEach(function(skill, idx) {
      var name = typeof skill === 'string' ? skill : (skill && skill.name);
      var mastery = typeof skill === 'object' && skill ? (skill.mastery || null) : null;
      if (name && !seenSkills[name.toLowerCase()]) {
        seenSkills[name.toLowerCase()] = true;
        orderedSkills.push({ name: name, mastery: mastery, idx: idx });
      }
    });

    Object.keys(scoreMap).forEach(function(skillName) {
      if (!seenSkills[skillName.toLowerCase()]) {
        seenSkills[skillName.toLowerCase()] = true;
        orderedSkills.push({ name: skillName, mastery: null, idx: -1 });
      }
    });

    if (orderedSkills.length === 0) {
      skillChipsEl.innerHTML = getProfileEmptyState(
        'No skills on the profile yet',
        'Start with a few core skills so role fit, assessments, and coaching recommendations have something to work from.',
        'Add your first skill',
        'profileAddSkill()'
      );
    } else {
      skillChipsEl.innerHTML = orderedSkills.map(function(sk, i) {
        var scoreInfo = scoreMap[sk.name];
        var displayScore = scoreInfo ? scoreInfo.score : sk.mastery;
        var scoreHtml = displayScore ? ' <strong>' + displayScore + '/10</strong>' : '';
        var editBtn = sk.idx >= 0 ? '<span class="chip-ctrl" onclick="profileEditSkill(' + sk.idx + ')" title="Edit">✎</span>' : '';
        var delBtn = sk.idx >= 0 ? '<span class="chip-ctrl chip-del" onclick="profileDeleteSkill(' + sk.idx + ')" title="Remove">×</span>' : '';
        return '<span class="skill-chip">' + escapeHtml(sk.name) + scoreHtml + editBtn + delBtn + '</span>';
      }).join('') + '<span class="add-skill-btn" onclick="profileAddSkill()">+ Add Skill</span>';
    }
  }

  var assessmentsEl = document.getElementById('profileAssessments');
  if (assessmentsEl) {
    var assessmentRows = Object.keys(scoreMap).sort(function(a, b) {
      var dateA = new Date(scoreMap[a].date || 0).getTime();
      var dateB = new Date(scoreMap[b].date || 0).getTime();
      if (dateA !== dateB) return dateB - dateA;
      return (scoreMap[b].score || 0) - (scoreMap[a].score || 0);
    });

    if (assessmentRows.length === 0) {
      assessmentsEl.innerHTML = getProfileEmptyState(
        'No verified scores yet',
        'Take one assessment and this card will start showing evidence-backed skill scores and recency.',
        'Take assessment',
        "navigateTo('assessment')"
      );
    } else {
      assessmentsEl.innerHTML = '<div class="assessment-score-list">' + assessmentRows.map(function(skillName) {
        var score = scoreMap[skillName];
        var tone = score.score >= 8 ? 'is-strong' : score.score >= 5 ? 'is-mid' : 'is-gap';
        var metaParts = [];
        if (score.level) metaParts.push(score.level);
        if (score.date) metaParts.push(score.date);
        if (score.attempts) metaParts.push(score.attempts + ' attempt' + (score.attempts === 1 ? '' : 's'));

        return '<div class="assessment-score-row">' +
          '<div class="assessment-score-main">' +
            '<div class="assessment-score-skill">' + escapeHtml(skillName) + '</div>' +
            '<div class="assessment-score-meta">' + escapeHtml(metaParts.join(' • ')) + '</div>' +
          '</div>' +
          '<div class="assessment-score-pill ' + tone + '">' + score.score + '/10</div>' +
        '</div>';
      }).join('') + '</div>';
    }
  }

  var docsEl = document.getElementById('profileDocuments');
  if (docsEl) {
    var documents = Array.isArray(profileData.documents) ? profileData.documents : [];
    if (documents.length === 0) {
      docsEl.innerHTML = getProfileEmptyState(
        'No documents saved yet',
        'This section can hold resumes, certificates, and other proof of work once uploads are wired in.',
        '',
        ''
      );
    } else {
      docsEl.innerHTML = documents.map(function(doc) {
        var name = doc.name || 'Untitled';
        var icon = name.toLowerCase().endsWith('.pdf') ? '📄' : '📝';
        var url = doc.url || '';
        var viewBtn = url ? '<a class="doc-action-btn" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">View</a>' : '';
        var dlBtn = url ? '<a class="doc-action-btn doc-action-dl" href="' + escapeHtml(url) + '" download="' + escapeHtml(name) + '" target="_blank">⬇ Download</a>' : '';
        return '<div class="doc-item">' +
          '<div class="doc-icon">' + icon + '</div>' +
          '<div class="doc-info">' +
            '<div class="doc-name">' + escapeHtml(name) + '</div>' +
            '<div class="doc-meta">' + escapeHtml(doc.uploadedAt ? doc.uploadedAt.slice(0, 10) : 'Saved to your profile') + '</div>' +
          '</div>' +
          '<div class="doc-actions">' + viewBtn + dlBtn + '</div>' +
        '</div>';
      }).join('');
    }
  }

  var experienceEl = document.getElementById('profileExperience');
  if (experienceEl) {
    var experience = Array.isArray(profileData.experience) ? profileData.experience : [];
    if (experience.length === 0) {
      experienceEl.innerHTML = getProfileEmptyState(
        'No experience added yet',
        'Add one role, internship, assistantship, or class project to make the profile feel grounded.',
        'Add experience',
        'profileAddExperience()'
      );
    } else {
      experienceEl.innerHTML = experience.map(function(exp, idx) {
        var tagsHtml = '';
        if (Array.isArray(exp.tags) && exp.tags.length > 0) {
          tagsHtml = '<div class="exp-tags">' + exp.tags.map(function(tag) {
            return '<span class="exp-tag">' + escapeHtml(tag) + '</span>';
          }).join('') + '</div>';
        }
        return '<div class="exp-item">' +
          '<div class="exp-top">' +
            '<div class="exp-icon">💼</div>' +
            '<div style="flex:1">' +
              '<div class="exp-title">' + escapeHtml(exp.title || '') + '</div>' +
              '<div class="exp-company">' + escapeHtml(exp.company || '') + '</div>' +
              '<div class="exp-dates">' + escapeHtml(exp.dates || '') + '</div>' +
            '</div>' +
            '<div class="entry-actions">' +
              '<button class="entry-edit-btn" onclick="profileEditExperience(' + idx + ')" title="Edit">✎</button>' +
              '<button class="entry-del-btn" onclick="profileDeleteExperience(' + idx + ')" title="Delete">×</button>' +
            '</div>' +
          '</div>' +
          '<div class="exp-desc">' + escapeHtml(exp.description || '') + '</div>' +
          tagsHtml +
        '</div>';
      }).join('') + '<div style="margin-top:12px"><button class="btn btn-secondary" style="font-size:13px;padding:6px 14px" onclick="profileAddExperience()">+ Add Experience</button></div>';
    }
  }

  var educationEl = document.getElementById('profileEducation');
  if (educationEl) {
    var education = Array.isArray(profileData.education) ? profileData.education : [];
    if (education.length === 0) {
      educationEl.innerHTML = getProfileEmptyState(
        'No education details yet',
        'Education helps profile strength, but the essentials are skills, experience, and assessments.',
        'Run analyzer',
        "navigateTo('analyzer')"
      );
    } else {
      educationEl.innerHTML = education.map(function(edu, idx) {
        var coursesHtml = edu.courses ? '<div class="edu-courses"><strong>Relevant Coursework: </strong>' + escapeHtml(edu.courses) + '</div>' : '';
        var gpaHtml = edu.gpa ? ' <span class="gpa-badge">GPA: ' + escapeHtml(edu.gpa) + '</span>' : '';
        return '<div class="edu-item">' +
          '<div class="edu-icon">🎓</div>' +
          '<div style="flex:1">' +
            '<div class="edu-school">' + escapeHtml(edu.school || '') + '</div>' +
            '<div class="edu-degree">' + escapeHtml(edu.degree || '') + '</div>' +
            '<div class="edu-dates">' + escapeHtml(edu.dates || '') + gpaHtml + '</div>' +
            coursesHtml +
          '</div>' +
          '<div class="entry-actions">' +
            '<button class="entry-edit-btn" onclick="profileEditEducation(' + idx + ')" title="Edit">✎</button>' +
            '<button class="entry-del-btn" onclick="profileDeleteEducation(' + idx + ')" title="Delete">×</button>' +
          '</div>' +
        '</div>';
      }).join('') + '<div style="margin-top:12px"><button class="btn btn-secondary" style="font-size:13px;padding:6px 14px" onclick="profileAddEducation()">+ Add Education</button></div>';
    }
  }

  var reportsEl = document.getElementById('profileAnalyzerReports');
  if (reportsEl) {
    var reports = Array.isArray(profileData.analyzerReports) ? profileData.analyzerReports : [];
    if (reports.length === 0) {
      reportsEl.innerHTML = '<p style="color:#94a3b8;font-size:13px;">No saved reports yet. Run the Analyzer and click <strong>Save to Profile</strong> to keep a copy here.</p>';
    } else {
      reportsEl.innerHTML = reports.map(function(rep) {
        var date = rep.date ? new Date(rep.date).toLocaleDateString() : '';
        var match = (rep.matchScore || 0) + '%';
        var matchColor = rep.matchScore >= 70 ? '#16a34a' : rep.matchScore >= 40 ? '#f59e0b' : '#ef4444';
        var jfHtml = '';
        if (rep.jobFit && typeof rep.jobFit.likelihood === 'number') {
          var jfColor = rep.jobFit.likelihood >= 70 ? '#16a34a' : rep.jobFit.likelihood >= 40 ? '#f59e0b' : '#ef4444';
          jfHtml = '<span style="font-size:11px;color:' + jfColor + ';font-weight:600;margin-left:8px;">🎯 ' + rep.jobFit.likelihood + '% job fit</span>';
        }
        var topGaps = (rep.missingSkills || []).slice(0, 3).map(function(s) {
          return '<span class="skill-tag missing" style="font-size:10px;margin:2px;">' + escapeHtml(s.name || '') + '</span>';
        }).join('');
        return '<div class="report-item" style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-weight:600;font-size:14px;">' + escapeHtml(rep.role || 'Untitled role') + '</div>' +
              '<div style="font-size:11px;color:#64748b;margin-top:2px;">' + escapeHtml(rep.region || '') + (rep.region ? ' • ' : '') + escapeHtml(date) + jfHtml + '</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
              '<div style="font-size:18px;font-weight:700;color:' + matchColor + ';">' + match + '</div>' +
              '<div style="font-size:10px;color:#64748b;text-transform:uppercase;">match</div>' +
            '</div>' +
          '</div>' +
          (topGaps ? '<div style="margin-top:8px;">' + topGaps + '</div>' : '') +
          '<div style="display:flex;gap:6px;margin-top:10px;">' +
            '<button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;" onclick="viewSavedReport(\'' + rep.id + '\')">View</button>' +
            '<button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;color:#dc2626;" onclick="deleteSavedReport(\'' + rep.id + '\')">Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }

  var strengthBtn = document.querySelector('#page-profile .strength-btn');
  if (strengthBtn) {
    strengthBtn.onclick = function() { navigateTo('assessment'); };
  }
}

async function profileEditBasics() {
  try {
    var profileData = await fetchProfileRecord();
    var social = profileData.social || {};
    openProfileFormModal({
      title: 'Edit Profile',
      fields: [
        { label: 'Full Name', id: 'name', value: profileData.name || currentUser.name || '', placeholder: 'Your full name' },
        { label: 'Headline', id: 'title', value: profileData.title || '', placeholder: 'e.g., Data Scientist | ML Researcher' },
        { label: 'Location', id: 'location', value: profileData.location || '', placeholder: 'e.g., Boston, MA' },
        { type: 'textarea', label: 'Bio', id: 'bio', value: profileData.bio || '', placeholder: 'A short professional summary...' },
        { label: 'GitHub URL', id: 'github', value: social.github || '', placeholder: 'https://github.com/username' },
        { label: 'Portfolio URL', id: 'portfolio', value: social.portfolio || '', placeholder: 'https://yoursite.com' }
      ],
      onSave: async function(v) {
        await saveProfilePatch({
          name: v.name.trim() || currentUser.name || '',
          title: v.title.trim() || 'Aspiring Data Professional',
          location: v.location.trim(),
          bio: v.bio.trim(),
          social: { github: v.github.trim(), portfolio: v.portfolio.trim() }
        });
        initProfile();
      }
    });
  } catch (err) {
    console.error('profileEditBasics error:', err);
    alert('Failed to load profile. Please try again.');
  }
}

function profileExplainDocumentUploads() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.docx,.doc';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', function() {
    var file = input.files[0];
    document.body.removeChild(input);
    if (file) uploadResumeFile(file);
  });
  input.click();
}

async function uploadResumeFile(file) {
  var user = getActiveUser() || {};
  if (!user.email) { alert('Please sign in first.'); return; }
  var uploadLink = document.querySelector('#page-profile .card-link[onclick="profileExplainDocumentUploads()"]');
  if (uploadLink) { uploadLink.textContent = 'Uploading...'; uploadLink.style.pointerEvents = 'none'; }
  try {
    var formData = new FormData();
    formData.append('resume', file);
    var token = localStorage.getItem('sgaAuthToken') || '';
    var resp = await fetch('/api/profile/upload-resume', {
      method: 'POST',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      body: formData
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Upload failed');
    profileState.data = null; // force fresh fetch after upload
    var edu = data.extractedEducation || [];
    var exp = data.extractedExperience || [];
    var skills = data.extractedSkills || [];
    // Refresh profile UI BEFORE opening the preview modal so the strength card
    // flips to "Resume Scanned" no matter how the user closes the preview.
    initProfile();
    if (data.storageWarning) {
      showAppToast(data.storageWarning, 'warn');
    } else {
      showAppToast('Resume uploaded.', 'success');
    }
    if (edu.length > 0 || exp.length > 0 || skills.length > 0) {
      showResumeExtractedPreview(edu, exp, skills, data.storageWarning);
    }
  } catch (err) {
    console.error('Resume upload error:', err);
    alert('Upload failed: ' + err.message);
  } finally {
    if (uploadLink) { uploadLink.textContent = '+ Upload'; uploadLink.style.pointerEvents = ''; }
  }
}

function showResumeExtractedPreview(education, experience, skills, storageWarning) {
  var html = '<p style="color:#64748b;font-size:13px;margin:0 0 16px;">The following was extracted from your resume and <strong>saved to your profile</strong>. You can edit any entry manually.</p>';
  if (storageWarning) {
    html += '<div style="margin:0 0 16px;padding:10px 12px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;color:#92400e;font-size:12px;">' +
      '<strong>Heads up:</strong> ' + escapeHtml(storageWarning) +
    '</div>';
  }

  if (education.length > 0) {
    html += '<div class="edu-preview-section-title">Education (' + education.length + ')</div>';
    html += education.map(function(edu) {
      return '<div class="edu-preview-card">' +
        '<div class="edu-preview-school">' + escapeHtml(edu.school || '') + '</div>' +
        '<div class="edu-preview-degree">' + escapeHtml(edu.degree || '') + (edu.dates ? ' <span class="edu-preview-dates">• ' + escapeHtml(edu.dates) + '</span>' : '') + '</div>' +
        (edu.gpa ? '<div class="edu-preview-meta">GPA: ' + escapeHtml(edu.gpa) + '</div>' : '') +
        (edu.courses ? '<div class="edu-preview-meta">' + escapeHtml(edu.courses) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  if (experience.length > 0) {
    html += '<div class="edu-preview-section-title" style="margin-top:16px;">Experience (' + experience.length + ')</div>';
    html += experience.map(function(exp) {
      return '<div class="edu-preview-card">' +
        '<div class="edu-preview-school">' + escapeHtml(exp.title || '') + ' — ' + escapeHtml(exp.company || '') + '</div>' +
        (exp.dates ? '<div class="edu-preview-degree"><span class="edu-preview-dates">' + escapeHtml(exp.dates) + '</span></div>' : '') +
        (exp.description ? '<div class="edu-preview-meta">' + escapeHtml(exp.description.slice(0, 120)) + (exp.description.length > 120 ? '…' : '') + '</div>' : '') +
      '</div>';
    }).join('');
  }

  if (skills && skills.length > 0) {
    html += '<div class="edu-preview-section-title" style="margin-top:16px;">Skills (' + skills.length + ')</div>';
    html += '<div class="edu-preview-card"><div style="display:flex;flex-wrap:wrap;gap:6px">' +
      skills.map(function(s) { return '<span class="skill-chip" style="font-size:12px;padding:3px 10px">' + escapeHtml(typeof s === 'string' ? s : s.name) + '</span>'; }).join('') +
    '</div></div>';
  }

  openProfileFormModal({
    title: 'Resume Scanned',
    fields: [],
    onSave: async function() { initProfile(); }
  });
  document.getElementById('profileFormBody').innerHTML = html;
  document.getElementById('profileFormSave').textContent = 'Got it!';
}

// ── Analyzer: Rich Resume Preview ──
function renderResumePreview(data) {
  var container = document.getElementById('azResumePreview');
  if (!container) return;
  if (!data || (!data.name && !(data.education && data.education.length) && !(data.experience && data.experience.length))) {
    container.style.display = 'none';
    return;
  }

  var html = '<div class="card" style="margin-top:0;">';
  html += '<div style="font-size:13px;font-weight:600;color:#4f46e5;margin-bottom:10px;">📋 Resume Preview</div>';

  if (data.name) {
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="font-size:16px;font-weight:700;color:#1e293b;">' + escapeHtml(data.name) + '</div>';
    var contacts = [];
    if (data.email) contacts.push(escapeHtml(data.email));
    if (data.phone) contacts.push(escapeHtml(data.phone));
    if (data.linkedin) {
      var liHref = data.linkedin.startsWith('http') ? data.linkedin : 'https://' + data.linkedin;
      contacts.push('<a href="' + escapeHtml(liHref) + '" target="_blank" rel="noopener" style="color:#4f46e5;text-decoration:none;">' + escapeHtml(data.linkedin) + '</a>');
    }
    if (data.github) {
      var ghHref = data.github.startsWith('http') ? data.github : 'https://' + data.github;
      contacts.push('<a href="' + escapeHtml(ghHref) + '" target="_blank" rel="noopener" style="color:#4f46e5;text-decoration:none;">' + escapeHtml(data.github) + '</a>');
    }
    if (contacts.length > 0) {
      html += '<div style="font-size:12px;color:#64748b;margin-top:3px;">' + contacts.join(' &bull; ') + '</div>';
    }
    html += '</div>';
  }

  if (data.summary) {
    html += '<p style="font-size:13px;color:#334155;line-height:1.6;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #f1f5f9;">' + escapeHtml(data.summary) + '</p>';
  }

  if (data.skills && data.skills.length > 0) {
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Skills</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
    var skillsToShow = data.skills.slice(0, 20);
    skillsToShow.forEach(function(s) {
      html += '<span class="skill-chip" style="font-size:11px;padding:2px 8px;">' + escapeHtml(typeof s === 'string' ? s : (s.name || '')) + '</span>';
    });
    if (data.skills.length > 20) html += '<span style="font-size:11px;color:#94a3b8;align-self:center;">+' + (data.skills.length - 20) + ' more</span>';
    html += '</div></div>';
  }

  if (data.experience && data.experience.length > 0) {
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Experience</div>';
    data.experience.forEach(function(exp) {
      html += '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #f8fafc;">';
      html += '<div style="font-size:13px;font-weight:600;color:#1e293b;">' + escapeHtml(exp.title || '') + (exp.company ? ' &mdash; ' + escapeHtml(exp.company) : '') + '</div>';
      if (exp.dates) html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + escapeHtml(exp.dates) + '</div>';
      if (exp.description) html += '<div style="font-size:12px;color:#475569;margin-top:4px;line-height:1.5;">' + escapeHtml(exp.description.slice(0, 150)) + (exp.description.length > 150 ? '…' : '') + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  if (data.education && data.education.length > 0) {
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Education</div>';
    data.education.forEach(function(edu) {
      html += '<div style="margin-bottom:6px;">';
      html += '<div style="font-size:13px;font-weight:600;color:#1e293b;">' + escapeHtml(edu.school || '') + '</div>';
      html += '<div style="font-size:12px;color:#475569;">' + escapeHtml(edu.degree || '') + (edu.dates ? ' &middot; ' + escapeHtml(edu.dates) : '') + (edu.gpa ? ' &middot; GPA ' + escapeHtml(edu.gpa) : '') + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  if (data.certifications && data.certifications.length > 0) {
    html += '<div style="margin-bottom:6px;">';
    html += '<div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Certifications</div>';
    data.certifications.forEach(function(cert) {
      html += '<div style="font-size:12px;color:#475569;margin-bottom:2px;">&bull; ' + escapeHtml(typeof cert === 'string' ? cert : (cert.name || '')) + '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
  container.style.display = 'block';
}

// ── Analyzer: Sync Resume Data to Profile ──
async function syncAnalyzerResumeToProfile(options) {
  options = options || {};
  var data = options.data || analyzerState.resumeData;
  if (!data) return;

  var user = getActiveUser();
  var statusEl = document.getElementById('azImportStatus');
  if (!user || !user.email) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.innerHTML = '<span style="font-size:12px;color:#64748b;">Sign in to sync this resume to your profile.</span>';
    }
    return;
  }

  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.innerHTML = '<span style="font-size:12px;color:#64748b;">&#9203; Syncing to profile&hellip;</span>';
  }

  try {
    var baseResp = await fetch('/api/profile?userId=' + encodeURIComponent(user.email));
    var baseProfile = baseResp.ok ? await baseResp.json() : {};
    if (baseProfile.error) baseProfile = {};

    var patch = { userId: user.email };

    if (data.name && isMeaningfulProfileText(data.name) && !isMeaningfulProfileText(baseProfile.name)) {
      patch.name = data.name;
    }

    if (data.skills && data.skills.length > 0) {
      patch.skills = mergeProfileSkills(baseProfile.skills || [], data.skills);
    }

    if (data.education && data.education.length > 0) {
      patch.education = mergeProfileEducation(baseProfile.education || [], data.education);
    }

    if (data.experience && data.experience.length > 0) {
      patch.experience = mergeProfileExperience(baseProfile.experience || [], data.experience);
    }

    if (data.linkedin || data.github) {
      patch.social = buildResumeSocialPatch(data, baseProfile.social || {});
    }

    if (Object.keys(patch).length <= 1) {
      if (statusEl) {
        statusEl.innerHTML = '<span style="font-size:12px;color:#64748b;">Profile already up to date.</span>';
        setTimeout(function() { statusEl.style.display = 'none'; }, 3000);
      }
      return;
    }

    var resp = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (!resp.ok) throw new Error('Profile update failed');

    profileState.data = null;

    if (statusEl) {
      statusEl.innerHTML =
        '<span style="font-size:12px;color:#16a34a;">&#10003; Resume data synced to your profile.</span> ' +
        '<a href="#" onclick="navigateTo(\'profile\');return false;" style="font-size:12px;color:#4f46e5;text-decoration:none;">View Profile &rarr;</a>';
    }
  } catch (err) {
    console.error('syncAnalyzerResumeToProfile error:', err);
    if (statusEl) {
      statusEl.innerHTML = '<span style="font-size:12px;color:#ef4444;">Could not sync to profile automatically. Visit your Profile page to import manually.</span>';
    }
  }
}

function importResumeToProfile() {
  syncAnalyzerResumeToProfile({ auto: false, data: analyzerState.resumeData });
}

// ── Profile Form Modal ──
var profileFormCallback = null;

function openProfileFormModal(config) {
  document.getElementById('profileFormTitle').textContent = config.title || 'Edit';
  document.getElementById('profileFormBody').innerHTML = config.fields.map(function(f) {
    var id = 'pfField_' + f.id;
    var ph = escapeHtml(f.placeholder || '');
    if (f.type === 'textarea') {
      return '<div class="profile-form-group">' +
        '<label class="profile-form-label">' + escapeHtml(f.label) + '</label>' +
        '<textarea class="profile-form-input profile-form-textarea" id="' + id + '" placeholder="' + ph + '">' + escapeHtml(f.value || '') + '</textarea>' +
        '</div>';
    }
    return '<div class="profile-form-group">' +
      '<label class="profile-form-label">' + escapeHtml(f.label) + '</label>' +
      '<input class="profile-form-input" type="text" id="' + id + '" placeholder="' + ph + '" value="' + escapeHtml(f.value || '') + '">' +
      '</div>';
  }).join('');
  profileFormCallback = config.onSave;
  var modal = document.getElementById('profileFormModal');
  modal.style.display = 'flex';
  var firstInput = modal.querySelector('input, textarea');
  if (firstInput) setTimeout(function() { firstInput.focus(); }, 50);
}

function closeProfileFormModal(e) {
  if (e && e.target !== document.getElementById('profileFormModal')) return;
  document.getElementById('profileFormModal').style.display = 'none';
  profileFormCallback = null;
}

async function submitProfileForm() {
  if (!profileFormCallback) return;
  var values = {};
  document.querySelectorAll('#profileFormBody input, #profileFormBody textarea').forEach(function(el) {
    values[el.id.replace('pfField_', '')] = el.value;
  });
  var saveBtn = document.getElementById('profileFormSave');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  try {
    await profileFormCallback(values);
    document.getElementById('profileFormModal').style.display = 'none';
    profileFormCallback = null;
  } catch (err) {
    console.error('Profile form save error:', err);
    alert('Failed to save. Please try again.');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}

// ── Profile: Add Skill ──
function profileAddSkill() {
  openProfileFormModal({
    title: 'Add Skill',
    fields: [
      { label: 'Skill Name', id: 'skill', value: '', placeholder: 'e.g., Python, Machine Learning, SQL' },
      { label: 'Mastery (1–10)', id: 'mastery', value: '', placeholder: 'e.g., 7  — leave blank if unsure' }
    ],
    onSave: async function(v) {
      var newSkill = (v.skill || '').trim();
      if (!newSkill) return;
      var masteryVal = parseInt(v.mastery, 10);
      if (v.mastery.trim() && (isNaN(masteryVal) || masteryVal < 1 || masteryVal > 10)) {
        throw new Error('Mastery must be a number between 1 and 10');
      }
      var profileData = await fetchProfileRecord();
      var skills = Array.isArray(profileData.skills) ? profileData.skills.slice() : [];
      var exists = skills.some(function(s) {
        var n = typeof s === 'string' ? s : (s && s.name);
        return n && n.toLowerCase() === newSkill.toLowerCase();
      });
      if (exists) { alert('That skill is already on your profile.'); return; }
      skills.push({ name: newSkill, mastery: v.mastery.trim() ? masteryVal : null });
      await saveProfilePatch({ skills: skills });
      initProfile();
    }
  });
}

// ── Profile: Edit Skill ──
async function profileEditSkill(idx) {
  var profileData = await fetchProfileRecord();
  var skills = Array.isArray(profileData.skills) ? profileData.skills.slice() : [];
  var skill = skills[idx];
  if (!skill) return;
  var currentName = typeof skill === 'string' ? skill : (skill.name || '');
  var currentMastery = typeof skill === 'object' && skill ? (skill.mastery || '') : '';
  openProfileFormModal({
    title: 'Edit Skill',
    fields: [
      { label: 'Skill Name', id: 'skill', value: currentName, placeholder: 'e.g., Python' },
      { label: 'Mastery (1–10)', id: 'mastery', value: currentMastery ? String(currentMastery) : '', placeholder: 'e.g., 7' }
    ],
    onSave: async function(v) {
      var newName = (v.skill || '').trim();
      if (!newName) return;
      var masteryVal = parseInt(v.mastery, 10);
      if (v.mastery.trim() && (isNaN(masteryVal) || masteryVal < 1 || masteryVal > 10)) {
        throw new Error('Mastery must be a number between 1 and 10');
      }
      var fresh = await fetchProfileRecord();
      var freshSkills = Array.isArray(fresh.skills) ? fresh.skills.slice() : [];
      freshSkills[idx] = { name: newName, mastery: v.mastery.trim() ? masteryVal : null };
      await saveProfilePatch({ skills: freshSkills });
      initProfile();
    }
  });
}

// ── Profile: Delete Skill ──
async function profileDeleteSkill(idx) {
  if (!await showAppConfirm('Remove this skill from your profile?', { title: 'Remove skill', okLabel: 'Remove', danger: true })) return;
  var profileData = await fetchProfileRecord();
  var skills = Array.isArray(profileData.skills) ? profileData.skills.slice() : [];
  skills.splice(idx, 1);
  await saveProfilePatch({ skills: skills });
  initProfile();
}

// ── Resume Import Helpers ──
function normalizeImportedSkill(skill) {
  if (typeof skill === 'string') return { name: skill.trim(), mastery: null };
  if (skill && typeof skill === 'object') return { name: (skill.name || '').trim(), mastery: skill.mastery || null };
  return null;
}

function isMeaningfulProfileText(value) {
  if (!value || typeof value !== 'string') return false;
  var v = value.trim().toLowerCase();
  if (v.length < 2) return false;
  var defaults = ['your name', 'add your', 'aspiring data professional', 'career intelligence', 'skillgap'];
  return !defaults.some(function(d) { return v.includes(d); });
}

function isDefaultProfileTitle(value) {
  if (!value || typeof value !== 'string') return true;
  var v = value.trim().toLowerCase();
  return !v || v === 'aspiring data professional' || v.startsWith('aspiring');
}

function mergeProfileSkills(existingSkills, incomingSkills) {
  var result = Array.isArray(existingSkills) ? existingSkills.slice() : [];
  var seen = {};
  result.forEach(function(s) {
    var name = typeof s === 'string' ? s : (s && s.name || '');
    if (name) seen[name.toLowerCase()] = true;
  });
  (incomingSkills || []).forEach(function(raw) {
    var sk = normalizeImportedSkill(raw);
    if (!sk || !sk.name) return;
    var key = sk.name.toLowerCase();
    if (!seen[key]) { seen[key] = true; result.push(sk); }
  });
  return result;
}

function mergeProfileExperience(existingExperience, incomingExperience) {
  var result = Array.isArray(existingExperience) ? existingExperience.slice() : [];
  (incomingExperience || []).forEach(function(exp) {
    var exists = result.some(function(e) { return e.title === exp.title && e.company === exp.company; });
    if (!exists) {
      result.push({
        title: exp.title || '',
        company: exp.company || '',
        dates: exp.dates || '',
        description: exp.description || '',
        tags: typeof exp.tags === 'string'
          ? exp.tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean)
          : (Array.isArray(exp.tags) ? exp.tags : [])
      });
    }
  });
  return result;
}

function mergeProfileEducation(existingEducation, incomingEducation) {
  var result = Array.isArray(existingEducation) ? existingEducation.slice() : [];
  (incomingEducation || []).forEach(function(edu) {
    var exists = result.some(function(e) { return e.school === edu.school && e.degree === edu.degree; });
    if (!exists) {
      result.push({ school: edu.school || '', degree: edu.degree || '', dates: edu.dates || '', gpa: edu.gpa || '', courses: edu.courses || '' });
    }
  });
  return result;
}

function buildResumeSocialPatch(data, existingSocial) {
  var social = Object.assign({ linkedin: '', github: '', portfolio: '' }, existingSocial || {});
  if (data.linkedin && !social.linkedin) social.linkedin = data.linkedin;
  if (data.github && !social.github) social.github = data.github;
  return social;
}

// ── Profile: Add Experience ──
// Merge a list of tag names into the skills array (case-insensitive dedup).
// Returns the new skills array.
function mergeTagsIntoSkills(existingSkills, tags) {
  var skills = Array.isArray(existingSkills) ? existingSkills.slice() : [];
  var existingNames = new Set(skills.map(function(s) {
    return (typeof s === 'string' ? s : (s && s.name) || '').toLowerCase();
  }));
  (tags || []).forEach(function(tag) {
    var name = (tag || '').trim();
    if (!name) return;
    if (!existingNames.has(name.toLowerCase())) {
      existingNames.add(name.toLowerCase());
      skills.push({ name: name, mastery: null });
    }
  });
  return skills;
}

function profileAddExperience() {
  openProfileFormModal({
    title: 'Add Experience',
    fields: [
      { label: 'Job Title', id: 'title', value: '', placeholder: 'e.g., Data Science Intern' },
      { label: 'Company / Organization', id: 'company', value: '', placeholder: 'e.g., Acme Corp' },
      { label: 'Dates', id: 'dates', value: '', placeholder: 'e.g., Jun 2024 — Dec 2024' },
      { type: 'textarea', label: 'Description', id: 'description', value: '', placeholder: 'What did you build or achieve?' },
      { label: 'Tags / Skills (comma-separated)', id: 'tags', value: '', placeholder: 'Python, SQL, Tableau — auto-added to your Skills' }
    ],
    onSave: async function(v) {
      if (!v.title.trim() || !v.company.trim()) throw new Error('Title and company are required');
      var profileData = await fetchProfileRecord();
      var experience = Array.isArray(profileData.experience) ? profileData.experience.slice() : [];
      var tags = v.tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      experience.push({
        title: v.title.trim(),
        company: v.company.trim(),
        dates: v.dates.trim(),
        description: v.description.trim(),
        tags: tags
      });
      var skills = mergeTagsIntoSkills(profileData.skills, tags);
      await saveProfilePatch({ experience: experience, skills: skills });
      initProfile();
    }
  });
}

// ── Profile: Add Education ──
function profileAddEducation() {
  openProfileFormModal({
    title: 'Add Education',
    fields: [
      { label: 'School / University', id: 'school', value: '', placeholder: 'e.g., MIT' },
      { label: 'Degree & Field of Study', id: 'degree', value: '', placeholder: 'e.g., M.S. in Computer Science' },
      { label: 'Dates', id: 'dates', value: '', placeholder: 'e.g., 2022 — 2024' },
      { label: 'GPA (optional)', id: 'gpa', value: '', placeholder: 'e.g., 3.8/4.0' },
      { label: 'Relevant Courses (optional)', id: 'courses', value: '', placeholder: 'e.g., ML, Statistics, Databases' }
    ],
    onSave: async function(v) {
      if (!v.school.trim() || !v.degree.trim()) throw new Error('School and degree are required');
      var profileData = await fetchProfileRecord();
      var education = Array.isArray(profileData.education) ? profileData.education.slice() : [];
      education.push({
        school: v.school.trim(),
        degree: v.degree.trim(),
        dates: v.dates.trim(),
        gpa: v.gpa.trim(),
        courses: v.courses.trim()
      });
      await saveProfilePatch({ education: education });
      initProfile();
    }
  });
}

// ── Profile: Edit/Delete Experience ──
async function profileEditExperience(idx) {
  var profileData = await fetchProfileRecord();
  var experience = Array.isArray(profileData.experience) ? profileData.experience.slice() : [];
  var exp = experience[idx];
  if (!exp) return;
  openProfileFormModal({
    title: 'Edit Experience',
    fields: [
      { label: 'Job Title', id: 'title', value: exp.title || '', placeholder: 'e.g., Data Science Intern' },
      { label: 'Company / Organization', id: 'company', value: exp.company || '', placeholder: 'e.g., Acme Corp' },
      { label: 'Dates', id: 'dates', value: exp.dates || '', placeholder: 'e.g., Jun 2024 — Dec 2024' },
      { type: 'textarea', label: 'Description', id: 'description', value: exp.description || '', placeholder: 'What did you build or achieve?' },
      { label: 'Tags / Skills (comma-separated)', id: 'tags', value: Array.isArray(exp.tags) ? exp.tags.join(', ') : (exp.tags || ''), placeholder: 'Python, SQL, Tableau — auto-added to your Skills' }
    ],
    onSave: async function(v) {
      if (!v.title.trim() || !v.company.trim()) throw new Error('Title and company are required');
      var fresh = await fetchProfileRecord();
      var freshExp = Array.isArray(fresh.experience) ? fresh.experience.slice() : [];
      var tags = v.tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      freshExp[idx] = {
        title: v.title.trim(), company: v.company.trim(), dates: v.dates.trim(),
        description: v.description.trim(),
        tags: tags
      };
      var skills = mergeTagsIntoSkills(fresh.skills, tags);
      await saveProfilePatch({ experience: freshExp, skills: skills });
      initProfile();
    }
  });
}

async function profileDeleteExperience(idx) {
  if (!await showAppConfirm('Remove this experience entry?', { title: 'Remove experience', okLabel: 'Remove', danger: true })) return;
  var profileData = await fetchProfileRecord();
  var experience = Array.isArray(profileData.experience) ? profileData.experience.slice() : [];
  experience.splice(idx, 1);
  await saveProfilePatch({ experience: experience });
  initProfile();
}

// ── Profile: Edit/Delete Education ──
async function profileEditEducation(idx) {
  var profileData = await fetchProfileRecord();
  var education = Array.isArray(profileData.education) ? profileData.education.slice() : [];
  var edu = education[idx];
  if (!edu) return;
  openProfileFormModal({
    title: 'Edit Education',
    fields: [
      { label: 'School / University', id: 'school', value: edu.school || '', placeholder: 'e.g., MIT' },
      { label: 'Degree & Field of Study', id: 'degree', value: edu.degree || '', placeholder: 'e.g., M.S. in Computer Science' },
      { label: 'Dates', id: 'dates', value: edu.dates || '', placeholder: 'e.g., 2022 — 2024' },
      { label: 'GPA (optional)', id: 'gpa', value: edu.gpa || '', placeholder: 'e.g., 3.8/4.0' },
      { label: 'Relevant Courses (optional)', id: 'courses', value: edu.courses || '', placeholder: 'e.g., ML, Statistics, Databases' }
    ],
    onSave: async function(v) {
      if (!v.school.trim() || !v.degree.trim()) throw new Error('School and degree are required');
      var fresh = await fetchProfileRecord();
      var freshEdu = Array.isArray(fresh.education) ? fresh.education.slice() : [];
      freshEdu[idx] = { school: v.school.trim(), degree: v.degree.trim(), dates: v.dates.trim(), gpa: v.gpa.trim(), courses: v.courses.trim() };
      await saveProfilePatch({ education: freshEdu });
      initProfile();
    }
  });
}

async function profileDeleteEducation(idx) {
  if (!await showAppConfirm('Remove this education entry?', { title: 'Remove education', okLabel: 'Remove', danger: true })) return;
  var profileData = await fetchProfileRecord();
  var education = Array.isArray(profileData.education) ? profileData.education.slice() : [];
  education.splice(idx, 1);
  await saveProfilePatch({ education: education });
  initProfile();
}

// ── Init Everything ──
document.addEventListener('DOMContentLoaded', function() {
  initUser();
  initSkillMatrix();
  initUserSkills();
  initTrending();
  initJobCardsFromAPI(); // Dynamic job cards from API (with fallback)
  initMilestone();
  initRecentBenchmarks();
  loadNewsArticles(); // Load live news
  initSkillsLabMatrix();
  wireSkillsLabAssessmentButton();

  // Setup sidebar nav clicks
  document.querySelectorAll('.nav-item[data-page]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      navigateTo(this.getAttribute('data-page'));
      closeMobileSidebar();
    });
  });

  // Topbar global search
  var topbarSearch = document.getElementById('topbarSearch');
  if (topbarSearch) {
    topbarSearch.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && this.value.trim()) {
        var term = this.value.trim();
        navigateTo('jobs');
        setTimeout(function() {
          var jobInput = document.getElementById('jobSearchInput');
          if (jobInput) { jobInput.value = term; searchJobs(1); }
        }, 100);
        topbarSearch.value = '';
      }
    });
  }

  // Restore last visited page, default to home
  var validPages = ['home','jobs','profile','assessment','roadmap','coaching','analyzer'];
  var lastPage = localStorage.getItem('sgaLastPage');
  navigateTo(validPages.indexOf(lastPage) !== -1 ? lastPage : 'home');

  // Load notifications and auto-refresh every 30s
  loadNotifications();
  setInterval(loadNotifications, 30000);

  // Close notif panel when clicking outside
  document.addEventListener('click', function(e) {
    var panel = document.getElementById('notifPanel');
    var btn = document.getElementById('notifBtn');
    if (panel && panel.style.display !== 'none' && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
      panel.style.display = 'none';
    }
  });
});

// ══════════════════════════════════════
// ── Notifications
// ══════════════════════════════════════

var _notifPanelOpen = false;

function toggleNotifPanel() {
  var panel = document.getElementById('notifPanel');
  if (!panel) return;
  _notifPanelOpen = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = _notifPanelOpen ? 'block' : 'none';
  if (_notifPanelOpen) loadNotifications();
}

function loadNotifications() {
  var user = getActiveUser() || {};
  if (!user.email) return;
  var token = localStorage.getItem('sgaAuthToken') || '';
  var authHeaders = token ? { 'Authorization': 'Bearer ' + token } : {};

  Promise.all([
    fetch('/api/peer-coaching/bookings?userId=' + encodeURIComponent(user.email)).then(function(r) { return r.json(); }),
    fetch('/api/chat/recent', { headers: authHeaders }).then(function(r) { return r.json(); }).catch(function() { return { items: [] }; })
  ]).then(function(results) {
    var bookingsData = results[0];
    var chatData = results[1];
    var bookings = (bookingsData && bookingsData.bookings) ? bookingsData.bookings : [];
    var chatItems = (chatData && chatData.items) ? chatData.items : [];
    var seen = getSeenNotifs();
    var chatLastRead = JSON.parse(localStorage.getItem('sgaChatLastRead') || '{}');
    var myId = (user.email || '').toLowerCase().trim();
    var items = [];

    bookings.forEach(function(b) {
      var notifId, iconClass, emoji, title, sub, action, ts;
      ts = b.updatedAt || b.createdAt || '';
      var timeStr = ts ? timeAgo(ts) : '';

      if (b.role === 'coach' && b.status === 'pending') {
        notifId = 'booking-pending-' + b.id;
        iconClass = 'booking'; emoji = '📅';
        title = 'New session request';
        sub = (b.learnerName || 'A student') + ' wants a ' + b.duration + 'min ' + escHtml(b.skill) + ' session';
        action = function() { navigateTo('coaching'); switchPCTab('sessions'); };
      } else if (b.role === 'learner' && b.status === 'confirmed') {
        notifId = 'booking-confirmed-' + b.id;
        iconClass = 'accepted'; emoji = '✅';
        title = 'Session confirmed!';
        sub = (b.coachName || 'Your coach') + ' accepted your ' + escHtml(b.skill) + ' session request';
        action = function() { navigateTo('coaching'); switchPCTab('sessions'); };
      } else if (b.role === 'learner' && b.status === 'cancelled') {
        notifId = 'booking-cancelled-' + b.id;
        iconClass = 'declined'; emoji = '❌';
        title = 'Session declined';
        sub = (b.coachName || 'Your coach') + ' declined your ' + escHtml(b.skill) + ' request';
        action = function() { navigateTo('coaching'); switchPCTab('sessions'); };
      } else if (b.status === 'completed' && b.role === 'learner' && !b.hasReview) {
        notifId = 'booking-review-' + b.id;
        iconClass = 'completed'; emoji = '⭐';
        title = 'Rate your session';
        sub = 'How was your ' + escHtml(b.skill) + ' session with ' + (b.coachName || 'your coach') + '?';
        action = function() { navigateTo('coaching'); switchPCTab('sessions'); };
      } else { return; }

      if (notifId) {
        items.push({ id: notifId, iconClass: iconClass, emoji: emoji, title: title, sub: sub, time: timeStr, unread: !seen[notifId], action: action });
      }
    });

    chatItems.forEach(function(c) {
      if ((c.lastSenderId || '').toLowerCase().trim() === myId) return;
      var lastRead = chatLastRead[c.bookingId] || null;
      if (lastRead && new Date(c.lastMessageAt) <= new Date(lastRead)) return;
      var notifId = 'chat-' + c.bookingId;
      var bId = c.bookingId, oName = c.otherPersonName;
      items.push({
        id: notifId,
        iconClass: 'chat', emoji: '💬',
        title: 'Message from ' + escHtml(oName || 'your session partner'),
        sub: escHtml(c.preview || ''),
        time: c.lastMessageAt ? timeAgo(c.lastMessageAt) : '',
        unread: !seen[notifId],
        action: function() { navigateTo('coaching'); setTimeout(function() { openChatModal(bId, oName); }, 200); }
      });
    });

    renderNotifications(items);
  }).catch(function() {
    var list = document.getElementById('notifList');
    if (list) list.innerHTML = '<div class="notif-empty">Could not load notifications.</div>';
  });
}

function renderNotifications(items) {
  var list = document.getElementById('notifList');
  var dot = document.getElementById('notifDot');
  var countEl = document.getElementById('notifCount');
  if (!list) return;

  var unreadCount = items.filter(function(n) { return n.unread; }).length;

  if (items.length === 0) {
    list.innerHTML = '<div class="notif-empty">You\'re all caught up! 🎉</div>';
  } else {
    list.innerHTML = items.map(function(n, idx) {
      return '<div class="notif-item' + (n.unread ? ' unread' : '') + '" onclick="handleNotifClick(' + idx + ')" data-notif-id="' + n.id + '">' +
        '<div class="notif-icon ' + n.iconClass + '">' + n.emoji + '</div>' +
        '<div class="notif-body">' +
          '<div class="notif-body-title">' + n.title + '</div>' +
          '<div class="notif-body-sub">' + n.sub + '</div>' +
          (n.time ? '<div class="notif-body-time">' + n.time + '</div>' : '') +
        '</div>' +
        (n.unread ? '<div class="notif-unread-dot"></div>' : '') +
      '</div>';
    }).join('');

    // Store actions for click handling
    window._notifActions = items.map(function(n) { return { id: n.id, action: n.action }; });
  }

  // Update badge
  if (unreadCount > 0) {
    if (dot) dot.style.display = 'none';
    if (countEl) { countEl.textContent = unreadCount > 9 ? '9+' : unreadCount; countEl.style.display = 'flex'; }
  } else {
    if (dot) dot.style.display = 'none';
    if (countEl) countEl.style.display = 'none';
  }
}

function handleNotifClick(idx) {
  var actions = window._notifActions || [];
  var notif = actions[idx];
  if (!notif) return;
  markNotifSeen(notif.id);
  // Re-render to remove unread state
  var el = document.querySelector('[data-notif-id="' + notif.id + '"]');
  if (el) { el.classList.remove('unread'); var dot = el.querySelector('.notif-unread-dot'); if (dot) dot.remove(); }
  document.getElementById('notifPanel').style.display = 'none';
  if (notif.action) notif.action();
}

function markAllNotifsRead() {
  var all = document.querySelectorAll('.notif-item[data-notif-id]');
  all.forEach(function(el) {
    markNotifSeen(el.getAttribute('data-notif-id'));
    el.classList.remove('unread');
    var dot = el.querySelector('.notif-unread-dot');
    if (dot) dot.remove();
  });
  var countEl = document.getElementById('notifCount');
  var dotEl = document.getElementById('notifDot');
  if (countEl) countEl.style.display = 'none';
  if (dotEl) dotEl.style.display = 'none';
}

function getSeenNotifs() {
  try { return JSON.parse(localStorage.getItem('sgaSeenNotifs') || '{}'); } catch(e) { return {}; }
}

function markNotifSeen(id) {
  var seen = getSeenNotifs();
  seen[id] = Date.now();
  localStorage.setItem('sgaSeenNotifs', JSON.stringify(seen));
}

function timeAgo(isoStr) {
  var diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

// ══════════════════════════════════════
// ── Roadmap Module
// ══════════════════════════════════════

// Curated YouTube creators per skill — used to render reliable video links
// next to each roadmap stage. We prefer channel handles (very stable) plus a
// topic-targeted YouTube search URL (always works).
var SKILL_YOUTUBE_CREATORS = {
  'Python':           [{ name: 'Corey Schafer',         url: 'https://www.youtube.com/@coreyms' },
                       { name: 'freeCodeCamp',          url: 'https://www.youtube.com/@freecodecamp' }],
  'JavaScript':       [{ name: 'Web Dev Simplified',    url: 'https://www.youtube.com/@WebDevSimplified' },
                       { name: 'The Net Ninja',         url: 'https://www.youtube.com/@NetNinja' }],
  'SQL':              [{ name: 'Alex The Analyst',      url: 'https://www.youtube.com/@AlexTheAnalyst' },
                       { name: 'freeCodeCamp',          url: 'https://www.youtube.com/@freecodecamp' }],
  'Machine Learning': [{ name: 'StatQuest (Josh Starmer)', url: 'https://www.youtube.com/@statquest' },
                       { name: 'Krish Naik',            url: 'https://www.youtube.com/@krishnaik06' },
                       { name: '3Blue1Brown',           url: 'https://www.youtube.com/@3blue1brown' }],
  'Data Analysis':    [{ name: 'Alex The Analyst',      url: 'https://www.youtube.com/@AlexTheAnalyst' },
                       { name: 'Ken Jee',               url: 'https://www.youtube.com/@KenJee_ds' }],
  'React':            [{ name: 'Web Dev Simplified',    url: 'https://www.youtube.com/@WebDevSimplified' },
                       { name: 'The Net Ninja',         url: 'https://www.youtube.com/@NetNinja' }],
  'Excel':            [{ name: 'Leila Gharani',         url: 'https://www.youtube.com/@LeilaGharani' },
                       { name: 'ExcelIsFun',            url: 'https://www.youtube.com/@excelisfun' }],
  'Statistics':       [{ name: 'StatQuest (Josh Starmer)', url: 'https://www.youtube.com/@statquest' },
                       { name: '3Blue1Brown',           url: 'https://www.youtube.com/@3blue1brown' }],
  'Cloud Computing':  [{ name: 'TechWorld with Nana',   url: 'https://www.youtube.com/@TechWorldwithNana' },
                       { name: 'AWS (official)',        url: 'https://www.youtube.com/@amazonwebservices' }],
  'Cybersecurity':    [{ name: 'NetworkChuck',          url: 'https://www.youtube.com/@NetworkChuck' },
                       { name: 'John Hammond',          url: 'https://www.youtube.com/@_JohnHammond' }]
};

// Build a topic-specific YouTube search URL — always works, no dead links.
function buildYouTubeSearchUrl(skill, topic) {
  var q = encodeURIComponent((skill + ' ' + topic + ' tutorial').trim());
  return 'https://www.youtube.com/results?search_query=' + q;
}

var ROADMAP_DATA = {
  'Python': {
    title: 'Python Developer',
    nodes: [
      { id: 'py-basics', icon: '🐍', title: 'Basics', sub: 'Syntax, Variables', topics: ['Variables & Data Types', 'Print & Input', 'Operators', 'Comments'], resources: [{type:'Course',title:'Python for Beginners',url:'https://www.python.org/about/gettingstarted/'},{type:'Video',title:'Python Tutorial',url:'https://www.youtube.com/watch?v=rfscVS0vtbw'}] },
      { id: 'py-ds', icon: '📦', title: 'Data Structures', sub: 'Lists, Dicts', topics: ['Lists & Tuples', 'Dictionaries', 'Sets', 'Comprehensions'], resources: [{type:'Docs',title:'Python Data Structures',url:'https://docs.python.org/3/tutorial/datastructures.html'}] },
      { id: 'py-flow', icon: '🔀', title: 'Control Flow', sub: 'Loops, Conditions', topics: ['If/Elif/Else', 'For Loops', 'While Loops', 'Break/Continue'], resources: [{type:'Course',title:'Control Flow',url:'https://realpython.com/python-conditional-statements/'}] },
      { id: 'py-func', icon: '⚙️', title: 'Functions', sub: 'Def, Lambda', topics: ['Defining Functions', 'Arguments & Returns', 'Lambda Functions', 'Decorators', '*args/**kwargs'], resources: [{type:'Guide',title:'Python Functions',url:'https://realpython.com/defining-your-own-python-function/'}] },
      { id: 'py-oop', icon: '🏗️', title: 'OOP', sub: 'Classes, Inheritance', topics: ['Classes & Objects', 'Inheritance', 'Polymorphism', 'Encapsulation', 'Magic Methods'], resources: [{type:'Course',title:'Python OOP',url:'https://realpython.com/python3-object-oriented-programming/'}] },
      { id: 'py-file', icon: '📁', title: 'File I/O', sub: 'Read, Write, CSV', topics: ['File Reading/Writing', 'Context Managers', 'CSV & JSON', 'Path handling'], resources: [{type:'Docs',title:'File Handling',url:'https://docs.python.org/3/tutorial/inputoutput.html'}] },
      { id: 'py-err', icon: '🐛', title: 'Error Handling', sub: 'Try, Except', topics: ['Try/Except/Finally', 'Custom Exceptions', 'Assertions', 'Logging'], resources: [{type:'Guide',title:'Exception Handling',url:'https://realpython.com/python-exceptions/'}] },
      { id: 'py-lib', icon: '📚', title: 'Libraries', sub: 'NumPy, Pandas', topics: ['NumPy Arrays', 'Pandas DataFrames', 'Matplotlib', 'Requests'], resources: [{type:'Course',title:'NumPy & Pandas',url:'https://www.kaggle.com/learn/pandas'}] },
      { id: 'py-adv', icon: '🚀', title: 'Advanced', sub: 'Generators, Async', topics: ['Generators & Iterators', 'Async/Await', 'Threading', 'Metaclasses', 'Descriptors'], resources: [{type:'Guide',title:'Advanced Python',url:'https://realpython.com/python-async-features/'}] },
      { id: 'py-test', icon: '✅', title: 'Testing', sub: 'Pytest, TDD', topics: ['Unit Testing', 'Pytest', 'Mocking', 'TDD', 'Coverage'], resources: [{type:'Course',title:'Testing in Python',url:'https://realpython.com/python-testing/'}] }
    ]
  },
  'JavaScript': {
    title: 'JavaScript Developer',
    nodes: [
      { id: 'js-basics', icon: '⚡', title: 'Basics', sub: 'Syntax, Types', topics: ['Variables (let/const)', 'Data Types', 'Operators', 'Type Coercion'], resources: [{type:'Course',title:'JavaScript.info',url:'https://javascript.info/'}] },
      { id: 'js-func', icon: '⚙️', title: 'Functions', sub: 'Arrow, Scope', topics: ['Function Declarations', 'Arrow Functions', 'Closures', 'Scope & Hoisting'], resources: [{type:'Guide',title:'Functions Deep Dive',url:'https://javascript.info/advanced-functions'}] },
      { id: 'js-dom', icon: '🌐', title: 'DOM', sub: 'Events, Selectors', topics: ['DOM Selection', 'Event Listeners', 'Event Delegation', 'DOM Manipulation'], resources: [{type:'Course',title:'DOM Manipulation',url:'https://javascript.info/document'}] },
      { id: 'js-async', icon: '⏳', title: 'Async', sub: 'Promises, Await', topics: ['Callbacks', 'Promises', 'Async/Await', 'Event Loop', 'Fetch API'], resources: [{type:'Guide',title:'Async JavaScript',url:'https://javascript.info/async'}] },
      { id: 'js-es6', icon: '✨', title: 'ES6+', sub: 'Modern Features', topics: ['Destructuring', 'Spread/Rest', 'Template Literals', 'Modules', 'Optional Chaining'], resources: [{type:'Docs',title:'ES6 Features',url:'https://es6-features.org/'}] },
      { id: 'js-oop', icon: '🏗️', title: 'OOP & Prototypes', sub: 'Classes, This', topics: ['Prototypal Inheritance', 'Classes', 'this Keyword', 'new Operator'], resources: [{type:'Guide',title:'Prototypes',url:'https://javascript.info/prototypes'}] },
      { id: 'js-error', icon: '🐛', title: 'Error Handling', sub: 'Try/Catch, Debug', topics: ['Error Types', 'Try/Catch/Finally', 'Custom Errors', 'Debugging'], resources: [{type:'Guide',title:'Error Handling',url:'https://javascript.info/error-handling'}] },
      { id: 'js-tools', icon: '🔧', title: 'Tooling', sub: 'NPM, Webpack', topics: ['NPM/Yarn', 'Bundlers', 'Babel', 'ESLint', 'Testing (Jest)'], resources: [{type:'Course',title:'Modern JS Tooling',url:'https://frontendmasters.com/'}] },
      { id: 'js-patterns', icon: '📐', title: 'Patterns', sub: 'Design Patterns', topics: ['Module Pattern', 'Observer', 'Factory', 'Singleton', 'MVC'], resources: [{type:'Book',title:'JS Design Patterns',url:'https://www.patterns.dev/'}] },
      { id: 'js-perf', icon: '🚀', title: 'Performance', sub: 'Optimization', topics: ['Memory Management', 'Web Workers', 'Lazy Loading', 'Caching', 'Profiling'], resources: [{type:'Guide',title:'Web Performance',url:'https://web.dev/performance/'}] }
    ]
  },
  'SQL': {
    title: 'SQL Master',
    nodes: [
      { id: 'sql-basics', icon: '🗃️', title: 'Basics', sub: 'SELECT, WHERE', topics: ['SELECT Statements', 'WHERE Clauses', 'ORDER BY', 'LIMIT/OFFSET'], resources: [{type:'Course',title:'SQL Basics',url:'https://www.w3schools.com/sql/'}] },
      { id: 'sql-filter', icon: '🔍', title: 'Filtering', sub: 'AND, OR, IN', topics: ['AND/OR/NOT', 'IN/BETWEEN', 'LIKE & Wildcards', 'IS NULL'], resources: [{type:'Practice',title:'SQLBolt',url:'https://sqlbolt.com/'}] },
      { id: 'sql-join', icon: '🔗', title: 'Joins', sub: 'INNER, LEFT, RIGHT', topics: ['INNER JOIN', 'LEFT/RIGHT JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'Self Joins'], resources: [{type:'Visual',title:'Visual SQL Joins',url:'https://joins.spathon.com/'}] },
      { id: 'sql-agg', icon: '📊', title: 'Aggregation', sub: 'GROUP BY, HAVING', topics: ['COUNT/SUM/AVG', 'GROUP BY', 'HAVING', 'MIN/MAX'], resources: [{type:'Course',title:'Aggregation',url:'https://mode.com/sql-tutorial/sql-aggregate-functions/'}] },
      { id: 'sql-sub', icon: '📦', title: 'Subqueries', sub: 'Nested, Correlated', topics: ['Scalar Subqueries', 'Table Subqueries', 'Correlated Subqueries', 'EXISTS'], resources: [{type:'Guide',title:'Subqueries',url:'https://mode.com/sql-tutorial/sql-sub-queries/'}] },
      { id: 'sql-window', icon: '🪟', title: 'Window Functions', sub: 'ROW_NUMBER, RANK', topics: ['ROW_NUMBER', 'RANK/DENSE_RANK', 'LAG/LEAD', 'NTILE', 'Running Totals'], resources: [{type:'Course',title:'Window Functions',url:'https://mode.com/sql-tutorial/sql-window-functions/'}] },
      { id: 'sql-cte', icon: '🔄', title: 'CTEs & Temp', sub: 'WITH, Temp Tables', topics: ['Common Table Expressions', 'Recursive CTEs', 'Temp Tables', 'Views'], resources: [{type:'Guide',title:'CTEs',url:'https://learnsql.com/blog/what-is-cte/'}] },
      { id: 'sql-ddl', icon: '🏗️', title: 'DDL & Design', sub: 'CREATE, ALTER', topics: ['CREATE TABLE', 'Constraints', 'Normalization', 'Indexes', 'ALTER/DROP'], resources: [{type:'Course',title:'Database Design',url:'https://www.studytonight.com/dbms/'}] },
      { id: 'sql-adv', icon: '🚀', title: 'Advanced', sub: 'Optimization', topics: ['Query Optimization', 'Execution Plans', 'Transactions & ACID', 'Stored Procedures', 'Triggers'], resources: [{type:'Guide',title:'SQL Performance',url:'https://use-the-index-luke.com/'}] }
    ]
  },
  'Machine Learning': {
    title: 'ML Engineer',
    nodes: [
      { id: 'ml-math', icon: '📐', title: 'Math Foundations', sub: 'Linear Algebra, Stats', topics: ['Linear Algebra', 'Probability', 'Statistics', 'Calculus Basics'], resources: [{type:'Course',title:'Math for ML',url:'https://www.khanacademy.org/math/linear-algebra'}] },
      { id: 'ml-python', icon: '🐍', title: 'Python for ML', sub: 'NumPy, Pandas', topics: ['NumPy Operations', 'Pandas DataFrames', 'Matplotlib/Seaborn', 'Scikit-learn Basics'], resources: [{type:'Course',title:'Python for Data Science',url:'https://www.kaggle.com/learn/python'}] },
      { id: 'ml-supervised', icon: '📈', title: 'Supervised Learning', sub: 'Regression, Classification', topics: ['Linear Regression', 'Logistic Regression', 'Decision Trees', 'KNN', 'SVM'], resources: [{type:'Course',title:'ML by Andrew Ng',url:'https://www.coursera.org/learn/machine-learning'}] },
      { id: 'ml-unsupervised', icon: '🔮', title: 'Unsupervised', sub: 'Clustering, PCA', topics: ['K-Means', 'Hierarchical Clustering', 'PCA', 'DBSCAN', 'Anomaly Detection'], resources: [{type:'Guide',title:'Clustering Guide',url:'https://scikit-learn.org/stable/modules/clustering.html'}] },
      { id: 'ml-eval', icon: '📋', title: 'Evaluation', sub: 'Metrics, Validation', topics: ['Accuracy/Precision/Recall', 'F1 Score', 'ROC-AUC', 'Cross-Validation', 'Confusion Matrix'], resources: [{type:'Guide',title:'Model Evaluation',url:'https://scikit-learn.org/stable/modules/model_evaluation.html'}] },
      { id: 'ml-ensemble', icon: '🌲', title: 'Ensemble Methods', sub: 'RF, XGBoost', topics: ['Random Forest', 'Gradient Boosting', 'XGBoost', 'Bagging vs Boosting', 'Stacking'], resources: [{type:'Course',title:'Ensemble Methods',url:'https://www.kaggle.com/learn/intro-to-machine-learning'}] },
      { id: 'ml-nn', icon: '🧠', title: 'Neural Networks', sub: 'Deep Learning Basics', topics: ['Perceptrons', 'Backpropagation', 'Activation Functions', 'Gradient Descent', 'Regularization'], resources: [{type:'Course',title:'Deep Learning',url:'https://www.deeplearning.ai/'}] },
      { id: 'ml-cnn', icon: '👁️', title: 'Computer Vision', sub: 'CNN, Image', topics: ['CNNs', 'Transfer Learning', 'Image Classification', 'Object Detection', 'Data Augmentation'], resources: [{type:'Course',title:'CNN Course',url:'https://www.coursera.org/learn/convolutional-neural-networks'}] },
      { id: 'ml-nlp', icon: '💬', title: 'NLP', sub: 'Text, Transformers', topics: ['Text Preprocessing', 'Word Embeddings', 'RNNs/LSTMs', 'Transformers', 'BERT/GPT'], resources: [{type:'Course',title:'NLP with Transformers',url:'https://huggingface.co/course'}] },
      { id: 'ml-deploy', icon: '🚀', title: 'MLOps', sub: 'Deploy, Monitor', topics: ['Model Deployment', 'Flask/FastAPI', 'Docker', 'ML Pipelines', 'Monitoring'], resources: [{type:'Guide',title:'MLOps Guide',url:'https://ml-ops.org/'}] }
    ]
  },
  'Data Analysis': {
    title: 'Data Analyst',
    nodes: [
      { id: 'da-excel', icon: '📗', title: 'Excel Basics', sub: 'Formulas, Pivot', topics: ['Formulas', 'Pivot Tables', 'Charts', 'VLOOKUP', 'Conditional Formatting'], resources: [{type:'Course',title:'Excel Skills',url:'https://www.coursera.org/learn/excel-basics-data-analysis'}] },
      { id: 'da-sql', icon: '🗃️', title: 'SQL for Analysis', sub: 'Queries, Joins', topics: ['SELECT & JOINs', 'Aggregation', 'Subqueries', 'Window Functions'], resources: [{type:'Course',title:'SQL for DA',url:'https://mode.com/sql-tutorial/'}] },
      { id: 'da-python', icon: '🐍', title: 'Python & Pandas', sub: 'DataFrames', topics: ['Pandas Basics', 'Data Cleaning', 'GroupBy', 'Merge/Join', 'Apply/Map'], resources: [{type:'Course',title:'Pandas',url:'https://www.kaggle.com/learn/pandas'}] },
      { id: 'da-viz', icon: '📊', title: 'Visualization', sub: 'Charts, Dashboards', topics: ['Matplotlib', 'Seaborn', 'Plotly', 'Chart Selection', 'Dashboard Design'], resources: [{type:'Course',title:'Data Visualization',url:'https://www.kaggle.com/learn/data-visualization'}] },
      { id: 'da-stats', icon: '📈', title: 'Statistics', sub: 'Descriptive, Inferential', topics: ['Central Tendency', 'Distributions', 'Hypothesis Testing', 'Correlation', 'Regression'], resources: [{type:'Course',title:'Statistics',url:'https://www.khanacademy.org/math/statistics-probability'}] },
      { id: 'da-clean', icon: '🧹', title: 'Data Cleaning', sub: 'Missing, Outliers', topics: ['Missing Values', 'Outlier Detection', 'Data Types', 'Deduplication', 'Normalization'], resources: [{type:'Guide',title:'Data Cleaning',url:'https://www.kaggle.com/learn/data-cleaning'}] },
      { id: 'da-eda', icon: '🔍', title: 'EDA', sub: 'Exploration', topics: ['Univariate Analysis', 'Bivariate Analysis', 'Feature Engineering', 'Pattern Recognition'], resources: [{type:'Course',title:'EDA',url:'https://www.coursera.org/learn/ibm-exploratory-data-analysis'}] },
      { id: 'da-bi', icon: '📋', title: 'BI Tools', sub: 'Tableau, Power BI', topics: ['Tableau Basics', 'Power BI', 'Dashboard Design', 'KPIs', 'Storytelling'], resources: [{type:'Course',title:'Tableau',url:'https://www.tableau.com/learn/training'}] },
      { id: 'da-project', icon: '🚀', title: 'Capstone', sub: 'End-to-End Project', topics: ['Problem Definition', 'Data Collection', 'Analysis Pipeline', 'Presentation', 'Stakeholder Communication'], resources: [{type:'Project',title:'Portfolio Projects',url:'https://www.kaggle.com/competitions'}] }
    ]
  },
  'React': {
    title: 'React Developer',
    nodes: [
      { id: 're-jsx', icon: '⚛️', title: 'JSX & Components', sub: 'Basics', topics: ['JSX Syntax', 'Functional Components', 'Props', 'Children', 'Fragments'], resources: [{type:'Docs',title:'React Docs',url:'https://react.dev/learn'}] },
      { id: 're-state', icon: '📦', title: 'State', sub: 'useState, Events', topics: ['useState', 'Event Handling', 'Controlled Inputs', 'State Lifting'], resources: [{type:'Course',title:'React State',url:'https://react.dev/learn/adding-interactivity'}] },
      { id: 're-effects', icon: '⚡', title: 'Effects', sub: 'useEffect, Lifecycle', topics: ['useEffect', 'Cleanup', 'Dependencies', 'Data Fetching'], resources: [{type:'Guide',title:'useEffect Guide',url:'https://react.dev/reference/react/useEffect'}] },
      { id: 're-hooks', icon: '🪝', title: 'Advanced Hooks', sub: 'useRef, useMemo', topics: ['useRef', 'useMemo', 'useCallback', 'useReducer', 'Custom Hooks'], resources: [{type:'Guide',title:'Hooks API',url:'https://react.dev/reference/react'}] },
      { id: 're-context', icon: '🌐', title: 'Context & State Mgmt', sub: 'Context, Redux', topics: ['useContext', 'Context API', 'Redux Toolkit', 'Zustand'], resources: [{type:'Course',title:'State Management',url:'https://redux-toolkit.js.org/tutorials/quick-start'}] },
      { id: 're-router', icon: '🗺️', title: 'Routing', sub: 'React Router', topics: ['BrowserRouter', 'Routes & Links', 'Params', 'Nested Routes', 'Protected Routes'], resources: [{type:'Docs',title:'React Router',url:'https://reactrouter.com/'}] },
      { id: 're-forms', icon: '📝', title: 'Forms & Validation', sub: 'React Hook Form', topics: ['Controlled Forms', 'React Hook Form', 'Validation', 'Error Handling'], resources: [{type:'Docs',title:'React Hook Form',url:'https://react-hook-form.com/'}] },
      { id: 're-perf', icon: '🚀', title: 'Performance', sub: 'Memo, Suspense', topics: ['React.memo', 'Code Splitting', 'Lazy Loading', 'Suspense', 'Profiler'], resources: [{type:'Guide',title:'React Performance',url:'https://react.dev/reference/react/memo'}] },
      { id: 're-test', icon: '✅', title: 'Testing', sub: 'Jest, RTL', topics: ['Jest', 'React Testing Library', 'Integration Tests', 'Snapshot Testing'], resources: [{type:'Docs',title:'Testing Library',url:'https://testing-library.com/docs/react-testing-library/intro/'}] },
      { id: 're-adv', icon: '💎', title: 'Advanced Patterns', sub: 'Server Components', topics: ['Server Components', 'Streaming SSR', 'Concurrent Features', 'Error Boundaries', 'Portals'], resources: [{type:'Docs',title:'React Canaries',url:'https://react.dev/blog'}] }
    ]
  },
  'Excel': {
    title: 'Excel Power User',
    nodes: [
      { id: 'ex-basics', icon: '📗', title: 'Basics', sub: 'Navigation, Entry', topics: ['Cell References', 'Data Entry', 'Formatting', 'Basic Formulas'], resources: [{type:'Course',title:'Excel Basics',url:'https://support.microsoft.com/en-us/excel'}] },
      { id: 'ex-formulas', icon: '🔢', title: 'Formulas', sub: 'SUM, IF, COUNT', topics: ['SUM/AVERAGE', 'IF/IFS', 'COUNTIF/SUMIF', 'AND/OR/NOT'], resources: [{type:'Guide',title:'Formula Guide',url:'https://exceljet.net/formulas'}] },
      { id: 'ex-lookup', icon: '🔍', title: 'Lookups', sub: 'VLOOKUP, INDEX', topics: ['VLOOKUP/HLOOKUP', 'INDEX-MATCH', 'XLOOKUP', 'Approximate Match'], resources: [{type:'Course',title:'Lookup Functions',url:'https://exceljet.net/functions/vlookup-function'}] },
      { id: 'ex-pivot', icon: '📊', title: 'Pivot Tables', sub: 'Summarize Data', topics: ['Creating Pivots', 'Grouping', 'Calculated Fields', 'Slicers', 'PivotCharts'], resources: [{type:'Guide',title:'Pivot Tables',url:'https://support.microsoft.com/en-us/office/create-a-pivottable'}] },
      { id: 'ex-charts', icon: '📈', title: 'Charts', sub: 'Visualization', topics: ['Chart Types', 'Formatting', 'Combo Charts', 'Sparklines', 'Trendlines'], resources: [{type:'Guide',title:'Excel Charts',url:'https://exceljet.net/chart-type'}] },
      { id: 'ex-data', icon: '🧹', title: 'Data Tools', sub: 'Validation, Filter', topics: ['Data Validation', 'Conditional Formatting', 'Sort & Filter', 'Remove Duplicates', 'Text to Columns'], resources: [{type:'Course',title:'Data Tools',url:'https://support.microsoft.com/en-us/office/data-validation'}] },
      { id: 'ex-adv', icon: '⚡', title: 'Advanced Formulas', sub: 'Array, Dynamic', topics: ['Array Formulas', 'FILTER/SORT/UNIQUE', 'LET/LAMBDA', 'INDIRECT/OFFSET'], resources: [{type:'Guide',title:'Dynamic Arrays',url:'https://exceljet.net/dynamic-array-formulas-in-excel'}] },
      { id: 'ex-pq', icon: '🔄', title: 'Power Query', sub: 'ETL, Transform', topics: ['Get & Transform', 'Merge Queries', 'Append', 'Custom Columns', 'M Language'], resources: [{type:'Course',title:'Power Query',url:'https://support.microsoft.com/en-us/power-query'}] },
      { id: 'ex-macro', icon: '🤖', title: 'VBA & Macros', sub: 'Automation', topics: ['Recording Macros', 'VBA Basics', 'Variables & Loops', 'UserForms', 'Error Handling'], resources: [{type:'Course',title:'VBA Tutorial',url:'https://www.excel-easy.com/vba.html'}] }
    ]
  },
  'Statistics': {
    title: 'Statistics Expert',
    nodes: [
      { id: 'st-desc', icon: '📊', title: 'Descriptive Stats', sub: 'Mean, Median, Mode', topics: ['Central Tendency', 'Spread (Variance, SD)', 'Percentiles', 'Skewness & Kurtosis'], resources: [{type:'Course',title:'Stats Basics',url:'https://www.khanacademy.org/math/statistics-probability'}] },
      { id: 'st-prob', icon: '🎲', title: 'Probability', sub: 'Events, Rules', topics: ['Probability Rules', 'Conditional Probability', 'Independence', 'Bayes Theorem', 'Combinatorics'], resources: [{type:'Course',title:'Probability',url:'https://www.khanacademy.org/math/statistics-probability/probability-library'}] },
      { id: 'st-dist', icon: '📈', title: 'Distributions', sub: 'Normal, Binomial', topics: ['Normal Distribution', 'Binomial', 'Poisson', 'Uniform', 'Exponential', 'Z-scores'], resources: [{type:'Guide',title:'Distributions',url:'https://www.stat.berkeley.edu/~stark/SticiGui/'}] },
      { id: 'st-sample', icon: '🧪', title: 'Sampling', sub: 'CLT, Methods', topics: ['Sampling Methods', 'Central Limit Theorem', 'Sampling Distribution', 'Standard Error'], resources: [{type:'Course',title:'Sampling',url:'https://www.khanacademy.org/math/statistics-probability/sampling-distributions-library'}] },
      { id: 'st-ci', icon: '📏', title: 'Confidence Intervals', sub: 'Estimation', topics: ['Point Estimates', 'Margin of Error', 'Z & T Intervals', 'Sample Size Calculation'], resources: [{type:'Guide',title:'Confidence Intervals',url:'https://www.khanacademy.org/math/statistics-probability/confidence-intervals-one-sample'}] },
      { id: 'st-hyp', icon: '⚖️', title: 'Hypothesis Testing', sub: 'T-test, P-value', topics: ['Null & Alternative Hypothesis', 'P-values', 'Type I/II Errors', 'T-tests', 'Z-tests'], resources: [{type:'Course',title:'Hypothesis Testing',url:'https://www.khanacademy.org/math/statistics-probability/significance-tests-one-sample'}] },
      { id: 'st-chi', icon: '🔲', title: 'Chi-Squared & ANOVA', sub: 'Categorical Tests', topics: ['Chi-Squared Test', 'One-way ANOVA', 'Two-way ANOVA', 'Post-hoc Tests'], resources: [{type:'Guide',title:'ANOVA',url:'https://www.statisticshowto.com/probability-and-statistics/hypothesis-testing/anova/'}] },
      { id: 'st-reg', icon: '📉', title: 'Regression', sub: 'Linear, Multiple', topics: ['Simple Linear Regression', 'Multiple Regression', 'R-squared', 'Residual Analysis', 'Assumptions'], resources: [{type:'Course',title:'Regression',url:'https://www.khanacademy.org/math/statistics-probability/describing-relationships-quantitative-data'}] },
      { id: 'st-adv', icon: '🚀', title: 'Advanced Methods', sub: 'Bayesian, Bootstrap', topics: ['Bayesian Statistics', 'Bootstrap Methods', 'Non-parametric Tests', 'MLE', 'Effect Size & Power'], resources: [{type:'Guide',title:'Advanced Stats',url:'https://www.statisticshowto.com/'}] }
    ]
  },
  'Cloud Computing': {
    title: 'Cloud Engineer',
    nodes: [
      { id: 'cc-intro', icon: '☁️', title: 'Cloud Basics', sub: 'IaaS, PaaS, SaaS', topics: ['Cloud Models', 'Service Types', 'Deployment Models', 'Benefits & Risks'], resources: [{type:'Course',title:'Cloud Basics',url:'https://aws.amazon.com/getting-started/'}] },
      { id: 'cc-compute', icon: '💻', title: 'Compute', sub: 'EC2, VMs', topics: ['Virtual Machines', 'EC2/Azure VMs', 'Instance Types', 'Auto Scaling', 'Spot Instances'], resources: [{type:'Docs',title:'EC2 Guide',url:'https://docs.aws.amazon.com/ec2/'}] },
      { id: 'cc-storage', icon: '💾', title: 'Storage', sub: 'S3, Blob, Disks', topics: ['Object Storage (S3)', 'Block Storage (EBS)', 'File Storage (EFS)', 'Storage Classes'], resources: [{type:'Course',title:'Cloud Storage',url:'https://aws.amazon.com/s3/getting-started/'}] },
      { id: 'cc-network', icon: '🌐', title: 'Networking', sub: 'VPC, DNS, CDN', topics: ['VPC', 'Subnets & Security Groups', 'Load Balancers', 'DNS (Route 53)', 'CDN (CloudFront)'], resources: [{type:'Guide',title:'VPC Guide',url:'https://docs.aws.amazon.com/vpc/'}] },
      { id: 'cc-db', icon: '🗃️', title: 'Databases', sub: 'RDS, DynamoDB', topics: ['RDS/Aurora', 'DynamoDB/CosmosDB', 'ElastiCache/Redis', 'Database Migration'], resources: [{type:'Course',title:'Cloud Databases',url:'https://aws.amazon.com/rds/getting-started/'}] },
      { id: 'cc-serverless', icon: '⚡', title: 'Serverless', sub: 'Lambda, Functions', topics: ['AWS Lambda', 'API Gateway', 'Event-Driven Architecture', 'Step Functions'], resources: [{type:'Guide',title:'Serverless',url:'https://aws.amazon.com/lambda/getting-started/'}] },
      { id: 'cc-container', icon: '🐳', title: 'Containers', sub: 'Docker, K8s', topics: ['Docker Basics', 'Kubernetes', 'ECS/EKS', 'Container Registry', 'Orchestration'], resources: [{type:'Course',title:'Docker & K8s',url:'https://kubernetes.io/docs/tutorials/'}] },
      { id: 'cc-iac', icon: '📜', title: 'IaC & CI/CD', sub: 'Terraform, Pipelines', topics: ['Terraform', 'CloudFormation', 'CI/CD Pipelines', 'GitOps', 'Configuration Management'], resources: [{type:'Guide',title:'Terraform',url:'https://developer.hashicorp.com/terraform/tutorials'}] },
      { id: 'cc-security', icon: '🔒', title: 'Cloud Security', sub: 'IAM, Encryption', topics: ['IAM Policies', 'Encryption at Rest/Transit', 'Security Groups', 'Compliance', 'Shared Responsibility'], resources: [{type:'Course',title:'Cloud Security',url:'https://aws.amazon.com/security/'}] },
      { id: 'cc-monitor', icon: '📡', title: 'Monitoring', sub: 'CloudWatch, Logs', topics: ['CloudWatch', 'Logging', 'Alerting', 'Cost Optimization', 'Well-Architected Framework'], resources: [{type:'Guide',title:'Monitoring',url:'https://docs.aws.amazon.com/cloudwatch/'}] }
    ]
  },
  'Cybersecurity': {
    title: 'Cybersecurity Analyst',
    nodes: [
      { id: 'cs-intro', icon: '🔒', title: 'Fundamentals', sub: 'CIA Triad', topics: ['CIA Triad', 'Security Principles', 'Threat Landscape', 'Security Frameworks'], resources: [{type:'Course',title:'Cybersecurity Basics',url:'https://www.coursera.org/learn/intro-cyber-security'}] },
      { id: 'cs-network', icon: '🌐', title: 'Network Security', sub: 'Firewalls, IDS', topics: ['Firewalls', 'IDS/IPS', 'VPN', 'Network Protocols', 'Packet Analysis'], resources: [{type:'Course',title:'Network Security',url:'https://www.cybrary.it/'}] },
      { id: 'cs-crypto', icon: '🔐', title: 'Cryptography', sub: 'Encryption, Hashing', topics: ['Symmetric Encryption', 'Asymmetric Encryption', 'Hashing', 'Digital Signatures', 'PKI'], resources: [{type:'Guide',title:'Cryptography',url:'https://www.khanacademy.org/computing/computer-science/cryptography'}] },
      { id: 'cs-web', icon: '🕷️', title: 'Web Security', sub: 'XSS, SQLi, CSRF', topics: ['SQL Injection', 'XSS', 'CSRF', 'OWASP Top 10', 'Input Validation'], resources: [{type:'Practice',title:'OWASP',url:'https://owasp.org/www-project-top-ten/'}] },
      { id: 'cs-auth', icon: '🪪', title: 'Identity & Access', sub: 'MFA, OAuth', topics: ['Authentication Methods', 'MFA', 'OAuth/OIDC', 'RBAC/ABAC', 'SSO'], resources: [{type:'Guide',title:'Authentication',url:'https://auth0.com/docs'}] },
      { id: 'cs-malware', icon: '🦠', title: 'Malware & Threats', sub: 'Virus, Ransomware', topics: ['Malware Types', 'Ransomware', 'Social Engineering', 'Phishing', 'APTs'], resources: [{type:'Course',title:'Malware Analysis',url:'https://www.sans.org/'}] },
      { id: 'cs-ops', icon: '🛡️', title: 'Security Operations', sub: 'SIEM, SOC', topics: ['SIEM', 'SOC Operations', 'Log Analysis', 'Threat Intelligence', 'Incident Detection'], resources: [{type:'Guide',title:'SOC Guide',url:'https://www.splunk.com/en_us/what-is-splunk.html'}] },
      { id: 'cs-ir', icon: '🚨', title: 'Incident Response', sub: 'Forensics, Recovery', topics: ['IR Process', 'Digital Forensics', 'Evidence Collection', 'Recovery Planning', 'Post-Mortem'], resources: [{type:'Course',title:'Incident Response',url:'https://www.sans.org/cyber-security-courses/incident-handler/'}] },
      { id: 'cs-compliance', icon: '📋', title: 'Compliance', sub: 'GDPR, HIPAA', topics: ['GDPR', 'HIPAA', 'PCI-DSS', 'SOC 2', 'Risk Assessment', 'Security Policies'], resources: [{type:'Guide',title:'Compliance',url:'https://www.nist.gov/cyberframework'}] },
      { id: 'cs-adv', icon: '🚀', title: 'Advanced', sub: 'Pen Testing, Zero Trust', topics: ['Penetration Testing', 'Zero Trust Architecture', 'Red/Blue Teams', 'Bug Bounties', 'Cloud Security'], resources: [{type:'Practice',title:'HackTheBox',url:'https://www.hackthebox.com/'}] }
    ]
  }
};

var currentRoadmapSkill = null;

// ── Roadmap user-controlled topic completion ──
// localStorage shape: sgaRoadmapTopics[skill] = { "Topic Name": true, ... }
function roadmapGetAllTopicState() {
  try { return JSON.parse(localStorage.getItem('sgaRoadmapTopics') || '{}'); }
  catch (e) { return {}; }
}
function roadmapGetTopicState(skill) {
  var all = roadmapGetAllTopicState();
  return all[skill] || {};
}
function roadmapSetTopicState(skill, state) {
  var all = roadmapGetAllTopicState();
  all[skill] = state;
  localStorage.setItem('sgaRoadmapTopics', JSON.stringify(all));
}
function roadmapNodeIsCompleted(skill, node) {
  var state = roadmapGetTopicState(skill);
  if (!node.topics || node.topics.length === 0) return false;
  return node.topics.every(function(t) { return !!state[t]; });
}
function toggleRoadmapTopic(topic) {
  if (!currentRoadmapSkill) return;
  var state = roadmapGetTopicState(currentRoadmapSkill);
  state[topic] = !state[topic];
  roadmapSetTopicState(currentRoadmapSkill, state);
  // Re-render the whole roadmap so node circles, banner %, connectors update
  loadRoadmap(currentRoadmapSkill, { preserveOpenIdx: openRoadmapIdx });
}
function roadmapMarkNode(nodeIdx, done) {
  if (!currentRoadmapSkill) return;
  var data = ROADMAP_DATA[currentRoadmapSkill];
  if (!data || !data.nodes[nodeIdx]) return;
  var state = roadmapGetTopicState(currentRoadmapSkill);
  data.nodes[nodeIdx].topics.forEach(function(t) {
    if (done) state[t] = true; else delete state[t];
  });
  roadmapSetTopicState(currentRoadmapSkill, state);
  loadRoadmap(currentRoadmapSkill, { preserveOpenIdx: openRoadmapIdx });
}
async function roadmapResetSkill() {
  if (!currentRoadmapSkill) return;
  if (!await showAppConfirm('Reset all topic progress for ' + currentRoadmapSkill + '? Your tick marks will be cleared.', { title: 'Reset progress', okLabel: 'Reset', danger: true })) return;
  roadmapSetTopicState(currentRoadmapSkill, {});
  loadRoadmap(currentRoadmapSkill, { preserveOpenIdx: openRoadmapIdx });
}
function roadmapMarkSkillComplete() {
  if (!currentRoadmapSkill) return;
  var data = ROADMAP_DATA[currentRoadmapSkill];
  if (!data) return;
  var state = {};
  data.nodes.forEach(function(node) {
    (node.topics || []).forEach(function(t) { state[t] = true; });
  });
  roadmapSetTopicState(currentRoadmapSkill, state);
  loadRoadmap(currentRoadmapSkill, { preserveOpenIdx: openRoadmapIdx });
}

function initRoadmap() {
  var select = document.getElementById('roadmapSkillSelect');
  if (!select) return;

  // Populate skill picker
  var currentUser = getActiveUser() || {};
  select.innerHTML = '<option value="">Choose a skill...</option>';
  Object.keys(ROADMAP_DATA).sort().forEach(function(skill) {
    var opt = document.createElement('option');
    opt.value = skill;
    opt.textContent = skill;
    if (skill === currentRoadmapSkill) opt.selected = true;
    select.appendChild(opt);
  });

  // If a skill was previously selected, reload it
  if (currentRoadmapSkill && ROADMAP_DATA[currentRoadmapSkill]) {
    loadRoadmap(currentRoadmapSkill);
  }
}

var openRoadmapIdx = null;

function loadRoadmap(skill, opts) {
  opts = opts || {};
  var preservedIdx = (opts.preserveOpenIdx !== undefined && opts.preserveOpenIdx !== null) ? opts.preserveOpenIdx : null;
  var data = ROADMAP_DATA[skill];
  var banner = document.getElementById('roadmapBanner');
  var timeline = document.getElementById('roadmapTimeline');
  var empty = document.getElementById('roadmapEmpty');

  if (!skill || !data) {
    banner.style.display = 'none';
    timeline.style.display = 'none';
    empty.style.display = 'block';
    currentRoadmapSkill = null;
    return;
  }

  currentRoadmapSkill = skill;
  openRoadmapIdx = null;
  empty.style.display = 'none';

  // User-controlled per-topic completion. Stored in localStorage as
  // sgaRoadmapTopics[skill] = { "Topic Name": true, ... }. A node is
  // "completed" when ALL its topics are checked, "current" when it's the
  // first non-completed node, "available" otherwise. No more locking — the
  // user can read ahead.
  var totalNodes = data.nodes.length;
  var nodeCompleted = data.nodes.map(function(node) { return roadmapNodeIsCompleted(skill, node); });
  var completedCount = nodeCompleted.filter(Boolean).length;
  // currentIndex = first non-completed node (or last if all complete)
  var currentIndex = nodeCompleted.indexOf(false);
  if (currentIndex === -1) currentIndex = totalNodes - 1;
  var progressPct = totalNodes > 0 ? Math.round((completedCount / totalNodes) * 100) : 0;

  // Banner
  banner.style.display = 'flex';
  document.getElementById('roadmapBannerTitle').textContent = data.title;
  document.getElementById('roadmapBannerPct').textContent = progressPct + '%';
  document.getElementById('roadmapProgressFill').style.width = progressPct + '%';

  var currentNode = data.nodes[currentIndex];
  var continueBtn = document.getElementById('roadmapContinueBtn');
  continueBtn.innerHTML = 'Continue Learning: ' + currentNode.title + ' <span>\u2192</span>';

  // Build vertical timeline
  timeline.style.display = 'block';
  // Keep the SVG defs
  var svgDefs = timeline.querySelector('svg');
  timeline.innerHTML = '';
  if (svgDefs) timeline.appendChild(svgDefs);

  data.nodes.forEach(function(node, idx) {
    var status = nodeCompleted[idx] ? 'completed' : idx === currentIndex ? 'current' : 'available';
    var alignClass = idx % 2 === 0 ? 'align-right' : 'align-left';

    // Curved connector — completed if both this and previous node are done
    if (idx > 0) {
      var connStatus = nodeCompleted[idx] && nodeCompleted[idx - 1] ? 'completed' : (idx === currentIndex ? 'active' : '');
      var curveDiv = document.createElement('div');
      curveDiv.className = 'roadmap-curve-connector ' + connStatus;

      // SVG curve that zigzags between left and right
      var prevAlign = (idx - 1) % 2 === 0 ? 'right' : 'left';
      var curAlign = idx % 2 === 0 ? 'right' : 'left';
      var w = 700, h = 80;
      var cx = w / 2;
      var startX = cx, endX = cx;
      // Slight curve offset for visual interest
      var cp1x = prevAlign === 'right' ? cx + 60 : cx - 60;
      var cp2x = curAlign === 'right' ? cx + 60 : cx - 60;

      curveDiv.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<path d="M ' + startX + ' 0 C ' + cp1x + ' ' + (h * 0.4) + ', ' + cp2x + ' ' + (h * 0.6) + ', ' + endX + ' ' + h + '"/></svg>';
      timeline.appendChild(curveDiv);
    }

    // Row
    var row = document.createElement('div');
    row.className = 'roadmap-row ' + alignClass;
    row.setAttribute('data-node-idx', idx);

    // Left side
    var leftSide = document.createElement('div');
    leftSide.className = 'roadmap-row-side';

    // Right side
    var rightSide = document.createElement('div');
    rightSide.className = 'roadmap-row-side';

    // Node info (title + subtitle — goes on the opposite side of the detail)
    var nodeInfo = document.createElement('div');
    nodeInfo.className = 'roadmap-node-info';
    nodeInfo.innerHTML = '<div class="roadmap-node-title">' + node.title + '</div>' +
      '<div class="roadmap-node-sub">' + node.sub + '</div>';

    // Node circle wrapper
    var nodeWrap = document.createElement('div');
    nodeWrap.className = 'roadmap-node-wrap ' + status;
    nodeWrap.onclick = (function(s, i, st) {
      return function() { toggleRoadmapDetail(s, i, st); };
    })(skill, idx, status);

    // Badge
    if (status === 'current') {
      nodeWrap.innerHTML = '<span class="roadmap-node-badge current-badge">CURRENT</span>';
    } else if (status === 'completed') {
      nodeWrap.innerHTML = '<span class="roadmap-node-badge completed-badge">DONE</span>';
    }

    // Circle
    var circle = document.createElement('div');
    circle.className = 'roadmap-node-circle';
    if (status === 'completed') {
      circle.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
    } else {
      circle.textContent = node.icon;
    }
    nodeWrap.appendChild(circle);

    // For align-right: [nodeInfo | nodeWrap | detail]
    // For align-left:  [detail | nodeWrap | nodeInfo]
    if (alignClass === 'align-right') {
      leftSide.appendChild(nodeInfo);
      row.appendChild(leftSide);
      row.appendChild(nodeWrap);
      row.appendChild(rightSide);
    } else {
      rightSide.appendChild(nodeInfo);
      row.appendChild(rightSide);
      row.appendChild(nodeWrap);
      row.appendChild(leftSide);
    }

    timeline.appendChild(row);
  });

  // Re-open the previously open detail card (e.g. after a topic toggle)
  if (preservedIdx !== null && data.nodes[preservedIdx]) {
    var psStatus = nodeCompleted[preservedIdx] ? 'completed' : preservedIdx === currentIndex ? 'current' : 'available';
    toggleRoadmapDetail(skill, preservedIdx, psStatus, { noScroll: true });
  } else {
    // First-time render: scroll to current node
    setTimeout(function() { scrollToCurrentNode(); }, 200);
  }
}

function scrollToCurrentNode() {
  var timeline = document.getElementById('roadmapTimeline');
  var currentNode = timeline.querySelector('.roadmap-node-wrap.current');
  if (currentNode) {
    currentNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function toggleRoadmapDetail(skill, idx, status, opts) {
  opts = opts || {};
  var data = ROADMAP_DATA[skill];
  var node = data.nodes[idx];
  var row = document.querySelector('.roadmap-row[data-node-idx="' + idx + '"]');
  var alignClass = row.classList.contains('align-right') ? 'align-right' : 'align-left';

  // If clicking same node, close it
  if (openRoadmapIdx === idx) {
    closeRoadmapDetail();
    return;
  }

  // Close any existing detail
  var existing = document.querySelector('.roadmap-detail-card');
  if (existing) existing.remove();

  openRoadmapIdx = idx;

  // Build detail card
  var card = document.createElement('div');
  card.className = 'roadmap-detail-card';

  // Header
  var statusLabel = status === 'completed' ? 'Completed' : status === 'current' ? 'Up Next' : 'Available';
  var header = '<h4>' + escapeHtml(node.title) + '</h4>' +
    '<div class="rm-detail-sub">' + escapeHtml(node.sub) + '</div>' +
    '<span class="rm-detail-status ' + status + '">' + statusLabel + '</span>';

  // Checklist — every topic is now a real, clickable checkbox the user toggles.
  var topicState = roadmapGetTopicState(skill);
  var allCheckedHere = node.topics.every(function(t) { return !!topicState[t]; });
  var anyCheckedHere = node.topics.some(function(t) { return !!topicState[t]; });
  var checklist = '<ul class="rm-checklist">';
  node.topics.forEach(function(topic) {
    var checked = !!topicState[topic];
    var checkClass = checked ? 'checked' : 'unchecked';
    var checkIcon = checked ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : '';
    var safeTopicAttr = topic.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    checklist += '<li class="rm-topic-row" onclick="toggleRoadmapTopic(\'' + safeTopicAttr.replace(/'/g, "\\'") + '\')" role="button" tabindex="0">' +
      '<span class="rm-check-icon ' + checkClass + '">' + checkIcon + '</span>' + escapeHtml(topic) + '</li>';
  });
  checklist += '</ul>';

  // Per-node convenience controls
  var nodeControls = '<div class="rm-node-controls">';
  if (allCheckedHere) {
    nodeControls += '<button class="btn btn-secondary rm-node-btn" onclick="roadmapMarkNode(' + idx + ', false)">Reset this stage</button>';
  } else {
    nodeControls += '<button class="btn btn-secondary rm-node-btn" onclick="roadmapMarkNode(' + idx + ', true)">' + (anyCheckedHere ? 'Mark stage complete' : 'Mark all done') + '</button>';
  }
  nodeControls += '</div>';

  // Build the resource list. YouTube search + creator channels are stable;
  // existing doc/course links follow as supplementary references.
  var ytItems = [];
  var searchUrl = buildYouTubeSearchUrl(skill, node.title);
  ytItems.push('<a href="' + searchUrl + '" target="_blank" rel="noopener" class="rm-yt-link">▶ YouTube: tutorials for "' + escapeHtml(node.title) + '" ↗</a>');
  var creators = SKILL_YOUTUBE_CREATORS[skill] || [];
  creators.forEach(function(c) {
    ytItems.push('<a href="' + c.url + '" target="_blank" rel="noopener" class="rm-yt-link">📺 ' + escapeHtml(c.name) + ' channel ↗</a>');
  });
  var docItems = (node.resources || []).map(function(r) {
    return '<a href="' + r.url + '" target="_blank" rel="noopener">' + escapeHtml(r.type) + ': ' + escapeHtml(r.title) + ' ↗</a>';
  });
  var resources = '<div class="rm-resources">' + ytItems.concat(docItems).join('') + '</div>';

  // CTA — always points at the targeted YouTube search
  var ctaUrl = buildYouTubeSearchUrl(skill, node.title);
  var cta = '<div class="rm-detail-cta"><a href="' + ctaUrl + '" target="_blank" rel="noopener" class="btn btn-primary rm-learn-btn">▶ Watch tutorials for "' + escapeHtml(node.title) + '" ↗</a></div>';

  card.innerHTML = header + checklist + nodeControls + resources + cta;

  // Insert card into the correct side
  var targetSide;
  if (alignClass === 'align-right') {
    targetSide = row.querySelector('.roadmap-row-side:last-child');
  } else {
    targetSide = row.querySelector('.roadmap-row-side:last-child');
  }
  targetSide.innerHTML = '';
  targetSide.appendChild(card);

  // Smooth scroll to the row (skipped when re-opening after a topic toggle)
  if (!opts.noScroll) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function closeRoadmapDetail() {
  var existing = document.querySelector('.roadmap-detail-card');
  if (existing) existing.remove();
  openRoadmapIdx = null;
}

// ══════════════════════════════════════
// ── Peer Coaching Module
// ══════════════════════════════════════

// HTML escape utility to prevent XSS
function escHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

var pcCurrentReviewBooking = null;
var pcStarValue = 0;

function initCoaching() {
  var user = getActiveUser() || {};
  if (!user.email) return;

  // ESC key to close modals
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var bookingModal = document.getElementById('pcBookingModal');
      var reviewModal = document.getElementById('pcReviewModal');
      if (bookingModal && bookingModal.style.display === 'flex') { bookingModal.style.display = 'none'; }
      if (reviewModal && reviewModal.style.display === 'flex') { reviewModal.style.display = 'none'; pcCurrentReviewBooking = null; }
    }
  });

  // Check eligibility
  fetch('/api/peer-coaching/eligibility?userId=' + encodeURIComponent(user.email))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      // Show eligibility banner
      var eligBanner = document.getElementById('pcEligibilityBanner');
      if (data.canCoach && data.canCoach.length > 0) {
        eligBanner.style.display = 'flex';
        document.getElementById('pcEligSkills').textContent = data.canCoach.map(function(c) { return c.skill; }).join(', ');
        if (data.hasProfile) {
          document.getElementById('pcEligTitle').textContent = 'You\'re an active coach!';
          document.getElementById('pcEligSub').textContent = 'Your verified skills: ' + data.canCoach.map(function(c) { return c.skill + ' (' + c.score + '/10)'; }).join(', ');
          document.querySelector('#pcEligibilityBanner .btn').textContent = 'Edit Profile';
        }
      } else {
        eligBanner.style.display = 'none';
      }

      // Show recommend banner
      var recBanner = document.getElementById('pcRecommendBanner');
      if (data.needsHelp && data.needsHelp.length > 0) {
        recBanner.style.display = 'flex';
        document.getElementById('pcWeakSkills').textContent = data.needsHelp.map(function(n) { return n.skill + ' (' + n.score + '/10)'; }).join(', ');
      } else {
        recBanner.style.display = 'none';
      }

      // Setup coach profile form with verified skills
      setupCoachForm(data.canCoach, data.hasProfile, user.email);
    })
    .catch(function(err) { console.error('Eligibility check error:', err); });

  // Load coaches
  loadCoaches();

  // Load sessions
  loadSessions();

  // Setup star rating listeners
  setupStarRating();
}

function switchPCTab(tab) {
  document.querySelectorAll('.pc-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.pc-tab-content').forEach(function(c) { c.classList.remove('active'); });

  var tabBtn = document.querySelector('.pc-tab[data-pc-tab="' + tab + '"]');
  if (tabBtn) tabBtn.classList.add('active');

  var content = document.getElementById('pcTab' + tab.charAt(0).toUpperCase() + tab.slice(1).replace(/-([a-z])/g, function(m, c) { return c.toUpperCase(); }));
  if (!content) {
    // Try known IDs
    if (tab === 'discover') content = document.getElementById('pcTabDiscover');
    else if (tab === 'sessions') content = document.getElementById('pcTabSessions');
    else if (tab === 'become-coach') content = document.getElementById('pcTabBecomeCoach');
  }
  if (content) content.classList.add('active');
}

function showPCSection(section) {
  switchPCTab(section);
}

function setupCoachForm(canCoach, hasProfile, userId) {
  var verifiedEl = document.getElementById('pcVerifiedSkills');
  var checksEl = document.getElementById('pcCoachSkillChecks');
  var allSkills = ['Python', 'SQL', 'JavaScript', 'React', 'Machine Learning', 'Data Analysis', 'Statistics', 'Excel', 'Cloud Computing', 'Cybersecurity'];

  // Show verified skills (or a subtle note if none yet)
  if (!canCoach || canCoach.length === 0) {
    verifiedEl.innerHTML = '<p style="color:#94a3b8;font-size:13px;">No verified skills yet — score 8+ on an assessment to get a verified badge next to your skill.</p>';
  } else {
    verifiedEl.innerHTML = canCoach.map(function(c) {
      return '<span class="pc-verified-skill"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' +
        c.skill + ' <span class="score">' + c.score + '/10</span></span>';
    }).join('');
  }

  // Always show all skills as checkboxes; verified ones are pre-checked
  var verifiedSkills = (canCoach || []).map(function(c) { return c.skill; });
  checksEl.innerHTML = allSkills.map(function(skill) {
    var isVerified = verifiedSkills.indexOf(skill) !== -1;
    var badge = isVerified ? ' ✓' : '';
    return '<label class="pc-check-label"><input type="checkbox" value="' + skill + '"' + (isVerified ? ' checked' : '') + '> ' + skill + badge + '</label>';
  }).join('');

  // If has profile, load it
  if (hasProfile) {
    fetch('/api/peer-coaching/coach-profile?userId=' + encodeURIComponent(userId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.coach) {
          document.getElementById('pcHeadline').value = data.coach.headline || '';
          document.getElementById('pcBio').value = data.coach.bio || '';
          // Check appropriate session lengths
          var lengthCheckboxes = document.querySelectorAll('.pc-session-lengths input[type="checkbox"]');
          lengthCheckboxes.forEach(function(cb) {
            cb.checked = data.coach.sessionLengths && data.coach.sessionLengths.includes(parseInt(cb.value));
          });
          // Check appropriate skills
          var skillCheckboxes = checksEl.querySelectorAll('input[type="checkbox"]');
          skillCheckboxes.forEach(function(cb) {
            cb.checked = data.coach.skillsOffered && data.coach.skillsOffered.includes(cb.value);
          });
        }
      });
  }
}

function saveCoachProfile() {
  var user = getActiveUser() || {};
  if (!user.email) return;

  var selectedSkills = [];
  document.querySelectorAll('#pcCoachSkillChecks input[type="checkbox"]:checked').forEach(function(cb) {
    selectedSkills.push(cb.value);
  });

  var sessionLengths = [];
  document.querySelectorAll('.pc-session-lengths input[type="checkbox"]:checked').forEach(function(cb) {
    sessionLengths.push(parseInt(cb.value));
  });

  if (selectedSkills.length === 0) {
    showPCMsg('pcSetupMsg', 'Select at least one skill to coach.', '#dc2626');
    return;
  }

  fetch('/api/peer-coaching/coach-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: user.email,
      skillsOffered: selectedSkills,
      headline: document.getElementById('pcHeadline').value.trim(),
      bio: document.getElementById('pcBio').value.trim(),
      sessionLengths: sessionLengths
    })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        showPCMsg('pcSetupMsg', 'Coach profile saved! You\'re now visible to learners.', '#16a34a');
        loadCoaches();
      } else {
        showPCMsg('pcSetupMsg', data.error || 'Failed to save profile.', '#dc2626');
      }
    })
    .catch(function() { showPCMsg('pcSetupMsg', 'Network error. Try again.', '#dc2626'); });
}

function showPCMsg(id, msg, color) {
  var el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.style.color = color;
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 4000);
  }
}

function getPCCoachEmptyState(title, text) {
  return '<div class="pc-empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><h3>' + title + '</h3><p>' + text + '</p></div>';
}

var _pcCoachDataMap = {};

function renderPCCoachCard(coach) {
  _pcCoachDataMap[coach.userId] = coach;

  var skillTags = coach.verifiedSkills.map(function(v) {
    return '<span class="pc-coach-skill-tag">' + v.skill + ' <span class="pc-coach-skill-score">' + v.score + '/10</span></span>';
  }).join('');

  var stars = '';
  if (coach.avgRating > 0) {
    for (var i = 1; i <= 5; i++) {
      stars += '<span style="color:' + (i <= Math.round(coach.avgRating) ? '#f59e0b' : '#e2e8f0') + ';font-size:12px;">&#9733;</span>';
    }
    stars += ' <span style="font-size:11px;color:#64748b;">' + coach.avgRating + '</span>';
  }

  var safeId = coach.userId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  // JS-escape the name BEFORE injecting into onclick — escHtml does not escape
  // apostrophes, which would break the JS string literal for names like O'Brien.
  var safeNameJs = (coach.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return '<div class="pc-coach-card">' +
    '<div class="pc-coach-top">' +
      '<div class="pc-coach-avatar">' + coach.avatar + '</div>' +
      '<div>' +
        '<div class="pc-coach-name">' + escHtml(coach.name) + '</div>' +
        '<div class="pc-coach-headline">' + escHtml(coach.headline || 'Verified peer coach') + '</div>' +
        '<div class="pc-verified-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg> Verified</div>' +
      '</div>' +
    '</div>' +
    '<div class="pc-coach-skills">' + skillTags + '</div>' +
    (coach.bio ? '<div class="pc-coach-bio">' + escHtml(coach.bio) + '</div>' : '') +
    '<div class="pc-coach-stats">' +
      (coach.avgRating > 0 ? '<div class="pc-coach-stat">' + stars + '</div>' : '') +
      '<div class="pc-coach-stat"><strong>' + coach.sessionCount + '</strong> sessions</div>' +
      '<div class="pc-coach-stat">' + coach.sessionLengths.map(function(l) { return l + 'min'; }).join(', ') + '</div>' +
    '</div>' +
    '<div class="pc-coach-actions">' +
      '<button class="btn btn-secondary" onclick="openCoachProfile(\'' + safeId + '\')">View Profile</button>' +
      '<button class="btn btn-secondary" onclick="openInquiryChat(\'' + safeId + '\', \'' + safeNameJs + '\')">💬 Message</button>' +
      '<button class="btn btn-primary" onclick="openBookingModal(\'' + safeId + '\')">Book</button>' +
    '</div>' +
  '</div>';
}

function openCoachProfile(userId) {
  var coach = _pcCoachDataMap[userId];
  if (!coach) return;

  var stars = '';
  if (coach.avgRating > 0) {
    for (var i = 1; i <= 5; i++) {
      stars += '<span style="color:' + (i <= Math.round(coach.avgRating) ? '#f59e0b' : '#cbd5e1') + ';font-size:16px;">&#9733;</span>';
    }
    stars = '<div class="cp-rating">' + stars + ' <span class="cp-rating-num">' + coach.avgRating + ' (' + coach.reviewCount + ' reviews)</span></div>';
  }

  var skillBadges = coach.verifiedSkills.map(function(v) {
    return '<div class="cp-skill-badge"><span class="cp-skill-name">' + escHtml(v.skill) + '</span><span class="cp-skill-score">' + v.score + '/10</span></div>';
  }).join('');

  var html =
    '<div class="cp-header">' +
      '<div class="cp-avatar">' + coach.avatar + '</div>' +
      '<div class="cp-info">' +
        '<div class="cp-name">' + escHtml(coach.name) + '</div>' +
        '<div class="cp-headline">' + escHtml(coach.headline || 'Verified peer coach') + '</div>' +
        '<div class="cp-verified"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg> Verified Coach</div>' +
      '</div>' +
    '</div>' +
    (coach.bio ? '<p class="cp-bio">' + escHtml(coach.bio) + '</p>' : '') +
    '<div class="cp-section-title">Skills & Scores</div>' +
    '<div class="cp-skills">' + skillBadges + '</div>' +
    (stars || '') +
    '<div class="cp-meta-row">' +
      '<div class="cp-meta-item"><span class="cp-meta-val">' + coach.sessionCount + '</span><span class="cp-meta-lbl">Sessions</span></div>' +
      '<div class="cp-meta-item"><span class="cp-meta-val">' + coach.sessionLengths.map(function(l) { return l + 'min'; }).join(', ') + '</span><span class="cp-meta-lbl">Durations</span></div>' +
    '</div>';

  document.getElementById('coachProfileBody').innerHTML = html;
  var safeId = userId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  var safeName = (coach.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  document.getElementById('coachProfileBookBtn').setAttribute('onclick', "closeCoachProfile(); openBookingModal('" + safeId + "')");
  var msgBtn = document.getElementById('coachProfileMessageBtn');
  if (msgBtn) msgBtn.setAttribute('onclick', "closeCoachProfile(); openInquiryChat('" + safeId + "', '" + safeName + "')");
  document.getElementById('coachProfileModal').style.display = 'flex';
}

function closeCoachProfile(e) {
  if (e && e.target !== document.getElementById('coachProfileModal')) return;
  document.getElementById('coachProfileModal').style.display = 'none';
}

function renderPCCoachCards(coaches) {
  return coaches.map(renderPCCoachCard).join('');
}

function loadCoaches() {
  var user = getActiveUser() || {};
  var skill = document.getElementById('pcSkillFilter') ? document.getElementById('pcSkillFilter').value : '';
  var sort = document.getElementById('pcSortFilter') ? document.getElementById('pcSortFilter').value : 'match';
  var grid = document.getElementById('pcCoachesGrid');
  if (!grid) return;

  function loadGenericCoaches(noteHtml) {
    var url = '/api/peer-coaching/coaches?sort=' + (sort === 'match' ? 'score' : sort);
    if (skill) url += '&skill=' + encodeURIComponent(skill);
    if (user.email) url += '&userId=' + encodeURIComponent(user.email);

    return fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.coaches || data.coaches.length === 0) {
          grid.innerHTML = getPCCoachEmptyState('No coaches available yet', 'Be the first to become a verified peer coach!');
          return;
        }

        grid.innerHTML = (noteHtml || '') + renderPCCoachCards(data.coaches);
      });
  }

  if (sort === 'match' && user.email) {
    var recUrl = '/api/peer-coaching/recommendations?userId=' + encodeURIComponent(user.email);
    fetch(recUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var recommendationGroups = (data.recommendations || []).filter(function(group) {
          return !skill || group.skill === skill;
        }).filter(function(group) {
          return group.coaches && group.coaches.length > 0;
        });

        if (recommendationGroups.length === 0) {
          var fallbackNote = '<div style="grid-column:1/-1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;font-size:13px;color:#64748b;">' +
            'No weak-skill recommendations available for this filter yet. Showing all verified coaches instead.' +
          '</div>';
          return loadGenericCoaches(fallbackNote);
        }

        if (skill) {
          grid.innerHTML = renderPCCoachCards(recommendationGroups[0].coaches);
          return;
        }

        grid.innerHTML = recommendationGroups.map(function(group) {
          return '<div style="grid-column:1/-1;margin-bottom:8px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:0 2px;">' +
              '<div><strong style="font-size:15px;color:#1e293b;">Recommended for ' + escHtml(group.skill) + '</strong>' +
              '<div style="font-size:12px;color:#64748b;margin-top:2px;">Your latest score: ' + group.learnerScore + '/10</div></div>' +
              '<span style="font-size:11px;font-weight:600;color:#4f46e5;background:#eef2ff;padding:4px 10px;border-radius:999px;">Best Match</span>' +
            '</div>' +
            '<div class="pc-coaches-grid">' + renderPCCoachCards(group.coaches) + '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function(err) {
        console.error('Load recommendations error:', err);
        loadGenericCoaches();
      });
    return;
  }

  loadGenericCoaches().catch(function(err) { console.error('Load coaches error:', err); });
}

function openBookingModal(coachUserId) {
  fetch('/api/peer-coaching/coaches?sort=score')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var coach = data.coaches.find(function(c) { return c.userId === coachUserId; });
      if (!coach) return;

      document.getElementById('pcBookCoachName').textContent = coach.name;
      var skillSelect = document.getElementById('pcBookSkill');
      skillSelect.innerHTML = coach.skillsOffered.map(function(s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');

      var durSelect = document.getElementById('pcBookDuration');
      durSelect.innerHTML = coach.sessionLengths.map(function(l) { return '<option value="' + l + '">' + l + ' minutes</option>'; }).join('');

      // Set min date to tomorrow
      var tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      document.getElementById('pcBookTime').min = tomorrow.toISOString().slice(0, 16);

      document.getElementById('pcBookGoal').value = '';
      document.getElementById('pcBookTime').value = '';
      document.getElementById('pcBookingModal').style.display = 'flex';
      document.getElementById('pcBookingModal').dataset.coachId = coachUserId;
    });
}

function closePCModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('pcBookingModal').style.display = 'none';
}

function submitBooking() {
  var user = getActiveUser() || {};
  if (!user.email) return;

  var coachId = document.getElementById('pcBookingModal').dataset.coachId;
  var skill = document.getElementById('pcBookSkill').value;
  var duration = parseInt(document.getElementById('pcBookDuration').value);
  var scheduledAt = document.getElementById('pcBookTime').value;
  var goal = document.getElementById('pcBookGoal').value.trim();

  if (!scheduledAt) {
    showPCMsg('pcBookMsg', 'Please select a date and time.', '#dc2626');
    return;
  }

  fetch('/api/peer-coaching/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skill: skill,
      coachUserId: coachId,
      actorUserId: user.email,
      duration: duration,
      scheduledAt: scheduledAt,
      goal: goal
    })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        showPCMsg('pcBookMsg', 'Booking request sent! The coach will confirm shortly.', '#16a34a');
        setTimeout(function() {
          closePCModal();
          switchPCTab('sessions');
          loadSessions();
        }, 1500);
      } else {
        showPCMsg('pcBookMsg', data.error || 'Booking failed.', '#dc2626');
      }
    })
    .catch(function() { showPCMsg('pcBookMsg', 'Network error.', '#dc2626'); });
}

function loadSessions() {
  var user = getActiveUser() || {};
  if (!user.email) return;

  Promise.all([
    fetch('/api/peer-coaching/bookings?userId=' + encodeURIComponent(user.email)).then(function(r) { return r.json(); }),
    fetch('/api/chat/recent', { credentials: 'include' }).then(function(r) { return r.json(); }).catch(function() { return { items: [] }; })
  ])
    .then(function(results) {
      var data = results[0];
      var inquiryItems = (results[1].items || []).filter(function(it) { return it.kind === 'inquiry'; });
      var list = document.getElementById('pcSessionsList');
      var countBadge = document.getElementById('pcSessionCount');

      // Render inquiry threads at the top
      var inquiryHtml = '';
      if (inquiryItems.length > 0) {
        inquiryHtml = '<div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px;">Pre-booking conversations</div>' +
          inquiryItems.map(function(it) {
            var safeName = escHtml(it.otherPersonName || 'Coach');
            var preview = escHtml(it.preview || '');
            var when = it.lastMessageAt ? new Date(it.lastMessageAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
            return '<div class="pc-session-card">' +
              '<div class="pc-session-icon learning">💬</div>' +
              '<div class="pc-session-info">' +
                '<div class="pc-session-title">Inquiry — ' + safeName + '</div>' +
                '<div class="pc-session-meta">' + escHtml(when) + (preview ? ' · "' + preview + '"' : '') + '</div>' +
              '</div>' +
              '<span class="pc-session-status pending">inquiry</span>' +
              '<div class="pc-session-actions"><button class="btn btn-secondary btn-sm" onclick="openChatModal(\'' + it.bookingId.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\', \'' + safeName.replace(/'/g, "\\'") + '\')">💬 Open Chat</button></div>' +
            '</div>';
          }).join('') + (data.bookings && data.bookings.length > 0 ? '<div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;">Sessions</div>' : '');
      }

      if ((!data.bookings || data.bookings.length === 0) && inquiryItems.length === 0) {
        list.innerHTML = '<div class="pc-empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><h3>No sessions yet</h3><p>Book a coaching session, start a pre-booking conversation, or coach others to see activity here.</p></div>';
        countBadge.style.display = 'none';
        return;
      }
      if (!data.bookings || data.bookings.length === 0) {
        list.innerHTML = inquiryHtml;
        countBadge.style.display = 'none';
        return;
      }

      // Show badge count for pending
      var pendingCount = data.bookings.filter(function(b) { return b.status === 'pending' || b.status === 'confirmed'; }).length;
      if (pendingCount > 0) {
        countBadge.textContent = pendingCount;
        countBadge.style.display = 'inline-flex';
      } else {
        countBadge.style.display = 'none';
      }

      list.innerHTML = inquiryHtml + data.bookings.map(function(b) {
        var isCoach = b.role === 'coach';
        var iconClass = isCoach ? 'coaching' : 'learning';
        var iconEmoji = isCoach ? '🎓' : '📚';
        var otherPerson = isCoach ? b.learnerName : b.coachName;
        var roleLabel = isCoach ? 'Coaching' : 'Learning from';
        var dateStr = b.scheduledAt ? new Date(b.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'TBD';

        var actions = '';
        if (isCoach && b.status === 'pending') {
          actions = '<button class="btn btn-primary btn-sm" onclick="updateBookingStatus(\'' + b.id + '\', \'confirmed\')">Accept</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="updateBookingStatus(\'' + b.id + '\', \'cancelled\')">Decline</button>';
        } else if (isCoach && b.status === 'confirmed') {
          actions = '<button class="btn btn-primary btn-sm" onclick="updateBookingStatus(\'' + b.id + '\', \'completed\')">Mark Complete</button>';
        } else if (!isCoach && (b.status === 'pending' || b.status === 'confirmed')) {
          actions = '<button class="btn btn-secondary btn-sm" onclick="updateBookingStatus(\'' + b.id + '\', \'cancelled\')">Cancel Request</button>';
        } else if (b.status === 'completed' && !isCoach && !b.hasReview) {
          actions = '<button class="btn btn-primary btn-sm" onclick="openReviewModal(\'' + b.id + '\', \'' + b.coachUserId.replace(/'/g, "\\'") + '\')">Rate Session</button>';
        } else if (b.status === 'completed' && !isCoach && b.hasReview) {
          actions = '<span style="font-size:12px;font-weight:600;color:#16a34a;">Reviewed</span>';
        }

        var chatBtn = '<button class="btn btn-secondary btn-sm" onclick="openChatModal(\'' + b.id + '\', \'' + escHtml(otherPerson) + '\')">💬 Chat</button>';
        var allActions = (actions ? actions + ' ' : '') + chatBtn;

        return '<div class="pc-session-card">' +
          '<div class="pc-session-icon ' + iconClass + '">' + iconEmoji + '</div>' +
          '<div class="pc-session-info">' +
            '<div class="pc-session-title">' + escHtml(b.skill) + ' — ' + roleLabel + ' ' + escHtml(otherPerson) + '</div>' +
            '<div class="pc-session-meta">' + b.duration + ' min · ' + dateStr + (b.goal ? ' · ' + escHtml(b.goal) : '') + '</div>' +
          '</div>' +
          '<span class="pc-session-status ' + b.status + '">' + b.status + '</span>' +
          '<div class="pc-session-actions">' + allActions + '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function(err) { console.error('Load sessions error:', err); });
}

function updateBookingStatus(bookingId, status) {
  var user = getActiveUser() || {};
  if (!user.email) return;

  fetch('/api/peer-coaching/bookings/' + bookingId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: status, actorUserId: user.email })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        loadSessions();
      } else {
        alert(data.error || 'Failed to update session.');
      }
    })
    .catch(function() { alert('Network error. Please try again.'); });
}

function setupStarRating() {
  document.querySelectorAll('#pcStarRating .pc-star').forEach(function(star) {
    star.addEventListener('click', function() {
      pcStarValue = parseInt(this.dataset.val);
      document.querySelectorAll('#pcStarRating .pc-star').forEach(function(s) {
        s.classList.toggle('active', parseInt(s.dataset.val) <= pcStarValue);
      });
    });
    star.addEventListener('mouseenter', function() {
      var val = parseInt(this.dataset.val);
      document.querySelectorAll('#pcStarRating .pc-star').forEach(function(s) {
        s.classList.toggle('active', parseInt(s.dataset.val) <= val);
      });
    });
  });
  document.getElementById('pcStarRating').addEventListener('mouseleave', function() {
    document.querySelectorAll('#pcStarRating .pc-star').forEach(function(s) {
      s.classList.toggle('active', parseInt(s.dataset.val) <= pcStarValue);
    });
  });
}

function openReviewModal(bookingId, coachUserId) {
  pcCurrentReviewBooking = { bookingId: bookingId, coachUserId: coachUserId };
  pcStarValue = 0;
  document.querySelectorAll('#pcStarRating .pc-star').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('pcReviewFeedback').value = '';
  document.getElementById('pcReviewRecommend').checked = true;
  document.getElementById('pcReviewModal').style.display = 'flex';
}

function closePCReviewModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('pcReviewModal').style.display = 'none';
  pcCurrentReviewBooking = null;
}

function submitReview() {
  if (!pcCurrentReviewBooking) return;
  var user = getActiveUser() || {};
  if (!user.email) return;

  if (pcStarValue === 0) {
    alert('Please select a rating.');
    return;
  }

  fetch('/api/peer-coaching/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookingId: pcCurrentReviewBooking.bookingId,
      actorUserId: user.email,
      rating: pcStarValue,
      feedback: document.getElementById('pcReviewFeedback').value.trim(),
      wouldRecommend: document.getElementById('pcReviewRecommend').checked
    })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        closePCReviewModal();
        loadSessions();
        loadCoaches();
      } else {
        alert(data.error || 'Failed to submit review.');
      }
    })
    .catch(function() { alert('Network error. Please try again.'); });
}

// ── Peer Chat ──
var chatCurrentBookingId = null;
var chatPollInterval = null;

// Open a pre-booking inquiry chat with a coach. The synthetic bookingId
// pattern "inquiry__<coachId>__<learnerId>" lets the existing chat endpoints
// recognize this as a non-booking thread and skip the booking-row check.
function openInquiryChat(coachUserId, coachName) {
  var user = getActiveUser() || {};
  var learnerId = (user.email || '').toLowerCase().trim();
  var coachId = (coachUserId || '').toLowerCase().trim();
  if (!learnerId) { alert('Please log in to message a coach.'); return; }
  if (learnerId === coachId) { alert('You cannot message yourself.'); return; }
  var bookingId = 'inquiry__' + coachId + '__' + learnerId;
  openChatModal(bookingId, coachName, { isInquiry: true });
}

function openChatModal(bookingId, otherPersonName, opts) {
  opts = opts || {};
  var isInquiry = opts.isInquiry || (typeof bookingId === 'string' && bookingId.indexOf('inquiry__') === 0);
  chatCurrentBookingId = bookingId;
  document.getElementById('chatModalTitle').textContent = (isInquiry ? 'Ask ' : 'Chat with ') + otherPersonName;
  document.getElementById('chatModalSub').textContent = isInquiry
    ? 'Pre-booking conversation — ask questions before you book a session.'
    : 'Messages are saved to your session';
  document.getElementById('pcChatModal').style.display = 'flex';
  // Mark as read so notifications clear
  var lastRead = JSON.parse(localStorage.getItem('sgaChatLastRead') || '{}');
  lastRead[bookingId] = new Date().toISOString();
  localStorage.setItem('sgaChatLastRead', JSON.stringify(lastRead));
  loadChatMessages();
  chatPollInterval = setInterval(loadChatMessages, 5000);
}

function closeChatModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('pcChatModal').style.display = 'none';
  chatCurrentBookingId = null;
  if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
}

function loadChatMessages() {
  if (!chatCurrentBookingId) return;
  var user = getActiveUser() || {};
  fetch('/api/chat/' + chatCurrentBookingId)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var container = document.getElementById('chatMessages');
      if (!container) return;
      if (data.error) {
        container.innerHTML = '<div class="chat-empty" style="color:#dc2626;">' + data.error + '</div>';
        return;
      }
      if (!data.messages || data.messages.length === 0) {
        container.innerHTML = '<div class="chat-empty">No messages yet. Say hello!</div>';
        return;
      }
      var myId = (user.email || '').toLowerCase().trim();
      var html = data.messages.map(function(m) {
        var isMine = m.senderId === myId;
        var time = new Date(m.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return '<div class="chat-msg ' + (isMine ? 'mine' : 'theirs') + '">' +
          '<div class="chat-bubble">' + escHtml(m.content) + '</div>' +
          '<div class="chat-time">' + time + '</div>' +
        '</div>';
      }).join('');
      container.innerHTML = html;
      container.scrollTop = container.scrollHeight;
    })
    .catch(function(err) { console.error('Chat load error:', err); });
}

function sendChatMessage() {
  if (!chatCurrentBookingId) return;
  var input = document.getElementById('chatInput');
  var content = input ? input.value.trim() : '';
  if (!content) return;
  input.value = '';
  fetch('/api/chat/' + chatCurrentBookingId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content })
  })
    .then(function(r) { return r.json(); })
    .then(function() { loadChatMessages(); })
    .catch(function() { if (input) input.value = content; });
}
