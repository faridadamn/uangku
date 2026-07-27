// Balance and access fixes loaded after the base application scripts.
(function () {
  function accountBalance(accountId) {
    const account = accounts.find((item) => item.id === accountId);
    let balance = Number(account?.initial_balance || 0);

    transactions.forEach((transaction) => {
      const amount = Number(transaction.amount || 0);
      if (transaction.transaction_type === 'income' && transaction.received_to_account_id === accountId) balance += amount;
      if (transaction.transaction_type === 'expense' && transaction.paid_from_account_id === accountId) balance -= amount;
      if (transaction.transaction_type === 'transfer') {
        if (transaction.transfer_from_account_id === accountId) balance -= amount;
        if (transaction.transfer_to_account_id === accountId) balance += amount;
      }
      if (transaction.transaction_type === 'adjustment') {
        if (transaction.received_to_account_id === accountId) balance += amount;
        if (transaction.paid_from_account_id === accountId) balance -= amount;
      }
    });

    return balance;
  }

  function accountBasedProfileBalance(profileId) {
    return accounts
      .filter((account) => account.profile_id === profileId)
      .reduce((sum, account) => sum + accountBalance(account.id), 0);
  }

  function childVirtualBalance(profileId) {
    const initial = accounts
      .filter((account) => account.profile_id === profileId && account.account_type === 'virtual_balance')
      .reduce((sum, account) => sum + Number(account.initial_balance || 0), 0);

    return transactions
      .filter((transaction) => transaction.profile_id === profileId)
      .reduce((sum, transaction) => {
        if (transaction.transaction_type === 'income') return sum + Number(transaction.amount || 0);
        if (transaction.transaction_type === 'expense') return sum - Number(transaction.amount || 0);
        return sum;
      }, initial);
  }

  profileBalance = function fixedProfileBalance(profileId) {
    const profile = profiles.find((item) => item.id === profileId);
    if (profile?.role === 'child') return childVirtualBalance(profileId);
    return accountBasedProfileBalance(profileId);
  };

  familyBalance = function fixedFamilyBalance() {
    // Virtual child balances are sub-ledgers and are deliberately excluded from
    // family cash so one expense is not counted twice.
    return accounts
      .filter((account) => account.account_type !== 'virtual_balance')
      .reduce((sum, account) => sum + accountBalance(account.id), 0);
  };

  function pendingAdvanceTotal() {
    return transactions
      .filter((transaction) => ['pending', 'partial'].includes(transaction.reimbursement_status))
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  }

  const baseRenderDashboard = renderDashboard;
  renderDashboard = function fixedRenderDashboard() {
    baseRenderDashboard();
    if (!activeProfile) return;
    $('profileBalance').textContent = rupiah(profileBalance(activeProfile.id));
    if ($('familyBalance')) $('familyBalance').textContent = rupiah(familyBalance());
    if ($('pendingReimbursements')) $('pendingReimbursements').textContent = rupiah(pendingAdvanceTotal());

    const advanceCard = $('reimbursementCard');
    if (advanceCard) {
      const label = advanceCard.querySelector('span');
      const hint = advanceCard.querySelector('small');
      if (label) label.textContent = 'Saldo talangan';
      if (hint) hint.textContent = 'Talangan virtual yang belum dilunasi';
    }
  };

  // The authenticated profile is always the recorder. RLS also enforces this,
  // but setting it here gives a clearer and consistent frontend flow.
  const baseSaveTransaction = saveTransaction;
  saveTransaction = async function fixedSaveTransaction() {
    const loginProfile = profiles.find((profile) => profile.auth_user_id === user?.id);
    if (!loginProfile) throw new Error('Profil login tidak ditemukan');
    return baseSaveTransaction();
  };

  // Re-render once when this script is loaded after an existing session.
  if (typeof household !== 'undefined' && household && activeProfile) renderDashboard();
})();