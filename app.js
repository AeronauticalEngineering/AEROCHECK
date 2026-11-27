const API_URL = 'https://script.google.com/macros/s/AKfycbx_D0_q4I_nRMfxy_z7abun7sWWmGxwRw6tiTslKrb_K4HQOyb75WlfCwwVXjfv5DBWOw/exec';

let allAssets = [];
let auditedMap = {};
let html5QrCode = null;
let isScanning = false;
let currentUser = null;
let compressedImageBase64 = '';

document.addEventListener('DOMContentLoaded', async () => {
  const savedSession = localStorage.getItem('asset_user_session');
  if (savedSession) {
    currentUser = JSON.parse(savedSession);
    applyRolePermissions();
    await initData();
  }
});

async function initData() {
  await fetchAssets();
  await loadAuditStatus();

  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('code');
  if (codeParam && currentUser && (currentUser.role === 'admin' || currentUser.role === 'user')) {
    openAuditForm(codeParam);
  }
}

// ระบบ Login ตรวจสอบสิทธิ์จากแท็บ Users
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const pin = document.getElementById('loginPin').value.trim();

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
      await initData();
      Swal.fire({ icon: 'success', title: `ยินดีต้อนรับ ${currentUser.fullName}`, timer: 1200, showConfirmButton: false });
    } else {
      Swal.fire('เข้าสู่ระบบไม่สำเร็จ', json.message, 'error');
    }
  } catch (err) {
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการ Deploy Apps Script', 'error');
  }
}

// จัดการการแสดงผลเมนูตาม Role (admin, user, exec)
function applyRolePermissions() {
  document.getElementById('loginModal').classList.add('hidden');
  document.getElementById('bottomNav').classList.remove('hidden');

  const roleLabels = { admin: 'ผู้ดูแลระบบ', user: 'เจ้าหน้าที่ตรวจนับ', exec: 'ผู้บริหาร' };
  document.getElementById('userBadge').innerText = `${currentUser.fullName} (${roleLabels[currentUser.role] || currentUser.role})`;
  document.getElementById('formInspector').value = currentUser.fullName;

  const navScan = document.getElementById('nav-scan');
  const navReport = document.getElementById('nav-report');
  const navAdmin = document.getElementById('nav-admin');

  [navScan, navReport, navAdmin].forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('flex');
  });

  if (currentUser.role === 'admin') {
    [navScan, navReport, navAdmin].forEach(el => {
      el.classList.remove('hidden');
      el.classList.add('flex');
    });
    switchTab('scan');
  } else if (currentUser.role === 'user') {
    navScan.classList.remove('hidden');
    navScan.classList.add('flex');
    switchTab('scan');
  } else if (currentUser.role === 'exec') {
    navReport.classList.remove('hidden');
    navReport.classList.add('flex');
    switchTab('report');
  }
}

function logout() {
  if (isScanning && html5QrCode) {
    html5QrCode.stop().catch(() => {});
    isScanning = false;
  }
  localStorage.removeItem('asset_user_session');
  currentUser = null;
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('bottomNav').classList.add('hidden');
  document.getElementById('loginPin').value = '';
}

function switchTab(tab) {
  ['scan', 'report', 'admin'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.add('hidden');
    document.getElementById(`nav-${t}`).classList.replace('text-orange-600', 'text-slate-500');
  });

  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  document.getElementById(`nav-${tab}`).classList.replace('text-slate-500', 'text-orange-600');
}

// ดึงข้อมูลทะเบียนครุภัณฑ์หลัก
async function fetchAssets() {
  try {
    const res = await fetch(`${API_URL}?action=getAssets`);
    const json = await res.json();
    if (json.status === 'success') {
      allAssets = json.data;
      renderAdminTable();
    }
  } catch (err) {
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถโหลดข้อมูลครุภัณฑ์ได้', 'error');
  }
}

