const modalCloseButtons = document.querySelectorAll('.modal-close');
modalCloseButtons.forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

async function patchRows(table, query, payload) {
  return request(`/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
}

function currentRecorderProfile() {
  return profiles.find((profile) => profile.auth_user_id === user?.id) || activeProfile;
}

function renderProfilesManager() {
  $('profilesList').innerHTML = profiles.length ? profiles.map((profile) => `
    <div class="mini-item">
      <div class="mini-avatar">${profile.emoji || '👤'}</div>
      <div><strong>${profile.name}</strong><small>${profile.role === 'child' ? 'Anak' : profile.relationship === 'wife' ? 'Orang tua · Istri' : 'Orang tua · Suami'}</small></div>
      <span class="status-dot"></span>
    </div>`).join('') : '<div class="empty-state">Belum ada profil.</div>';
}

function renderAccountsManager() {
  $('newAccountProfile').innerHTML = profiles.map((profile) => `<option value="${profile.id}">${profile.emoji || '👤'} ${profile.name}</option>`).join('');
  $('accountsList').innerHTML = accounts.length ? accounts.map((account) => {
    const owner = profiles.find((profile) => profile.id === account.profile_id);
    return `<div class="mini-item"><div class="mini-avatar">◫</div><div><strong>${account.name}</strong><small>${owner?.name || 'Keluarga'} · ${account.account_type.replace('_', ' ')}</small></div><span>${rupiah(account.initial_balance)}</span></div>`;
  }).join('') : '<div class="empty-state">Belum ada akun.</div>';
}

async function addProfile(event) {
  event.preventDefault();
  const name = $('newProfileName').value.trim();
  const role = $('newProfileRole').value;
  const relationship = role === 'child' ? 'child' : $('newProfileRelationship').value;
  if (!name) return toast('Nama profil wajib diisi');

  const inserted = await insertRow('finance_profiles', {
    household_id: household.id,
    auth_user_id: null,
    name,
    role,
    relationship,
    emoji: $('newProfileEmoji').value.trim() || (role === 'child' ? '🧒' : '👤'),
    saving_target: 0,
    is_login_enabled: false,
    is_active: true
  });
  const profile = inserted?.[0];
  if (profile) {
    await insertRow('finance_accounts', {
      household_id: household.id,
      profile_id: profile.id,
      name: role === 'child' ? `Saldo ${name}` : `Dompet ${name}`,
      account_type: role === 'child' ? 'virtual_balance' : 'cash',
      currency_code: 'IDR',
      initial_balance: 0,
      is_active: true
    });
  }
  $('profileForm').reset();
  $('newProfileEmoji').value = '👤';
  toast('Profil dan akun utama dibuat');
  await loadData();
  renderProfilesManager();
}

async function addAccount(event) {
  event.preventDefault();
  await insertRow('finance_accounts', {
    household_id: household.id,
    profile_id: $('newAccountProfile').value,
    name: $('newAccountName').value.trim(),
    account_type: $('newAccountType').value,
    currency_code: 'IDR',
    initial_balance: Number($('newAccountInitialBalance').value || 0),
    is_active: true
  });
  $('accountForm').reset();
  toast('Akun baru dibuat');
  await loadData();
  renderAccountsManager();
}

function openAdvanceDialog() {
  const children = profiles.filter((profile) => profile.role === 'child');
  const wifeProfiles = profiles.filter((profile) => profile.relationship === 'wife');
  const wifeAccountIds = new Set(wifeProfiles.map((profile) => profile.id));
  const payerAccounts = accounts.filter((account) => wifeAccountIds.has(account.profile_id));
  if (!children.length) return toast('Tambahkan profil anak lebih dulu');
  if (!payerAccounts.length) return toast('Tambahkan profil dan akun istri lebih dulu');

  $('advanceChild').innerHTML = children.map((profile) => `<option value="${profile.id}">${profile.emoji || '🧒'} ${profile.name}</option>`).join('');
  $('advancePayerAccount').innerHTML = payerAccounts.map((account) => `<option value="${account.id}">${accountLabel(account)}</option>`).join('');
  $('advanceCategory').innerHTML = categories.filter((category) => category.transaction_type === 'expense').map((category) => `<option value="${category.id}">${category.name}</option>`).join('');
  $('advanceAmount').value = '';
  $('advanceDescription').value = '';
  $('advanceAt').value = localDateTimeValue();
  $('advanceDialog').showModal();
}

async function saveAdvance(event) {
  event.preventDefault();
  const payerAccount = accounts.find((account) => account.id === $('advancePayerAccount').value);
  const reimbursableProfile = profiles.find((profile) => profile.id === payerAccount?.profile_id);
  if (!reimbursableProfile) return toast('Profil pembayar tidak ditemukan');

  await insertRow('finance_transactions', {
    household_id: household.id,
    profile_id: $('advanceChild').value,
    created_by_profile_id: currentRecorderProfile()?.id || null,
    transaction_type: 'expense',
    amount: Number($('advanceAmount').value),
    transaction_at: new Date($('advanceAt').value).toISOString(),
    category_id: $('advanceCategory').value,
    description: $('advanceDescription').value.trim() || 'Pengeluaran anak ditalangi orang tua',
    paid_from_account_id: payerAccount.id,
    source_app: 'uangku',
    source_table: null,
    source_record_id: null,
    sync_mode: 'manual',
    reimbursement_status: 'pending',
    reimbursable_to_profile_id: reimbursableProfile.id,
    status: 'posted'
  });
  $('advanceDialog').close();
  toast('Talangan anak tersimpan');
  await loadData();
}

async function reimbursementPaidAmount(expenseId) {
  const rows = await restQuery('finance_reimbursement_items', `select=amount&expense_transaction_id=eq.${expenseId}`);
  return (rows || []).reduce((sum, item) => sum + Number(item.amount), 0);
}

async function openReimbursementsDialog() {
  const pending = transactions.filter((transaction) => transaction.transaction_type === 'expense' && ['pending', 'partial'].includes(transaction.reimbursement_status));
  if (!pending.length) {
    $('reimbursementsList').innerHTML = '<div class="empty-state">Tidak ada talangan yang belum dibayar.</div>';
    $('reimbursementForm').classList.add('hidden');
  } else {
    $('reimbursementForm').classList.remove('hidden');
    const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category]));
    $('reimbursementsList').innerHTML = pending.map((transaction) => {
      const owner = profiles.find((profile) => profile.id === transaction.profile_id);
      const receiver = profiles.find((profile) => profile.id === transaction.reimbursable_to_profile_id);
      return `<button class="mini-item selectable reimbursement-choice" data-id="${transaction.id}" data-amount="${transaction.amount}" data-receiver="${receiver?.id || ''}"><div class="mini-avatar">⌁</div><div><strong>${transaction.description || categoryMap[transaction.category_id]?.name || 'Talangan'}</strong><small>${owner?.name || ''} · dibayar ${receiver?.name || ''}</small></div><span>${rupiah(transaction.amount)}</span></button>`;
    }).join('');
    document.querySelectorAll('.reimbursement-choice').forEach((button) => button.addEventListener('click', () => selectReimbursement(button)));
  }

  const husbandProfiles = profiles.filter((profile) => profile.relationship === 'husband');
  const husbandIds = new Set(husbandProfiles.map((profile) => profile.id));
  $('reimbursementFrom').innerHTML = accounts.filter((account) => husbandIds.has(account.profile_id)).map((account) => `<option value="${account.id}">${accountLabel(account)}</option>`).join('');
  $('reimbursementTo').innerHTML = accounts.map((account) => `<option value="${account.id}">${accountLabel(account)}</option>`).join('');
  $('reimbursementExpenseId').value = '';
  $('reimbursementAmount').value = '';
  $('reimbursementsDialog').showModal();
}

function selectReimbursement(button) {
  document.querySelectorAll('.reimbursement-choice').forEach((item) => item.classList.remove('selected'));
  button.classList.add('selected');
  $('reimbursementExpenseId').value = button.dataset.id;
  $('reimbursementAmount').value = Math.round(Number(button.dataset.amount));
  const receiverAccount = accounts.find((account) => account.profile_id === button.dataset.receiver);
  if (receiverAccount) $('reimbursementTo').value = receiverAccount.id;
}

async function payReimbursement(event) {
  event.preventDefault();
  const expenseId = $('reimbursementExpenseId').value;
  if (!expenseId) return toast('Pilih talangan yang akan dibayar');
  const expense = transactions.find((transaction) => transaction.id === expenseId);
  if (!expense) return toast('Data talangan tidak ditemukan');
  const alreadyPaid = await reimbursementPaidAmount(expenseId);
  const remaining = Number(expense.amount) - alreadyPaid;
  const amount = Number($('reimbursementAmount').value || 0);
  if (amount <= 0 || amount > remaining) return toast(`Maksimal pembayaran ${rupiah(remaining)}`);
  if ($('reimbursementFrom').value === $('reimbursementTo').value) return toast('Akun asal dan tujuan harus berbeda');

  const paymentRows = await insertRow('finance_transactions', {
    household_id: household.id,
    profile_id: currentRecorderProfile().id,
    created_by_profile_id: currentRecorderProfile().id,
    transaction_type: 'transfer',
    amount,
    transaction_at: new Date().toISOString(),
    category_id: null,
    description: `Pembayaran talangan: ${expense.description || 'pengeluaran keluarga'}`,
    transfer_from_account_id: $('reimbursementFrom').value,
    transfer_to_account_id: $('reimbursementTo').value,
    source_app: 'uangku',
    source_table: null,
    source_record_id: null,
    sync_mode: 'manual',
    reimbursement_status: 'none',
    status: 'posted'
  });
  const payment = paymentRows?.[0];
  if (!payment) throw new Error('Transfer pembayaran gagal dibuat');

  await insertRow('finance_reimbursement_items', {
    household_id: household.id,
    expense_transaction_id: expenseId,
    payment_transaction_id: payment.id,
    amount
  });
  const newPaid = alreadyPaid + amount;
  await patchRows('finance_transactions', `id=eq.${expenseId}`, {
    reimbursement_status: newPaid >= Number(expense.amount) ? 'paid' : 'partial'
  });
  $('reimbursementsDialog').close();
  toast(newPaid >= Number(expense.amount) ? 'Talangan lunas' : 'Pembayaran sebagian tersimpan');
  await loadData();
}

$('manageProfilesBtn').addEventListener('click', () => { renderProfilesManager(); $('profilesDialog').showModal(); });
$('manageAccountsBtn').addEventListener('click', () => { renderAccountsManager(); $('accountsDialog').showModal(); });
$('advanceExpenseBtn').addEventListener('click', openAdvanceDialog);
$('reimbursementCard').addEventListener('click', openReimbursementsDialog);
$('profileForm').addEventListener('submit', (event) => addProfile(event).catch((error) => toast(error.message || 'Gagal menambah profil')));
$('accountForm').addEventListener('submit', (event) => addAccount(event).catch((error) => toast(error.message || 'Gagal menambah akun')));
$('advanceForm').addEventListener('submit', (event) => saveAdvance(event).catch((error) => toast(error.message || 'Gagal menyimpan talangan')));
$('reimbursementForm').addEventListener('submit', (event) => payReimbursement(event).catch((error) => toast(error.message || 'Gagal membayar talangan')));
$('newProfileRole').addEventListener('change', () => {
  if ($('newProfileRole').value === 'child') $('newProfileRelationship').value = 'child';
});