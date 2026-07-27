async function rpc(functionName, payload = {}) {
  return request(`/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
}

async function signUpAccount() {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || password.length < 6) {
    $('authMessage').textContent = 'Isi email dan password minimal 6 karakter.';
    return;
  }
  $('authMessage').textContent = 'Membuat akun…';
  try {
    const data = await request('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }, false);
    if (data?.access_token) {
      session = data;
      user = data.user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      $('authMessage').textContent = '';
      await applySession();
      showJoinState();
    } else {
      $('authMessage').textContent = 'Akun dibuat. Periksa email konfirmasi, lalu login.';
    }
  } catch (error) {
    $('authMessage').textContent = error.message || 'Gagal membuat akun';
  }
}

const baseLoadData = loadData;
loadData = async function loadDataWithMembership() {
  try {
    const memberships = await restQuery('finance_household_members', `select=*&auth_user_id=eq.${user.id}&status=eq.active&order=created_at.asc&limit=1`);
    const membership = memberships?.[0] || null;
    if (!membership) {
      household = null;
      profiles = [];
      accounts = [];
      categories = [];
      transactions = [];
      showJoinState();
      return;
    }
    await baseLoadData();
    showJoinState();
  } catch (error) {
    console.error(error);
    showJoinState();
    toast(error.message || 'Gagal memuat membership');
  }
};

function showJoinState() {
  const hasHousehold = Boolean(household);
  $('joinHouseholdPanel').classList.toggle('hidden', hasHousehold);
  $('mainFinanceContent').classList.toggle('hidden', !hasHousehold);
  $('householdName').textContent = hasHousehold ? (household.name || 'Keuangan keluarga') : 'Gabung keluarga';
}

async function loadMembersAndInvites() {
  if (!household) return;
  const [members, invites] = await Promise.all([
    restQuery('finance_household_members', `select=*&household_id=eq.${household.id}&order=created_at.asc`),
    restQuery('finance_household_invitations', `select=*&household_id=eq.${household.id}&order=created_at.desc`)
  ]);
  const profileMap = Object.fromEntries(profiles.map((profile) => [profile.id, profile]));
  const memberRows = (members || []).map((member) => {
    const profile = profileMap[member.profile_id];
    return `<div class="mini-item"><div class="mini-avatar">${profile?.emoji || '👤'}</div><div><strong>${profile?.name || 'Anggota'}</strong><small>${member.member_role} · ${member.status}</small></div><span>${member.status === 'active' ? 'Aktif' : member.status}</span></div>`;
  });
  const inviteRows = (invites || []).filter((invite) => invite.status === 'pending').map((invite) => {
    const profile = profileMap[invite.profile_id];
    return `<div class="mini-item"><div class="mini-avatar">✉</div><div><strong>${profile?.name || invite.email}</strong><small>${invite.email} · berlaku sampai ${new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short'}).format(new Date(invite.expires_at))}</small></div><span>${invite.invite_code}</span></div>`;
  });
  $('membersList').innerHTML = [...memberRows, ...inviteRows].join('') || '<div class="empty-state">Belum ada anggota.</div>';
  const eligibleProfiles = profiles.filter((profile) => profile.role === 'parent' && !profile.auth_user_id);
  $('inviteProfile').innerHTML = eligibleProfiles.map((profile) => `<option value="${profile.id}">${profile.emoji || '👤'} ${profile.name}</option>`).join('');
  $('inviteForm').classList.toggle('hidden', eligibleProfiles.length === 0);
}

async function createInvitation(event) {
  event.preventDefault();
  const profileId = $('inviteProfile').value;
  if (!profileId) return toast('Buat profil istri lebih dulu');
  const result = await rpc('create_household_invitation', {
    p_household_id: household.id,
    p_profile_id: profileId,
    p_email: $('inviteEmail').value.trim(),
    p_member_role: $('inviteRole').value
  });
  const invite = Array.isArray(result) ? result[0] : result;
  $('inviteResult').classList.remove('hidden');
  $('inviteResult').innerHTML = `<strong>Kode undangan</strong><div class="invite-code">${invite.invite_code}</div><small>Kirim kode ini kepada pemilik email ${invite.email}. Berlaku 7 hari.</small>`;
  toast('Undangan dibuat');
  await loadMembersAndInvites();
}

async function acceptInvitation(event) {
  event.preventDefault();
  const code = $('joinCode').value.trim().toUpperCase();
  if (!code) return toast('Masukkan kode undangan');
  await rpc('accept_household_invitation', { p_invite_code: code });
  $('joinDialog').close();
  toast('Berhasil bergabung ke keluarga');
  await loadData();
}

$('signUpBtn').addEventListener('click', signUpAccount);
$('openJoinBtn').addEventListener('click', () => {
  $('joinCode').value = '';
  $('joinDialog').showModal();
});
$('manageMembersBtn').addEventListener('click', async () => {
  $('inviteResult').classList.add('hidden');
  await loadMembersAndInvites();
  $('membersDialog').showModal();
});
$('inviteForm').addEventListener('submit', (event) => createInvitation(event).catch((error) => toast(error.message || 'Gagal membuat undangan')));
$('joinForm').addEventListener('submit', (event) => acceptInvitation(event).catch((error) => toast(error.message || 'Gagal menerima undangan')));

if (session?.access_token && user) loadData();