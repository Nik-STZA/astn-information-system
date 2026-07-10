"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateOrganization } from "@/lib/data/registry-actions";
import {
  CANONICAL_COMMERCIAL_PRIORITY,
  CANONICAL_OUTREACH_CANDIDATE,
  CANONICAL_PARTNERSHIP_TYPES,
  CANONICAL_STATUS,
  CANONICAL_VERTICALS,
  CONFIDENCE_BANDS,
  EDITABLE_FIELDS,
  composeSourceConfidence,
  fieldLabel,
  parseSourceConfidence,
  type ConfidenceBand,
  type OrganizationDetail,
  type UpdateResult,
} from "@/lib/data/registry-shared";

type Props = {
  org: OrganizationDetail;
  typeOptions: string[];
};

type FieldDiff = { field: string; oldValue: string; newValue: string };

const INITIAL: UpdateResult = { status: "idle" };

function computeFormDiff(form: HTMLFormElement, org: OrganizationDetail): FieldDiff[] {
  const fd = new FormData(form);
  const diffs: FieldDiff[] = [];

  for (const field of EDITABLE_FIELDS) {
    if (field === "source_confidence") continue;
    const raw = fd.get(field);
    const newVal = typeof raw === "string" ? raw.trim() : "";
    const oldRaw = (org as unknown as Record<string, unknown>)[field];
    const oldVal = oldRaw == null ? "" : String(oldRaw);
    if (newVal !== oldVal) {
      diffs.push({
        field,
        oldValue: oldVal || "(empty)",
        newValue: newVal || "(empty)",
      });
    }
  }

  // source_confidence is composed from the band dropdown + descriptor input.
  const bandRaw = fd.get("source_confidence_band");
  const descRaw = fd.get("source_confidence_descriptor");
  const band: ConfidenceBand | "" =
    typeof bandRaw === "string" && (CONFIDENCE_BANDS as readonly string[]).includes(bandRaw)
      ? (bandRaw as ConfidenceBand)
      : "";
  const descriptor = typeof descRaw === "string" ? descRaw : "";
  const composed = composeSourceConfidence(band, descriptor) ?? "";
  const stored = org.source_confidence ?? "";
  if (composed !== stored) {
    diffs.push({
      field: "source_confidence",
      oldValue: stored || "(empty)",
      newValue: composed || "(empty)",
    });
  }

  return diffs;
}

