
// V3.1: display Drive images without changing stored URLs.
function assetImageCandidates(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.protocol !== 'https:') return [];
    if (u.hostname === 'drive.google.com') {
      const id = u.searchParams.get('id') || u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1];
      if (id && /^[\w-]+$/.test(id)) {
        const key = u.searchParams.get('resourcekey');
        const extra = key ? '&resourcekey=' + encodeURIComponent(key) : '';
        return ['https://drive.google.com/thumbnail?id='+id+'&sz=w1000'+extra,
          'https://drive.google.com/uc?export=view&id='+id+extra];
      }
    }
    return [u.href];
  } catch (_) { return []; }
}
function showAssetImage(img, placeholder, label, link, value) {
  const urls = assetImageCandidates(value);
  let index = 0;
  img.onload = img.onerror = null;
  img.removeAttribute('src');
  img.classList.add('hidden');
  placeholder?.classList.remove('hidden');
  if (link) { link.classList.add('hidden'); link.onclick = null; }
  img.onclick = null;
  if (label) label.textContent = urls.length ? 'กำลังโหลดรูปภาพ...' : 'ยังไม่มีรูปภาพ';
  if (!urls.length) return;
  img.onload = () => {
    img.classList.remove('hidden'); placeholder?.classList.add('hidden');
    if (label) label.textContent = 'รูปภาพในทะเบียน';
  };
  img.onerror = () => {
    if (++index < urls.length) { img.src = urls[index]; return; }
    img.classList.add('hidden'); placeholder?.classList.remove('hidden');
    if (label) label.textContent = 'โหลดรูปไม่สำเร็จ';
  };
  if (link) { link.onclick = () => openAssetImageModal(value); link.classList.remove('hidden'); }
  img.onclick = () => openAssetImageModal(value);
  img.src = urls[0];
}
const API_URL = 'https://script.google.com/macros/s/AKfycbx_D0_q4I_nRMfxy_z7abun7sWWmGxwRw6tiTslKrb_K4HQOyb75WlfCwwVXjfv5DBWOw/exec';

let allAssets = [];
let auditedMap = {};
let html5QrCode = null;
let isScanning = false;
let isScanHandling = false;
let isLoggingIn = false;
let currentUser = null;
let compressedImageBase64 = '';
let tempAvatarBase64 = '';
let latestStats = { total: 0, audited: 0 };
let activeScreen = "home", dashboardFilter = "", dashboardLimit = 30, loadingDepth = 0, dataReady = false, reportSequence = 0;
let loadingPercent = 0;
function loadingProgress(percent, message) {
  loadingPercent = Math.max(loadingPercent, percent);
  document.getElementById('loadingPercent45').textContent = loadingPercent + '%';
  document.getElementById('loadingBar45').style.width = loadingPercent + '%';
  document.getElementById('loadingTrack45').setAttribute('aria-valuenow', loadingPercent);
  if (message) document.getElementById('loadingMessage45').textContent = message;
}
function loadingStart(){
  if (loadingDepth++ === 0) {
    loadingPercent = 0;
    loadingProgress(0, 'กำลังเชื่อมต่อระบบ');
    document.getElementById('dataLoading').classList.remove('hidden');
  }
}
function loadingEnd(){
  if (--loadingDepth <= 0) {
    loadingDepth = 0;
    document.getElementById('dataLoading').classList.add('hidden');
  }
}
function escape44(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function auditGroup(a){const l=auditedMap[a.assetCode]; if(!l)return "pending"; if(["ใช้งานได้","ปกติ"].includes(l.status))return "normal"; if(["ชำรุด","เสื่อมสภาพ/รอจำหน่าย"].includes(l.status))return "damaged"; if(["สูญหาย","ไม่พบ"].includes(l.status))return "lost"; return "other";}
function chooseDashboardFilter(v){dashboardFilter=v;dashboardLimit=30;document.getElementById("dashboardSearch").value="";renderDashboardFilter();}
function renderDashboardFilter(){const panel=document.getElementById("dashboardResults"); if(!dashboardFilter){panel.classList.add("hidden");return;} panel.classList.remove("hidden");document.querySelectorAll("[data-audit-filter]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.auditFilter===dashboardFilter)));const q=document.getElementById("dashboardSearch").value.toLowerCase();const rows=allAssets.filter(a=>a.status!=="จำหน่าย"&&auditGroup(a)===dashboardFilter&&`${a.assetCode} ${a.assetName} ${a.location}`.toLowerCase().includes(q));document.getElementById("dashboardTitle").textContent=({normal:"ปกติ",damaged:"ชำรุด",lost:"ไม่พบ",pending:"รอตรวจ"})[dashboardFilter]+" · "+rows.length+" รายการ";document.getElementById("dashboardItems").innerHTML=rows.slice(0,dashboardLimit).map(a=>`<button type="button" data-code="${escape44(a.assetCode)}" class="w-full text-left bg-white border rounded-xl p-3"><div class="font-semibold text-sm">${escape44(a.assetName)}</div><div class="text-xs text-slate-500">${escape44(a.assetCode)} · ${escape44(a.location)}</div></button>`).join("")||"<p class=\"text-center text-slate-500 p-4\">ไม่มีรายการ</p>";document.getElementById("dashboardMore").classList.toggle("hidden",rows.length<=dashboardLimit);}

let execDonutChartInstance = null;
let execDeptChartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('loginForm').reset();
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPin').value = '';
  updatePinDots();
  const usernameField = document.getElementById('loginUsername');
  usernameField.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && document.getElementById('loginPin').value.length < 4) { e.preventDefault(); document.getElementById('pinKeypad').focus(); }
  });
  document.getElementById('loginForm').addEventListener('keydown', e => {
    if (e.target === usernameField || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); pressPin(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); backspacePin(); }
  });
  const savedSession = localStorage.getItem('asset_user_session');
  if (savedSession) {
    currentUser = JSON.parse(savedSession);
    try { const auth = await adminApi("login"); currentUser = {...currentUser, ...auth.user}; localStorage.setItem("asset_user_session", JSON.stringify(currentUser)); } catch(e) { localStorage.removeItem("asset_user_session"); currentUser=null; return; }
    applyRolePermissions();
    await initData();
  }
});

function updatePinDots() {
  const val = document.getElementById('loginPin').value || '';
  const countLabel = document.getElementById('pinCountLabel');
  if (countLabel) countLabel.innerText = `${val.length} / 4 หลัก`;

  const dots = document.querySelectorAll('#pinDotsDisplay .pin-dot');
  dots.forEach((dot, idx) => {
    if (idx < val.length) {
      dot.style.backgroundColor = '#2563eb';
      dot.style.transform = 'scale(1.15)';
    } else {
      dot.style.backgroundColor = '#cbd5e1';
      dot.style.transform = 'scale(1)';
    }
  });
}

function pressPin(digit) {
  if (isLoggingIn || !/^\d$/.test(String(digit))) return;
  const username = document.getElementById('loginUsername');
  if (!username.value.trim()) { setLoginMessage('กรุณากรอกชื่อผู้ใช้ก่อน'); username.focus(); return; }
  const pinInput = document.getElementById('loginPin');
  if (pinInput.value.length >= 4) return;
  if (document.activeElement === username) username.blur();
  setLoginMessage('');
  pinInput.value += String(digit);
  updatePinDots();
  if (pinInput.value.length === 4) handleLogin();
}

function setLoginMessage(message) {
  document.getElementById('loginMessage').textContent = message;
}
function setLoginBusy(busy) {
  isLoggingIn = busy;
  const form = document.getElementById('loginForm');
  form.setAttribute('aria-busy', String(busy));
  document.getElementById('loginUsername').readOnly = busy;
  form.querySelectorAll('button').forEach(b => b.disabled = busy);
  document.getElementById('loginSubmit').textContent = busy ? 'กำลังตรวจสอบสิทธิ์...' : 'เข้าสู่ระบบ';
}

function backspacePin() {
  if (isLoggingIn) return;
  const pinInput = document.getElementById('loginPin');
  pinInput.value = pinInput.value.slice(0, -1);
  updatePinDots();
}

function clearPin() {
  if (isLoggingIn) return;
  document.getElementById('loginPin').value = '';
  updatePinDots();
}

async function initData() {
  loadingStart();
  try { let completed = 0;
    const stageDone = () => loadingProgress(++completed * 25, 'กำลังโหลดทะเบียนและรอบตรวจ');
    await Promise.all([refreshCycles(true).then(stageDone), fetchAssets().then(stageDone)]);
    await loadAuditStatus(); dataReady=true; } catch(err){ Swal.fire("โหลดข้อมูลไม่สำเร็จ",err.message,"error"); return; } finally { loadingEnd(); }

  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('code');
  if (codeParam && currentUser && (currentUser.role === 'admin' || currentUser.role === 'user')) {
    openInspectScreen(codeParam);
  }
}

async function handleLogin(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  if (isLoggingIn || currentUser) return;
  const username = document.getElementById('loginUsername').value.trim();
  const pin = document.getElementById('loginPin').value.replace(/\D/g, '');

  if (!username || !/^\d{4}$/.test(pin)) {
    setLoginMessage(!username ? 'กรุณากรอกชื่อผู้ใช้' : 'กรุณากรอก PIN ให้ครบ 4 หลัก');
    return;
  }
  setLoginMessage('');
  setLoginBusy(true);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'login', username, pin })
    });
    const json = await res.json();
    if (json.status === 'success') {
      const savedProfiles = JSON.parse(localStorage.getItem('asset_user_profiles') || '{}');
      const custom = savedProfiles[json.user.username] || {};
      currentUser = {
        ...json.user,
        pin,
        org: custom.org || json.user.org || 'กองวิชาวิศวกรรมการบิน',
        email: custom.email || json.user.email || '',
        phone: custom.phone || json.user.phone || '',
        avatar: custom.avatar || json.user.avatar || ''
      };
      localStorage.setItem('asset_user_session', JSON.stringify(currentUser));

      setLoginBusy(false);
      clearPin();
      applyRolePermissions();
      Swal.fire({
        icon: 'success',
        title: `ยินดีต้อนรับ ${currentUser.fullName}`,
        toast: true,
        position: 'top',
        timer: 1000,
        showConfirmButton: false
      });
      initData();
    } else {
      setLoginBusy(false);
      clearPin();
      setLoginMessage(json.message || 'เข้าสู่ระบบไม่สำเร็จ');
    }
  } catch (err) {
    setLoginBusy(false);
    clearPin();
    setLoginMessage('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
  }
}

