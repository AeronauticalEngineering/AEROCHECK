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
    openAuditForm(codeParam);
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
  document.getElementById('topUserInfo').innerText = `${currentUser.fullName} • ${roleLabels[currentUser.role] || currentUser.role}`;
  document.getElementById('sidebarUserName').innerText = currentUser.fullName;
  document.getElementById('formInspector').value = currentUser.fullName;

  const sidebar = document.getElementById('adminSidebar');
  const auditView = document.getElementById('view-audit-2col');
  const adminPanel = document.getElementById('view-admin-panel');

  if (currentUser.role === 'admin') {
    sidebar.classList.remove('hidden');
    sidebar.classList.add('flex');
    auditView.classList.add('hidden');
    adminPanel.classList.remove('hidden');
    switchAdminView('dashboard');
  } else if (currentUser.role === 'user') {
    sidebar.classList.add('hidden');
    sidebar.classList.remove('flex');
    auditView.classList.remove('hidden');
    adminPanel.classList.add('hidden');
  } else if (currentUser.role === 'exec') {
    sidebar.classList.add('hidden');
    sidebar.classList.remove('flex');
    auditView.classList.add('hidden');
    adminPanel.classList.remove('hidden');
    document.getElementById('adm-sub-dashboard').classList.remove('hidden');
    document.getElementById('adm-sub-table').classList.remove('hidden');
  }
}

function logout() {
  if (isScanning && html5QrCode) {
    html5QrCode.stop().catch(() => {});
    isScanning = false;
  }
  localStorage.removeItem('asset_user_session');
  currentUser = null;
  document.getElementById('appContainer').classList.add('hidden');
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('loginPin').value = '';
}

function switchAdminView(viewName) {
  document.querySelectorAll('.adm-nav-btn').forEach(btn => {
    btn.classList.remove('bg-blue-600', 'text-white', 'font-medium');
  });
  const activeBtn = document.getElementById(`adm-nav-${viewName}`);
  if (activeBtn) activeBtn.classList.add('bg-blue-600', 'text-white', 'font-medium');

  document.getElementById('adm-sub-dashboard').classList.add('hidden');
  document.getElementById('adm-sub-cycles').classList.add('hidden');
  document.getElementById('adm-sub-table').classList.add('hidden');

  if (viewName === 'dashboard') {
    document.getElementById('adm-sub-dashboard').classList.remove('hidden');
  } else if (viewName === 'cycles') {
    document.getElementById('adm-sub-cycles').classList.remove('hidden');
  } else {
    document.getElementById('adm-sub-table').classList.remove('hidden');
    const titles = {
      assets: ['ทะเบียนครุภัณฑ์', 'เพิ่ม แก้ไข หรือจำหน่ายครุภัณฑ์ในฐานข้อมูล'],
      results: ['ผลการตรวจประจำปี', 'ตรวจสอบสถานะการสแกนตรวจนับแยกตามรายการ'],
      locations: ['ความคืบหน้าแยกตามสถานที่', 'ค้นหาและตรวจสอบครุภัณฑ์ตามสถานที่ตั้ง'],
      holders: ['ผู้ถือครองครุภัณฑ์', 'ค้นหาและตรวจสอบผู้รับผิดชอบครุภัณฑ์'],
      qrcode: ['พิมพ์สติกเกอร์ QR Code', 'ติ๊กเลือกรายการครุภัณฑ์แล้วกดพิมพ์ QR Code'],
      report: ['รายงานสรุปผล', 'ดูข้อมูลและส่งออกรายงาน CSV']
    };
    const [t, s] = titles[viewName] || ['ทะเบียนครุภัณฑ์', ''];
    document.getElementById('admTableTitle').innerText = t;
    document.getElementById('admTableSubtitle').innerText = s;
    renderAdminTable();
  }
}

