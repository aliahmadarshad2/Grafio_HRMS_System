// Example only — adapt to your own api()/render()/toast() helper names.
// Add a "Tasks" entry to your nav pointing at tab id 'tasks', then add this
// case to your render switch: case 'tasks': html = await tasksView(); break;

async function tasksView() {
  const isManagerHR = ['Manager', 'HRAdmin', 'SystemAdmin'].includes(state.user.role);
  const tasks = await api('/tasks');
  let employees = [];
  let summary = [];
  if (isManagerHR) {
    employees = await api('/employees');
    summary = await api('/tasks/summary');
  }

  return `
    ${isManagerHR ? `
    <div class="card p-5 mb-4">
      <h3>Assign a Task</h3>
      <form id="taskForm" class="grid sm:grid-cols-4 gap-2">
        <select name="employee_id" required class="border rounded-lg px-3 py-2 text-sm">
          ${employees.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('')}
        </select>
        <input name="title" placeholder="Task title" required class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
        <input name="due_date" type="date" class="border rounded-lg px-3 py-2 text-sm">
        <textarea name="description" placeholder="Details (optional)" class="sm:col-span-4 border rounded-lg px-3 py-2 text-sm" rows="2"></textarea>
        <button class="sm:col-span-4 btn-primary py-2">Assign Task</button>
      </form>
    </div>
    <div class="card p-5 mb-4">
      <h3>Tasks Completed per Employee</h3>
      <table class="w-full text-sm">
        <thead><tr><th class="pb-2 text-left">Employee</th><th>Completed</th><th>Open</th><th>Total</th></tr></thead>
        <tbody>
          ${summary.map(s => `<tr><td class="py-1.5">${s.full_name}</td><td>${s.completed_tasks}</td><td>${s.open_tasks}</td><td>${s.total_tasks}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <div class="card p-5">
      <h3>${isManagerHR ? 'All Tasks' : 'My Tasks'}</h3>
      <div class="space-y-2">
        ${tasks.map(t => `
          <div class="border rounded-lg p-3 flex justify-between items-center">
            <div>
              <p class="font-medium">${t.title} ${t.due_date ? `<span class="text-xs text-gray-400">— due ${t.due_date}</span>` : ''}</p>
              <p class="text-xs text-gray-500">${t.description || ''}</p>
              <p class="text-xs text-gray-400">For: ${t.employee_name}${t.assigned_by_name ? ' · by ' + t.assigned_by_name : ''}</p>
            </div>
            <select onchange="updateTaskStatus(${t.id}, this.value)" class="text-xs border rounded-lg px-2 py-1">
              ${['Pending', 'InProgress', 'Completed'].map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        `).join('') || '<p class="text-gray-400 text-sm">No tasks yet</p>'}
      </div>
    </div>
  `;
}

async function updateTaskStatus(id, status) {
  try { await api(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); render(); }
  catch (e) { toast(e.message, true); }
}
window.updateTaskStatus = updateTaskStatus;

function attachTaskForm() {
  const f = document.getElementById('taskForm');
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    try {
      await api('/tasks', { method: 'POST', body: JSON.stringify(fd) });
      toast('Task assigned');
      render();
    } catch (err) { toast(err.message, true); }
  });
}
// Remember to call attachTaskForm() in your renderContent() alongside your other attachXForm() calls.