function getRoleLabel(role) {
  const map = {
    admin: 'ผู้ดูแลระบบ (Admin)',
    user: 'เจ้าหน้าที่ตรวจนับ (User)',
    exec: 'ผู้บริหาร (Exec)'
  };
  return map[role] || role;
}

function applyRolePermissions() {
  document.getElementById('loginModal').classList.add('hidden');
  document.getElementById('appContainer').classList.remove('hidden');
  document.getElementById('formInspector').value = currentUser.fullName;

  const badge = document.getElementById('headerRoleBadge');
  if (badge) {
    badge.innerText = currentUser.role === 'admin' ? 'Admin' : (currentUser.role === 'exec' ? 'ผู้บริหาร' : 'User');
  }

  renderBottomNavByRole();
  renderProfileUI();
  switchScreen('home');
}

function renderBottomNavByRole() {
  const navContainer = document.getElementById('bottomNavContainer');
  if (!navContainer || !currentUser) return;

  if (currentUser.role === 'exec') {
    navContainer.className = 'max-w-md mx-auto grid grid-cols-4 items-center py-1.5 text-[10px] font-medium';
    navContainer.innerHTML = `
      <button type="button" onclick="switchScreen('home')" data-nav="home" class="bnav-btn flex flex-col items-center justify-center py-1 text-blue-600">
        <i class="bi bi-pie-chart-fill text-lg leading-none mb-1"></i>
        <span>ภาพรวม</span>
      </button>
      <button type="button" onclick="switchScreen('exec-analytics')" data-nav="exec-analytics" class="bnav-btn flex flex-col items-center justify-center py-1 text-slate-400">
        <i class="bi bi-bar-chart-line-fill text-lg leading-none mb-1"></i>
        <span>วิเคราะห์</span>
      </button>
      <button type="button" onclick="switchScreen('exec-reports')" data-nav="exec-reports" class="bnav-btn flex flex-col items-center justify-center py-1 text-slate-400">
        <i class="bi bi-file-earmark-bar-graph text-lg leading-none mb-1"></i>
        <span>รายงาน</span>
      </button>
      <button type="button" onclick="switchScreen('profile')" data-nav="profile" class="bnav-btn flex flex-col items-center justify-center py-1 text-slate-400">
        <i class="bi bi-person text-lg leading-none mb-1"></i>
        <span>โปรไฟล์</span>
      </button>
    `;
    return;
  }

  if (currentUser.role === 'admin') {
    navContainer.className = 'max-w-md mx-auto grid grid-cols-5 items-center py-1.5 text-[10px] font-medium';
    navContainer.innerHTML = `
      <button type="button" onclick="switchScreen('home')" data-nav="home" class="bnav-btn flex flex-col items-center justify-center py-1 text-blue-600">
        <i class="bi bi-house-door-fill text-lg leading-none mb-1"></i>
        <span>หน้าหลัก</span>
      </button>
      <button type="button" onclick="switchScreen('list')" data-nav="list" class="bnav-btn flex flex-col items-center justify-center py-1 text-slate-400">
        <i class="bi bi-box-seam text-lg leading-none mb-1"></i>
        <span>ทะเบียน</span>
      </button>
      <button type="button" onclick="openScannerScreen()" data-nav="scanner" class="flex flex-col items-center justify-center -mt-4">
        <span class="w-11 h-11 rounded-2xl bg-blue-600 text-white shadow-md flex items-center justify-center text-xl">
          <i class="bi bi-qr-code-scan"></i>
        </span>
      </button>
      <button type="button" onclick="switchScreen('admin')" data-nav="admin" class="bnav-btn flex flex-col items-center justify-center py-1 text-slate-400">
        <i class="bi bi-sliders text-lg leading-none mb-1"></i>
        <span>จัดการ</span>
      </button>
      <button type="button" onclick="switchScreen('profile')" data-nav="profile" class="bnav-btn flex flex-col items-center justify-center py-1 text-slate-400">
        <i class="bi bi-person text-lg leading-none mb-1"></i>
        <span>โปรไฟล์</span>
      </button>
    `;
    return;
  }

  navContainer.className = 'max-w-md mx-auto grid grid-cols-5 items-center py-1.5 text-[10px] font-medium';
  navContainer.innerHTML = `
    <button type="button" onclick="switchScreen('home')" data-nav="home" class="bnav-btn flex flex-col items-center justify-center py-1 text-blue-600">
      <i class="bi bi-house-door-fill text-lg leading-none mb-1"></i>
      <span>หน้าหลัก</span>
    </button>
    <button type="button" onclick="switchScreen('list')" data-nav="list" class="bnav-btn flex flex-col items-center justify-center py-1 text-slate-400">
      <i class="bi bi-list-ul text-lg leading-none mb-1"></i>
      <span>รายการ</span>
    </button>
    <button type="button" onclick="openScannerScreen()" data-nav="scanner" class="flex flex-col items-center justify-center -mt-4">
      <span class="w-11 h-11 rounded-2xl bg-blue-600 text-white shadow-md flex items-center justify-center text-xl">
        <i class="bi bi-qr-code-scan"></i>
      </span>
    </button>
    <button type="button" onclick="switchScreen('history')" data-nav="history" class="bnav-btn flex flex-col items-center justify-center py-1 text-slate-400">
      <i class="bi bi-clock-history text-lg leading-none mb-1"></i>
      <span>ประวัติ</span>
    </button>
    <button type="button" onclick="switchScreen('profile')" data-nav="profile" class="bnav-btn flex flex-col items-center justify-center py-1 text-slate-400">
      <i class="bi bi-person text-lg leading-none mb-1"></i>
      <span>โปรไฟล์</span>
    </button>
  `;
}

function renderProfileUI() {
  if (!currentUser) return;
  const org = currentUser.org || 'ไม่ระบุหน่วยงาน';
  const email = currentUser.email || '-';
  const phone = currentUser.phone || '-';
  const roleText = getRoleLabel(currentUser.role);

  document.getElementById('profDisplayName').innerText = currentUser.fullName;
  document.getElementById('profDisplayOrg').innerText = `หน่วยงาน: ${org}`;
  document.getElementById('profDisplayRole').innerText = roleText;

  document.getElementById('profViewEmail').innerText = email;
  document.getElementById('profViewPhone').innerText = phone;
  document.getElementById('profViewOrg').innerText = org;
  document.getElementById('profViewRole').innerText = roleText;

  const avatarImg = document.getElementById('profAvatarImg');
  const avatarFallback = document.getElementById('profAvatarFallback');
  if (currentUser.avatar) {
    avatarImg.src = currentUser.avatar;
    avatarImg.classList.remove('hidden');
    avatarFallback.classList.add('hidden');
  } else {
    avatarImg.classList.add('hidden');
    avatarFallback.classList.remove('hidden');
  }
}

function toggleEditProfile() {
  tempAvatarBase64 = currentUser.avatar || '';
  document.getElementById('profileViewMode').classList.add('hidden');
  document.getElementById('profileEditForm').classList.remove('hidden');
  document.getElementById('profAvatarUploadLabel').classList.remove('hidden');

  document.getElementById('profInputName').value = currentUser.fullName || '';
  document.getElementById('profInputOrg').value = currentUser.org || '';
  document.getElementById('profInputEmail').value = currentUser.email || '';
  document.getElementById('profInputPhone').value = currentUser.phone || '';

  const roleSelect = document.getElementById('profInputRole');
  roleSelect.value = currentUser.role || 'user';
  roleSelect.disabled = true;
}

function cancelEditProfile() {
  tempAvatarBase64 = '';
  document.getElementById('profileEditForm').classList.add('hidden');
  document.getElementById('profileViewMode').classList.remove('hidden');
  document.getElementById('profAvatarUploadLabel').classList.add('hidden');
  renderProfileUI();
}

function handleAvatarChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const size = 240;
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      tempAvatarBase64 = canvas.toDataURL('image/jpeg', 0.8);
      const avatarImg = document.getElementById('profAvatarImg');
      avatarImg.src = tempAvatarBase64;
      avatarImg.classList.remove('hidden');
      document.getElementById('profAvatarFallback').classList.add('hidden');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function saveProfileChanges(e) {
  e.preventDefault();
  const newName = document.getElementById('profInputName').value.trim();
  const newOrg = document.getElementById('profInputOrg').value.trim();
  const newEmail = document.getElementById('profInputEmail').value.trim();
  const newPhone = document.getElementById('profInputPhone').value.trim();
  const roleSelect = document.getElementById('profInputRole');
  const newRole = currentUser.role;

  currentUser = {
    ...currentUser,
    fullName: newName || currentUser.fullName,
    org: newOrg,
    email: newEmail,
    phone: newPhone,
    role: newRole,
    avatar: tempAvatarBase64 || currentUser.avatar || ''
  };

  localStorage.setItem('asset_user_session', JSON.stringify(currentUser));
  const savedProfiles = JSON.parse(localStorage.getItem('asset_user_profiles') || '{}');
  savedProfiles[currentUser.username] = {
    org: currentUser.org,
    email: currentUser.email,
    phone: currentUser.phone,
    role: currentUser.role,
    avatar: currentUser.avatar
  };
  localStorage.setItem('asset_user_profiles', JSON.stringify(savedProfiles));

  document.getElementById('formInspector').value = currentUser.fullName;
  document.getElementById('profileEditForm').classList.add('hidden');
  document.getElementById('profileViewMode').classList.remove('hidden');
  document.getElementById('profAvatarUploadLabel').classList.add('hidden');

  applyRolePermissions();
  Swal.fire({ icon: 'success', title: 'บันทึกการเปลี่ยนแปลงแล้ว', timer: 1200, showConfirmButton: false });
}

