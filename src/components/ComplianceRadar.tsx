"use client";

import { useState } from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ComplianceRadarProps = {
  // When provided, the radar renders the REAL assessment's per-domain scores.
  // Falls back to the operational heuristics only when there is no assessment.
  assessmentDomains?: { dimension: string; score: number }[];
  assessmentLabel?: string;
  registrations: { registration_status: string }[];
  processingActivities: {
    status: string;
    cross_border: boolean;
    transfer_mechanism: string | null;
  }[];
  specialCategories: {
    is_processed: boolean | null;
    compliance_status: string;
  }[];
  breaches: { status: string; reported_to_ir: boolean }[];
  tasks: { status: string }[];
  dsars?: {
    status: string;
    deadline: string | null;
    completed_date: string | null;
  }[];
};

/* ------------------------------------------------------------------ */
/*  Scoring helpers                                                    */
/* ------------------------------------------------------------------ */

function scoreIORegistration(
  registrations: ComplianceRadarProps["registrations"],
): number {
  if (registrations.some((r) => r.registration_status === "confirmed"))
    return 100;
  if (
    registrations.some(
      (r) =>
        r.registration_status === "submitted" ||
        r.registration_status === "pending",
    )
  )
    return 50;
  return 0;
}

function scoreROPA(
  activities: ComplianceRadarProps["processingActivities"],
): number {
  const active = activities.filter((a) => a.status === "active");
  return Math.min(100, (active.length / 5) * 100);
}

function scoreSpecialCategories(
  categories: ComplianceRadarProps["specialCategories"],
): number {
  const assessed = categories.filter((c) => c.is_processed !== null).length;
  return (assessed / 9) * 100;
}

function scoreBreachReadiness(
  breaches: ComplianceRadarProps["breaches"],
): number {
  if (breaches.length === 0) return 80; // untested
  const notified = breaches.filter((b) => b.reported_to_ir).length;
  return (notified / breaches.length) * 100;
}

function scoreCrossBorder(
  activities: ComplianceRadarProps["processingActivities"],
): number {
  const crossBorder = activities.filter((a) => a.cross_border);
  if (crossBorder.length === 0) return 100;
  const withMechanism = crossBorder.filter(
    (a) => a.transfer_mechanism !== null && a.transfer_mechanism !== "",
  ).length;
  return (withMechanism / crossBorder.length) * 100;
}

function scoreGovernance(tasks: ComplianceRadarProps["tasks"]): number {
  if (tasks.length === 0) return 50;
  const completed = tasks.filter((t) => t.status === "completed").length;
  return (completed / tasks.length) * 100;
}

function scoreDSR(dsars: ComplianceRadarProps["dsars"]): number {
  if (!dsars || dsars.length === 0) return 0; // no process in place
  const closed = dsars.filter(
    (d) => d.status === "completed" || d.status === "closed",
  );
  if (closed.length === 0) return 30; // process exists but nothing completed yet
  // Score on-time completion rate
  const onTime = closed.filter((d) => {
    if (!d.deadline || !d.completed_date) return true; // no deadline = on time
    return d.completed_date <= d.deadline;
  }).length;
  const completionRate = closed.length / dsars.length;
  const timelinessRate = onTime / closed.length;
  // 60% weight on completion, 40% on timeliness
  return Math.round((completionRate * 0.6 + timelinessRate * 0.4) * 100);
}

/* ------------------------------------------------------------------ */
/*  Brand colours                                                      */
/* ------------------------------------------------------------------ */

const BRAND_DARK = "#1A1C1E";
const BRAND_GOLD = "#C5A059";
const WARM_GREY = "#8E9196";
const LABEL_LIGHT = "#C7C4BD";

/* ------------------------------------------------------------------ */
/*  Custom axis tick                                                   */
/* ------------------------------------------------------------------ */

interface TickPayload {
  value: string;
  coordinate: number;
  index: number;
  offset: number;
}

interface CustomTickProps {
  x?: number;
  y?: number;
  payload?: TickPayload;
  dsrIndex?: number;
}

function CustomTick({ x = 0, y = 0, payload }: CustomTickProps) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fill={LABEL_LIGHT}
        fontSize={11}
        fontFamily="Manrope, sans-serif"
        fontWeight={500}
      >
        {payload?.value ?? ""}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom tooltip                                                     */
/* ------------------------------------------------------------------ */

