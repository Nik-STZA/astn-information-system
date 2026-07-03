"use client";

import { useState, useTransition, useRef } from "react";
import type { Prospect, Client } from "@/lib/data/compliance";
import {
  addProspect,
  editProspect,
  removeProspect,
  addClient,
  editClient,
  addActivity,
} from "./actions";

// ─── Constants ──────────────────────────────────────────────────────────────

const SECTORS = [
  "SaaS and Cloud",
  "Streaming and Media",
  "E-Commerce",
  "Financial Services",
  "AdTech and Data",
  "NGO and Foundation",
  "Sports Technology",
];

const STATUSES = [
  "identified",
  "researched",
  "contacted",
  "responded",
  "converted",
  "declined",
];

const PRIORITIES = ["high", "medium", "low"];

const CLIENT_STATUSES = ["prospect", "onboarding", "engaged", "paused", "churned"];

const SERVICE_TIERS = ["essential", "professional", "enterprise"];

const STATUS_COLOURS: Record<string, string> = {
  identified: "bg-gray-100 text-gray-700",
  researched: "bg-blue-100 text-blue-800",
  contacted: "bg-amber-100 text-amber-800",
  responded: "bg-emerald-100 text-emerald-800",
  converted: "bg-[#C5A059]/20 text-[#8B7340]",
  declined: "bg-red-100 text-red-700",
};

const PRIORITY_COLOURS: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-gray-100 text-gray-600",
};

const CLIENT_STATUS_COLOURS: Record<string, string> = {
  prospect: "bg-gray-100 text-gray-700",
  onboarding: "bg-blue-100 text-blue-800",
  engaged: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  churned: "bg-red-100 text-red-700",
};

// ─── Shared components ──────────────────────────────────────────────────────