function logout() {
  localStorage.removeItem('asset_user_session');
  currentUser = null;
  document.activeElement?.blur();
  setLoginBusy(false);
  document.getElementById('loginForm').reset();
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPin').value = '';
  setLoginMessage('');
  updatePinDots();
  allAssets = [];
  auditedMap = {};
  compressedImageBase64 = '';
  tempAvatarBase64 = '';
  stopScannerSilently();
  // Reload to discard pending requests, rendered account data and temporary state.
  window.location.reload();
}

function resolveHomeScreenId() {
  if (!currentUser) return 'screen-home-user';
  if (currentUser.role === 'admin') return 'screen-home-admin';
  if (currentUser.role === 'exec') return 'screen-home-exec';
  return 'screen-home-user';
}

function switchScreen(screenName) {
  if (['users','cycles','master'].includes(screenName) && currentUser?.role !== 'admin') return;
  if (activeScreen === 'scanner' && screenName !== 'scanner') stopScannerSilently();
  activeScreen = screenName;

  [
    'screen-home-user',
    'screen-home-admin',
    'screen-home-exec',
    'screen-exec-analytics',
    'screen-exec-reports',
    'screen-scanner',
    'screen-inspect',
    'screen-success',
    'screen-list',
    'screen-history',
    'screen-profile',
    'screen-admin',
    'screen-users', 'screen-cycles', 'screen-master'
  ].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.add('hidden');
  });

  document.querySelectorAll('.bnav-btn').forEach(btn => {
    btn.classList.remove('text-blue-600');
    btn.classList.add('text-slate-400');
    if (btn.dataset.nav === screenName) {
      btn.classList.remove('text-slate-400');
      btn.classList.add('text-blue-600');
    }
  });

  if (screenName === 'home') {
    document.getElementById(resolveHomeScreenId())?.classList.remove('hidden');
    updateSummaryCards();
  } else {
    document.getElementById(`screen-${screenName}`)?.classList.remove('hidden');
  }

  if (screenName === 'list') renderAssetListScreen();
  if (screenName === 'history') renderHistoryScreen();
  if (screenName === 'profile') renderProfileUI();
  if (screenName === 'admin') renderAdminTable();
  if (screenName === 'exec-analytics') renderExecAnalyticsScreen();
}

async function fetchAssets() {
  try {
    const res = await fetch(`${API_URL}?action=getAssets`);
    const json = await res.json();
    if (json.status === 'success') {
      allAssets = json.data;
      if(json.status !== "success") throw Error(json.message);
    } else throw Error(json.message || "โหลดทะเบียนไม่สำเร็จ");
  } catch (err) { throw err; }
}

async function loadAuditStatus() {
  const seq=++reportSequence; loadingStart();
  loadingProgress(loadingPercent, "กำลังดึงผลตรวจครุภัณฑ์ประจำปี");
  const year = document.getElementById('auditYear').value;
  document.getElementById('homeCycleYear').innerText = year;
  if (document.getElementById('admDashYear')) document.getElementById('admDashYear').innerText = year;
  if (document.getElementById('execYearLabel')) document.getElementById('execYearLabel').innerText = year;

  try {
    const res = await fetch(`${API_URL}?action=getAuditReport&year=${year}`);
    const json = await res.json();
    if (json.status === 'success') {
      if(seq!==reportSequence)return;
      dataReady=true;
      auditedMap = json.auditedMap;
      loadingProgress(75, "กำลังประมวลผลรายการ");
      latestStats = { total: json.totalAssets, audited: json.auditedCount };
      updateSummaryCards();
      if(activeScreen === "history") renderHistoryScreen();
      if(activeScreen === "admin") renderAdminTable();
      if(activeScreen === "list") renderAssetListScreen();
      if(activeScreen === "exec-analytics") renderExecAnalyticsScreen();
      renderDashboardFilter();
      if (document.getElementById('formAssetCode').value) updateInspectBadge();
      loadingProgress(100, 'โหลดข้อมูลเรียบร้อย');
    } else throw Error(json.message || "โหลดผลตรวจไม่สำเร็จ");
  } catch (err) { if(seq===reportSequence) { auditedMap={}; dataReady=false; Swal.fire("โหลดผลตรวจไม่สำเร็จ",err.message,"error"); } throw err; } finally { loadingEnd(); }
}

function updateSummaryCards() {
  const activeAssets = allAssets.filter(a => a.status !== 'จำหน่าย');
  const total = latestStats.total || activeAssets.length;
  const audited = latestStats.audited || 0;
  const pending = Math.max(0, total - audited);
  const percent = total > 0 ? Number(((audited / total) * 100).toFixed(1)) : 0;

  let normal = 0, damaged = 0, lost = 0;
  activeAssets.forEach(a=>{const g=auditGroup(a);if(g==="normal")normal++;else if(g==="damaged")damaged++;else if(g==="lost")lost++;});

  document.getElementById('homeProgressPercent').innerText = `${percent}%`;
  document.getElementById('homeProgressBar').style.width = `${percent}%`;
  document.getElementById('homeProgressRatio').innerText = `${audited} / ${total} รายการ`;
  document.getElementById('homeNormal').innerText = normal;
  document.getElementById('homeDamaged').innerText = damaged;
  document.getElementById('homeLost').innerText = lost;
  document.getElementById('homePending').innerText = pending;

  if (currentUser?.role === 'admin' && document.getElementById('admDashPercent')) {
    document.getElementById('admDashPercent').innerText = `${percent}%`;
    document.getElementById('admDashBar').style.width = `${percent}%`;
    document.getElementById('admDashRatio').innerText = `${audited} / ${total}`;
    document.getElementById('admStatTotal').innerText = total;
    document.getElementById('admStatAudited').innerText = audited;
    document.getElementById('admStatPending').innerText = pending;
    document.getElementById('admStatIssue').innerText = damaged + lost;
    renderAdminDashboardLists(damaged + lost);
  }

  if (currentUser?.role === 'exec' && document.getElementById('execTotalAssets')) {
    const totalValue = activeAssets.reduce((sum, a) => sum + (Number(a.price) || 0), 0);
    document.getElementById('execTotalAssets').innerText = total.toLocaleString();
    document.getElementById('execTotalValue').innerText = `฿${totalValue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`;
    document.getElementById('execDonutPercent').innerText = `${percent}%`;
    document.getElementById('execNormal').innerText = normal;
    document.getElementById('execDamaged').innerText = damaged;
    document.getElementById('execLost').innerText = lost;
    document.getElementById('execPending').innerText = pending;
    renderExecutiveChartsAndNotes(activeAssets, audited, pending, normal, damaged, lost);
  }
}

function renderAdminDashboardLists(issueCount) {
  const actionWrap = document.getElementById('adminActionQueueList');
  const recentWrap = document.getElementById('adminRecentAuditList');
  if (!actionWrap || !recentWrap) return;

  const issueItems = Object.values(auditedMap)
    .filter(l => l.status === 'ชำรุด' || l.status === 'สูญหาย' || l.status === 'เสื่อมสภาพ/รอจำหน่าย')
    .slice(-3)
    .reverse();

  document.getElementById('admActionCount').innerText = `${issueCount} รายการ`;

  if (issueItems.length === 0) {
    actionWrap.innerHTML = `<div class="text-slate-400 py-1">ไม่มีรายการชำรุดหรือสูญหายที่ต้องติดตาม</div>`;
  } else {
    actionWrap.innerHTML = issueItems.map(i => `
      <div class="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
        <div class="truncate pr-2">
          <div class="font-semibold text-slate-800 truncate">${i.assetName}</div>
          <div class="text-[10px] text-slate-500 font-mono">${i.assetCode}</div>
        </div>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 flex-shrink-0">${i.status}</span>
      </div>
    `).join('');
  }

  const recentLogs = Object.values(auditedMap).slice(-3).reverse();
  if (recentLogs.length === 0) {
    recentWrap.innerHTML = `<div class="text-slate-400 py-1">ยังไม่มีรายการตรวจล่าสุดในปีนี้</div>`;
  } else {
    recentWrap.innerHTML = recentLogs.map(l => `
      <div class="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
        <div class="truncate pr-2">
          <div class="font-semibold text-slate-800 truncate">${l.assetName}</div>
          <div class="text-[10px] text-slate-500">${l.inspector || '-'} • ${l.auditDate || ''}</div>
        </div>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${getAssetAuditStatus(l.assetCode).color} flex-shrink-0">${getAssetAuditStatus(l.assetCode).label}</span>
      </div>
    `).join('');
  }
}

function groupAssetsByDept(assets) {
  const map = {};
  assets.forEach(a => {
    const rawLoc = String(a.location || 'อื่นๆ').trim();
    const dept = rawLoc.split(/[\/,]/)[0].trim() || 'อื่นๆ';
    if (!map[dept]) map[dept] = { total: 0, audited: 0, value: 0 };
    map[dept].total++;
    map[dept].value += Number(a.price) || 0;
    if (auditedMap[a.assetCode]) map[dept].audited++;
  });
  return Object.entries(map)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);
}

