/* ================================================
   ClassView 答題卡 — 主應用
   單頁式 Web App，使用 localStorage 儲存
   ================================================ */

'use strict';

/* ================================================
   1. 狀態管理
   ================================================ */
const STORAGE_KEY = 'classview_plickers_v1';
const SESSION_KEY = 'classview_pickers_session_v1'; // 當前登入 user id

const defaultState = {
  users: [],            // [{ id, username, passwordHash, displayName, isAdmin, createdAt }]
  currentUserId: null,  // 進行中登入嘅 user id
  folders: [],          // [{ id, ownerId, name, color, createdAt }]
  quizzes: [],          // [{ id, ownerId, folderId, title, questions, ... }]
  classes: [],          // [{ id, ownerId, name, createdAt }]
  students: [],         // [{ id, ownerId, classId, number, name, ... }]
  sessions: [],         // [{ id, ownerId, quizId, classId, answers, ... }]
  currentSession: null, // 進行中的 session 暫存
};

let state = loadState();

// 從獨立嘅 session key 讀取登入狀態
function loadSessionUserId() {
  try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; }
}
function saveSessionUserId(uid) {
  try {
    if (uid) localStorage.setItem(SESSION_KEY, uid);
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultState };
    const parsed = JSON.parse(raw);
    const merged = { ...defaultState, ...parsed };
    if (!merged.users) merged.users = [];
    if (!merged.folders) merged.folders = [];
    if (!merged.classes) merged.classes = [];
    if (!merged.sessions) merged.sessions = [];
    // 自動建 admin user 接管舊資料
    if (merged.users.length === 0 && (
        merged.classes.length > 0 || merged.students.length > 0 ||
        merged.quizzes.length > 0 || merged.sessions.length > 0)) {
      const adminId = 'admin-bootstrap';
      merged.users.push({
        id: adminId, username: 'admin', passwordHash: '',
        displayName: '👑 管理員（舊資料）', isAdmin: true, isBootstrap: true,
        createdAt: Date.now(),
      });
      (merged.classes || []).forEach(c => { if (!c.ownerId) c.ownerId = adminId; });
      (merged.students || []).forEach(s => { if (!s.ownerId) s.ownerId = adminId; });
      (merged.quizzes || []).forEach(q => { if (!q.ownerId) q.ownerId = adminId; });
      (merged.sessions || []).forEach(sess => { if (!sess.ownerId) sess.ownerId = adminId; });
    }
    (merged.students || []).forEach(s => {
      if (typeof s.classId === 'undefined') s.classId = null;
    });
    (merged.quizzes || []).forEach(q => {
      if (q.questions) {
        q.questions.forEach(qq => { if (!qq.type) qq.type = 'abcd'; });
      }
      if (typeof q.folderId === 'undefined') q.folderId = null;
    });
    if (merged.classes.length === 0 && merged.students.length > 0) {
      const adminId = merged.users[0]?.id || null;
      merged.classes.push({
        id: uid('cls'), ownerId: adminId, name: '未分班', createdAt: Date.now(),
      });
      const defaultCls = merged.classes[0].id;
      merged.students.forEach(s => { s.classId = defaultCls; });
    }
    // 確認登入狀態仍然有效
    const sessionUid = loadSessionUserId();
    if (sessionUid && !merged.users.find(u => u.id === sessionUid)) {
      saveSessionUserId(null);
      merged.currentUserId = null;
    } else if (sessionUid) {
      merged.currentUserId = sessionUid;
    } else {
      merged.currentUserId = null;
    }
    return merged;
  } catch (e) {
    console.error('Load state failed', e);
    return { ...defaultState };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Save state failed', e);
    toast('儲存失敗：' + e.message, 'error');
  }
}

function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ================================================
   1b. Auth (註冊 / 登入 / 登出)
   ⚠️ 純前端，無後端保護。密碼只係基本防呆用。
   ================================================ */

// 用 PBKDF2 雜湊密碼
async function hashPassword(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const saltBytes = enc.encode('classview-salt-v1');
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function currentUser() {
  if (!state.currentUserId) return null;
  return state.users.find(u => u.id === state.currentUserId) || null;
}

function isLoggedIn() {
  return !!currentUser();
}

function isAdmin() {
  const u = currentUser();
  return !!(u && u.isAdmin);
}

async function registerUser(username, password, displayName) {
  username = (username || '').trim();
  displayName = (displayName || '').trim() || username;
  if (!username) return { ok: false, msg: '請輸入用戶名' };
  if (username.length < 2) return { ok: false, msg: '用戶名至少 2 個字' };
  if (!password || password.length < 4) return { ok: false, msg: '密碼至少 4 個字' };
  if (state.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, msg: '用戶名已被使用' };
  }
  const isFirst = state.users.length === 0;
  const passwordHash = await hashPassword(password);
  const user = {
    id: uid('u'), username, passwordHash, displayName,
    isAdmin: isFirst, createdAt: Date.now(),
  };
  state.users.push(user);
  state.currentUserId = user.id;
  saveSessionUserId(user.id);
  saveState();
  return { ok: true, user };
}

async function loginUser(username, password) {
  username = (username || '').trim();
  if (!username || !password) return { ok: false, msg: '請輸入用戶名同密碼' };
  const user = state.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return { ok: false, msg: '用戶名或密碼錯誤' };
  if (user.isBootstrap && state.users.length > 1) {
    return { ok: false, msg: '請先註冊帳號再用戶名登入' };
  }
  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.passwordHash) {
    return { ok: false, msg: '用戶名或密碼錯誤' };
  }
  state.currentUserId = user.id;
  saveSessionUserId(user.id);
  saveState();
  return { ok: true, user };
}

function logoutUser() {
  state.currentUserId = null;
  saveSessionUserId(null);
  if (state.currentSession) { state.currentSession = null; saveState(); }
}

/* ================================================
   1c. 過濾 helpers (per-user visibility)
   ================================================ */
function myQuizzes() {
  const u = currentUser();
  if (!u) return [];
  if (u.isAdmin) return state.quizzes;
  return myQuizzes().filter(q => q.ownerId === u.id);
}

function myFolders() {
  const u = currentUser();
  if (!u) return [];
  return state.folders.filter(f => f.ownerId === u.id);
}

function visibleStudents() {
  const u = currentUser();
  if (!u) return [];
  if (u.isAdmin) return state.students;
  const adminIds = state.users.filter(x => x.isAdmin).map(x => x.id);
  return visibleStudents().filter(s =>
    s.ownerId === u.id || (s.ownerId && adminIds.includes(s.ownerId))
  );
}

function visibleClasses() {
  const u = currentUser();
  if (!u) return [];
  if (u.isAdmin) return state.classes;
  const adminIds = state.users.filter(x => x.isAdmin).map(x => x.id);
  return visibleClasses().filter(c =>
    c.ownerId === u.id || (c.ownerId && adminIds.includes(c.ownerId))
  );
}

function visibleSessions() {
  const u = currentUser();
  if (!u) return [];
  if (u.isAdmin) return state.sessions;
  return visibleSessions().filter(s => s.ownerId === u.id);
}

/* ================================================
   2. Toast 通知
   ================================================ */
let toastTimer = null;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

/* ================================================
   3. Modal 工具
   ================================================ */
function openModal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
    <div class="modal-content" onclick="event.stopPropagation()">${html}</div>
  </div>`;
}
function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}
window.closeModal = closeModal;

/* ================================================
   4. 導航 + View 切換
   ================================================ */
let currentView = 'home';

function setView(view, params = {}) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  const main = document.getElementById('app');
  // 鏡頭用固定 widget，不再被 view 切換影響
  // 用戶可以喺任何 view 都見到鏡頭
  // 只有 stopScanner() 先會停
  const renderer = views[view];
  if (renderer) {
    main.innerHTML = renderer(params);
    if (views[view + '_after']) views[view + '_after'](params);
  } else {
    main.innerHTML = '<div class="empty"><div class="empty-icon">❓</div><div class="empty-title">找不到頁面</div></div>';
  }
  // 任何 view 切換之後，自動 sync 鏡頭 button state
  // 防止 re-render 將 startCamBtn/stopCamBtn 嘅 display 重置
  // 令 user 見到「鏡頭關咗」嘅錯覺
  syncScannerButtons();
  window.scrollTo(0, 0);
}

// 統一 sync 鏡頭相關 UI（按掃描狀態顯示對應按鈕 / widget）
function syncScannerButtons() {
  const scanning = !!(liveState && liveState.scanning);
  const startBtn = document.getElementById('startCamBtn');
  const stopBtn = document.getElementById('stopCamBtn');
  const widget = document.getElementById('camera-widget');
  const status = document.getElementById('scannerStatus');
  if (scanning) {
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = '';
    if (widget) widget.style.display = 'block';
    if (status) status.textContent = '📷 掃描中…';
  } else {
    if (startBtn) startBtn.style.display = '';
    if (stopBtn) stopBtn.style.display = 'none';
    if (widget) widget.style.display = 'none';
    if (status) status.textContent = '鏡頭未啟動';
  }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

/* ================================================
   5. Views
   ================================================ */
const views = {};

/* ---------- Login / Register ---------- */
views.login = () => {
  const isFirstUser = state.users.length === 0;
  return `
    <div style="max-width: 480px; margin: 40px auto;">
      <h2 class="view-title" style="text-align: center;">${isFirstUser ? '🎉 歡迎使用 ClassView' : '🔐 登入'}</h2>
      ${isFirstUser
        ? `<p class="view-subtitle" style="text-align: center;">第一個註冊嘅用戶會自動成為 👑 管理員</p>`
        : `<p class="view-subtitle" style="text-align: center;">用你嘅老師帳號登入</p>`}
      <div class="card">
        <div class="form-group">
          <label class="form-label">用戶名</label>
          <input type="text" id="loginUsername" class="form-input" placeholder="例：keith, mrchan" autofocus>
        </div>
        <div class="form-group">
          <label class="form-label">密碼</label>
          <input type="password" id="loginPassword" class="form-input" placeholder="至少 4 個字">
        </div>
        <div class="form-group" id="registerDisplayNameGroup" style="display: none;">
          <label class="form-label">顯示名稱</label>
          <input type="text" id="registerDisplayName" class="form-input" placeholder="例：陳老師、Mr. Chan">
        </div>
        <div id="loginError" class="text-muted" style="color: var(--c-danger); margin-bottom: 8px; min-height: 18px;"></div>
        <button class="btn btn-primary btn-lg btn-block" id="loginSubmitBtn" onclick="doLogin()">🚀 ${isFirstUser ? '建立管理員帳號並登入' : '登入'}</button>
        ${!isFirstUser ? `<button class="btn btn-ghost btn-block mt-2" onclick="toggleRegisterMode()">📝 註冊新帳號</button>` : ''}
        <div class="text-muted text-sm" style="text-align: center; margin-top: 16px;">
          ⚠️ 純前端儲存，密碼只係防呆用。所有用戶共用同一台裝置嘅 localStorage。
        </div>
      </div>
    </div>
  `;
};

window.doLogin = async function() {
  const username = document.getElementById('loginUsername')?.value;
  const password = document.getElementById('loginPassword')?.value;
  const displayName = document.getElementById('registerDisplayName')?.value;
  const errEl = document.getElementById('loginError');
  const isRegister = document.getElementById('registerDisplayNameGroup')?.style.display !== 'none';
  if (errEl) errEl.textContent = '';
  const result = isRegister
    ? await registerUser(username, password, displayName)
    : await loginUser(username, password);
  if (!result.ok) {
    if (errEl) errEl.textContent = '❌ ' + result.msg;
    return;
  }
  toast(`歡迎，${result.user.displayName}！`, 'success');
  renderUserButton();
  setView('home');
};

window.toggleRegisterMode = function() {
  const group = document.getElementById('registerDisplayNameGroup');
  if (!group) return;
  const isShowing = group.style.display !== 'none';
  group.style.display = isShowing ? 'none' : '';
  const btn = document.getElementById('loginSubmitBtn');
  if (btn) btn.textContent = isShowing ? '🚀 登入' : '🚀 註冊並登入';
};

function renderUserButton() {
  const u = currentUser();
  const nav = document.getElementById('mainNav');
  if (!nav) return;
  const old = document.getElementById('userNavBtn');
  if (old) old.remove();
  if (!u) return;
  const btn = document.createElement('button');
  btn.id = 'userNavBtn';
  btn.className = 'nav-btn';
  btn.style.cssText = 'background: ' + (u.isAdmin ? '#fbbf24' : '#60a5fa') + '; color: #1a1a1a; font-weight: 700;';
  btn.innerHTML = `${u.isAdmin ? '👑' : '👤'} ${escapeHtml(u.displayName)} ▾`;
  btn.onclick = () => showUserMenu();
  nav.appendChild(btn);
}

function showUserMenu() {
  const u = currentUser();
  if (!u) return;
  openModal(`
    <div class="modal-header">
      <div class="modal-title">${u.isAdmin ? '👑' : '👤'} ${escapeHtml(u.displayName)}</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <div class="text-muted text-sm">用戶名</div>
      <div style="font-size: 18px; font-weight: 700;">${escapeHtml(u.username)}</div>
    </div>
    <div class="form-group">
      <div class="text-muted text-sm">角色</div>
      <div>${u.isAdmin ? '👑 管理員' : '👨‍🏫 老師'}</div>
    </div>
    ${u.isAdmin ? `
    <div class="form-group">
      <div class="text-muted text-sm">管理員專屬</div>
      <div class="row" style="gap: 6px; flex-wrap: wrap;">
        <button class="btn btn-ghost btn-sm" onclick="closeModal(); setView('classes');">🏫 管理所有班級</button>
        <button class="btn btn-ghost btn-sm" onclick="closeModal(); setView('students');">👨‍🎓 管理所有學生</button>
      </div>
      <div class="form-hint">管理員加入嘅學生/班級會自動共享俾所有老師用</div>
    </div>
    ` : ''}
    <div class="row-end mt-2">
      <button class="btn btn-ghost" onclick="closeModal()">關閉</button>
      <button class="btn btn-danger" onclick="doLogout()">🚪 登出</button>
    </div>
  `);
}

window.doLogout = function() {
  if (!confirm('確定登出？')) return;
  logoutUser();
  closeModal();
  toast('已登出', 'success');
  renderUserButton();
  setView('login');
};

/* ---------- Home ---------- */
views.home = () => `
  <h2 class="view-title">👋 歡迎使用 ClassView 答題卡</h2>
  <p class="view-subtitle">為課堂答題而生 — 簡單、清晰、即時</p>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-num">${myQuizzes().length}</div>
      <div class="stat-label">📝 題目庫</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${visibleClasses().length}</div>
      <div class="stat-label">🏫 班級</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${visibleStudents().length}</div>
      <div class="stat-label">👨‍🎓 已加入學生</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${visibleSessions().length}</div>
      <div class="stat-label">📊 已完成答題</div>
    </div>
  </div>

  <div class="card">
    <div class="card-title mb-2">🚀 開始使用</div>
    <p class="text-muted mb-2">建議步驟：</p>
    <ol style="padding-left: 24px; line-height: 2; font-size: 18px;">
      <li><b>建立題目</b> — 點上方「📝 題目」，加入選擇題（每題 4 個選項）</li>
      <li><b>加入學生</b> — 點「👨‍🎓 學生」，輸入學生姓名（自動產生 QR code）</li>
      <li><b>列印紙卡</b> — 點「🖨️ 紙卡」，下載 PDF 或直接列印</li>
      <li><b>開始答題</b> — 派紙卡給學生，點「▶️ 答題」開始掃描</li>
      <li><b>查看結果</b> — 點「📊 結果」查看每位學生成績</li>
    </ol>
    <div class="row-end mt-2">
      <button class="btn btn-ghost" onclick="loadDemoData()">🎁 載入範例資料試玩</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title mb-2">💡 紙卡使用方式</div>
    <div class="row" style="gap: 24px; align-items: flex-start; flex-wrap: wrap;">
      <div style="flex: 1; min-width: 260px;">
        <p>每個學生有 <b>6 張卡</b>：每個答案 1 張</p>
        <p style="margin-top: 8px;"><b>🅰️ 4 選 1 題用（A/B/C/D）</b>：</p>
        <ul style="padding-left: 24px; line-height: 2; margin-top: 4px;">
          <li>🔴 <b style="color:#ef4444">A 紅色</b> · 🔵 <b style="color:#3b82f6">B 藍色</b></li>
          <li>🟢 <b style="color:#22c55e">C 綠色</b> · 🟡 <b style="color:#eab308">D 黃色</b></li>
        </ul>
        <p class="mt-2"><b>✓/✗ 是非題用</b>：</p>
        <ul style="padding-left: 24px; line-height: 2; margin-top: 4px;">
          <li>✅ <b style="color:#16a34a">✓</b>（綠色）· ❌ <b style="color:#dc2626">✗</b>（紅色）</li>
        </ul>
        <p class="mt-2">每張卡 <b>上半 = QR code</b>（老師掃描），<b>下半 = 學生名 + 答案類型</b>。</p>
        <p class="mt-1">列印後 <b>剪開 + 對摺</b>，QR 同一面、姓名同一面。學生 <b>舉起</b> 揀嘅卡就 OK。</p>
        <p class="mt-1">老師用鏡頭掃 QR → 自動識別學生同答案，唔使逐個輸入。</p>
      </div>
    </div>
  </div>
