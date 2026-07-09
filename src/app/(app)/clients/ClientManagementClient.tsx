"use client";

import { useState, useTransition } from "react";
import type { Client } from "@/lib/data/compliance";
import type {
  Engagement, IORegistration, BreachIncident,
  ComplianceTask, Correspondence, ClientManagementSummary,
} from "@/lib/data/client-management";
import {
  addEngagement, editEngagement, removeEngagement,
  addRegistration, editRegistration, removeRegistration,
  addBreach, editBreach, removeBreach,
  addTask, editTask, removeTask,
  addCorrespondence, editCorrespondence, removeCorrespondence,
} from "./actions";

// ─── Shared styles (matching compliance module) ─────────────────────────────

const inputClass =
  "w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C5A059] focus:border-transparent";
const selectClass = inputClass;
const btnPrimary =
  "px-4 py-2 bg-[#C5A059] text-[#1A1C1E] text-sm font-medium rounded hover:bg-[#b8933f] transition-colors";
const btnSecondary =
  "px-4 py-2 border border-gray-300 text-sm rounded hover:bg-gray-50 transition-colors";
const btnDanger =
  "px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded transition-colors";
const btnSmall =
  "px-3 py-1.5 text-xs bg-[#C5A059] text-[#1A1C1E] font-medium rounded hover:bg-[#b8933f] transition-colors";

// ─── Shared UI components ───────────────────────────────────────────────────