function renderExecutiveChartsAndNotes(activeAssets, audited, pending, normal, damaged, lost) {
  const donutCtx = document.getElementById('execDonutChart');
  if (donutCtx && typeof Chart !== 'undefined') {
    if (execDonutChartInstance) execDonutChartInstance.destroy();
    execDonutChartInstance = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['ปกติ', 'ชำรุด', 'ไม่พบ', 'รอตรวจ'],
        datasets: [{
          data: [normal, damaged, lost, pending],
          backgroundColor: ['#10b981', '#f97316', '#ef4444', '#e2e8f0'],
          borderWidth: 0
        }]
      },
      options: {
        cutout: '72%',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });
  }

  const topDepts = groupAssetsByDept(activeAssets);
  const deptCtx = document.getElementById('execDeptChart');
  if (deptCtx && typeof Chart !== 'undefined') {
    if (execDeptChartInstance) execDeptChartInstance.destroy();
    execDeptChartInstance = new Chart(deptCtx, {
      type: 'bar',
      data: {
        labels: topDepts.map(([d]) => d),
        datasets: [{
          label: 'ความคืบหน้า (%)',
          data: topDepts.map(([, s]) => (s.total > 0 ? Math.round((s.audited / s.total) * 100) : 0)),
          backgroundColor: '#2563eb',
          borderRadius: 8,
          maxBarThickness: 24
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: v => `${v}%`, font: { size: 10 } } },
          x: { ticks: { font: { size: 10 } } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  const notesEl = document.getElementById('execFollowUpList');
  if (notesEl) {
    const notes = [];
    if (damaged > 0) notes.push(`พบครุภัณฑ์ชำรุด ${damaged} รายการ ควรตรวจสอบและซ่อมบำรุงหรือจำหน่าย`);
    if (lost > 0) notes.push(`พบครุภัณฑ์ไม่พบ/สูญหาย ${lost} รายการ ควรเร่งค้นหาตามสถานที่ตั้งเดิม`);
    if (pending > 0) notes.push(`ยังรอตรวจนับอีก ${pending} รายการ เร่งรัดการสแกนให้ครบตามรอบปี`);
    if (notes.length === 0) notes.push('การตรวจนับครุภัณฑ์ดำเนินไปด้วยดี ยังไม่พบประเด็นเร่งด่วน');

    notesEl.innerHTML = notes.map(n => `
      <div class="flex items-start gap-2 bg-slate-50 rounded-xl px-3 py-2 text-slate-700">
        <i class="bi bi-info-circle-fill text-blue-600 mt-0.5 flex-shrink-0"></i>
        <span>${n}</span>
      </div>
    `).join('');
  }
}

function renderExecAnalyticsScreen() {
  const wrap = document.getElementById('execDeptBreakdownCards');
  if (!wrap) return;
  const activeAssets = allAssets.filter(a => a.status !== 'จำหน่าย');
  const depts = groupAssetsByDept(activeAssets);
  wrap.innerHTML = depts.map(([dept, s]) => {
    const pct = s.total > 0 ? ((s.audited / s.total) * 100).toFixed(1) : 0;
    return `
      <div class="bg-slate-50 rounded-xl p-3 space-y-1.5">
        <div class="flex justify-between font-semibold text-slate-800">
          <span>${dept}</span>
          <span class="text-blue-600">${pct}% (${s.audited}/${s.total})</span>
        </div>
        <div class="text-[11px] text-slate-500">มูลค่ารวม: ฿${s.value.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</div>
      </div>
    `;
  }).join('');
}

function downloadExecutivePDF() {
  window.print();
}

function downloadExecutiveExcel() {
  exportReportCSV();
}

async function adminApi(action, fields={}) {
  const res=await fetch(API_URL,{method:'POST',body:JSON.stringify({...fields,action,username:currentUser.username,pin:currentUser.pin})});
  const j=await res.json(); if(j.status!=='success') throw Error(j.message||'เกิดข้อผิดพลาด'); return j;
}
let auditCycles=[];
async function refreshCycles(initial=false){
  const j=await adminApi('getCycles'); auditCycles=j.data;
  const el=document.getElementById('auditYear'), old=el.value;
  el.replaceChildren();
  for(const r of auditCycles){const o=new Option('ปี '+r.year+(r.open?' • เปิด':' • ปิด'),r.year);el.add(o);}
  const preferred=initial?auditCycles.find(r=>r.open)?.year:old;
  if(auditCycles.some(r=>String(r.year)===String(preferred)))el.value=preferred;
  if(!auditCycles.length)el.add(new Option('ยังไม่มีรอบตรวจ',''));
}
let cycleBusy47=false, cycleOriginal47=null;
const cy47=id=>document.getElementById(id);
function openAuditCycleModal(){if(currentUser?.role!=='admin')return;switchScreen('cycles');renderCycles47();refreshCyclePage47();}
async function refreshCyclePage47(){if(cycleBusy47||currentUser?.role!=='admin')return;cycleBusy47=true;loadingStart();loadingProgress(25,'กำลังโหลดรอบตรวจ');try{await refreshCycles();renderCycles47();loadingProgress(100,'โหลดข้อมูลเรียบร้อย');cy47('cyError').textContent='';}catch(e){cy47('cyError').textContent=e.message;}finally{cycleBusy47=false;loadingEnd();}}
function renderCycles47(){const q=cy47('cySearch').value.trim(), f=cy47('cyFilter').value;cy47('cyTotal').textContent=auditCycles.length;cy47('cyOpen').textContent=auditCycles.filter(x=>x.open).length;cy47('cyClosed').textContent=auditCycles.filter(x=>!x.open).length;const rows=auditCycles.filter(x=>String(x.year).includes(q)&&(!f||(f==='open')===x.open)).sort((a,b)=>b.year-a.year);cy47('cyList').innerHTML=rows.map(x=>`<article class="bg-white border rounded-2xl p-4 flex items-center gap-3"><span class="w-12 h-12 rounded-xl flex items-center justify-center ${x.open?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-600'}"><i class="bi bi-calendar-${x.open?'check':'x'} text-xl"></i></span><div class="flex-1"><div class="font-bold">ปี พ.ศ. ${Number(x.year)}</div><span class="text-xs ${x.open?'text-emerald-700':'text-slate-500'}">${x.open?'เปิดรอบตรวจ':'ปิดรอบตรวจ'}</span></div><button type="button" onclick="editCycle47(${Number(x.year)})" class="border rounded-xl px-3 py-2 text-blue-700 text-sm"><i class="bi bi-pencil-square"></i> แก้ไข</button></article>`).join('')||'<p class="text-center text-slate-500 p-6">ไม่พบรอบตรวจ</p>';}
function editCycle47(year=null){if(cycleBusy47||currentUser?.role!=='admin')return;cycleOriginal47=year;const x=auditCycles.find(r=>Number(r.year)===year);cy47('cyTitle').textContent=x?'แก้ไขรอบตรวจ':'เพิ่มรอบตรวจใหม่';cy47('cyYear').value=x?x.year:new Date().getFullYear()+543;cy47('cyYear').readOnly=!!x;cy47('cyStatus').value=x&&!x.open?'closed':'open';cy47('cyFormError').textContent='';cy47('cyDialog').showModal();}
function closeCycle47(){if(!cycleBusy47)cy47('cyDialog').close();}
async function saveCycle47(e){e.preventDefault();if(cycleBusy47||currentUser?.role!=='admin')return;const year=Number(cy47('cyYear').value),open=cy47('cyStatus').value==='open';if(!Number.isInteger(year)||year<2500||year>2700||(cycleOriginal47===null&&auditCycles.some(x=>Number(x.year)===year))){cy47('cyFormError').textContent='ปีไม่ถูกต้องหรือมีรอบตรวจปีนี้แล้ว';return;}cycleBusy47=true;cy47('cySave').disabled=true;cy47('cySave').textContent='กำลังบันทึก...';try{await adminApi('saveCycle',{year,open});cy47('cyDialog').close();await refreshCycles();renderCycles47();await loadAuditStatus();cy47('cyNotice').textContent='บันทึกข้อมูลเรียบร้อย';}catch(e){cy47(cy47('cyDialog').open?'cyFormError':'cyError').textContent=e.message;}finally{cycleBusy47=false;cy47('cySave').disabled=false;cy47('cySave').textContent='บันทึกข้อมูล';}}
let umCache = null, umPage = 1, umBusy = false, umOriginal = '', umRequest = null;
const um = id => document.getElementById(id);
const umRoleLabel = r => ({admin:'Administrator',user:'User',exec:'Executive'})[r] || r;
async function openUserManagementModal(){
  if(currentUser?.role !== 'admin') return;
  switchScreen('users');
  if(umCache !== null) { renderUsers46(); return; }
  await refreshUsers46();
}
async function refreshUsers46(){
  if(currentUser?.role !== 'admin' || umRequest || umBusy) return;
  um('umError').textContent='';
  loadingStart(); loadingProgress(20,'กำลังดึงรายชื่อผู้ใช้งาน');
  try {
    umRequest=adminApi('getUsers'); const j=await umRequest;
    umCache=j.data; umPage=1; renderUsers46(); loadingProgress(100,'โหลดข้อมูลเรียบร้อย');
  } catch(e){um('umError').textContent=e.message;}
  finally{umRequest=null;loadingEnd();}
}
function filterUsers46(){umPage=1;renderUsers46();}
function renderUsers46(){
  const all=umCache||[], q=um('umSearch').value.trim().toLowerCase(), role=um('umFilterRole').value, status=um('umFilterStatus').value;
  um('umTotal').textContent=all.length; um('umActive').textContent=all.filter(u=>u.status==='Active').length; um('umInactive').textContent=all.filter(u=>u.status!=='Active').length;
  const rows=all.filter(u=>(u.username+' '+u.fullName).toLowerCase().includes(q)&&(!role||u.role===role)&&(!status||u.status===status)).sort((a,b)=>String(a[um('umSort').value]).localeCompare(String(b[um('umSort').value]),'th',{numeric:true}));
  const pages=Math.max(1,Math.ceil(rows.length/20)); umPage=Math.min(pages,Math.max(1,umPage));
  um('umCount').textContent=`พบ ${rows.length} จาก ${all.length} คน`; um('umPage').textContent=`หน้า ${umPage} / ${pages}`; um('umPrev').disabled=umPage===1;um('umNext').disabled=umPage===pages;
  const icon=r=>({admin:'shield-check',exec:'briefcase',user:'person'})[r]||'person';
  const tone=r=>({admin:'bg-violet-100 text-violet-700',exec:'bg-amber-100 text-amber-700',user:'bg-blue-100 text-blue-700'})[r]||'bg-slate-100';
  const badge=u=>`<span class="inline-block rounded-full px-2 py-1 text-xs ${u.status==='Active'?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}">${escape44(u.status)}</span>`;
  const edit=u=>`<button type="button" data-um-edit="${escape44(u.username)}" class="border rounded-xl px-3 py-2 text-blue-700 text-sm"><i class="bi bi-pencil-square"></i> แก้ไข</button>`;
  const visible=rows.slice((umPage-1)*20,umPage*20);
  um('umTable').innerHTML=visible.map(u=>`<tr class="border-t"><td class="p-3 font-medium">${escape44(u.username)}</td><td class="p-3">${escape44(u.fullName)}</td><td class="p-3"><span class="rounded-lg px-2 py-1 ${tone(u.role)}"><i class="bi bi-${icon(u.role)}"></i> ${escape44(umRoleLabel(u.role))}</span></td><td class="p-3">${badge(u)}</td><td class="p-3">${edit(u)}</td></tr>`).join('');
  um('umCards').innerHTML=visible.map(u=>`<article class="border rounded-2xl p-3 bg-white space-y-3"><div class="flex items-center gap-3"><span class="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${tone(u.role)}"><i class="bi bi-${icon(u.role)} text-xl"></i></span><div class="min-w-0 flex-1 break-words"><div class="font-bold">${escape44(u.fullName)}</div><div class="text-sm text-slate-500">@${escape44(u.username)}</div></div>${edit(u)}</div><div class="flex justify-between items-center text-sm text-slate-600">${escape44(umRoleLabel(u.role))}${badge(u)}</div></article>`).join('');
  um('umEmpty').classList.toggle('hidden',rows.length!==0);
}
function changeUsersPage46(delta){umPage+=delta;renderUsers46();}
function openUserEditor46(username=''){
  if(currentUser?.role!=='admin'||umBusy||umCache===null)return;
  const u=username?umCache.find(x=>x.username===username):null;if(username&&!u)return;
  umOriginal=username;um('umForm').reset();um('umTitle').textContent=u?'แก้ไขผู้ใช้งาน':'เพิ่มผู้ใช้งานใหม่';
  um('umName').value=u?.username||'';um('umFull').value=u?.fullName||'';um('umRole').value=u?.role||'user';um('umStatus').value=u?.status||'Active';
  um('umPin').required=!u;um('umPin').placeholder=u?'เว้นว่างเพื่อคง PIN เดิม':'ระบุ PIN 4 หลัก';um('umFormError').textContent='';
  const self=username.toLowerCase()===currentUser.username.toLowerCase();um('umRole').disabled=self;um('umStatus').disabled=self;
  um('umDialog').showModal();
}
function closeUserEditor46(){if(!umBusy){um('umPin').value='';um('umDialog').close();}}
async function saveUser46(e){
  e.preventDefault();if(umBusy||currentUser?.role!=='admin')return;
  const d={originalUsername:umOriginal,newUsername:um('umName').value.trim(),newPin:um('umPin').value,fullName:um('umFull').value.trim(),role:um('umRole').value,status:um('umStatus').value};
  const err=um('umFormError');err.textContent='';
  if(!/^[a-zA-Z0-9_.-]+$/.test(d.newUsername)||!d.fullName||((!umOriginal||d.newPin)&&!/^\d{4}$/.test(d.newPin))){err.textContent='กรุณาตรวจสอบ Username ชื่อ และ PIN 4 หลัก';return;}
  if(umCache.some(u=>u.username.toLowerCase()===d.newUsername.toLowerCase()&&u.username!==umOriginal)){err.textContent='Username ซ้ำ';return;}
  umBusy=true;um('umSave').disabled=true;um('umSave').textContent='กำลังบันทึก...';
  try{
    await adminApi('saveUser',d);
    if(umOriginal.toLowerCase()===currentUser.username.toLowerCase()){
      currentUser.username=d.newUsername;currentUser.pin=d.newPin||currentUser.pin;currentUser.fullName=d.fullName;localStorage.setItem('asset_user_session',JSON.stringify(currentUser));applyRolePermissions();
    }
    const item={username:d.newUsername,fullName:d.fullName,role:d.role,status:d.status};
    umCache=umOriginal?umCache.map(u=>u.username===umOriginal?item:u):[...umCache,item];
    um('umPin').value='';um('umDialog').close();renderUsers46();um('umNotice').textContent='บันทึกข้อมูลเรียบร้อย';
  }catch(ex){err.textContent=ex.message;}
  finally{umBusy=false;um('umSave').disabled=false;um('umSave').textContent='บันทึกข้อมูล';}
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-um-edit]');if(b)openUserEditor46(b.dataset.umEdit);});

function extractCodeFromScan(decodedText) {
  let raw = String(decodedText || '').trim();
  if (raw.includes('code=')) {
    try {
      raw = new URL(raw).searchParams.get('code') || raw;
    } catch (_) {
      const m = raw.match(/[?&]code=([^&]+)/i);
      if (m && m[1]) raw = decodeURIComponent(m[1]);
    }
  }
  return raw.trim();
}

function normalizeAssetCode(raw) {
  const text = String(raw || '').trim();
  const assetMatch = text.match(/\b\d{4}-\d{3}-\d{4}-\d{4}\b/);
  return (assetMatch ? assetMatch[0] : text).replace(/\s+/g, '').toLowerCase();
}

// Smart QR Scanner V2 — serialize camera start/stop operations.
let cameraQueue = Promise.resolve();
let cameraGeneration = 0;
let cameraTrack = null;
let cameraReadyAt = 0;
let torchOn = false;
let scanAudio = null;
const scannerVisible = () => !document.getElementById('screen-scanner').classList.contains('hidden') && !!currentUser;
function queueCamera(task) {
  const next = cameraQueue.then(task, task);
  cameraQueue = next.catch(console.warn);
  return next;
}
function scannerStatus(text, success = false) {
  document.getElementById('scannerStatus').textContent = text;
  document.getElementById('scannerStatus').style.color = success ? '#4ade80' : '';
  document.getElementById('cameraViewBox').style.borderColor = success ? '#4ade80' : ''; 
}
function prepareScanAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio) { scanAudio ||= new Audio(); scanAudio.resume().catch(() => {}); }
  } catch (_) {}
}
function scanFeedback() {
  try {
    if (scanAudio?.state === 'running') {
      const osc = scanAudio.createOscillator(), gain = scanAudio.createGain();
      osc.frequency.value = 880; gain.gain.value = 0.08;
      osc.connect(gain); gain.connect(scanAudio.destination);
      osc.start(); osc.stop(scanAudio.currentTime + 0.12);
    }
    navigator.vibrate?.(60);
  } catch (_) {}
}
async function openScannerScreen() {
  prepareScanAudio();
  switchScreen('scanner');
  await startRearCamera();
}
async function releaseCamera() {
  const cam = html5QrCode;
  html5QrCode = null; isScanning = false; cameraTrack = null; torchOn = false;
  document.getElementById('scannerTorch').setAttribute('aria-pressed', 'false');
  if (cam) {
    try { await cam.stop(); } catch (_) {}
    try { cam.clear(); } catch (_) {}
  }
  const reader = document.getElementById('reader');
  reader.querySelectorAll('video').forEach(v => {
    v.srcObject?.getTracks().forEach(t => t.stop()); v.srcObject = null;
  });
  reader.innerHTML = '';
  for (const id of ['scannerTorch','scannerZoom']) document.getElementById(id).classList.add('hidden');
}
function stopScannerSilently() {
  ++cameraGeneration; isScanning = false; isScanHandling = true;
  return queueCamera(releaseCamera);
}
function startRearCamera() {
  const generation = ++cameraGeneration;
  isScanHandling = true;
  return queueCamera(async () => {
    await releaseCamera();
    if (generation !== cameraGeneration || !scannerVisible()) return;
    document.getElementById('cameraErrorBox').classList.add('hidden');
    document.getElementById('scanFrameOverlay').classList.remove('hidden');
    scannerStatus('กำลังเปิดกล้อง…');
    if (!navigator.mediaDevices?.getUserMedia || typeof Html5Qrcode === 'undefined') {
      showCameraError('ไม่สามารถเปิดกล้องได้', 'ตรวจสอบ HTTPS หรือเปิดผ่าน Safari / Chrome'); return;
    }
    const onSuccess = async decodedText => {
      if (generation !== cameraGeneration || !isScanning || isScanHandling) return;
      isScanHandling = true;
      let code;
      try { code = extractCodeFromScan(decodedText); } catch (_) { code = String(decodedText).trim(); }
      console.info('[QR] Camera ready to decode (ms):', Math.round(performance.now() - cameraReadyAt));
      scannerStatus('อ่าน QR Code สำเร็จ', true); scanFeedback();
      const asset = allAssets.find(a => normalizeAssetCode(a.assetCode) === normalizeAssetCode(code));
      if (asset) {
        // switchScreen queues camera cleanup; do not block the inspection UI.
        openInspectScreen(code);
      } else {
        await stopScannerSilently();
        if (!scannerVisible()) return;
        await Swal.fire('ไม่พบข้อมูล', `ไม่พบรหัสครุภัณฑ์ "${code}" ในระบบ`, 'error');
        if (scannerVisible()) startRearCamera();
      }
    };
    const config = {
      fps: 15, disableFlip: true,
      qrbox: (w,h) => { const size = Math.floor(Math.min(w,h)*0.72); return {width:size,height:size}; }
    };
    try {
      html5QrCode = new Html5Qrcode('reader', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        useBarCodeDetectorIfSupported: true, verbose: false
      });
      try {
        await html5QrCode.start({facingMode:'environment'}, {...config, videoConstraints:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}}, onSuccess);
      } catch (err) {
        if (generation !== cameraGeneration || !scannerVisible()) { await releaseCamera(); return; }
        if (/NotAllowed|Permission|denied/i.test(String(err))) throw err;
        await releaseCamera();
        html5QrCode = new Html5Qrcode('reader', {formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE],useBarCodeDetectorIfSupported:true,verbose:false});
        await html5QrCode.start({facingMode:'environment'}, config, onSuccess);
      }
      if (generation !== cameraGeneration || !scannerVisible()) { await releaseCamera(); return; }
      isScanning = true; isScanHandling = false; cameraReadyAt = performance.now();
      scannerStatus('พร้อมสแกน QR Code');
      const video = document.querySelector('#reader video');
      cameraTrack = video?.srcObject?.getVideoTracks()[0] || null;
      const caps = cameraTrack?.getCapabilities?.() || {};
      if (caps.torch) document.getElementById('scannerTorch').classList.remove('hidden');
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        const z = document.getElementById('scannerZoom');
        z.min = caps.zoom.min; z.max = caps.zoom.max; z.step = caps.zoom.step || 0.1;
        z.value = cameraTrack.getSettings().zoom || caps.zoom.min; z.classList.remove('hidden');
      }
      if (caps.focusMode?.includes('continuous')) cameraTrack.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(() => {});
    } catch (err) {
      await releaseCamera();
      if (generation === cameraGeneration && scannerVisible()) showCameraError('ไม่สามารถเปิดกล้องได้', String(err?.message || err));
    }
  });
}
async function toggleScannerTorch() {
  const track = cameraTrack;
  if (!track?.getCapabilities?.().torch) return;
  try { await track.applyConstraints({advanced:[{torch:!torchOn}]}); if (track === cameraTrack) { torchOn = !torchOn; document.getElementById('scannerTorch').setAttribute('aria-pressed', String(torchOn)); } } catch (_) { scannerStatus('อุปกรณ์ไม่สามารถเปิดไฟฉายได้'); }
}
async function setScannerZoom(value) {
  try { await cameraTrack?.applyConstraints({advanced:[{zoom:Number(value)}]}); } catch (_) { scannerStatus('ไม่สามารถปรับซูมได้'); }
}
function showCameraError(title, desc) {
  document.getElementById('cameraErrorTitle').innerText = title;
  document.getElementById('cameraErrorDesc').innerText = desc;
  document.getElementById('cameraErrorBox').classList.remove('hidden');
  document.getElementById('scanFrameOverlay').classList.add('hidden');
  scannerStatus('กล้องไม่พร้อมใช้งาน');
}
function retryCamera() { prepareScanAudio(); return startRearCamera(); }
function openInExternalBrowser() { window.open(window.location.href, '_blank', 'noopener,noreferrer'); }
function closeScannerScreen() { switchScreen('home'); }
async function promptManualCode() {
  await stopScannerSilently();
  if (!scannerVisible()) return;
  const res = await Swal.fire({title:'พิมพ์รหัสครุภัณฑ์',input:'text',inputPlaceholder:'เช่น 7440-001-8716-6110',showCancelButton:true,confirmButtonText:'ค้นหา',cancelButtonText:'ยกเลิก'});
  if (!scannerVisible()) return;
  if (res.isConfirmed && res.value?.trim()) {
    const code = res.value.trim();
    if (allAssets.some(a => normalizeAssetCode(a.assetCode) === normalizeAssetCode(code))) { openInspectScreen(code); return; }
    await Swal.fire('ไม่พบข้อมูล', `ไม่พบรหัสครุภัณฑ์ "${code}" ในระบบ`, 'error');
  }
  if (scannerVisible()) startRearCamera();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScannerSilently();
  else if (scannerVisible() && !Swal.isVisible()) startRearCamera();
});
window.addEventListener('pagehide', () => { cameraTrack?.stop(); stopScannerSilently(); });

