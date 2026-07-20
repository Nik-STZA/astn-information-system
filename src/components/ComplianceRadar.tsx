"use client";

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
};

/* ------------------------------------------------------------------ */
/*  Scoring helpers                                                    */
/* ------------------------------------------------------------------ */

function scoreIORegistration(
  registrations: ComplianceRadarProps["registrations"],
): number {
  if (registrations.some((r) => r.registration_status === "active")) return 100;
  if (registrations.some((r) => r.registration_status === "pending")) return 50;
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
  dsrIndex: number;
}

function CustomTick({ x = 0, y = 0, payload, dsrIndex }: CustomTickProps) {
  const isDSR = payload?.index === dsrIndex;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fill={isDSR ? WARM_GREY : LABEL_LIGHT}
        fontSize={11}
        fontFamily="Manrope, sans-serif"
        fontWeight={500}
        opacity={isDSR ? 0.5 : 1}
      >
        {payload?.value ?? ""}
      </text>
      {isDSR && (
        <text
          x={0}
          y={14}
          textAnchor="middle"
          dominantBaseline="central"
          fill={WARM_GREY}
          fontSize={9}
          fontFamily="Manrope, sans-serif"
          fontWeight={400}
          fontStyle="italic"
          opacity={0.6}
        >
          Coming soon
        </text>
      )}
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
  registrations,
  processingActivities,
  specialCategories,
  breaches,
  tasks,
}: ComplianceRadarProps) {
  const scores = {
    io: scoreIORegistration(registrations),
    ropa: scoreROPA(processingActivities),
    special: scoreSpecialCategories(specialCategories),
    breach: scoreBreachReadiness(breaches),
    dsr: 0,
    crossBorder: scoreCrossBorder(processingActivities),
    governance: scoreGovernance(tasks),
  };

  const dimensions = [
    { dimension: "IO Registration", score: scores.io, target: 100 },
    { dimension: "ROPA", score: scores.ropa, target: 100 },
    { dimension: "Special categories", score: scores.special, target: 100 },
    { dimension: "Breach readiness", score: scores.breach, target: 100 },
    { dimension: "Data subject rights", score: scores.dsr, target: 100 },
    { dimension: "Cross-border", score: scores.crossBorder, target: 100 },
    { dimension: "Governance", score: scores.governance, target: 100 },
  ];

  const DSR_INDEX = 4;

  // Average excluding Data subject rights
  const scoreable = dimensions.filter((_, i) => i !== DSR_INDEX);
  const overall =
    scoreable.reduce((sum, d) => sum + d.score, 0) / scoreable.length;

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
          POPIA compliance health
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
        Average across scored dimensions (excl. data subject rights)
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
                dsrIndex={DSR_INDEX}
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
    </div>
  );
}
