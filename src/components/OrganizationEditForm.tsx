"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useState } from "react";
import { updateOrganization } from "@/lib/data/registry-actions";
import {
  CANONICAL_COMMERCIAL_PRIORITY,
  CANONICAL_OUTREACH_CANDIDATE,
  CANONICAL_PARTNERSHIP_TYPES,
  CANONICAL_STATUS,
  CANONICAL_VERTICALS,
  CONFIDENCE_BANDS,
  parseSourceConfidence,
  type OrganizationDetail,
  type UpdateResult,
} from "@/lib/data/registry-shared";

type Props = {
  org: OrganizationDetail;
  typeOptions: string[];
};

const INITIAL: UpdateResult = { status: "idle" };

export default function OrganizationEditForm({ org, typeOptions }: Props) {
  const action = updateOrganization.bind(null, org.id);
  const [state, formAction] = useFormState(action, INITIAL);
  const parsedConfidence = parseSourceConfidence(org.source_confidence);

  return (
    <form action={formAction} className="card p-5 space-y-5">
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
        <StatusBadge state={state} />
        <SubmitButton />
      </div>
    </form>
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
  // Existing data is 100% YYYY-MM-DD per a one-time audit, but defend
  // against legacy stragglers by only pre-filling when it parses.
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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

// Brief auto-fading toast for the save outcome.
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