function searchAssetManual(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return;
  openInspectScreen(code);
}

function getAssetAuditStatus(assetCode, assetStatus = '') {
  const log = auditedMap[String(assetCode).trim()];
  if (assetStatus === 'จำหน่าย') return {label:'จำหน่ายแล้ว', color:'bg-slate-200 text-slate-700'};
  if (!log) return {label:'รอตรวจ', color:'bg-slate-100 text-slate-600'};
  if (['ใช้งานได้','ปกติ'].includes(log.status)) return {label:'ตรวจแล้ว · ปกติ', color:'bg-emerald-100 text-emerald-700'};
  if (['ชำรุด','เสื่อมสภาพ/รอจำหน่าย'].includes(log.status)) return {label:'ตรวจแล้ว · ชำรุด', color:'bg-orange-100 text-orange-700'};
  if (['สูญหาย','ไม่พบ'].includes(log.status)) return {label:'ตรวจแล้ว · ไม่พบ', color:'bg-red-100 text-red-700'};
  return {label:'ตรวจแล้ว', color:'bg-slate-100 text-slate-700'};
}
function updateInspectBadge() {
  const code = document.getElementById('formAssetCode').value;
  const state = getAssetAuditStatus(code, allAssets.find(a=>a.assetCode===code)?.status);
  const badge = document.getElementById('badgeFound');
  badge.className = 'inline-block mt-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-full '+state.color;
  badge.textContent = state.label;
}
function updateAuditSubmit() {
  const form = document.getElementById('auditForm');
  const valid = ['ใช้งานได้','ชำรุด','สูญหาย'].includes(document.getElementById('formStatus').value) && document.getElementById('formHolder').value.trim() && document.getElementById('formLocation').value.trim();
  form.querySelector('button[type="submit"]').disabled = !valid;
}