export default function OrganizationEditForm({ org, typeOptions }: Props) {
  const action = updateOrganization.bind(null, org.id);
  const [state, formAction] = useFormState(action, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const submitterRef = useRef<HTMLButtonElement>(null);
  const [pendingDiff, setPendingDiff] = useState<FieldDiff[] | null>(null);
  const [noChangesAt, setNoChangesAt] = useState<number | null>(null);
  const parsedConfidence = parseSourceConfidence(org.source_confidence);
  const router = useRouter();
  const lastRefreshedAt = useRef<number>(0);

  useEffect(() => {
    if (state.status === "ok" && state.savedAt !== lastRefreshedAt.current) {
      lastRefreshedAt.current = state.savedAt;
      router.refresh();
    }
  }, [state, router]);

  function handleSaveClick() {
    const form = formRef.current;
    if (!form) return;
    const diffs = computeFormDiff(form, org);
    if (diffs.length === 0) {
      setNoChangesAt(Date.now());
      return;
    }
    setPendingDiff(diffs);
  }

  function handleConfirm() {
    setPendingDiff(null);
    submitterRef.current?.click();
  }

  function handleCancel() {
    setPendingDiff(null);
  }

  return (
    <>
      <form
        ref={formRef}
        action={formAction}
        style={{
          background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10,
          padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20,
          boxShadow: "0 1px 3px rgba(26,28,30,.04), 0 1px 2px rgba(26,28,30,.03)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          <SelectField
            name="organization_type"
            label="Organisation type"
            defaultValue={org.organization_type}
            options={typeOptions}
            placeholder="Select type"
          />
          <SelectField
            name="status"
            label="Status"
            defaultValue={org.status}
            options={[...CANONICAL_STATUS]}
            placeholder="Select status"
          />
          <SelectField
            name="astn_vertical"
            label="AfricanSTN vertical"
            defaultValue={org.astn_vertical}
            options={[...CANONICAL_VERTICALS]}
            placeholder="Select vertical"
          />
        </div>

        <Section title="Web & contact">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            <TextField name="organization_website" label="Organisation website" defaultValue={org.organization_website} type="url" />
            <TextField name="contact_email" label="Contact email" defaultValue={org.contact_email} type="email" />
            <TextField name="contact_phone" label="Contact phone" defaultValue={org.contact_phone} />
            <TextField name="social_media" label="Social media" defaultValue={org.social_media} />
          </div>
        </Section>

        <Section title="Partnership & outreach">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            <SelectField name="partnership_type" label="Partnership type" defaultValue={org.partnership_type} options={[...CANONICAL_PARTNERSHIP_TYPES]} placeholder="Select partnership type" />
            <SelectField name="commercial_priority" label="Commercial priority" defaultValue={org.commercial_priority} options={[...CANONICAL_COMMERCIAL_PRIORITY]} placeholder="Select priority" />
            <SelectField name="outreach_candidate" label="Outreach candidate" defaultValue={org.outreach_candidate} options={[...CANONICAL_OUTREACH_CANDIDATE]} placeholder="Select" />
            <TextField name="owner" label="Owner" defaultValue={org.owner} />
            <DateField name="review_date" label="Review date" defaultValue={org.review_date} />
          </div>
        </Section>

        <Section title="Notes & tags">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <TextField name="tags" label="Tags" defaultValue={org.tags} />
            <TextAreaField name="notes" label="Notes" defaultValue={org.notes} rows={4} />
            <TextAreaField name="next_action" label="Next action" defaultValue={org.next_action} rows={3} />
          </div>
        </Section>

        <Section title="Verification">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            <SelectField name="source_confidence_band" label="Source confidence" defaultValue={parsedConfidence.band} options={[...CONFIDENCE_BANDS]} placeholder="Select band" />
            <TextField name="source_confidence_descriptor" label="Confidence descriptor (optional)" defaultValue={parsedConfidence.descriptor} placeholder="e.g. via StadiumDB" />
            <DateField name="verification_date" label="Verification date" defaultValue={org.verification_date} />
            <TextField name="verification_source_label" label="Source label" defaultValue={org.verification_source_label} placeholder="e.g. CAF, StadiumDB" />
            <TextField name="verification_source" label="Verification source" defaultValue={org.verification_source} />
            <TextField name="verification_source_primary" label="Primary source" defaultValue={org.verification_source_primary} placeholder="URL or citation" />
            <TextField name="verification_source_xref" label="Cross-reference" defaultValue={org.verification_source_xref} placeholder="URL or citation" />
          </div>
        </Section>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 12, paddingTop: 8, borderTop: "1px solid var(--bd)",
        }}>
          <NoChangesNote at={noChangesAt} />
          <StatusBadge state={state} />
          <SaveButton onClick={handleSaveClick} />
        </div>

        <button ref={submitterRef} type="submit" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />
      </form>

      {pendingDiff && (
        <ConfirmChangesModal
          orgName={org.organization_name ?? "this organisation"}
          diffs={pendingDiff}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--tx)", margin: 0 }}>{title}</h3>
      {children}
    </div>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  type = "text",
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <span className="label-brand">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="input-brand"
      />
    </label>
  );
}

function DateField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
}) {
  const isoLike = defaultValue && /^\d{4}-\d{2}-\d{2}$/.test(defaultValue)
    ? defaultValue
    : "";
  return (
    <label style={{ display: "block" }}>
      <span className="label-brand">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={isoLike}
        className="input-brand"
      />
      {defaultValue && !isoLike && (
        <span style={{ fontSize: 12, fontWeight: 500, color: "#CC7700", marginTop: 4, display: "block" }}>
          Existing non-standard value: {defaultValue}. Saving here will replace it.
        </span>
      )}
    </label>
  );
}

