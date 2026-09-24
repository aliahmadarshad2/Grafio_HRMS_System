// Uses existing endpoints — no backend changes needed:
//   GET  /api/ess/notifications        (latest 50, newest first)
//   PUT  /api/ess/notifications/:id/read

// 1. Add this button somewhere in your header, next to the user's name/logout button:
//
// <button onclick="toggleNotifications()" class="relative icon-btn" id="notifBellBtn">
//   🔔
//   <span id="notifBadge" class="hidden absolute -top-1 -right-1 bg-red-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center"></span>
// </button>
// <div id="notifDropdown" class="hidden absolute right-4 top-14 w-80 card p-3 z-50"></div>

let notifPollHandle = null;

async function refreshNotifBadge() {
  try {
    const notifs = await api('/ess/notifications');
    const unread = notifs.filter(n => !n.is_read).length;
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (unread > 0) { badge.textContent = unread > 9 ? '9+' : unread; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  } catch (e) { /* ignore polling errors */ }
}

async function toggleNotifications() {
  const dropdown = document.getElementById('notifDropdown');
  if (!dropdown) return;
  if (!dropdown.classList.contains('hidden')) { dropdown.classList.add('hidden'); return; }

  const notifs = await api('/ess/notifications');
  dropdown.innerHTML = `
    <h4 class="font-semibold text-sm mb-2">Notifications</h4>
    <div class="max-h-80 overflow-y-auto space-y-1">
      ${notifs.map(n => `
        <div onclick="markNotifRead(${n.id})" class="text-xs p-2 rounded-lg cursor-pointer ${n.is_read ? 'text-gray-400' : 'bg-gray-50 font-medium'}">
          ${n.message}
          <div class="text-[10px] text-gray-400 mt-0.5">${new Date(n.created_at).toLocaleString()}</div>
        </div>
      `).join('') || '<p class="text-xs text-gray-400 p-2">No notifications</p>'}
    </div>
  `;
  dropdown.classList.remove('hidden');
}

async function markNotifRead(id) {
  await api(`/ess/notifications/${id}/read`, { method: 'PUT' });
  refreshNotifBadge();
  toggleNotifications();
  toggleNotifications(); // reopen refreshed
}

window.toggleNotifications = toggleNotifications;
window.markNotifRead = markNotifRead;

// Call this once after login / on app init to keep the badge current:
//   refreshNotifBadge();
//   notifPollHandle = setInterval(refreshNotifBadge, 30000); // poll every 30s
