const API_URL = 'https://script.google.com/macros/s/AKfycbx_D0_q4I_nRMfxy_z7abun7sWWmGxwRw6tiTslKrb_K4HQOyb75WlfCwwVXjfv5DBWOw/exec';

let allAssets = [];
let auditedMap = {};
let html5QrCode = null;
let isScanning = false;
let isLoggingIn = false;
let currentUser = null;
let compressedImageBase64 = '';
let tempAvatarBase64 = '';
let latestStats = { total: 599, audited: 0 };

document.addEventListener('DOMContentLoaded', async () => {
  updatePinDots();
  const savedSession = localStorage.getItem('asset_user_session');
  if (savedSession) {
    currentUser = JSON.parse(savedSession);
    applyRolePermissions();
    await initData();
  }
});

function updatePinDots() {
  const val = document.getElementById('loginPin').value || '';
  const dots = document.querySelectorAll('#pinDotsDisplay .pin-dot');
  dots.forEach((dot, idx) => {
    if (idx < val.length) {
      dot.classList.remove('bg-slate-300');
      dot.classList.add('bg-blue-600', 'scale-110');
    } else {
      dot.classList.remove('bg-blue-600', 'scale-110');
      dot.classList.add('bg-slate-300');
    }
  });
}

function pressPin(digit) {
  if (isLoggingIn) return;
  const pinInput = document.getElementById('loginPin');
  if (pinInput.value.length < 4) {
    pinInput.value += digit;
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
      document.querySelector('#loginModal form').requestSubmit();
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
  await fetchAssets();
  await loadAuditStatus();

  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('code');
  if (codeParam && currentUser && (currentUser.role === 'admin' || currentUser.role === 'user')) {
    openInspectScreen(codeParam);
  }
}

async function handleLogin(e) {
  e.preventDefault();
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

  const btnAdmin = document.getElementById('btnOpenAdminPanel');
  if (currentUser.role === 'admin' || currentUser.role === 'exec') {
    btnAdmin.classList.remove('hidden');
  } else {
    btnAdmin.classList.add('hidden');
  }

  renderProfileUI();
  switchScreen('home');
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
  roleSelect.disabled = currentUser.role !== 'admin';
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
  const newRole = currentUser.role === 'admin' ? roleSelect.value : currentUser.role;

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

  const btnAdmin = document.getElementById('btnOpenAdminPanel');
  if (currentUser.role === 'admin' || currentUser.role === 'exec') {
    btnAdmin.classList.remove('hidden');
  } else {
    btnAdmin.classList.add('hidden');
  }

  renderProfileUI();
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

function switchScreen(screenName) {
  if (screenName !== 'scanner') {
    stopScannerSilently();
  }

  ['home', 'scanner', 'inspect', 'success', 'list', 'history', 'profile', 'admin'].forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.add('hidden');
  });

  document.querySelectorAll('.bnav-btn').forEach(btn => {
    btn.classList.remove('text-blue-600');
    btn.classList.add('text-slate-400');
  });

  const activeNav = document.getElementById(`bnav-${screenName}`);
  if (activeNav) {
    activeNav.classList.remove('text-slate-400');
    activeNav.classList.add('text-blue-600');
  }

  const target = document.getElementById(`screen-${screenName}`);
  if (target) target.classList.remove('hidden');

  if (screenName === 'list') renderAssetListScreen();
  if (screenName === 'history') renderHistoryScreen();
  if (screenName === 'profile') renderProfileUI();
  if (screenName === 'admin') renderAdminTable();
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
  const total = latestStats.total || 0;
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
}

async function openScannerScreen() {
  switchScreen('scanner');
  document.getElementById('cameraErrorBox').classList.add('hidden');
  document.getElementById('scanFrameOverlay').classList.remove('hidden');
  await startRearCamera();
}

async function startRearCamera() {
  document.getElementById('cameraErrorBox').classList.add('hidden');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraError('เบราว์เซอร์ไม่รองรับการเข้าถึงกล้อง', 'กรุณาเปิดลิงก์นี้ผ่าน Safari หรือ Chrome และตรวจสอบว่าเชื่อมต่อแบบ HTTPS');
    return;
  }

  try {
    await stopScannerSilently();
    document.getElementById('reader').innerHTML = '';

    html5QrCode = new Html5Qrcode("reader", {
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false
    });

    await html5QrCode.start(
      { facingMode: { ideal: "environment" } },
      {
        fps: 20,
        qrbox: (vw, vh) => {
          const edge = Math.min(240, Math.floor(Math.min(vw, vh) * 0.72));
          return { width: edge, height: edge };
        },
        aspectRatio: 1.0,
        disableFlip: false
      },
      async (decodedText) => {
        if (!isScanning) return;
        let extractedCode = decodedText.trim();
        if (decodedText.includes('code=')) {
          try {
            extractedCode = new URL(decodedText).searchParams.get('code') || extractedCode;
          } catch (_) {}
        }
        await stopScannerSilently();
        openInspectScreen(extractedCode);
      }
    );

    isScanning = true;
  } catch (err) {
    isScanning = false;
    const isDenied = String(err).toLowerCase().includes('permission') || String(err).toLowerCase().includes('notallowed');
    showCameraError(
      isDenied ? 'ยังไม่ได้รับสิทธิ์ใช้งานกล้อง' : 'ไม่สามารถเปิดกล้องได้ในหน้าต่างนี้',
      'กรุณาอนุญาตการใช้กล้อง หรือกดเปิดผ่าน Safari / Chrome เพื่อใช้งานกล้องสแกนได้เต็มรูปแบบ'
    );
  }
}

