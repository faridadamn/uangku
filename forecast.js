/* forecast.js — Jadwal & Forecast (recurring schedule + proyeksi saldo)
   Ditaruh SETELAH management.js di index.html, karena pakai patchRows() & currentRecorderProfile()
   yang didefinisikan di sana, plus household/profiles/accounts/categories/transactions/activeProfile
   dari app.js.
*/

(() => {
  const styleTag = document.createElement('style');
  styleTag.textContent = `
    .forecast-summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
    .forecast-summary .stat-card strong{font-size:14px}
    .schedule-tabs{display:flex;gap:8px;border-bottom:1px solid var(--line);padding-bottom:10px}
    .schedule-tab{border:0;background:transparent;color:var(--muted);font-weight:800;font-size:12px;padding:8px 4px;cursor:pointer;border-bottom:2px solid transparent}
    .schedule-tab.active{color:var(--mint);border-color:var(--mint)}
    .schedule-pane{display:none}
    .schedule-pane.active{display:grid;gap:10px}
    .mini-item.due_soon{border-color:rgba(251,191,36,.5)}
    .mini-item.overdue{border-color:rgba(251,113,133,.5)}
    .mini-item.paid{opacity:.55}
    .mini-item.skipped{opacity:.4;text-decoration:line-through}
    .mini-item-actions{display:flex;gap:6px}
    .mini-btn{border:1px solid var(--line);background:#091625;color:var(--text);border-radius:10px;padding:6px 8px;font-size:10px;font-weight:700;cursor:pointer}
    .mini-btn.danger{color:var(--danger);border-color:rgba(251,113,133,.4)}
  `;
  document.head.appendChild(styleTag);
})();

let scheduledTransactions = [];
let scheduledOccurrences = [];

function scheduleTypeLabel(type) {
  return type === 'income' ? 'Pemasukan' : 'Pengeluaran';
}

function recurrenceLabel(schedule) {
  const map = { once: 'Sekali', daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan', yearly: 'Tahunan' };
  const base = map[schedule.recurrence_type] || schedule.recurrence_type;
  return schedule.interval_count > 1 ? `${base} (tiap ${schedule.interval_count}x)` : base;
}

async function refreshScheduleOccurrences(horizonDays = 90) {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + horizonDays);
  const horizonDate = horizon.toISOString().slice(0, 10);
  try {
    await request('/rest/v1/rpc/finance_refresh_scheduled_occurrences', {
      method: 'POST',
      body: JSON.stringify({ p_household_id: household.id, p_horizon_date: horizonDate })
    });
  } catch (error) {
    console.error('Gagal refresh jadwal', error);
  }
}

async function loadForecastData() {
  await refreshScheduleOccurrences(90);
  const [scheduleRows, occurrenceRows] = await Promise.all([
    restQuery('finance_scheduled_transactions', `select=*&household_id=eq.${household.id}&order=start_date.asc`),
    restQuery('finance_scheduled_occurrences', `select=*&household_id=eq.${household.id}&status=neq.skipped&order=due_date.asc&limit=200`)
  ]);
  scheduledTransactions = scheduleRows || [];
  scheduledOccurrences = occurrenceRows || [];
}

function projectedBalance(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const scheduleMap = Object.fromEntries(scheduledTransactions.map((s) => [s.id, s]));
  const delta = scheduledOccurrences.reduce((sum, occurrence) => {
    if (!['upcoming', 'due_soon', 'overdue'].includes(occurrence.status)) return sum;
    if (new Date(occurrence.due_date) > cutoff) return sum;
    const schedule = scheduleMap[occurrence.scheduled_id];
    if (!schedule) return sum;
    return schedule.transaction_type === 'income' ? sum + Number(occurrence.amount) : sum - Number(occurrence.amount);
  }, 0);
  return familyBalance() + delta;
}

