import React, { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Area, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import * as XLSX from "xlsx";
import {
  Plus, Wallet, Receipt, LayoutDashboard, ChevronLeft, ChevronRight, ChevronDown,
  Trash2, Save, Layers, Settings, X, PiggyBank,
  Pencil, Eye, EyeOff, Download, History, Search, GitMerge,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Fund-based (envelope) budgeting tracker — INR, dark, compact       */
/*                                                                     */
/*  COLOUR STRATEGY (two non-overlapping roles):                       */
/*   • IDENTITY (which fund is which) — cool palette: blues / violets  */
/*     / pinks. Used for dots, allocation strip, donut, expense dots.  */
/*   • STATUS (how much is left) — green / amber / red / grey. Used    */
/*     ONLY on the "left" figure, the fund bar, and accumulating sums. */
/*   • CHARTS stay neutral (spent = blue, baselines = grey).           */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "fundtracker:data:v3";

// Identity palette — a distinct qualitative set (well-separated hues) for the
// small fund markers (dots, allocation strip, filter chips). Charts don't use
// these; they use the status/spent colours below, so slice-colour confusion is gone.
const COLOR_POOL = [
  "#5B9BD5", "#B07CC6", "#E67FA0", "#5FB0A8", "#C9A14B",
  "#7E86D6", "#D98C5F", "#83B85A", "#6CC2D6", "#C56B8A",
];
// Chart colours
const C_SPENT = "#6EA8E0";   // "spent" series in charts (clear blue)
const C_BUDGET = "#8A8F98";  // budget reference line (grey, dashed)

const uid = (p = "") => p + Math.random().toString(36).slice(2, 9);
function monthKeyOf(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function labelOf(key) { const [y, m] = key.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" }); }
function shiftMonth(key, delta) { const [y, m] = key.split("-").map(Number); return monthKeyOf(new Date(y, m - 1 + delta, 1)); }
const todayKey = monthKeyOf(new Date());

function freshState() {
  return { currency: "₹", funds: [], months: { [todayKey]: { budget: 0, allocations: {} } }, expenses: [], configs: [] };
}

/* status of remaining balance for a fund */
function leftState(f) {
  if (f.base <= 0 && f.spent <= 0) return "none";
  if (f.remaining < 0) return "over";
  if (f.base > 0 && f.remaining / f.base <= 0.2) return "low";
  return "ok";
}
const STATUS_BAR = { ok: "var(--ok)", low: "var(--warn)", over: "var(--over)", none: "#3A4540" };

/* ------------------------------------------------------------------ */
export default function FundTracker() {
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [monthKey, setMonthKey] = useState(todayKey);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY);
        if (res && res.value) setState(JSON.parse(res.value)); else setState(freshState());
      } catch { setState(freshState()); } finally { setLoaded(true); }
    })();
  }, []);

  const commit = (next) => {
    setState(next);
    (async () => { try { await window.storage.set(STORAGE_KEY, JSON.stringify(next)); } catch (e) { console.error("Save failed", e); } })();
  };

  if (!loaded || !state) {
    return <div className="ft-root" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Style /><span className="ft-muted">Loading your records…</span></div>;
  }
  return <App state={state} commit={commit} monthKey={monthKey} setMonthKey={setMonthKey} />;
}

