'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

// ─── Types ─────────────────────────────────────────────────────────────────

interface Criteria {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  category: string | null;
  active: boolean;
}

interface JobTitle {
  id: string;
  name: string;
  description: string | null;
}

interface Scenario {
  id: string;
  name: string;
  type: 'PHONE' | 'CHAT';
  description: string | null;
  script: Record<string, unknown>;
  jobTitleId: string;
  jobTitle?: { name: string };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const blankCriteria = { name: '', description: '', weight: 5, category: '', active: true };
const blankJob = { name: '', description: '' };
const blankScenario = {
  name: '',
  jobTitleId: '',
  type: 'CHAT' as 'PHONE' | 'CHAT',
  description: '',
  script: JSON.stringify({
    customerPersona: '',
    customerObjective: '',
    difficulty: 'medium',
    hints: [],
  }, null, 2),
};

// ─── Criteria Tab ────────────────────────────────────────────────────────────

function CriteriaTab() {
  const [items, setItems] = useState<Criteria[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankCriteria);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch('/api/criteria')
      .then(r => r.json())
      .then(d => { setItems(d); setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (editingId) {
      await fetch(`/api/criteria/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    } else {
      await fetch('/api/criteria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    }
    setEditingId(null); setShowForm(false); setForm(blankCriteria); refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this criteria?')) return;
    await fetch(`/api/criteria/${id}`, { method: 'DELETE' }); refresh();
  };

  const startEdit = (c: Criteria) => {
    setEditingId(c.id);
    setForm({ name: c.name, description: c.description || '', weight: c.weight, category: c.category || '', active: c.active });
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex justify-end mb-6">
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(blankCriteria); }}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add Criteria'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
          <h3 className="font-semibold mb-4">{editingId ? 'Edit Criteria' : 'New Criteria'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            <input placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400 md:col-span-2" />
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-300">Weight (1-10):</span>
              <input type="range" min="1" max="10" value={form.weight} onChange={e => setForm({ ...form, weight: +e.target.value })} className="flex-1" />
              <span className="text-blue-400 font-bold w-6 text-center">{form.weight}</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          </div>
          <button onClick={save} disabled={!form.name}
            className="mt-4 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 px-6 py-2 rounded-lg text-sm font-medium transition-colors">
            {editingId ? 'Update' : 'Create'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-slate-500 text-center py-12">No criteria yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-sm">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Weight</th>
                <th className="py-3 px-4">Active</th>
                <th className="py-3 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                  <td className="py-3 px-4">
                    <div className="font-medium">{c.name}</div>
                    {c.description && <div className="text-xs text-slate-500">{c.description}</div>}
                  </td>
                  <td className="py-3 px-4 text-slate-400">{c.category || '—'}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${c.weight * 10}%` }} />
                      </div>
                      <span className="text-sm text-blue-400">{c.weight}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${c.active ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                      {c.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <button onClick={() => startEdit(c)} className="text-blue-400 hover:text-blue-300 text-sm mr-3">Edit</button>
                    <button onClick={() => remove(c.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Job Titles Tab ──────────────────────────────────────────────────────────

function JobTitlesTab() {
  const [items, setItems] = useState<JobTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankJob);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch('/api/jobs')
      .then(r => r.json())
      .then(d => { setItems(d); setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (editingId) {
      await fetch(`/api/jobs/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    } else {
      await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    }
    setEditingId(null); setShowForm(false); setForm(blankJob); refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this job title? This may affect linked scenarios.')) return;
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' }); refresh();
  };

  const startEdit = (j: JobTitle) => {
    setEditingId(j.id);
    setForm({ name: j.name, description: j.description || '' });
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex justify-end mb-6">
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(blankJob); }}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add Job Title'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
          <h3 className="font-semibold mb-4">{editingId ? 'Edit Job Title' : 'New Job Title'}</h3>
          <div className="grid grid-cols-1 gap-4">
            <input placeholder="Job Title (e.g., Sales Representative)" value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            <input placeholder="Description (optional)" value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
          </div>
          <button onClick={save} disabled={!form.name}
            className="mt-4 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 px-6 py-2 rounded-lg text-sm font-medium transition-colors">
            {editingId ? 'Update' : 'Create'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-slate-500 text-center py-12">No job titles yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map(j => (
            <div key={j.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 flex items-center justify-between">
              <div>
                <div className="font-medium">{j.name}</div>
                {j.description && <div className="text-sm text-slate-400 mt-0.5">{j.description}</div>}
              </div>
              <div className="flex gap-3 shrink-0 ml-4">
                <button onClick={() => startEdit(j)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                <button onClick={() => remove(j.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Scenarios Tab ───────────────────────────────────────────────────────────

function ScenariosTab() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [jobs, setJobs] = useState<JobTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterJobId, setFilterJobId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankScenario);
  const [showForm, setShowForm] = useState(false);
  const [scriptError, setScriptError] = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    const url = filterJobId ? `/api/scenarios?jobTitleId=${filterJobId}` : '/api/scenarios';
    Promise.all([
      fetch(url).then(r => r.json()),
      fetch('/api/jobs').then(r => r.json()),
    ]).then(([s, j]) => { setScenarios(s); setJobs(j); setLoading(false); });
  }, [filterJobId]);

  useEffect(() => { refresh(); }, [refresh]);

  const validateScript = (val: string) => {
    try { JSON.parse(val); setScriptError(''); return true; }
    catch { setScriptError('Invalid JSON'); return false; }
  };

  const save = async () => {
    if (!validateScript(form.script)) return;
    const body = {
      name: form.name,
      jobTitleId: form.jobTitleId,
      type: form.type,
      description: form.description,
      script: JSON.parse(form.script),
    };
    if (editingId) {
      await fetch(`/api/scenarios/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else {
      await fetch('/api/scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    setEditingId(null); setShowForm(false); setForm(blankScenario); refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this scenario?')) return;
    await fetch(`/api/scenarios/${id}`, { method: 'DELETE' }); refresh();
  };

  const startEdit = (s: Scenario) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      jobTitleId: s.jobTitleId,
      type: s.type,
      description: s.description || '',
      script: JSON.stringify(s.script, null, 2),
    });
    setShowForm(true);
    setScriptError('');
  };

  const jobName = (id: string) => jobs.find(j => j.id === id)?.name || '—';

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <select
          value={filterJobId}
          onChange={e => setFilterJobId(e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="">All Job Titles</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(blankScenario); setScriptError(''); }}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add Scenario'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
          <h3 className="font-semibold mb-4">{editingId ? 'Edit Scenario' : 'New Scenario'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <input placeholder="Scenario Name" value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            <select value={form.jobTitleId} onChange={e => setForm({ ...form, jobTitleId: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white">
              <option value="">Select Job Title</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
            <input placeholder="Description (optional)" value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as 'PHONE' | 'CHAT' })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white">
              <option value="CHAT">Chat</option>
              <option value="PHONE">Phone</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-slate-300">Scenario Script (JSON)</label>
              {scriptError && <span className="text-xs text-red-400">{scriptError}</span>}
            </div>
            <textarea
              rows={12}
              value={form.script}
              onChange={e => { setForm({ ...form, script: e.target.value }); validateScript(e.target.value); }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-green-400 font-mono text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500"
              spellCheck={false}
            />
            <p className="text-xs text-slate-500 mt-1">
              Fields: customerPersona, customerObjective, difficulty (easy/medium/hard), hints (array)
            </p>
          </div>
          <button onClick={save} disabled={!form.name || !form.jobTitleId || !!scriptError}
            className="mt-4 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 px-6 py-2 rounded-lg text-sm font-medium transition-colors">
            {editingId ? 'Update' : 'Create'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : scenarios.length === 0 ? (
        <p className="text-slate-500 text-center py-12">No scenarios found.</p>
      ) : (
        <div className="space-y-3">
          {scenarios.map(s => (
            <div key={s.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{s.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${s.type === 'CHAT' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'}`}>
                    {s.type}
                  </span>
                </div>
                <div className="text-sm text-slate-400">{jobName(s.jobTitleId)}</div>
                {s.description && <div className="text-xs text-slate-500 mt-0.5 truncate">{s.description}</div>}
              </div>
              <div className="flex gap-3 shrink-0">
                <button onClick={() => startEdit(s)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                <button onClick={() => remove(s.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Job-Criteria Tab ────────────────────────────────────────────────────────

function JobCriteriaTab() {
  const [jobs, setJobs] = useState<JobTitle[]>([]);
  const [allCriteria, setAllCriteria] = useState<Criteria[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/jobs').then(r => r.json()),
      fetch('/api/criteria').then(r => r.json()),
    ]).then(([j, c]) => { setJobs(j); setAllCriteria(c); });
  }, []);

  useEffect(() => {
    if (!selectedJobId) { setLinkedIds(new Set()); return; }
    setLoading(true);
    fetch(`/api/jobs/${selectedJobId}/criteria`)
      .then(r => r.json())
      .then((data: { criteriaId: string }[]) => {
        setLinkedIds(new Set(data.map(d => d.criteriaId)));
        setLoading(false);
      });
  }, [selectedJobId]);

  const toggle = async (criteriaId: string, currentlyLinked: boolean) => {
    setSaving(criteriaId);
    if (currentlyLinked) {
      await fetch(`/api/jobs/${selectedJobId}/criteria`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteriaId }),
      });
      setLinkedIds(prev => { const n = new Set(prev); n.delete(criteriaId); return n; });
    } else {
      await fetch(`/api/jobs/${selectedJobId}/criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteriaId }),
      });
      setLinkedIds(prev => new Set([...prev, criteriaId]));
    }
    setSaving('');
  };

  const grouped = allCriteria.reduce<Record<string, Criteria[]>>((acc, c) => {
    const key = c.category || 'Uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-6">
        <label className="block text-sm text-slate-400 mb-2">Select a Job Title to manage its scoring criteria:</label>
        <select
          value={selectedJobId}
          onChange={e => setSelectedJobId(e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white w-full max-w-sm"
        >
          <option value="">— Select Job Title —</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>

      {!selectedJobId ? (
        <p className="text-slate-500 text-center py-12">Select a job title above to manage its criteria.</p>
      ) : loading ? (
        <p className="text-slate-400">Loading criteria links...</p>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-slate-400">
            <span className="text-green-400 font-medium">{linkedIds.size}</span> criteria linked.
            Click to toggle.
          </p>
          {Object.entries(grouped).map(([category, criteriaList]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{category}</h3>
              <div className="space-y-2">
                {criteriaList.map(c => {
                  const linked = linkedIds.has(c.id);
                  const isSaving = saving === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id, linked)}
                      disabled={isSaving}
                      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left ${
                        linked ? 'bg-green-900/20 border-green-700/50 hover:bg-green-900/30'
                               : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
                      } ${isSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                    >
                      <div>
                        <div className="font-medium text-sm">{c.name}</div>
                        {c.description && <div className="text-xs text-slate-500">{c.description}</div>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <div className="flex items-center gap-1">
                          <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${c.weight * 10}%` }} />
                          </div>
                          <span className="text-xs text-slate-500">{c.weight}</span>
                        </div>
                        <span className={`text-xs font-medium px-2 py-1 rounded ${linked ? 'bg-green-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                          {isSaving ? '...' : linked ? 'Linked' : 'Add'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Organizations Tab ───────────────────────────────────────────────────────

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  createdAt: string;
  _count: { users: number; sessions: number };
}

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'MEMBER';
  createdAt: string;
}

const PLAN_COLORS: Record<string, string> = {
  FREE: 'bg-slate-700 text-slate-300',
  PRO: 'bg-blue-900/50 text-blue-400',
  ENTERPRISE: 'bg-purple-900/50 text-purple-400',
};

function OrgsTab() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', plan: 'FREE' as Org['plan'] });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');

  const refresh = useCallback(() => {
    setLoading(true);
    fetch('/api/orgs')
      .then(r => r.json())
      .then((d: Org[]) => { setOrgs(d); setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadMembers = useCallback(async (orgId: string) => {
    const data: Member[] = await fetch(`/api/orgs/${orgId}/members`).then(r => r.json());
    setMembers(prev => ({ ...prev, [orgId]: data }));
  }, []);

  const toggleExpand = (orgId: string) => {
    if (expandedId === orgId) {
      setExpandedId(null);
    } else {
      setExpandedId(orgId);
      loadMembers(orgId);
    }
  };

  const createOrg = async () => {
    if (!form.name.trim()) return;
    await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setForm({ name: '', plan: 'FREE' });
    setShowForm(false);
    refresh();
  };

  const changePlan = async (orgId: string, plan: Org['plan']) => {
    await fetch(`/api/orgs/${orgId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    refresh();
  };

  const deleteOrg = async (org: Org) => {
    if (!confirm(`Delete org "${org.name}"? This will fail if sessions exist.`)) return;
    const res = await fetch(`/api/orgs/${org.id}`, { method: 'DELETE' });
    if (res.status === 409) {
      alert('Cannot delete: this org has simulation sessions. Remove sessions first.');
      return;
    }
    refresh();
  };

  const inviteMember = async (orgId: string) => {
    if (!inviteEmail.trim()) return;
    await fetch(`/api/orgs/${orgId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    setInviteEmail('');
    loadMembers(orgId);
  };

  const removeMember = async (orgId: string, userId: string) => {
    if (!confirm('Remove this member from the org?')) return;
    await fetch(`/api/orgs/${orgId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    loadMembers(orgId);
  };

  return (
    <div>
      <div className="flex justify-end mb-6">
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : '+ New Organization'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
          <h3 className="font-semibold mb-4">New Organization</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              placeholder="Organization name"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400"
            />
            <select
              value={form.plan}
              onChange={e => setForm({ ...form, plan: e.target.value as Org['plan'] })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white"
            >
              <option value="FREE">Free</option>
              <option value="PRO">Pro</option>
              <option value="ENTERPRISE">Enterprise</option>
            </select>
          </div>
          <button
            onClick={createOrg}
            disabled={!form.name.trim()}
            className="mt-4 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 px-6 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Create
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : orgs.length === 0 ? (
        <p className="text-slate-500 text-center py-12">No organizations yet.</p>
      ) : (
        <div className="space-y-3">
          {orgs.map(org => (
            <div key={org.id} className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
              {/* Org header row */}
              <div className="p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => toggleExpand(org.id)}
                    className="text-slate-400 hover:text-white transition-colors text-xs"
                    title={expandedId === org.id ? 'Collapse' : 'Expand members'}
                  >
                    {expandedId === org.id ? '▼' : '▶'}
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{org.name}</span>
                      <span className="text-xs text-slate-500 font-mono">{org.slug}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>{org._count.users} members</span>
                      <span>·</span>
                      <span>{org._count.sessions} sessions</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <select
                    value={org.plan}
                    onChange={e => changePlan(org.id, e.target.value as Org['plan'])}
                    className={`text-xs font-medium px-2 py-1 rounded border-0 cursor-pointer ${PLAN_COLORS[org.plan]} bg-transparent`}
                  >
                    <option value="FREE">FREE</option>
                    <option value="PRO">PRO</option>
                    <option value="ENTERPRISE">ENTERPRISE</option>
                  </select>
                  <button
                    onClick={() => deleteOrg(org)}
                    className="text-red-400 hover:text-red-300 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Members expansion panel */}
              {expandedId === org.id && (
                <div className="border-t border-slate-700 p-5">
                  <h4 className="text-sm font-medium text-slate-300 mb-4">Members</h4>

                  {/* Invite bar */}
                  <div className="flex gap-2 mb-4">
                    <input
                      placeholder="Email address"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && inviteMember(org.id)}
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-400"
                    />
                    <select
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as 'ADMIN' | 'MEMBER')}
                      className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                    <button
                      onClick={() => inviteMember(org.id)}
                      disabled={!inviteEmail.trim()}
                      className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      Add
                    </button>
                  </div>

                  {/* Members list */}
                  {!members[org.id] ? (
                    <p className="text-slate-500 text-sm">Loading...</p>
                  ) : members[org.id].length === 0 ? (
                    <p className="text-slate-500 text-sm">No members yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {members[org.id].map(m => (
                        <div key={m.id} className="flex items-center justify-between bg-slate-900/50 rounded-lg px-4 py-2.5">
                          <div>
                            <span className="text-sm font-medium">{m.name || m.email}</span>
                            {m.name && <span className="text-xs text-slate-500 ml-2">{m.email}</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${m.role === 'ADMIN' ? 'bg-amber-900/50 text-amber-400' : 'bg-slate-700 text-slate-400'}`}>
                              {m.role}
                            </span>
                            <button
                              onClick={() => removeMember(org.id, m.id)}
                              className="text-red-400 hover:text-red-300 text-xs"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type Tab = 'criteria' | 'jobs' | 'scenarios' | 'job-criteria' | 'orgs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'criteria', label: 'Scoring Criteria' },
  { id: 'jobs', label: 'Job Titles' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'job-criteria', label: 'Job ↔ Criteria' },
  { id: 'orgs', label: 'Organizations' },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('criteria');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/" className="text-blue-400 hover:text-blue-300 text-sm mb-8 inline-block">
          &larr; Back to Home
        </Link>

        <h1 className="text-3xl font-bold mb-8">Admin</h1>

        {/* Tab bar */}
        <div className="flex gap-1 bg-slate-800/60 p-1 rounded-xl mb-8 border border-slate-700/50">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === t.id
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'criteria' && <CriteriaTab />}
        {activeTab === 'jobs' && <JobTitlesTab />}
        {activeTab === 'scenarios' && <ScenariosTab />}
        {activeTab === 'job-criteria' && <JobCriteriaTab />}
        {activeTab === 'orgs' && <OrgsTab />}
      </div>
    </div>
  );
}