function openInspectScreen(code) {
  if(!dataReady || loadingDepth){return;}
  const targetNorm = normalizeAssetCode(code);
  const asset = allAssets.find(a => normalizeAssetCode(a.assetCode) === targetNorm);
  if (!asset) {
    Swal.fire('ไม่พบข้อมูล', `ไม่พบรหัสครุภัณฑ์ "${String(code).trim()}" ในระบบ`, 'error');
    return;
  }

  switchScreen('inspect');
  document.getElementById('dispName').innerText = asset.assetName;
  document.getElementById('dispCode').innerText = `รหัส ${asset.assetCode}`;
  document.getElementById('dispBaselineInfo').innerText = `ทะเบียนเดิม: ${asset.holder || '-'} | ${asset.location || '-'}`;


  const imgEl = document.getElementById('dispAssetImage');
  const phEl = document.getElementById('dispAssetPlaceholder');
  const imgUrl = auditedMap[asset.assetCode]?.imageUrl || asset.imageUrl;
  showAssetImage(imgEl, phEl, document.getElementById('dispImageStatus'), document.getElementById('dispImageLink'), imgUrl);

  document.getElementById('formAssetCode').value = asset.assetCode;
  document.getElementById('formAssetName').value = asset.assetName;
  document.getElementById('formInspector').value = currentUser.fullName;
  document.getElementById('formHolder').value = asset.holder || '';
  document.getElementById('formLocation').value = asset.location || '';
  document.getElementById('formNote').value = '';
  document.getElementById('formImage').value = '';
  document.getElementById('imagePreview').classList.add('hidden');
  compressedImageBase64 = '';

  updateInspectBadge();
  const previousStatus = auditedMap[asset.assetCode]?.status;
  const savedStatus = ['ใช้งานได้','ปกติ'].includes(previousStatus) ? 'ใช้งานได้'
    : ['ชำรุด','เสื่อมสภาพ/รอจำหน่าย'].includes(previousStatus) ? 'ชำรุด'
    : ['สูญหาย','ไม่พบ'].includes(previousStatus) ? 'สูญหาย' : '';
  selectStatusBtn(savedStatus);
}

function selectStatusBtn(statusValue) {
  document.getElementById('formStatus').value = statusValue;
  updateAuditSubmit();

  const btnNormal = document.getElementById('btnStatusNormal');
  const btnDamaged = document.getElementById('btnStatusDamaged');
  const btnLost = document.getElementById('btnStatusLost');

  [btnNormal, btnDamaged, btnLost].forEach(b => {
    b.className = 'status-choice border border-slate-200 bg-white text-slate-600 rounded-xl py-3 px-2 flex flex-col items-center justify-center gap-1 font-medium text-xs transition';
  });

  if (statusValue === 'ใช้งานได้') {
    btnNormal.className = 'status-choice border-2 border-emerald-500 bg-emerald-50 text-emerald-700 rounded-xl py-3 px-2 flex flex-col items-center justify-center gap-1 font-semibold text-xs transition';
  } else if (statusValue === 'ชำรุด') {
    btnDamaged.className = 'status-choice border-2 border-orange-500 bg-orange-50 text-orange-700 rounded-xl py-3 px-2 flex flex-col items-center justify-center gap-1 font-semibold text-xs transition';
  } else if (statusValue === 'สูญหาย') {
    btnLost.className = 'status-choice border-2 border-red-500 bg-red-50 text-red-700 rounded-xl py-3 px-2 flex flex-col items-center justify-center gap-1 font-semibold text-xs transition';
  }
}

function previewImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 800;
      const scale = MAX_WIDTH / img.width;
      canvas.width = MAX_WIDTH;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      compressedImageBase64 = canvas.toDataURL('image/jpeg', 0.75);
      const preview = document.getElementById('imagePreview');
      preview.src = compressedImageBase64;
      preview.classList.remove('hidden');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function submitAuditForm(e) {
  e.preventDefault();
  if (!['ใช้งานได้','ชำรุด','สูญหาย'].includes(document.getElementById('formStatus').value) || !document.getElementById('formHolder').value.trim() || !document.getElementById('formLocation').value.trim()) { Swal.fire('กรุณากรอกข้อมูลให้ครบ','','warning'); return; }
  const selectedYear = document.getElementById('auditYear').value;
  try { await refreshCycles(); } catch(err) { Swal.fire("ข้อผิดพลาด",err.message,"error"); return; }
  if(document.getElementById("auditYear").value !== selectedYear || !auditCycles.some(r=>String(r.year)===selectedYear&&r.open)){Swal.fire("รอบตรวจปิดอยู่","กรุณาติดต่อ Admin","warning");return;}
  const assetName = document.getElementById('formAssetName').value;
  const assetCode = document.getElementById('formAssetCode').value;

  const payload = {
    action: 'submitAudit',
    username: currentUser.username,
    pin: currentUser.pin,
    year: document.getElementById('auditYear').value,
    assetCode,
    assetName,
    status: document.getElementById('formStatus').value,
    holder: document.getElementById('formHolder').value.trim(),
    location: document.getElementById('formLocation').value.trim(),
    note: document.getElementById('formNote').value.trim(),
    inspector: currentUser.fullName,
    imageBase64: compressedImageBase64
  };

  Swal.fire({ title: 'กำลังบันทึกข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
  const json = await res.json();
  Swal.close();

  if (json.status === 'success') {
    await fetchAssets();
    await loadAuditStatus();
    showSuccessScreen(assetName, assetCode);
  } else {
    Swal.fire('ผิดพลาด', json.message, 'error');
  }
}

function showSuccessScreen(name, code) {
  const total = latestStats.total || 0;
  const audited = latestStats.audited || 0;
  const pct = total > 0 ? ((audited / total) * 100).toFixed(1) : 0;

  document.getElementById('successAssetName').innerText = name;
  document.getElementById('successAssetCode').innerText = `รหัส ${code}`;
  document.getElementById('successPercentBadge').innerText = `${pct}%`;
  document.getElementById('successRatioText').innerText = `${audited} / ${total} รายการ`;
  document.getElementById('successProgressBar').style.width = `${pct}%`;

  switchScreen('success');
}

function renderAssetListScreen() {
  const q = (document.getElementById('listSearchInput')?.value || '').toLowerCase();
  const wrap = document.getElementById('assetListCards');
  if (!wrap) return;

  const items = allAssets.filter(a => a.status !== 'จำหน่าย' && `${a.assetCode} ${a.assetName}`.toLowerCase().includes(q)).slice(0, 80);
  wrap.innerHTML = items.map(a => {
    const state = getAssetAuditStatus(a.assetCode, a.status);
    return `
      <div onclick="openInspectScreen('${a.assetCode}')" class="bg-white rounded-xl p-3 border border-slate-200/80 flex items-center justify-between gap-2 cursor-pointer hover:border-blue-400">
        <div class="min-w-0">
          <div class="text-xs font-semibold text-slate-900 truncate">${a.assetName}</div>
          <div class="text-[11px] text-slate-500 font-mono">${a.assetCode}</div>
        </div>
        <span class="text-[10px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${state.color}">
          ${state.label}
        </span>
      </div>
    `;
  }).join('');
}

function renderHistoryScreen() {
  const wrap = document.getElementById('historyCards');
  if (!wrap) return;
  const logs = Object.values(auditedMap).reverse();
  if (logs.length === 0) {
    wrap.innerHTML = `<div class="bg-white rounded-xl p-4 text-xs text-slate-400 text-center">ยังไม่มีประวัติการตรวจในปีนี้</div>`;
    return;
  }
  wrap.innerHTML = logs.map(l => `
    <div class="bg-white rounded-xl p-3 border border-slate-200/80 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-xs font-semibold text-slate-900 truncate">${l.assetName}</div>
        <div class="text-[11px] text-slate-500 font-mono">${l.assetCode} • ${l.auditDate || ''}</div>
      </div>
      <span class="text-[10px] font-semibold px-2.5 py-1 rounded-full ${getAssetAuditStatus(l.assetCode).color} flex-shrink-0">${getAssetAuditStatus(l.assetCode).label}</span>
    </div>
  `).join('');
}

function renderAdminTable() {
  const keyword = (document.getElementById('searchAdmin')?.value || '').toLowerCase();
  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;
  const rows = [];

  allAssets.forEach((asset, idx) => {
    const str = `${asset.assetCode} ${asset.assetName} ${asset.status}`.toLowerCase();
    if (keyword && !str.includes(keyword)) return;

    const state = getAssetAuditStatus(asset.assetCode, asset.status);
    const statusBadge = `<span class="${state.color} px-2 py-0.5 rounded-full text-xs">${state.label}</span>`;

    rows.push(`
      <tr class="hover:bg-slate-50">
        <td class="p-2"><input type="checkbox" class="qr-checkbox" value="${asset.assetCode}"></td>
        <td class="p-2 font-mono text-xs">${asset.assetCode}</td>
        <td class="p-2">${asset.assetName}</td>
        <td class="p-2">${statusBadge}</td>
        <td class="p-2 text-right">
          <button type="button" onclick="openAdminModal('edit', ${idx})" class="text-blue-600 hover:underline text-xs font-medium">แก้ไข/จำหน่าย</button>
        </td>
      </tr>
    `);
  });
  tbody.innerHTML=rows.join('');
}

const admEl = id => document.getElementById(id);
function showAdminDate() {
  const d = admEl('admAcquireDate').value.split('-');
  admEl('admDateThai').textContent = d.length === 3 ? `${d[2]}/${d[1]}/${Number(d[0])+543} (พ.ศ.)` : '';
}
let master48=[];
let masterOpening48=false;
function fillMaster48(id, rows, old='') {
 const el=admEl(id); el.replaceChildren(new Option('-- เลือก --',''));
 for(const row of rows) el.add(new Option(row.name,row.name));
 if(old && !rows.some(r=>r.name===old)) el.add(new Option(old+' (ข้อมูลเดิม)',old));
 el.value=old;
}
let originalMasterPair411 = null;
function refreshAdminCategories(old) {
 const main=admEl('admMainCategory').value;
 if(old===undefined) old=originalMasterPair411 && main===originalMasterPair411.main ? originalMasterPair411.sub : '';
 const ids=master48.filter(r=>r.group==='Category'&&r.name===main).map(r=>r.id);
 fillMaster48('admSubCategory',master48.filter(r=>r.group==='SubCategory'&&ids.includes(r.parentId)),old);
 admEl('admSubCategory').disabled=!main;
}
function refreshAdminQR() {
  const box=admEl('admQR'); box.replaceChildren();
  const code=admEl('admCode').value.trim();
  if(code) { try {new QRCode(box,{text:code,width:112,height:112,correctLevel:QRCode.CorrectLevel.M});} catch(e){box.textContent='ไม่สามารถสร้าง QR';} }
}
function previewAdminImage(event) {
  const f=event.target.files[0]; if(!f)return;
  if(f.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(f.type)){event.target.value=''; Swal.fire('เลือกไฟล์ JPG, PNG หรือ WebP ไม่เกิน 5 MB','','warning');return;}
  const r=new FileReader();r.onload=()=>{if(event.target.files[0]!==f)return;admEl('admImagePreview').onload=admEl('admImagePreview').onerror=null;admEl('admImagePreview').src=r.result;admEl('admImagePreview').classList.remove('hidden');admEl('admImageLabel').textContent=f.name;};r.readAsDataURL(f);
}
async function openAdminModal(mode,index=null) {
  if(currentUser?.role!=='admin')return;
  const a=mode==='edit'?allAssets[index]:{}; if(!a)return;
  if(masterOpening48)return;
  masterOpening48=true; const actor=currentUser;
  try {
    Swal.fire({title:'กำลังโหลดตัวเลือก...',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});
    master48=(await adminApi('getMasterData')).data;
    Swal.close();
  }catch(err){Swal.fire('โหลด MasterData ไม่สำเร็จ',err.message,'error');return;}
  finally{masterOpening48=false;}
  if(currentUser!==actor)return;
  admEl('adminAssetForm').reset();
  fillMaster48('admMainCategory',master48.filter(r=>r.group==='Category'),a.mainCategory||'');
  fillMaster48('admBudget',master48.filter(r=>r.group==='Budget'),a.budget||'');
  fillMaster48('admLocation',master48.filter(r=>r.group==='Location'),a.location||'');
  originalMasterPair411={main:a.mainCategory||'',sub:a.subCategory||''};
  refreshAdminCategories(a.subCategory||'');
  const fields={admMode:mode,admRowIndex:a.rowIndex,admId:a.id,admOriginalCode:a.assetCode,admCode:a.assetCode,admAcquireDate:a.acquireDate,admName:a.assetName,admPrice:a.price,admLocation:a.location,admHolder:a.holder,admStatus:mode==='add'?'ใช้งานได้':(a.rawStatus??a.status),admNote:a.note,admMainCategory:a.mainCategory,admSubCategory:a.subCategory,admBudget:a.budget};
  for(const [id,v] of Object.entries(fields))admEl(id).value=v??'';
  const status=fields.admStatus; if(status && ![...admEl('admStatus').options].some(o=>o.value===status)){admEl('admStatus').add(new Option(status,status));admEl('admStatus').value=status;}
  admEl('adminModalTitle').textContent=mode==='add'?'ลงครุภัณฑ์ใหม่':'แก้ไข / โอนย้าย / จำหน่ายครุภัณฑ์';
  admEl('admMetadata').textContent=`ID: ${a.id??'อัตโนมัติ'}\nลงทะเบียน: ${a.regDate||'-'}\nผู้บันทึก: ${a.updatedBy||'-'}\nวันที่บันทึก: ${a.updatedDate||'-'}`;
  showAssetImage(admEl('admImagePreview'), null, admEl('admImageLabel'), admEl('admImageLink'), a.imageUrl);
  showAdminDate();if(a.acquireDateError)admEl('admDateThai').textContent='วันที่เดิมไม่ถูกต้อง: '+a.acquireDateError;refreshAdminQR();admEl('adminModal').classList.replace('hidden','flex');
}
function closeAdminModal(){admEl('adminModal').classList.replace('flex','hidden');}
async function saveAdminAsset(e){
  e.preventDefault();const btn=e.target.querySelector('button[type=submit]');if(btn.disabled)return;btn.disabled=true;
  try{
    const payload={action:'saveAsset',username:currentUser.username,pin:currentUser.pin};
    for(const [key,id] of Object.entries({mode:'admMode',rowIndex:'admRowIndex',id:'admId',originalCode:'admOriginalCode',assetCode:'admCode',acquireDate:'admAcquireDate',assetName:'admName',price:'admPrice',location:'admLocation',holder:'admHolder',status:'admStatus',note:'admNote',mainCategory:'admMainCategory',subCategory:'admSubCategory',budget:'admBudget'}))payload[key]=admEl(id).value.trim();
    if(payload.status==='จำหน่าย'){const r=await Swal.fire({title:'ยืนยันจำหน่ายครุภัณฑ์?',icon:'warning',showCancelButton:true,confirmButtonText:'ยืนยัน',cancelButtonText:'ยกเลิก'});if(!r.isConfirmed)return;}
    const f=admEl('admImageFile').files[0];if(f){if(f.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(f.type))throw Error('ไฟล์รูปไม่ถูกต้อง');payload.imageBase64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});}
    Swal.fire({title:'กำลังบันทึก...',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});
    const res=await fetch(API_URL,{method:'POST',body:JSON.stringify(payload)});const json=await res.json();if(json.status!=='success')throw Error(json.message);
    closeAdminModal();await fetchAssets();await loadAuditStatus();Swal.fire('สำเร็จ',json.message,'success');
  }catch(err){Swal.fire('ผิดพลาด',err.message||String(err),'error');}finally{btn.disabled=false;}
}