async function fetchAssets() {
  try {
    const res = await fetch(`${API_URL}?action=getAssets`);
    const json = await res.json();
    if (json.status === 'success') {
      allAssets = json.data;
      renderAdminTable();
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadAuditStatus() {
  const year = document.getElementById('auditYear').value;
  document.getElementById('cardCycleYear').innerText = year;
  document.getElementById('dashYearBadge').innerText = `ปี ${year}`;

  try {
    const res = await fetch(`${API_URL}?action=getAuditReport&year=${year}`);
    const json = await res.json();
    if (json.status === 'success') {
      auditedMap = json.auditedMap;
      updateAllStats(json.totalAssets, json.auditedCount);
      renderRecentAudited();
      renderAdminTable();
    }
  } catch (err) {
    console.error(err);
  }
}

function updateAllStats(total, audited) {
  const pending = Math.max(0, total - audited);
  const percent = total > 0 ? Math.round((audited / total) * 100) : 0;

  let normal = 0, damaged = 0, lost = 0, issue = 0;
  Object.values(auditedMap).forEach(log => {
    if (log.status === 'ใช้งานได้') normal++;
    else if (log.status === 'ชำรุด') { damaged++; issue++; }
    else if (log.status === 'สูญหาย') { lost++; issue++; }
    else if (log.status === 'เสื่อมสภาพ/รอจำหน่าย') issue++;
  });

  // อัปเดตการ์ดฝั่งสแกน (ภาพที่ 2)
  document.getElementById('cardProgressPercent').innerText = `${percent}%`;
  document.getElementById('cardProgressBar').style.width = `${percent}%`;
  document.getElementById('cardProgressRatio').innerText = `${audited} / ${total} รายการ`;
  document.getElementById('miniNormal').innerText = normal;
  document.getElementById('miniDamaged').innerText = damaged;
  document.getElementById('miniLost').innerText = lost;
  document.getElementById('miniPending').innerText = pending;

  // อัปเดตหน้า Inspection Dashboard (ภาพที่ 3)
  document.getElementById('dashTotal').innerText = total;
  document.getElementById('dashAudited').innerText = audited;
  document.getElementById('dashPending').innerText = pending;
  document.getElementById('dashIssue').innerText = issue;
  document.getElementById('donutPercent').innerText = `${percent}%`;
  document.getElementById('donutAuditedText').innerText = audited;
  document.getElementById('donutPendingText').innerText = pending;
  document.getElementById('donutChart').style.background = `conic-gradient(#16a34a 0% ${percent}%, #e2e8f0 ${percent}% 100%)`;

  // อัปเดตหน้าจัดการรอบตรวจประจำปี (ภาพที่ 4)
  document.getElementById('cycle2570Summary').innerText = `ตรวจแล้ว ${audited} / ${total} รายการ (${percent}%)`;
  document.getElementById('cycle2570Bar').style.width = `${percent}%`;

  // ความคืบหน้าแยกตามสถานที่
  const activeAssets = allAssets.filter(a => a.status !== 'จำหน่าย');
  const locMap = {};
  activeAssets.forEach(a => {
    const loc = (auditedMap[a.assetCode]?.location || a.location || 'ไม่ระบุสถานที่').trim();
    if (!locMap[loc]) locMap[loc] = { total: 0, done: 0 };
    locMap[loc].total++;
    if (auditedMap[a.assetCode]) locMap[loc].done++;
  });

  const locContainer = document.getElementById('locationProgressList');
  locContainer.innerHTML = '';
  Object.entries(locMap).slice(0, 6).forEach(([loc, st]) => {
    const p = st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;
    const barColor = p === 100 ? 'bg-emerald-600' : 'bg-blue-600';
    locContainer.innerHTML += `
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="font-medium text-slate-700">${loc}</span>
          <span class="font-semibold text-slate-800">${p}% (${st.done}/${st.total})</span>
        </div>
        <div class="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
          <div class="${barColor} h-full rounded-full" style="width: ${p}%"></div>
        </div>
      </div>
    `;
  });
}

function renderRecentAudited() {
  const container = document.getElementById('recentAuditedList');
  const logs = Object.values(auditedMap).slice(-3).reverse();
  if (logs.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-400">ยังไม่มีรายการที่ตรวจในปีนี้</div>`;
    return;
  }
  container.innerHTML = logs.map(l => `
    <div class="flex items-center justify-between border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <div>
        <div class="font-semibold text-slate-800 text-xs">${l.assetName}</div>
        <div class="text-[11px] text-slate-500 font-mono">${l.assetCode}</div>
      </div>
      <i class="bi bi-check-circle-fill text-emerald-600"></i>
    </div>
  `).join('');
}

function toggleScanner() {
  const readerDiv = document.getElementById('reader');
  const btn = document.getElementById('btnToggleCam');

  if (!isScanning) {
    readerDiv.classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader", {
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false
    });
    html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 20,
        qrbox: (vw, vh) => ({
          width: Math.min(300, Math.floor(vw * 0.8)),
          height: Math.min(220, Math.floor(vh * 0.65))
        }),
        aspectRatio: 1.333,
        disableFlip: false
      },
      (decodedText) => {
        let extractedCode = decodedText.trim();
        if (decodedText.includes('code=')) {
          extractedCode = new URL(decodedText).searchParams.get('code');
        }
        toggleScanner();
        openAuditForm(extractedCode);
      }
    ).then(() => {
      isScanning = true;
      btn.innerHTML = '<i class="bi bi-stop-circle text-xl"></i><span class="text-sm">ปิดกล้องสแกน</span>';
      btn.classList.replace('bg-blue-600', 'bg-red-600');
    }).catch(() => {
      Swal.fire('เปิดกล้องไม่สำเร็จ', 'กรุณาอนุญาตการเข้าถึงกล้องบนเบราว์เซอร์', 'warning');
    });
  } else {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
      readerDiv.classList.add('hidden');
      isScanning = false;
      btn.innerHTML = '<i class="bi bi-qr-code-scan text-xl"></i><span class="text-sm">สแกน QR Code</span>';
      btn.classList.replace('bg-red-600', 'bg-blue-600');
    }).catch(() => {});
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

  document.getElementById('dispName').innerText = asset.assetName;
  document.getElementById('dispCode').innerText = `รหัส ${asset.assetCode}`;
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
  document.getElementById('formStatus').value = asset.status === 'จำหน่าย' ? 'ใช้งานได้' : (asset.status || 'ใช้งานได้');
  document.getElementById('formHolder').value = asset.holder || asset.note || '';
  document.getElementById('formLocation').value = asset.location || '';
  document.getElementById('formInspector').value = currentUser.fullName;
  document.getElementById('formNote').value = '';
  document.getElementById('formImage').value = '';
  document.getElementById('imagePreview').classList.add('hidden');
  compressedImageBase64 = '';
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
  const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
  const json = await res.json();

  if (json.status === 'success') {
    Swal.fire('สำเร็จ', 'บันทึกผลการตรวจเรียบร้อยแล้ว', 'success');
    await fetchAssets();
    await loadAuditStatus();
  } else {
    Swal.fire('ผิดพลาด', json.message, 'error');
  }
}

function renderAdminTable() {
  const keyword = (document.getElementById('searchAdmin')?.value || '').toLowerCase();
  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  allAssets.forEach((asset, idx) => {
    const log = auditedMap[asset.assetCode];
    const holder = log ? log.holder : (asset.holder || asset.note || '-');
    const loc = log ? log.location : (asset.location || '-');

    const str = `${asset.assetCode} ${asset.assetName} ${holder} ${loc}`.toLowerCase();
    if (keyword && !str.includes(keyword)) return;

    const statusBadge = asset.status === 'จำหน่าย'
      ? `<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs">จำหน่าย</span>`
      : (log
          ? `<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-xs">ตรวจแล้ว (${log.status})</span>`
          : `<span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs">ยังไม่ตรวจ</span>`);

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-2.5"><input type="checkbox" class="qr-checkbox" value="${asset.assetCode}"></td>
        <td class="p-2.5 font-mono text-xs">${asset.assetCode}</td>
        <td class="p-2.5">${asset.assetName}</td>
        <td class="p-2.5 text-xs text-slate-600">${holder} / ${loc}</td>
        <td class="p-2.5">${statusBadge}</td>
        <td class="p-2.5 text-right">
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
