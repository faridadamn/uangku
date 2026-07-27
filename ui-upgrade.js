let currentMembership = null;

function ensureDashboardStructure() {
  const content = $('mainFinanceContent');
  if (!content || content.dataset.upgraded === 'true') return;
  content.dataset.upgraded = 'true';

  const topbar = document.querySelector('.topbar');
  const profileStrip = document.querySelector('.profile-strip');
  const hero = document.querySelector('.hero-card');
  const actions = document.querySelector('.quick-actions');
  if (topbar && profileStrip && hero) {
    const header = document.createElement('section');
    header.className = 'dashboard-header';
    topbar.parentNode.insertBefore(header, topbar);
    header.append(topbar, profileStrip, hero);
  }

  if (actions) {
    const buttons = [...actions.querySelectorAll('.quick-btn')];
    const transfer = buttons.find((button) => button.dataset.action === 'transfer');
    const advance = $('advanceExpenseBtn');
    if (transfer) {
      transfer.dataset.originalAction = 'transfer';
      transfer.dataset.action = '';
      transfer.innerHTML = '<span>⌛</span>Riwayat';
      transfer.addEventListener('click', (event) => {
        event.stopImmediatePropagation();
        $('sourceFilter').value = 'all';
        renderTransactions();
        document.querySelector('.section-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, true);
    }
    if (advance) {
      advance.innerHTML = '<span>◫</span>Rekap';
      advance.addEventListener('click', (event) => {
        event.stopImmediatePropagation();
        openRekapDialog();
      }, true);
    }

    const tools = document.createElement('section');
    tools.className = 'secondary-tools';
    tools.innerHTML = '<button id="secondaryTransferBtn" type="button">⇄ Transfer antar akun</button><button id="secondaryAdvanceBtn" type="button">⌁ Talangan anak</button>';
    actions.insertAdjacentElement('afterend', tools);
    $('secondaryTransferBtn').addEventListener('click', () => openTransactionDialog('transfer'));
    $('secondaryAdvanceBtn').addEventListener('click', openAdvanceDialog);
  }

  const familyCard = document.querySelector('.family-grid .stat-card:first-child');
  familyCard?.classList.add('owner-only');
  $('manageMembersBtn')?.classList.add('owner-only');

  createBottomNav();
  createUtilityDialogs();
}

function createBottomNav() {
  if ($('bottomNav')) return;
  const nav = document.createElement('nav');
  nav.id = 'bottomNav';
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    <button class="active" data-tab="home"><span>⌂</span><span>Beranda</span></button>
    <button data-tab="income"><span>＋</span><span>Masuk</span></button>
    <button data-tab="expense"><span>−</span><span>Keluar</span></button>
    <button data-tab="rekap"><span>▥</span><span>Rekap</span></button>
    <button data-tab="profile"><span>○</span><span>Profil</span></button>`;
  document.body.appendChild(nav);
  nav.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    nav.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    const tab = button.dataset.tab;
    if (tab === 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'income') openTransactionDialog('income');
    if (tab === 'expense') openTransactionDialog('expense');
    if (tab === 'rekap') openRekapDialog();
    if (tab === 'profile') openProfileHub();
  }));
}

function createUtilityDialogs() {
  if (!$('rekapDialog')) {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="rekapDialog"><div class="dialog-card"><div class="dialog-head"><h3>Rekap bulan ini</h3><button type="button" class="utility-close">×</button></div><div id="rekapSummary"></div><div id="rekapProfiles" class="mini-list"></div></div></dialog>
      <dialog id="profileHubDialog"><div class="dialog-card"><div class="dialog-head"><h3>Profil & pengaturan</h3><button type="button" class="utility-close">×</button></div><div id="profileHubContent" class="profile-hub"></div></div></dialog>`);
    document.querySelectorAll('.utility-close').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  }
}

function openRekapDialog() {
  if (!$('rekapDialog')) createUtilityDialogs();
  const start = new Date();
  start.setDate(1); start.setHours(0,0,0,0);
  const monthRows = transactions.filter((transaction) => new Date(transaction.transaction_at) >= start);
  const income = monthRows.filter((transaction) => transaction.transaction_type === 'income').reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const expense = monthRows.filter((transaction) => transaction.transaction_type === 'expense').reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  $('rekapSummary').innerHTML = `<div class="rekap-grid"><div class="rekap-box"><span>Masuk</span><strong>${rupiah(income)}</strong></div><div class="rekap-box"><span>Keluar</span><strong>${rupiah(expense)}</strong></div><div class="rekap-box"><span>Selisih</span><strong>${rupiah(income-expense)}</strong></div></div>`;
  $('rekapProfiles').innerHTML = profiles.map((profile) => {
    const totals = monthTotals(profile.id);
    return `<div class="mini-item"><div class="mini-avatar">${profile.emoji || '👤'}</div><div><strong>${profile.name}</strong><small>Masuk ${rupiah(totals.income)} · Keluar ${rupiah(totals.expense)}</small></div><span>${rupiah(totals.income - totals.expense)}</span></div>`;
  }).join('');
  $('rekapDialog').showModal();
}

function openProfileHub() {
  if (!$('profileHubDialog')) createUtilityDialogs();
  const ownerButton = currentMembership?.member_role === 'owner' ? '<button id="hubMembers">✉ Anggota & undangan</button>' : '';
  $('profileHubContent').innerHTML = `
    <button id="hubProfiles">👨‍👩‍👧‍👦 Profil keluarga</button>
    <button id="hubAccounts">◫ Akun & dompet</button>
    ${ownerButton}
    <button id="hubLogout">↗ Keluar dari akun</button>`;
  $('hubProfiles').addEventListener('click', () => { $('profileHubDialog').close(); $('manageProfilesBtn').click(); });
  $('hubAccounts').addEventListener('click', () => { $('profileHubDialog').close(); $('manageAccountsBtn').click(); });
  $('hubMembers')?.addEventListener('click', () => { $('profileHubDialog').close(); $('manageMembersBtn').click(); });
  $('hubLogout').addEventListener('click', () => $('logoutBtn').click());
  $('profileHubDialog').showModal();
}

async function applyMembershipRoleUI() {
  if (!user?.id || !household?.id) return;
  const rows = await restQuery('finance_household_members', `select=*&household_id=eq.${household.id}&auth_user_id=eq.${user.id}&status=eq.active&limit=1`);
  currentMembership = rows?.[0] || null;
  const isOwner = currentMembership?.member_role === 'owner';
  document.querySelectorAll('.owner-only').forEach((element) => element.classList.toggle('hidden-by-role', !isOwner));
  if (!isOwner && $('membersDialog')?.open) $('membersDialog').close();
}

ensureDashboardStructure();
const roleAwareLoadData = loadData;
loadData = async function upgradedLoadData() {
  await roleAwareLoadData();
  ensureDashboardStructure();
  await applyMembershipRoleUI();
};

if (session?.access_token && user) loadData();