`;

/* ---------- Quizzes (List + Edit) ---------- */
views.quizzes = () => {
  const quizList = myQuizzes().map(q => `
    <div class="card">
      <div class="row-between">
        <div>
          <div class="card-title">${escapeHtml(q.title)}</div>
          <div class="text-muted text-sm">${q.questions.length} 題 · 建立於 ${formatDate(q.createdAt)}</div>
        </div>
        <div class="row">
          <button class="btn btn-ghost btn-sm" onclick="editQuiz('${q.id}')">✏️ 編輯</button>
          <button class="btn btn-primary btn-sm" onclick="startLive('${q.id}')">▶️ 開始答題</button>
          <button class="btn btn-danger btn-sm" onclick="deleteQuiz('${q.id}')">🗑️ 刪除</button>
        </div>
      </div>
    </div>
  `).join('');

  return `
    <div class="row-between mb-2">
      <div>
        <h2 class="view-title">📝 題目庫</h2>
        <p class="view-subtitle">建立選擇題，每題 4 個選項（A / B / C / D）</p>
      </div>
      <button class="btn btn-primary btn-lg" onclick="newQuiz()">➕ 新增題目</button>
    </div>
    ${myQuizzes().length === 0
      ? `<div class="empty"><div class="empty-icon">📝</div><div class="empty-title">還沒有題目</div><p>點「新增題目」開始建立</p></div>`
      : quizList
    }
  `;
};

/* ---------- Students ---------- */
views.students = (params = {}) => {
  const filterClass = params.filterClass || 'all';
  const filtered = filterClass === 'all'
    ? state.students
    : visibleStudents().filter(s => s.classId === filterClass);
  const grid = filtered.map(s => {
    const cls = visibleClasses().find(c => c.id === s.classId);
    return `
    <div class="student-card">
      <div class="avatar">${escapeHtml((s.name || '?').slice(0, 1))}</div>
      <div class="name">${escapeHtml(s.name)}</div>
      <div class="id">#${s.number} · ${escapeHtml(cls?.name || '未分班')}</div>
      <div class="row" style="justify-content: center; margin-top: 10px; gap: 6px;">
        <button class="btn btn-ghost btn-sm" onclick="editStudent('${s.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteStudent('${s.id}')">🗑️</button>
      </div>
    </div>
  `;
  }).join('');

  const filterHtml = visibleClasses().length > 0 ? `
    <div class="row" style="gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
      <button class="btn ${filterClass === 'all' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="setView('students', {filterClass:'all'})">全部 (${visibleStudents().length})</button>
      ${visibleClasses().map(c => {
        const cnt = visibleStudents().filter(s => s.classId === c.id).length;
        return `<button class="btn ${filterClass === c.id ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="setView('students', {filterClass:'${c.id}'})">${escapeHtml(c.name)} (${cnt})</button>`;
      }).join('')}
    </div>
  ` : '';

  return `
    <div class="row-between mb-2">
      <div>
        <h2 class="view-title">👨‍🎓 學生名單</h2>
        <p class="view-subtitle">每個學生會自動產生專屬 QR code 紙卡</p>
      </div>
      <div class="row">
        <button class="btn btn-ghost" onclick="importStudentsExcel()">📥 EXCEL 匯入</button>
        <button class="btn btn-ghost" onclick="bulkAddStudents()">📋 批次加入</button>
        <button class="btn btn-primary btn-lg" onclick="newStudent()">➕ 新增學生</button>
      </div>
    </div>
    ${filterHtml}
    ${visibleClasses().length === 0 ? `<div class="card" style="background: #fef3c7; border-left: 4px solid #f59e0b; margin-bottom: 12px;">
      <div>⚠️ 暫無班級。新增學生前請先去 <a href="#" onclick="setView('classes'); return false;" style="color: var(--c-primary); text-decoration: underline;">「班級」</a> 頁面建立班級，或者用 <b>EXCEL 匯入</b> 一次過搞掂（含班級資料）。</div>
    </div>` : ''}
    ${filtered.length === 0
      ? `<div class="empty"><div class="empty-icon">👨‍🎓</div><div class="empty-title">${filterClass === 'all' ? '還沒有學生' : '呢個班冇學生'}</div><p>${filterClass === 'all' ? '點「新增學生」開始，或者用 EXCEL 匯入' : '切換其他班或加入學生'}</p></div>`
      : `<div class="student-grid">${grid}</div>`
    }
  `;
};

/* ---------- Classes ---------- */
views.classes = () => {
  const list = visibleClasses().map(c => {
    const studentCount = visibleStudents().filter(s => s.classId === c.id).length;
    return `
      <div class="card">
        <div class="row-between" style="flex-wrap: wrap; gap: 12px;">
          <div style="flex: 1; min-width: 200px;">
            <div class="card-title">🏫 ${escapeHtml(c.name)}</div>
            <div class="text-muted text-sm">${studentCount} 位學生 · 建立於 ${formatDate(c.createdAt)}</div>
          </div>
          <div class="row" style="gap: 6px;">
            <button class="btn btn-ghost btn-sm" onclick="editClass('${c.id}')">✏️ 改名</button>
            <button class="btn btn-danger btn-sm" onclick="deleteClass('${c.id}')" ${studentCount > 0 ? 'disabled title="請先將學生移到其他班"' : ''}>🗑️ 刪除</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="row-between mb-2">
      <div>
        <h2 class="view-title">🏫 班級管理</h2>
        <p class="view-subtitle">按班級分組學生，方便分批答題同匯出報告</p>
      </div>
      <button class="btn btn-primary btn-lg" onclick="newClass()">➕ 新增班級</button>
    </div>
    ${visibleClasses().length === 0
      ? `<div class="empty"><div class="empty-icon">🏫</div><div class="empty-title">還沒有班級</div><p>先建立班級，例如：3A、4B、晨曦組</p>
         <button class="btn btn-primary mt-2" onclick="newClass()">➕ 新增第一個班級</button>
         </div>`
      : list
    }
  `;
};

/* ---------- Cards (Print) ---------- */
views.cards = () => {
  if (visibleStudents().length === 0) {
    return `
      <h2 class="view-title">🖨️ 紙卡列印</h2>
      <div class="empty"><div class="empty-icon">🖨️</div><div class="empty-title">先加入學生</div><p>到「學生」頁面加入學生後，就可以列印紙卡</p></div>
    `;
  }

  return `
    <div class="row-between mb-2 no-print">
      <div>
        <h2 class="view-title">🖨️ 紙卡列印</h2>
        <p class="view-subtitle">每位學生 <b>6 張卡</b>（A / B / C / D / ✓ / ✗）· 每頁 2 位學生（12 張卡）</p>
      </div>
      <div class="row">
        <button class="btn btn-ghost" onclick="setView('students')">← 返回</button>
        <button class="btn btn-ghost btn-lg" onclick="exportCardsPDF()">📥 匯出 PDF</button>
        <button class="btn btn-primary btn-lg" onclick="window.print()">🖨️ 列印</button>
      </div>
    </div>

    <div class="cards-page">
      <div class="cards-grid" id="cardsGrid"></div>
    </div>
  `;
};

// 答案類型定義
const ANSWER_TYPES = [
  { id: 'A', text: 'A', color: 'red',   abcd: true,  display: 'A' },
  { id: 'B', text: 'B', color: 'blue',  abcd: true,  display: 'B' },
  { id: 'C', text: 'C', color: 'green', abcd: true,  display: 'C' },
  { id: 'D', text: 'D', color: 'yellow',abcd: true,  display: 'D' },
  { id: 'T', text: '✓', color: 'green', abcd: false, display: '✓' },
  { id: 'F', text: '✗', color: 'red',   abcd: false, display: '✗' },
];

views.cards_after = () => {
  const grid = document.getElementById('cardsGrid');
  if (!grid) return;

  // 每個學生 6 張卡
  visibleStudents().forEach(student => {
    const fullName = student.name || '';
    const num = student.number;

    ANSWER_TYPES.forEach(ans => {
      const cell = document.createElement('div');
      cell.className = `paper-cell paper-cell-${ans.id}`;
      cell.dataset.studentId = student.id;
      cell.dataset.answer = ans.id;
      cell.innerHTML = `
        <div class="paper-cell-front">
          <div class="pc-front-label">📷 正面</div>
          <div class="pc-qr" id="qr-${student.id}-${ans.id}"></div>
          <div class="pc-front-type pc-type-${ans.id}">${ans.text}</div>
        </div>
        <div class="paper-cell-fold">
          <span>✂ 剪開</span>
          <span>↕ 對摺</span>
        </div>
        <div class="paper-cell-back pc-back-${ans.id}">
          <div class="pc-back-name">${escapeHtml(fullName)}</div>
          <div class="pc-back-num">#${num}</div>
          <div class="pc-back-type pc-type-${ans.id}">${ans.display}</div>
        </div>
      `;
      grid.appendChild(cell);

      // 產生 QR code
      const qrTarget = document.getElementById(`qr-${student.id}-${ans.id}`);
      if (qrTarget) {
        try {
          new QRCode(qrTarget, {
            text: `P:${student.id}:${ans.id}`,
            width: 160, height: 160,
            colorDark: '#000000', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M,
          });
        } catch (e) { console.error('QR 失敗', e); qrTarget.textContent = '⚠️'; }
      }
    });
  });
};

/* ---------- Live Mode ---------- */
views.live = (params) => {
  if (myQuizzes().length === 0) {
    return `
      <h2 class="view-title">▶️ 答題模式</h2>
      <div class="empty"><div class="empty-icon">📝</div><div class="empty-title">先建立題目</div><p>到「題目」頁面建立題目後就可以開始</p></div>
    `;
  }

  // 選擇 quiz
  if (!state.currentSession) {
    return `
      <h2 class="view-title">▶️ 開始答題</h2>
      <p class="view-subtitle">選擇一份題目開始</p>
      <div class="card">
        <div class="form-group">
          <label class="form-label">選擇題目</label>
          <select id="liveQuizSelect" class="form-select">
            ${myQuizzes().map(q => `<option value="${q.id}">${escapeHtml(q.title)} (${q.questions.length} 題)</option>`).join('')}
          </select>
        </div>
        ${visibleClasses().length > 0 ? `
        <div class="form-group">
          <label class="form-label">參與班級</label>
          <select id="liveClassSelect" class="form-select">
            <option value="all">全部班級 (${visibleStudents().length} 位)</option>
            ${visibleClasses().map(c => {
              const cnt = visibleStudents().filter(s => s.classId === c.id).length;
              return `<option value="${c.id}">${escapeHtml(c.name)} (${cnt} 位)</option>`;
            }).join('')}
          </select>
          <div class="form-hint">可以揀特定班（例如淨係畀 3A 答），或者全部一齊答</div>
        </div>
        ` : ''}
        <div class="form-group">
          <label class="form-label">答題模式</label>
          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            <label style="flex: 1; min-width: 200px; padding: 16px; border: 2px solid var(--c-primary); border-radius: var(--radius); cursor: pointer;">
              <input type="radio" name="liveMode" value="scan" checked style="margin-right: 8px;">
              <b>📷 掃描模式</b>
              <div class="text-muted text-sm">用鏡頭掃學生 QR code 紙卡</div>
            </label>
            <label style="flex: 1; min-width: 200px; padding: 16px; border: 2px solid var(--c-border); border-radius: var(--radius); cursor: pointer;">
              <input type="radio" name="liveMode" value="manual" style="margin-right: 8px;">
              <b>🖱️ 手動模式</b>
              <div class="text-muted text-sm">直接點選每位學生的答案</div>
            </label>
          </div>
        </div>
        <button class="btn btn-primary btn-lg btn-block" onclick="startLiveSession()">🚀 開始</button>
      </div>
    `;
  }

  // 進行中
  return renderLiveStage();
};

/* ---------- Results ---------- */
views.results = () => {
  if (visibleSessions().length === 0) {
    return `
      <h2 class="view-title">📊 答題結果</h2>
      <div class="empty"><div class="empty-icon">📊</div><div class="empty-title">還沒有答題紀錄</div><p>完成一次答題後會顯示在這裡</p></div>
    `;
  }

  // 鏡頭狀態
  const cameraOn = liveState && liveState.scanning;
  const cameraStatus = cameraOn
    ? `<div class="card no-print" style="background: #d1fae5; border-left: 6px solid var(--c-success);">
         <div class="row-between" style="flex-wrap: wrap; gap: 8px;">
           <div><b style="color: var(--c-success);">📷 鏡頭開啟中</b> · 可即場補掃學生紙卡（右下角浮動視窗）</div>
           <div class="row">
             <button class="btn btn-primary btn-sm" onclick="restartScannerForReview()">🔄 補掃模式</button>
             <button class="btn btn-ghost btn-sm" onclick="stopScanner()">⏹ 停止鏡頭</button>
           </div>
         </div>
       </div>`
    : `<div class="card no-print" style="background: #f3f4f6; border-left: 6px solid #6b7280;">
         <div class="row-between">
           <div><b>📷 鏡頭未啟動</b> · 可啟動補掃學生紙卡</div>
           <button class="btn btn-primary btn-sm" onclick="startScanner()">▶️ 啟動鏡頭</button>
         </div>
       </div>`;

  // 顯示每個 session 嘅 summary
  const list = visibleSessions().slice().reverse().map(s => {
    const quiz = myQuizzes().find(q => q.id === s.quizId);
    const clsId = s.classId || 'all';
    const sessStudents = (clsId === 'all' || !clsId)
      ? state.students
      : visibleStudents().filter(stu => stu.classId === clsId);
    const sessClassName = clsId === 'all' ? '全部' : className(clsId);
    const answered = Object.keys(s.answers || {}).length;
    const totalStudents = sessStudents.length;
    const correct = quiz ? sessStudents.reduce((sum, stu) => {
      return sum + quiz.questions.filter(q => s.answers[stu.id]?.[q.id] === q.correct).length;
    }, 0) : 0;
    const totalQ = quiz ? quiz.questions.length * sessStudents.length : 0;
    const acc = totalQ > 0 ? Math.round((correct / totalQ) * 100) : 0;
    return `
      <div class="card">
        <div class="row-between" style="flex-wrap: wrap; gap: 12px;">
          <div style="flex: 1; min-width: 200px;">
            <div class="card-title">${escapeHtml(quiz?.title || '已刪除題目')}</div>
            <div class="text-muted text-sm">${formatDate(s.startedAt)} · 🏫 ${escapeHtml(sessClassName)} · 收到 ${answered}/${totalStudents} 份</div>
          </div>
          <div class="row" style="gap: 16px;">
            <div class="text-center">
              <div style="font-size: 24px; font-weight: 800; color: var(--c-success);">${correct}</div>
              <div class="text-muted text-sm">答對</div>
            </div>
            <div class="text-center">
              <div style="font-size: 24px; font-weight: 800; color: var(--c-primary);">${acc}%</div>
              <div class="text-muted text-sm">正確率</div>
            </div>
          </div>
        </div>
        <div class="row-end mt-2" style="gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-ghost btn-sm" onclick="exportSession('${s.id}')">📄 CSV</button>
          <button class="btn btn-ghost btn-sm" onclick="exportSessionExcel('${s.id}')">📊 EXCEL</button>
          <button class="btn btn-warning btn-sm" onclick="exportSessionPDF('${s.id}')">📑 PDF 報告</button>
          <button class="btn btn-primary btn-sm" onclick="viewSessionDetail('${s.id}')">📊 詳細報告</button>
          <button class="btn btn-danger btn-sm" onclick="deleteSession('${s.id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <h2 class="view-title">📊 答題結果</h2>
    <p class="view-subtitle">查看每位學生的作答記錄 · 可匯出 CSV / EXCEL / PDF 報告</p>
    ${cameraStatus}
    ${list}
  `;
};

/* ================================================
   6. Quiz CRUD
   ================================================ */
function newQuiz() {
  openModal(`
    <div class="modal-header">
      <div class="modal-title">➕ 新增題目</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label">題目名稱</label>
      <input type="text" id="quizTitle" class="form-input" placeholder="例：一年級數學測驗" autofocus>
      <div class="form-hint">之後可以加入多條題目</div>
    </div>
    <div class="row-end">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="confirmNewQuiz()">建立並加入題目 →</button>
    </div>
  `);
  setTimeout(() => document.getElementById('quizTitle')?.focus(), 100);
}

function confirmNewQuiz() {
  const title = document.getElementById('quizTitle').value.trim();
  if (!title) { toast('請輸入題目名稱', 'error'); return; }
  const quiz = {
    id: uid('q'),
    ownerId: currentUser()?.id || null,
    title,
    folderId: null,
    questions: [createEmptyQuestion()],
    createdAt: Date.now(),
  };
  state.quizzes.push(quiz);
  saveState();
  closeModal();
  setView('quizzes');
  setTimeout(() => editQuiz(quiz.id), 100);
}

function createEmptyQuestion(type = 'abcd') {
  if (type === 'tf') {
    return {
      id: uid('qq'),
      type: 'tf',
      text: '',
      options: [
        { id: 'T', text: '✓ 對' },
        { id: 'F', text: '✗ 錯' },
      ],
      correct: null,
    };
  }
  return {
    id: uid('qq'),
    type: 'abcd',
    text: '',
    options: [
      { id: 'A', text: '' },
      { id: 'B', text: '' },
      { id: 'C', text: '' },
      { id: 'D', text: '' },
    ],
    correct: null,
  };
}

function editQuiz(quizId) {
  const quiz = myQuizzes().find(q => q.id === quizId);
  if (!quiz) return;

  const questionsHtml = quiz.questions.map((q, idx) => renderQuestionEditor(q, idx)).join('');

  openModal(`
    <div class="modal-header">
      <div class="modal-title">✏️ 編輯題目</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label">題目名稱</label>
      <input type="text" id="quizTitle" class="form-input" value="${escapeAttr(quiz.title)}">
    </div>
    <div class="form-group">
      <label class="form-label">題目內容（${quiz.questions.length} 題）</label>
      <div class="question-list" id="questionList">${questionsHtml}</div>
    </div>
    <div class="row-between">
      <button class="btn btn-ghost" onclick="addQuestion('${quizId}')">➕ 加題目</button>
      <div class="row">
        <button class="btn btn-ghost" onclick="closeModal()">取消</button>
        <button class="btn btn-success" onclick="saveQuizEdit('${quizId}')">💾 儲存</button>
      </div>
    </div>
  `);
}

function renderQuestionEditor(q, idx) {
  const isTf = q.type === 'tf';
  const typeLabel = isTf ? '✓/✗ 二選一' : 'A/B/C/D 四選一';
  const typeBadge = isTf ? '🟢✓ ✗' : '🅰️🅱️🅲️🅳️';

  return `
    <div class="question-item" data-qid="${q.id}" data-type="${q.type}">
      <div class="q-num">${idx + 1}</div>
      <div class="row-between mb-1">
        <div class="q-type-badge ${q.type}">${typeBadge} ${typeLabel}</div>
        <div class="row" style="gap: 4px;">
          <button class="btn btn-ghost btn-sm" onclick="changeQuestionType('${q.id}')" title="切換題型">🔄 切換題型</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">題目</label>
        <textarea class="form-textarea q-text" placeholder="輸入題目文字…">${escapeHtml(q.text)}</textarea>
      </div>
      <div class="form-label">選項（點符號標記正確答案）</div>
      <div class="options-grid ${isTf ? 'options-grid-tf' : ''}">
        ${q.options.map(opt => `
          <div class="option-row">
            <div class="opt-label ${isTf ? 'tf' : opt.id} ${q.correct === opt.id ? 'correct' : ''}" onclick="toggleCorrect('${q.id}', '${opt.id}')" title="點擊設為正確答案">${isTf ? opt.text.split(' ')[0] : opt.id}</div>
            ${isTf
              ? `<input type="text" class="form-input opt-text" data-opt="${opt.id}" value="${escapeAttr(opt.text)}" placeholder="${opt.id === 'T' ? '✓ 對 / True' : '✗ 錯 / False'}">`
              : `<input type="text" class="form-input opt-text" data-opt="${opt.id}" value="${escapeAttr(opt.text)}" placeholder="選項 ${opt.id}">`
            }
          </div>
        `).join('')}
      </div>
      <div class="row-end mt-2">
        <button class="btn btn-danger btn-sm" onclick="deleteQuestion('${q.id}')">🗑️ 刪除此題</button>
      </div>
    </div>
  `;
}

function changeQuestionType(qid) {
  // 找題目
  let targetQ = null, targetQuiz = null;
  for (const quiz of state.quizzes) {
    const found = quiz.questions.find(q => q.id === qid);
    if (found) { targetQ = found; targetQuiz = quiz; break; }
  }
  if (!targetQ) return;
  const newType = targetQ.type === 'tf' ? 'abcd' : 'tf';
  const msg = newType === 'tf'
    ? '切換做 ✓/✗ 二選一題？\n原來的 A/B/C/D 選項和正確答案會被清除。'
    : '切換做 A/B/C/D 四選一題？\n原來的 ✓/✗ 選項和正確答案會被清除。';
  if (!confirm(msg)) return;
  const idx = targetQuiz.questions.findIndex(q => q.id === qid);
  targetQuiz.questions[idx] = createEmptyQuestion(newType);
  saveState();
  editQuiz(targetQuiz.id);
}

function toggleCorrect(qid, optId) {
  // 從 modal 裡找
  const item = document.querySelector(`.question-item[data-qid="${qid}"]`);
  if (!item) return;
  item.querySelectorAll('.opt-label').forEach(l => l.classList.remove('correct'));
  item.querySelector(`.opt-label.${optId}`).classList.add('correct');
  item.dataset.correct = optId;
}

function addQuestion(quizId) {
  const quiz = myQuizzes().find(q => q.id === quizId);
  if (!quiz) return;

  // 顯示選擇題型 modal
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 480px;">
        <div class="modal-header">
          <div class="modal-title">➕ 選擇題型</div>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div style="display: grid; gap: 12px;">
          <button class="btn btn-ghost" style="justify-content: flex-start; padding: 16px; text-align: left; height: auto;" onclick="confirmAddQuestion('${quizId}', 'abcd')">
            <div style="text-align: left; width: 100%;">
              <div style="font-size: 22px; font-weight: 700; margin-bottom: 4px;">🅰️🅱️🅲️🅳️ 四選一</div>
              <div style="color: var(--c-text-muted); font-size: 15px;">傳統選擇題，4 個選項</div>
            </div>
          </button>
          <button class="btn btn-ghost" style="justify-content: flex-start; padding: 16px; text-align: left; height: auto;" onclick="confirmAddQuestion('${quizId}', 'tf')">
            <div style="text-align: left; width: 100%;">
              <div style="font-size: 22px; font-weight: 700; margin-bottom: 4px;">✓/✗ 二選一</div>
              <div style="color: var(--c-text-muted); font-size: 15px;">是非題 / 對錯題，剔或交叉</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  `;
}

