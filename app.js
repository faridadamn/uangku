const SUPABASE_URL = 'https://kipcvugwlghonpgvitjk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const REAL_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6ImtpcGN2dWd3bGdob25wZ3ZpdGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMDUzNTgsImV4cCI6MjA5MjU4MTM1OH0.orjTj18nAm0HDLffgWzJpaZM4wfW2-L_C8ukzYKX88Y';
const SESSION_KEY = 'uangku_session';

const $ = (id) => document.getElementById(id);
const rupiah = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n || 0));
const localDateTimeValue = (date = new Date()) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
};
const monthStartIso = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
};

let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
let user = session?.user || null;
let household = null;
let profiles = [];
let accounts = [];
let categories = [];
let transactions = [];
let activeProfile = null;

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2600);
}

async function refreshSession() {
  if (!session?.refresh_token) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: REAL_SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!response.ok) return false;
    session = await response.json();
    user = session.user;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return true;
  } catch { return false; }
}

async function request(path, options = {}, useAuth = true, retry = true) {
  const headers = {
    apikey: REAL_SUPABASE_KEY,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (useAuth && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  if (response.status === 401 && useAuth && retry && await refreshSession()) return request(path, options, useAuth, false);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.msg || data?.error_description || data?.hint || `HTTP ${response.status}`);
  return data;
}

const restQuery = (table, query = '') => request(`/rest/v1/${table}${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } });
const insertRow = (table, payload) => request(`/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) });

async function signIn(email, password) {
  const data = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
  session = data;
  user = data.user;
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  await applySession();
}

async function applySession() {
  const loggedIn = Boolean(session?.access_token && user);
  $('authView').classList.toggle('hidden', loggedIn);
  $('appView').classList.toggle('hidden', !loggedIn);
  if (loggedIn) await loadData();
}

async function loadData() {
  try {
    const householdRows = await restQuery('finance_households', 'select=*&order=created_at.asc&limit=1');
    household = householdRows?.[0] || null;
    if (!household) throw new Error('Household belum tersedia. Simpan satu transaksi di Orderan lebih dulu.');

    const [profileRows, accountRows, categoryRows, transactionRows] = await Promise.all([
      restQuery('finance_profiles', `select=*&household_id=eq.${household.id}&is_active=eq.true&order=created_at.asc`),
      restQuery('finance_accounts', `select=*&household_id=eq.${household.id}&is_active=eq.true&order=created_at.asc`),
      restQuery('finance_categories', 'select=*&is_active=eq.true&order=transaction_type.asc,name.asc'),
      restQuery('finance_transactions', `select=*&household_id=eq.${household.id}&status=eq.posted&order=transaction_at.desc&limit=200`)
    ]);

    profiles = profileRows || [];
    accounts = accountRows || [];
    categories = categoryRows || [];
    transactions = transactionRows || [];
    activeProfile = profiles.find((p) => p.auth_user_id === user.id) || profiles[0] || null;
    renderAll();
  } catch (error) {
    console.error(error);
    toast(error.message || 'Gagal memuat data');
  }
}

function profileTransactions(profileId) {
  return transactions.filter((t) => t.profile_id === profileId);
}

function profileBalance(profileId) {
  return profileTransactions(profileId).reduce((sum, t) => {
    if (t.transaction_type === 'income' || (t.transaction_type === 'adjustment' && t.received_to_account_id)) return sum + Number(t.amount);
    if (t.transaction_type === 'expense' || (t.transaction_type === 'adjustment' && t.paid_from_account_id)) return sum - Number(t.amount);
    return sum;
  }, 0);
}

function familyBalance() {
  const initial = accounts.reduce((sum, a) => sum + Number(a.initial_balance || 0), 0);
  return transactions.reduce((sum, t) => {
    if (t.transaction_type === 'income' || (t.transaction_type === 'adjustment' && t.received_to_account_id)) return sum + Number(t.amount);
    if (t.transaction_type === 'expense' || (t.transaction_type === 'adjustment' && t.paid_from_account_id)) return sum - Number(t.amount);
    return sum;
  }, initial);
}

function monthTotals(profileId) {
  const start = new Date(monthStartIso());
  return profileTransactions(profileId).reduce((acc, t) => {
    if (new Date(t.transaction_at) < start) return acc;
    if (t.transaction_type === 'income') acc.income += Number(t.amount);
    if (t.transaction_type === 'expense') acc.expense += Number(t.amount);
    return acc;
  }, { income: 0, expense: 0 });
}

function renderAll() {
  $('householdName').textContent = household?.name || 'Keuangan keluarga';
  $('profileSelect').innerHTML = profiles.map((p) => `<option value="${p.id}">${p.emoji || '👤'} ${p.name}</option>`).join('');
  if (activeProfile) $('profileSelect').value = activeProfile.id;
  renderDashboard();
  renderTransactions();
}

function renderDashboard() {
  if (!activeProfile) return;
  const totals = monthTotals(activeProfile.id);
  $('activeProfileName').textContent = activeProfile.name;
  $('profileRole').textContent = activeProfile.role === 'child' ? 'Anak' : activeProfile.relationship === 'wife' ? 'Istri' : 'Orang tua';
  $('profileBalance').textContent = rupiah(profileBalance(activeProfile.id));
  $('monthIncome').textContent = rupiah(totals.income);
  $('monthExpense').textContent = rupiah(totals.expense);
  $('familyBalance').textContent = rupiah(familyBalance());
  $('pendingReimbursements').textContent = rupiah(transactions.filter((t) => ['pending', 'partial'].includes(t.reimbursement_status)).reduce((s, t) => s + Number(t.amount), 0));
}