function renderForecastSummary() {
  $('forecastCurrentBalance').textContent = rupiah(familyBalance());
  $('forecastBalance30').textContent = rupiah(projectedBalance(30));
  $('forecastBalance90').textContent = rupiah(projectedBalance(90));
}

function renderScheduleList() {
  $('scheduleList').innerHTML = scheduledTransactions.length ? scheduledTransactions.map((schedule) => `
    <div class="mini-item ${schedule.is_active ? '' : 'skipped'}">
      <div class="mini-avatar">${schedule.transaction_type === 'income' ? '＋' : '−'}</div>
      <div><strong>${schedule.name}</strong><small>${recurrenceLabel(schedule)} · ${scheduleTypeLabel(schedule.transaction_type)}</small></div>
      <div class="mini-item-actions">
        <span>${rupiah(schedule.amount)}</span>
        <button type="button" class="mini-btn danger" data-delete-schedule="${schedule.id}">Hapus</button>
      </div>
    </div>`).join('') : '<div class="empty-state">Belum ada jadwal berulang.</div>';

  document.querySelectorAll('[data-delete-schedule]').forEach((button) => {
    button.addEventListener('click', () => deleteSchedule(button.dataset.deleteSchedule));
  });
}

function renderOccurrenceList() {
  const upcoming = scheduledOccurrences.filter((o) => o.status !== 'paid').slice(0, 15);
  const scheduleMap = Object.fromEntries(scheduledTransactions.map((s) => [s.id, s]));
  $('occurrenceList').innerHTML = upcoming.length ? upcoming.map((occurrence) => {
    const schedule = scheduleMap[occurrence.scheduled_id];
    const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(occurrence.due_date));
    const statusLabel = { upcoming: 'Akan datang', due_soon: 'Segera jatuh tempo', overdue: 'Lewat jatuh tempo', paid: 'Lunas' }[occurrence.status] || occurrence.status;
    return `<div class="mini-item ${occurrence.status}">
      <div class="mini-avatar">${schedule?.transaction_type === 'income' ? '＋' : '−'}</div>
      <div><strong>${schedule?.name || 'Jadwal'}</strong><small>${date} · ${statusLabel}</small></div>
      <div class="mini-item-actions">
        <span>${rupiah(occurrence.amount)}</span>
        <button type="button" class="mini-btn" data-pay-occurrence="${occurrence.id}">Lunas</button>
        <button type="button" class="mini-btn danger" data-skip-occurrence="${occurrence.id}">Lewati</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty-state">Tidak ada tagihan mendatang.</div>';

  document.querySelectorAll('[data-pay-occurrence]').forEach((button) => {
    button.addEventListener('click', () => payOccurrence(button.dataset.payOccurrence).catch((error) => toast(error.message || 'Gagal menandai lunas')));
  });
  document.querySelectorAll('[data-skip-occurrence]').forEach((button) => {
    button.addEventListener('click', () => skipOccurrence(button.dataset.skipOccurrence).catch((error) => toast(error.message || 'Gagal melewati tagihan')));
  });
}

function renderForecastAll() {
  renderForecastSummary();
  renderScheduleList();
  renderOccurrenceList();
}

async function openForecastDialog() {
  $('scheduleCategory').innerHTML = categories
    .filter((c) => c.transaction_type === $('scheduleType').value && (c.household_id === null || c.household_id === household.id))
    .map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  $('scheduleStart').value = new Date().toISOString().slice(0, 10);
  $('forecastDialog').showModal();
  try {
    await loadForecastData();
    renderForecastAll();
  } catch (error) {
    toast(error.message || 'Gagal memuat jadwal & forecast');
  }
}

async function saveSchedule(event) {
  event.preventDefault();
  const name = $('scheduleName').value.trim();
  const amount = Number($('scheduleAmount').value || 0);
  if (!name) throw new Error('Nama jadwal wajib diisi');
  if (!amount || amount <= 0) throw new Error('Nominal harus lebih dari nol');
  const startDate = $('scheduleStart').value;
  if (!startDate) throw new Error('Tanggal mulai wajib diisi');

  await insertRow('finance_scheduled_transactions', {
    household_id: household.id,
    profile_id: activeProfile?.id || null,
    created_by_profile_id: currentRecorderProfile()?.id || null,
    category_id: $('scheduleCategory').value || null,
    name,
    transaction_type: $('scheduleType').value,
    amount,
    recurrence_type: $('scheduleRecurrence').value,
    interval_count: Number($('scheduleInterval').value || 1),
    start_date: startDate,
    end_date: $('scheduleEnd').value || null,
    reminder_days_before: Number($('scheduleReminderDays').value || 3),
    is_active: true
  });

  $('scheduleForm').reset();
  $('scheduleInterval').value = 1;
  $('scheduleReminderDays').value = 3;
  toast('Jadwal tersimpan');
  await loadForecastData();
  renderForecastAll();
}

async function deleteSchedule(scheduleId) {
  if (!confirm('Hapus jadwal ini? Tagihan yang belum lunas ikut terhapus.')) return;
  await request(`/rest/v1/finance_scheduled_transactions?id=eq.${scheduleId}`, { method: 'DELETE' });
  toast('Jadwal dihapus');
  await loadForecastData();
  renderForecastAll();
}

async function payOccurrence(occurrenceId) {
  const occurrence = scheduledOccurrences.find((o) => o.id === occurrenceId);
  const schedule = scheduledTransactions.find((s) => s.id === occurrence?.scheduled_id);
  if (!occurrence || !schedule) throw new Error('Data tagihan tidak ditemukan');

  const payerProfileId = schedule.profile_id || activeProfile?.id;
  const account = accounts.find((a) => a.profile_id === payerProfileId) || accounts[0];
  if (!account) throw new Error('Tambahkan akun dulu sebelum menandai lunas');

  const payload = {
    household_id: household.id,
    profile_id: payerProfileId,
    created_by_profile_id: currentRecorderProfile()?.id || null,
    transaction_type: schedule.transaction_type,
    amount: Number(occurrence.amount),
    transaction_at: new Date().toISOString(),
    category_id: schedule.category_id || null,
    description: schedule.name,
    source_app: 'uangku',
    sync_mode: 'manual',
    reimbursement_status: 'none',
    status: 'posted'
  };
  if (schedule.transaction_type === 'income') payload.received_to_account_id = account.id;
  if (schedule.transaction_type === 'expense') payload.paid_from_account_id = account.id;

  const inserted = await insertRow('finance_transactions', payload);
  const transaction = inserted?.[0];

  await patchRows('finance_scheduled_occurrences', `id=eq.${occurrenceId}`, {
    status: 'paid',
    transaction_id: transaction?.id || null,
    paid_at: new Date().toISOString()
  });

  toast('Ditandai lunas');
  await loadData();
  await loadForecastData();
  renderForecastAll();
}

async function skipOccurrence(occurrenceId) {
  await patchRows('finance_scheduled_occurrences', `id=eq.${occurrenceId}`, { status: 'skipped' });
  toast('Tagihan dilewati');
  await loadForecastData();
  renderForecastAll();
}

$('manageForecastBtn').addEventListener('click', () => openForecastDialog().catch((error) => toast(error.message || 'Gagal membuka jadwal & forecast')));
$('scheduleForm').addEventListener('submit', (event) => saveSchedule(event).catch((error) => toast(error.message || 'Gagal menyimpan jadwal')));
$('scheduleType').addEventListener('change', () => {
  $('scheduleCategory').innerHTML = categories
    .filter((c) => c.transaction_type === $('scheduleType').value && (c.household_id === null || c.household_id === household.id))
    .map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
});
document.querySelectorAll('.schedule-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.schedule-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.schedule-pane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.pane).classList.add('active');
  });
});
