// VAT returns (VAT build spec 17 Nov 2026): the client's VAT registration, its
// companies, and each return being built or filed. Opening a return is the
// first step; the return's page takes the Xero exports.

import Link from "next/link";
import PageHeader from "@/shared/ui/PageHeader";
import VatOpenReturn from "@/modules/finance/components/VatOpenReturn";
import { fetchVat, periodLabel, STATUS_LABEL, type VatStatus } from "@/modules/finance/lib/vat";
import page from "@/modules/finance/components/Page.module.css";
import vat from "@/modules/finance/components/Vat.module.css";

export const dynamic = "force-dynamic";

const TONE: Record<VatStatus, string> = {
  building: "s-amber", import_ready: "s-blue", import_confirmed: "s-blue", submitted: "s-green", paid: "s-green", part_paid: "s-amber", outstanding: "s-red",
};

export default async function VatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await fetchVat(slug);
  const base = `/finance/clients/${encodeURIComponent(slug)}/vat`;
  return (
    <div className={page.wide}>
      <PageHeader title="VAT returns"
        sub="Each company's return is exported from Xero and dropped in here. The checks run, the group return is built and the import file is made for the representative member. Nothing is written to Xero." />
      {!r.ok ? (
        <div className={page.error} role="alert">
          Could not load VAT returns: {/Cannot GET/i.test(r.error) ? "the endpoint is not deployed on finance-api yet." : r.error}
        </div>
      ) : !r.data.registrations.length ? (
        <div className={`${page.card} ${page.empty}`}>
          No VAT registration is set up for this client. Record the VAT number and the companies in Settings, under the client profile.
        </div>
      ) : (
        <div className={page.stack}>
          {r.data.registrations.map((reg) => (
            <section key={reg.id} className={page.card} aria-label={`VAT registration ${reg.vat_number}`}>
              <div className={page.cardHead}>
                <h2>VAT {reg.vat_number}{reg.kind === "group" ? " (group)" : ""}</h2>
              </div>
              <div className={`${page.pad} ${page.small}`}>
                {reg.kind === "group" && reg.representative_name ? <>Representative member: <strong>{reg.representative_name}</strong>. </> : null}
                Companies: {reg.members.map((m) => m.entity_name).join(", ") || "none"}.
              </div>
              <div className={page.pad} style={{ borderTop: "1px solid var(--bd)" }}>
                <VatOpenReturn slug={slug} registrationId={r.data.registrations.length > 1 ? reg.id : null} />
              </div>
              {(() => {
                const rows = r.data.returns.filter((x) => x.registration_id === reg.id);
                if (!rows.length) return <div className={page.empty} style={{ borderTop: "1px solid var(--bd)" }}>No returns yet.</div>;
                return (
                  <div className={vat.scroll} style={{ borderTop: "1px solid var(--bd)" }}>
                    <table className={vat.table}>
                      <thead><tr><th>Period</th><th>Status</th><th className={vat.num}>Exports</th><th /></tr></thead>
                      <tbody>
                        {rows.map((x) => (
                          <tr key={x.id}>
                            <td className={page.nowrap}>{periodLabel(x.period_start, x.period_end)}</td>
                            <td><span className={`${page.status} ${page[TONE[x.status]]}`}><span className={page.dot} />{STATUS_LABEL[x.status]}</span></td>
                            <td className={vat.num}>{x.uploads}</td>
                            <td><Link prefetch={false} className={page.miniBtn} href={`${base}/${x.id}`}>Open</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