function confirmAddQuestion(quizId, type) {
  const quiz = myQuizzes().find(q => q.id === quizId);
  if (!quiz) return;
  quiz.questions.push(createEmptyQuestion(type));
  saveState();
  closeModal();
  editQuiz(quizId);
}

function deleteQuestion(qid) {
  const quiz = myQuizzes().find(q => q.questions.some(qq => qq.id === qid));
  if (!quiz) return;
  if (quiz.questions.length <= 1) { toast('至少要留一題', 'warning'); return; }
  if (!confirm('確定刪除此題？')) return;
  quiz.questions = quiz.questions.filter(q => q.id !== qid);
  saveState();
  editQuiz(quiz.id);
}

function saveQuizEdit(quizId) {
  const quiz = myQuizzes().find(q => q.id === quizId);
  if (!quiz) return;
  const title = document.getElementById('quizTitle').value.trim();
  if (!title) { toast('請輸入題目名稱', 'error'); return; }
  quiz.title = title;

  let allValid = true;
  document.querySelectorAll('.question-item').forEach(item => {
    const qid = item.dataset.qid;
    const q = quiz.questions.find(x => x.id === qid);
    if (!q) return;
    q.text = item.querySelector('.q-text').value.trim();
    q.correct = item.dataset.correct || null;
    item.querySelectorAll('.opt-text').forEach(inp => {
      const optId = inp.dataset.opt;
      const opt = q.options.find(o => o.id === optId);
      if (opt) opt.text = inp.value.trim();
    });
    if (!q.text) { allValid = false; item.querySelector('.q-text').style.borderColor = 'var(--c-danger)'; }
    if (!q.correct) allValid = false;
    if (q.options.some(o => !o.text)) allValid = false;
  });

  if (!allValid) { toast('請填寫所有題目、選項，並標記正確答案', 'error'); return; }
  saveState();
  closeModal();
  toast('題目已儲存 ✓', 'success');
  setView('quizzes');
}

function deleteQuiz(quizId) {
  if (!confirm('確定刪除此題目？相關答題紀錄不會被刪除。')) return;
  state.quizzes = state.quizzes.filter(q => q.id !== quizId);
  saveState();
  setView('quizzes');
  toast('題目已刪除', 'success');
}
window.deleteQuiz = deleteQuiz;
window.editQuiz = editQuiz;
window.addQuestion = addQuestion;
window.deleteQuestion = deleteQuestion;
window.toggleCorrect = toggleCorrect;
window.changeQuestionType = changeQuestionType;
window.confirmAddQuestion = confirmAddQuestion;