function Badge({ value, map }: { value: string | null; map: Record<string, string> }) {
  if (!value) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[value] ?? "bg-gray-100 text-gray-700"}`}>
      {value}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-2xl font-bold text-[#1A1C1E]">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C5A059] focus:border-transparent";
const selectClass = inputClass;
const btnPrimary = "px-4 py-2 bg-[#C5A059] text-[#1A1C1E] text-sm font-medium rounded hover:bg-[#b8933f] transition-colors";
const btnSecondary = "px-4 py-2 border border-gray-300 text-sm rounded hover:bg-gray-50 transition-colors";
const btnDanger = "px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded transition-colors";

// ─── Modal ──────────────────────────────────────────────────────────────────

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-[#1A1C1E]">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Prospect form ──────────────────────────────────────────────────────────

function ProspectForm({
  prospect,
  onClose,
}: {
  prospect?: Prospect;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      if (prospect) {
        await editProspect(prospect.id, fd);
      } else {
        await addProspect(fd);
      }
      onClose();
    });
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Company name *">
          <input name="company_name" required defaultValue={prospect?.company_name ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Website">
          <input name="company_website" defaultValue={prospect?.company_website ?? ""} placeholder="https://" className={inputClass} />
        </FormField>
        <FormField label="Country">
          <input name="company_country" defaultValue={prospect?.company_country ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Sector">
          <select name="sector" defaultValue={prospect?.sector ?? ""} className={selectClass}>
            <option value="">Select...</option>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="Priority">
          <select name="priority" defaultValue={prospect?.priority ?? "medium"} className={selectClass}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </FormField>
        <FormField label="Outreach status">
          <select name="outreach_status" defaultValue={prospect?.outreach_status ?? "identified"} className={selectClass}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="IR registered">
          <select name="ir_registered" defaultValue={prospect?.ir_registered === true ? "true" : prospect?.ir_registered === false ? "false" : ""} className={selectClass}>
            <option value="">Unknown</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </FormField>
        <FormField label="Estimated tier">
          <select name="estimated_tier" defaultValue={prospect?.estimated_tier ?? ""} className={selectClass}>
            <option value="">Select...</option>
            {SERVICE_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
      </div>
      <FormField label="SA presence evidence">
        <input name="sa_presence_evidence" defaultValue={prospect?.sa_presence_evidence ?? ""} className={inputClass} placeholder="e.g. App available on SA App Store" />
      </FormField>
      <FormField label="Notes">
        <textarea name="notes" rows={3} defaultValue={prospect?.notes ?? ""} className={inputClass} />
      </FormField>
      {prospect && (
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Outreach date">
            <input type="date" name="outreach_date" defaultValue={prospect.outreach_date?.slice(0, 10) ?? ""} className={inputClass} />
          </FormField>
          <FormField label="Channel">
            <input name="outreach_channel" defaultValue={prospect.outreach_channel ?? ""} className={inputClass} placeholder="e.g. Email, LinkedIn" />
          </FormField>
          <FormField label="Response date">
            <input type="date" name="response_date" defaultValue={prospect.response_date?.slice(0, 10) ?? ""} className={inputClass} />
          </FormField>
        </div>
      )}
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
        <button type="submit" disabled={isPending} className={btnPrimary}>
          {isPending ? "Saving..." : prospect ? "Update prospect" : "Add prospect"}
        </button>
      </div>
    </form>
  );
}

// ─── Client form ────────────────────────────────────────────────────────────

function ClientForm({
  client,
  onClose,
}: {
  client?: Client;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      if (client) {
        await editClient(client.id, fd);
      } else {
        await addClient(fd);
      }
      onClose();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Company name *">
          <input name="company_name" required defaultValue={client?.company_name ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Website">
          <input name="company_website" defaultValue={client?.company_website ?? ""} placeholder="https://" className={inputClass} />
        </FormField>
        <FormField label="Country">
          <input name="company_country" defaultValue={client?.company_country ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Status">
          <select name="status" defaultValue={client?.status ?? "prospect"} className={selectClass}>
            {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="Contact name">
          <input name="contact_name" defaultValue={client?.contact_name ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Contact email">
          <input name="contact_email" type="email" defaultValue={client?.contact_email ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Contact role">
          <input name="contact_role" defaultValue={client?.contact_role ?? ""} className={inputClass} placeholder="e.g. DPO, Legal Counsel" />
        </FormField>
        <FormField label="Service tier">
          <select name="service_tier" defaultValue={client?.service_tier ?? ""} className={selectClass}>
            <option value="">Select...</option>
            {SERVICE_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label="Annual fee (GBP)">
          <input name="annual_fee_gbp" type="number" step="0.01" defaultValue={client?.annual_fee_gbp ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Engagement start">
          <input name="engagement_start" type="date" defaultValue={client?.engagement_start?.slice(0, 10) ?? ""} className={inputClass} />
        </FormField>
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="processes_biometric" value="true" defaultChecked={client?.processes_biometric ?? false} className="rounded" />
          Processes biometric data
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="processes_minors" value="true" defaultChecked={client?.processes_minors ?? false} className="rounded" />
          Processes minors' data
        </label>
      </div>
      <FormField label="Notes">
        <textarea name="notes" rows={3} defaultValue={client?.notes ?? ""} className={inputClass} />
      </FormField>
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
        <button type="submit" disabled={isPending} className={btnPrimary}>
          {isPending ? "Saving..." : client ? "Update client" : "Add client"}
        </button>
      </div>
    </form>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

type Tab = "prospects" | "clients";

export default function ComplianceClient({
  initialProspects,
  initialClients,
}: {
  initialProspects: Prospect[];
  initialClients: Client[];
}) {
  const [tab, setTab] = useState<Tab>("prospects");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState("");

  // Modal state
  const [showProspectForm, setShowProspectForm] = useState(false);
  const [editingProspect, setEditingProspect] = useState<Prospect | undefined>();
  const [showClientForm, setShowClientForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | undefined>();
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [activityClientId, setActivityClientId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  // Derived data
  const prospects = initialProspects;
  const clients = initialClients;

  const filteredProspects = prospects.filter((p) => {
    if (search && !p.company_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (sectorFilter && p.sector !== sectorFilter) return false;
    if (statusFilter && p.outreach_status !== statusFilter) return false;
    if (priorityFilter && p.priority !== priorityFilter) return false;
    return true;
  });

  const filteredClients = clients.filter((c) => {
    if (search && !c.company_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (clientStatusFilter && c.status !== clientStatusFilter) return false;
    return true;
  });

  const activeClients = clients.filter((c) => c.status === "engaged");
  const arr = activeClients.reduce((s, c) => s + (c.annual_fee_gbp ?? 0), 0);

  const byStatus = prospects.reduce((acc, p) => {
    acc[p.outreach_status] = (acc[p.outreach_status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const bySector = prospects.reduce((acc, p) => {
    if (p.sector) acc[p.sector] = (acc[p.sector] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleDelete = (id: number) => {
    if (!confirm("Delete this prospect? This cannot be undone.")) return;
    setDeletingId(id);
    startTransition(async () => {
      await removeProspect(id);
      setDeletingId(null);
    });
  };

  const openAddActivity = (clientId: number) => {
    setActivityClientId(clientId);
    setShowActivityForm(true);
  };

  return (
    <div className="space-y-8" style={{ fontFamily: "Calibri, sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1C1E]">Compliance services</h1>
          <p className="text-sm text-gray-500 mt-1">
            POPIA representative pipeline &middot; {prospects.length} prospects &middot; {clients.length} clients
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setEditingProspect(undefined); setShowProspectForm(true); }} className={btnPrimary}>
            + Add prospect
          </button>
          <button onClick={() => { setEditingClient(undefined); setShowClientForm(true); }} className={btnSecondary}>
            + Add client
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total prospects" value={prospects.length.toString()} />
        <StatCard label="High priority" value={prospects.filter((p) => p.priority === "high").length.toString()} />
        <StatCard label="Contacted" value={(byStatus["contacted"] ?? 0).toString()} />
        <StatCard label="Active clients" value={activeClients.length.toString()} />
        <StatCard label="ARR (GBP)" value={`£${arr.toLocaleString()}`} />
      </div>

      {/* Outreach funnel */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">Outreach funnel</h2>
        <div className="flex flex-wrap gap-3">
          {STATUSES.filter(s => s !== "declined").map((status) => (
            <button
              key={status}
              onClick={() => { setTab("prospects"); setStatusFilter(statusFilter === status ? "" : status); }}
              className={`px-4 py-2 rounded-lg border text-center min-w-[100px] transition-colors ${
                statusFilter === status ? "border-[#C5A059] bg-[#C5A059]/10" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="text-xl font-bold text-[#1A1C1E]">{byStatus[status] ?? 0}</div>
              <Badge value={status} map={STATUS_COLOURS} />
            </button>
          ))}
        </div>
      </section>

      {/* Sector breakdown */}
      <section>
        <h2 className="text-lg font-semibold text-[#1A1C1E] mb-3">Prospects by sector</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(bySector)
            .sort((a, b) => b[1] - a[1])
            .map(([sector, count]) => (
              <button
                key={sector}
                onClick={() => { setTab("prospects"); setSectorFilter(sectorFilter === sector ? "" : sector); }}
                className={`px-3 py-1.5 border rounded-lg text-sm transition-colors ${
                  sectorFilter === sector ? "border-[#C5A059] bg-[#C5A059]/10" : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <span className="font-medium text-[#1A1C1E]">{count}</span>
                <span className="text-gray-500 ml-1">{sector}</span>
              </button>
            ))}
        </div>
      </section>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["prospects", "clients"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-[#C5A059] text-[#1A1C1E]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "prospects" ? `Prospects (${filteredProspects.length})` : `Clients (${filteredClients.length})`}
          </button>
        ))}
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search by company name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#C5A059]"
        />
        {tab === "prospects" && (
          <>
            <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
              <option value="">All sectors</option>
              {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
              <option value="">All priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </>
        )}
        {tab === "clients" && (
          <select value={clientStatusFilter} onChange={(e) => setClientStatusFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">All statuses</option>
            {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {(search || sectorFilter || statusFilter || priorityFilter || clientStatusFilter) && (
          <button
            onClick={() => { setSearch(""); setSectorFilter(""); setStatusFilter(""); setPriorityFilter(""); setClientStatusFilter(""); }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Prospects table */}
      {tab === "prospects" && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1A1C1E] text-white">
                <th className="px-3 py-2 text-left font-medium">Company</th>
                <th className="px-3 py-2 text-left font-medium">Country</th>
                <th className="px-3 py-2 text-left font-medium">Sector</th>
                <th className="px-3 py-2 text-left font-medium">Priority</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">IR reg.</th>
                <th className="px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProspects.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No prospects match your filters</td></tr>
              ) : (
                filteredProspects.map((p, i) => (
                  <tr key={p.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#1A1C1E]">{p.company_name}</div>
                      {p.company_website && (
                        <div className="text-xs text-gray-400 truncate max-w-[200px]">{p.company_website}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{p.company_country ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{p.sector ?? "—"}</td>
                    <td className="px-3 py-2"><Badge value={p.priority} map={PRIORITY_COLOURS} /></td>
                    <td className="px-3 py-2"><Badge value={p.outreach_status} map={STATUS_COLOURS} /></td>
                    <td className="px-3 py-2 text-center">
                      {p.ir_registered === true ? <span className="text-emerald-600">Yes</span>
                        : p.ir_registered === false ? <span className="text-red-500">No</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setEditingProspect(p); setShowProspectForm(true); }}
                          className="px-2 py-1 text-xs text-[#C5A059] hover:bg-[#C5A059]/10 rounded transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          disabled={deletingId === p.id}
                          className={btnDanger}
                        >
                          {deletingId === p.id ? "..." : "Del"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Clients table */}
      {tab === "clients" && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1A1C1E] text-white">
                <th className="px-3 py-2 text-left font-medium">Company</th>
                <th className="px-3 py-2 text-left font-medium">Contact</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Tier</th>
                <th className="px-3 py-2 text-left font-medium">Annual fee</th>
                <th className="px-3 py-2 text-left font-medium">Activities</th>
                <th className="px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                  {clients.length === 0 ? "No clients yet — convert a prospect or add one directly" : "No clients match your filters"}
                </td></tr>
              ) : (
                filteredClients.map((c, i) => (
                  <tr key={c.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#1A1C1E]">{c.company_name}</div>
                      {c.company_website && <div className="text-xs text-gray-400 truncate max-w-[180px]">{c.company_website}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-gray-700">{c.contact_name ?? "—"}</div>
                      {c.contact_email && <div className="text-xs text-gray-400">{c.contact_email}</div>}
                    </td>
                    <td className="px-3 py-2"><Badge value={c.status} map={CLIENT_STATUS_COLOURS} /></td>
                    <td className="px-3 py-2 text-gray-600">{c.service_tier ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {c.annual_fee_gbp != null ? `£${c.annual_fee_gbp.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{c.activity_count}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setEditingClient(c); setShowClientForm(true); }}
                          className="px-2 py-1 text-xs text-[#C5A059] hover:bg-[#C5A059]/10 rounded transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => openAddActivity(c.id)}
                          className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          + Activity
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Prospect modal */}
      <Modal
        open={showProspectForm}
        onClose={() => setShowProspectForm(false)}
        title={editingProspect ? "Edit prospect" : "Add prospect"}
      >
        <ProspectForm
          prospect={editingProspect}
          onClose={() => setShowProspectForm(false)}
        />
      </Modal>

      {/* Client modal */}
      <Modal
        open={showClientForm}
        onClose={() => setShowClientForm(false)}
        title={editingClient ? "Edit client" : "Add client"}
      >
        <ClientForm
          client={editingClient}
          onClose={() => setShowClientForm(false)}
        />
      </Modal>

      {/* Activity modal */}
      <Modal
        open={showActivityForm}
        onClose={() => setShowActivityForm(false)}
        title="Log activity"
      >
        <ActivityForm
          clientId={activityClientId!}
          onClose={() => setShowActivityForm(false)}
        />
      </Modal>
    </div>
  );
}

