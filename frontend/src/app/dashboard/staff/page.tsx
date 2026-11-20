'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt, money, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Drawer, Empty, PageHead, Status, Tabs, useAction } from '@/components/ui';

export default function Staff() {
  const s = useSession();
  const [tab, setTab] = useState<'staff' | 'roles' | 'tasks'>('staff');
  const staff = useApi<any>('/r/staff');
  const roles = useApi<any>('/r/roles?pageSize=100');
  const perms = useApi<any>('/r/permissions');
  const tasks = useApi<any>(tab === 'tasks' ? '/r/tasks' : null);
  const tables = useApi<any>(tab === 'tasks' ? '/r/tables?pageSize=200' : null);
  const [edit, setEdit] = useState<any>(null);
  const [role, setRole] = useState<any>(null);
  const [task, setTask] = useState<any>(null);
  const [run, busy] = useAction();
  const saveStaff = async () => {
    const body: any = { name: edit.name, email: edit.email, phone: edit.phone || null, roleId: Number(edit.roleId), branchId: edit.branchId ? Number(edit.branchId) : null, salary: edit.salary ? String(edit.salary) : null, payFrequency: edit.payFrequency || 'monthly', active: edit.active !== false };
    if (edit.password) body.password = edit.password;
    const r = await run(() => (edit.id ? api(`/r/staff/${edit.id}`, { method: 'PATCH', body }) : api('/r/staff', { body })), 'Saved');
    if (r) { setEdit(null); staff.reload(); }
  };
  return (
    <div className="page">
      <Tabs value={tab} onChange={setTab} items={[{ value: 'staff', label: 'Staff' }, { value: 'roles', label: 'Roles & permissions' }, { value: 'tasks', label: 'Waiter tasks' }]} />
      {tab === 'staff' && <>
        <PageHead title="Staff" subtitle="Disabling an account signs the person out everywhere immediately." actions={<button className="btn btn-primary" onClick={() => setEdit({ name: '', email: '', roleId: '', active: true })}><Plus size={16} /> Add staff</button>} />
        {!staff.data ? <div className="skeleton" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th>{s.can('payroll.manage') && <th className="num">Salary</th>}<th>Last login</th><th>Status</th></tr></thead>
          <tbody>{staff.data.data.map((u: any) => <tr key={u.id} className="clickable" onClick={() => setEdit({ id: u.id, name: u.name, email: u.email, phone: u.phone, roleId: u.role_id, branchId: u.branch_id || '', salary: u.salary || '', payFrequency: u.pay_frequency, active: !!u.active })}><td><strong>{u.name}</strong></td><td>{u.email}</td><td>{u.role_name}</td><td>{s.branches.find((b) => b.id === u.branch_id)?.name || 'All'}</td>{s.can('payroll.manage') && <td className="num">{u.salary ? money(u.salary, s.currency) : '—'}</td>}<td className="small">{dt(u.last_login_at, s.tz)}</td><td><Status value={u.active ? 'active' : 'suspended'} /></td></tr>)}</tbody></table></div>}
      </>}
      {tab === 'roles' && <>
        <PageHead title="Roles" subtitle="Least privilege: give each role only what it needs. You cannot grant permissions you do not hold." actions={<button className="btn btn-primary" onClick={() => setRole({ name: '', permissions: [] })}><Plus size={16} /> New role</button>} />
        {!roles.data ? <div className="skeleton" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Role</th><th>Permissions</th><th /></tr></thead>
          <tbody>{roles.data.data.map((r: any) => <tr key={r.id} className={r.system_key === 'owner' ? '' : 'clickable'} onClick={() => r.system_key !== 'owner' && setRole({ id: r.id, name: r.name, permissions: r.permissions || [], system: !!r.system_key })}><td><strong>{r.name}</strong>{r.system_key ? <span className="badge" style={{ marginLeft: 6 }}>default</span> : null}</td><td className="small muted">{(r.permissions || []).includes('*') ? 'Everything' : `${(r.permissions || []).length} permissions`}</td><td /></tr>)}</tbody></table></div>}
      </>}
      {tab === 'tasks' && <>
        <PageHead title="Waiter tasks" subtitle="Assign tasks such as “Please visit table 2”. Waiters accept, start and complete them." actions={<button className="btn btn-primary" onClick={() => setTask({ title: '', details: '', tableId: '', assignedTo: '' })}><Plus size={16} /> Assign task</button>} />
        {!tasks.data ? <div className="skeleton" /> : tasks.data.data.length === 0 ? <Empty title="No tasks" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Task</th><th>Type</th><th>Table</th><th>Assignee</th><th>Status</th><th>Created</th></tr></thead><tbody>{tasks.data.data.map((t: any) => <tr key={t.id}><td><strong>{t.title}</strong><div className="tiny muted">{t.details}</div></td><td>{titleCase(t.kind)}</td><td>{t.table_name || '—'}</td><td>{t.assignee || 'Anyone'}</td><td><Status value={t.status} /></td><td className="small">{dt(t.created_at, s.tz)}</td></tr>)}</tbody></table></div>}
      </>}

      <Drawer open={!!edit} title={edit?.id ? 'Edit staff member' : 'Add staff member'} onClose={() => setEdit(null)} footer={<button className="btn btn-primary" disabled={busy || !edit?.name || !edit?.email || !edit?.roleId || (!edit?.id && !edit?.password)} onClick={saveStaff}>Save</button>}>
        {edit && <div className="form-grid">
          <label className="field">Name<input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field">Email (login)<input className="input" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
          <label className="field">Phone<input className="input" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
          <label className="field">Role<select className="input" value={edit.roleId} onChange={(e) => setEdit({ ...edit, roleId: e.target.value })}><option value="">—</option>{(roles.data?.data || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label className="field">Branch<select className="input" value={edit.branchId || ''} onChange={(e) => setEdit({ ...edit, branchId: e.target.value })}><option value="">All branches</option>{s.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="field">{edit.id ? 'New password (optional)' : 'Password'}<input className="input" type="password" autoComplete="new-password" value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /><span className="hint">Min 10 characters, letters and numbers</span></label>
          {s.can('payroll.manage') && <><label className="field">Monthly salary<input className="input" type="number" min="0" step="0.01" value={edit.salary || ''} onChange={(e) => setEdit({ ...edit, salary: e.target.value })} /></label>
            <label className="field">Pay frequency<select className="input" value={edit.payFrequency || 'monthly'} onChange={(e) => setEdit({ ...edit, payFrequency: e.target.value })}><option value="monthly">Monthly</option><option value="biweekly">Bi-weekly</option><option value="weekly">Weekly</option></select></label></>}
          <label className="check full"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Account enabled</label>
        </div>}
      </Drawer>

      <Drawer open={!!role} title={role?.id ? `Role: ${role.name}` : 'New role'} onClose={() => setRole(null)} footer={<>{role?.id && !role.system && <button className="btn btn-danger" onClick={async () => { const r = await run(() => api(`/r/roles/${role.id}`, { method: 'DELETE' }), 'Role deleted'); if (r) { setRole(null); roles.reload(); } }}>Delete</button>}<span className="grow" /><button className="btn btn-primary" disabled={busy || !role?.name} onClick={async () => { const r = await run(() => (role.id ? api(`/r/roles/${role.id}`, { method: 'PATCH', body: { name: role.name, permissions: role.permissions } }) : api('/r/roles', { body: { name: role.name, permissions: role.permissions } })), 'Role saved'); if (r) { setRole(null); roles.reload(); } }}>Save</button></>}>
        {role && <div className="stack">
          <label className="field">Role name<input className="input" value={role.name} onChange={(e) => setRole({ ...role, name: e.target.value })} /></label>
          {Object.entries(perms.data?.data || {}).map(([k, label]: any) => <label key={k} className="check" style={{ opacity: s.can(k) ? 1 : 0.45 }}><input type="checkbox" disabled={!s.can(k)} checked={role.permissions.includes(k)} onChange={(e) => setRole({ ...role, permissions: e.target.checked ? [...role.permissions, k] : role.permissions.filter((x: string) => x !== k) })} />{label} <span className="tiny muted mono">{k}</span></label>)}
        </div>}
      </Drawer>

      <Drawer open={!!task} title="Assign task" onClose={() => setTask(null)} footer={<button className="btn btn-primary" disabled={busy || !task?.title} onClick={async () => { const r = await run(() => api('/r/tasks', { body: { title: task.title, details: task.details || null, tableId: task.tableId ? Number(task.tableId) : null, assignedTo: task.assignedTo ? Number(task.assignedTo) : null } }), 'Task assigned'); if (r) { setTask(null); tasks.reload(); } }}>Assign</button>}>
        {task && <div className="stack">
          <label className="field">Task<input className="input" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder="Please visit table 2" /></label>
          <label className="field">Details<textarea className="input" value={task.details} onChange={(e) => setTask({ ...task, details: e.target.value })} /></label>
          <label className="field">Table<select className="input" value={task.tableId} onChange={(e) => setTask({ ...task, tableId: e.target.value })}><option value="">—</option>{(tables.data?.data || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="field">Assign to<select className="input" value={task.assignedTo} onChange={(e) => setTask({ ...task, assignedTo: e.target.value })}><option value="">Any waiter</option>{(staff.data?.data || []).filter((u: any) => u.active).map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.role_name})</option>)}</select></label>
        </div>}
      </Drawer>
    </div>
  );
}