function SelectField({
  name,
  label,
  defaultValue,
  options,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  options: string[];
  placeholder: string;
}) {
  const current = defaultValue ?? "";
  const includesCurrent = current === "" || options.includes(current);
  return (
    <label style={{ display: "block" }}>
      <span className="label-brand">{label}</span>
      <select name={name} defaultValue={current} className="input-brand">
        <option value="">{placeholder}</option>
        {!includesCurrent && current && (
          <option value={current}>{current} (legacy)</option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({
  name,
  label,
  defaultValue,
  rows,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  rows: number;
}) {
  return (
    <label style={{ display: "block" }}>
      <span className="label-brand">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={rows}
        className="input-brand"
        style={{ resize: "vertical" }}
      />
    </label>
  );
}

function SaveButton({ onClick }: { onClick: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-primary"
      disabled={pending}
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

function NoChangesNote({ at }: { at: number | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (at === null) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(t);
  }, [at]);
  if (!visible) return null;
  return (
    <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--sub)" }}>
      No changes to save.
    </span>
  );
}

function StatusBadge({ state }: { state: UpdateResult }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    if (state.status === "ok") {
      const t = setTimeout(() => setVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [state]);

  if (!visible || state.status === "idle") return null;
  if (state.status === "ok") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center",
        padding: "5px 10px", borderRadius: 999,
        fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em",
        color: "#2E7D32", background: "#E8F5E9", border: "1px solid #C8E6C9",
      }}>
        Saved
      </span>
    );
  }
  return (
    <span style={{ fontSize: 12.5, fontWeight: 500, color: "#CC0000" }} role="alert">
      {state.message || "Save failed"}
    </span>
  );
}

/* ── Confirmation modal ──────────────────────────────────────────────── */
function ConfirmChangesModal({
  orgName,
  diffs,
  onConfirm,
  onCancel,
}: {
  orgName: string;
  diffs: FieldDiff[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-changes-title"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15,17,19,.5)", padding: 16,
      }}
    >
      <div style={{
        background: "var(--pnl)", border: "1px solid var(--bd)", borderRadius: 10,
        maxWidth: 640, width: "100%", padding: 24,
        display: "flex", flexDirection: "column", gap: 16,
        maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 4px 24px rgba(0,0,0,.15)",
      }}>
        <h2 id="confirm-changes-title" style={{ fontSize: 18, fontWeight: 700, color: "var(--tx)", margin: 0 }}>
          Confirm changes
        </h2>
        <p style={{ fontSize: 13, fontWeight: 400, color: "var(--tx)", margin: 0 }}>
          Apply the following {diffs.length === 1 ? "change" : `${diffs.length} changes`} to{" "}
          <strong>{orgName}</strong>?
        </p>

        <ul style={{
          listStyle: "none", padding: 0, margin: 0,
          display: "flex", flexDirection: "column", gap: 8,
          borderTop: "1px solid var(--bd)", borderBottom: "1px solid var(--bd)",
          paddingTop: 12, paddingBottom: 12,
        }}>
          {diffs.map(({ field, oldValue, newValue }) => (
            <li
              key={field}
              style={{
                display: "grid", gridTemplateColumns: "12rem 1fr",
                gap: "2px 12px",
              }}
            >
              <span style={{
                fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: ".04em", color: "var(--sub)", paddingTop: 2,
              }}>
                {fieldLabel(field)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 400, color: "var(--tx)", wordBreak: "break-word" }}>
                <span style={{ color: "#CC0000", textDecoration: "line-through", opacity: 0.8 }}>{oldValue}</span>
                <span style={{ margin: "0 8px", color: "var(--sub)" }}>→</span>
                <span style={{ color: "#2E7D32", fontWeight: 700 }}>{newValue}</span>
              </span>
            </li>
          ))}
        </ul>

        <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--sub)", margin: 0 }}>
          The change will be recorded in the audit trail with your email and timestamp.
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, paddingTop: 4 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: "10px 20px", borderRadius: 8,
              fontWeight: 700, fontSize: 13,
              color: "#B08D3F", background: "#FFFFFF",
              border: "1px solid var(--bd)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: "10px 20px", borderRadius: 8,
              fontWeight: 700, fontSize: 13,
              color: "#1A1C1E", background: "#C5A059",
              border: "none", cursor: "pointer",
            }}
          >
            Confirm and save
          </button>
        </div>
      </div>
    </div>
  );
}