/* ================================================
   7. Student CRUD
   ================================================ */
function classOptions(selectedId = null, includeNull = false) {
  let opts = '';
  if (includeNull) opts += '<option value="">（不指定）</option>';
  visibleClasses().forEach(c => {
    opts += `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`;
  });
  return opts;
}

function className(classId) {
  const c = visibleClasses().find(x => x.id === classId);
  return c ? c.name : '—';
}

function newStudent() {
  openModal(`
    <div class="modal-header">
      <div class="modal-title">➕ 新增學生</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label">學生姓名</label>
      <input type="text" id="studentName" class="form-input" placeholder="例：小明" autofocus>
    </div>
    <div class="form-group">
      <label class="form-label">所屬班級</label>
      <select id="studentClass" class="form-select">
        ${visibleClasses().length === 0
          ? '<option value="">（請先去「班級」頁面建立班級）</option>'
          : classOptions(state.classes[0].id)}
      </select>
      <div class="form-hint">${visibleClasses().length === 0 ? '暫無班級，請先建立' : '可之後再改'}</div>
    </div>
    <div class="row-end">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="confirmNewStudent()">加入</button>
    </div>
  `);
  setTimeout(() => document.getElementById('studentName')?.focus(), 100);
}

function confirmNewStudent() {
  const name = document.getElementById('studentName').value.trim();
  if (!name) { toast('請輸入姓名', 'error'); return; }
  const classId = document.getElementById('studentClass')?.value || null;
  const student = {
    id: uid('s'),
    ownerId: currentUser()?.id || null,
    name,
    classId: classId || (visibleClasses()[0]?.id || null),
    number: visibleStudents().length + 1,
    createdAt: Date.now(),
  };
  state.students.push(student);
  saveState();
  closeModal();
  setView('students');
  toast(`已加入 ${name} ✓`, 'success');
}

function editStudent(sid) {
  const s = visibleStudents().find(x => x.id === sid);
  if (!s) return;
  openModal(`
    <div class="modal-header">
      <div class="modal-title">✏️ 編輯學生</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label">姓名</label>
      <input type="text" id="studentName" class="form-input" value="${escapeAttr(s.name)}">
    </div>
    <div class="form-group">
      <label class="form-label">所屬班級</label>
      <select id="studentClass" class="form-select">
        ${classOptions(s.classId)}
      </select>
    </div>
    <div class="row-end">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="confirmEditStudent('${sid}')">儲存</button>
    </div>
  `);
  setTimeout(() => document.getElementById('studentName')?.focus(), 100);
}

function confirmEditStudent(sid) {
  const s = visibleStudents().find(x => x.id === sid);
  if (!s) return;
  const name = document.getElementById('studentName').value.trim();
  if (!name) { toast('請輸入姓名', 'error'); return; }
  const classId = document.getElementById('studentClass')?.value || null;
  s.name = name;
  s.classId = classId;
  saveState();
  closeModal();
  setView('students');
  toast('已更新 ✓', 'success');
}

function deleteStudent(sid) {
  const s = visibleStudents().find(x => x.id === sid);
  if (!s) return;
  if (!confirm(`確定刪除 ${s.name}？`)) return;
  state.students = state.students.filter(x => x.id !== sid);
  // 重新編號
  visibleStudents().forEach((x, i) => x.number = i + 1);
  saveState();
  setView('students');
  toast('已刪除', 'success');
}

function bulkAddStudents() {
  openModal(`
    <div class="modal-header">
      <div class="modal-title">📋 批次加入學生</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label">所屬班級</label>
      <select id="bulkClass" class="form-select">
        ${visibleClasses().length === 0
          ? '<option value="">（請先去「班級」頁面建立）</option>'
          : classOptions(state.classes[0].id)}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">每行一位學生</label>
      <textarea id="bulkNames" class="form-textarea" rows="10" placeholder="小明&#10;小美&#10;阿強&#10;阿芳"></textarea>
      <div class="form-hint">每行一個名字</div>
    </div>
    <div class="row-end">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="confirmBulkAdd()">加入</button>
    </div>
  `);
  setTimeout(() => document.getElementById('bulkNames')?.focus(), 100);
}

function confirmBulkAdd() {
  const raw = document.getElementById('bulkNames').value;
  const names = raw.split('\n').map(s => s.trim()).filter(Boolean);
  if (names.length === 0) { toast('請輸入至少一個名字', 'error'); return; }
  const classId = document.getElementById('bulkClass')?.value || (visibleClasses()[0]?.id || null);
  let nextNum = visibleStudents().length + 1;
  names.forEach(name => {
    state.students.push({
      id: uid('s'),
      ownerId: currentUser()?.id || null,
      name,
      classId,
      number: nextNum++,
      createdAt: Date.now(),
    });
  });
  saveState();
  closeModal();
  setView('students');
  toast(`已加入 ${names.length} 位學生 ✓`, 'success');
}

/* ================================================
   7b. Class CRUD
   ================================================ */
function newClass() {
  openModal(`
    <div class="modal-header">
      <div class="modal-title">➕ 新增班級</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label">班級名稱</label>
      <input type="text" id="className" class="form-input" placeholder="例：3A、4B、晨曦組" autofocus>
      <div class="form-hint">支援中英文，例如「1A」「三年甲班」「晨光組」</div>
    </div>
    <div class="row-end">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="confirmNewClass()">建立</button>
    </div>
  `);
  setTimeout(() => document.getElementById('className')?.focus(), 100);
}

function confirmNewClass() {
  const name = document.getElementById('className').value.trim();
  if (!name) { toast('請輸入班級名稱', 'error'); return; }
  // 重名檢查
  if (visibleClasses().some(c => c.name === name)) {
    toast('已有同名班級', 'error');
    return;
  }
  const cls = {
    id: uid('cls'),
    ownerId: currentUser()?.id || null,
    name,
    createdAt: Date.now(),
  };
  state.classes.push(cls);
  saveState();
  closeModal();
  setView('classes');
  toast(`已建立班級「${name}」 ✓`, 'success');
}

function editClass(cid) {
  const c = visibleClasses().find(x => x.id === cid);
  if (!c) return;
  openModal(`
    <div class="modal-header">
      <div class="modal-title">✏️ 修改班級名稱</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label">班級名稱</label>
      <input type="text" id="className" class="form-input" value="${escapeAttr(c.name)}" autofocus>
    </div>
    <div class="row-end">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="confirmEditClass('${cid}')">儲存</button>
    </div>
  `);
  setTimeout(() => document.getElementById('className')?.focus(), 100);
}

function confirmEditClass(cid) {
  const c = visibleClasses().find(x => x.id === cid);
  if (!c) return;
  const name = document.getElementById('className').value.trim();
  if (!name) { toast('請輸入班級名稱', 'error'); return; }
  if (visibleClasses().some(x => x.id !== cid && x.name === name)) {
    toast('已有同名班級', 'error');
    return;
  }
  c.name = name;
  saveState();
  closeModal();
  setView('classes');
  toast('已更新 ✓', 'success');
}

function deleteClass(cid) {
  const c = visibleClasses().find(x => x.id === cid);
  if (!c) return;
  const studentCount = visibleStudents().filter(s => s.classId === cid).length;
  if (studentCount > 0) {
    toast(`「${c.name}」仲有 ${studentCount} 位學生，請先將學生移到其他班`, 'error');
    return;
  }
  if (!confirm(`確定刪除班級「${c.name}」？`)) return;
  state.classes = state.classes.filter(x => x.id !== cid);
  saveState();
  setView('classes');
  toast('已刪除', 'success');
}

/* ================================================
   7c. EXCEL 匯入學生
   ================================================ */
function importStudentsExcel() {
  if (visibleClasses().length === 0) {
    toast('請先建立至少一個班級', 'error');
    setView('classes');
    return;
  }
  openModal(`
    <div class="modal-header">
      <div class="modal-title">📥 匯入學生（EXCEL）</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label">選擇 .xlsx 檔案</label>
      <input type="file" id="excelFile" accept=".xlsx,.xls" class="form-input">
      <div class="form-hint">
        格式：第 1 行是標題，之後每行一位學生<br>
        欄位順序：<b>班級</b>、<b>學號</b>、<b>姓名</b><br>
        例如：3A 01 小明
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">預覽</label>
      <div id="excelPreview" class="text-muted text-sm" style="max-height: 200px; overflow: auto; background: #f9fafb; padding: 8px; border-radius: 6px;">
        揀咗檔案之後會顯示預覽
      </div>
    </div>
    <div class="row-end">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="confirmImportBtn" onclick="confirmImportExcel()" disabled>📥 匯入</button>
    </div>
  `);
  setTimeout(() => {
    const fileInput = document.getElementById('excelFile');
    if (fileInput) {
      fileInput.addEventListener('change', handleExcelFile);
    }
  }, 100);
}

let _importedStudents = null; // { rows: [...], newClasses: [...] }

function handleExcelFile(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      // 過濾空行 + skip header
      const dataRows = rows.filter(r => r.some(c => String(c).trim()));
      if (dataRows.length === 0) {
        document.getElementById('excelPreview').textContent = '❌ 檔案冇內容';
        return;
      }
      // 偵測第一行係咪 header（有中文字就當 header）
      const firstRow = dataRows[0].map(c => String(c).trim());
      const isHeader = firstRow.some(c => /[\u4e00-\u9fff]/.test(c) && /班|級|學|號|名|Name|Class/.test(c));
      const bodyRows = isHeader ? dataRows.slice(1) : dataRows;

      // 自動偵測欄位（搜尋「班級」「學號」「姓名」等關鍵字，否則用 column 0/1/2）
      let cols = { class: 0, number: 1, name: 2 };
      if (isHeader) {
        firstRow.forEach((cell, idx) => {
          if (/班|級|Class/i.test(cell)) cols.class = idx;
          else if (/學號|號|Number|No/i.test(cell)) cols.number = idx;
          else if (/姓|名|Name/i.test(cell)) cols.name = idx;
        });
      }

      // 收集需要建立嘅新班級
      const newClasses = [];
      const parsed = bodyRows.map(r => {
        const className = String(r[cols.class] || '').trim();
        const number = String(r[cols.number] || '').trim();
        const name = String(r[cols.name] || '').trim();
        if (!name) return null;
        if (className && !visibleClasses().some(c => c.name === className) && !newClasses.some(c => c.name === className)) {
          newClasses.push({ name: className });
        }
        return { className, number, name };
      }).filter(Boolean);

      _importedStudents = { rows: parsed, newClasses };

      // 預覽
      const preview = parsed.slice(0, 10).map(r =>
        `<div>${escapeHtml(r.className || '—')} · #${escapeHtml(r.number || '?')} · <b>${escapeHtml(r.name)}</b></div>`
      ).join('');
      const more = parsed.length > 10 ? `<div class="text-muted">… 仲有 ${parsed.length - 10} 位</div>` : '';
      const newClsInfo = newClasses.length > 0
        ? `<div style="color: var(--c-success); margin-top: 8px;">✓ 會自動建立 ${newClasses.length} 個新班級：${newClasses.map(c => escapeHtml(c.name)).join('、')}</div>`
        : '';
      document.getElementById('excelPreview').innerHTML =
        `<div class="text-muted">偵測到 <b>${parsed.length}</b> 位學生${isHeader ? '（已跳過標題行）' : ''}</div>` +
        preview + more + newClsInfo;
      document.getElementById('confirmImportBtn').disabled = false;
    } catch (e) {
      console.error(e);
      document.getElementById('excelPreview').textContent = '❌ 讀取失敗：' + e.message;
    }
  };
  reader.readAsArrayBuffer(file);
}

function confirmImportExcel() {
  if (!_importedStudents || _importedStudents.rows.length === 0) {
    toast('冇可匯入嘅學生', 'error');
    return;
  }
  // 建立新班級
  const clsMap = {}; // name -> id
  visibleClasses().forEach(c => clsMap[c.name] = c.id);
  _importedStudents.newClasses.forEach(nc => {
    const id = uid('cls');
    state.classes.push({ id, ownerId: currentUser()?.id || null, name: nc.name, createdAt: Date.now() });
    clsMap[nc.name] = id;
  });
  // 加入學生
  let nextNum = visibleStudents().length + 1;
  let added = 0;
  _importedStudents.rows.forEach(r => {
    const cid = r.className ? clsMap[r.className] : (state.classes[0]?.id || null);
    state.students.push({
      id: uid('s'),
      ownerId: currentUser()?.id || null,
      name: r.name,
      classId: cid,
      number: nextNum++,
      createdAt: Date.now(),
    });
    added++;
  });
  saveState();
  closeModal();
  setView('students');
  toast(`已匯入 ${added} 位學生${_importedStudents.newClasses.length > 0 ? `、新建 ${_importedStudents.newClasses.length} 個班級` : ''} ✓`, 'success');
  _importedStudents = null;
}
window.newQuiz = newQuiz;
window.confirmNewQuiz = confirmNewQuiz;
window.saveQuizEdit = saveQuizEdit;
window.newStudent = newStudent;
window.confirmNewStudent = confirmNewStudent;
window.editStudent = editStudent;
window.confirmEditStudent = confirmEditStudent;
window.deleteStudent = deleteStudent;
window.bulkAddStudents = bulkAddStudents;
window.confirmBulkAdd = confirmBulkAdd;
window.newClass = newClass;
window.confirmNewClass = confirmNewClass;
window.editClass = editClass;
window.confirmEditClass = confirmEditClass;
window.deleteClass = deleteClass;
window.importStudentsExcel = importStudentsExcel;
window.confirmImportExcel = confirmImportExcel;

/* ================================================
   8. Live Mode
   ================================================ */
let liveState = {
  quizId: null,
  currentQIdx: 0,
  mode: 'scan',  // 'scan' | 'manual'
  scanning: false,
  lastScannedStudent: null,
  lastScannedAt: 0,
  revealed: null,  // 當前揭曉的題目 id
};

function startLive(quizId, classId = 'all') {
  state.currentSession = {
    id: uid('sess'),
    ownerId: currentUser()?.id || null,
    quizId,
    classId,  // 記住係邊個班答嘅
    startedAt: Date.now(),
    answers: {},
  };
  liveState = { quizId, currentQIdx: 0, mode: 'scan', scanning: false, lastScannedStudent: null, lastScannedAt: 0 };
  setView('live');
}

