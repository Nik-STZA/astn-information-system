"use client";

import { useState, useTransition, useRef, useCallback } from "react";
import type { Prospect, Client } from "@/lib/data/compliance";
import type { Country, EnforcementAction } from "@/lib/data/data-protection";
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

function DetailRow({ label, value, link }: { label: string; value: string | null | undefined; link?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-sm text-gray-500 w-40 shrink-0">{label}</span>
      {value ? (
        link ? (
          <a href={value.startsWith("http") ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" className="text-sm text-[#C5A059] hover:underline truncate">{value}</a>
        ) : (
          <span className="text-sm text-[#1A1C1E]">{value}</span>
        )
      ) : (
        <span className="text-sm text-gray-400">—</span>
      )}
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

      {/* Document / URL fields for agent review */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documents &amp; URLs for review</div>
        <FormField label="Privacy policy URL">
          <input name="privacy_policy_url" type="url" defaultValue={prospect?.privacy_policy_url ?? ""} className={inputClass} placeholder="https://example.com/privacy" />
        </FormField>
        <FormField label="Terms of service URL">
          <input name="terms_url" type="url" defaultValue={prospect?.terms_url ?? ""} className={inputClass} placeholder="https://example.com/terms" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="LinkedIn URL">
            <input name="linkedin_url" type="url" defaultValue={prospect?.linkedin_url ?? ""} className={inputClass} placeholder="https://linkedin.com/company/..." />
          </FormField>
          <FormField label="App Store / Play Store URL">
            <input name="app_store_url" type="url" defaultValue={prospect?.app_store_url ?? ""} className={inputClass} placeholder="https://apps.apple.com/..." />
          </FormField>
        </div>
        <FormField label="Other review URLs (one per line)">
          <textarea name="other_urls" rows={2} defaultValue={prospect?.other_urls ?? ""} className={inputClass} placeholder="Paste additional URLs for compliance review" />
        </FormField>
      </div>

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

// ─── Prospect detail (read-only slide-out) ─────────────────────────────────

function ProspectDetail({
  prospect,
  onClose,
  onEdit,
  onReport,
}: {
  prospect: Prospect;
  onClose: () => void;
  onEdit: () => void;
  onReport: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-xl overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#1A1C1E]">{prospect.company_name}</h3>
          <div className="flex items-center gap-3">
            <button onClick={onReport} className={btnSecondary}>Assessment</button>
            <button onClick={onEdit} className={btnPrimary}>Edit</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* Status cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg border border-gray-200">
              <Badge value={prospect.priority} map={PRIORITY_COLOURS} />
              <div className="text-xs text-gray-500 mt-2">Priority</div>
            </div>
            <div className="text-center p-3 rounded-lg border border-gray-200">
              <Badge value={prospect.outreach_status} map={STATUS_COLOURS} />
              <div className="text-xs text-gray-500 mt-2">Status</div>
            </div>
            <div className="text-center p-3 rounded-lg border border-gray-200">
              <div className="text-lg">
                {prospect.ir_registered === true ? <span className="text-emerald-600 font-medium">Yes</span>
                  : prospect.ir_registered === false ? <span className="text-red-500 font-medium">No</span>
                  : <span className="text-gray-400">Unknown</span>}
              </div>
              <div className="text-xs text-gray-500 mt-1">IR registered</div>
            </div>
          </div>

          {/* Company details */}
          <div>
            <h4 className="text-sm font-semibold text-[#1A1C1E] mb-3">Company details</h4>
            <div className="space-y-2">
              <DetailRow label="Country" value={prospect.company_country} />
              <DetailRow label="Sector" value={prospect.sector} />
              <DetailRow label="Website" value={prospect.company_website} link />
              <DetailRow label="Estimated tier" value={prospect.estimated_tier} />
            </div>
          </div>

          {/* SA presence */}
          {prospect.sa_presence_evidence && (
            <div>
              <h4 className="text-sm font-semibold text-[#1A1C1E] mb-1">SA presence evidence</h4>
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{prospect.sa_presence_evidence}</p>
            </div>
          )}

          {/* Documents & URLs */}
          {(prospect.privacy_policy_url || prospect.terms_url || prospect.linkedin_url || prospect.app_store_url || prospect.other_urls) && (
            <div>
              <h4 className="text-sm font-semibold text-[#1A1C1E] mb-3">Documents &amp; URLs</h4>
              <div className="space-y-2">
                <DetailRow label="Privacy policy" value={prospect.privacy_policy_url} link />
                <DetailRow label="Terms of service" value={prospect.terms_url} link />
                <DetailRow label="LinkedIn" value={prospect.linkedin_url} link />
                <DetailRow label="App Store" value={prospect.app_store_url} link />
                {prospect.other_urls && (
                  <div>
                    <span className="text-xs text-gray-400">Other URLs</span>
                    <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2 mt-1 space-y-1">
                      {prospect.other_urls.split("\n").filter(Boolean).map((url, i) => (
                        <a key={i} href={url.trim()} target="_blank" rel="noopener noreferrer" className="block text-[#C5A059] hover:underline truncate">{url.trim()}</a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Outreach timeline */}
          <div>
            <h4 className="text-sm font-semibold text-[#1A1C1E] mb-3">Outreach timeline</h4>
            <div className="space-y-2">
              <DetailRow label="Outreach date" value={prospect.outreach_date?.slice(0, 10)} />
              <DetailRow label="Channel" value={prospect.outreach_channel} />
              <DetailRow label="Response date" value={prospect.response_date?.slice(0, 10)} />
            </div>
          </div>

          {/* Notes */}
          {prospect.notes && (
            <div>
              <h4 className="text-sm font-semibold text-[#1A1C1E] mb-1">Notes</h4>
              <p className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{prospect.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Client detail (read-only slide-out) ───────────────────────────────────

function ClientDetail({
  client,
  onClose,
  onEdit,
  onAddActivity,
}: {
  client: Client;
  onClose: () => void;
  onEdit: () => void;
  onAddActivity: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-xl overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#1A1C1E]">{client.company_name}</h3>
          <div className="flex items-center gap-3">
            <button onClick={onAddActivity} className={btnSecondary}>+ Activity</button>
            <button onClick={onEdit} className={btnPrimary}>Edit</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* Status cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg border border-gray-200">
              <Badge value={client.status} map={CLIENT_STATUS_COLOURS} />
              <div className="text-xs text-gray-500 mt-2">Status</div>
            </div>
            <div className="text-center p-3 rounded-lg border border-gray-200">
              <div className="text-lg font-bold text-[#1A1C1E]">{client.service_tier ?? "—"}</div>
              <div className="text-xs text-gray-500 mt-1">Service tier</div>
            </div>
            <div className="text-center p-3 rounded-lg border border-gray-200">
              <div className="text-lg font-bold text-[#1A1C1E]">
                {client.annual_fee_gbp != null ? `£${Number(client.annual_fee_gbp).toLocaleString()}` : "—"}
              </div>
              <div className="text-xs text-gray-500 mt-1">Annual fee</div>
            </div>
          </div>

          {/* Company & contact details */}
          <div>
            <h4 className="text-sm font-semibold text-[#1A1C1E] mb-3">Company details</h4>
            <div className="space-y-2">
              <DetailRow label="Country" value={client.company_country} />
              <DetailRow label="Website" value={client.company_website} link />
              <DetailRow label="Engagement start" value={client.engagement_start?.slice(0, 10)} />
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-[#1A1C1E] mb-3">Contact</h4>
            <div className="space-y-2">
              <DetailRow label="Name" value={client.contact_name} />
              <DetailRow label="Email" value={client.contact_email} />
              <DetailRow label="Role" value={client.contact_role} />
            </div>
          </div>

          {/* Data processing flags */}
          <div>
            <h4 className="text-sm font-semibold text-[#1A1C1E] mb-3">Data processing</h4>
            <div className="flex gap-4">
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-2.5 h-2.5 rounded-full ${client.processes_biometric ? "bg-amber-500" : "bg-gray-300"}`} />
                Biometric data: {client.processes_biometric ? "Yes" : "No"}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-2.5 h-2.5 rounded-full ${client.processes_minors ? "bg-red-500" : "bg-gray-300"}`} />
                Minors' data: {client.processes_minors ? "Yes" : "No"}
              </div>
            </div>
          </div>

          {/* Activity summary */}
          <div>
            <h4 className="text-sm font-semibold text-[#1A1C1E] mb-1">Activities</h4>
            <p className="text-sm text-gray-600">{client.activity_count} activities logged</p>
          </div>

          {/* Notes */}
          {client.notes && (
            <div>
              <h4 className="text-sm font-semibold text-[#1A1C1E] mb-1">Notes</h4>
              <p className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{client.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
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
  countries = [],
  enforcement = [],
}: {
  initialProspects: Prospect[];
  initialClients: Client[];
  countries?: Country[];
  enforcement?: EnforcementAction[];
}) {
  const [tab, setTab] = useState<Tab>("prospects");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState("");

  // Detail panels (read-only first, then edit)
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [reportProspect, setReportProspect] = useState<Prospect | null>(null);

  // Modal state
  const [showProspectForm, setShowProspectForm] = useState(false);
  const [editingProspect, setEditingProspect] = useState<Prospect | undefined>();
  const [showClientForm, setShowClientForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | undefined>();
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [activityClientId, setActivityClientId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  const handleDelete = (id: string) => {
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
                  <tr
                    key={p.id}
                    onClick={() => setSelectedProspect(p)}
                    className={`cursor-pointer hover:bg-[#C5A059]/5 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
                  >
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
                          onClick={(e) => { e.stopPropagation(); setEditingProspect(p); setShowProspectForm(true); }}
                          className="px-2 py-1 text-xs text-[#C5A059] hover:bg-[#C5A059]/10 rounded transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
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
                  <tr
                    key={c.id}
                    onClick={() => setSelectedClient(c)}
                    className={`cursor-pointer hover:bg-[#C5A059]/5 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
                  >
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
                          onClick={(e) => { e.stopPropagation(); setEditingClient(c); setShowClientForm(true); }}
                          className="px-2 py-1 text-xs text-[#C5A059] hover:bg-[#C5A059]/10 rounded transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openAddActivity(c.id); }}
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

      {/* Prospect detail slide-out */}
      {selectedProspect && (
        <ProspectDetail
          prospect={selectedProspect}
          onClose={() => setSelectedProspect(null)}
          onEdit={() => {
            setEditingProspect(selectedProspect);
            setSelectedProspect(null);
            setShowProspectForm(true);
          }}
          onReport={() => {
            setReportProspect(selectedProspect);
            setSelectedProspect(null);
          }}
        />
      )}

      {/* Client detail slide-out */}
      {selectedClient && (
        <ClientDetail
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onEdit={() => {
            setEditingClient(selectedClient);
            setSelectedClient(null);
            setShowClientForm(true);
          }}
          onAddActivity={() => {
            setActivityClientId(selectedClient.id);
            setSelectedClient(null);
            setShowActivityForm(true);
          }}
        />
      )}

      {/* Compliance assessment report */}
      {reportProspect && (
        <ComplianceReport
          prospect={reportProspect}
          country={countries.find(c => c.country_name === "South Africa") ?? null}
          enforcement={enforcement}
          onClose={() => setReportProspect(null)}
        />
      )}
    </div>
  );
}

// ─── Compliance assessment report ───────────────────────────────────────────

function ScoreGauge({ label, score, max = 10 }: { label: string; score: number | null; max?: number }) {
  const pct = score != null ? Math.round((Number(score) / max) * 100) : 0;
  const colour = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-[#1A1C1E]">{score != null ? Number(score).toFixed(1) : "—"}/{max}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

function ComplianceReport({
  prospect,
  country,
  enforcement,
  onClose,
}: {
  prospect: Prospect;
  country: Country | null;
  enforcement: EnforcementAction[];
  onClose: () => void;
}) {
  const reportRef = useRef<HTMLDivElement>(null);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const handleExportPDF = useCallback(() => {
    window.print();
  }, []);

  const tierColour = (tier: string | null) => {
    const t = tier?.toLowerCase();
    if (t === "leader") return "text-emerald-700 bg-emerald-50 border-emerald-200";
    if (t === "advanced") return "text-blue-700 bg-blue-50 border-blue-200";
    if (t === "developing") return "text-amber-700 bg-amber-50 border-amber-200";
    return "text-red-700 bg-red-50 border-red-200";
  };

  const saEnforcement = enforcement.filter(e => e.country_name === "South Africa").slice(0, 5);

  const riskFactors: { factor: string; level: "high" | "medium" | "low"; note: string }[] = [];

  if (prospect.ir_registered === false) {
    riskFactors.push({ factor: "IR registration", level: "high", note: "Not registered with Information Regulator — non-compliance with s55 and IR Guidance Note" });
  } else if (prospect.ir_registered === null) {
    riskFactors.push({ factor: "IR registration", level: "medium", note: "Registration status unknown — verification required" });
  } else {
    riskFactors.push({ factor: "IR registration", level: "low", note: "Registered with Information Regulator" });
  }

  if (prospect.sa_presence_evidence) {
    riskFactors.push({ factor: "SA presence", level: "high", note: `Evidence of SA data processing: ${prospect.sa_presence_evidence}` });
  } else {
    riskFactors.push({ factor: "SA presence", level: "medium", note: "SA presence not yet evidenced — investigation needed" });
  }

  if (prospect.sector === "Sports Technology") {
    riskFactors.push({ factor: "Sector sensitivity", level: "high", note: "Sports tech — likely processes biometric, performance, and potentially minors' data" });
  } else if (prospect.sector) {
    riskFactors.push({ factor: "Sector sensitivity", level: "medium", note: `${prospect.sector} — sector-specific data processing risks apply` });
  }

  const riskColour = { high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-800", low: "bg-emerald-100 text-emerald-700" };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4" id="compliance-report-overlay">
      {/* Print styles — proper paged document with running header/footer */}
      <style>{`
        @media print {
          /* Page setup */
          @page {
            size: A4;
            margin: 20mm 18mm 25mm 18mm;
          }

          /* Hide everything except the report */
          body > *:not(#compliance-report-overlay),
          nav, aside, header, [data-topnav], [data-sidebar],
          .print\\:hidden { display: none !important; }

          body { background: white !important; }

          /* Reset overlay to normal flow */
          #compliance-report-overlay {
            position: static !important;
            background: none !important;
            padding: 0 !important;
            overflow: visible !important;
            z-index: auto !important;
            display: block !important;
          }

          /* Report container — full width, no shadow */
          #compliance-report-content {
            max-width: none !important;
            width: 100% !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }

          /* Running header — position:fixed repeats on every printed page in Chrome */
          .print-running-header {
            display: flex !important;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            padding: 0 0 4pt 0;
            border-bottom: 1pt solid #D4C5A9;
            font-size: 7pt;
            color: #8E9196;
            justify-content: space-between;
            z-index: 1000;
          }

          /* Running footer — repeats on every printed page */
          .print-running-footer {
            display: flex !important;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 4pt 0 0 0;
            border-top: 1pt solid #D4C5A9;
            font-size: 7pt;
            color: #8E9196;
            justify-content: space-between;
            z-index: 1000;
          }

          /* Print header — lighter version, no full-bleed dark band */
          .report-header-print {
            background: #F5F0E8 !important;
            color: #1A1C1E !important;
            border-bottom: 2pt solid #C5A059;
            border-radius: 0 !important;
          }
          .report-header-print .header-subtitle { color: #8E9196 !important; }
          .report-header-print .header-brand { color: #C5A059 !important; }
          .report-header-print .header-title { color: #1A1C1E !important; }
          .report-header-print .header-label { color: #1A1C1E !important; }

          /* Pagination — avoid breaks inside sections, cards, rows */
          section { break-inside: avoid; }
          .risk-card, .obligation-card, .step-card, .landscape-card {
            break-inside: avoid;
          }
          tr { break-inside: avoid; }
          thead { display: table-header-group; }

          /* Un-truncate all text */
          .truncate, [class*="truncate"] {
            overflow: visible !important;
            text-overflow: unset !important;
            white-space: normal !important;
          }

          /* Ensure enforcement descriptions show fully */
          .enforcement-desc {
            overflow: visible !important;
            white-space: normal !important;
          }

          /* Keep disclaimer on same page as footer content */
          .report-disclaimer { break-inside: avoid; }
        }

        /* Hide running header/footer on screen */
        @media screen {
          .print-running-header, .print-running-footer { display: none !important; }
        }
      `}</style>

      {/* Print-hidden controls */}
      <div className="fixed top-4 right-4 z-[70] flex gap-2 print:hidden">
        <button onClick={handleExportPDF} className={btnPrimary}>Download PDF</button>
        <button onClick={onClose} className={btnSecondary}>Close</button>
      </div>

      {/* Running header — repeats on every printed page via position:fixed */}
      <div className="print-running-header" style={{ fontFamily: "Calibri, sans-serif" }}>
        <span><strong style={{ color: "#C5A059" }}>AfricanSTN</strong> &middot; POPIA Compliance Assessment &middot; {prospect.company_name}</span>
        <span>Confidential</span>
      </div>

      {/* Running footer — repeats on every printed page */}
      <div className="print-running-footer" style={{ fontFamily: "Calibri, sans-serif" }}>
        <span>Prepared {today} &middot; AfricanSTN POPIA Representative Services</span>
        <span>africastn.com</span>
      </div>

      {/* Report */}
      <div ref={reportRef} id="compliance-report-content" className="bg-white rounded-lg shadow-2xl w-full max-w-3xl print:shadow-none print:max-w-none print:rounded-none" style={{ fontFamily: "Calibri, sans-serif" }}>
        {/* Header */}
        <div className="report-header-print bg-[#1A1C1E] text-white px-8 py-6 rounded-t-lg print:rounded-none">
          <div className="flex items-start justify-between">
            <div>
              <div className="header-label text-xs uppercase tracking-widest text-[#C5A059] mb-1">POPIA Compliance Assessment</div>
              <h1 className="header-title text-2xl font-bold">{prospect.company_name}</h1>
              <div className="header-subtitle text-sm text-gray-400 mt-1">{prospect.sector ?? "Sector unclassified"} &middot; {prospect.company_country ?? "Country unknown"}</div>
            </div>
            <div className="text-right">
              <div className="header-subtitle text-xs text-gray-400">Prepared by</div>
              <div className="header-brand text-sm font-medium text-[#C5A059]">AfricanSTN</div>
              <div className="header-subtitle text-xs text-gray-400 mt-1">{today}</div>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Executive summary */}
          <section>
            <h2 className="text-sm font-bold text-[#1A1C1E] uppercase tracking-wide border-b border-gray-200 pb-1 mb-3">Executive summary</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              This assessment evaluates <strong>{prospect.company_name}</strong>&apos;s compliance position under South Africa&apos;s
              Protection of Personal Information Act (POPIA). As an international {prospect.sector?.toLowerCase() ?? "technology"} company
              {prospect.sa_presence_evidence ? ` with evidence of South African data processing (${prospect.sa_presence_evidence.toLowerCase()})` : ""},
              the company is subject to POPIA's extraterritorial provisions under Section 3(1)(b)(ii). The Information
              Regulator requires non-South African responsible parties to appoint a local Information Officer.
            </p>
          </section>

          {/* Risk assessment */}
          <section>
            <h2 className="text-sm font-bold text-[#1A1C1E] uppercase tracking-wide border-b border-gray-200 pb-1 mb-3">Risk assessment</h2>
            <div className="space-y-2">
              {riskFactors.map((r, i) => (
                <div key={i} className="risk-card flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                  <span className={`inline-block px-2 rounded text-xs font-medium shrink-0 ${riskColour[r.level]}`} style={{ lineHeight: "20px", height: "20px", marginTop: "1px" }}>
                    {r.level}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-[#1A1C1E]">{r.factor}</div>
                    <div className="text-xs text-gray-600">{r.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* SA regulatory landscape */}
          {country && (
            <section>
              <h2 className="text-sm font-bold text-[#1A1C1E] uppercase tracking-wide border-b border-gray-200 pb-1 mb-3">
                South Africa — regulatory landscape
              </h2>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="landscape-card p-3 rounded-lg border border-gray-200 text-center">
                  <div className={`inline-block px-3 rounded-full text-sm font-bold border ${tierColour(country.tier)}`} style={{ lineHeight: "28px", height: "28px" }}>
                    {country.tier ?? "—"}
                  </div>
                  <div className="text-xs text-gray-500 mt-2">DPMI tier</div>
                </div>
                <div className="landscape-card p-3 rounded-lg border border-gray-200 text-center">
                  <div className="text-xl font-bold text-[#1A1C1E]">{country.overall_score != null ? Number(country.overall_score).toFixed(1) : "—"}</div>
                  <div className="text-xs text-gray-500 mt-1">DPMI score /10</div>
                </div>
                <div className="landscape-card p-3 rounded-lg border border-gray-200 text-center">
                  <div className="text-sm font-medium text-[#1A1C1E]">{country.law_name ?? "POPIA"}</div>
                  <div className="text-xs text-gray-500 mt-1">{country.law_year ?? "2013"}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <DetailRow label="Regulator" value={country.authority_name} />
                <DetailRow label="Breach notification" value={country.breach_notification_detail ? `Yes — ${country.breach_notification_detail}` : (country.breach_notification_hours ? `Yes (${country.breach_notification_hours}h)` : "No")} />
                <DetailRow label="Transfer mechanism" value={country.transfer_mechanisms} />
                <DetailRow label="Max penalty" value={country.max_fine_description} />
              </div>
            </section>
          )}

          {/* Enforcement snapshot */}
          {saEnforcement.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-[#1A1C1E] uppercase tracking-wide border-b border-gray-200 pb-1 mb-3">
                Recent enforcement actions — South Africa
              </h2>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Entity</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saEnforcement.map((e) => (
                      <tr key={e.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{e.action_date?.slice(0, 10) ?? "—"}</td>
                        <td className="px-3 py-2 text-gray-700 font-medium">{e.target_entity ?? "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{e.action_type}</td>
                        <td className="enforcement-desc px-3 py-2 text-gray-600">{e.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* POPIA obligations summary */}
          <section>
            <h2 className="text-sm font-bold text-[#1A1C1E] uppercase tracking-wide border-b border-gray-200 pb-1 mb-3">
              Key POPIA obligations for international companies
            </h2>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                { title: "Information Officer", desc: "Appoint and register with IR (s55–56). International entities must designate a local representative." },
                { title: "Lawful processing", desc: "Personal information must be processed lawfully for a defined purpose with data subject consent or another s11 ground." },
                { title: "Cross-border transfers", desc: "s72 requires adequate protection in recipient country, binding corporate rules, or data subject consent." },
                { title: "Data subject rights", desc: "Right to access, correction, deletion of personal information. Respond within 30 days of request." },
                { title: "Breach notification", desc: "Notify IR and affected data subjects as soon as reasonably possible after becoming aware of a breach." },
                { title: "Special categories", desc: "Biometric data, children’s data, and health data require explicit consent and additional safeguards." },
              ].map((item, i) => (
                <div key={i} className="obligation-card p-3 bg-gray-50 rounded-lg">
                  <div className="font-semibold text-[#1A1C1E] mb-1">{item.title}</div>
                  <div className="text-gray-600 leading-relaxed">{item.desc}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Recommended next steps */}
          <section>
            <h2 className="text-sm font-bold text-[#1A1C1E] uppercase tracking-wide border-b border-gray-200 pb-1 mb-3">
              Recommended next steps
            </h2>
            <div className="space-y-2 text-sm text-gray-700">
              <div className="step-card flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#C5A059] text-white text-xs shrink-0" style={{ lineHeight: "24px", textAlign: "center", display: "inline-block" }}>1</span>
                <span><strong>Gap assessment:</strong> Full review of current data processing activities involving South African personal information.</span>
              </div>
              <div className="step-card flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#C5A059] text-white text-xs shrink-0" style={{ lineHeight: "24px", textAlign: "center", display: "inline-block" }}>2</span>
                <span><strong>IR registration:</strong> Appoint a POPIA representative and register with the Information Regulator.</span>
              </div>
              <div className="step-card flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#C5A059] text-white text-xs shrink-0" style={{ lineHeight: "24px", textAlign: "center", display: "inline-block" }}>3</span>
                <span><strong>Policy alignment:</strong> Update privacy policies, data processing agreements, and cross-border transfer mechanisms.</span>
              </div>
              <div className="step-card flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#C5A059] text-white text-xs shrink-0" style={{ lineHeight: "24px", textAlign: "center", display: "inline-block" }}>4</span>
                <span><strong>Ongoing compliance:</strong> Establish breach notification procedures and data subject request handling processes.</span>
              </div>
            </div>
          </section>

          {/* Footer */}
          <div className="report-disclaimer border-t border-gray-200 pt-4 mt-6">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <div>
                <span className="font-medium text-[#C5A059]">AfricanSTN</span> &middot; POPIA Representative Services
              </div>
              <div>Confidential — prepared for {prospect.company_name}</div>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 leading-relaxed">
              This document is for informational purposes only and does not constitute legal advice.
              AfricanSTN recommends engaging qualified legal counsel for jurisdiction-specific compliance guidance.
              The DPMI (Data Protection Maturity Index) is AfricanSTN&apos;s proprietary scoring framework that
              rates African jurisdictions across regulatory maturity, enforcement activity, and cross-border complexity.
              Data sourced from DLA Piper, Bowmans, and public regulatory records.
            </p>
          </div>
        </div>
      </div>
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
