'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Criteria, JobTitle, Scenario } from '@/types';
import { useToast, useConfirm } from '@/components/ui/feedback';
import type { PackStatus, ScenarioUpgradeItem, UpgradePreviewCounts } from '@/lib/scenario-packs';
import { upgradeActionLabel, summarizeUpgradeCounts } from '@/lib/scenario-packs';

// ─── Types ─────────────────────────────────────────────────────────────────
// (Criteria, JobTitle, Scenario imported from @/types)

// ─── Helpers ────────────────────────────────────────────────────────────────

const blankCriteria = { name: '', description: '', weight: 5, category: '', active: true };
const blankJob = { name: '', description: '' };
const blankScenario = {
  name: '',
  jobTitleId: '',
  type: 'CHAT' as 'PHONE' | 'CHAT' | 'VOICE',
  description: '',
  customerPersona: '',
  customerObjective: '',
  difficulty: 'medium' as 'easy' | 'medium' | 'hard',
  hints: [] as string[],
};

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function Tooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-block ml-1 group cursor-help align-middle">
      <span className="text-slate-500 hover:text-blue-400 text-xs transition-colors">ⓘ</span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-slate-700 text-white text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 border border-slate-600 shadow-xl leading-relaxed whitespace-normal">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-700" />
      </span>
    </span>
  );
}

// ─── Tab Intro Banner ────────────────────────────────────────────────────────

function TabIntro({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 bg-blue-950/40 border border-blue-800/30 rounded-xl px-5 py-4 mb-6">
      <span className="text-2xl">{icon}</span>
      <div>
        <div className="font-semibold text-blue-200 text-sm">{title}</div>
        <div className="text-slate-400 text-xs mt-0.5 leading-relaxed">{description}</div>
      </div>
    </div>
  );
}

// ─── Criteria Tab ────────────────────────────────────────────────────────────