function startLiveSession() {
  const sel = document.getElementById('liveQuizSelect');
  const classSel = document.getElementById('liveClassSelect');
  const modeRadio = document.querySelector('input[name="liveMode"]:checked');
  if (!sel) return;
  const classId = classSel ? classSel.value : 'all';
  startLive(sel.value, classId);
  if (modeRadio) liveState.mode = modeRadio.value;
}
window.startLive = startLive;
window.startLiveSession = startLiveSession;

function renderLiveStage() {
  const session = state.currentSession;
  if (!session) return '';
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  if (!quiz) return '<div class="empty">題目不存在</div>';

  // 班級範圍
  const classId = session.classId || 'all';
  const sessionStudents = (classId === 'all' || !classId)
    ? state.students
    : visibleStudents().filter(s => s.classId === classId);
  const sessionClassName = classId === 'all'
    ? '全部班級'
    : className(classId);

  const q = quiz.questions[liveState.currentQIdx];
  if (!q) {
    // 完成所有題目
    finalizeSession();
    return '';
  }

  const isTf = q.type === 'tf';
  const answered = sessionStudents.filter(s => session.answers[s.id]?.[q.id]).length;
  const total = sessionStudents.length;
  const isLast = liveState.currentQIdx === quiz.questions.length - 1;

  // 計算各選項人數（只計範圍內學生）
  const counts = isTf
    ? { T: 0, F: 0, '': 0 }
    : { A: 0, B: 0, C: 0, D: 0, '': 0 };
  sessionStudents.forEach(s => {
    const ans = session.answers[s.id]?.[q.id];
    if (ans) counts[ans] = (counts[ans] || 0) + 1;
    else counts['']++;
  });

  const revealed = liveState.revealed === q.id;
  const countsHtml = isTf
    ? `<span style="color: var(--c-success);">✓: ${counts.T}</span><span style="color: var(--c-danger);">✗: ${counts.F}</span>${counts[''] > 0 ? `<span class="text-muted">未答: ${counts['']}</span>` : ''}`
    : `<span style="color: var(--c-A);">A: ${counts.A}</span><span style="color: var(--c-B);">B: ${counts.B}</span><span style="color: var(--c-C);">C: ${counts.C}</span><span style="color: var(--c-D);">D: ${counts.D}</span>${counts[''] > 0 ? `<span class="text-muted">未答: ${counts['']}</span>` : ''}`;

  // 選項顯示：TF 顯示 ✓/✗ 符號，ABCD 顯示字母
  const optionDisplay = isTf
    ? q.options.map(opt => {
        const symbol = opt.id === 'T' ? '✓' : '✗';
        const cls = opt.id === 'T' ? 'tf-true' : 'tf-false';
        return `<div class="answer-display ${cls} ${revealed && q.correct === opt.id ? 'correct' : ''}">
          ${symbol}<span class="small">${escapeHtml(opt.text.replace(/^[✓✗]\s*/, '') || ' ')}</span>
          ${revealed && q.correct === opt.id ? '<div class="check-mark">✓ 正確</div>' : ''}
        </div>`;
      }).join('')
    : q.options.map(opt => `
        <div class="answer-display answer-${opt.id} ${revealed && q.correct === opt.id ? 'correct' : ''}">
          ${opt.id}<span class="small">${escapeHtml(opt.text || ' ')}</span>
          ${revealed && q.correct === opt.id ? '<div class="check-mark">✓ 正確</div>' : ''}
        </div>
      `).join('');

  // 提示學生舉起對應嘅卡
  const cardHint = isTf
    ? '<div class="card-hint">📇 請學生 <b>舉起 ✓ 或 ✗ 卡</b></div>'
    : '<div class="card-hint">📇 請學生 <b>舉起 A / B / C / D 卡</b></div>';

  return `
    <div class="row-between mb-2 no-print">
      <div>
        <h2 class="view-title">▶️ ${escapeHtml(quiz.title)} · <span class="text-muted text-sm" style="font-size: 18px;">${escapeHtml(sessionClassName)}</span></h2>
        <p class="view-subtitle">題目 ${liveState.currentQIdx + 1} / ${quiz.questions.length} · ${isTf ? '✓/✗ 二選一' : 'A/B/C/D 四選一'} · 模式：${liveState.mode === 'scan' ? '📷 掃描' : '🖱️ 手動'}</p>
      </div>
      <div class="row">
        <button class="btn btn-ghost" onclick="endLive()">⏹ 結束</button>
      </div>
    </div>

    <div class="live-stage">
      <div class="live-progress">
        <span>📊 已收 ${answered} / ${total} 份</span>
        <span class="row" style="gap: 6px;">${countsHtml}</span>
      </div>

      <div class="row" style="justify-content: center; gap: 8px; margin-bottom: 8px;">
        <button class="btn btn-ghost btn-sm" onclick="speakQuestion('${q.id}')">🔊 讀出題目</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleReveal('${q.id}')">${revealed ? '🙈 隱藏答案' : '👁️ 揭曉答案'}</button>
      </div>

      <div class="live-question">${escapeHtml(q.text)}</div>

      <div class="live-options ${isTf ? 'live-options-tf' : ''}" id="liveOptions">
        ${optionDisplay}
      </div>

      ${cardHint}

      <div class="live-controls">
        <button class="btn btn-ghost btn-lg" onclick="prevQuestion()" ${liveState.currentQIdx === 0 ? 'disabled' : ''}>← 上一題</button>
        <button class="btn btn-ghost btn-lg" onclick="skipQuestion()">⏭ 跳過</button>
        <button class="btn btn-primary btn-lg" onclick="nextQuestion()">${isLast ? '完成答題 ✓' : '下一題 →'}</button>
      </div>
    </div>

    ${liveState.mode === 'scan' ? renderScannerSection() : renderManualSection()}
  `;
}

function renderScannerSection() {
  return `
    <div class="card mt-2 no-print">
      <div class="card-header">
        <div class="card-title">📷 鏡頭掃描</div>
        <div class="row">
          <button class="btn btn-success" id="startCamBtn" onclick="startScanner()">▶️ 啟動鏡頭</button>
          <button class="btn btn-danger" id="stopCamBtn" onclick="stopScanner()" style="display:none;">⏹ 停止</button>
        </div>
      </div>
      <p class="text-muted text-sm">📌 掃描中嘅影像會顯示喺 <b>右下角浮動 widget</b>，可以隨時切換頁面繼續使用（唔會因為切頁而自動關閉）。</p>

      <!-- 答案確認 Modal (動態) -->
      <div id="answerConfirmArea"></div>
    </div>
  `;
}

