
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
let latestStats = { total: 599, audited: 0 };
let execDonutChartInstance = null;
let execDeptChartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  updatePinDots();
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
  if (isLoggingIn) return;
  const pinInput = document.getElementById('loginPin');
  if (pinInput.value.length < 4) {
    pinInput.value += String(digit);
    updatePinDots();

    if (pinInput.value.length === 4) {
      const username = document.getElementById('loginUsername').value.trim();
      if (!username) {
        Swal.fire({
          icon: 'warning',
          title: 'ยังไม่ได้ระบุชื่อผู้ใช้',
          text: 'กรุณากรอกชื่อผู้ใช้ก่อนกดรหัส PIN',
          timer: 1400,
          showConfirmButton: false
        });
        clearPin();
        return;
      }
      isLoggingIn = true;
      setTimeout(() => {
        handleLogin({ preventDefault: () => {} });
      }, 120);
    }
  }
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
  await refreshCycles(true);
  await fetchAssets();
  await loadAuditStatus();

  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('code');
  if (codeParam && currentUser && (currentUser.role === 'admin' || currentUser.role === 'user')) {
    openInspectScreen(codeParam);
  }
}

async function handleLogin(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const pin = document.getElementById('loginPin').value.replace(/\D/g, '');

  if (!/^\d{4}$/.test(pin)) {
    isLoggingIn = false;
    Swal.fire({ icon: 'warning', title: 'รหัส PIN ไม่ถูกต้อง', text: 'กรุณากดตัวเลข 4 หลักเท่านั้น', timer: 1400, showConfirmButton: false });
    return;
  }

  Swal.fire({ title: 'กำลังตรวจสอบสิทธิ์...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'login', username, pin })
    });
    const json = await res.json();
    Swal.close();

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

      isLoggingIn = false;
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
      isLoggingIn = false;
      clearPin();
      Swal.fire('เข้าสู่ระบบไม่สำเร็จ', json.message, 'error');
    }
  } catch (err) {
    isLoggingIn = false;
    clearPin();
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', 'error');
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
  stopScannerSilently();
  localStorage.removeItem('asset_user_session');
  currentUser = null;
  isLoggingIn = false;
  document.getElementById('appContainer').classList.add('hidden');
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('loginPin').value = '';
  updatePinDots();
}

function resolveHomeScreenId() {
  if (!currentUser) return 'screen-home-user';
  if (currentUser.role === 'admin') return 'screen-home-admin';
  if (currentUser.role === 'exec') return 'screen-home-exec';
  return 'screen-home-user';
}