// ดึงรายงานการตรวจนับประจำปี
async function loadAuditStatus() {
  const year = document.getElementById('auditYear').value;
  try {
    const res = await fetch(`${API_URL}?action=getAuditReport&year=${year}`);
    const json = await res.json();
    if (json.status === 'success') {
      auditedMap = json.auditedMap;
      updateDashboardStats(json.totalAssets, json.auditedCount);
      renderReportTable();
    }
  } catch (err) {
    console.error(err);
  }
}

// กล้องสแกน QR Code
function toggleScanner() {
  const readerDiv = document.getElementById('reader');
  const btn = document.getElementById('btnToggleCam');

  if (!isScanning) {
    readerDiv.classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        let extractedCode = decodedText;
        if (decodedText.includes('code=')) {
          extractedCode = new URL(decodedText).searchParams.get('code');
        }
        toggleScanner();
        openAuditForm(extractedCode);
      }
    ).then(() => {
      isScanning = true;
      btn.innerHTML = '<i class="bi bi-stop-circle"></i> ปิดกล้อง';
      btn.classList.replace('bg-orange-500', 'bg-red-600');
    }).catch(() => {
      Swal.fire('เปิดกล้องไม่สำเร็จ', 'กรุณาอนุญาตการเข้าถึงกล้องบนเบราว์เซอร์', 'warning');
    });
  } else {
    html5QrCode.stop().then(() => {
      readerDiv.classList.add('hidden');
      isScanning = false;
      btn.innerHTML = '<i class="bi bi-camera-video"></i> เปิดกล้องสแกน';
      btn.classList.replace('bg-red-600', 'bg-orange-500');
    });
  }
}

function searchAssetManual() {
  const code = document.getElementById('manualCodeInput').value.trim();
  if (!code) return;
  openAuditForm(code);
}

function openAuditForm(code) {
  const asset = allAssets.find(a => a.assetCode === code);
  if (!asset) {
    Swal.fire('ไม่พบข้อมูล', `ไม่พบรหัสครุภัณฑ์ "${code}" ในระบบ`, 'error');
    return;
  }

  document.getElementById('auditFormCard').classList.remove('hidden');
  document.getElementById('dispCode').innerText = asset.assetCode;
  document.getElementById('dispName').innerText = asset.assetName;
  document.getElementById('dispCategory').innerText = `${asset.mainCategory} > ${asset.subCategory}`;

  document.getElementById('formAssetCode').value = asset.assetCode;
  document.getElementById('formAssetName').value = asset.assetName;
  document.getElementById('formStatus').value = asset.status === 'จำหน่าย' ? 'ใช้งานได้' : (asset.status || 'ใช้งานได้');
  document.getElementById('formHolder').value = asset.holder || asset.note || '';
  document.getElementById('formLocation').value = asset.location || '';
  document.getElementById('formInspector').value = currentUser.fullName;
  document.getElementById('formNote').value = '';
  document.getElementById('formImage').value = '';
  document.getElementById('imagePreview').classList.add('hidden');
  compressedImageBase64 = '';

  if (auditedMap[asset.assetCode]) {
    document.getElementById('badgeAudited').classList.remove('hidden');
  } else {
    document.getElementById('badgeAudited').classList.add('hidden');
  }

  document.getElementById('auditFormCard').scrollIntoView({ behavior: 'smooth' });
}

function closeAuditForm() {
  document.getElementById('auditFormCard').classList.add('hidden');
}