function renderManualSection() {
  // 手動模式：每位學生按鈕組
  const session = state.currentSession;
  const classId = session.classId || 'all';
  const sessionStudents = (classId === 'all' || !classId)
    ? state.students
    : visibleStudents().filter(s => s.classId === classId);
  if (sessionStudents.length === 0) {
    return `<div class="card mt-2"><div class="empty"><div class="empty-icon">👨‍🎓</div><div class="empty-title">冇學生</div></div></div>`;
  }
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  const q = quiz.questions[liveState.currentQIdx];
  const isTf = q.type === 'tf';
  const opts = isTf ? ['T', 'F'] : ['A', 'B', 'C', 'D'];
  return `
    <div class="card mt-2 no-print">
      <div class="card-title mb-2">👨‍🎓 點選學生答案（${isTf ? '✓/✗' : 'A/B/C/D'} · ${sessionStudents.length} 位）</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">
        ${sessionStudents.map(s => {
          const ans = session.answers[s.id]?.[q.id];
          return `
            <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: #fafbff; border-radius: 8px;">
              <div style="font-weight: 700; min-width: 60px;">${escapeHtml(s.name)}</div>
              <div style="display: flex; gap: 4px; flex: 1; justify-content: flex-end;">
                ${opts.map(opt => {
                  const isSelected = ans === opt;
                  const label = isTf ? (opt === 'T' ? '✓' : '✗') : opt;
                  const colorCls = isTf ? (opt === 'T' ? 'tf-true' : 'tf-false') : '';
                  return `<button class="btn ${isSelected ? 'btn-primary' : 'btn-ghost'} btn-sm ${isSelected && isTf ? colorCls : ''}" style="min-width: 44px;" onclick="manualAnswer('${s.id}','${opt}')">${label}</button>`;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function manualAnswer(sid, opt) {
  const session = state.currentSession;
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  const q = quiz.questions[liveState.currentQIdx];
  if (!session.answers[sid]) session.answers[sid] = {};
  session.answers[sid][q.id] = opt;
  saveState();
  setView('live');
}

function prevQuestion() {
  if (liveState.currentQIdx > 0) { liveState.currentQIdx--; setView('live'); }
}
function nextQuestion() {
  const session = state.currentSession;
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  if (liveState.currentQIdx < quiz.questions.length - 1) {
    liveState.currentQIdx++;
    setView('live');
  } else {
    finalizeSession();
  }
}
function skipQuestion() {
  nextQuestion();
}
function endLive() {
  if (!confirm('結束答題？已收集的答案會保留。')) return;
  finalizeSession();
}
function finalizeSession() {
  const session = state.currentSession;
  if (!session) return;
  session.finishedAt = Date.now();
  state.sessions.push(session);
  state.currentSession = null;
  // 保留鏡頭開啟，方便即場 review 結果
  // 用戶可以喺結果頁手動停止鏡頭
  saveState();
  toast('答題完成 ✓', 'success');
  setView('results');
  // 自動跳到詳情
  setTimeout(() => viewSessionDetail(session.id), 300);
}
function showAnswerButtons(suggested) {
  // 純顯示用的「題目選項」，不是輸入；這個是學生看到的題目頁面
  // 真正的輸入是透過掃描或手動模式
}

function speakQuestion(qid) {
  const session = state.currentSession;
  if (!session) return;
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  const q = quiz.questions.find(x => x.id === qid);
  if (!q) return;
  if (!('speechSynthesis' in window)) { toast('此裝置不支援語音', 'warning'); return; }
  window.speechSynthesis.cancel();
  let text = q.text + '。';
  if (q.type === 'tf') {
    text += `剔：${q.options[0].text.replace(/^[✓✗]\s*/, '')}。交叉：${q.options[1].text.replace(/^[✓✗]\s*/, '')}。`;
  } else {
    text += `A：${q.options[0].text || '空'}。B：${q.options[1].text || '空'}。C：${q.options[2].text || '空'}。D：${q.options[3].text || '空'}。`;
  }
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-HK';
  utter.rate = 0.9;
  window.speechSynthesis.speak(utter);
}

function toggleReveal(qid) {
  if (liveState.revealed === qid) {
    liveState.revealed = null;
  } else {
    liveState.revealed = qid;
  }
  setView('live');
}
window.manualAnswer = manualAnswer;
window.prevQuestion = prevQuestion;
window.nextQuestion = nextQuestion;
window.skipQuestion = skipQuestion;
window.endLive = endLive;
window.showAnswerButtons = showAnswerButtons;
window.speakQuestion = speakQuestion;
window.toggleReveal = toggleReveal;

/* ================================================
   9. Scanner (jsQR)
   ================================================ */
let scannerStream = null;
let scannerTimer = null;
let scannerCanvas = null;
let scannerCtx = null;

async function startScanner() {
  const video = document.getElementById('scannerVideo');
  const widget = document.getElementById('camera-widget');
  if (!video) return;
  // 保險：如果鏡頭已經運行緊（liveState.scanning + scannerStream 仲 active），
  // 就唔好重複申請 stream，避免 stream 衝突
  if (liveState.scanning && scannerStream) {
    console.log('[startScanner] 鏡頭已運行中，唔重複申請');
    return;
  }
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    video.srcObject = scannerStream;
    await video.play();
    scannerCanvas = document.createElement('canvas');
    scannerCtx = scannerCanvas.getContext('2d', { willReadFrequently: true });
    // 顯示固定 widget
    if (widget) widget.style.display = 'block';
    document.getElementById('scannerStatus').textContent = '📷 掃描中…';
    const startBtn = document.getElementById('startCamBtn');
    const stopBtn = document.getElementById('stopCamBtn');
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = '';
    liveState.scanning = true;
    requestScannerFrame();
  } catch (e) {
    console.error(e);
    toast('無法開啟鏡頭：' + e.message, 'error');
  }
}

function stopScanner() {
  liveState.scanning = false;
  if (scannerTimer) { cancelAnimationFrame(scannerTimer); scannerTimer = null; }
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  const video = document.getElementById('scannerVideo');
  if (video) {
    video.srcObject = null;
    video.pause();
  }
  // 隱藏固定 widget
  const widget = document.getElementById('camera-widget');
  if (widget) widget.style.display = 'none';
  const startBtn = document.getElementById('startCamBtn');
  const stopBtn = document.getElementById('stopCamBtn');
  if (startBtn) startBtn.style.display = '';
  if (stopBtn) stopBtn.style.display = 'none';
  const status = document.getElementById('scannerStatus');
  if (status) status.textContent = '鏡頭未啟動';
  // 重新渲染 results page 以更新鏡頭狀態
  if (currentView === 'results') setView('results');
}

async function restartScannerForReview() {
  // 補掃模式：啟動鏡頭，用最後一個 session
  if (visibleSessions().length === 0) {
    toast('冇 session 可以補掃', 'warning');
    return;
  }
  liveState.reviewSessionId = state.sessions[visibleSessions().length - 1].id;
  liveState.reviewQIdx = 0;  // 預設補掃第一題
  await startScanner();
  toast('已啟動補掃模式（添加到最新 session）', 'success');
}

function requestScannerFrame() {
  if (!liveState.scanning) return;
  scannerTimer = requestAnimationFrame(scanFrame);
}

function scanFrame() {
  if (!liveState.scanning) return;
  const video = document.getElementById('scannerVideo');
  if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
    requestScannerFrame();
    return;
  }
  scannerCanvas.width = video.videoWidth;
  scannerCanvas.height = video.videoHeight;
  scannerCtx.drawImage(video, 0, 0, scannerCanvas.width, scannerCanvas.height);
  const imageData = scannerCtx.getImageData(0, 0, scannerCanvas.width, scannerCanvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
  if (code && code.data) {
    handleScannedQR(code.data);
  }
  requestScannerFrame();
}

function handleScannedQR(data) {
  // 防抖：同一張卡 1.5 秒內只觸發一次
  const now = Date.now();
  if (data === liveState.lastScannedStudent && now - liveState.lastScannedAt < 1500) return;
  liveState.lastScannedStudent = data;
  liveState.lastScannedAt = now;

  // QR 格式: "P:studentId:answer" (answer: A/B/C/D/T/F)
  if (!data.startsWith('P:')) {
    showDetected('⚠️ 不是學生卡', true);
    return;
  }
  const parts = data.slice(2).split(':');
  if (parts.length < 2) {
    showDetected('⚠️ QR 格式錯誤', true);
    return;
  }
  const sid = parts[0];
  const answer = parts[1];
  const student = visibleStudents().find(s => s.id === sid);
  if (!student) {
    showDetected('⚠️ 找不到此學生', true);
    return;
  }

  // 補掃模式：如果冇 currentSession，用最後一個 session
  let session = state.currentSession;
  let qIdx = liveState.currentQIdx;
  let mode = 'live';

  if (!session && visibleSessions().length > 0) {
    // 補掃：取最後一個 session
    session = state.sessions[visibleSessions().length - 1];
    // 用 liveState 嘅 reviewQIdx
    qIdx = liveState.reviewQIdx ?? 0;
    mode = 'review';
  }
  if (!session) return;

  const quiz = myQuizzes().find(q => q.id === session.quizId);
  if (!quiz || !quiz.questions[qIdx]) {
    showDetected('⚠️ 無可用題目', true);
    return;
  }
  const q = quiz.questions[qIdx];
  const isTfQuestion = q.type === 'tf';

  // 檢查答案類型是否同當前題目匹配
  const isAnswerTf = answer === 'T' || answer === 'F';
  if (isAnswerTf !== isTfQuestion) {
    const cardTypeName = isAnswerTf ? '✓/✗' : 'A/B/C/D';
    const questionTypeName = isTfQuestion ? '✓/✗' : 'A/B/C/D';
    showDetected(`⚠️ 卡類型不符`, true);
    if (navigator.vibrate) navigator.vibrate([80, 50, 80]);
    toast(`${student.name} 揸住 ${cardTypeName}卡，但呢題係 ${questionTypeName}題`, 'error');
    return;
  }

  // 檢查答案是否在合法範圍
  const validAnswers = isTfQuestion ? ['T', 'F'] : ['A', 'B', 'C', 'D'];
  if (!validAnswers.includes(answer)) {
    showDetected('⚠️ 答案不合法', true);
    return;
  }

  // 檢查重複作答
  const existing = session.answers[sid]?.[q.id];
  if (existing) {
    const ansLabel = isTfQuestion ? (existing === 'T' ? '✓' : '✗') : existing;
    showDetected(`${student.name} 已作答：${ansLabel}`, true);
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    return;
  }

  // 檢查跨班作答（warning 但仍記錄）
  if (session.classId && session.classId !== 'all' && student.classId && student.classId !== session.classId) {
    console.warn(`[cross-class] ${student.name} (${className(student.classId)}) 答咗 ${className(session.classId)} 嘅題目`);
  }

  // 記錄答案
  if (!session.answers[sid]) session.answers[sid] = {};
  session.answers[sid][q.id] = answer;
  saveState();

  // 顯示成功
  const ansLabel = isTfQuestion ? (answer === 'T' ? '✓ 對' : '✗ 錯') : answer;
  const modeTag = mode === 'review' ? ' (補掃)' : '';
  showDetected(`✓ ${student.name} → ${ansLabel}${modeTag}`, false);
  if (navigator.vibrate) navigator.vibrate(80);

  // 重新渲染以更新計數
  if (mode === 'review') {
    // 補掃模式：留喺 results 頁，重新 render
    if (currentView === 'results') setView('results');
  } else {
    setView('live');
  }
}

function showDetected(msg, isWarn) {
  const el = document.getElementById('scannerDetected');
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
  el.style.background = isWarn ? 'var(--c-warning)' : 'var(--c-success)';
  clearTimeout(showDetected._t);
  showDetected._t = setTimeout(() => { el.style.display = 'none'; }, 1500);
}

function showAnswerConfirmModal(student, q) {
  const area = document.getElementById('answerConfirmArea');
  if (!area) return;
  const isTf = q.type === 'tf';
  // 卡的類型提示
  const cardTypeHint = isTf ? '✓/✗ 紙卡' : 'A/B/C/D 紙卡';
  // 選項按鈕：TF 用 ✓/✗ 符號 + 大字
  const optsHtml = isTf
    ? q.options.map(opt => {
        const symbol = opt.id === 'T' ? '✓' : '✗';
        const cls = opt.id === 'T' ? 'tf-true' : 'tf-false';
        return `<button class="answer-btn ${cls}" onclick="confirmScanAnswer('${student.id}','${opt.id}')">
          ${symbol}<span class="small">${escapeHtml(opt.text.replace(/^[✓✗]\s*/, '') || ' ')}</span>
        </button>`;
      }).join('')
    : q.options.map((opt, i) => `
        <button class="answer-btn answer-${opt.id}" onclick="confirmScanAnswer('${student.id}','${opt.id}')">
          ${opt.id}<span class="small">${escapeHtml(opt.text || ' ')}</span>
        </button>
      `).join('');
  area.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) document.getElementById('answerConfirmArea').innerHTML=''">
      <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 500px;">
        <div class="modal-header">
          <div class="modal-title">${escapeHtml(student.name)} 揀咩？</div>
          <button class="modal-close" onclick="document.getElementById('answerConfirmArea').innerHTML=''">×</button>
        </div>
        <p class="text-muted mb-1">${escapeHtml(q.text)}</p>
        <p class="text-sm text-muted mb-2">用 ${cardTypeHint}作答</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          ${optsHtml}
        </div>
        <div class="row-end mt-2">
          <button class="btn btn-ghost" onclick="document.getElementById('answerConfirmArea').innerHTML=''">取消</button>
        </div>
      </div>
    </div>
  `;
}

function confirmScanAnswer(sid, opt) {
  const session = state.currentSession;
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  const q = quiz.questions[liveState.currentQIdx];
  if (!session.answers[sid]) session.answers[sid] = {};
  session.answers[sid][q.id] = opt;
  saveState();
  document.getElementById('answerConfirmArea').innerHTML = '';
  const student = visibleStudents().find(s => s.id === sid);
  toast(`${student?.name || '?'} → ${opt} ✓`, 'success');
  // 重新渲染以更新計數
  setView('live');
}
window.startScanner = startScanner;
window.stopScanner = stopScanner;
window.confirmScanAnswer = confirmScanAnswer;

/* ================================================
   10. Results
   ================================================ */
function viewSessionDetail(sid) {
  const session = visibleSessions().find(s => s.id === sid);
  if (!session) return;
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  if (!quiz) { toast('題目已被刪除', 'error'); return; }

  // 班級範圍
  const clsId = session.classId || 'all';
  const sessStudents = (clsId === 'all' || !clsId)
    ? state.students
    : visibleStudents().filter(s => s.classId === clsId);
  const sessClassName = clsId === 'all' ? '全部' : className(clsId);

  // 計算每位學生成績 + 逐題答案
  const results = sessStudents.map(s => {
    const perQuestion = quiz.questions.map(q => {
      const ans = session.answers[s.id]?.[q.id] || '';
      const isCorrect = ans && ans === q.correct;
      return { q, ans, isCorrect };
    });
    const correct = perQuestion.filter(p => p.isCorrect).length;
    const answered = perQuestion.filter(p => p.ans).length;
    return { student: s, correct, answered, total: quiz.questions.length, perQuestion };
  });

  // 整體正確率
  const totalAnswered = results.reduce((sum, r) => sum + r.answered, 0);
  const totalCorrect = results.reduce((sum, r) => sum + r.correct, 0);
  const totalPossible = sessStudents.length * quiz.questions.length;
  const accuracy = totalPossible > 0 ? Math.round((totalCorrect / totalPossible) * 100) : 0;
  const participation = sessStudents.length > 0 ? Math.round((results.filter(r => r.answered > 0).length / sessStudents.length) * 100) : 0;

  // 各題正確率 + 選項分佈
  const qStats = quiz.questions.map((q, i) => {
    const answeredCount = sessStudents.filter(s => session.answers[s.id]?.[q.id]).length;
    const correctCount = sessStudents.filter(s => session.answers[s.id]?.[q.id] === q.correct).length;
    const rate = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
    // 各選項人數
    const isTf = q.type === 'tf';
    const optIds = isTf ? ['T', 'F'] : ['A', 'B', 'C', 'D'];
    const optDist = optIds.map(opt => {
      const count = sessStudents.filter(s => session.answers[s.id]?.[q.id] === opt).length;
      return { opt, count };
    });
    return { q, idx: i, answeredCount, correctCount, rate, optDist, isTf };
  });

  // 學生詳細表（每題展開）
  const ansLabel = (q, ans) => {
    if (!ans) return '—';
    if (q.type === 'tf') return ans === 'T' ? '✓' : '✗';
    return ans;
  };

  const detailRows = results
    .slice()
    .sort((a, b) => b.correct - a.correct)
    .map(r => {
      const acc = r.total > 0 ? Math.round((r.correct / r.total) * 100) : 0;
      const accClass = acc >= 80 ? 'score-good' : (acc <= 30 ? 'score-bad' : '');
      const perQ = r.perQuestion.map(p => {
        const sym = p.isCorrect ? '✓' : (p.ans ? '✗' : '·');
        const symColor = p.isCorrect ? 'var(--c-success)' : (p.ans ? 'var(--c-danger)' : '#999');
        return `<td style="text-align: center; color: ${symColor}; font-weight: 700; font-size: 18px;">${sym}<br><span style="font-size: 11px; color: #888;">${ansLabel(p.q, p.ans)}</span></td>`;
      }).join('');
      return `
        <tr>
          <td><b>${escapeHtml(r.student.name)}</b></td>
          <td>#${r.student.number}</td>
          <td>${r.answered}/${r.total}</td>
          <td class="${accClass}"><b>${r.correct}</b></td>
          <td class="${accClass}">${acc}%</td>
          ${perQ}
        </tr>
      `;
    }).join('');

  const qHeaders = quiz.questions.map((_, i) => `<th style="min-width: 50px;">Q${i + 1}</th>`).join('');

  // 各題選項分佈
  const qDistRows = qStats.map(s => {
    const distCells = s.optDist.map(d => {
      const isCorrect = d.opt === s.q.correct;
      return `<td style="text-align: center; ${isCorrect ? 'background: #d1fae5; font-weight: 700;' : ''}">${d.count}${isCorrect ? ' ✓' : ''}</td>`;
    }).join('');
    return `
      <tr>
        <td><b>Q${s.idx + 1}</b> ${escapeHtml(s.q.text.slice(0, 30))}${s.q.text.length > 30 ? '…' : ''}</td>
        <td>${s.answeredCount}/${sessStudents.length}</td>
        <td><b style="color: var(--c-success);">${s.correctCount}</b></td>
        <td><b>${s.rate}%</b></td>
        ${distCells}
      </tr>
    `;
  }).join('');

  openModal(`
    <div class="modal-header">
      <div class="modal-title">📊 ${escapeHtml(quiz.title)} · ${escapeHtml(sessClassName)} — 詳細報告</div>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>

    <div class="stats-grid" style="margin-bottom: 16px;">
      <div class="stat-card"><div class="stat-num">${sessStudents.length}</div><div class="stat-label">參與人數</div></div>
      <div class="stat-card"><div class="stat-num">${participation}%</div><div class="stat-label">參與率</div></div>
      <div class="stat-card"><div class="stat-num">${totalCorrect}/${totalPossible}</div><div class="stat-label">答對/總題數</div></div>
      <div class="stat-card"><div class="stat-num" style="color: var(--c-success);">${accuracy}%</div><div class="stat-label">整體正確率</div></div>
    </div>

    <div class="card mb-2">
      <div class="card-title mb-2">👨‍🎓 學生詳細作答（每題 ✓/✗）</div>
      <div style="max-height: 400px; overflow: auto;">
        <table class="results-table">
          <thead><tr>
            <th>姓名</th><th>編號</th><th>作答</th><th>答對</th><th>正確率</th>
            ${qHeaders}
          </tr></thead>
          <tbody>${detailRows || '<tr><td colspan="' + (5 + quiz.questions.length) + '" class="text-center text-muted">未有學生</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="card mb-2">
      <div class="card-title mb-2">📊 各題分析（選項分佈）</div>
      <div style="max-height: 300px; overflow: auto;">
        <table class="results-table">
          <thead><tr>
            <th>題目</th><th>作答人數</th><th>答對人數</th><th>正確率</th>
            ${quiz.questions[0]?.type === 'tf' ? '<th>✓</th><th>✗</th>' : '<th>A</th><th>B</th><th>C</th><th>D</th>'}
          </tr></thead>
          <tbody>${qDistRows || '<tr><td colspan="6" class="text-center text-muted">無題目</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title mb-2">📈 各題正確率圖表</div>
      <div style="max-height: 300px;">
        <canvas id="qStatsChart"></canvas>
      </div>
    </div>

    <div class="row-end mt-3" style="gap: 8px; flex-wrap: wrap;">
      <button class="btn btn-ghost" onclick="closeModal()">關閉</button>
      <button class="btn btn-ghost" onclick="exportSession('${session.id}')">📄 CSV</button>
      <button class="btn btn-ghost" onclick="exportSessionExcel('${session.id}')">📊 EXCEL</button>
      <button class="btn btn-warning" onclick="exportSessionPDF('${session.id}')">📑 PDF 報告</button>
    </div>
  `);

  // 等 modal 顯示後畫圖
  setTimeout(() => {
    const ctx = document.getElementById('qStatsChart');
    if (!ctx) return;
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: qStats.map(s => `Q${s.idx + 1}`),
        datasets: [{
          label: '正確率 (%)',
          data: qStats.map(s => s.rate),
          backgroundColor: '#3b82f6',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } },
        plugins: { legend: { display: false } },
      }
    });
  }, 100);
}
window.viewSessionDetail = viewSessionDetail;

function exportSession(sid) {
  const session = visibleSessions().find(s => s.id === sid);
  if (!session) return;
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  if (!quiz) { toast('題目已被刪除', 'error'); return; }

  // 班級範圍
  const clsId = session.classId || 'all';
  const sessStudents = (clsId === 'all' || !clsId)
    ? state.students
    : visibleStudents().filter(s => s.classId === clsId);
  const sessClassName = clsId === 'all' ? '全部' : className(clsId);

  // 將答案 ID 轉成用戶友善的顯示（T → ✓, F → ✗）
  const ansLabel = (q, ans) => {
    if (!ans) return '';
    if (q.type === 'tf') return ans === 'T' ? '✓' : '✗';
    return ans;
  };
  const correctLabel = (q) => {
    if (!q.correct) return '';
    if (q.type === 'tf') return q.correct === 'T' ? '✓' : '✗';
    return q.correct;
  };

  const header = ['姓名', '編號', '班級', ...quiz.questions.map((q, i) => `Q${i + 1}${q.type === 'tf' ? '(✓/✗)' : ''}`), '答對', '正確率'];
  const rows = sessStudents.map(s => {
    const cells = [s.name, s.number, className(s.classId)];
    let correct = 0;
    quiz.questions.forEach(q => {
      const ans = session.answers[s.id]?.[q.id] || '';
      cells.push(ansLabel(q, ans));
      if (ans === q.correct) correct++;
    });
    cells.push(correct);
    cells.push(quiz.questions.length > 0 ? Math.round((correct / quiz.questions.length) * 100) + '%' : '0%');
    return cells;
  });
  // 加正確答案列
  const correctRow = ['(正確答案)', '', ...quiz.questions.map(q => correctLabel(q)), '', ''];
  rows.unshift(correctRow);

  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${quiz.title}-${sessClassName}-${formatDate(session.startedAt)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV 已下載 ✓', 'success');
}

function deleteSession(sid) {
  if (!confirm('確定刪除此答題紀錄？')) return;
  state.sessions = state.sessions.filter(s => s.id !== sid);
  saveState();
  setView('results');
  toast('已刪除', 'success');
}
window.viewSessionDetail = viewSessionDetail;
window.exportSession = exportSession;
window.deleteSession = deleteSession;

/* ================================================
   11. Utilities
   ================================================ */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ================================================
   12. Init
   ================================================ */
function loadDemoData() {
  if (!confirm('載入範例資料？現有資料會被保留（不會清除）。')) return;
  const demoStudents = ['小明', '小美', '阿強', '阿芳', '志明', '婉婷', '俊傑', '嘉欣'];
  const existingCount = visibleStudents().length;
  let nextNum = existingCount + 1;
  demoStudents.forEach(name => {
    state.students.push({
      id: uid('s'),
      ownerId: currentUser()?.id || null,
      name,
      number: nextNum++,
      createdAt: Date.now(),
    });
  });
  if (myQuizzes().length === 0) {
    state.quizzes.push({
      id: uid('q'),
      ownerId: currentUser()?.id || null,
      folderId: null,
      title: '一年級常識測驗（範例）',
      questions: [
        {
          id: uid('qq'),
          type: 'abcd',
          text: '香港的官方語言是什麼？',
          options: [
            { id: 'A', text: '普通話' },
            { id: 'B', text: '粵語和英語' },
            { id: 'C', text: '日語' },
            { id: 'D', text: '英語' },
          ],
          correct: 'B',
        },
        {
          id: uid('qq'),
          type: 'abcd',
          text: '1 + 2 = ?',
          options: [
            { id: 'A', text: '2' },
            { id: 'B', text: '3' },
            { id: 'C', text: '4' },
            { id: 'D', text: '5' },
          ],
          correct: 'B',
        },
        {
          id: uid('qq'),
          type: 'tf',
          text: '太陽從東方升起。',
          options: [
            { id: 'T', text: '✓ 對' },
            { id: 'F', text: '✗ 錯' },
          ],
          correct: 'T',
        },
        {
          id: uid('qq'),
          type: 'abcd',
          text: '以下哪個是水果？',
          options: [
            { id: 'A', text: '紅蘿蔔' },
            { id: 'B', text: '薯仔' },
            { id: 'C', text: '蘋果' },
            { id: 'D', text: '洋蔥' },
          ],
          correct: 'C',
        },
      ],
      createdAt: Date.now(),
    });
  }
  saveState();
  toast(`已載入 ${demoStudents.length} 位學生 + 1 份範例題目 ✓`, 'success');
  setView('home');
}
window.loadDemoData = loadDemoData;

function init() {
  // 首次載入，確保有 currentSession 欄位
  if (state.currentSession && state.currentSession.finishedAt) {
    state.currentSession = null;
  }
  // 未登入就去 login view
  if (!isLoggedIn()) {
    setView('login');
  } else {
    setView('home');
  }
  renderUserButton();

  // 暴露到 window
  window.state = state;
  window.saveState = saveState;
  window.setView = setView;
  window.startLive = startLive;
  window.manualAnswer = manualAnswer;
  window.nextQuestion = nextQuestion;
  window.toggleReveal = toggleReveal;
  window.speakQuestion = speakQuestion;
  window.exportSession = exportSession;
  window.exportSessionExcel = exportSessionExcel;
  window.exportSessionPDF = exportSessionPDF;
  window.exportCardsPDF = exportCardsPDF;
  window.loadDemoData = loadDemoData;
  window.ANSWER_TYPES = ANSWER_TYPES;
  window.handleScannedQR = handleScannedQR;
  window.restartScannerForReview = restartScannerForReview;
  window.startScanner = startScanner;
  window.stopScanner = stopScanner;
  window.currentUser = currentUser;
  window.loginUser = loginUser;
  window.registerUser = registerUser;
  window.logoutUser = logoutUser;
  window.myQuizzes = myQuizzes;
  window.visibleStudents = visibleStudents;
  window.visibleClasses = visibleClasses;
  window.visibleSessions = visibleSessions;
}

init();

/* ================================================
   13. PDF 匯出（紙卡）- 1 張卡 = 1 頁 A4
   用 html2canvas 截圖，支援中文字
   ================================================ */

// 答案顏色（hex）
const ANSWER_COLOR = {
  A: '#ef4444',  // 紅
  B: '#3b82f6',  // 藍
  C: '#22c55e',  // 綠
  D: '#eab308',  // 黃
  T: '#16a34a',  // 綠 (剔)
  F: '#dc2626',  // 紅 (交叉)
};

const ANSWER_TEXT = {
  A: 'A', B: 'B', C: 'C', D: 'D',
  T: '✓', F: '✗',
};

async function exportCardsPDF() {
  if (visibleStudents().length === 0) {
    toast('未有學生，無法匯出', 'error');
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('PDF 庫載入失敗，請檢查網絡', 'error');
    return;
  }
  if (!window.html2canvas) {
    toast('截圖庫載入失敗，請檢查網絡', 'error');
    return;
  }

  const totalCards = visibleStudents().length * ANSWER_TYPES.length;
  toast(`生成 PDF 中…（共 ${totalCards} 頁）`, 'success');

  // 創建隱藏的渲染容器（A4 比例：210mm × 297mm）
  const container = document.createElement('div');
  container.id = 'pdf-render-container';
  document.body.appendChild(container);

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  // 改用支援中文嘅字體
  pdf.setFont('helvetica');

  let cardIdx = 0;
  for (const student of state.students) {
    for (const ans of ANSWER_TYPES) {
      // 渲染單張卡到容器
      const color = ANSWER_COLOR[ans.id];
      const ansText = ANSWER_TEXT[ans.id];
      container.innerHTML = `
        <div class="pdf-card" style="--card-color: ${color};">
          <div class="pdf-card-front">
            <div class="pdf-card-label">📷 正面 · QR Code</div>
            <div class="pdf-card-qr-wrap">
              <div class="pdf-card-qr" id="pdf-card-qr-${student.id}-${ans.id}"></div>
            </div>
            <div class="pdf-card-front-type">${ansText}</div>
          </div>
          <div class="pdf-card-fold">
            <span>✂ ─── 剪開 ───</span>
            <span>↕ 對摺線</span>
            <span>─ ── ─ ─ ─</span>
          </div>
          <div class="pdf-card-back">
            <div class="pdf-card-back-label">📝 背面 · 學生資料</div>
            <div class="pdf-card-back-name">${escapeHtml(student.name || '')}</div>
            <div class="pdf-card-back-num">學號 #${student.number}</div>
            <div class="pdf-card-back-type">${ansText}</div>
            <div class="pdf-card-back-footer">${student.id} · ${ans.id}</div>
          </div>
        </div>
      `;

      // 為每張卡生成 QR code
      const qrTarget = document.getElementById(`pdf-card-qr-${student.id}-${ans.id}`);
      try {
        new QRCode(qrTarget, {
          text: `P:${student.id}:${ans.id}`,
          width: 400, height: 400,
          colorDark: '#000000', colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M,
        });
      } catch (e) { console.error('QR 生成失敗', e); }

      // 等待 QR code 渲染
      await new Promise(r => setTimeout(r, 100));

      // 截圖（嚴格用 210mm × 297mm 容器）
      let canvas;
      try {
        canvas = await html2canvas(container, {
          scale: 2,
          backgroundColor: '#ffffff',
          logging: false,
          useCORS: true,
          width: 793,   // 210mm @ 96dpi
          height: 1122, // 297mm @ 96dpi
          windowWidth: 793,
          windowHeight: 1122,
        });
      } catch (e) {
        console.error('html2canvas 失敗', e);
        toast('截圖失敗：' + e.message, 'error');
        container.remove();
        return;
      }

      // 加到 PDF
      if (cardIdx > 0) pdf.addPage();
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      // 210mm × 297mm = 整頁
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);

      cardIdx++;
      // 更新 toast 進度
      if (cardIdx % 3 === 0) {
        toast(`生成 PDF 中…（${cardIdx}/${totalCards}）`, 'success');
      }
    }
  }

  // 清理
  container.remove();

  const filename = `ClassView-紙卡-${visibleStudents().length}位學生-${formatDate(Date.now())}.pdf`;
  pdf.save(filename);
  toast(`✓ PDF 已下載：${filename}（${cardIdx} 頁）`, 'success');
}

/* ================================================
   14. EXCEL 報告匯出（使用 SheetJS）
   ================================================ */
function exportSessionExcel(sid) {
  const session = visibleSessions().find(s => s.id === sid);
  if (!session) { toast('找不到 session', 'error'); return; }
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  if (!quiz) { toast('題目已被刪除', 'error'); return; }
  if (!window.XLSX) { toast('EXCEL 庫未載入', 'error'); return; }

  // 班級範圍
  const clsId = session.classId || 'all';
  const sessStudents = (clsId === 'all' || !clsId)
    ? state.students
    : visibleStudents().filter(s => s.classId === clsId);
  const sessClassName = clsId === 'all' ? '全部' : className(clsId);

  const ansLabel = (q, ans) => {
    if (!ans) return '';
    if (q.type === 'tf') return ans === 'T' ? '✓對' : '✗錯';
    return ans;
  };
  const correctLabel = (q) => {
    if (!q.correct) return '';
    if (q.type === 'tf') return q.correct === 'T' ? '✓對' : '✗錯';
    return q.correct;
  };

  // Sheet 1: 總覽
  let totalCorrect = 0, totalAnswered = 0, totalPossible = sessStudents.length * quiz.questions.length;
  const summary = [
    ['答題報告'],
    ['測驗名稱', quiz.title],
    ['班級', sessClassName],
    ['開始時間', formatDate(session.startedAt)],
    ['結束時間', session.finishedAt ? formatDate(session.finishedAt) : '進行中'],
    ['班級人數', sessStudents.length],
    ['題目數量', quiz.questions.length],
    ['總作答數', ''],
    ['總答對數', ''],
    ['總題數', totalPossible],
    ['整體正確率', ''],
  ];
  sessStudents.forEach(stu => {
    quiz.questions.forEach(q => {
      const ans = session.answers[stu.id]?.[q.id];
      if (ans) {
        totalAnswered++;
        if (ans === q.correct) totalCorrect++;
      }
    });
  });
  summary[7][1] = totalAnswered;
  summary[8][1] = totalCorrect;
  summary[10][1] = totalPossible > 0 ? Math.round((totalCorrect / totalPossible) * 100) + '%' : '0%';

  // Sheet 2: 學生詳細
  const studentHeader = ['姓名', '編號', '班級', '作答數', '答對數', '正確率', ...quiz.questions.map((_, i) => `Q${i + 1} (${quiz.questions[i].type === 'tf' ? '✓/✗' : 'A/B/C/D'})`)];
  const studentRows = sessStudents.map(stu => {
    const cells = [stu.name, stu.number, className(stu.classId)];
    let correct = 0, answered = 0;
    const answers = quiz.questions.map(q => {
      const ans = session.answers[stu.id]?.[q.id] || '';
      if (ans) { answered++; if (ans === q.correct) correct++; }
      return ansLabel(q, ans);
    });
    cells.push(answered, correct, `${quiz.questions.length > 0 ? Math.round((correct / quiz.questions.length) * 100) : 0}%`);
    return [...cells, ...answers];
  });

  // Sheet 3: 題目分析
  const qHeader = ['題目', '題型', '正確答案', '選項A', '選項B', '選項C', '選項D', '作答人數', '答對人數', '正確率'];
  const qRows = quiz.questions.map((q, i) => {
    const ansAB = q.options.map(o => o.text);
    const answeredCount = sessStudents.filter(s => session.answers[s.id]?.[q.id]).length;
    const correctCount = sessStudents.filter(s => session.answers[s.id]?.[q.id] === q.correct).length;
    const rate = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
    return [
      `Q${i + 1}: ${q.text}`,
      q.type === 'tf' ? '是非題' : '選擇題',
      correctLabel(q),
      ansAB[0] || (q.type === 'tf' ? '✓對' : ''),
      ansAB[1] || (q.type === 'tf' ? '✗錯' : ''),
      ansAB[2] || '',
      ansAB[3] || '',
      answeredCount,
      correctCount,
      rate + '%',
    ];
  });

  // Sheet 4: 原始答案
  const rawHeader = ['學生', '編號', '班級', ...quiz.questions.map((_, i) => `Q${i + 1}`)];
  const rawRows = sessStudents.map(stu => {
    const cells = [stu.name, stu.number, className(stu.classId)];
    quiz.questions.forEach(q => {
      cells.push(ansLabel(q, session.answers[stu.id]?.[q.id] || ''));
    });
    return cells;
  });
  const correctRow = ['正確答案', '', '', ...quiz.questions.map(q => correctLabel(q))];

  // 用 SheetJS 生成 xlsx
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(summary);
  const ws2 = XLSX.utils.aoa_to_sheet([studentHeader, ...studentRows]);
  const ws3 = XLSX.utils.aoa_to_sheet([qHeader, ...qRows]);
  const ws4 = XLSX.utils.aoa_to_sheet([rawHeader, ...rawRows, correctRow]);
  XLSX.utils.book_append_sheet(wb, ws1, '總覽');
  XLSX.utils.book_append_sheet(wb, ws2, '學生詳細');
  XLSX.utils.book_append_sheet(wb, ws3, '題目分析');
  XLSX.utils.book_append_sheet(wb, ws4, '原始答案');

  const filename = `ClassView-報告-${quiz.title}-${sessClassName}-${formatDate(session.startedAt).replace(/[/: ]/g, '-')}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast(`✓ EXCEL 已下載：${filename}`, 'success');
}

/* ================================================
   15. PDF 報告匯出（html2canvas + jsPDF）
   ================================================ */
async function exportSessionPDF(sid) {
  const session = visibleSessions().find(s => s.id === sid);
  if (!session) { toast('找不到 session', 'error'); return; }
  const quiz = myQuizzes().find(q => q.id === session.quizId);
  if (!quiz) { toast('題目已被刪除', 'error'); return; }
  if (!window.html2canvas || !window.jspdf) { toast('PDF 庫未載入', 'error'); return; }

  // 班級範圍
  const clsId = session.classId || 'all';
  const sessStudents = (clsId === 'all' || !clsId)
    ? state.students
    : visibleStudents().filter(s => s.classId === clsId);
  const sessClassName = clsId === 'all' ? '全部' : className(clsId);

  toast('生成 PDF 報告中…', 'success');

  // 計算資料
  const ansLabel = (q, ans) => {
    if (!ans) return '—';
    if (q.type === 'tf') return ans === 'T' ? '✓' : '✗';
    return ans;
  };
  const correctLabel = (q) => q.type === 'tf' ? (q.correct === 'T' ? '✓' : '✗') : q.correct;

  const results = sessStudents.map(s => {
    const perQ = quiz.questions.map(q => {
      const ans = session.answers[s.id]?.[q.id] || '';
      return { q, ans, isCorrect: ans && ans === q.correct };
    });
    const correct = perQ.filter(p => p.isCorrect).length;
    const answered = perQ.filter(p => p.ans).length;
    return { student: s, correct, answered, total: quiz.questions.length, perQuestion: perQ };
  });

  const totalCorrect = results.reduce((s, r) => s + r.correct, 0);
  const totalAnswered = results.reduce((s, r) => s + r.answered, 0);
  const totalPossible = sessStudents.length * quiz.questions.length;
  const accuracy = totalPossible > 0 ? Math.round((totalCorrect / totalPossible) * 100) : 0;
  const participation = sessStudents.length > 0 ? Math.round((results.filter(r => r.answered > 0).length / sessStudents.length) * 100) : 0;

  // 建立隱藏容器渲染報告
  const container = document.createElement('div');
  container.id = 'pdf-report-container';
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: -10000px;
    width: 210mm;
    background: white;
    font-family: "Microsoft JhengHei", "PingFang TC", "Heiti TC", "Noto Sans TC", system-ui, sans-serif;
    color: #1a1a1a;
  `;

  // 學校 banner
  const schoolBanner = `<div style="background: linear-gradient(90deg, #1e3a8a 0%, #2563eb 50%, #1e3a8a 100%); color: white; text-align: center; padding: 10px; font-size: 18px; font-weight: 900; letter-spacing: 4px; border-bottom: 2px solid #fbbf24;">匡智張玉瓊晨輝學校</div>`;

  // 標題
  const titleSection = `
    <div style="padding: 20px 16px 8px; text-align: center;">
      <div style="font-size: 32px; font-weight: 900; color: #1e40af; margin-bottom: 4px;">📊 答題報告</div>
      <div style="font-size: 18px; color: #555;">${escapeHtml(quiz.title)} · ${escapeHtml(sessClassName)}</div>
      <div style="font-size: 12px; color: #888; margin-top: 4px;">${formatDate(session.startedAt)}${session.finishedAt ? ' ~ ' + formatDate(session.finishedAt) : ''}</div>
    </div>
  `;

  // 整體概覽
  const overviewSection = `
    <div style="padding: 0 16px 12px;">
      <div style="font-size: 18px; font-weight: 800; color: #1e40af; margin-bottom: 8px; border-bottom: 2px solid #1e40af; padding-bottom: 4px;">📈 整體概覽</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px;">
        <div style="padding: 10px; background: #eff6ff; border-radius: 6px; text-align: center;">
          <div style="font-size: 24px; font-weight: 800; color: #2563eb;">${sessStudents.length}</div>
          <div style="font-size: 11px; color: #555;">參與人數</div>
        </div>
        <div style="padding: 10px; background: #fef3c7; border-radius: 6px; text-align: center;">
          <div style="font-size: 24px; font-weight: 800; color: #d97706;">${participation}%</div>
          <div style="font-size: 11px; color: #555;">參與率</div>
        </div>
        <div style="padding: 10px; background: #d1fae5; border-radius: 6px; text-align: center;">
          <div style="font-size: 24px; font-weight: 800; color: #16a34a;">${totalCorrect}/${totalPossible}</div>
          <div style="font-size: 11px; color: #555;">答對/總題數</div>
        </div>
        <div style="padding: 10px; background: #fce7f3; border-radius: 6px; text-align: center;">
          <div style="font-size: 24px; font-weight: 800; color: #be185d;">${accuracy}%</div>
          <div style="font-size: 11px; color: #555;">整體正確率</div>
        </div>
      </div>
    </div>
  `;

  // 學生詳細表
  const qHeaders = quiz.questions.map((_, i) => `<th style="padding: 6px 4px; background: #f3f4f6; border: 1px solid #d1d5db; font-size: 11px; min-width: 50px;">Q${i + 1}</th>`).join('');
  const studentRows = results
    .slice()
    .sort((a, b) => b.correct - a.correct)
    .map(r => {
      const acc = r.total > 0 ? Math.round((r.correct / r.total) * 100) : 0;
      const perQ = r.perQuestion.map(p => {
        const sym = p.isCorrect ? '✓' : (p.ans ? '✗' : '·');
        const color = p.isCorrect ? '#16a34a' : (p.ans ? '#dc2626' : '#9ca3af');
        return `<td style="padding: 6px 4px; border: 1px solid #d1d5db; text-align: center; color: ${color}; font-weight: 700;">${sym}</td>`;
      }).join('');
      return `
        <tr>
          <td style="padding: 6px 8px; border: 1px solid #d1d5db; font-weight: 700;">${escapeHtml(r.student.name)}</td>
          <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center;">#${r.student.number}</td>
          <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center;">${r.answered}/${r.total}</td>
          <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center; font-weight: 700; color: ${acc >= 80 ? '#16a34a' : (acc <= 30 ? '#dc2626' : '#1a1a1a')};">${acc}%</td>
          ${perQ}
        </tr>
      `;
    }).join('');

  const studentSection = `
    <div style="padding: 0 16px 12px;">
      <div style="font-size: 18px; font-weight: 800; color: #1e40af; margin-bottom: 8px; border-bottom: 2px solid #1e40af; padding-bottom: 4px;">👨‍🎓 學生詳細作答</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr>
            <th style="padding: 6px 8px; background: #f3f4f6; border: 1px solid #d1d5db; text-align: left;">姓名</th>
            <th style="padding: 6px 8px; background: #f3f4f6; border: 1px solid #d1d5db;">編號</th>
            <th style="padding: 6px 8px; background: #f3f4f6; border: 1px solid #d1d5db;">作答</th>
            <th style="padding: 6px 8px; background: #f3f4f6; border: 1px solid #d1d5db;">正確率</th>
            ${qHeaders}
          </tr>
        </thead>
        <tbody>${studentRows}</tbody>
      </table>
    </div>
  `;

  // 題目分析
  const qDistRows = quiz.questions.map((q, i) => {
    const ansAB = q.options.map(o => o.text);
    const answeredCount = visibleStudents().filter(s => session.answers[s.id]?.[q.id]).length;
    const correctCount = visibleStudents().filter(s => session.answers[s.id]?.[q.id] === q.correct).length;
    const rate = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
    const isTf = q.type === 'tf';
    const optIds = isTf ? ['T', 'F'] : ['A', 'B', 'C', 'D'];
    const distCells = optIds.map(opt => {
      const count = visibleStudents().filter(s => session.answers[s.id]?.[q.id] === opt).length;
      const isCorrect = opt === q.correct;
      return `<td style="padding: 4px; border: 1px solid #d1d5db; text-align: center; ${isCorrect ? 'background: #d1fae5; font-weight: 700; color: #16a34a;' : ''}">${isCorrect ? count + ' ✓' : count}</td>`;
    }).join('');
    return `
      <tr>
        <td style="padding: 6px; border: 1px solid #d1d5db; vertical-align: top;">
          <div style="font-weight: 700;">Q${i + 1}</div>
          <div style="font-size: 11px; color: #555; margin-top: 2px;">${escapeHtml(q.text.length > 40 ? q.text.slice(0, 40) + '…' : q.text)}</div>
        </td>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center;">${correctLabel(q)}</td>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center;">${answeredCount}/${visibleStudents().length}</td>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center; font-weight: 700; color: #16a34a;">${correctCount}</td>
        <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center; font-weight: 700;">${rate}%</td>
        ${distCells}
      </tr>
    `;
  }).join('');

  const optHeaders = quiz.questions[0]?.type === 'tf'
    ? '<th style="padding: 4px; background: #f3f4f6; border: 1px solid #d1d5db;">✓</th><th style="padding: 4px; background: #f3f4f6; border: 1px solid #d1d5db;">✗</th>'
    : '<th style="padding: 4px; background: #f3f4f6; border: 1px solid #d1d5db;">A</th><th style="padding: 4px; background: #f3f4f6; border: 1px solid #d1d5db;">B</th><th style="padding: 4px; background: #f3f4f6; border: 1px solid #d1d5db;">C</th><th style="padding: 4px; background: #f3f4f6; border: 1px solid #d1d5db;">D</th>';

  const qSection = `
    <div style="padding: 0 16px 12px;">
      <div style="font-size: 18px; font-weight: 800; color: #1e40af; margin-bottom: 8px; border-bottom: 2px solid #1e40af; padding-bottom: 4px;">📊 各題分析（選項分佈）</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr>
            <th style="padding: 6px; background: #f3f4f6; border: 1px solid #d1d5db; text-align: left;">題目</th>
            <th style="padding: 6px; background: #f3f4f6; border: 1px solid #d1d5db;">正確答案</th>
            <th style="padding: 6px; background: #f3f4f6; border: 1px solid #d1d5db;">作答</th>
            <th style="padding: 6px; background: #f3f4f6; border: 1px solid #d1d5db;">答對</th>
            <th style="padding: 6px; background: #f3f4f6; border: 1px solid #d1d5db;">正確率</th>
            ${optHeaders}
          </tr>
        </thead>
        <tbody>${qDistRows}</tbody>
      </table>
    </div>
  `;

  // 學生排名
  const ranking = results
    .slice()
    .sort((a, b) => b.correct - a.correct)
    .map((r, i) => {
      const acc = r.total > 0 ? Math.round((r.correct / r.total) * 100) : 0;
      const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${i + 1}.`));
      return `
        <tr>
          <td style="padding: 6px 12px; border: 1px solid #d1d5db; font-size: 16px; font-weight: 700; width: 50px;">${medal}</td>
          <td style="padding: 6px 8px; border: 1px solid #d1d5db; font-weight: 700;">${escapeHtml(r.student.name)}</td>
          <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center;">#${r.student.number}</td>
          <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center; font-weight: 700;">${r.correct}/${r.total}</td>
          <td style="padding: 6px 8px; border: 1px solid #d1d5db; text-align: center; font-weight: 700; color: #16a34a;">${acc}%</td>
        </tr>
      `;
    }).join('');

  const rankingSection = `
    <div style="padding: 0 16px 16px;">
      <div style="font-size: 18px; font-weight: 800; color: #1e40af; margin-bottom: 8px; border-bottom: 2px solid #1e40af; padding-bottom: 4px;">🏆 學生排名</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr>
            <th style="padding: 6px; background: #f3f4f6; border: 1px solid #d1d5db; text-align: left;">名次</th>
            <th style="padding: 6px 8px; background: #f3f4f6; border: 1px solid #d1d5db; text-align: left;">姓名</th>
            <th style="padding: 6px 8px; background: #f3f4f6; border: 1px solid #d1d5db; text-align: center;">編號</th>
            <th style="padding: 6px 8px; background: #f3f4f6; border: 1px solid #d1d5db; text-align: center;">答對</th>
            <th style="padding: 6px 8px; background: #f3f4f6; border: 1px solid #d1d5db; text-align: center;">正確率</th>
          </tr>
        </thead>
        <tbody>${ranking}</tbody>
      </table>
    </div>
  `;

  // 頁尾
  const footer = `
    <div style="padding: 12px 16px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #e5e7eb;">
      本報告由 ClassView 答題卡自動生成 · ${formatDate(Date.now())}
    </div>
  `;

  container.innerHTML = schoolBanner + titleSection + overviewSection + studentSection + qSection + rankingSection + footer;
  document.body.appendChild(container);

  await new Promise(r => setTimeout(r, 200));

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      width: 793,
      windowWidth: 793,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pageW = 210, pageH = 297;
    const imgH = canvas.height * (pageW / canvas.width);
    let heightLeft = imgH;
    let position = 0;

    pdf.addImage(imgData, 'JPEG', 0, position, pageW, imgH);
    heightLeft -= pageH;

    while (heightLeft > 0) {
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, pageW, imgH);
      heightLeft -= pageH;
    }

    const filename = `ClassView-報告-${quiz.title}-${formatDate(session.startedAt).replace(/[/: ]/g, '-')}.pdf`;
    pdf.save(filename);
    toast(`✓ PDF 報告已下載：${filename}`, 'success');
  } catch (e) {
    console.error('PDF 報告錯誤', e);
    toast('PDF 報告生成失敗：' + e.message, 'error');
  } finally {
    container.remove();
  }
}