function exportReportCSV() {
  const year = document.getElementById('auditYear').value;
  let csv = '\uFEFFรหัสครุภัณฑ์,ชื่อครุภัณฑ์,ราคา,ตำแหน่งที่ตั้ง,ผู้รับผิดชอบ,ผลการตรวจปี ' + year + ',ผู้ตรวจ,วันที่ตรวจ\n';
  allAssets.forEach(a => {
    const log = auditedMap[a.assetCode];
    csv += [
      `"${a.assetCode}"`,
      `"${a.assetName.replace(/"/g, '""')}"`,
      a.price,
      `"${log ? log.location : a.location}"`,
      `"${log ? log.holder : (a.holder || '')}"`,
      `"${a.status === 'จำหน่าย' ? 'จำหน่ายแล้ว' : (log ? log.status : 'ยังไม่ตรวจ')}"`,
      `"${log ? log.inspector : '-'}"`,
      `"${log ? log.auditDate : '-'}"`
    ].join(',') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `รายงานตรวจครุภัณฑ์_${year}.csv`;
  link.click();
}

function toggleSelectAllQR(master) {
  document.querySelectorAll('.qr-checkbox').forEach(cb => cb.checked = master.checked);
}

function printSelectedQRCodes() {
  const checked = Array.from(document.querySelectorAll('.qr-checkbox:checked')).map(cb => cb.value);
  if (checked.length === 0) {
    Swal.fire('แจ้งเตือน', 'กรุณาติ๊กเลือกรายการครุภัณฑ์ที่ต้องการพิมพ์ QR Code ก่อน', 'info');
    return;
  }

  const grid = document.getElementById('qrGrid');
  grid.innerHTML = '';

  checked.forEach((code, i) => {
    const asset = allAssets.find(a => a.assetCode === code);
    if (!asset) return;

    const cleanCode = String(asset.assetCode || '').trim();
    const box = document.createElement('div');
    box.className = 'border border-black p-3 flex flex-col items-center text-center break-inside-avoid bg-white';
    box.innerHTML = `
      <div id="qr-${i}" class="p-2 bg-white flex items-center justify-center"></div>
      <div class="font-bold text-xs font-mono text-black mt-1 tracking-wide">${cleanCode}</div>
      <div class="text-[11px] text-black leading-snug break-words whitespace-normal w-full mt-0.5">${asset.assetName}</div>
    `;
    grid.appendChild(box);

    new QRCode(document.getElementById(`qr-${i}`), {
      text: cleanCode,
      width: 112,
      height: 112,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  });

  setTimeout(() => {
    document.querySelectorAll('#qrGrid canvas, #qrGrid img').forEach(el => {
      el.style.imageRendering = 'pixelated';
    });
    window.print();
  }, 500);
}

// V3.2: in-page image viewer, no external navigation.
let imageModalPreviousFocus = null;
let imageModalOverflow = '';
function openAssetImageModal(value) {
  const urls = assetImageCandidates(value).map(url => {
    const u = new URL(url);
    if (u.hostname === 'drive.google.com' && u.pathname === '/thumbnail') {
      u.searchParams.set('sz', 'w2000');
      return u.href;
    }
    return url;
  });
  if (!urls.length) return;
  const modal = document.getElementById('assetImageModal');
  const img = document.getElementById('assetImageModalPhoto');
  const status = document.getElementById('assetImageModalStatus');
  imageModalPreviousFocus = document.activeElement;
  imageModalOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  img.classList.add('hidden');
  status.textContent = 'กำลังโหลดรูปภาพ...';
  // Use high-resolution candidates directly.
  let i = 0;
  img.onclick = null;
  img.onload = () => { img.classList.remove('hidden'); status.textContent = ''; };
  img.onerror = () => {
    if (++i < urls.length) { img.src = urls[i]; return; }
    img.classList.add('hidden'); status.textContent = 'ไม่สามารถโหลดรูปภาพได้ กรุณาตรวจสอบสิทธิ์การเข้าถึง';
  };
  img.src = urls[0];
  document.getElementById('assetImageModalClose').focus();
}
function closeAssetImageModal() {
  const modal = document.getElementById('assetImageModal');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden'); modal.classList.remove('flex');
  const img = document.getElementById('assetImageModalPhoto');
  img.onload = img.onerror = null; img.removeAttribute('src');
  document.body.style.overflow = imageModalOverflow;
  imageModalPreviousFocus?.focus();
}
document.addEventListener('keydown', e => {
  const modal = document.getElementById('assetImageModal');
  if (!modal || modal.classList.contains('hidden')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeAssetImageModal(); }
  if (e.key === 'Tab') { e.preventDefault(); document.getElementById('assetImageModalClose').focus(); }
});

const mdGroups49={Category:'ประเภทหลัก',SubCategory:'ประเภทย่อย',Budget:'งบที่ซื้อ',Location:'ตำแหน่งที่ตั้ง'};
let mdRows49=[],mdBusy49=false,mdId49='';
const md49=id=>document.getElementById(id);
async function openMaster49(){if(currentUser?.role!=='admin')return;switchScreen('master');await loadMaster49();}
async function loadMaster49(){if(mdBusy49)return;mdBusy49=true;md49('mdError').textContent='กำลังโหลดข้อมูล...';try{mdRows49=(await adminApi('listMasterData')).data;renderMaster49();md49('mdError').textContent='';}catch(e){md49('mdError').textContent=e.message;}finally{mdBusy49=false;}}
function selectMasterGroup50(group){md49('mdGroup').value=group;md49('mdSearch').value='';md49('mdFilter').value='';renderMaster49();}
function renderMaster49(){
 const group=md49('mdGroup').value,q=md49('mdSearch').value.trim().toLowerCase(),f=md49('mdFilter').value;
 const icons={Category:'layers',SubCategory:'list-nested',Budget:'wallet2',Location:'geo-alt'};
 document.querySelectorAll('[data-md-group]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mdGroup===group)));
 const all=mdRows49.filter(r=>r.group===group);
 md49('mdTotal').textContent=all.length;md49('mdOn').textContent=all.filter(r=>r.active).length;md49('mdOff').textContent=all.filter(r=>!r.active).length;
 const rows=all.filter(r=>(r.name+' '+r.id+' '+(mdRows49.find(p=>p.id===r.parentId)?.name||'')).toLowerCase().includes(q)&&(!f||r.active===(f==='on'))).sort((a,b)=>a.sort-b.sort||a.name.localeCompare(b.name,'th'));
 const list=md49('mdList');list.replaceChildren();
 for(const r of rows){const el=document.createElement('article');el.className='md-item';const parent=mdRows49.find(p=>p.id===r.parentId)?.name||'';el.innerHTML=`<i class="bi bi-${icons[group]} text-blue-600 text-xl"></i><div class="flex-1 min-w-0 space-y-1"><div class="font-bold break-words">${escape44(r.name)}</div>${parent?`<div class="text-xs text-slate-500">${escape44(parent)}</div>`:''}<div class="text-sm text-slate-500">ลำดับ ${r.sort}</div><div class="text-xs ${r.active?'text-emerald-700':'text-slate-500'}"><i class="bi bi-${r.active?'check-circle':'dash-circle'}"></i> ${r.active?'เปิดใช้งาน':'ปิดใช้งาน'}</div></div>`;const b=document.createElement('button');b.type='button';b.className='md-edit';b.innerHTML='<i class="bi bi-pencil-square"></i> แก้ไข';b.onclick=()=>editMaster49(r.id);el.append(b);list.append(el);}
 if(!rows.length)list.textContent='ไม่พบรายการ';
}
function editMaster49(id=''){if(mdBusy49||currentUser?.role!=='admin')return;mdId49=id;const r=mdRows49.find(x=>x.id===id),group=r?.group||md49('mdGroup').value;md49('mdTitle').textContent=(r?'แก้ไข':'เพิ่ม')+mdGroups49[group];md49('mdName').value=r?.name||'';md49('mdSort').value=r?.sort??(Math.max(0,...mdRows49.filter(x=>x.group===group).map(x=>x.sort))+1);md49('mdActive').value=r&&!r.active?'off':'on';const parent=md49('mdParent');parent.replaceChildren(new Option('เลือกประเภทหลัก',''));for(const x of mdRows49.filter(x=>x.group==='Category'&&(x.active||x.id===r?.parentId)))parent.add(new Option(x.name,x.id));parent.value=r?.parentId||'';parent.disabled=group!=='SubCategory';md49('mdParentWrap').hidden=group!=='SubCategory';md49('mdDialog').dataset.group=group;md49('mdFormError').textContent='';md49('mdDialog').showModal();}
async function saveMasterUI49(e){e.preventDefault();if(mdBusy49||currentUser?.role!=='admin')return;mdBusy49=true;md49('mdSave').disabled=true;try{const group=md49('mdDialog').dataset.group;const j=await adminApi('saveMasterData',{id:mdId49,group,name:md49('mdName').value,parentId:group==='SubCategory'?md49('mdParent').value:'',sort:Number(md49('mdSort').value),active:md49('mdActive').value==='on'});mdRows49=j.data;master48=[];renderMaster49();md49('mdDialog').close();md49('mdError').textContent='บันทึกเรียบร้อย';}catch(e){md49('mdFormError').textContent=e.message;}finally{mdBusy49=false;md49('mdSave').disabled=false;}}