interface TooltipEntry {
  name: string;
  value: number;
  dataKey: string;
  payload: { dimension: string; score: number; target: number };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div
      style={{
        background: "#0F1113",
        border: `1px solid ${WARM_GREY}`,
        borderRadius: 8,
        padding: "8px 12px",
        fontFamily: "Manrope, sans-serif",
        fontSize: 12,
      }}
    >
      <p style={{ color: LABEL_LIGHT, margin: 0, fontWeight: 600 }}>
        {data.dimension}
      </p>
      <p style={{ color: BRAND_GOLD, margin: "4px 0 0", fontWeight: 700 }}>
        {Math.round(data.score)}%
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Legend                                                              */
/* ------------------------------------------------------------------ */

function Legend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 20,
        justifyContent: "center",
        marginTop: 8,
        fontFamily: "Manrope, sans-serif",
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-block",
            width: 18,
            height: 2,
            background: BRAND_GOLD,
            borderRadius: 1,
          }}
        />
        <span style={{ color: LABEL_LIGHT }}>Current score</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-block",
            width: 18,
            height: 0,
            borderTop: `2px dotted ${WARM_GREY}`,
          }}
        />
        <span style={{ color: WARM_GREY }}>Target (100%)</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ComplianceRadar({
  assessmentDomains,
  assessmentLabel,
  registrations,
  processingActivities,
  specialCategories,
  breaches,
  tasks,
  dsars,
}: ComplianceRadarProps) {
  const [showKey, setShowKey] = useState(false);

  const useReal = !!assessmentDomains && assessmentDomains.length > 0;

  const heuristicDimensions = [
    { dimension: "IO Registration", score: scoreIORegistration(registrations), target: 100 },
    { dimension: "ROPA", score: scoreROPA(processingActivities), target: 100 },
    { dimension: "Special categories", score: scoreSpecialCategories(specialCategories), target: 100 },
    { dimension: "Breach readiness", score: scoreBreachReadiness(breaches), target: 100 },
    { dimension: "Data subject rights", score: scoreDSR(dsars), target: 100 },
    { dimension: "Cross-border", score: scoreCrossBorder(processingActivities), target: 100 },
    { dimension: "Governance", score: scoreGovernance(tasks), target: 100 },
  ];

  const dimensions = useReal
    ? assessmentDomains!.map((d) => ({ dimension: d.dimension, score: d.score, target: 100 }))
    : heuristicDimensions;

  // Retained for the heuristic-methodology key panel (shown only in fallback mode).
  const scores = {
    io: heuristicDimensions[0].score,
    ropa: heuristicDimensions[1].score,
    special: heuristicDimensions[2].score,
    breach: heuristicDimensions[3].score,
    dsr: heuristicDimensions[4].score,
    crossBorder: heuristicDimensions[5].score,
    governance: heuristicDimensions[6].score,
  };

  // All dimensions now scored
  const overall =
    dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;

  return (
    <div
      style={{
        background: BRAND_DARK,
        borderRadius: 14,
        padding: "24px 20px 16px",
        fontFamily: "Manrope, sans-serif",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h3
          style={{
            color: LABEL_LIGHT,
            fontSize: 14,
            fontWeight: 700,
            margin: 0,
          }}
        >
          {useReal ? `${assessmentLabel || "Compliance"} assessment` : "Operational readiness"}
        </h3>
        <div style={{ textAlign: "right" }}>
          <span
            style={{
              color: BRAND_GOLD,
              fontSize: 30,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            {Math.round(overall)}
          </span>
          <span
            style={{
              color: WARM_GREY,
              fontSize: 12,
              fontWeight: 500,
              marginLeft: 2,
            }}
          >
            / 100
          </span>
        </div>
      </div>

      <p
        style={{
          color: WARM_GREY,
          fontSize: 11,
          margin: "0 0 12px",
          fontWeight: 400,
        }}
      >
        {useReal
          ? `From the latest assessment — ${dimensions.length} domains, scored from findings`
          : "Operational data readiness — run an assessment for scored compliance findings"}
      </p>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart cx="50%" cy="50%" outerRadius="72%" data={dimensions}>
          <PolarGrid stroke={WARM_GREY} strokeOpacity={0.2} />

          <PolarAngleAxis
            dataKey="dimension"
            tick={(props: Record<string, unknown>) => (
              <CustomTick
                x={props.x as number}
                y={props.y as number}
                payload={props.payload as TickPayload}
                dsrIndex={-1}
              />
            )}
          />

          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={false}
            axisLine={false}
          />

          {/* Target baseline (dotted) */}
          <Radar
            name="Target"
            dataKey="target"
            stroke={WARM_GREY}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            fill="none"
          />

          {/* Current scores (filled) */}
          <Radar
            name="Score"
            dataKey="score"
            stroke={BRAND_GOLD}
            strokeWidth={2}
            fill={BRAND_GOLD}
            fillOpacity={0.3}
          />

          <Tooltip content={<CustomTooltip />} />
        </RadarChart>
      </ResponsiveContainer>

      <Legend />

      {/* Scoring key toggle (heuristic methodology — fallback mode only) */}
      {!useReal && (
      <div style={{ textAlign: "center", marginTop: 12 }}>
        <button
          onClick={() => setShowKey(!showKey)}
          style={{
            background: "none",
            border: `1px solid ${WARM_GREY}`,
            borderRadius: 6,
            color: LABEL_LIGHT,
            fontSize: 11,
            fontFamily: "Manrope, sans-serif",
            fontWeight: 500,
            padding: "6px 14px",
            cursor: "pointer",
            opacity: 0.8,
          }}
        >
          {showKey ? "Hide scoring key" : "How is this scored?"}
        </button>
      </div>
      )}

      {!useReal && showKey && (
        <div
          style={{
            marginTop: 12,
            padding: "16px 14px",
            background: "#0F1113",
            borderRadius: 10,
            border: `1px solid ${WARM_GREY}33`,
            fontFamily: "Manrope, sans-serif",
            fontSize: 11,
            lineHeight: 1.6,
            color: LABEL_LIGHT,
          }}
        >
          <p style={{ color: BRAND_GOLD, fontWeight: 700, fontSize: 12, margin: "0 0 10px" }}>
            Scoring key
          </p>

          {[
            {
              label: "IO Registration",
              score: scores.io,
              desc: "Whether an Information Officer is registered with the Information Regulator (POPIA s55).",
              action: scores.io < 100
                ? "Go to the IO Registrations tab and add a registration with status \"confirmed\"."
                : null,
            },
            {
              label: "ROPA",
              score: scores.ropa,
              desc: "Record of Processing Activities completeness (POPIA s14). Scores by number of active processing activities documented.",
              action: scores.ropa < 100
                ? "Go to Data Mapping tab and add your processing activities (target: 5+ active activities for 100%)."
                : null,
            },
            {
              label: "Special categories",
              score: scores.special,
              desc: "Assessment of POPIA s26-33 special personal information categories. Scores by how many of the 9 categories have been assessed.",
              action: scores.special < 100
                ? "Go to Special Categories tab, initialise all 9 categories, and mark whether each is processed."
                : null,
            },
            {
              label: "Breach readiness",
              score: scores.breach,
              desc: "Breach notification compliance (POPIA s22). If no breaches recorded, scores 80% (untested). Otherwise scores by IR notification rate.",
              action: scores.breach < 100 && breaches.length > 0
                ? "Ensure all breach incidents have \"Reported to IR\" marked where applicable."
                : null,
            },
            {
              label: "Data subject rights",
              score: scores.dsr,
              desc: "DSAR handling capability (POPIA s23-25). Scores on: having a process (30%), completion rate (60% weight), and on-time response (40% weight).",
              action: scores.dsr < 30
                ? "Log DSARs in the DSARs tab to establish a data subject request process."
                : scores.dsr < 100
                  ? "Complete and close open DSARs within their 30-day deadline."
                  : null,
            },
            {
              label: "Cross-border",
              score: scores.crossBorder,
              desc: "Cross-border transfer compliance (POPIA s72). Scores by whether cross-border processing activities have a documented transfer mechanism.",
              action: scores.crossBorder < 100
                ? "In Data Mapping, ensure cross-border activities have a transfer mechanism (e.g. binding corporate rules, consent, adequate jurisdiction)."
                : null,
            },
            {
              label: "Governance",
              score: scores.governance,
              desc: "Task completion rate across all compliance tasks. If no tasks exist, scores 50% (no visibility).",
              action: scores.governance < 100
                ? "Complete outstanding compliance tasks, or generate remediation items to create a task backlog."
                : null,
            },
          ].map((item) => (
            <div key={item.label} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 600 }}>{item.label}</span>
                <span style={{
                  color: item.score >= 80 ? "#2E7D32" : item.score >= 50 ? "#CC7700" : "#CC0000",
                  fontWeight: 700,
                  fontSize: 12,
                }}>
                  {Math.round(item.score)}%
                </span>
              </div>
              <p style={{ margin: "2px 0 0", color: WARM_GREY, fontSize: 10.5 }}>
                {item.desc}
              </p>
              {item.action && (
                <p style={{ margin: "3px 0 0", color: BRAND_GOLD, fontSize: 10.5, fontWeight: 500 }}>
                  Action: {item.action}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
