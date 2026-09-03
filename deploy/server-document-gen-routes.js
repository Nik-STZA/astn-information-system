/**
 * Document generation (OS module) — jurisdiction-agnostic.
 *
 * MODE 1 — Amendment schedule (redline pack): gathers the confirmed dual-model resolutions for a
 * client and structures them per target document as "current gap -> proposed wording", carrying
 * each change's regime, citation, severity and [Statutory]/[Enhancement] tag. The frontend renders
 * a branded .docx from this shape (a defensible advisory deliverable; the client's counsel applies
 * the accepted changes — we never machine-rewrite their file).
 *
 * The redraft text is sent RAW (rr.resolution) so any human edits/approvals are honoured; the
 * frontend parses it into sections with the same parser the ResolutionPanel uses.
 *
 * (MODE 2 — template generation, e.g. STZA's missing PAIA manual — will hang off this same module.)
 * See docs/compliance-engine-principles.md.
 *
 * Endpoint:
 *  - GET /api/v2/clients/:clientId/amendment-schedule?include_drafts=<bool>
 */

// Map a domain/theme to the instrument the change primarily belongs in.
function inferDocType(domainName, category) {
  const s = `${domainName || ""} ${category || ""}`.toLowerCase();
  if (/breach|incident/.test(s)) return "breach_procedure";
  if (/security|safeguard/.test(s)) return "security_policy";
  if (/transfer|cross.?border/.test(s)) return "data_processing_agreement";
  return "privacy_policy";
}

// Human label for a document type (fallback when the client has no doc of that type on file).
const DOC_TYPE_LABEL = {
  privacy_policy: "Privacy Policy",
  breach_procedure: "Incident Response / Breach Procedure",
  security_policy: "Information Security Policy",
  data_processing_agreement: "Data Processing / Transfer Agreement",
  terms_of_service: "Terms of Service",
  paia_manual: "PAIA Manual",
  other: "Other",
};

app.get("/api/v2/clients/:clientId/amendment-schedule", async (req, res) => {
  try {
    const { clientId } = req.params;
    const includeDrafts = req.query.include_drafts === "true";

    const { rows: client } = await pool.query(
      "SELECT company_name, company_country, ir_registration_number FROM compliance_clients WHERE id = $1",
      [clientId],
    );
    if (!client.length) return res.status(404).json({ error: "client not found" });

    const statusFilter = includeDrafts ? "" : "AND rr.status IN ('confirmed','applied')";
    const { rows } = await pool.query(
      `SELECT cr.id, cr.jurisdiction_code, cr.domain_code, cr.category, cr.legal_reference,
              cr.severity, cr.title, cr.finding_status,
              cj.short_name AS jurisdiction_name,
              rr.resolution, rr.status AS resolution_status, rr.agreement, rr.reviewed_by
         FROM compliance_remediation cr
         JOIN remediation_resolutions rr ON rr.remediation_id = cr.id
         LEFT JOIN compliance_jurisdictions cj ON cj.code = cr.jurisdiction_code
        WHERE cr.client_id = $1 ${statusFilter}
        ORDER BY cj.short_name NULLS LAST,
                 CASE cr.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
                 cr.id`,
      [clientId],
    );

    // Real document titles per type, so the schedule names the client's actual documents.
    const { rows: docs } = await pool.query(
      "SELECT document_type, title FROM compliance_documents WHERE client_id = $1",
      [clientId],
    );
    const docTitleByType = {};
    for (const d of docs) if (!docTitleByType[d.document_type]) docTitleByType[d.document_type] = d.title;

    const byDoc = {};
    for (const r of rows) {
      const docType = inferDocType(r.category, r.domain_code);
      const docTitle = docTitleByType[docType] || docTitleByType["privacy_policy"] || DOC_TYPE_LABEL[docType] || "Document";
      (byDoc[docType] ||= { document_type: docType, document_label: DOC_TYPE_LABEL[docType] || docType, document_title: docTitle, changes: [] });
      byDoc[docType].changes.push({
        remediation_id: r.id,
        jurisdiction_code: r.jurisdiction_code,
        jurisdiction_name: r.jurisdiction_name || r.jurisdiction_code,
        requirement: r.title,
        legal_reference: r.legal_reference,
        severity: r.severity,
        finding_status: r.finding_status,
        resolution_status: r.resolution_status,
        agreement: r.agreement,
        reviewed_by: r.reviewed_by,
        resolution: r.resolution, // RAW composed text (honours human edits); frontend parses it
      });
    }

    res.json({
      client: client[0],
      generated_at: new Date().toISOString(),
      include_drafts: includeDrafts,
      total_changes: rows.length,
      documents: Object.values(byDoc),
    });
  } catch (err) {
    console.error("GET /v2/clients/:id/amendment-schedule error:", err);
    res.status(500).json({ error: err.message });
  }
});
