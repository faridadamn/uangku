// Final UX and finance-flow corrections loaded after all base scripts.
(function () {
  function isPhysicalAccount(accountId) {
    const account = accounts.find((item) => item.id === accountId);
    return Boolean(account && account.account_type !== 'virtual_balance');
  }

  function accountOwnerProfile(accountId) {
    const account = accounts.find((item) => item.id === accountId);
    return profiles.find((profile) => profile.id === account?.profile_id) || null;
  }

  function physicalMonthSummary() {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const rows = transactions.filter((transaction) => new Date(transaction.transaction_at) >= start);
    const byProfile = new Map();
    let income = 0;
    let expense = 0;

    const add = (profile, field, amount) => {
      if (!profile || profile.role === 'child') return;
      const current = byProfile.get(profile.id) || { profile, income: 0, expense: 0 };
      current[field] += amount;
      byProfile.set(profile.id, current);
    };

    rows.forEach((transaction) => {
      const amount = Number(transaction.amount || 0);
      if (transaction.transaction_type === 'income' && isPhysicalAccount(transaction.received_to_account_id)) {
        income += amount;
        add(accountOwnerProfile(transaction.received_to_account_id), 'income', amount);
      }
      if (transaction.transaction_type === 'expense' && isPhysicalAccount(transaction.paid_from_account_id)) {
        expense += amount;
        add(accountOwnerProfile(transaction.paid_from_account_id), 'expense', amount);
      }
    });

    const childRows = profiles.filter((profile) => profile.role === 'child').map((profile) => {
      const totals = rows.filter((transaction) => transaction.profile_id === profile.id).reduce((acc, transaction) => {
        if (transaction.transaction_type === 'income') acc.income += Number(transaction.amount || 0);
        if (transaction.transaction_type === 'expense') acc.expense += Number(transaction.amount || 0);
        return acc;
      }, { income: 0, expense: 0 });
      return { profile, ...totals };
    });

    return { income, expense, byProfile: [...byProfile.values()], childRows };
  }

  openRekapDialog = function correctedRekapDialog() {
    if (!$('rekapDialog')) createUtilityDialogs();
    const summary = physicalMonthSummary();
    $('rekapSummary').innerHTML = `
      <div class="rekap-grid">
        <div class="rekap-box"><span>Kas masuk</span><strong>${rupiah(summary.income)}</strong></div>
        <div class="rekap-box"><span>Kas keluar</span><strong>${rupiah(summary.expense)}</strong></div>
        <div class="rekap-box"><span>Arus bersih</span><strong>${rupiah(summary.income - summary.expense)}</strong></div>
      </div>
      <p class="rekap-note">Transfer internal tidak dihitung. Pengeluaran anak dicatat pada kas orang tua yang membayar, sedangkan saldo anak tetap menjadi catatan virtual.</p>`;

    const adultRows = summary.byProfile.map(({ profile, income, expense }) => `
      <div class="mini-item"><div class="mini-avatar">${profile.emoji || '👤'}</div><div><strong>${profile.name}</strong><small>Kas masuk ${rupiah(income)} · Kas keluar ${rupiah(expense)}</small></div><span>${rupiah(income - expense)}</span></div>`).join('');
    const childRows = summary.childRows.map(({ profile, income, expense }) => `
      <div class="mini-item"><div class="mini-avatar">${profile.emoji || '🧒'}</div><div><strong>${profile.name} · saldo virtual</strong><small>Masuk ${rupiah(income)} · Keluar ${rupiah(expense)}</small></div><span>${rupiah(income - expense)}</span></div>`).join('');

    $('rekapProfiles').innerHTML = `${adultRows || '<div class="empty-state">Belum ada arus kas bulan ini.</div>'}${childRows ? `<div class="rekap-subtitle">Saldo virtual anak</div>${childRows}` : ''}`;
    $('rekapDialog').showModal();
  };

  async function loadPaidMap(expenseIds) {
    if (!expenseIds.length) return {};
    const rows = await restQuery('finance_reimbursement_items', `select=expense_transaction_id,amount&expense_transaction_id=in.(${expenseIds.join(',')})`);
    return (rows || []).reduce((map, row) => {
      map[row.expense_transaction_id] = (map[row.expense_transaction_id] || 0) + Number(row.amount || 0);
      return map;
    }, {});
  }

  openReimbursementsDialog = async function multiReimbursementsDialog() {
    const pending = transactions.filter((transaction) => transaction.transaction_type === 'expense' && ['pending', 'partial'].includes(transaction.reimbursement_status));
    if (!pending.length) {
      $('reimbursementsList').innerHTML = '<div class="empty-state">Tidak ada talangan yang belum dibayar.</div>';
      $('reimbursementForm').classList.add('hidden');
      $('reimbursementsDialog').showModal();
      return;
    }

    const paidMap = await loadPaidMap(pending.map((item) => item.id));
    const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category]));
    $('reimbursementForm').classList.remove('hidden');
    $('reimbursementsList').innerHTML = pending.map((transaction) => {
      const child = profiles.find((profile) => profile.id === transaction.profile_id);
      const receiver = profiles.find((profile) => profile.id === transaction.reimbursable_to_profile_id);
      const remaining = Math.max(Number(transaction.amount) - Number(paidMap[transaction.id] || 0), 0);
      return `<label class="mini-item reimbursement-check-row">
        <input class="reimbursement-check" type="checkbox" value="${transaction.id}" data-remaining="${remaining}" data-receiver="${receiver?.id || ''}">
        <div><strong>${transaction.description || categoryMap[transaction.category_id]?.name || 'Talangan'}</strong><small>${child?.name || ''} · dibayar ${receiver?.name || ''} · sisa ${rupiah(remaining)}</small></div>
        <span>${rupiah(remaining)}</span>
      </label>`;
    }).join('');

    const loginProfile = profiles.find((profile) => profile.auth_user_id === user?.id);
    $('reimbursementFrom').innerHTML = accounts.filter((account) => account.profile_id === loginProfile?.id && account.account_type !== 'virtual_balance').map((account) => `<option value="${account.id}">${accountLabel(account)}</option>`).join('');
    $('reimbursementTo').innerHTML = accounts.filter((account) => account.account_type !== 'virtual_balance').map((account) => `<option value="${account.id}">${accountLabel(account)}</option>`).join('');
    $('reimbursementAmount').readOnly = true;
    $('reimbursementAmount').value = 0;
    $('reimbursementExpenseId').value = '';

    const syncSelection = () => {
      const selected = [...document.querySelectorAll('.reimbursement-check:checked')];
      const receiverIds = [...new Set(selected.map((item) => item.dataset.receiver).filter(Boolean))];
      if (receiverIds.length > 1) {
        const last = selected[selected.length - 1];
        last.checked = false;
        toast('Pilih talangan untuk penerima yang sama');
        return syncSelection();
      }
      const total = selected.reduce((sum, item) => sum + Number(item.dataset.remaining || 0), 0);
      $('reimbursementAmount').value = Math.round(total);
      $('reimbursementExpenseId').value = selected.map((item) => item.value).join(',');
      if (receiverIds[0]) {
        const target = accounts.find((account) => account.profile_id === receiverIds[0] && account.account_type !== 'virtual_balance');
        if (target) $('reimbursementTo').value = target.id;
      }
    };
    document.querySelectorAll('.reimbursement-check').forEach((checkbox) => checkbox.addEventListener('change', syncSelection));
    $('reimbursementsDialog').showModal();
  };

  payReimbursement = async function payMultipleReimbursements(event) {
    event.preventDefault();
    const ids = $('reimbursementExpenseId').value.split(',').map((id) => id.trim()).filter(Boolean);
    if (!ids.length) return toast('Pilih minimal satu talangan');
    if (!$('reimbursementFrom').value || !$('reimbursementTo').value) return toast('Pilih akun pembayaran dan penerima');
    const result = await rpc('pay_household_reimbursements', {
      p_expense_ids: ids,
      p_from_account_id: $('reimbursementFrom').value,
      p_to_account_id: $('reimbursementTo').value
    });
    const row = Array.isArray(result) ? result[0] : result;
    $('reimbursementsDialog').close();
    toast(`${row?.paid_items || ids.length} talangan dilunasi · ${rupiah(row?.paid_total || $('reimbursementAmount').value)}`);
    await loadData();
  };

  // Replace the old listener because the base listener resolves the global
  // function at event time; assigning the function above is sufficient.

  function removeRedundantTopMenu() {
    const primaryActions = document.querySelector('.quick-actions');
    if (primaryActions) primaryActions.style.display = 'none';
    // Keep transfer and talangan as secondary actions because they are not
    // duplicated in bottom navigation.
  }

  removeRedundantTopMenu();
  const priorEnsure = ensureDashboardStructure;
  ensureDashboardStructure = function ensureWithCleanup() {
    priorEnsure();
    removeRedundantTopMenu();
  };
})();