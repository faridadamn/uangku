// Final accounting interpretation for monthly recap.
(function () {
  function monthRows() {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return transactions.filter((transaction) => new Date(transaction.transaction_at) >= start);
  }

  function physicalAccountsForProfile(profileId) {
    return accounts.filter((account) => account.profile_id === profileId && account.account_type !== 'virtual_balance');
  }

  function accountIdsForProfile(profileId) {
    return new Set(physicalAccountsForProfile(profileId).map((account) => account.id));
  }

  function outstandingAdvanceForProfile(profileId, rows) {
    return rows
      .filter((transaction) =>
        transaction.transaction_type === 'expense' &&
        transaction.reimbursable_to_profile_id === profileId &&
        ['pending', 'partial'].includes(transaction.reimbursement_status)
      )
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  }

  function adultRecap(profile, rows) {
    const accountIds = accountIdsForProfile(profile.id);
    const income = rows
      .filter((transaction) => transaction.transaction_type === 'income' && accountIds.has(transaction.received_to_account_id))
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    // A child purchase is still a real household expense when cash leaves an adult account.
    const expense = rows
      .filter((transaction) => transaction.transaction_type === 'expense' && accountIds.has(transaction.paid_from_account_id))
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    const transferIn = rows
      .filter((transaction) => transaction.transaction_type === 'transfer' && accountIds.has(transaction.transfer_to_account_id))
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    const transferOut = rows
      .filter((transaction) => transaction.transaction_type === 'transfer' && accountIds.has(transaction.transfer_from_account_id))
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    const outstanding = outstandingAdvanceForProfile(profile.id, rows);
    const cashChange = income - expense + transferIn - transferOut;
    return { income, expense, transferIn, transferOut, outstanding, cashChange };
  }

  openRekapDialog = function correctedOpenRekapDialog() {
    if (!$('rekapDialog')) createUtilityDialogs();
    const rows = monthRows();

    const familyIncome = rows
      .filter((transaction) => transaction.transaction_type === 'income')
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    // All posted expenses count once as real household spending, including child expenses.
    const familyExpense = rows
      .filter((transaction) => transaction.transaction_type === 'expense')
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    const outstanding = rows
      .filter((transaction) => transaction.transaction_type === 'expense' && ['pending', 'partial'].includes(transaction.reimbursement_status))
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    $('rekapSummary').innerHTML = `
      <div class="rekap-grid">
        <div class="rekap-box"><span>Pendapatan</span><strong>${rupiah(familyIncome)}</strong></div>
        <div class="rekap-box"><span>Pengeluaran riil</span><strong>${rupiah(familyExpense)}</strong></div>
        <div class="rekap-box"><span>Surplus</span><strong>${rupiah(familyIncome - familyExpense)}</strong></div>
      </div>
      <p class="rekap-note">Transfer antaranggota tidak dihitung sebagai pendapatan atau pengeluaran keluarga. Talangan tersisa: <strong>${rupiah(outstanding)}</strong>.</p>`;

    const adults = profiles.filter((profile) => profile.role !== 'child');
    const children = profiles.filter((profile) => profile.role === 'child');

    const adultRows = adults.map((profile) => {
      const totals = adultRecap(profile, rows);
      return `<div class="mini-item">
        <div class="mini-avatar">${profile.emoji || '👤'}</div>
        <div><strong>${profile.name}</strong><small>Pendapatan ${rupiah(totals.income)} · Pengeluaran riil ${rupiah(totals.expense)}<br>Transfer masuk ${rupiah(totals.transferIn)} · Transfer keluar ${rupiah(totals.transferOut)}${totals.outstanding ? `<br>Talangan tersisa ${rupiah(totals.outstanding)}` : ''}</small></div>
        <span>${totals.cashChange >= 0 ? '+' : ''}${rupiah(totals.cashChange)}</span>
      </div>`;
    }).join('');

    const childRows = children.map((profile) => {
      const totals = monthTotals(profile.id);
      return `<div class="mini-item"><div class="mini-avatar">${profile.emoji || '🧒'}</div><div><strong>${profile.name}</strong><small>Masuk ${rupiah(totals.income)} · Keluar ${rupiah(totals.expense)}</small></div><span>${totals.income - totals.expense >= 0 ? '+' : ''}${rupiah(totals.income - totals.expense)}</span></div>`;
    }).join('');

    $('rekapProfiles').innerHTML = `${adultRows}${children.length ? '<p class="eyebrow rekap-child-title">SALDO VIRTUAL ANAK</p>' : ''}${childRows}`;
    $('rekapDialog').showModal();
  };
})();