function renderTransactions() {
  const source = $('sourceFilter').value;
  const rows = transactions.filter((t) => t.profile_id === activeProfile?.id && (source === 'all' || t.source_app === source)).slice(0, 30);
  if (!rows.length) {
    $('transactionList').innerHTML = '<div class="empty-state">Belum ada transaksi untuk profil dan filter ini.</div>';
    return;
  }
  const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  $('transactionList').innerHTML = rows.map((t) => {
    const type = t.transaction_type;
    const sign = type === 'income' ? '+' : type === 'expense' ? '−' : '⇄';
    const category = categoryMap[t.category_id]?.name || (type === 'transfer' ? 'Transfer internal' : 'Tanpa kategori');
    const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(t.transaction_at));
    return `<article class="transaction-item">
      <div class="transaction-icon ${type}">${sign}</div>
      <div class="transaction-meta"><h4>${t.description || category}</h4><p>${category} · ${date} · ${t.source_app === 'orderan' ? 'Orderan' : 'UangKu'} · ${profileMap[t.profile_id]?.name || ''}</p></div>
      <div class="transaction-amount ${type}">${type === 'income' ? '+' : type === 'expense' ? '−' : ''}${rupiah(t.amount)}</div>
    </article>`;
  }).join('');
}

function accountLabel(account) {
  const owner = profiles.find((p) => p.id === account.profile_id)?.name;
  return owner ? `${account.name} · ${owner}` : account.name;
}

function openTransactionDialog(type) {
  if (!activeProfile) return;
  $('transactionType').value = type;
  $('transactionAmount').value = '';
  $('transactionDescription').value = '';
  $('transactionAt').value = localDateTimeValue();
  $('transactionDialogTitle').textContent = type === 'income' ? 'Tambah pendapatan' : type === 'expense' ? 'Tambah pengeluaran' : 'Transfer internal';
  $('categoryField').classList.toggle('hidden', type === 'transfer');
  $('accountField').classList.toggle('hidden', type === 'transfer');
  $('transferFromField').classList.toggle('hidden', type !== 'transfer');
  $('transferToField').classList.toggle('hidden', type !== 'transfer');

  const activeAccounts = accounts.filter((a) => a.profile_id === activeProfile.id);
  const accountOptions = accounts.map((a) => `<option value="${a.id}">${accountLabel(a)}</option>`).join('');
  $('transactionAccount').innerHTML = activeAccounts.map((a) => `<option value="${a.id}">${accountLabel(a)}</option>`).join('') || accountOptions;
  $('transferFrom').innerHTML = accountOptions;
  $('transferTo').innerHTML = accountOptions;

  const availableCategories = categories.filter((c) => c.transaction_type === type && (c.household_id === null || c.household_id === household.id));
  $('transactionCategory').innerHTML = availableCategories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  $('transactionDialog').showModal();
}

async function saveTransaction() {
  const type = $('transactionType').value;
  const amount = Number($('transactionAmount').value || 0);
  if (!amount || amount <= 0) throw new Error('Nominal harus lebih dari nol');
  const transactionAt = new Date($('transactionAt').value).toISOString();
  const payload = {
    household_id: household.id,
    profile_id: activeProfile.id,
    created_by_profile_id: profiles.find((p) => p.auth_user_id === user.id)?.id || activeProfile.id,
    transaction_type: type,
    amount,
    transaction_at: transactionAt,
    category_id: type === 'transfer' ? null : ($('transactionCategory').value || null),
    description: $('transactionDescription').value.trim() || null,
    source_app: 'uangku',
    source_table: null,
    source_record_id: null,
    sync_mode: 'manual',
    reimbursement_status: 'none',
    status: 'posted'
  };

  if (type === 'income') payload.received_to_account_id = $('transactionAccount').value;
  if (type === 'expense') payload.paid_from_account_id = $('transactionAccount').value;
  if (type === 'transfer') {
    payload.transfer_from_account_id = $('transferFrom').value;
    payload.transfer_to_account_id = $('transferTo').value;
    if (payload.transfer_from_account_id === payload.transfer_to_account_id) throw new Error('Akun asal dan tujuan harus berbeda');
  }

  await insertRow('finance_transactions', payload);
  $('transactionDialog').close();
  toast('Transaksi tersimpan');
  await loadData();
}

$('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('authMessage').textContent = 'Memproses…';
  try {
    await signIn($('email').value.trim(), $('password').value);
    $('authMessage').textContent = '';
  } catch (error) {
    $('authMessage').textContent = error.message || 'Gagal masuk';
  }
});

$('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY);
  session = null;
  user = null;
  applySession();
});

$('profileSelect').addEventListener('change', () => {
  activeProfile = profiles.find((p) => p.id === $('profileSelect').value) || activeProfile;
  renderDashboard();
  renderTransactions();
});
$('sourceFilter').addEventListener('change', renderTransactions);
document.querySelectorAll('.quick-btn').forEach((button) => button.addEventListener('click', () => openTransactionDialog(button.dataset.action)));
document.querySelector('.close-btn').addEventListener('click', () => $('transactionDialog').close());
$('transactionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await saveTransaction(); } catch (error) { toast(error.message || 'Gagal menyimpan transaksi'); }
});

applySession();