// บีบอัดภาพก่อนส่งเข้า Google Drive
function previewImage(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 800;
      const scaleSize = MAX_WIDTH / img.width;
      canvas.width = MAX_WIDTH;
      canvas.height = img.height * scaleSize;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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

  const payload = {
    action: 'submitAudit',
    year: document.getElementById('auditYear').value,
    assetCode: document.getElementById('formAssetCode').value,
    assetName: document.getElementById('formAssetName').value,
    status: document.getElementById('formStatus').value,
    holder: document.getElementById('formHolder').value.trim(),
    location: document.getElementById('formLocation').value.trim(),
    note: document.getElementById('formNote').value.trim(),
    inspector: currentUser.fullName,
    imageBase64: compressedImageBase64
  };

  Swal.fire({ title: 'กำลังบันทึกข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.status === 'success') {
      Swal.fire('สำเร็จ', 'บันทึกการตรวจครุภัณฑ์เรียบร้อยแล้ว', 'success');
      closeAuditForm();
      await fetchAssets();
      await loadAuditStatus();
    } else {
      Swal.fire('ผิดพลาด', json.message, 'error');
    }
  } catch (err) {
    Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการส่งข้อมูล', 'error');
  }
}

// Dashboard & รายงานผู้บริหาร
function updateDashboardStats(total, audited) {
  const pending = Math.max(0, total - audited);
  const percent = total > 0 ? ((audited / total) * 100).toFixed(1) : 0;
  
  const activeAssets = allAssets.filter(a => a.status !== 'จำหน่าย');
  const totalValue = activeAssets.reduce((sum, a) => sum + (Number(a.price) || 0), 0);

  document.getElementById('statTotal').innerText = total.toLocaleString();
  document.getElementById('statAudited').innerText = audited.toLocaleString();
  document.getElementById('statPending').innerText = pending.toLocaleString();
  document.getElementById('statPercent').innerText = `${percent}%`;
  document.getElementById('statTotalValue').innerText = totalValue.toLocaleString();

  let normal = 0, damaged = 0, degraded = 0, lost = 0;
  Object.values(auditedMap).forEach(log => {
    if (log.status === 'ใช้งานได้') normal++;
    else if (log.status === 'ชำรุด') damaged++;
    else if (log.status === 'เสื่อมสภาพ/รอจำหน่าย') degraded++;
    else if (log.status === 'สูญหาย') lost++;
  });

  document.getElementById('countNormal').innerText = normal.toLocaleString();
  document.getElementById('countDamaged').innerText = damaged.toLocaleString();
  document.getElementById('countDegraded').innerText = degraded.toLocaleString();
  document.getElementById('countLost').innerText = lost.toLocaleString();
}

function renderReportTable() {
  const filter = document.getElementById('filterReportStatus').value;
  const keyword = document.getElementById('searchReport').value.toLowerCase();
  const tbody = document.getElementById('reportTableBody');
  tbody.innerHTML = '';

  const activeAssets = allAssets.filter(a => a.status !== 'จำหน่าย');

  activeAssets.forEach(asset => {
    const log = auditedMap[asset.assetCode];
    const isAudited = !!log;

    if (filter === 'AUDITED' && !isAudited) return;
    if (filter === 'PENDING' && isAudited) return;
    if (filter === 'DAMAGED' && (!isAudited || log.status === 'ใช้งานได้')) return;

    const searchStr = `${asset.assetCode} ${asset.assetName} ${asset.holder} ${asset.location}`.toLowerCase();
    if (keyword && !searchStr.includes(keyword)) return;

    let badge = `<span class="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-xs">ยังไม่ตรวจ</span>`;
    if (isAudited) {
      const color = log.status === 'ใช้งานได้' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700';
      badge = `<span class="${color} px-2 py-0.5 rounded-full text-xs font-medium">${log.status}</span>`;
    }

    const imgBtn = (isAudited && log.imageUrl) 
      ? `<a href="${log.imageUrl}" target="_blank" class="text-blue-600 underline text-xs">ดูรูป</a>` 
      : '-';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-2.5 font-mono text-xs">${asset.assetCode}</td>
        <td class="p-2.5">${asset.assetName}</td>
        <td class="p-2.5">${Number(asset.price).toLocaleString()}</td>
        <td class="p-2.5">${isAudited ? log.holder : (asset.holder || asset.note)}</td>
        <td class="p-2.5">${isAudited ? log.location : asset.location}</td>
        <td class="p-2.5">${badge}</td>
        <td class="p-2.5">${imgBtn}</td>
      </tr>
    `;
  });
}

function exportReportCSV() {
  const year = document.getElementById('auditYear').value;
  let csv = '\uFEFFรหัสครุภัณฑ์,ชื่อครุภัณฑ์,ราคา,ตำแหน่งที่ตั้ง,ผู้รับผิดชอบ,ผลการตรวจปี ' + year + ',ผู้ตรวจ,วันที่ตรวจ,ลิงก์รูปภาพ\n';

  allAssets.forEach(a => {
    const log = auditedMap[a.assetCode];
    const row = [
      `"${a.assetCode}"`,
      `"${a.assetName.replace(/"/g, '""')}"`,
      a.price,
      `"${log ? log.location : a.location}"`,
      `"${log ? log.holder : (a.holder || a.note)}"`,
      `"${a.status === 'จำหน่าย' ? 'จำหน่ายแล้ว' : (log ? log.status : 'ยังไม่ตรวจ')}"`,
      `"${log ? log.inspector : '-'}"`,
      `"${log ? log.auditDate : '-'}"`,
      `"${log ? log.imageUrl : ''}"`
    ];
    csv += row.join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `รายงานตรวจครุภัณฑ์_${year}.csv`;
  link.click();
}

