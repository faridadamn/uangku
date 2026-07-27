// Monthly recap semantics: external income/expense, internal transfers, and advances are distinct.
(function () {
  function isThisMonth(transaction) {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return new Date(transaction.transaction_at) >= start;
  }

  function ownedAccountIds(profileId) {
    return new Set(accounts.filter((account) => account.profile_id === profileId).map((account) => account.id));
  }

  function adultMovement(profileId, rows) {
    const ids = ownedAccountIds(profileId);
    return rows.reduce((summary, transaction) => {
      const amount = Number(transaction.amount || 0);
      const isAdvance = transaction.transaction_type === 'expense' && ['pending', 'partial', 'paid'].includes(transaction.reimbursement_status);

      if (transaction.transaction_type === 'income' && ids.has(transaction.received_to_account_id)) {
        summary.income += amount;
        summary.cashChange += amount;
      }

      if (transaction.transaction_type === 'expense' && ids.has(transaction.paid_from_account_id)) {
        summary.cashChange -= amount;
        if (isAdvance) summary.advance += amount;
        else summary.expense += amount;
      }

      if (transaction.transaction_type === 'transfer') {
        if (ids.has(transaction.transfer_to_account_id)) {
          summary.transferIn += amount;
          summary.cashChange += amount;
        }
        if (ids.has(transaction.transfer_from_account_id)) {
          summary.transferOut += amount;
          summary.cashChange -= amount;
        }
      }

      if (transaction.transaction_type === 'adjustment') {
        if (ids.has(transaction.received_to_account_id)) summary.cashChange += amount;
        if (ids.has(transaction.paid_from_account_id)) summary.cashChange -= amount;
      }
      return summary;
    }, { income: 0, expense: 0, transferIn: 0, transferOut: 0, advance: 0, cashChange: 0 });
  }

  function childMovement(profileId, rows) {
    return rows.filter((transaction) => transaction.profile_id === profileId).reduce((summary, transaction) => {
      const amount = Number(transaction.amount || 0);
      if (transaction.transaction_type === 'income') summary.income += amount;
      if (transaction.transaction_type === 'expense') summary.expense += amount;
      return summary;
    }, { income: 0, expense: 0 });
  }

  openRekapDialog = function correctedRekapDialog() {
    if (!$('rekapDialog')) createUtilityDialogs();
    const rows = transactions.filter(isThisMonth);

    const externalIncome = rows
      .filter((transaction) => transaction.transaction_type === 'income')
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    const realExpense = rows
      .filter((transaction) => transaction.transaction_type === 'expense' && transaction.reimbursement_status === 'none')
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    const outstandingAdvance = rows
      .filter((transaction) => transaction.transaction_type === 'expense' && ['pending', 'partial'].includes(transaction.reimbursement_status))
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    $('rekapSummary').innerHTML = `
      <div class="rekap-grid">
        <div class="rekap-box"><span>Pendapatan</span><strong>${rupiah(externalIncome)}</strong></div>
        <div class="rekap-box"><span>Pengeluaran riil</span><strong>${rupiah(realExpense)}</strong></div>
        <div class="rekap-box"><span>Surplus</span><strong>${rupiah(externalIncome - realExpense)}</strong></div>
      </div>
      <p class="rekap-note">Transfer antaranggota tidak dianggap pendapatan atau pengeluaran keluarga. Talangan dicatat terpisah sebagai piutang keluarga: <strong>${rupiah(outstandingAdvance)}</strong>.</p>`;

    const adults = profiles.filter((profile) => profile.role !== 'child');
    const children = profiles.filter((profile) => profile.role === 'child');

    const adultHtml = adults.map((profile) => {
      const summary = adultMovement(profile.id, rows);
      return `<div class="mini-item recap-detail">
        <div class="mini-avatar">${profile.emoji || '👤'}</div>
        <div><strong>${profile.name}</strong><small>
          Pendapatan ${rupiah(summary.income)} · Pengeluaran ${rupiah(summary.expense)}<br>
          Transfer masuk ${rupiah(summary.transferIn)} · Transfer keluar ${rupiah(summary.transferOut)}
          ${summary.advance ? `<br>Talangan ${rupiah(summary.advance)}` : ''}
        </small></div>
        <span>${summary.cashChange >= 0 ? '+' : '−'}${rupiah(Math.abs(summary.cashChange))}</span>
      </div>`;
    }).join('');

    const childHtml = children.length ? `
      <p class="eyebrow recap-section-title">SALDO VIRTUAL ANAK</p>
      ${children.map((profile) => {
        const summary = childMovement(profile.id, rows);
        const net = summary.income - summary.expense;
        return `<div class="mini-item recap-detail">
          <div class="mini-avatar">${profile.emoji || '🧒'}</div>
          <div><strong>${profile.name}</strong><small>Masuk ${rupiah(summary.income)} · Keluar ${rupiah(summary.expense)}</small></div>
          <span>${net >= 0 ? '+' : '−'}${rupiah(Math.abs(net))}</span>
        </div>`;
      }).join('')}` : '';

    $('rekapProfiles').innerHTML = `${adultHtml}${childHtml}`;
    $('rekapDialog').showModal();
  };
})();