function CriteriaTab() {
  const toast = useToast();
  const confirm = useConfirm();
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
    let res: Response;
    if (editingId) {
      res = await fetch(`/api/criteria/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    } else {
      res = await fetch('/api/criteria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    }
    if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(`Save failed: ${(body as any).error || res.statusText}`); return; }
    setEditingId(null); setShowForm(false); setForm(blankCriteria); refresh();
    toast.success('Criteria saved');
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Delete criteria', message: 'Delete this criteria?', confirmLabel: 'Delete' }))) return;
    const res = await fetch(`/api/criteria/${id}`, { method: 'DELETE' });
    if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(`Delete failed: ${(body as any).error || res.statusText}`); return; }
    refresh();
    toast.success('Criteria deleted');
  };

  const startEdit = (c: Criteria) => {
    setEditingId(c.id);
    setForm({ name: c.name, description: c.description || '', weight: c.weight, category: c.category || '', active: c.active });
    setShowForm(true);
  };

  return (
    <div>
      <TabIntro
        icon="📋"
        title="Scoring Criteria"
        description="Criteria are the skills you want to measure in each simulation — things like Empathy, Product Knowledge, or Problem-Solving. Each criterion has a weight (importance) from 1–10. After a session ends, the scoring engine rates the employee on every criterion linked to their job title."
      />
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
          <h3 className="font-semibold mb-4">{editingId ? 'Edit Criteria' : 'New Scoring Criteria'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Criteria Name <span className="text-red-400">*</span>
                <Tooltip text="A short, clear name for what you're measuring. E.g. 'Empathy', 'Product Knowledge', 'Communication'." />
              </label>
              <input placeholder="e.g. Empathy" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Category
                <Tooltip text="Group similar criteria together (e.g. 'Soft Skills', 'Technical', 'Process'). Optional — helps organise long lists." />
              </label>
              <input placeholder="e.g. Soft Skills" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">
                Description
                <Tooltip text="Explain exactly what this criterion measures so scoring stays consistent. E.g. 'Employee acknowledged the customer's frustration before jumping to a solution.'" />
              </label>
              <input placeholder="What does this criterion measure?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            </div>
            <div className="flex items-center gap-4">
              <label className="text-xs text-slate-400 whitespace-nowrap">
                Importance (Weight)
                <Tooltip text="How much this criterion counts toward the final score. 10 = most important, 1 = least. Example: Problem-Solving might be 10, while Greeting Tone might be 4." />
              </label>
              <input type="range" min="1" max="10" value={form.weight} onChange={e => setForm({ ...form, weight: +e.target.value })} className="flex-1" />
              <span className="text-blue-400 font-bold w-8 text-center text-lg">{form.weight}</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
              Active
              <Tooltip text="Inactive criteria won't be scored. Use this to pause a criterion without deleting it." />
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
  const toast = useToast();
  const confirm = useConfirm();
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
    let res: Response;
    if (editingId) {
      res = await fetch(`/api/jobs/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    } else {
      res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    }
    if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(`Save failed: ${(body as any).error || res.statusText}`); return; }
    setEditingId(null); setShowForm(false); setForm(blankJob); refresh();
    toast.success('Job title saved');
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Delete job title', message: 'Delete this job title? This may affect linked scenarios.', confirmLabel: 'Delete' }))) return;
    const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
    if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(`Delete failed: ${(body as any).error || res.statusText}`); return; }
    refresh();
    toast.success('Job title deleted');
  };

  const startEdit = (j: JobTitle) => {
    setEditingId(j.id);
    setForm({ name: j.name, description: j.description || '' });
    setShowForm(true);
  };

  return (
    <div>
      <TabIntro
        icon="👔"
        title="Job Titles"
        description="Job Titles represent the roles your employees are being trained for — e.g. 'Customer Support Representative' or 'Sales Associate'. Each job title has its own set of scoring criteria (managed in the Job ↔ Criteria tab) so simulations are scored appropriately for that role."
      />
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
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Job Title Name <span className="text-red-400">*</span>
                <Tooltip text="The name of the role your employees will train for. E.g. 'Customer Support Rep', 'Sales Associate', 'Billing Specialist'." />
              </label>
              <input placeholder="e.g. Customer Support Representative" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Description
                <Tooltip text="A brief note about what this role involves. Shown to admins only — helps distinguish similar roles." />
              </label>
              <input placeholder="What does this role involve? (optional)" value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            </div>
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
  const toast = useToast();
  const confirm = useConfirm();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [jobs, setJobs] = useState<JobTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterJobId, setFilterJobId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankScenario);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    const url = filterJobId ? `/api/scenarios?jobTitleId=${filterJobId}` : '/api/scenarios';
    Promise.all([
      fetch(url).then(r => r.json()),
      fetch('/api/jobs').then(r => r.json()),
    ]).then(([s, j]) => { setScenarios(s); setJobs(j); setLoading(false); });
  }, [filterJobId]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    const script = {
      customerPersona: form.customerPersona,
      customerObjective: form.customerObjective,
      difficulty: form.difficulty,
      hints: form.hints.filter(h => h.trim()),
    };
    const body = { name: form.name, jobTitleId: form.jobTitleId, type: form.type, description: form.description, script };
    let res: Response;
    if (editingId) {
      res = await fetch(`/api/scenarios/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else {
      res = await fetch('/api/scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (!res.ok) { const body2 = await res.json().catch(() => ({})); toast.error(`Save failed: ${(body2 as any).error || res.statusText}`); return; }
    setEditingId(null); setShowForm(false); setForm(blankScenario); refresh();
    toast.success('Scenario saved');
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Delete scenario', message: 'Delete this scenario?', confirmLabel: 'Delete' }))) return;
    const res = await fetch(`/api/scenarios/${id}`, { method: 'DELETE' });
    if (!res.ok) { const body2 = await res.json().catch(() => ({})); toast.error(`Delete failed: ${(body2 as any).error || res.statusText}`); return; }
    refresh();
    toast.success('Scenario deleted');
  };

  const startEdit = (s: Scenario) => {
    const script = ((s.script || {}) as { customerPersona?: string; customerObjective?: string; difficulty?: string; hints?: string[] });
    setEditingId(s.id);
    setForm({
      name: s.name,
      jobTitleId: s.jobTitleId ?? '',
      type: s.type,
      description: s.description || '',
      customerPersona: script.customerPersona || '',
      customerObjective: script.customerObjective || '',
      difficulty: (script.difficulty as 'easy' | 'medium' | 'hard') || 'medium',
      hints: script.hints || [],
    });
    setShowForm(true);
  };

  const addHint = () => setForm(f => ({ ...f, hints: [...f.hints, ''] }));
  const updateHint = (i: number, val: string) => setForm(f => ({ ...f, hints: f.hints.map((h, idx) => idx === i ? val : h) }));
  const removeHint = (i: number) => setForm(f => ({ ...f, hints: f.hints.filter((_, idx) => idx !== i) }));

  const jobName = (id: string) => jobs.find(j => j.id === id)?.name || '—';

  return (
    <div>
      <TabIntro
        icon="🎭"
        title="Scenarios"
        description="A scenario is a specific customer situation that employees practise — e.g. 'Angry customer with a late delivery'. Fill in plain-English descriptions below; no coding or JSON required. The simulator uses these details to play a realistic virtual customer."
      />
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
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(blankScenario); }}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add Scenario'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
          <h3 className="font-semibold mb-1">{editingId ? 'Edit Scenario' : 'New Scenario'}</h3>
          <p className="text-xs text-slate-400 mb-5">Fill in the fields below to define how the simulated customer will behave. No technical knowledge required.</p>

          {/* Basic info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Scenario Name <span className="text-red-400">*</span>
                <Tooltip text="A short title that describes the situation being practised. E.g. 'Late Delivery Complaint' or 'Billing Dispute'." />
              </label>
              <input placeholder="e.g. Late Delivery Complaint" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Job Title <span className="text-red-400">*</span>
                <Tooltip text="Which role this scenario is designed for. Employees will see scenarios that match their assigned job title." />
              </label>
              <select value={form.jobTitleId} onChange={e => setForm({ ...form, jobTitleId: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white">
                <option value="">— Select Job Title —</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Short Description
                <Tooltip text="A one-line summary shown on the scenario selection screen. E.g. 'Customer wants a refund on a damaged item'." />
              </label>
              <input placeholder="One-line summary (optional)" value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Simulation Type
                <Tooltip text="Chat: typed conversation. Voice: use your microphone in the browser. Phone: receive a real phone call." />
              </label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as 'PHONE' | 'CHAT' | 'VOICE' })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white">
                <option value="CHAT">💬 Chat (text conversation)</option>
                <option value="VOICE">🎙️ Voice (browser microphone)</option>
                <option value="PHONE">📞 Phone (real phone call)</option>
              </select>
            </div>
          </div>

          {/* Simulated Customer behaviour */}
          <div className="border-t border-slate-700 pt-5 mb-5">
            <h4 className="text-sm font-medium text-slate-200 mb-4">Simulated Customer Behaviour</h4>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Who is the customer?
                  <Tooltip text="Describe the customer's personality and emotional state. The simulated customer will play this character throughout the simulation. E.g. 'A frustrated customer who paid for express shipping but received the item 2 weeks late. They are upset but polite.'" />
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. A frustrated customer who paid for express shipping but received the item 2 weeks late. They are upset but willing to cooperate."
                  value={form.customerPersona}
                  onChange={e => setForm({ ...form, customerPersona: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-500 text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  What does the customer want?
                  <Tooltip text="The outcome the customer is trying to achieve. The simulated customer won't fully reveal this upfront — the employee needs to uncover and resolve it. E.g. 'A full refund or guaranteed reshipping with compensation.'" />
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. A full refund, or guaranteed re-shipment within 48 hours with a discount code as compensation."
                  value={form.customerObjective}
                  onChange={e => setForm({ ...form, customerObjective: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-500 text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Difficulty
                  <Tooltip text="Easy: the customer is cooperative and accepts the first reasonable solution. Medium: they're mildly frustrated and may ask follow-up questions. Hard: they're very upset, may push back, and only de-escalate if handled exceptionally well." />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['easy', 'medium', 'hard'] as const).map(level => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setForm({ ...form, difficulty: level })}
                      className={`py-2 rounded-lg text-sm font-medium border transition-all capitalize ${
                        form.difficulty === level
                          ? level === 'easy' ? 'bg-green-700 border-green-500 text-white'
                          : level === 'medium' ? 'bg-yellow-700 border-yellow-500 text-white'
                          : 'bg-red-700 border-red-500 text-white'
                          : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-400'
                      }`}
                    >
                      {level === 'easy' ? '😊 Easy' : level === 'medium' ? '😐 Medium' : '😠 Hard'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {form.difficulty === 'easy' && 'Easy: Cooperative customer, accepts first reasonable solution.'}
                  {form.difficulty === 'medium' && 'Medium: Mildly frustrated, needs reassurance before agreeing.'}
                  {form.difficulty === 'hard' && 'Hard: Very upset, challenges solutions, only de-escalates if handled well.'}
                </p>
              </div>
            </div>
          </div>

          {/* Hints */}
          <div className="border-t border-slate-700 pt-5">
            <label className="block text-xs text-slate-400 mb-3">
              Background Hints (optional)
              <Tooltip text="Extra facts the simulated customer knows about this situation — things like order numbers, account history, or policy details. These help it give realistic, specific responses. Employees won't see these hints." />
            </label>
            <div className="space-y-2 mb-3">
              {form.hints.map((hint, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={hint}
                    onChange={e => updateHint(i, e.target.value)}
                    placeholder={`Hint ${i + 1} — e.g. Order #12345 placed 3 weeks ago`}
                    className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm"
                  />
                  <button onClick={() => removeHint(i)} className="text-red-400 hover:text-red-300 px-2 text-sm">✕</button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addHint}
              className="text-blue-400 hover:text-blue-300 text-sm border border-blue-800 hover:border-blue-600 px-4 py-1.5 rounded-lg transition-colors"
            >
              + Add Hint
            </button>
          </div>

          <button onClick={save} disabled={!form.name || !form.jobTitleId}
            className="mt-6 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 px-6 py-2 rounded-lg text-sm font-medium transition-colors">
            {editingId ? 'Update Scenario' : 'Create Scenario'}
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
                <div className="text-sm text-slate-400">{jobName(s.jobTitleId ?? '')}</div>
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
      .then((data: { id: string }[]) => {
        setLinkedIds(new Set(data.map(d => d.id)));
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
      <TabIntro
        icon="🔗"
        title="Link Criteria to Job Titles"
        description="This is where you decide which scoring criteria apply to each job title. For example, a Sales role might be scored on 'Closing' and 'Upselling', while a Support role focuses on 'Empathy' and 'Problem Solving'. Tick or untick criteria for the selected job title — changes save instantly."
      />
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
        <p className="text-slate-500 text-center py-12">👆 Select a job title above to choose which criteria are scored for that role.</p>
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
  const toast = useToast();
  const confirm = useConfirm();
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
    const res = await fetch('/api/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(`Create failed: ${(body as any).error || res.statusText}`); return; }
    setForm({ name: '', plan: 'FREE' });
    setShowForm(false);
    refresh();
    toast.success('Organization created');
  };

  const changePlan = async (orgId: string, plan: Org['plan']) => {
    const res = await fetch(`/api/orgs/${orgId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(`Plan update failed: ${(body as any).error || res.statusText}`); return; }
    refresh();
    toast.success('Plan updated');
  };

  const deleteOrg = async (org: Org) => {
    if (!(await confirm({ title: 'Delete organization', message: `Delete org "${org.name}"? This will fail if sessions exist.`, confirmLabel: 'Delete' }))) return;
    const res = await fetch(`/api/orgs/${org.id}`, { method: 'DELETE' });
    if (res.status === 409) {
      toast.error('Cannot delete: this org has simulation sessions. Remove sessions first.');
      return;
    }
    if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(`Delete failed: ${(body as any).error || res.statusText}`); return; }
    refresh();
    toast.success('Organization deleted');
  };

  const inviteMember = async (orgId: string) => {
    if (!inviteEmail.trim()) return;
    const res = await fetch(`/api/orgs/${orgId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(`Invite failed: ${(body as any).error || res.statusText}`); return; }
    setInviteEmail('');
    loadMembers(orgId);
    toast.success('Member invited');
  };

  const removeMember = async (orgId: string, userId: string) => {
    if (!(await confirm({ title: 'Remove member', message: 'Remove this member from the org?', confirmLabel: 'Remove' }))) return;
    const res = await fetch(`/api/orgs/${orgId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(`Remove failed: ${(body as any).error || res.statusText}`); return; }
    loadMembers(orgId);
    toast.success('Member removed');
  };

  return (
    <div>
      <TabIntro
        icon="🏢"
        title="Organizations"
        description="Organizations let you group users under a single tenant — useful if you host XPElevator for multiple companies or departments. Each org has its own members, plan level, and isolated session data. Expand an org to add or remove members."
      />
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

// ─── Scenario Packs Tab ──────────────────────────────────────────────────────
//
// The felt operator control on top of the starter scenario-library packs. It
// reads GET /api/scenario-packs/status (ADMIN, org-scoped) to show, per pack,
// whether this workspace has imported it and whether an opt-in upgrade is
// available, then materialises the write routes shipped earlier:
//   - Import  → POST /api/scenario-packs/import  (R-047)
//   - Upgrade → POST /api/scenario-packs/upgrade (R-054)
// so an operator can stand up sellable day-one inventory and re-sync a frozen
// pack without touching the API by hand. Copy follows the org rule (no "AI").

const PACK_STATE_BADGE: Record<PackStatus['state'], { label: string; cls: string }> = {
  not_imported: { label: 'Not imported', cls: 'bg-slate-700/60 text-slate-300 border-slate-600' },
  up_to_date: { label: 'Up to date', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50' },
  upgrade_available: { label: 'Upgrade available', cls: 'bg-amber-900/40 text-amber-300 border-amber-700/50' },
};

type PackUpgradePreview = {
  targetVersion: number | null;
  counts: UpgradePreviewCounts;
  items: ScenarioUpgradeItem[];
};

function ScenarioPacksTab() {
  const [packs, setPacks] = useState<PackStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Per-pack dry-run preview (R-062): fetched on demand, cleared on commit/cancel.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PackUpgradePreview | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/scenario-packs/status')
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `Failed to load packs (${r.status})`);
        }
        return r.json();
      })
      .then((d: { packs: PackStatus[] }) => { setPacks(d.packs || []); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Fetch the dry-run audit (no writes) so the operator sees the exact per-scenario
  // drift before committing — replaces the old blind confirm() on upgrade (R-062).
  const previewUpgrade = async (packId: string) => {
    setBusyId(packId);
    setPreviewId(packId);
    setPreview(null);
    setNotes((n) => ({ ...n, [packId]: '' }));
    try {
      const res = await fetch('/api/scenario-packs/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId, dryRun: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewId(null);
        setNotes((n) => ({ ...n, [packId]: `Failed: ${(body as { error?: string }).error || res.statusText}` }));
        return;
      }
      const b = body as { targetVersion?: number | null; counts?: UpgradePreviewCounts; items?: ScenarioUpgradeItem[] };
      setPreview({
        targetVersion: b.targetVersion ?? null,
        counts: b.counts ?? { update: 0, insert: 0, unchanged: 0, orphaned: 0 },
        items: b.items ?? [],
      });
    } catch (e) {
      setPreviewId(null);
      setNotes((n) => ({ ...n, [packId]: `Failed: ${e instanceof Error ? e.message : 'Unknown error'}` }));
    } finally {
      setBusyId(null);
    }
  };

  const cancelPreview = () => {
    setPreviewId(null);
    setPreview(null);
  };

  // confirmMsg === null skips the blocking confirm() — used when the operator has
  // already reviewed the dry-run preview and clicks Confirm inside it.
  const act = async (packId: string, action: 'import' | 'upgrade', confirmMsg: string | null) => {
    if (confirmMsg !== null && !confirm(confirmMsg)) return;
    setBusyId(packId);
    setNotes((n) => ({ ...n, [packId]: '' }));
    try {
      const res = await fetch(`/api/scenario-packs/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotes((n) => ({ ...n, [packId]: `Failed: ${(body as { error?: string }).error || res.statusText}` }));
        return;
      }
      if (action === 'upgrade') {
        // Committed — dismiss any open preview for this pack.
        setPreviewId((cur) => (cur === packId ? null : cur));
        setPreview((cur) => (previewId === packId ? null : cur));
      }
      if (action === 'import') {
        const count = (body as { scenarios?: { created?: number } }).scenarios?.created;
        setNotes((n) => ({ ...n, [packId]: count != null ? `Imported — ${count} scenario${count === 1 ? '' : 's'} added to your workspace.` : 'Imported into your workspace.' }));
      } else {
        const s = (body as { scenarios?: { updated?: number; inserted?: number; orphaned?: number } }).scenarios;
        const updated = s?.updated ?? 0;
        const inserted = s?.inserted ?? 0;
        const orphaned = s?.orphaned ?? 0;
        setNotes((n) => ({
          ...n,
          [packId]: updated + inserted === 0
            ? 'Already up to date — nothing changed.'
            : `Upgraded — ${updated} updated, ${inserted} added${orphaned > 0 ? `, ${orphaned} retired scenario${orphaned === 1 ? '' : 's'} left in place` : ''}.`,
        }));
      }
      refresh();
    } catch (e) {
      setNotes((n) => ({ ...n, [packId]: `Failed: ${e instanceof Error ? e.message : 'Unknown error'}` }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <TabIntro
        icon="📦"
        title="Scenario library packs"
        description="Curated per-vertical packs give your workspace ready-made training inventory on day one. Import a pack to add its role and scenarios to this organization; when a pack has newer content, upgrade to re-sync it. Importing never overwrites scenarios you have edited — a pack you have tuned for a client stays frozen until you choose to upgrade."
      />

      {loading && <p className="text-slate-400 text-sm">Loading packs…</p>}
      {error && !loading && (
        <div className="bg-red-950/40 border border-red-800/40 rounded-xl px-5 py-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {packs.map((p) => {
            const badge = PACK_STATE_BADGE[p.state];
            const busy = busyId === p.packId;
            return (
              <div key={p.packId} className="bg-slate-800/50 border border-slate-700 rounded-xl px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{p.packName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {p.vertical} · role: {p.role} · {p.catalogScenarioCount} scenario{p.catalogScenarioCount === 1 ? '' : 's'}
                      {p.state !== 'not_imported' && ` · ${p.importedScenarioCount} in your workspace`}
                    </div>
                    {p.state === 'upgrade_available' && (
                      <div className="text-xs text-amber-300/90 mt-1">
                        {p.drift.update} to update, {p.drift.insert} to add
                        {p.drift.orphaned > 0 ? `, ${p.drift.orphaned} retired (left in place)` : ''}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {p.state === 'not_imported' && (
                      <button
                        onClick={() => act(p.packId, 'import', `Import "${p.packName}" into your workspace? This adds its role and ${p.catalogScenarioCount} scenarios.`)}
                        disabled={busy}
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        {busy ? 'Importing…' : 'Import pack'}
                      </button>
                    )}
                    {p.state === 'upgrade_available' && (
                      <button
                        onClick={() => previewUpgrade(p.packId)}
                        disabled={busy}
                        className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        {busy && previewId === p.packId ? 'Loading…' : 'Preview changes'}
                      </button>
                    )}
                    {p.state === 'up_to_date' && (
                      <span className="text-xs text-emerald-400">✓ current</span>
                    )}
                  </div>
                </div>
                {previewId === p.packId && preview && (
                  <div className="mt-3 border-t border-slate-700/60 pt-3">
                    <div className="text-xs font-medium text-slate-200 mb-2">
                      Preview — upgrade to version {preview.targetVersion ?? '?'}
                    </div>
                    <p className="text-xs text-slate-400 mb-3">{summarizeUpgradeCounts(preview.counts)}</p>
                    <ul className="space-y-1 mb-3 max-h-64 overflow-y-auto">
                      {preview.items.map((it) => {
                        const a = upgradeActionLabel(it.action);
                        return (
                          <li key={`${it.action}:${it.sourceScenarioKey}`} className="flex items-center gap-2 text-xs">
                            <span className={`px-2 py-0.5 rounded-full border shrink-0 ${a.cls}`}>{a.label}</span>
                            <span className="text-slate-300 truncate">{it.name}</span>
                            {it.action === 'update' && (
                              <span className="text-slate-500 shrink-0">v{it.fromVersion ?? '—'} → v{it.toVersion ?? '—'}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex gap-2">
                      <button
                        onClick={() => act(p.packId, 'upgrade', null)}
                        disabled={busy || preview.counts.update + preview.counts.insert === 0}
                        className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        {busy && previewId === p.packId ? 'Upgrading…' : 'Confirm upgrade'}
                      </button>
                      <button
                        onClick={cancelPreview}
                        disabled={busy}
                        className="border border-slate-600 hover:border-slate-500 disabled:opacity-50 text-slate-300 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {notes[p.packId] && (
                  <div className="text-xs text-slate-300 mt-3 border-t border-slate-700/60 pt-3">{notes[p.packId]}</div>
                )}
              </div>
            );
          })}
          {packs.length === 0 && <p className="text-slate-400 text-sm">No scenario packs are available yet.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type Tab = 'criteria' | 'jobs' | 'scenarios' | 'job-criteria' | 'orgs' | 'packs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'criteria', label: 'Scoring Criteria' },
  { id: 'jobs', label: 'Job Titles' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'job-criteria', label: 'Job ↔ Criteria' },
  { id: 'orgs', label: 'Organizations' },
  { id: 'packs', label: 'Scenario Packs' },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('criteria');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/" className="text-blue-400 hover:text-blue-300 text-sm mb-8 inline-block">
          &larr; Back to Home
        </Link>

        <div className="flex items-start justify-between mb-8">
          <h1 className="text-3xl font-bold">Admin Panel</h1>
          <a
            href="https://github.com/adrper79-dot/xpelevator/blob/main/docs/USER_GUIDE.md#admin-panel"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 border border-blue-800 hover:border-blue-600 px-4 py-2 rounded-lg transition-colors"
          >
            <span>📖</span> User Guide
          </a>
        </div>

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
        {activeTab === 'packs' && <ScenarioPacksTab />}
      </div>
    </div>
  );
}