/* ------------------------------------------------------------------ */
function App({ state, commit, monthKey, setMonthKey }) {
  const [showExport, setShowExport] = useState(false);
  const [detailFund, setDetailFund] = useState(null);
  const cur = state.currency || "₹";
  const money = (n) => cur + " " + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const colorOf = (i) => COLOR_POOL[i % COLOR_POOL.length];

  const ensureMonth = (next) => {
    if (!next.months[monthKey]) next.months[monthKey] = { budget: 0, allocations: {} };
    if (!next.months[monthKey].allocations) next.months[monthKey].allocations = {};
    return next;
  };
  const month = state.months[monthKey] || { budget: 0, allocations: {} };

  const universe = useMemo(() => {
    const s = new Set(Object.keys(state.months)); state.expenses.forEach((e) => s.add(e.monthKey)); s.add(monthKey);
    return [...s].sort();
  }, [state.months, state.expenses, monthKey]);

  const spentFM = useMemo(() => {
    const m = {};
    state.expenses.forEach((e) => { (m[e.fundId] = m[e.fundId] || {})[e.monthKey] = (m[e.fundId]?.[e.monthKey] || 0) + Number(e.amount); });
    return m;
  }, [state.expenses]);

  const allocOf = (fundId, k) => state.months[k]?.allocations?.[fundId] || 0;
  const carriedFor = (f) => {
    if (!f.accumulating) return 0;
    let bal = 0;
    for (const k of universe) { if (k >= monthKey) break; bal += allocOf(f.id, k) - (spentFM[f.id]?.[k] || 0); }
    return bal;
  };

  // identity colour assigned by position so the palette is always uniform
  const fundView = state.funds.map((f, i) => {
    const alloc = allocOf(f.id, monthKey);
    const spent = spentFM[f.id]?.[monthKey] || 0;
    const carried = carriedFor(f);
    const base = alloc + (f.accumulating ? carried : 0);
    return { ...f, color: colorOf(i), alloc, spent, carried, base, remaining: base - spent };
  });
  const fundsColored = state.funds.map((f, i) => ({ ...f, color: colorOf(i) }));

  const monthExpenses = useMemo(() => state.expenses.filter((e) => e.monthKey === monthKey), [state.expenses, monthKey]);
  const totalAllocated = fundView.reduce((s, f) => s + f.alloc, 0);
  const totalSpent = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const unallocated = Number(month.budget || 0) - totalAllocated;

  /* mutations */
  const setBudget = (v) => { const n = ensureMonth(structuredClone(state)); n.months[monthKey].budget = Number(v) || 0; commit(n); };
  const setAllocation = (fundId, amount) => { const n = ensureMonth(structuredClone(state)); n.months[monthKey].allocations[fundId] = Number(amount) || 0; commit(n); };
  const addFund = ({ name, accumulating, allocated }) => {
    const n = ensureMonth(structuredClone(state)); const id = uid("f_");
    n.funds.push({ id, name, accumulating: !!accumulating });
    n.months[monthKey].allocations[id] = Number(allocated) || 0; commit(n);
  };
  const updateFund = (id, patch) => { const n = structuredClone(state); n.funds = n.funds.map((f) => (f.id === id ? { ...f, ...patch } : f)); commit(n); };
  const removeFund = (id) => { const n = structuredClone(state); n.funds = n.funds.filter((f) => f.id !== id); Object.values(n.months).forEach((m) => { if (m.allocations) delete m.allocations[id]; }); commit(n); };
  const addExpense = (exp) => { const n = structuredClone(state); n.expenses.unshift({ id: uid("e_"), monthKey, ...exp }); commit(n); };
  const updateExpense = (id, patch) => { const n = structuredClone(state); n.expenses = n.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)); commit(n); };
  const removeExpense = (id) => { const n = structuredClone(state); n.expenses = n.expenses.filter((e) => e.id !== id); commit(n); };
  const setCurrency = (sym) => { const n = structuredClone(state); n.currency = sym; commit(n); };
  const saveTemplate = (name) => { const n = structuredClone(state); n.configs.push({ id: uid("tpl_"), name, allocations: { ...(month.allocations || {}) } }); commit(n); };
  const applyTemplate = (tpl) => { const n = ensureMonth(structuredClone(state)); const valid = {}; Object.entries(tpl.allocations).forEach(([fid, amt]) => { if (n.funds.some((f) => f.id === fid)) valid[fid] = amt; }); n.months[monthKey].allocations = valid; commit(n); };
  const deleteTemplate = (id) => { const n = structuredClone(state); n.configs = n.configs.filter((c) => c.id !== id); commit(n); };
  const mergeFund = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const n = structuredClone(state);
    n.expenses = n.expenses.map((e) => (e.fundId === fromId ? { ...e, fundId: toId } : e));
    Object.values(n.months).forEach((m) => { if (m.allocations && m.allocations[fromId] != null) { m.allocations[toId] = (m.allocations[toId] || 0) + m.allocations[fromId]; delete m.allocations[fromId]; } });
    n.configs.forEach((c) => { if (c.allocations && c.allocations[fromId] != null) { c.allocations[toId] = (c.allocations[toId] || 0) + c.allocations[fromId]; delete c.allocations[fromId]; } });
    n.funds = n.funds.filter((f) => f.id !== fromId);
    commit(n);
  };
  const restoreState = (incoming) => { commit(incoming); };

  return (
    <div className="ft-root">
      <Style />
      <TopBar monthKey={monthKey} setMonthKey={setMonthKey} budget={month.budget} setBudget={setBudget}
        unallocated={unallocated} totalSpent={totalSpent} money={money} currency={cur} setCurrency={setCurrency}
        funds={fundView} budgetNum={Number(month.budget || 0)} openExport={() => setShowExport(true)}
        fullState={state} onRestore={restoreState} />

      <div className="ft-grid">
        <section className="ft-col ft-col-funds">
          <SectionHead icon={<Wallet size={15} />} title="Funds" />
          <FundsPanel funds={fundView} unallocated={unallocated} money={money}
            addFund={addFund} updateFund={updateFund} removeFund={removeFund} mergeFund={mergeFund}
            onOpenDetail={setDetailFund}
            templates={state.configs} saveTemplate={saveTemplate} applyTemplate={applyTemplate}
            deleteTemplate={deleteTemplate} setAllocation={setAllocation} />
        </section>

        <div className="ft-right">
          <section className="ft-col ft-col-dash">
            <SectionHead icon={<LayoutDashboard size={15} />} title="Dashboard" />
            <Dashboard funds={fundView} months={state.months} allExpenses={state.expenses}
              monthKey={monthKey} budget={Number(month.budget || 0)} totalAllocated={totalAllocated} totalSpent={totalSpent} money={money} />
          </section>

          <section className="ft-col ft-col-exp">
            <SectionHead icon={<Receipt size={15} />} title="Expenses" />
            <ExpensesPanel
              availableFunds={fundView.filter((f) => f.base > 0 || f.spent > 0)}
              fundLookup={Object.fromEntries(fundsColored.map((f) => [f.id, { name: f.name, color: f.color }]))}
              expenses={monthExpenses} allExpenses={state.expenses} money={money}
              addExpense={addExpense} updateExpense={updateExpense} removeExpense={removeExpense} monthKey={monthKey} />
          </section>
        </div>
      </div>

      {showExport && (
        <ExportModal funds={fundsColored} months={state.months} allExpenses={state.expenses} money={money} monthKey={monthKey} onClose={() => setShowExport(false)} />
      )}
      {detailFund && (
        <FundDetailModal fund={detailFund} allExpenses={state.expenses} months={state.months} money={money} onClose={() => setDetailFund(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function TopBar({ monthKey, setMonthKey, budget, setBudget, unallocated, totalSpent, money, currency, setCurrency, funds, budgetNum, openExport, fullState, onRestore }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(budget);
  const [showSet, setShowSet] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState("");
  const fileRef = React.useRef(null);
  useEffect(() => setVal(budget), [budget, monthKey]);
  const allocated = funds.filter((f) => f.alloc > 0);
  const denom = Math.max(budgetNum, funds.reduce((s, f) => s + f.alloc, 0)) || 1;

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(fullState, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `fund-tracker-backup_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const onFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const ok = data && Array.isArray(data.funds) && Array.isArray(data.expenses) && data.months && typeof data.months === "object";
        if (!ok) { setRestoreMsg("That file doesn't look like a Fund Tracker backup."); return; }
        if (window.confirm("Restore will REPLACE all current data with the backup. Continue?")) {
          onRestore(data); setRestoreMsg("Restored successfully."); setShowSet(false);
        }
      } catch { setRestoreMsg("Couldn't read that file — is it a valid backup?"); }
      finally { if (fileRef.current) fileRef.current.value = ""; }
    };
    reader.readAsText(file);
  };

  return (
    <header className="ft-top">
      <div className="ft-top-bar">
        <div className="ft-top-left">
          <div className="ft-brand"><PiggyBank size={18} /><span>Funds</span></div>
          <div className="ft-month">
            <button className="ft-icon-btn" onClick={() => setMonthKey(shiftMonth(monthKey, -1))} aria-label="Previous month"><ChevronLeft size={17} /></button>
            <span className="ft-month-label">{labelOf(monthKey)}</span>
            <button className="ft-icon-btn" onClick={() => setMonthKey(shiftMonth(monthKey, 1))} aria-label="Next month"><ChevronRight size={17} /></button>
          </div>
        </div>
        <div className="ft-top-right">
          <div className="ft-kpi">
            <span className="ft-kpi-label">Budget</span>
            {editing ? (
              <span className="ft-budget-edit">
                <input className="ft-input ft-input-sm" type="number" value={val} autoFocus onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setBudget(val); setEditing(false); } }} />
                <button className="ft-btn ft-btn-sm" onClick={() => { setBudget(val); setEditing(false); }}>Set</button>
              </span>
            ) : <button className="ft-kpi-value ft-kpi-clickable" onClick={() => setEditing(true)}>{money(budget)}</button>}
          </div>
          <div className="ft-kpi">
            <span className="ft-kpi-label">Unallocated</span>
            <span className="ft-kpi-value" style={{ color: unallocated < 0 ? "var(--over)" : unallocated > 0 ? "var(--ok)" : "var(--ink)" }}>{money(unallocated)}</span>
          </div>
          <div className="ft-kpi ft-hide-sm"><span className="ft-kpi-label">Spent</span><span className="ft-kpi-value">{money(totalSpent)}</span></div>
          <button className="ft-icon-btn" onClick={openExport} aria-label="Export data" title="Export to spreadsheet"><Download size={17} /></button>
          <button className="ft-icon-btn" onClick={() => setShowSet(true)} aria-label="Settings"><Settings size={17} /></button>
        </div>
      </div>

      {(budgetNum > 0 || allocated.length > 0) && (
        <div className="ft-alloc-track" title="Allocation of this month's budget">
          {allocated.map((f) => <div key={f.id} className="ft-alloc-seg" title={`${f.name} · ${money(f.alloc)}`} style={{ width: (f.alloc / denom) * 100 + "%", background: f.color }} />)}
          {unallocated > 0 && <div className="ft-alloc-seg ft-alloc-rest" style={{ width: (unallocated / denom) * 100 + "%" }} />}
        </div>
      )}

      {showSet && (
        <Modal title="Settings" onClose={() => setShowSet(false)}>
          <label className="ft-field-label" style={{ marginTop: 0 }}>Currency symbol</label>
          <input className="ft-input" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />

          <label className="ft-field-label">Backup &amp; restore</label>
          <p className="ft-muted" style={{ fontSize: 12.5, margin: "0 0 8px" }}>Download a copy of all your data, or restore from a previous backup file. Keep a backup somewhere safe.</p>
          <div className="ft-row" style={{ gap: 8 }}>
            <button className="ft-btn ft-btn-sm" onClick={downloadBackup}><Download size={13} /> Download backup</button>
            <button className="ft-btn ft-btn-sm" onClick={() => fileRef.current?.click()}><History size={13} /> Restore from file</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onFile} />
          </div>
          {restoreMsg && <p className="ft-hint" style={{ color: restoreMsg.includes("success") ? "var(--ok)" : "var(--over)" }}>{restoreMsg}</p>}

          <p className="ft-muted" style={{ marginTop: 14, fontSize: 12.5 }}>Funds appear in every month. Everything saves automatically.</p>
        </Modal>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
function FundsPanel({ funds, unallocated, money, addFund, updateFund, removeFund, mergeFund, onOpenDetail, templates, saveTemplate, applyTemplate, deleteTemplate, setAllocation }) {
  const [modal, setModal] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const active = funds.filter((f) => f.base > 0 || f.spent > 0);
  const hidden = funds.length - active.length;
  const shown = showAll ? funds : active;
  const accumulating = funds.filter((f) => f.accumulating && (f.base > 0 || f.spent > 0));

  return (
    <div className="ft-panel">
      <div className="ft-row ft-row-actions">
        <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={() => setModal("add")}><Plus size={14} /> New fund</button>
        <button className="ft-btn ft-btn-sm" onClick={() => setModal("tpl")}><Layers size={14} /> Templates</button>
      </div>

      {funds.length === 0 && <div className="ft-empty">No funds yet. Create one — it exists in every month; set its allocation per month.</div>}
      {funds.length > 0 && shown.length === 0 && <div className="ft-empty">No funds have money allocated this month.</div>}

      <div className="ft-fund-list">
        {shown.map((f) => {
          const st = leftState(f);
          const pct = f.base > 0 ? Math.round((f.spent / f.base) * 100) : (f.spent > 0 ? 100 : 0);
          const dim = f.base <= 0 && f.spent <= 0;
          return (
            <div key={f.id} className={"ft-fund" + (dim ? " ft-fund-dim" : "")}>
              <div className="ft-fund-top">
                <span className="ft-fund-name"><i className="ft-dot" style={{ background: f.color }} />{f.name}{f.accumulating && <PiggyBank size={11} className="ft-accum-ic" />}</span>
                <span className="ft-fund-tools">
                  <button className="ft-icon-btn ft-icon-mini" onClick={() => onOpenDetail(f)} aria-label="Fund history"><History size={11} /></button>
                  <button className="ft-icon-btn ft-icon-mini" onClick={() => setModal({ edit: f })} aria-label="Edit"><Pencil size={11} /></button>
                  <button className="ft-icon-btn ft-icon-mini" onClick={() => removeFund(f.id)} aria-label="Delete"><Trash2 size={12} /></button>
                </span>
              </div>
              <div className="ft-fund-body">
                <Ring pct={pct} color={STATUS_BAR[st]} />
                <div className="ft-fund-info">
                  <div className="ft-left"><span className={"ft-left-amt ft-amt-" + st}>{money(f.remaining)}</span><span className="ft-left-tag">left</span></div>
                  <span className="ft-muted ft-fund-sub">{money(f.spent)} of {money(f.base)}{f.accumulating ? ` · +${money(f.carried)} in` : ""}</span>
                </div>
              </div>
              <div className="ft-fund-foot">
                <span className="ft-alloc-edit"><span className="ft-muted">Alloc</span><AllocInput value={f.alloc} onCommit={(v) => setAllocation(f.id, v)} /></span>
                <span className="ft-muted">{pct}% spent</span>
              </div>
            </div>
          );
        })}
      </div>

      {hidden > 0 && (
        <button className="ft-toggle" onClick={() => setShowAll((s) => !s)}>
          {showAll ? <><EyeOff size={13} /> Hide unallocated</> : <><Eye size={13} /> Show all funds ({hidden} hidden)</>}
        </button>
      )}

      {accumulating.length > 0 && (
        <div className="ft-accum-panel">
          <div className="ft-subhead"><PiggyBank size={12} /> Accumulating</div>
          {accumulating.map((f) => <div key={f.id} className="ft-accum-row"><span>{f.name}</span><strong className={"ft-amt-" + leftState(f)}>{money(f.remaining)}</strong></div>)}
        </div>
      )}

      {(modal === "add" || (modal && modal.edit)) && (
        <FundModal mode={modal === "add" ? "add" : "edit"} initial={modal && modal.edit ? modal.edit : null} unallocated={unallocated} money={money}
          existingNames={funds.filter((f) => !(modal && modal.edit) || f.id !== modal.edit.id).map((f) => f.name.trim().toLowerCase())}
          mergeTargets={modal && modal.edit ? funds.filter((f) => f.id !== modal.edit.id) : []}
          onMerge={(toId) => { mergeFund(modal.edit.id, toId); setModal(null); }}
          onSubmit={(d) => { if (modal === "add") addFund(d); else updateFund(modal.edit.id, { name: d.name, accumulating: d.accumulating }); setModal(null); }} onClose={() => setModal(null)} />
      )}
      {modal === "tpl" && (
        <TemplatesModal templates={templates} canSave={funds.some((f) => f.alloc > 0)} onSave={saveTemplate} onApply={(t) => { applyTemplate(t); setModal(null); }} onDelete={deleteTemplate} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function Ring({ pct, color, size = 46 }) {
  const sw = 5, r = (size - sw) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, (pct || 0) / 100));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ft-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#111817" strokeWidth={sw} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .5s ease" }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="ft-ring-txt" fill={color}>{pct}%</text>
    </svg>
  );
}

function AllocInput({ value, onCommit }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="ft-input ft-input-tiny" type="number" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(Number(v) || 0)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

function FundModal({ mode, initial, unallocated, money, onSubmit, onClose, existingNames = [], mergeTargets = [], onMerge }) {
  const [name, setName] = useState(initial?.name || "");
  const [allocated, setAllocated] = useState("");
  const [accumulating, setAccumulating] = useState(!!initial?.accumulating);
  const [mergeId, setMergeId] = useState("");
  const dup = name.trim() && existingNames.includes(name.trim().toLowerCase());
  const submit = () => { if (!name.trim()) return; onSubmit({ name: name.trim(), accumulating, allocated: Number(allocated) || 0 }); };
  const doMerge = () => {
    if (!mergeId) return;
    const target = mergeTargets.find((f) => f.id === mergeId);
    if (window.confirm(`Merge "${initial.name}" into "${target?.name}"? All its expenses and allocations move over, and "${initial.name}" is removed. This can't be undone.`)) onMerge(mergeId);
  };
  return (
    <Modal title={mode === "add" ? "New fund" : "Edit fund"} onClose={onClose}>
      <label className="ft-field-label" style={{ marginTop: 0 }}>Name</label>
      <input className="ft-input" value={name} autoFocus placeholder="e.g. Groceries" onChange={(e) => setName(e.target.value)} />
      {dup && <p className="ft-hint" style={{ color: "var(--warn)" }}>A fund named "{name.trim()}" already exists. Funds carry across every month, so you usually don't need a new one — just allocate to the existing fund this month.</p>}
      {mode === "add" && (
        <>
          <label className="ft-field-label">Allocated this month</label>
          <input className="ft-input" type="number" value={allocated} placeholder="0" onChange={(e) => setAllocated(e.target.value)} />
          <p className="ft-hint">{money(unallocated)} unallocated this month. Change allocations any month later.</p>
        </>
      )}
      <label className="ft-check"><input type="checkbox" checked={accumulating} onChange={(e) => setAccumulating(e.target.checked)} />This fund accumulates — unspent balance carries forward automatically</label>
      <div className="ft-modal-actions">
        <button className="ft-btn" onClick={onClose}>Cancel</button>
        <button className="ft-btn ft-btn-primary" onClick={submit} disabled={!name.trim() || (mode === "add" && dup)}>{mode === "add" ? "Add fund" : "Save"}</button>
      </div>

      {mode === "edit" && mergeTargets.length > 0 && (
        <div className="ft-merge">
          <div className="ft-subhead"><GitMerge size={12} /> Merge into another fund</div>
          <p className="ft-hint" style={{ marginTop: 0 }}>Use this to fold a duplicate into the fund you want to keep — expenses and allocations move over, nothing is lost.</p>
          <div className="ft-row" style={{ gap: 8 }}>
            <select className="ft-input ft-input-sm" value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
              <option value="">Choose a fund…</option>
              {mergeTargets.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button className="ft-btn ft-btn-sm" onClick={doMerge} disabled={!mergeId}><GitMerge size={13} /> Merge</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TemplatesModal({ templates, canSave, onSave, onApply, onDelete, onClose }) {
  const [name, setName] = useState("");
  return (
    <Modal title="Allocation templates" onClose={onClose}>
      <p className="ft-muted" style={{ fontSize: 13, marginTop: 0 }}>Save this month's allocations as a reusable template, then apply it to any month.</p>
      <div className="ft-row ft-add-cat">
        <input className="ft-input ft-input-sm" placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="ft-btn ft-btn-sm ft-btn-primary" disabled={!canSave || !name.trim()} onClick={() => { if (canSave && name.trim()) { onSave(name.trim()); setName(""); } }}><Save size={13} /> Save current</button>
      </div>
      {!canSave && <p className="ft-hint">Allocate amounts to funds first to save a template.</p>}
      <div className="ft-cfg-list">
        {templates.length === 0 && <div className="ft-empty">No templates yet.</div>}
        {templates.map((t) => (
          <div key={t.id} className="ft-cfg">
            <div><strong>{t.name}</strong><span className="ft-muted"> · {Object.keys(t.allocations).length} funds</span></div>
            <div className="ft-row"><button className="ft-btn ft-btn-sm" onClick={() => onApply(t)}>Apply</button><button className="ft-icon-btn ft-icon-mini" onClick={() => onDelete(t.id)} aria-label="Delete"><Trash2 size={13} /></button></div>
          </div>
        ))}
      </div>
      <p className="ft-hint">Applying a template replaces this month's allocations.</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
function ExportModal({ funds, months, allExpenses, money, monthKey, onClose }) {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const [start, setStart] = useState(`${monthKey}-01`);
  const [end, setEnd] = useState(`${monthKey}-${String(lastDay).padStart(2, "0")}`);

  const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dow = (iso) => { const [yy, mm, dd] = iso.split("-").map(Number); return new Date(yy, mm - 1, dd).getDay(); };
  const nameById = {}; funds.forEach((f) => (nameById[f.id] = f.name));

  const valid = start <= end;
  const inRange = allExpenses.filter((e) => e.date >= start && e.date <= end).sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = inRange.reduce((s, e) => s + Number(e.amount), 0);

  function build() {
    const wb = XLSX.utils.book_new();

    // Expenses (detail) + total row
    const expRows = inRange.map((e) => ({ Date: e.date, Day: WD[dow(e.date)], Expense: e.name, Fund: nameById[e.fundId] || "(deleted fund)", Amount: Number(e.amount), Note: e.note || "" }));
    expRows.push({}); expRows.push({ Date: "", Day: "", Expense: "", Fund: "TOTAL", Amount: total });
    const wsExp = XLSX.utils.json_to_sheet(expRows, { header: ["Date", "Day", "Expense", "Fund", "Amount", "Note"] });
    wsExp["!cols"] = [{ wch: 12 }, { wch: 11 }, { wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsExp, "Expenses");

    // By fund
    const bf = {};
    inRange.forEach((e) => { const k = nameById[e.fundId] || "(deleted fund)"; (bf[k] = bf[k] || { Fund: k, Total: 0, Count: 0 }).Total += Number(e.amount); bf[k].Count++; });
    const wsF = XLSX.utils.json_to_sheet(Object.values(bf).sort((a, b) => b.Total - a.Total), { header: ["Fund", "Total", "Count"] });
    wsF["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsF, "By fund");

    // By month
    const bm = {};
    inRange.forEach((e) => { bm[e.monthKey] = (bm[e.monthKey] || 0) + Number(e.amount); });
    const wsM = XLSX.utils.json_to_sheet(Object.keys(bm).sort().map((k) => ({ Month: k, Spent: bm[k], Budget: Number(months[k]?.budget || 0) })), { header: ["Month", "Spent", "Budget"] });
    wsM["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsM, "By month");

    // By weekday
    const wd = Array(7).fill(0), wdc = Array(7).fill(0);
    inRange.forEach((e) => { const d = dow(e.date); wd[d] += Number(e.amount); wdc[d]++; });
    const wsW = XLSX.utils.json_to_sheet(WD.map((n, i) => ({ Weekday: n, Total: wd[i], Count: wdc[i] })), { header: ["Weekday", "Total", "Count"] });
    wsW["!cols"] = [{ wch: 11 }, { wch: 14 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsW, "By weekday");

    // Allocations for the months the range touches
    const sMK = start.slice(0, 7), eMK = end.slice(0, 7);
    const aRows = [];
    Object.keys(months).sort().forEach((mk) => {
      if (mk < sMK || mk > eMK) return;
      const allocs = months[mk].allocations || {};
      funds.forEach((f) => {
        const a = Number(allocs[f.id] || 0);
        const spent = allExpenses.filter((e) => e.monthKey === mk && e.fundId === f.id).reduce((s, e) => s + Number(e.amount), 0);
        if (a > 0 || spent > 0) aRows.push({ Month: mk, Fund: nameById[f.id] || f.id, Allocated: a, Spent: spent, Remaining: a - spent });
      });
    });
    if (aRows.length) { const wsA = XLSX.utils.json_to_sheet(aRows, { header: ["Month", "Fund", "Allocated", "Spent", "Remaining"] }); wsA["!cols"] = [{ wch: 10 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }]; XLSX.utils.book_append_sheet(wb, wsA, "Allocations"); }

    return wb;
  }

  const fname = `fund-tracker_${start}_to_${end}`;
  const downloadXlsx = () => { if (valid && inRange.length) XLSX.writeFile(build(), fname + ".xlsx"); };
  const downloadCsv = () => {
    if (!valid || !inRange.length) return;
    const csv = XLSX.utils.sheet_to_csv(build().Sheets["Expenses"]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = fname + ".csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Modal title="Export data" onClose={onClose}>
      <p className="ft-muted" style={{ fontSize: 13, marginTop: 0 }}>Choose a date range, then download a spreadsheet with your expenses plus by-fund, by-month and by-weekday summaries.</p>
      <div className="ft-row" style={{ gap: 10 }}>
        <div style={{ flex: 1 }}><label className="ft-field-label" style={{ marginTop: 0 }}>From</label><input className="ft-input ft-input-sm" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label className="ft-field-label" style={{ marginTop: 0 }}>To</label><input className="ft-input ft-input-sm" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
      {!valid ? <p className="ft-hint" style={{ color: "var(--over)" }}>"From" must be on or before "To".</p>
        : <p className="ft-hint">{inRange.length} expense{inRange.length === 1 ? "" : "s"} in range · total {money(total)}</p>}
      <div className="ft-modal-actions">
        <button className="ft-btn ft-btn-sm" onClick={downloadCsv} disabled={!valid || !inRange.length}>CSV</button>
        <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={downloadXlsx} disabled={!valid || !inRange.length}><Download size={14} /> Download Excel</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
function ExpensesPanel({ availableFunds, fundLookup, expenses, allExpenses, money, addExpense, updateExpense, removeExpense, monthKey }) {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const minDate = `${monthKey}-01`;
  const maxDate = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  const defaultDate = () => (monthKey === todayKey ? new Date().toISOString().slice(0, 10) : minDate);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [fundId, setFundId] = useState(availableFunds[0]?.id || "");
  const [date, setDate] = useState(defaultDate());
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null); // null = all funds shown
  const [sort, setSort] = useState("date_desc");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set()); // expanded named groups

  useEffect(() => { if (!availableFunds.find((f) => f.id === fundId)) setFundId(availableFunds[0]?.id || ""); }, [availableFunds]); // eslint-disable-line
  useEffect(() => { setDate(defaultDate()); setSelected(null); }, [monthKey]); // eslint-disable-line

  // suggestions from the full history: name -> most-used fund + last amount
  const nameMeta = {};
  allExpenses.forEach((e) => {
    const k = (e.name || "").trim().toLowerCase(); if (!k) return;
    const mm = nameMeta[k] = nameMeta[k] || { display: e.name.trim(), fundCount: {}, lastAmount: e.amount, lastDate: e.date };
    mm.fundCount[e.fundId] = (mm.fundCount[e.fundId] || 0) + 1;
    if (e.date >= mm.lastDate) { mm.lastDate = e.date; mm.lastAmount = e.amount; }
  });
  const suggestions = Object.values(nameMeta).map((mm) => mm.display).sort((a, b) => a.localeCompare(b));

  const onName = (val) => {
    setName(val);
    const mm = nameMeta[val.trim().toLowerCase()];
    if (mm) {
      const topFund = Object.entries(mm.fundCount).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topFund && availableFunds.some((f) => f.id === topFund)) setFundId(topFund);
    }
  };

  const submit = () => {
    if (!name.trim() || !amount || !fundId) return;
    const safe = date < minDate ? minDate : date > maxDate ? maxDate : date;
    addExpense({ name: name.trim(), amount: Number(amount), fundId, date: safe, note: note.trim() });
    setName(""); setAmount(""); setNote("");
  };

  // search → fund groups → named units
  const q = query.trim().toLowerCase();
  const filtered = q ? expenses.filter((e) => (e.name || "").toLowerCase().includes(q) || (e.note || "").toLowerCase().includes(q)) : expenses;
  const byDate = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const gmap = {};
  filtered.forEach((e) => { (gmap[e.fundId] = gmap[e.fundId] || []).push(e); });

  let groups = Object.entries(gmap).map(([fid, items]) => {
    const info = fundLookup[fid] || { name: "(deleted fund)", color: "#666" };
    // group this fund's items by name
    const nm = {};
    items.forEach((e) => { const k = (e.name || "").trim().toLowerCase(); (nm[k] = nm[k] || { key: fid + "|" + k, name: e.name.trim(), items: [] }).items.push(e); });
    let units = Object.values(nm).map((u) => ({ ...u, items: [...u.items].sort(byDate), total: u.items.reduce((s, e) => s + Number(e.amount), 0), count: u.items.length, latest: u.items.reduce((d, e) => (e.date > d ? e.date : d), "") }));
    // order units by selected sort
    units.sort(sort.startsWith("amt") ? (a, b) => (sort === "amt_desc" ? b.total - a.total : a.total - b.total) : (a, b) => (sort === "date_desc" ? (a.latest < b.latest ? 1 : -1) : (a.latest < b.latest ? -1 : 1)));
    return { fid, name: info.name, color: info.color, units, total: items.reduce((s, e) => s + Number(e.amount), 0), count: items.length };
  }).sort((a, b) => b.total - a.total);

  const allFids = groups.map((g) => g.fid);
  const allOn = selected === null;
  const isSel = (fid) => allOn || selected.has(fid);
  const toggleFund = (fid) => setSelected((prev) => {
    const cur = prev === null ? new Set(allFids) : new Set(prev);
    if (cur.has(fid)) cur.delete(fid); else cur.add(fid);
    return cur.size === allFids.length ? null : cur;
  });
  const shownGroups = groups.filter((g) => isSel(g.fid));
  const toggleOpen = (key) => setOpen((prev) => { const c = new Set(prev); c.has(key) ? c.delete(key) : c.add(key); return c; });

  const entryRow = (e, sub = false) => (
    <div key={e.id} className={"ft-lg-row" + (sub ? " ft-lg-sub" : "")}>
      <span className="ft-lg-name">{e.name}{e.note && <span className="ft-lg-note"> — {e.note}</span>}</span>
      <span className="ft-lg-date">{e.date.slice(5)}</span>
      <span className="ft-lg-amt">{money(e.amount)}</span>
      <button className="ft-icon-btn ft-icon-mini" onClick={() => setEditing(e)} aria-label="Edit"><Pencil size={11} /></button>
      <button className="ft-icon-btn ft-icon-mini" onClick={() => removeExpense(e.id)} aria-label="Delete"><X size={12} /></button>
    </div>
  );

  return (
    <div className="ft-panel">
      <div className="ft-addexp">
        {availableFunds.length === 0 ? <div className="ft-empty" style={{ width: "100%" }}>No funds are allocated this month. Allocate a fund in the Funds section, then log expenses here.</div> : (
          <>
            <input className="ft-input ft-input-sm ft-ax-name" placeholder="What was it for?" value={name} list="ft-name-suggestions" onChange={(e) => onName(e.target.value)} />
            <datalist id="ft-name-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
            <input className="ft-input ft-input-sm ft-ax-amt" type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className="ft-input ft-input-sm ft-ax-date" type="date" value={date} min={minDate} max={maxDate} onChange={(e) => setDate(e.target.value)} title="Date is limited to the selected month" />
            <input className="ft-input ft-input-sm ft-ax-note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <select className="ft-input ft-input-sm ft-ax-fund" value={fundId} onChange={(e) => setFundId(e.target.value)}>{availableFunds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <button className="ft-btn ft-btn-primary ft-btn-sm ft-ax-add" onClick={submit}><Plus size={14} /> Add</button>
          </>
        )}
      </div>

      {expenses.length === 0 ? <div className="ft-empty">No expenses logged this month.</div> : (
        <>
          <div className="ft-search">
            <Search size={14} className="ft-search-ic" />
            <input className="ft-input ft-input-sm ft-search-in" placeholder="Search name or note…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <button className="ft-icon-btn ft-icon-mini" onClick={() => setQuery("")} aria-label="Clear search"><X size={12} /></button>}
          </div>

          <div className="ft-exp-controls">
            <div className="ft-chips">
              <button className={"ft-chipbtn" + (allOn ? " on" : "")} onClick={() => setSelected(null)}><span className="ft-chip-label">All</span></button>
              {groups.map((g) => (
                <button key={g.fid} className={"ft-chipbtn" + (isSel(g.fid) ? " on" : "")} onClick={() => toggleFund(g.fid)} title={g.name}>
                  <i style={{ background: g.color }} /><span className="ft-chip-label">{g.name}</span>
                </button>
              ))}
            </div>
            <select className="ft-input ft-input-sm ft-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="amt_desc">Highest amount</option>
              <option value="amt_asc">Lowest amount</option>
            </select>
          </div>

          <div className="ft-ledger">
            {filtered.length === 0 && <div className="ft-empty" style={{ columnSpan: "all" }}>No expenses match "{query}".</div>}
            {filtered.length > 0 && shownGroups.length === 0 && <div className="ft-empty" style={{ columnSpan: "all" }}>No funds selected.</div>}
            {shownGroups.map((g) => (
              <div key={g.fid} className="ft-lg-group">
                <div className="ft-lg-head">
                  <span className="ft-fund-name"><i className="ft-dot" style={{ background: g.color }} />{g.name}<span className="ft-muted" style={{ fontWeight: 400 }}> · {g.count}</span></span>
                  <strong>{money(g.total)}</strong>
                </div>
                {g.units.map((u) => {
                  if (u.count === 1) return entryRow(u.items[0]);
                  const isOpen = open.has(u.key) || !!q;
                  return (
                    <div key={u.key} className="ft-lg-recwrap">
                      <div className="ft-lg-row ft-lg-rec" role="button" tabIndex={0} onClick={() => toggleOpen(u.key)}>
                        <span className="ft-lg-name ft-lg-recname">{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className="ft-lg-nametext">{u.name}</span><span className="ft-nx-badge">×{u.count}</span></span>
                        <span className="ft-lg-date" />
                        <span className="ft-lg-amt">{money(u.total)}</span>
                        <span /><span />
                      </div>
                      {isOpen && u.items.map((e) => entryRow(e, true))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {editing && (
        <ExpenseEditModal expense={editing} availableFunds={availableFunds} fundLookup={fundLookup} minDate={minDate} maxDate={maxDate}
          onSave={(patch) => { updateExpense(editing.id, patch); setEditing(null); }} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ExpenseEditModal({ expense, availableFunds, fundLookup, minDate, maxDate, onSave, onClose }) {
  const [name, setName] = useState(expense.name);
  const [amount, setAmount] = useState(expense.amount);
  const [fundId, setFundId] = useState(expense.fundId);
  const [date, setDate] = useState(expense.date);
  const [note, setNote] = useState(expense.note || "");

  const opts = [...availableFunds];
  if (!opts.find((f) => f.id === expense.fundId)) {
    const info = fundLookup[expense.fundId];
    opts.unshift({ id: expense.fundId, name: (info?.name || "(deleted fund)") + " — not in this month" });
  }
  const save = () => {
    if (!name.trim() || !amount || !fundId) return;
    const safe = date < minDate ? minDate : date > maxDate ? maxDate : date;
    onSave({ name: name.trim(), amount: Number(amount), fundId, date: safe, note: note.trim() });
  };
  return (
    <Modal title="Edit expense" onClose={onClose}>
      <label className="ft-field-label" style={{ marginTop: 0 }}>Name</label>
      <input className="ft-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <div className="ft-row" style={{ gap: 10 }}>
        <div style={{ flex: 1 }}><label className="ft-field-label">Amount</label><input className="ft-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label className="ft-field-label">Date</label><input className="ft-input" type="date" value={date} min={minDate} max={maxDate} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <label className="ft-field-label">Fund</label>
      <select className="ft-input" value={fundId} onChange={(e) => setFundId(e.target.value)}>{opts.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      <label className="ft-field-label">Note</label>
      <input className="ft-input" value={note} placeholder="Optional context" onChange={(e) => setNote(e.target.value)} />
      <div className="ft-modal-actions">
        <button className="ft-btn" onClick={onClose}>Cancel</button>
        <button className="ft-btn ft-btn-primary" onClick={save} disabled={!name.trim() || !amount}>Save</button>
      </div>
    </Modal>
  );
}

/* Drill-in: one fund's spend (and allocation) across months, with a mini chart. */
function FundDetailModal({ fund, allExpenses, months, money, onClose }) {
  const keys = new Set(Object.keys(months));
  allExpenses.forEach((e) => { if (e.fundId === fund.id) keys.add(e.monthKey); });
  const short = (k) => { const [yy, mm] = k.split("-"); return new Date(Number(yy), Number(mm) - 1, 1).toLocaleString(undefined, { month: "short" }) + " " + yy.slice(2); };
  const series = [...keys].sort().slice(-12).map((k) => ({
    name: short(k),
    Spent: allExpenses.filter((e) => e.fundId === fund.id && e.monthKey === k).reduce((s, e) => s + Number(e.amount), 0),
    Allocated: Number(months[k]?.allocations?.[fund.id] || 0),
  }));
  const total = allExpenses.filter((e) => e.fundId === fund.id).reduce((s, e) => s + Number(e.amount), 0);
  const activeMonths = series.filter((s) => s.Spent > 0);
  const avg = activeMonths.length ? Math.round(activeMonths.reduce((s, m) => s + m.Spent, 0) / activeMonths.length) : 0;
  const highest = series.reduce((a, b) => (b.Spent > (a?.Spent || 0) ? b : a), null);
  // trend: last active month vs average
  const last = activeMonths[activeMonths.length - 1];
  let trendMsg = null;
  if (activeMonths.length >= 3 && avg > 0 && last) {
    const diff = Math.round(((last.Spent - avg) / avg) * 100);
    if (Math.abs(diff) >= 15) trendMsg = `Latest month is ${Math.abs(diff)}% ${diff > 0 ? "above" : "below"} its average — ${diff > 0 ? "creeping up" : "easing off"}.`;
  }

  return (
    <Modal title={fund.name} onClose={onClose}>
      <div className="ft-fd-stats">
        <div><span className="ft-stat-label">Total spent</span><strong>{money(total)}</strong></div>
        <div><span className="ft-stat-label">Avg / active month</span><strong>{money(avg)}</strong></div>
        <div><span className="ft-stat-label">Highest month</span><strong>{highest && highest.Spent > 0 ? `${money(highest.Spent)} (${highest.name})` : "—"}</strong></div>
      </div>
      {series.length === 0 || total === 0 ? (
        <p className="ft-muted" style={{ fontSize: 13 }}>No spending recorded for this fund yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={190}>
          <ComposedChart data={series} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
            <defs>
              <linearGradient id="ftFdFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--spent)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--spent)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted)" }} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} width={40} tickFormatter={(v) => (v >= 1000 ? Math.round(v / 100) / 10 + "k" : v)} />
            <Tooltip formatter={(v) => money(v)} contentStyle={TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
            <Area type="monotone" dataKey="Spent" stroke="var(--spent)" strokeWidth={2.5} fill="url(#ftFdFill)" />
            <Line type="monotone" dataKey="Allocated" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      {trendMsg && <p className="ft-hint" style={{ marginTop: 8 }}>{trendMsg}</p>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
function Dashboard({ funds, months, allExpenses, monthKey, budget, totalAllocated, totalSpent, money }) {
  const hasData = funds.some((f) => f.alloc > 0) || totalSpent > 0 || allExpenses.length > 0;
  return (
    <div className="ft-dash">
      {!hasData
        ? <div className="ft-empty ft-empty-big">Set a budget, allocate to funds, and log expenses — your analysis appears here.</div>
        : <UnifiedDashboard funds={funds} months={months} allExpenses={allExpenses} monthKey={monthKey} budget={budget} money={money} />}
    </div>
  );
}

const shortMonth = (k) => { const [yy, mm] = k.split("-"); return new Date(Number(yy), Number(mm) - 1, 1).toLocaleString(undefined, { month: "short" }) + " " + yy.slice(2); };

/* One filterable analysis panel: pick any funds (or all) and see this month's
   status plus the spend-vs-reference trend for exactly that selection. */
function UnifiedDashboard({ funds, months, allExpenses, monthKey, budget, money }) {
  const [sel, setSel] = useState(null); // null = all
  const kfmt = (v) => (v >= 1000 ? Math.round(v / 100) / 10 + "k" : v);

  const pool = funds.filter((f) => allExpenses.some((e) => e.fundId === f.id) || Object.values(months).some((m) => Number(m.allocations?.[f.id] || 0) > 0));
  const allSel = sel === null;
  const inSel = (fid) => (allSel ? pool.some((f) => f.id === fid) : sel.has(fid));
  const selIds = allSel ? pool.map((f) => f.id) : [...sel];
  const toggle = (fid) => setSel((prev) => {
    const cur = prev === null ? new Set(pool.map((f) => f.id)) : new Set(prev);
    if (cur.has(fid)) cur.delete(fid); else cur.add(fid);
    return cur.size === pool.length ? null : cur;
  });

  const refLabel = allSel ? "Budget" : "Allocated";
  const spentThis = allExpenses.filter((e) => e.monthKey === monthKey && inSel(e.fundId)).reduce((s, e) => s + Number(e.amount), 0);
  const allocThis = selIds.reduce((s, fid) => s + Number(months[monthKey]?.allocations?.[fid] || 0), 0);
  const ref = allSel ? Number(budget || 0) : allocThis;
  const remaining = ref - spentThis;
  const over = ref > 0 && spentThis > ref;
  const pct = ref > 0 ? Math.round((spentThis / ref) * 100) : null;
  const color = over ? "var(--over)" : (ref > 0 && spentThis / ref > 0.85 ? "var(--warn)" : "var(--ok)");
  const spentPct = ref > 0 ? Math.min(100, (spentThis / ref) * 100) : 0;

  const keys = new Set(Object.keys(months)); allExpenses.forEach((e) => keys.add(e.monthKey)); keys.add(monthKey);
  const series = [...keys].sort().slice(-12).map((k) => ({
    name: shortMonth(k),
    Spent: allExpenses.filter((e) => e.monthKey === k && inSel(e.fundId)).reduce((s, e) => s + Number(e.amount), 0),
    Ref: allSel ? Number(months[k]?.budget || 0) : selIds.reduce((s, fid) => s + Number(months[k]?.allocations?.[fid] || 0), 0),
  }));
  const activeCount = series.filter((s) => s.Spent > 0).length;
  const avg = activeCount ? Math.round(series.reduce((s, m) => s + m.Spent, 0) / activeCount) : 0;

  // month-over-month delta for the selection
  const prevKey = shiftMonth(monthKey, -1);
  const prevSpent = allExpenses.filter((e) => e.monthKey === prevKey && inSel(e.fundId)).reduce((s, e) => s + Number(e.amount), 0);
  const delta = prevSpent > 0 ? Math.round(((spentThis - prevSpent) / prevSpent) * 100) : null;

  // filter-aware composition for this month
  const monthSel = allExpenses.filter((e) => e.monthKey === monthKey && inSel(e.fundId));
  let comp = [];
  if (selIds.length === 1) {
    const nm = {};
    monthSel.forEach((e) => { const k = (e.name || "").trim().toLowerCase(); (nm[k] = nm[k] || { label: e.name.trim(), total: 0, color: "var(--spent)" }).total += Number(e.amount); });
    comp = Object.values(nm);
  } else {
    const fm = {};
    monthSel.forEach((e) => { (fm[e.fundId] = fm[e.fundId] || { total: 0 }).total += Number(e.amount); });
    comp = Object.entries(fm).map(([fid, v]) => { const f = funds.find((x) => x.id === fid) || {}; return { label: f.name || "?", total: v.total, color: f.color || "#666" }; });
  }
  comp = comp.sort((a, b) => b.total - a.total).slice(0, 6);
  const compMax = Math.max(...comp.map((c) => c.total), 1);
  const compTitle = selIds.length === 1 ? "By expense this month" : "By fund this month";

  return (
    <div className="ft-card ft-uni">
      <div className="ft-chips ft-uni-filter">
        <button className={"ft-chipbtn" + (allSel ? " on" : "")} onClick={() => setSel(null)}><span className="ft-chip-label">All funds</span></button>
        {pool.map((f) => (
          <button key={f.id} className={"ft-chipbtn" + (inSel(f.id) ? " on" : "")} onClick={() => toggle(f.id)} title={f.name}>
            <i style={{ background: f.color }} /><span className="ft-chip-label">{f.name}</span>
          </button>
        ))}
      </div>

      <div className="ft-ov-top">
        <div className="ft-ov-head">
          <span className="ft-ov-spent">{money(spentThis)}</span>
          <span className="ft-ov-of">spent of {money(ref)} this month{delta != null && <span className="ft-delta" style={{ color: delta > 0 ? "var(--over)" : "var(--ok)" }}>{delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {Math.abs(delta)}% vs last month</span>}</span>
        </div>
        <div className="ft-ov-pct" style={{ color }}>{pct == null ? "\u2014" : pct + "%"}</div>
      </div>
      <div className="ft-ov-bar"><div className="ft-ov-fill" style={{ width: spentPct + "%", background: color }} /></div>
      <div className="ft-ov-stats">
        <div><span className="ft-stat-label">{refLabel}</span><strong>{money(ref)}</strong></div>
        <div><span className="ft-stat-label">{over ? "Over by" : "Remaining"}</span><strong style={{ color: over ? "var(--over)" : "var(--ok)" }}>{money(Math.abs(remaining))}</strong></div>
        <div><span className="ft-stat-label">Avg / mo</span><strong>{money(avg)}</strong></div>
      </div>

      <div className="ft-uni-chart">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={series} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
            <defs>
              <linearGradient id="ftUniFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C_SPENT} stopOpacity={0.35} />
                <stop offset="100%" stopColor={C_SPENT} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} width={40} tickFormatter={kfmt} />
            <Tooltip formatter={(v) => money(v)} contentStyle={TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
            <Area type="monotone" dataKey="Spent" name="Spent" stroke={C_SPENT} strokeWidth={2.5} fill="url(#ftUniFill)" />
            <Line type="monotone" dataKey="Ref" name={refLabel} stroke={C_BUDGET} strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="ft-comp">
        <div className="ft-comp-head">{compTitle}</div>
        {comp.length === 0 ? <p className="ft-muted" style={{ fontSize: 12.5, margin: 0 }}>No spending this month for this selection.</p> : (
          comp.map((c, i) => (
            <div key={i} className="ft-rank-row">
              <div className="ft-rank-name" title={c.label}>{c.label}</div>
              <div className="ft-rank-track"><div className="ft-rank-fill" style={{ width: Math.max(2, (c.total / compMax) * 100) + "%", background: c.color }} /></div>
              <div className="ft-rank-amt">{money(c.total)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const TOOLTIP = { background: "#222B28", border: "1px solid #2E3A35", borderRadius: 8, color: "#E8EDEA", fontSize: 12 };

/* ------------------------------------------------------------------ */
function SectionHead({ icon, title }) { return <div className="ft-sec-head">{icon}<span>{title}</span></div>; }
function Modal({ title, children, onClose }) {
  return (
    <div className="ft-modal-overlay" onClick={onClose}>
      <div className="ft-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ft-modal-head"><h3>{title}</h3><button className="ft-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="ft-modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
      .ft-root{
        --canvas:#0E1413; --surface:#19211F; --ink:#E8EDEA; --muted:#8B958F;
        --accent:#4FB89A; --accent-soft:#22332D; --line:#2A332F;
        --ok:#4FB89A; --warn:#E0A458; --over:#E5795F; --spent:#6EA8E0;
        font-family:'Inter',system-ui,sans-serif; color:var(--ink); background:var(--canvas);
        padding:10px; border-radius:12px; font-feature-settings:'tnum'; -webkit-font-smoothing:antialiased;
        height:100vh; min-height:560px; display:flex; flex-direction:column; gap:8px;
      }
      .ft-root *{box-sizing:border-box;}
      .ft-muted{color:var(--muted);}
      .ft-hint{font-size:12px;color:var(--muted);margin:6px 0 0;}
      .ft-amt-ok{color:var(--ok);} .ft-amt-low{color:var(--warn);} .ft-amt-over{color:var(--over);} .ft-amt-none{color:var(--muted);}

      .ft-top{display:flex;flex-direction:column;gap:7px;flex:none;}
      .ft-top-bar{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;}
      .ft-top-left{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
      .ft-brand{display:flex;align-items:center;gap:7px;font-family:'Space Grotesk';font-weight:700;font-size:17px;color:var(--accent);}
      .ft-month{display:flex;align-items:center;gap:4px;}
      .ft-month-label{font-family:'Space Grotesk';font-weight:600;font-size:14px;min-width:118px;text-align:center;}
      .ft-top-right{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
      .ft-kpi{display:flex;flex-direction:column;}
      .ft-kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
      .ft-kpi-value{font-family:'Space Grotesk';font-weight:600;font-size:15px;}
      .ft-kpi-clickable{background:none;border:none;padding:0;cursor:pointer;color:var(--ink);text-align:left;border-bottom:1px dashed var(--line);}
      .ft-budget-edit{display:flex;gap:6px;align-items:center;}
      .ft-alloc-track{display:flex;height:9px;border-radius:5px;overflow:hidden;background:#111817;border:1px solid var(--line);}
      .ft-alloc-seg{height:100%;transition:width .35s ease;}
      .ft-alloc-rest{background:repeating-linear-gradient(45deg,#26302C,#26302C 5px,#161E1C 5px,#161E1C 10px);}

      .ft-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(232px,300px) 1fr;gap:9px;}
      .ft-right{display:flex;flex-direction:column;gap:9px;min-height:0;min-width:0;overflow-y:auto;}
      .ft-right::-webkit-scrollbar{width:7px;} .ft-right::-webkit-scrollbar-thumb{background:#2E3A35;border-radius:4px;}
      .ft-col{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 13px;overflow-y:auto;min-height:0;box-shadow:0 2px 8px rgba(0,0,0,.22);}
      .ft-col::-webkit-scrollbar{width:7px;} .ft-col::-webkit-scrollbar-thumb{background:#2E3A35;border-radius:4px;}
      .ft-col-dash{flex:0 0 auto;overflow:visible;}
      .ft-col-exp{flex:0 0 auto;overflow:visible;}
      @media(max-width:900px){
        .ft-root{height:auto;}
        .ft-grid{grid-template-columns:1fr;}
        .ft-right{overflow:visible;}
        .ft-col,.ft-col-dash,.ft-col-exp{overflow:visible;flex:none;}
      }

      .ft-sec-head{display:flex;align-items:center;gap:7px;font-family:'Space Grotesk';font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid var(--line);position:sticky;top:-12px;background:var(--surface);z-index:3;}
      .ft-sec-head svg{color:var(--accent);}

      .ft-btn{display:inline-flex;align-items:center;gap:5px;font-family:'Inter';font-size:13px;font-weight:500;padding:7px 11px;border-radius:8px;border:1px solid var(--line);background:var(--canvas);color:var(--ink);cursor:pointer;transition:background .15s;}
      .ft-btn:hover{background:#222B28;}
      .ft-btn-primary{background:var(--accent);border-color:var(--accent);color:#0E1413;font-weight:600;}
      .ft-btn-primary:hover{background:#5fc7a9;}
      .ft-btn:disabled,.ft-btn-primary:disabled{opacity:.4;cursor:not-allowed;}
      .ft-btn-sm{padding:6px 9px;font-size:12px;}
      .ft-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;border:none;background:transparent;color:var(--muted);cursor:pointer;}
      .ft-icon-btn:hover{background:#222B28;color:var(--ink);}
      .ft-icon-btn:disabled{opacity:.35;cursor:not-allowed;}
      .ft-icon-mini{width:22px;height:22px;}
      .ft-input{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-family:'Inter';font-size:14px;color:var(--ink);background:var(--canvas);}
      .ft-input:focus{outline:2px solid var(--accent-soft);border-color:var(--accent);}
      .ft-input-sm{font-size:13px;padding:6px 8px;}
      .ft-input-tiny{width:96px;padding:4px 7px;font-size:13px;}
      .ft-input::placeholder{color:#5C655F;}
      .ft-input:-webkit-autofill,.ft-input:-webkit-autofill:hover,.ft-input:-webkit-autofill:focus{-webkit-text-fill-color:var(--ink);-webkit-box-shadow:0 0 0 1000px var(--canvas) inset;caret-color:var(--ink);transition:background-color 9999s ease 0s;}
      .ft-row{display:flex;gap:7px;align-items:center;}
      .ft-row-actions{margin-bottom:11px;flex-wrap:wrap;}
      .ft-add-cat{margin-top:8px;}
      .ft-field-label{display:block;font-size:12px;font-weight:500;color:var(--muted);margin:11px 0 4px;}
      .ft-check{display:flex;gap:7px;align-items:flex-start;font-size:13px;margin-top:14px;cursor:pointer;line-height:1.4;}
      .ft-check input{margin-top:2px;accent-color:var(--accent);}

      .ft-fund-list{display:flex;flex-direction:column;gap:10px;}
      .ft-fund{background:var(--canvas);border:1px solid var(--line);border-radius:12px;padding:11px 12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.015);transition:border-color .15s,transform .15s;}
      .ft-fund:hover{border-color:#39443F;transform:translateY(-1px);}
      .ft-fund-dim{opacity:.55;}
      .ft-fund-top{display:flex;justify-content:space-between;align-items:center;}
      .ft-fund-name{display:flex;align-items:center;gap:6px;font-weight:600;font-size:13.5px;}
      .ft-fund-tools{display:flex;gap:1px;}
      .ft-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none;}
      .ft-accum-ic{color:var(--muted);}
      .ft-fund-body{display:flex;align-items:center;gap:12px;margin:9px 0 8px;}
      .ft-ring{flex:none;}
      .ft-ring-txt{font-family:'Space Grotesk';font-weight:700;font-size:12px;}
      .ft-fund-info{display:flex;flex-direction:column;gap:2px;min-width:0;}
      .ft-left{display:flex;align-items:baseline;gap:5px;}
      .ft-left-amt{font-family:'Space Grotesk';font-weight:700;font-size:22px;line-height:1;}
      .ft-left-tag{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
      .ft-fund-sub{font-size:11.5px;}
      .ft-fund-foot{display:flex;justify-content:space-between;align-items:center;font-size:12px;gap:6px;padding-top:8px;border-top:1px solid var(--line);}
      .ft-alloc-edit{display:flex;align-items:center;gap:6px;}
      .ft-toggle{display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:none;border:none;color:var(--accent);font-family:'Inter';font-size:12.5px;font-weight:500;cursor:pointer;padding:4px 0;}
      .ft-toggle:hover{text-decoration:underline;}
      .ft-accum-panel{margin-top:13px;padding-top:11px;border-top:1px solid var(--line);}
      .ft-accum-row{display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;}
      .ft-subhead{display:flex;align-items:center;gap:6px;font-family:'Space Grotesk';font-weight:600;font-size:12.5px;margin-bottom:9px;}

      .ft-addexp{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:13px;}
      .ft-ax-name{flex:3 1 150px;} .ft-ax-note{flex:3 1 150px;}
      .ft-ax-amt{flex:0 1 110px;} .ft-ax-date{flex:0 1 150px;}
      .ft-ax-fund{flex:2 1 150px;} .ft-ax-add{flex:0 0 auto;}
      .ft-search{display:flex;align-items:center;gap:6px;margin-bottom:9px;border:1px solid var(--line);border-radius:8px;background:var(--canvas);padding:0 6px;max-width:360px;}
      .ft-search-ic{color:var(--muted);flex:none;}
      .ft-search-in{border:none;background:transparent;padding:7px 2px;}
      .ft-search-in:focus{outline:none;}
      .ft-nx-badge{flex:none;font-size:10px;font-weight:600;color:var(--accent);background:var(--accent-soft);border-radius:20px;padding:1px 6px;}
      .ft-merge{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);}
      .ft-fd-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;}
      .ft-fd-stats > div{background:var(--canvas);border:1px solid var(--line);border-radius:9px;padding:8px 9px;display:flex;flex-direction:column;gap:3px;}
      .ft-fd-stats strong{font-family:'Space Grotesk';font-size:13px;}
      .ft-exp-controls{display:flex;flex-direction:column;gap:7px;margin-bottom:10px;}
      .ft-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:6px;}
      .ft-chipbtn{display:flex;align-items:center;gap:5px;min-width:0;font-family:'Inter';font-size:11.5px;font-weight:500;padding:5px 9px;border-radius:8px;border:1px solid var(--line);background:var(--canvas);color:var(--muted);cursor:pointer;transition:border-color .15s,color .15s;}
      .ft-chipbtn:hover{border-color:#39443F;}
      .ft-chipbtn i{width:8px;height:8px;border-radius:50%;flex:none;}
      .ft-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .ft-chipbtn.on{color:var(--ink);border-color:var(--accent);background:var(--accent-soft);}
      .ft-sort{max-width:150px;align-self:flex-start;}
      /* dense ledger that balances across columns */
      .ft-ledger{column-width:320px;column-gap:22px;}
      .ft-ledger .ft-empty{break-inside:avoid;}
      .ft-lg-group{break-inside:avoid;-webkit-column-break-inside:avoid;margin:0 0 16px;}
      .ft-lg-head{display:flex;justify-content:space-between;align-items:center;padding:0 0 5px;margin-bottom:3px;border-bottom:1px solid var(--line);}
      .ft-lg-head .ft-fund-name{font-size:13px;font-weight:600;}
      .ft-lg-head strong{font-family:'Space Grotesk';font-size:13.5px;}
      .ft-lg-row{display:grid;grid-template-columns:1fr auto 70px 22px 22px;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #1B2320;font-size:12.5px;}
      .ft-lg-group > .ft-lg-row:last-child,.ft-lg-recwrap:last-child .ft-lg-row:last-child{border-bottom:none;}
      .ft-lg-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}
      .ft-lg-note{color:var(--muted);font-style:italic;font-weight:400;}
      .ft-lg-date{font-size:10.5px;color:var(--muted);white-space:nowrap;}
      .ft-lg-amt{font-family:'Space Grotesk';font-weight:600;font-size:12.5px;text-align:right;}
      .ft-lg-rec{cursor:pointer;}
      .ft-lg-rec:hover .ft-lg-nametext{color:var(--accent);}
      .ft-lg-recname{display:flex;align-items:center;gap:5px;}
      .ft-lg-recname svg{color:var(--muted);flex:none;}
      .ft-lg-nametext{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .ft-lg-sub{background:rgba(255,255,255,.012);}
      .ft-lg-sub .ft-lg-name{padding-left:16px;font-weight:400;}

      .ft-dash{display:flex;flex-direction:column;gap:10px;}
      .ft-stat-label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);}
      .ft-card{background:var(--canvas);border:1px solid var(--line);border-radius:12px;padding:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.015);}
      /* budget overview */
      .ft-ov{padding:13px 13px 12px;}
      .ft-ov-top{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:9px;}
      .ft-ov-head{display:flex;flex-direction:column;gap:1px;}
      .ft-ov-spent{font-family:'Space Grotesk';font-weight:700;font-size:26px;line-height:1;}
      .ft-ov-of{font-size:11.5px;color:var(--muted);}
      .ft-ov-pct{font-family:'Space Grotesk';font-weight:700;font-size:22px;line-height:1;}
      .ft-ov-bar{position:relative;height:10px;background:#111817;border:1px solid var(--line);border-radius:5px;margin-bottom:11px;}
      .ft-ov-fill{position:absolute;left:0;top:0;bottom:0;border-radius:4px;transition:width .4s ease;min-width:2px;}
      .ft-ov-tick{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink);transform:translateX(-1px);border-radius:2px;}
      .ft-ov-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
      .ft-ov-stats > div{display:flex;flex-direction:column;gap:2px;}
      .ft-ov-stats strong{font-family:'Space Grotesk';font-weight:700;font-size:14px;}
      /* unified dashboard panel */
      .ft-uni{padding:14px;}
      .ft-uni-filter{margin-bottom:13px;}
      .ft-uni-chart{margin-top:12px;}
      .ft-delta{margin-left:7px;font-weight:600;white-space:nowrap;}
      .ft-comp{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:7px;}
      .ft-comp-head{font-family:'Space Grotesk';font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:2px;}
      .ft-rank-row{display:grid;grid-template-columns:90px 1fr auto;align-items:center;gap:9px;font-size:12px;}
      .ft-rank-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink);}
      .ft-rank-track{height:13px;background:#111817;border:1px solid var(--line);border-radius:4px;overflow:hidden;}
      .ft-rank-fill{height:100%;border-radius:3px;transition:width .4s ease;}
      .ft-rank-amt{font-family:'Space Grotesk';font-weight:600;font-size:12px;text-align:right;min-width:58px;}

      .ft-empty{color:var(--muted);font-size:13px;padding:12px;text-align:center;background:var(--canvas);border:1px solid var(--line);border-radius:9px;line-height:1.45;}
      .ft-empty-big{padding:32px 18px;}
      @media(max-width:520px){.ft-hide-sm{display:none;}}

      .ft-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;z-index:50;}
      .ft-modal{background:var(--surface);border:1px solid var(--line);border-radius:15px;width:100%;max-width:410px;max-height:90vh;overflow:auto;box-shadow:0 18px 50px rgba(0,0,0,.5);}
      .ft-modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line);}
      .ft-modal-head h3{margin:0;font-family:'Space Grotesk';font-size:16px;}
      .ft-modal-body{padding:16px;}
      .ft-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;}
      .ft-cfg-list{display:flex;flex-direction:column;gap:7px;margin-top:12px;}
      .ft-cfg{display:flex;justify-content:space-between;align-items:center;padding:9px 11px;background:var(--canvas);border:1px solid var(--line);border-radius:9px;font-size:13px;}
    `}</style>
  );
}