// ─── Activity form ──────────────────────────────────────────────────────────

function ActivityForm({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("client_id", clientId.toString());
    startTransition(async () => {
      await addActivity(fd);
      onClose();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Activity type *">
          <select name="activity_type" required className={selectClass}>
            <option value="">Select...</option>
            <option value="registration">Registration filed</option>
            <option value="assessment">Compliance assessment</option>
            <option value="policy_review">Policy review</option>
            <option value="training">Training delivered</option>
            <option value="breach_response">Breach response</option>
            <option value="regulator_correspondence">Regulator correspondence</option>
            <option value="client_meeting">Client meeting</option>
            <option value="report">Report delivered</option>
            <option value="other">Other</option>
          </select>
        </FormField>
        <FormField label="Date">
          <input type="date" name="activity_date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </FormField>
        <FormField label="Hours spent">
          <input type="number" name="hours_spent" step="0.25" min="0" className={inputClass} />
        </FormField>
        <FormField label="Performed by">
          <input name="performed_by" className={inputClass} />
        </FormField>
      </div>
      <FormField label="Description *">
        <textarea name="description" required rows={3} className={inputClass} />
      </FormField>
      <FormField label="Next due date">
        <input type="date" name="next_due" className={inputClass} />
      </FormField>
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
        <button type="submit" disabled={isPending} className={btnPrimary}>
          {isPending ? "Saving..." : "Log activity"}
        </button>
      </div>
    </form>
  );
}