function Badge({ label, colour }: { label: string; colour: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colour}`}
    >
      {label}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
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

function Modal({
  title, children, onClose,
}: {
  title: string; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-[#1A1C1E]">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            &times;
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Status colour maps ─────────────────────────────────────────────────────

const engagementColour: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  signed: "bg-indigo-100 text-indigo-700",
  active: "bg-green-100 text-green-700",
  suspended: "bg-amber-100 text-amber-700",
  terminated: "bg-red-100 text-red-700",
};
const regColour: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  confirmed: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  deregistered: "bg-gray-200 text-gray-600",
};
const taskColour: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-gray-200 text-gray-600",
};
const severityColour: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};
const urgencyColour: Record<string, string> = {
  normal: "bg-gray-100 text-gray-700",
  urgent: "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-700",
};

const tierLabel: Record<string, string> = {
  representative: "Tier 1 — Representative",
  authorised_io: "Tier 2 — Authorised IO",
};

// ─── Date formatting (27 May 2026 style per brand rules) ────────────────────

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtCurrency(v: number | null, symbol = "£"): string {
  if (v === null || v === undefined) return "—";
  return `${symbol}${v.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
}

// ─── Tabs for client detail ─────────────────────────────────────────────────

type Tab = "engagements" | "registrations" | "breaches" | "tasks" | "correspondence";

const TABS: { key: Tab; label: string }[] = [
  { key: "engagements", label: "Engagements" },
  { key: "registrations", label: "IO registrations" },
  { key: "tasks", label: "Tasks" },
  { key: "breaches", label: "Breaches" },
  { key: "correspondence", label: "Correspondence" },
];

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

type Props = {
  initialClients: Client[];
  initialTasks: ComplianceTask[];
  initialCorrespondence: Correspondence[];
  summary: ClientManagementSummary | null;
};

export default function ClientManagementClient({
  initialClients, initialTasks, initialCorrespondence, summary,
}: Props) {
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("engagements");

  // Per-client detail data (loaded on click)
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [registrations, setRegistrations] = useState<IORegistration[]>([]);
  const [breaches, setBreaches] = useState<BreachIncident[]>([]);
  const [clientTasks, setClientTasks] = useState<ComplianceTask[]>([]);
  const [clientCorrespondence, setClientCorrespondence] = useState<Correspondence[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal state
  const [modal, setModal] = useState<{
    type: Tab;
    mode: "add" | "edit";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    item?: any;
  } | null>(null);

  const [isPending, startTransition] = useTransition();

  // Active clients (status = active, onboarding, or signed engagement)
  const activeClients = initialClients.filter(
    (c) => c.status === "active" || c.status === "onboarding"
  );

  // ─── Load client detail data ────────────────────────────────────────────

  async function loadClientData(client: Client) {
    setSelectedClient(client);
    setActiveTab("engagements");
    setLoading(true);
    try {
      const clientId = String(client.id);
      const [eng, reg, br, tk, corr] = await Promise.all([
        fetch(`/api/client-data?type=engagements&clientId=${clientId}`).then(r => r.json()),
        fetch(`/api/client-data?type=registrations&clientId=${clientId}`).then(r => r.json()),
        fetch(`/api/client-data?type=breaches&clientId=${clientId}`).then(r => r.json()),
        fetch(`/api/client-data?type=tasks&clientId=${clientId}`).then(r => r.json()),
        fetch(`/api/client-data?type=correspondence&clientId=${clientId}`).then(r => r.json()),
      ]);
      setEngagements(eng.data ?? []);
      setRegistrations(reg.data ?? []);
      setBreaches(br.data ?? []);
      setClientTasks(tk.data ?? []);
      setClientCorrespondence(corr.data ?? []);
    } catch {
      // Silently fail — API routes not yet deployed
      setEngagements([]);
      setRegistrations([]);
      setBreaches([]);
      setClientTasks([]);
      setClientCorrespondence([]);
    }
    setLoading(false);
  }

  // ─── Form submit handlers ──────────────────────────────────────────────

  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedClient || !modal) return;
    const fd = new FormData(e.currentTarget);
    const clientId = String(selectedClient.id);

    startTransition(async () => {
      if (modal.type === "engagements") {
        if (modal.mode === "edit") await editEngagement(modal.item.id, fd);
        else await addEngagement(clientId, fd);
      } else if (modal.type === "registrations") {
        if (modal.mode === "edit") await editRegistration(modal.item.id, fd);
        else await addRegistration(clientId, fd);
      } else if (modal.type === "breaches") {
        if (modal.mode === "edit") await editBreach(modal.item.id, fd);
        else await addBreach(clientId, fd);
      } else if (modal.type === "tasks") {
        if (modal.mode === "edit") await editTask(modal.item.id, fd);
        else await addTask(clientId, fd);
      } else if (modal.type === "correspondence") {
        if (modal.mode === "edit") await editCorrespondence(modal.item.id, fd);
        else await addCorrespondence(clientId, fd);
      }
      setModal(null);
      loadClientData(selectedClient);
    });
  }

  function handleDelete(type: Tab, id: string) {
    if (!selectedClient) return;
    if (!confirm("Delete this record?")) return;
    startTransition(async () => {
      if (type === "engagements") await removeEngagement(id);
      else if (type === "registrations") await removeRegistration(id);
      else if (type === "breaches") await removeBreach(id);
      else if (type === "tasks") await removeTask(id);
      else if (type === "correspondence") await removeCorrespondence(id);
      loadClientData(selectedClient);
    });
  }

  // ─── Summary cards ────────────────────────────────────────────────────

  const overdueTasks = initialTasks.filter(
    (t) => t.status !== "completed" && t.status !== "cancelled" && t.due_date && new Date(t.due_date) < new Date()
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1C1E]">Client management</h1>
          <p className="text-sm text-gray-500 mt-1">
            POPIA representative services — engagements, registrations, tasks, and correspondence
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Active clients" value={activeClients.length} />
        <StatCard label="Overdue tasks" value={summary?.overdue_tasks ?? overdueTasks.length} />
        <StatCard label="Open breaches" value={summary?.open_breaches ?? 0} />
        <StatCard label="Pending correspondence" value={summary?.pending_correspondence ?? 0} />
      </div>

      <div className="flex gap-6">
        {/* Client list (left panel) */}
        <div className="w-80 shrink-0">
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-[#1A1C1E]">
                Clients ({initialClients.length})
              </h2>
            </div>
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
              {initialClients.length === 0 ? (
                <div className="p-4 text-sm text-gray-400 text-center">
                  No clients yet. Add clients on the Compliance page.
                </div>
              ) : (
                initialClients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => loadClientData(c)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                      selectedClient?.id === c.id ? "bg-[#F5F0E8]" : ""
                    }`}
                  >
                    <div className="text-sm font-medium text-[#1A1C1E] truncate">
                      {c.company_name}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        label={c.status}
                        colour={
                          c.status === "active"
                            ? "bg-green-100 text-green-700"
                            : c.status === "onboarding"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700"
                        }
                      />
                      {c.service_tier && (
                        <span className="text-xs text-gray-400">
                          {c.service_tier === "authorised_io" ? "Tier 2" : "Tier 1"}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Detail panel (right) */}
        <div className="flex-1 min-w-0">
          {!selectedClient ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-400">
              Select a client to view their management dashboard
            </div>
          ) : loading ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-400">
              Loading...
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg">
              {/* Client header */}
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-[#1A1C1E]">
                      {selectedClient.company_name}
                    </h2>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {selectedClient.contact_name && (
                        <span>{selectedClient.contact_name}</span>
                      )}
                      {selectedClient.contact_email && (
                        <span>{selectedClient.contact_email}</span>
                      )}
                      {selectedClient.company_country && (
                        <span>{selectedClient.company_country}</span>
                      )}
                    </div>
                  </div>
                  <Badge
                    label={selectedClient.status}
                    colour={
                      selectedClient.status === "active"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-700"
                    }
                  />
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 px-6">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-4 py-3 text-sm border-b-2 transition-colors ${
                      activeTab === tab.key
                        ? "border-[#C5A059] text-[#1A1C1E] font-medium"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-6">
                {/* Add button */}
                <div className="flex justify-end mb-4">
                  <button
                    className={btnSmall}
                    onClick={() => setModal({ type: activeTab, mode: "add" })}
                  >
                    + Add {TABS.find((t) => t.key === activeTab)?.label.toLowerCase()}
                  </button>
                </div>

                {activeTab === "engagements" && (
                  <EngagementsTab
                    items={engagements}
                    onEdit={(item) => setModal({ type: "engagements", mode: "edit", item })}
                    onDelete={(id) => handleDelete("engagements", id)}
                  />
                )}
                {activeTab === "registrations" && (
                  <RegistrationsTab
                    items={registrations}
                    onEdit={(item) => setModal({ type: "registrations", mode: "edit", item })}
                    onDelete={(id) => handleDelete("registrations", id)}
                  />
                )}
                {activeTab === "tasks" && (
                  <TasksTab
                    items={clientTasks}
                    onEdit={(item) => setModal({ type: "tasks", mode: "edit", item })}
                    onDelete={(id) => handleDelete("tasks", id)}
                  />
                )}
                {activeTab === "breaches" && (
                  <BreachesTab
                    items={breaches}
                    onEdit={(item) => setModal({ type: "breaches", mode: "edit", item })}
                    onDelete={(id) => handleDelete("breaches", id)}
                  />
                )}
                {activeTab === "correspondence" && (
                  <CorrespondenceTab
                    items={clientCorrespondence}
                    onEdit={(item) => setModal({ type: "correspondence", mode: "edit", item })}
                    onDelete={(id) => handleDelete("correspondence", id)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <Modal
          title={`${modal.mode === "add" ? "Add" : "Edit"} ${TABS.find(t => t.key === modal.type)?.label.toLowerCase()}`}
          onClose={() => setModal(null)}
        >
          <form onSubmit={handleFormSubmit} className="space-y-4">
            {modal.type === "engagements" && <EngagementForm item={modal.item} />}
            {modal.type === "registrations" && <RegistrationForm item={modal.item} />}
            {modal.type === "tasks" && <TaskForm item={modal.item} />}
            {modal.type === "breaches" && <BreachForm item={modal.item} />}
            {modal.type === "correspondence" && <CorrespondenceForm item={modal.item} />}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button type="button" onClick={() => setModal(null)} className={btnSecondary}>
                Cancel
              </button>
              <button type="submit" disabled={isPending} className={btnPrimary}>
                {isPending ? "Saving..." : modal.mode === "add" ? "Add" : "Update"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TAB CONTENT COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function EngagementsTab({
  items, onEdit, onDelete,
}: {
  items: Engagement[];
  onEdit: (item: Engagement) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return <EmptyState label="engagements" />;
  return (
    <div className="space-y-3">
      {items.map((e) => (
        <div key={e.id} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{tierLabel[e.service_tier] ?? e.service_tier}</span>
              <Badge label={e.engagement_status} colour={engagementColour[e.engagement_status] ?? "bg-gray-100 text-gray-700"} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onEdit(e)} className="text-xs text-[#C5A059] hover:underline">Edit</button>
              <button onClick={() => onDelete(e.id)} className={btnDanger}>Delete</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs text-gray-600">
            <div>Fee: {fmtCurrency(e.annual_fee_gbp)} / {fmtCurrency(e.annual_fee_zar, "R")}</div>
            <div>Start: {fmtDate(e.start_date)}</div>
            <div>Payment: {e.payment_frequency}</div>
          </div>
          {e.notes && <p className="text-xs text-gray-500 mt-2">{e.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function RegistrationsTab({
  items, onEdit, onDelete,
}: {
  items: IORegistration[];
  onEdit: (item: IORegistration) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return <EmptyState label="IO registrations" />;
  return (
    <div className="space-y-3">
      {items.map((r) => (
        <div key={r.id} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{r.registrant_name}</span>
              <Badge
                label={r.registration_type === "information_officer" ? "IO" : "DIO"}
                colour="bg-indigo-100 text-indigo-700"
              />
              <Badge label={r.registration_status} colour={regColour[r.registration_status] ?? "bg-gray-100 text-gray-700"} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onEdit(r)} className="text-xs text-[#C5A059] hover:underline">Edit</button>
              <button onClick={() => onDelete(r.id)} className={btnDanger}>Delete</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs text-gray-600">
            <div>Email: {r.registrant_email ?? "—"}</div>
            <div>Portal: {r.portal_used ?? "—"}</div>
            <div>IR ref: {r.ir_reference_number ?? "—"}</div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs text-gray-600 mt-1">
            <div>Submitted: {fmtDate(r.submitted_date)}</div>
            <div>Confirmed: {fmtDate(r.confirmed_date)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TasksTab({
  items, onEdit, onDelete,
}: {
  items: ComplianceTask[];
  onEdit: (item: ComplianceTask) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return <EmptyState label="tasks" />;
  return (
    <div className="space-y-2">
      {items.map((t) => {
        const isOverdue =
          t.status !== "completed" && t.status !== "cancelled" &&
          t.due_date && new Date(t.due_date) < new Date();
        return (
          <div
            key={t.id}
            className={`border rounded-lg p-3 flex items-center justify-between ${
              isOverdue ? "border-red-300 bg-red-50" : "border-gray-200"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{t.title}</span>
                <Badge label={isOverdue ? "overdue" : t.status} colour={isOverdue ? taskColour.overdue : (taskColour[t.status] ?? "bg-gray-100 text-gray-700")} />
                <span className="text-xs text-gray-400">{t.task_type}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                Due: {fmtDate(t.due_date)} {t.assigned_to && `· ${t.assigned_to}`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              <button onClick={() => onEdit(t)} className="text-xs text-[#C5A059] hover:underline">Edit</button>
              <button onClick={() => onDelete(t.id)} className={btnDanger}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreachesTab({
  items, onEdit, onDelete,
}: {
  items: BreachIncident[];
  onEdit: (item: BreachIncident) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return <EmptyState label="breach incidents" />;
  return (
    <div className="space-y-3">
      {items.map((b) => (
        <div key={b.id} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{b.incident_type ?? "Incident"}</span>
              {b.severity && <Badge label={b.severity} colour={severityColour[b.severity] ?? "bg-gray-100 text-gray-700"} />}
              <Badge label={b.status} colour={taskColour[b.status] ?? "bg-gray-100 text-gray-700"} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onEdit(b)} className="text-xs text-[#C5A059] hover:underline">Edit</button>
              <button onClick={() => onDelete(b.id)} className={btnDanger}>Delete</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs text-gray-600">
            <div>Date: {fmtDate(b.incident_date)}</div>
            <div>Reported to IR: {b.reported_to_ir ? "Yes" : "No"}</div>
            <div>Subjects affected: {b.data_subjects_affected?.toLocaleString("en-GB") ?? "—"}</div>
          </div>
          {b.description && <p className="text-xs text-gray-500 mt-2">{b.description}</p>}
        </div>
      ))}
    </div>
  );
}

function CorrespondenceTab({
  items, onEdit, onDelete,
}: {
  items: Correspondence[];
  onEdit: (item: Correspondence) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return <EmptyState label="correspondence" />;
  return (
    <div className="space-y-3">
      {items.map((c) => (
        <div key={c.id} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Badge
                label={c.direction}
                colour={c.direction === "inbound" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}
              />
              <span className="text-sm font-medium">{c.subject}</span>
              <Badge label={c.urgency} colour={urgencyColour[c.urgency] ?? "bg-gray-100 text-gray-700"} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onEdit(c)} className="text-xs text-[#C5A059] hover:underline">Edit</button>
              <button onClick={() => onDelete(c.id)} className={btnDanger}>Delete</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs text-gray-600">
            <div>From: {c.correspondent}</div>
            <div>Received: {fmtDate(c.received_date)}</div>
            <div>Due: {fmtDate(c.response_due_date)}</div>
          </div>
          <Badge label={c.status} colour={taskColour[c.status] ?? "bg-gray-100 text-gray-700"} />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-8 text-sm text-gray-400">
      No {label} recorded yet. Click the + button above to add one.
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  FORM COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function EngagementForm({ item }: { item?: Engagement }) {
  return (
    <div className="space-y-4">
      <FormField label="Service tier">
        <select name="service_tier" required defaultValue={item?.service_tier ?? "representative"} className={selectClass}>
          <option value="representative">Tier 1 — Representative</option>
          <option value="authorised_io">Tier 2 — Authorised IO</option>
        </select>
      </FormField>
      <FormField label="Status">
        <select name="engagement_status" defaultValue={item?.engagement_status ?? "draft"} className={selectClass}>
          {["draft", "sent", "signed", "active", "suspended", "terminated"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Start date">
          <input type="date" name="start_date" defaultValue={item?.start_date ?? ""} className={inputClass} />
        </FormField>
        <FormField label="End date">
          <input type="date" name="end_date" defaultValue={item?.end_date ?? ""} className={inputClass} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Annual fee (GBP)">
          <input type="number" step="0.01" name="annual_fee_gbp" defaultValue={item?.annual_fee_gbp ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Annual fee (ZAR)">
          <input type="number" step="0.01" name="annual_fee_zar" defaultValue={item?.annual_fee_zar ?? ""} className={inputClass} />
        </FormField>
      </div>
      <FormField label="Payment frequency">
        <select name="payment_frequency" defaultValue={item?.payment_frequency ?? "annual"} className={selectClass}>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="annual">Annual</option>
        </select>
      </FormField>
      <FormField label="Notes">
        <textarea name="notes" rows={3} defaultValue={item?.notes ?? ""} className={inputClass} />
      </FormField>
    </div>
  );
}

function RegistrationForm({ item }: { item?: IORegistration }) {
  return (
    <div className="space-y-4">
      <FormField label="Registration type">
        <select name="registration_type" required defaultValue={item?.registration_type ?? "information_officer"} className={selectClass}>
          <option value="information_officer">Information Officer (IO)</option>
          <option value="deputy_information_officer">Deputy Information Officer (DIO)</option>
        </select>
      </FormField>
      <FormField label="Registrant name">
        <input name="registrant_name" required defaultValue={item?.registrant_name ?? ""} className={inputClass} />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Email">
          <input type="email" name="registrant_email" defaultValue={item?.registrant_email ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Phone">
          <input name="registrant_phone" defaultValue={item?.registrant_phone ?? ""} className={inputClass} />
        </FormField>
      </div>
      <FormField label="Role">
        <input name="registrant_role" defaultValue={item?.registrant_role ?? ""} className={inputClass} />
      </FormField>
      <FormField label="Status">
        <select name="registration_status" defaultValue={item?.registration_status ?? "pending"} className={selectClass}>
          {["pending", "submitted", "confirmed", "rejected", "deregistered"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Portal used">
        <select name="portal_used" defaultValue={item?.portal_used ?? ""} className={selectClass}>
          <option value="">Not specified</option>
          <option value="eservices">eServices portal</option>
          <option value="bizportal">BizPortal</option>
          <option value="manual_email">Manual / email</option>
        </select>
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Submitted date">
          <input type="date" name="submitted_date" defaultValue={item?.submitted_date ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Confirmed date">
          <input type="date" name="confirmed_date" defaultValue={item?.confirmed_date ?? ""} className={inputClass} />
        </FormField>
      </div>
      <FormField label="IR reference number">
        <input name="ir_reference_number" defaultValue={item?.ir_reference_number ?? ""} className={inputClass} />
      </FormField>
      <FormField label="Notes">
        <textarea name="notes" rows={3} defaultValue={item?.notes ?? ""} className={inputClass} />
      </FormField>
    </div>
  );
}

function TaskForm({ item }: { item?: ComplianceTask }) {
  return (
    <div className="space-y-4">
      <FormField label="Title">
        <input name="title" required defaultValue={item?.title ?? ""} className={inputClass} />
      </FormField>
      <FormField label="Task type">
        <select name="task_type" required defaultValue={item?.task_type ?? ""} className={selectClass}>
          <option value="">Select...</option>
          <option value="io_registration">IO registration</option>
          <option value="paia_report">PAIA annual report</option>
          <option value="impact_assessment">Impact assessment</option>
          <option value="policy_review">Policy review</option>
          <option value="breach_response">Breach response</option>
          <option value="training">Training</option>
          <option value="compliance_review">Compliance review</option>
          <option value="other">Other</option>
        </select>
      </FormField>
      <FormField label="Description">
        <textarea name="description" rows={3} defaultValue={item?.description ?? ""} className={inputClass} />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Due date">
          <input type="date" name="due_date" defaultValue={item?.due_date ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Status">
          <select name="status" defaultValue={item?.status ?? "pending"} className={selectClass}>
            {["pending", "in_progress", "completed", "overdue", "cancelled"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField label="Assigned to">
        <input name="assigned_to" defaultValue={item?.assigned_to ?? ""} className={inputClass} />
      </FormField>
      {item && (
        <FormField label="Completed date">
          <input type="date" name="completed_date" defaultValue={item?.completed_date ?? ""} className={inputClass} />
        </FormField>
      )}
    </div>
  );
}

function BreachForm({ item }: { item?: BreachIncident }) {
  return (
    <div className="space-y-4">
      <FormField label="Incident type">
        <select name="incident_type" className={selectClass} defaultValue={item?.incident_type ?? ""}>
          <option value="">Select...</option>
          <option value="data_breach">Data breach</option>
          <option value="unauthorised_access">Unauthorised access</option>
          <option value="data_loss">Data loss</option>
          <option value="phishing">Phishing</option>
          <option value="ransomware">Ransomware</option>
          <option value="other">Other</option>
        </select>
      </FormField>
      <FormField label="Incident date">
        <input type="datetime-local" name="incident_date" required defaultValue={item?.incident_date ?? ""} className={inputClass} />
      </FormField>
      <FormField label="Severity">
        <select name="severity" className={selectClass} defaultValue={item?.severity ?? ""}>
          <option value="">Select...</option>
          {["low", "medium", "high", "critical"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Description">
        <textarea name="description" rows={3} defaultValue={item?.description ?? ""} className={inputClass} />
      </FormField>
      <FormField label="Data subjects affected">
        <input type="number" name="data_subjects_affected" defaultValue={item?.data_subjects_affected ?? ""} className={inputClass} />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Reported to IR?">
          <select name="reported_to_ir" defaultValue={item?.reported_to_ir ? "true" : "false"} className={selectClass}>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </FormField>
        <FormField label="IR report date">
          <input type="datetime-local" name="ir_report_date" defaultValue={item?.ir_report_date ?? ""} className={inputClass} />
        </FormField>
      </div>
      <FormField label="IR reference number">
        <input name="ir_reference_number" defaultValue={item?.ir_reference_number ?? ""} className={inputClass} />
      </FormField>
      <FormField label="Status">
        <select name="status" defaultValue={item?.status ?? "reported"} className={selectClass}>
          {["reported", "investigating", "contained", "resolved", "closed"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Remediation notes">
        <textarea name="remediation_notes" rows={3} defaultValue={item?.remediation_notes ?? ""} className={inputClass} />
      </FormField>
    </div>
  );
}

function CorrespondenceForm({ item }: { item?: Correspondence }) {
  return (
    <div className="space-y-4">
      <FormField label="Direction">
        <select name="direction" required defaultValue={item?.direction ?? "inbound"} className={selectClass}>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
      </FormField>
      <FormField label="Correspondent">
        <input name="correspondent" defaultValue={item?.correspondent ?? "Information Regulator"} className={inputClass} />
      </FormField>
      <FormField label="Subject">
        <input name="subject" required defaultValue={item?.subject ?? ""} className={inputClass} />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Received date">
          <input type="datetime-local" name="received_date" defaultValue={item?.received_date ?? ""} className={inputClass} />
        </FormField>
        <FormField label="Response due date">
          <input type="datetime-local" name="response_due_date" defaultValue={item?.response_due_date ?? ""} className={inputClass} />
        </FormField>
      </div>
      <FormField label="Urgency">
        <select name="urgency" defaultValue={item?.urgency ?? "normal"} className={selectClass}>
          {["normal", "urgent", "critical"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Status">
        <select name="status" defaultValue={item?.status ?? "received"} className={selectClass}>
          {["received", "acknowledged", "in_progress", "responded", "closed"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Document URL">
        <input type="url" name="document_url" defaultValue={item?.document_url ?? ""} className={inputClass} />
      </FormField>
      <FormField label="Notes">
        <textarea name="notes" rows={3} defaultValue={item?.notes ?? ""} className={inputClass} />
      </FormField>
    </div>
  );
}