// ส่วน Admin จัดการครุภัณฑ์ และพิมพ์ QR Code
function renderAdminTable() {
  const keyword = document.getElementById('searchAdmin').value.toLowerCase();
  const tbody = document.getElementById('adminTableBody');
  tbody.innerHTML = '';

  allAssets.forEach((asset, idx) => {
    const searchStr = `${asset.assetCode} ${asset.assetName} ${asset.status}`.toLowerCase();
    if (keyword && !searchStr.includes(keyword)) return;

    const statusBadge = asset.status === 'จำหน่าย' 
      ? `<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs">จำหน่าย</span>`
      : `<span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs">${asset.status}</span>`;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-2.5"><input type="checkbox" class="qr-checkbox" value="${asset.assetCode}"></td>
        <td class="p-2.5 font-mono text-xs">${asset.assetCode}</td>
        <td class="p-2.5">${asset.assetName}</td>
        <td class="p-2.5">${Number(asset.price).toLocaleString()}</td>
        <td class="p-2.5">${statusBadge}</td>
        <td class="p-2.5 text-right">
          <button onclick="openAdminModal('edit', ${idx})" class="text-orange-600 hover:underline text-xs font-medium">แก้ไข/จำหน่าย</button>
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
    document.getElementById('admMainCat').value = a.mainCategory;
    document.getElementById('admSubCat').value = a.subCategory;
    document.getElementById('admPrice').value = a.price;
    document.getElementById('admLocation').value = a.location;
    document.getElementById('admBudget').value = a.budget;
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
    mainCategory: document.getElementById('admMainCat').value,
    subCategory: document.getElementById('admSubCat').value,
    price: document.getElementById('admPrice').value,
    location: document.getElementById('admLocation').value,
    budget: document.getElementById('admBudget').value,
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

// พิมพ์สติกเกอร์ QR Code
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
    box.className = 'border border-black p-2 flex flex-col items-center text-center break-inside-avoid';
    box.innerHTML = `
      <div id="qr-${i}" class="mb-1"></div>
      <div class="font-bold text-xs font-mono">${asset.assetCode}</div>
      <div class="text-[10px] line-clamp-1">${asset.assetName}</div>
    `;
    grid.appendChild(box);

    new QRCode(document.getElementById(`qr-${i}`), {
      text: `${baseUrl}?code=${encodeURIComponent(asset.assetCode)}`,
      width: 90,
      height: 90
    });
  });

  setTimeout(() => window.print(), 500);
}
