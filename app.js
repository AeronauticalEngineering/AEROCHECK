const API_URL = 'https://script.google.com/macros/s/AKfycbx_D0_q4I_nRMfxy_z7abun7sWWmGxwRw6tiTslKrb_K4HQOyb75WlfCwwVXjfv5DBWOw/exec';

let allAssets = [];
let auditedMap = {};
let html5QrCode = null;
let isScanning = false;
let torchEnabled = false;
let currentUser = null;
let compressedImageBase64 = '';
let latestStats = { total: 599, audited: 0 };

document.addEventListener('DOMContentLoaded', async () => {
  const savedSession = localStorage.getItem('asset_user_session');
  if (savedSession) {
    currentUser = JSON.parse(savedSession);
    applyRolePermissions();
    await initData();
  }
});

function pressPin(digit) {
  const pinInput = document.getElementById('loginPin');
  if (pinInput.value.length < 4) pinInput.value += digit;
}

function backspacePin() {
  const pinInput = document.getElementById('loginPin');
  pinInput.value = pinInput.value.slice(0, -1);
}

function clearPin() {
  document.getElementById('loginPin').value = '';
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
    Swal.fire({ icon: 'warning', title: 'รหัส PIN ไม่ถูกต้อง', text: 'กรุณากรอกตัวเลข 4 หลักเท่านั้น', timer: 1400, showConfirmButton: false });
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
      currentUser = { ...json.user, pin };
      localStorage.setItem('asset_user_session', JSON.stringify(currentUser));

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
      Swal.fire('เข้าสู่ระบบไม่สำเร็จ', json.message, 'error');
    }
  } catch (err) {
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', 'error');
  }
}

function applyRolePermissions() {
  document.getElementById('loginModal').classList.add('hidden');
  document.getElementById('appContainer').classList.remove('hidden');

  const roleLabels = { admin: 'ผู้ดูแลระบบ', user: 'เจ้าหน้าที่ตรวจนับ', exec: 'ผู้บริหาร' };
  document.getElementById('profFullName').innerText = currentUser.fullName;
  document.getElementById('profRole').innerText = `สิทธิ์การใช้งาน: ${roleLabels[currentUser.role] || currentUser.role}`;
  document.getElementById('formInspector').value = currentUser.fullName;

  const btnAdmin = document.getElementById('btnOpenAdminPanel');
  if (currentUser.role === 'admin' || currentUser.role === 'exec') {
    btnAdmin.classList.remove('hidden');
  } else {
    btnAdmin.classList.add('hidden');
  }

  switchScreen('home');
}

function logout() {
  stopScannerSilently();
  localStorage.removeItem('asset_user_session');
  currentUser = null;
  document.getElementById('appContainer').classList.add('hidden');
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('loginPin').value = '';
}

function switchScreen(screenName) {
  if (screenName !== 'scanner') {
    stopScannerSilently();
  }

  ['home', 'inspect', 'success', 'list', 'history', 'profile', 'admin'].forEach(s => {
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

// เปิดหน้ากล้องสแกนเต็มหน้าจอและปิดกล้องอัตโนมัติเมื่ออ่าน QR สำเร็จ
function openScannerScreen() {
  switchScreen('scanner');
  torchEnabled = false;

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("reader", {
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false
    });
  }

  html5QrCode.start(
    { facingMode: "environment" },
    {
      fps: 20,
      qrbox: (vw, vh) => ({
        width: Math.min(280, Math.floor(vw * 0.75)),
        height: Math.min(280, Math.floor(vw * 0.75))
      }),
      aspectRatio: 1.0,
      disableFlip: false
    },
    (decodedText) => {
      let extractedCode = decodedText.trim();
      if (decodedText.includes('code=')) {
        extractedCode = new URL(decodedText).searchParams.get('code');
      }
      stopScannerSilently();
      openInspectScreen(extractedCode);
    }
  ).then(() => {
    isScanning = true;
  }).catch(() => {
    Swal.fire('เปิดกล้องไม่สำเร็จ', 'กรุณาอนุญาตการเข้าถึงกล้องบนเบราว์เซอร์', 'warning');
  });
}

function stopScannerSilently() {
  if (html5QrCode && isScanning) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
    }).catch(() => {});
  }
  isScanning = false;
}

function closeScannerScreen() {
  stopScannerSilently();
  switchScreen('home');
}

function toggleTorch() {
  if (!html5QrCode || !isScanning) return;
  torchEnabled = !torchEnabled;
  html5QrCode.applyVideoConstraints({
    advanced: [{ torch: torchEnabled }]
  }).catch(() => {});
}

function promptManualCode() {
  Swal.fire({
    title: 'พิมพ์รหัสครุภัณฑ์',
    input: 'text',
    inputPlaceholder: 'เช่น 7440-001-8716-6110',
    showCancelButton: true,
    confirmButtonText: 'ค้นหา',
    cancelButtonText: 'ยกเลิก'
  }).then(res => {
    if (res.isConfirmed && res.value && res.value.trim()) {
      stopScannerSilently();
      openInspectScreen(res.value.trim());
    }
  });
}

function searchAssetManual(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return;
  openInspectScreen(code);
}

// เปิดหน้า 03 ตรวจครุภัณฑ์ พร้อมแสดงข้อมูลทะเบียนเดิม
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

// เลือกสถานะด้วยปุ่มขนาดใหญ่แทน Dropdown
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
          <button onclick="openAdminModal('edit', ${idx})" class="text-blue-600 hover:underline text-xs font-medium">แก้ไข/จำหน่าย</button>
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
