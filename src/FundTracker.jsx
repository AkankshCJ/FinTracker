import React, { useState, useEffect, useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from "recharts";
import * as XLSX from "xlsx";
import {
  Plus, Wallet, Receipt, LayoutDashboard, ChevronLeft, ChevronRight,
  Trash2, Save, Layers, Sparkles, Settings, X, TrendingUp, PiggyBank,
  Pencil, Eye, EyeOff, Download,
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

// Identity palette — cool hues only, deliberately no green/amber/red
const COLOR_POOL = [
  "#6E92C4", "#8E7CC4", "#C77EA6", "#7C9AD9", "#A88BD0",
  "#6F7FC0", "#B98AC0", "#5C84B5", "#9D7FB8", "#C490A8",
];
// Neutral chart colours
const C_SPENT = "#7FA8D9";   // "spent" series across charts
const C_ALLOC = "#3D4843";   // allocated baseline bars
const C_BUDGET = "#54625C";  // budget reference line
const C_NONE = "#3A4540";    // inert / unallocated bar

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
const STATUS_BAR = { ok: "var(--ok)", low: "var(--warn)", over: "var(--over)", none: C_NONE };

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
  const removeExpense = (id) => { const n = structuredClone(state); n.expenses = n.expenses.filter((e) => e.id !== id); commit(n); };
  const setCurrency = (sym) => { const n = structuredClone(state); n.currency = sym; commit(n); };
  const saveTemplate = (name) => { const n = structuredClone(state); n.configs.push({ id: uid("tpl_"), name, allocations: { ...(month.allocations || {}) } }); commit(n); };
  const applyTemplate = (tpl) => { const n = ensureMonth(structuredClone(state)); const valid = {}; Object.entries(tpl.allocations).forEach(([fid, amt]) => { if (n.funds.some((f) => f.id === fid)) valid[fid] = amt; }); n.months[monthKey].allocations = valid; commit(n); };
  const deleteTemplate = (id) => { const n = structuredClone(state); n.configs = n.configs.filter((c) => c.id !== id); commit(n); };

  return (
    <div className="ft-root">
      <Style />
      <TopBar monthKey={monthKey} setMonthKey={setMonthKey} budget={month.budget} setBudget={setBudget}
        unallocated={unallocated} totalSpent={totalSpent} money={money} currency={cur} setCurrency={setCurrency}
        funds={fundView} budgetNum={Number(month.budget || 0)} openExport={() => setShowExport(true)} />

      <div className="ft-grid">
        <section className="ft-col">
          <SectionHead icon={<Wallet size={15} />} title="Funds" />
          <FundsPanel funds={fundView} unallocated={unallocated} money={money}
            addFund={addFund} updateFund={updateFund} removeFund={removeFund}
            templates={state.configs} saveTemplate={saveTemplate} applyTemplate={applyTemplate}
            deleteTemplate={deleteTemplate} setAllocation={setAllocation} />
        </section>

        <section className="ft-col ft-col-wide">
          <SectionHead icon={<LayoutDashboard size={15} />} title="Dashboard" />
          <Dashboard funds={fundView} months={state.months} allExpenses={state.expenses}
            monthKey={monthKey} budget={Number(month.budget || 0)} totalAllocated={totalAllocated} totalSpent={totalSpent} money={money} />
        </section>

        <section className="ft-col">
          <SectionHead icon={<Receipt size={15} />} title="Expenses" />
          <ExpensesPanel funds={fundsColored} expenses={monthExpenses} money={money} addExpense={addExpense} removeExpense={removeExpense} monthKey={monthKey} />
        </section>
      </div>

      {showExport && (
        <ExportModal funds={fundsColored} months={state.months} allExpenses={state.expenses} money={money} monthKey={monthKey} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function TopBar({ monthKey, setMonthKey, budget, setBudget, unallocated, totalSpent, money, currency, setCurrency, funds, budgetNum, openExport }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(budget);
  const [showSet, setShowSet] = useState(false);
  useEffect(() => setVal(budget), [budget, monthKey]);
  const allocated = funds.filter((f) => f.alloc > 0);
  const denom = Math.max(budgetNum, funds.reduce((s, f) => s + f.alloc, 0)) || 1;

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
          <label className="ft-field-label">Currency symbol</label>
          <input className="ft-input" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />
          <p className="ft-muted" style={{ marginTop: 12, fontSize: 13 }}>Funds appear in every month. Use the arrows to set each month's budget and allocations; everything saves automatically.</p>
        </Modal>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
function FundsPanel({ funds, unallocated, money, addFund, updateFund, removeFund, templates, saveTemplate, applyTemplate, deleteTemplate, setAllocation }) {
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
          const width = st === "over" ? 100 : (f.base > 0 ? Math.min(100, Math.max(0, (f.remaining / f.base) * 100)) : 0);
          const dim = f.base <= 0 && f.spent <= 0;
          return (
            <div key={f.id} className={"ft-fund" + (dim ? " ft-fund-dim" : "")}>
              <div className="ft-fund-top">
                <span className="ft-fund-name"><i className="ft-dot" style={{ background: f.color }} />{f.name}{f.accumulating && <PiggyBank size={11} className="ft-accum-ic" />}</span>
                <span className="ft-fund-tools">
                  <button className="ft-icon-btn ft-icon-mini" onClick={() => setModal({ edit: f })} aria-label="Edit"><Pencil size={11} /></button>
                  <button className="ft-icon-btn ft-icon-mini" onClick={() => removeFund(f.id)} aria-label="Delete"><Trash2 size={12} /></button>
                </span>
              </div>
              <div className="ft-left"><span className={"ft-left-amt ft-amt-" + st}>{money(f.remaining)}</span><span className="ft-left-tag">left</span></div>
              <div className="ft-bar"><div className="ft-bar-fill" style={{ width: width + "%", background: STATUS_BAR[st] }} /></div>
              <div className="ft-fund-foot">
                <span className="ft-alloc-edit"><span className="ft-muted">Alloc</span><AllocInput value={f.alloc} onCommit={(v) => setAllocation(f.id, v)} /></span>
                <span className="ft-muted">{money(f.spent)} spent{f.accumulating ? ` · +${money(f.carried)} in` : ""}</span>
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
          onSubmit={(d) => { if (modal === "add") addFund(d); else updateFund(modal.edit.id, { name: d.name, accumulating: d.accumulating }); setModal(null); }} onClose={() => setModal(null)} />
      )}
      {modal === "tpl" && (
        <TemplatesModal templates={templates} canSave={funds.some((f) => f.alloc > 0)} onSave={saveTemplate} onApply={(t) => { applyTemplate(t); setModal(null); }} onDelete={deleteTemplate} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function AllocInput({ value, onCommit }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="ft-input ft-input-tiny" type="number" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(Number(v) || 0)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

function FundModal({ mode, initial, unallocated, money, onSubmit, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [allocated, setAllocated] = useState("");
  const [accumulating, setAccumulating] = useState(!!initial?.accumulating);
  const submit = () => { if (!name.trim()) return; onSubmit({ name: name.trim(), accumulating, allocated: Number(allocated) || 0 }); };
  return (
    <Modal title={mode === "add" ? "New fund" : "Edit fund"} onClose={onClose}>
      <label className="ft-field-label">Name</label>
      <input className="ft-input" value={name} autoFocus placeholder="e.g. Groceries" onChange={(e) => setName(e.target.value)} />
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
        <button className="ft-btn ft-btn-primary" onClick={submit} disabled={!name.trim()}>{mode === "add" ? "Add fund" : "Save"}</button>
      </div>
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
    const expRows = inRange.map((e) => ({ Date: e.date, Day: WD[dow(e.date)], Expense: e.name, Fund: nameById[e.fundId] || "(deleted fund)", Amount: Number(e.amount) }));
    expRows.push({}); expRows.push({ Date: "", Day: "", Expense: "", Fund: "TOTAL", Amount: total });
    const wsExp = XLSX.utils.json_to_sheet(expRows, { header: ["Date", "Day", "Expense", "Fund", "Amount"] });
    wsExp["!cols"] = [{ wch: 12 }, { wch: 11 }, { wch: 28 }, { wch: 18 }, { wch: 14 }];
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
function ExpensesPanel({ funds, expenses, money, addExpense, removeExpense, monthKey }) {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const minDate = `${monthKey}-01`;
  const maxDate = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  const defaultDate = () => (monthKey === todayKey ? new Date().toISOString().slice(0, 10) : minDate);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [fundId, setFundId] = useState(funds[0]?.id || "");
  const [date, setDate] = useState(defaultDate());
  useEffect(() => { if (!funds.find((f) => f.id === fundId)) setFundId(funds[0]?.id || ""); }, [funds]); // eslint-disable-line
  useEffect(() => { setDate(defaultDate()); }, [monthKey]); // eslint-disable-line

  const submit = () => {
    if (!name.trim() || !amount || !fundId) return;
    const safe = date < minDate ? minDate : date > maxDate ? maxDate : date; // keep inside the month
    addExpense({ name: name.trim(), amount: Number(amount), fundId, date: safe });
    setName(""); setAmount("");
  };
  const fundById = {}; funds.forEach((f) => (fundById[f.id] = f));

  return (
    <div className="ft-panel">
      <div className="ft-addexp">
        {funds.length === 0 ? <div className="ft-empty">Create a fund before adding expenses.</div> : (
          <>
            <input className="ft-input ft-input-sm" placeholder="What was it for?" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="ft-row">
              <input className="ft-input ft-input-sm" type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className="ft-input ft-input-sm" type="date" value={date} min={minDate} max={maxDate} onChange={(e) => setDate(e.target.value)} title="Date is limited to the selected month" />
            </div>
            <div className="ft-row">
              <select className="ft-input ft-input-sm" value={fundId} onChange={(e) => setFundId(e.target.value)}>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
              <button className="ft-btn ft-btn-primary ft-btn-sm" onClick={submit}><Plus size={14} /> Add</button>
            </div>
          </>
        )}
      </div>
      <div className="ft-exp-list">
        {expenses.length === 0 && <div className="ft-empty">No expenses logged this month.</div>}
        {expenses.map((e) => {
          const fund = fundById[e.fundId];
          return (
            <div key={e.id} className="ft-exp">
              <span className="ft-dot" style={{ background: fund?.color || "#666" }} />
              <div className="ft-exp-mid"><span className="ft-exp-name">{e.name}</span><span className="ft-muted ft-exp-meta">{fund ? fund.name : "—"} · {e.date.slice(5)}</span></div>
              <span className="ft-exp-amt">{money(e.amount)}</span>
              <button className="ft-icon-btn ft-icon-mini" onClick={() => removeExpense(e.id)} aria-label="Delete"><X size={12} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Dashboard({ funds, months, allExpenses, monthKey, budget, totalAllocated, totalSpent, money }) {
  const allocByFund = useMemo(() => funds.filter((f) => f.alloc > 0).map((f) => ({ name: f.name, value: f.alloc, color: f.color })), [funds]);
  const barData = useMemo(() => funds.filter((f) => f.alloc > 0 || f.spent > 0).map((f) => ({ name: f.name, Allocated: f.alloc, Spent: f.spent })), [funds]);
  const trend = useMemo(() => {
    const all = new Set(Object.keys(months)); allExpenses.forEach((e) => all.add(e.monthKey)); all.add(monthKey);
    return [...all].sort().slice(-6).map((k) => ({ name: labelOf(k).split(" ")[0].slice(0, 3), Spent: allExpenses.filter((e) => e.monthKey === k).reduce((s, e) => s + Number(e.amount), 0), Budget: Number(months[k]?.budget || 0) }));
  }, [months, allExpenses, monthKey]);
  const insights = useMemo(() => buildInsights({ funds, budget, totalAllocated, totalSpent, monthKey, allExpenses, money }), [funds, budget, totalAllocated, totalSpent, monthKey, allExpenses]); // eslint-disable-line
  const hasData = funds.some((f) => f.alloc > 0) || totalSpent > 0;

  return (
    <div className="ft-dash">
      <div className="ft-stat-row">
        <Stat label="Budget" value={money(budget)} />
        <Stat label="Allocated" value={money(totalAllocated)} />
        <Stat label="Spent" value={money(totalSpent)} />
        <Stat label="% spent" value={budget > 0 ? Math.round((totalSpent / budget) * 100) + "%" : "—"} />
      </div>

      {!hasData ? <div className="ft-empty ft-empty-big">Set a budget, allocate to funds, and log a few expenses — charts and insights appear here.</div> : (
        <>
          {insights.length > 0 && (
            <div className="ft-card ft-insights-card"><div className="ft-subhead"><Sparkles size={12} /> Insights</div><ul className="ft-insights">{insights.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
          )}
          <div className="ft-dash-charts">
            <div className="ft-card">
              <div className="ft-subhead">Allocation by fund</div>
              {allocByFund.length === 0 ? <p className="ft-muted">No allocations yet.</p> : (
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart><Pie data={allocByFund} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>{allocByFund.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}</Pie><Tooltip formatter={(v) => money(v)} contentStyle={TOOLTIP} /></PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="ft-card">
              <div className="ft-subhead">Allocated vs spent</div>
              {barData.length === 0 ? <p className="ft-muted">No data yet.</p> : (
                <ResponsiveContainer width="100%" height={170}>
                  <BarChart data={barData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} />
                    <Tooltip formatter={(v) => money(v)} contentStyle={TOOLTIP} cursor={{ fill: "rgba(255,255,255,.04)" }} />
                    <Bar dataKey="Allocated" fill={C_ALLOC} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Spent" fill={C_SPENT} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="ft-card">
            <div className="ft-subhead"><TrendingUp size={12} /> Spend over time</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <Tooltip formatter={(v) => money(v)} contentStyle={TOOLTIP} />
                <Line type="monotone" dataKey="Budget" stroke={C_BUDGET} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Spent" stroke={C_SPENT} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

const TOOLTIP = { background: "#222B28", border: "1px solid #2E3A35", borderRadius: 8, color: "#E8EDEA", fontSize: 12 };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dowOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };

/* This-month budget insights */
function monthInsights({ funds, budget, totalAllocated, totalSpent, monthKey, allExpenses, money }) {
  const out = [];
  if (budget > 0 && totalAllocated > budget) out.push(`Allocated ${money(totalAllocated - budget)} more than your budget.`);
  else if (budget > 0 && totalAllocated < budget) out.push(`${money(budget - totalAllocated)} of your budget is still unallocated.`);
  const over = funds.filter((f) => f.remaining < 0);
  if (over.length) out.push(`Over budget on: ${over.map((f) => f.name).join(", ")}.`);
  const top = [...funds].sort((a, b) => b.spent - a.spent)[0];
  if (top && top.spent > 0) out.push(`Biggest spend this month: ${top.name} at ${money(top.spent)}.`);
  const prevKey = shiftMonth(monthKey, -1);
  const prevSpent = allExpenses.filter((e) => e.monthKey === prevKey).reduce((s, e) => s + Number(e.amount), 0);
  if (prevSpent > 0 && totalSpent > 0) { const diff = Math.round(((totalSpent - prevSpent) / prevSpent) * 100); if (Math.abs(diff) >= 5) out.push(`Spent ${Math.abs(diff)}% ${diff > 0 ? "more" : "less"} than last month so far.`); }
  if (budget > 0 && totalSpent / budget >= 0.9 && totalSpent <= budget) out.push(`You're at ${Math.round((totalSpent / budget) * 100)}% of your budget.`);
  return out;
}

/* Cross-month day-of-week trend insights, drawn from the full history */
function trendInsights(allExpenses, funds, money) {
  const r = (n) => money(Math.round(n));
  const valid = allExpenses.filter((e) => e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  if (valid.length < 6) return [];
  const nameById = {}; funds.forEach((f) => (nameById[f.id] = f.name));

  // per-fund aggregation by weekday
  const byFund = {};
  valid.forEach((e) => {
    const dow = dowOf(e.date), weekend = dow === 0 || dow === 6, amt = Number(e.amount);
    const f = byFund[e.fundId] = byFund[e.fundId] || { total: 0, count: 0, we: 0, weC: 0, wd: 0, wdC: 0, dow: Array(7).fill(0), dowC: Array(7).fill(0) };
    f.total += amt; f.count++;
    if (weekend) { f.we += amt; f.weC++; } else { f.wd += amt; f.wdC++; }
    f.dow[dow] += amt; f.dowC[dow]++;
  });

  const out = [];
  Object.entries(byFund).forEach(([fid, s]) => {
    const name = nameById[fid]; if (!name || s.count < 5) return;
    // weekend vs weekday (average per purchase)
    if (s.weC >= 2 && s.wdC >= 2) {
      const aWe = s.we / s.weC, aWd = s.wd / s.wdC;
      if (aWe >= 1.4 * aWd) out.push(`${name}: weekend purchases average ${r(aWe)}, higher than ${r(aWd)} on weekdays.`);
      else if (aWd >= 1.4 * aWe) out.push(`${name}: weekday purchases average ${r(aWd)}, higher than ${r(aWe)} on weekends.`);
    }
    // a single weekday dominating the fund's spend
    let mi = 0; s.dow.forEach((v, i) => { if (v > s.dow[mi]) mi = i; });
    const share = s.total > 0 ? s.dow[mi] / s.total : 0;
    const daysUsed = s.dowC.filter((c) => c > 0).length;
    if (share >= 0.4 && daysUsed >= 3 && s.dowC[mi] >= 2) out.push(`${name}: ${WEEKDAYS[mi]}s account for ${Math.round(share * 100)}% of its spending.`);
  });

  // overall heaviest weekday across all funds
  const all = Array(7).fill(0); let tot = 0;
  valid.forEach((e) => { all[dowOf(e.date)] += Number(e.amount); tot += Number(e.amount); });
  if (tot > 0 && valid.length >= 8) { let mi = 0; all.forEach((v, i) => { if (v > all[mi]) mi = i; }); if (all[mi] / tot >= 0.28) out.push(`Across all funds, ${WEEKDAYS[mi]} is your highest-spend day (${Math.round((all[mi] / tot) * 100)}% of all spending).`); }

  return out.slice(0, 5);
}

function buildInsights(args) {
  const month = monthInsights(args);
  const trend = trendInsights(args.allExpenses, args.funds, args.money);
  return [...month, ...trend].slice(0, 9);
}

/* ------------------------------------------------------------------ */
function SectionHead({ icon, title }) { return <div className="ft-sec-head">{icon}<span>{title}</span></div>; }
function Stat({ label, value }) { return <div className="ft-stat"><span className="ft-stat-label">{label}</span><span className="ft-stat-value">{value}</span></div>; }
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
        --ok:#4FB89A; --warn:#E0A458; --over:#E5795F;
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

      .ft-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(210px,1fr) minmax(320px,1.7fr) minmax(210px,1fr);gap:9px;}
      .ft-col{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:11px 12px;overflow-y:auto;min-height:0;}
      .ft-col::-webkit-scrollbar{width:7px;} .ft-col::-webkit-scrollbar-thumb{background:#2E3A35;border-radius:4px;}
      @media(max-width:979px){
        .ft-root{height:auto;}
        .ft-grid{grid-template-columns:1fr 1fr;}
        .ft-grid > section:nth-child(1){order:1;}
        .ft-grid > section:nth-child(3){order:2;}
        .ft-col-wide{order:3;grid-column:1 / -1;}
        .ft-col{overflow:visible;}
      }
      @media(max-width:600px){ .ft-grid{grid-template-columns:1fr;} }

      .ft-sec-head{display:flex;align-items:center;gap:7px;font-family:'Space Grotesk';font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding-bottom:8px;margin-bottom:9px;border-bottom:1px solid var(--line);position:sticky;top:-11px;background:var(--surface);}

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
      .ft-row{display:flex;gap:7px;align-items:center;}
      .ft-row-actions{margin-bottom:11px;flex-wrap:wrap;}
      .ft-add-cat{margin-top:8px;}
      .ft-field-label{display:block;font-size:12px;font-weight:500;color:var(--muted);margin:11px 0 4px;}
      .ft-check{display:flex;gap:7px;align-items:flex-start;font-size:13px;margin-top:14px;cursor:pointer;line-height:1.4;}
      .ft-check input{margin-top:2px;accent-color:var(--accent);}

      .ft-fund-list{display:flex;flex-direction:column;gap:9px;}
      .ft-fund{background:var(--canvas);border:1px solid var(--line);border-radius:10px;padding:9px 10px;}
      .ft-fund-dim{opacity:.6;}
      .ft-fund-top{display:flex;justify-content:space-between;align-items:center;}
      .ft-fund-name{display:flex;align-items:center;gap:6px;font-weight:600;font-size:13.5px;}
      .ft-fund-tools{display:flex;gap:1px;}
      .ft-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none;}
      .ft-accum-ic{color:var(--muted);}
      .ft-left{display:flex;align-items:baseline;gap:5px;margin:3px 0 6px;}
      .ft-left-amt{font-family:'Space Grotesk';font-weight:700;font-size:23px;line-height:1;}
      .ft-left-tag{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
      .ft-bar{height:7px;background:#111817;border-radius:4px;overflow:hidden;margin-bottom:6px;}
      .ft-bar-fill{height:100%;border-radius:4px;transition:width .4s ease,background .2s;}
      .ft-fund-foot{display:flex;justify-content:space-between;align-items:center;font-size:12px;gap:6px;}
      .ft-alloc-edit{display:flex;align-items:center;gap:6px;}
      .ft-toggle{display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:none;border:none;color:var(--accent);font-family:'Inter';font-size:12.5px;font-weight:500;cursor:pointer;padding:4px 0;}
      .ft-toggle:hover{text-decoration:underline;}
      .ft-accum-panel{margin-top:13px;padding-top:11px;border-top:1px solid var(--line);}
      .ft-accum-row{display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;}
      .ft-subhead{display:flex;align-items:center;gap:6px;font-family:'Space Grotesk';font-weight:600;font-size:12.5px;margin-bottom:9px;}

      .ft-addexp{display:flex;flex-direction:column;gap:7px;margin-bottom:12px;}
      .ft-addexp .ft-row .ft-input{flex:1;}
      .ft-exp-list{display:flex;flex-direction:column;}
      .ft-exp{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line);}
      .ft-exp-mid{flex:1;min-width:0;display:flex;flex-direction:column;}
      .ft-exp-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .ft-exp-meta{font-size:11px;}
      .ft-exp-amt{font-family:'Space Grotesk';font-weight:600;font-size:13.5px;}

      .ft-dash{display:flex;flex-direction:column;gap:10px;}
      .ft-stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
      @media(max-width:420px){.ft-stat-row{grid-template-columns:repeat(2,1fr);}}
      .ft-stat{background:var(--canvas);border:1px solid var(--line);border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;}
      .ft-stat-label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);}
      .ft-stat-value{font-family:'Space Grotesk';font-weight:700;font-size:15.5px;}
      .ft-card{background:var(--canvas);border:1px solid var(--line);border-radius:11px;padding:11px;}
      .ft-insights-card .ft-insights{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;font-size:13px;line-height:1.45;}
      .ft-insights li::marker{color:var(--accent);}
      .ft-dash-charts{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
      @media(max-width:560px){.ft-dash-charts{grid-template-columns:1fr;}}

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
