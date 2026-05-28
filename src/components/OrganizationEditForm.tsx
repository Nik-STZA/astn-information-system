"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useRef, useState } from "react";
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
  const [pendingDiff, setPendingDiff] = useState<FieldDiff[] | null>(null);
  const [noChangesAt, setNoChangesAt] = useState<number | null>(null);
  const parsedConfidence = parseSourceConfidence(org.source_confidence);

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
    const form = formRef.current;
    setPendingDiff(null);
    form?.requestSubmit();
  }

  function handleCancel() {
    setPendingDiff(null);
  }

  return (
    <>
      <form ref={formRef} action={formAction} className="card p-5 space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TextField
              name="organization_website"
              label="Organisation website"
              defaultValue={org.organization_website}
              type="url"
            />
            <TextField
              name="contact_email"
              label="Contact email"
              defaultValue={org.contact_email}
              type="email"
            />
            <TextField
              name="contact_phone"
              label="Contact phone"
              defaultValue={org.contact_phone}
            />
            <TextField
              name="social_media"
              label="Social media"
              defaultValue={org.social_media}
            />
          </div>
        </Section>

        <Section title="Partnership & outreach">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SelectField
              name="partnership_type"
              label="Partnership type"
              defaultValue={org.partnership_type}
              options={[...CANONICAL_PARTNERSHIP_TYPES]}
              placeholder="Select partnership type"
            />
            <SelectField
              name="commercial_priority"
              label="Commercial priority"
              defaultValue={org.commercial_priority}
              options={[...CANONICAL_COMMERCIAL_PRIORITY]}
              placeholder="Select priority"
            />
            <SelectField
              name="outreach_candidate"
              label="Outreach candidate"
              defaultValue={org.outreach_candidate}
              options={[...CANONICAL_OUTREACH_CANDIDATE]}
              placeholder="Select"
            />
            <TextField name="owner" label="Owner" defaultValue={org.owner} />
            <DateField
              name="review_date"
              label="Review date"
              defaultValue={org.review_date}
            />
          </div>
        </Section>

        <Section title="Notes & tags">
          <div className="space-y-4">
            <TextField name="tags" label="Tags" defaultValue={org.tags} />
            <TextAreaField name="notes" label="Notes" defaultValue={org.notes} rows={4} />
            <TextAreaField
              name="next_action"
              label="Next action"
              defaultValue={org.next_action}
              rows={3}
            />
          </div>
        </Section>

        <Section title="Verification">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SelectField
              name="source_confidence_band"
              label="Source confidence"
              defaultValue={parsedConfidence.band}
              options={[...CONFIDENCE_BANDS]}
              placeholder="Select band"
            />
            <TextField
              name="source_confidence_descriptor"
              label="Confidence descriptor (optional)"
              defaultValue={parsedConfidence.descriptor}
              placeholder="e.g. via StadiumDB"
            />
            <DateField
              name="verification_date"
              label="Verification date"
              defaultValue={org.verification_date}
            />
            <TextField
              name="verification_source_label"
              label="Source label"
              defaultValue={org.verification_source_label}
              placeholder="e.g. CAF, StadiumDB"
            />
            <TextField
              name="verification_source"
              label="Verification source"
              defaultValue={org.verification_source}
            />
            <TextField
              name="verification_source_primary"
              label="Primary source"
              defaultValue={org.verification_source_primary}
              placeholder="URL or citation"
            />
            <TextField
              name="verification_source_xref"
              label="Cross-reference"
              defaultValue={org.verification_source_xref}
              placeholder="URL or citation"
            />
          </div>
        </Section>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gold-border">
          <NoChangesNote at={noChangesAt} />
          <StatusBadge state={state} />
          <SaveButton onClick={handleSaveClick} />
        </div>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-h3-app text-brand-dark font-bold">{title}</h3>
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
    <label className="block">
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
    <label className="block">
      <span className="label-brand">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={isoLike}
        className="input-brand"
      />
      {defaultValue && !isoLike && (
        <span className="text-caption text-warning-amber mt-1 block">
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
    <label className="block">
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
    <label className="block">
      <span className="label-brand">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={rows}
        className="input-brand resize-y"
      />
    </label>
  );
}

// Button lives inside the form so useFormStatus picks up pending state from
// the React server action triggered by requestSubmit().
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
  return <span className="text-caption text-warm-grey">No changes to save.</span>;
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
    return <span className="pill pill-high">Saved</span>;
  }
  return (
    <span className="text-caption text-alert-red" role="alert">
      {state.message || "Save failed"}
    </span>
  );
}

// Modal listing the diff. Confirm calls form.requestSubmit() to fire the
// server action; cancel preserves the form contents.
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-near-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-changes-title"
    >
      <div className="card max-w-2xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <h2 id="confirm-changes-title" className="m-0">
          Confirm changes
        </h2>
        <p className="text-body-app text-near-black">
          Apply the following {diffs.length === 1 ? "change" : `${diffs.length} changes`} to{" "}
          <strong>{orgName}</strong>?
        </p>

        <ul className="space-y-2 border-t border-b border-gold-border py-3">
          {diffs.map(({ field, oldValue, newValue }) => (
            <li
              key={field}
              className="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-x-3 gap-y-0.5"
            >
              <span className="text-tag uppercase tracking-wider text-warm-grey font-bold pt-0.5">
                {fieldLabel(field)}
              </span>
              <span className="text-body-app text-near-black break-words">
                <span className="text-alert-red line-through opacity-80">{oldValue}</span>
                <span className="mx-2 text-warm-grey">→</span>
                <span className="text-success-green font-bold">{newValue}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="text-caption text-warm-grey">
          The change will be recorded in the audit trail with your email and timestamp.
        </p>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="btn-primary">
            Confirm and save
          </button>
        </div>
      </div>
    </div>
  );
}