function switchScreen(screenName) {
  if (screenName !== 'scanner') {
    stopScannerSilently();
  }

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
    'screen-admin'
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
      updateSummaryCards();
      renderAssetListScreen();
      renderAdminTable();
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadAuditStatus() {
  const year = document.getElementById('auditYear').value;
  document.getElementById('homeCycleYear').innerText = year;
  if (document.getElementById('admDashYear')) document.getElementById('admDashYear').innerText = year;
  if (document.getElementById('execYearLabel')) document.getElementById('execYearLabel').innerText = year;

  try {
    const res = await fetch(`${API_URL}?action=getAuditReport&year=${year}`);
    const json = await res.json();
    if (json.status === 'success') {
      auditedMap = json.auditedMap;
      latestStats = { total: json.totalAssets, audited: json.auditedCount };
      updateSummaryCards();
      renderHistoryScreen();
      renderAdminTable();
    }
  } catch (err) {
    console.error(err);
  }
}

function updateSummaryCards() {
  const activeAssets = allAssets.filter(a => a.status !== 'จำหน่าย');
  const total = latestStats.total || activeAssets.length || 599;
  const audited = latestStats.audited || 0;
  const pending = Math.max(0, total - audited);
  const percent = total > 0 ? Number(((audited / total) * 100).toFixed(1)) : 0;

  let normal = 0, damaged = 0, lost = 0;
  Object.values(auditedMap).forEach(log => {
    if (log.status === 'ใช้งานได้') normal++;
    else if (log.status === 'ชำรุด' || log.status === 'เสื่อมสภาพ/รอจำหน่าย') damaged++;
    else if (log.status === 'สูญหาย') lost++;
  });

  document.getElementById('homeProgressPercent').innerText = `${percent}%`;
  document.getElementById('homeProgressBar').style.width = `${percent}%`;
  document.getElementById('homeProgressRatio').innerText = `${audited} / ${total} รายการ`;
  document.getElementById('homeNormal').innerText = normal;
  document.getElementById('homeDamaged').innerText = damaged;
  document.getElementById('homeLost').innerText = lost;
  document.getElementById('homePending').innerText = pending;

  if (document.getElementById('admDashPercent')) {
    document.getElementById('admDashPercent').innerText = `${percent}%`;
    document.getElementById('admDashBar').style.width = `${percent}%`;
    document.getElementById('admDashRatio').innerText = `${audited} / ${total}`;
    document.getElementById('admStatTotal').innerText = total;
    document.getElementById('admStatAudited').innerText = audited;
    document.getElementById('admStatPending').innerText = pending;
    document.getElementById('admStatIssue').innerText = damaged + lost;
    renderAdminDashboardLists(damaged + lost);
  }

  if (document.getElementById('execTotalAssets')) {
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
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0">${l.status}</span>
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
async function openAuditCycleModal(){
  if(currentUser.role!=='admin')return;
  try{await refreshCycles(); const options=auditCycles.map(r=>`${r.year} (${r.open?'เปิด':'ปิด'})`).join(', ');
  const r=await Swal.fire({title:'จัดการรอบตรวจ',text:options||'ยังไม่มีรอบตรวจ',html:'<label>ปี พ.ศ.</label><input id="cycleYear" type="number" min="2500" max="2700" class="swal2-input"><label>สถานะ</label><select id="cycleStatus" class="swal2-select"><option value="open">เปิดรอบตรวจ</option><option value="closed">ปิดรอบตรวจ</option></select>',didOpen:()=>{document.getElementById('cycleYear').value=document.getElementById('auditYear').value||new Date().getFullYear()+543;},showCancelButton:true,confirmButtonText:'บันทึก',preConfirm:()=>({year:document.getElementById('cycleYear').value,open:document.getElementById('cycleStatus').value==='open'})});
  if(r.isConfirmed){await adminApi('saveCycle',r.value);await refreshCycles(true);await loadAuditStatus();await Swal.fire('บันทึกแล้ว','','success');}
  }catch(e){Swal.fire('ข้อผิดพลาด',e.message,'error');}
}
async function openUserManagementModal(){
  if(currentUser.role!=='admin')return;
  try{const j=await adminApi('getUsers');const choices={'__new__':'เพิ่มผู้ใช้งานใหม่'};j.data.forEach((u,i)=>choices[i]=u.username+' — '+u.fullName+' ('+u.role+', '+u.status+')');
  const pick=await Swal.fire({title:'จัดการผู้ใช้งาน',input:'select',inputOptions:choices,showCancelButton:true,confirmButtonText:'ดำเนินการ'});if(!pick.isConfirmed)return;
  const u=pick.value==='__new__'?{}:j.data[Number(pick.value)];
  const r=await Swal.fire({title:u.username?'แก้ไขผู้ใช้งาน':'เพิ่มผู้ใช้งาน',html:'<div class="text-left space-y-2"><label>Username<input id="umName" class="w-full border rounded-lg p-2"></label><label>PIN (4 หลัก; เว้นว่างเพื่อคงเดิม)<input id="umPin" type="password" inputmode="numeric" maxlength="4" class="w-full border rounded-lg p-2"></label><label>Full name<input id="umFull" class="w-full border rounded-lg p-2"></label><label>Role<select id="umRole" class="w-full border rounded-lg p-2"><option>user</option><option>admin</option><option>exec</option></select></label><label>Status<select id="umStatus" class="w-full border rounded-lg p-2"><option>Active</option><option>Deactive</option></select></label></div>',didOpen:()=>{for(const [id,v] of Object.entries({umName:u.username,umFull:u.fullName,umRole:u.role||'user',umStatus:u.status||'Active'}))document.getElementById(id).value=v||'';},showCancelButton:true,confirmButtonText:'บันทึก',preConfirm:()=>({originalUsername:u.username||'',newUsername:document.getElementById('umName').value,newPin:document.getElementById('umPin').value,fullName:document.getElementById('umFull').value,role:document.getElementById('umRole').value,status:document.getElementById('umStatus').value})});
  if(r.isConfirmed){await adminApi('saveUser',r.value);if(u.username?.toLowerCase()===currentUser.username.toLowerCase()){currentUser.username=r.value.newUsername.trim();currentUser.pin=r.value.newPin||currentUser.pin;currentUser.fullName=r.value.fullName;localStorage.setItem('asset_user_session',JSON.stringify(currentUser));applyRolePermissions();}await Swal.fire('บันทึกแล้ว','','success');}
  }catch(e){Swal.fire('ข้อผิดพลาด',e.message,'error');}
}

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

function openInspectScreen(code) {
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
  document.getElementById('badgeFound').classList.remove('hidden');

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

  const initStatus = asset.status === 'ชำรุด' ? 'ชำรุด' : (asset.status === 'สูญหาย' ? 'สูญหาย' : 'ใช้งานได้');
  selectStatusBtn(initStatus);
}

function selectStatusBtn(statusValue) {
  document.getElementById('formStatus').value = statusValue;

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
  try { await refreshCycles(); } catch(err) { Swal.fire("ข้อผิดพลาด",err.message,"error"); return; }
  if(!auditCycles.some(r=>String(r.year)===document.getElementById("auditYear").value&&r.open)){Swal.fire("รอบตรวจปิดอยู่","กรุณาติดต่อ Admin","warning");return;}
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
    const done = !!auditedMap[a.assetCode];
    return `
      <div onclick="openInspectScreen('${a.assetCode}')" class="bg-white rounded-xl p-3 border border-slate-200/80 flex items-center justify-between gap-2 cursor-pointer hover:border-blue-400">
        <div class="min-w-0">
          <div class="text-xs font-semibold text-slate-900 truncate">${a.assetName}</div>
          <div class="text-[11px] text-slate-500 font-mono">${a.assetCode}</div>
        </div>
        <span class="text-[10px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
          ${done ? 'ตรวจแล้ว' : 'รอตรวจ'}
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
      <span class="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0">${l.status}</span>
    </div>
  `).join('');
}

function renderAdminTable() {
  const keyword = (document.getElementById('searchAdmin')?.value || '').toLowerCase();
  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  allAssets.forEach((asset, idx) => {
    const str = `${asset.assetCode} ${asset.assetName} ${asset.status}`.toLowerCase();
    if (keyword && !str.includes(keyword)) return;

    const log = auditedMap[asset.assetCode];
    const statusBadge = asset.status === 'จำหน่าย'
      ? `<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs">จำหน่าย</span>`
      : (log
          ? `<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-xs">ตรวจแล้ว (${log.status})</span>`
          : `<span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs">ยังไม่ตรวจ</span>`);

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-2"><input type="checkbox" class="qr-checkbox" value="${asset.assetCode}"></td>
        <td class="p-2 font-mono text-xs">${asset.assetCode}</td>
        <td class="p-2">${asset.assetName}</td>
        <td class="p-2">${statusBadge}</td>
        <td class="p-2 text-right">
          <button type="button" onclick="openAdminModal('edit', ${idx})" class="text-blue-600 hover:underline text-xs font-medium">แก้ไข/จำหน่าย</button>
        </td>
      </tr>
    `;
  });
}

const admEl = id => document.getElementById(id);
function showAdminDate() {
  const d = admEl('admAcquireDate').value.split('-');
  admEl('admDateThai').textContent = d.length === 3 ? `${d[2]}/${d[1]}/${Number(d[0])+543} (พ.ศ.)` : '';
}
function refreshAdminCategories() {
  const main = admEl('admMainCategory').value;
  for (const [id, values] of [['admMainList', allAssets.map(a=>a.mainCategory)], ['admSubList', allAssets.filter(a=>!main || a.mainCategory===main).map(a=>a.subCategory)]]) {
    admEl(id).replaceChildren(...[...new Set(values.filter(Boolean))].sort().map(v=>{const o=document.createElement('option');o.value=v;return o;}));
  }
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
function openAdminModal(mode,index=null) {
  if(currentUser?.role!=='admin')return;
  const a=mode==='edit'?allAssets[index]:{}; if(!a)return;
  admEl('adminAssetForm').reset();
  const fields={admMode:mode,admRowIndex:a.rowIndex,admId:a.id,admOriginalCode:a.assetCode,admCode:a.assetCode,admAcquireDate:a.acquireDate,admName:a.assetName,admPrice:a.price,admLocation:a.location,admHolder:a.holder,admStatus:mode==='add'?'ใช้งานได้':(a.rawStatus??a.status),admNote:a.note,admMainCategory:a.mainCategory,admSubCategory:a.subCategory,admBudget:a.budget};
  for(const [id,v] of Object.entries(fields))admEl(id).value=v??'';
  const status=fields.admStatus; if(status && ![...admEl('admStatus').options].some(o=>o.value===status)){admEl('admStatus').add(new Option(status,status));admEl('admStatus').value=status;}
  admEl('adminModalTitle').textContent=mode==='add'?'ลงครุภัณฑ์ใหม่':'แก้ไข / โอนย้าย / จำหน่ายครุภัณฑ์';
  admEl('admMetadata').textContent=`ID: ${a.id??'อัตโนมัติ'}\nลงทะเบียน: ${a.regDate||'-'}\nผู้บันทึก: ${a.updatedBy||'-'}\nวันที่บันทึก: ${a.updatedDate||'-'}`;
  showAssetImage(admEl('admImagePreview'), null, admEl('admImageLabel'), admEl('admImageLink'), a.imageUrl);
  showAdminDate();if(a.acquireDateError)admEl('admDateThai').textContent='วันที่เดิมไม่ถูกต้อง: '+a.acquireDateError;refreshAdminCategories();refreshAdminQR();admEl('adminModal').classList.replace('hidden','flex');
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
