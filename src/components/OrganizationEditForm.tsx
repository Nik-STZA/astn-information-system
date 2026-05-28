"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useState } from "react";
import { updateOrganization } from "@/lib/data/registry-actions";
import type { OrganizationDetail, UpdateResult } from "@/lib/data/registry-shared";

type Props = {
  org: OrganizationDetail;
  typeOptions: string[];
};

const INITIAL: UpdateResult = { status: "idle" };

export default function OrganizationEditForm({ org, typeOptions }: Props) {
  const action = updateOrganization.bind(null, org.id);
  const [state, formAction] = useFormState(action, INITIAL);

  return (
    <form action={formAction} className="card p-5 space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TextField
          name="organization_name"
          label="Organisation name"
          defaultValue={org.organization_name}
        />
        <SelectField
          name="organization_type"
          label="Organisation type"
          defaultValue={org.organization_type}
          options={typeOptions}
          placeholder="Select type"
        />
        <TextField name="status" label="Status" defaultValue={org.status} />
        <TextField
          name="astn_vertical"
          label="AfricanSTN vertical"
          defaultValue={org.astn_vertical}
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
          <TextField
            name="partnership_type"
            label="Partnership type"
            defaultValue={org.partnership_type}
          />
          <TextField
            name="commercial_priority"
            label="Commercial priority"
            defaultValue={org.commercial_priority}
          />
          <TextField
            name="outreach_candidate"
            label="Outreach candidate"
            defaultValue={org.outreach_candidate}
          />
          <TextField name="owner" label="Owner" defaultValue={org.owner} />
          <TextField
            name="review_date"
            label="Review date"
            defaultValue={org.review_date}
            placeholder="YYYY-MM-DD"
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
        <p className="text-caption text-warm-grey -mt-1">
          source_confidence is a free-text descriptive string. Keep the band as the first word ({"\""}High{"\""}, {"\""}Medium{"\""}, {"\""}Medium-Low{"\""}, {"\""}Low{"\""}) so pills and filters still match.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TextField
            name="source_confidence"
            label="Source confidence"
            defaultValue={org.source_confidence}
            placeholder="High (operator verified)"
          />
          <TextField
            name="verification_date"
            label="Verification date"
            defaultValue={org.verification_date}
            placeholder="YYYY-MM-DD"
          />
          <TextField
            name="verification_source"
            label="Verification source"
            defaultValue={org.verification_source}
          />
          <TextField
            name="verification_source_label"
            label="Source label"
            defaultValue={org.verification_source_label}
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
        {!includesCurrent && current && <option value={current}>{current}</option>}
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