function showCameraError(title, desc) {
  document.getElementById('cameraErrorTitle').innerText = title;
  document.getElementById('cameraErrorDesc').innerText = desc;
  document.getElementById('cameraErrorBox').classList.remove('hidden');
  document.getElementById('scanFrameOverlay').classList.add('hidden');
}

async function retryCamera() {
  await startRearCamera();
}

function openInExternalBrowser() {
  const url = window.location.href;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function stopScannerSilently() {
  const cam = html5QrCode;
  const active = isScanning;
  isScanning = false;
  html5QrCode = null;

  if (cam) {
    try {
      if (active) await cam.stop();
    } catch (_) {}
    try {
      await cam.clear();
    } catch (_) {}
  }

  const readerEl = document.getElementById('reader');
  if (readerEl) {
    readerEl.querySelectorAll('video').forEach(vid => {
      if (vid.srcObject && typeof vid.srcObject.getTracks === 'function') {
        vid.srcObject.getTracks().forEach(t => t.stop());
      }
      vid.srcObject = null;
    });
    readerEl.innerHTML = '';
  }
}

async function closeScannerScreen() {
  document.getElementById('screen-scanner').classList.add('hidden');
  switchScreen('home');
  await stopScannerSilently();
}

function promptManualCode() {
  Swal.fire({
    title: 'พิมพ์รหัสครุภัณฑ์',
    input: 'text',
    inputPlaceholder: 'เช่น 7440-001-8716-6110',
    showCancelButton: true,
    confirmButtonText: 'ค้นหา',
    cancelButtonText: 'ยกเลิก'
  }).then(async res => {
    if (res.isConfirmed && res.value && res.value.trim()) {
      await stopScannerSilently();
      openInspectScreen(res.value.trim());
    }
  });
}

function searchAssetManual(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return;
  openInspectScreen(code);
}

function openInspectScreen(code) {
  const asset = allAssets.find(a => a.assetCode.toLowerCase() === String(code).trim().toLowerCase());
  if (!asset) {
    Swal.fire('ไม่พบข้อมูล', `ไม่พบรหัสครุภัณฑ์ "${code}" ในระบบ`, 'error');
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
  if (imgUrl) {
    imgEl.src = imgUrl;
    imgEl.classList.remove('hidden');
    phEl.classList.add('hidden');
  } else {
    imgEl.classList.add('hidden');
    phEl.classList.remove('hidden');
  }

  document.getElementById('formAssetCode').value = asset.assetCode;
  document.getElementById('formAssetName').value = asset.assetName;
  document.getElementById('formInspector').value = currentUser.fullName;
  document.getElementById('formHolder').value = asset.holder || asset.note || '';
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
  const assetName = document.getElementById('formAssetName').value;
  const assetCode = document.getElementById('formAssetCode').value;

  const payload = {
    action: 'submitAudit',
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

function openAdminModal(mode, index = null) {
  const modal = document.getElementById('adminModal');
  modal.classList.replace('hidden', 'flex');
  document.getElementById('admMode').value = mode;

  if (mode === 'add') {
    document.getElementById('adminModalTitle').innerText = 'ลงครุภัณฑ์ใหม่';
    document.getElementById('adminAssetForm').reset();
  } else {
    const a = allAssets[index];
    document.getElementById('adminModalTitle').innerText = 'แก้ไข / จำหน่ายครุภัณฑ์';
    document.getElementById('admRowIndex').value = a.rowIndex;
    document.getElementById('admCode').value = a.assetCode;
    document.getElementById('admAcquireDate').value = a.acquireDate;
    document.getElementById('admName').value = a.assetName;
    document.getElementById('admPrice').value = a.price;
    document.getElementById('admLocation').value = a.location;
    document.getElementById('admHolder').value = a.holder || a.note;
    document.getElementById('admStatus').value = a.status;
    document.getElementById('admNote').value = a.note;
  }
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.replace('flex', 'hidden');
}

async function saveAdminAsset(e) {
  e.preventDefault();
  const payload = {
    action: 'saveAsset',
    username: currentUser.username,
    pin: currentUser.pin,
    mode: document.getElementById('admMode').value,
    rowIndex: Number(document.getElementById('admRowIndex').value),
    assetCode: document.getElementById('admCode').value.trim(),
    acquireDate: document.getElementById('admAcquireDate').value,
    assetName: document.getElementById('admName').value.trim(),
    price: document.getElementById('admPrice').value,
    location: document.getElementById('admLocation').value,
    holder: document.getElementById('admHolder').value,
    status: document.getElementById('admStatus').value,
    note: document.getElementById('admNote').value
  };

  Swal.fire({ title: 'กำลังบันทึก...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
  const json = await res.json();

  if (json.status === 'success') {
    Swal.fire('สำเร็จ', json.message, 'success');
    closeAdminModal();
    await fetchAssets();
    await loadAuditStatus();
  } else {
    Swal.fire('ผิดพลาด', json.message, 'error');
  }
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
      `"${log ? log.holder : (a.holder || a.note)}"`,
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
  const baseUrl = window.location.origin + window.location.pathname;

  checked.forEach((code, i) => {
    const asset = allAssets.find(a => a.assetCode === code);
    const box = document.createElement('div');
    box.className = 'border border-black p-2.5 flex flex-col items-center text-center break-inside-avoid bg-white';
    box.innerHTML = `
      <div id="qr-${i}" class="mb-1.5"></div>
      <div class="font-bold text-xs font-mono text-black">${asset.assetCode}</div>
      <div class="text-[11px] text-black leading-snug break-words whitespace-normal w-full mt-0.5">${asset.assetName}</div>
    `;
    grid.appendChild(box);

    new QRCode(document.getElementById(`qr-${i}`), {
      text: `${baseUrl}?code=${encodeURIComponent(asset.assetCode)}`,
      width: 92,
      height: 92
    });
  });

  setTimeout(() => window.print(), 600);
}
