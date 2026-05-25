"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

/**
 * Horizontal bar chart for top countries / top org types views on the overview.
 *
 * Brand application:
 *   - Bars in Brand Gold
 *   - Axes and labels in Warm Grey
 *   - Tooltip on Warm Light background
 *   - Hover state slightly darker
 */
export default function HorizontalBarChart({
  data,
  labelKey,
  valueKey,
  onClick,
}: {
  data: Array<Record<string, any>>;
  labelKey: string;
  valueKey: string;
  onClick?: (entry: Record<string, any>) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(280, data.length * 32)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
      >
        <XAxis
          type="number"
          tick={{ fill: "#8E9196", fontSize: 12, fontFamily: "Calibri" }}
          axisLine={{ stroke: "#D4C5A9" }}
          tickLine={{ stroke: "#D4C5A9" }}
        />
        <YAxis
          type="category"
          dataKey={labelKey}
          tick={{ fill: "#0F1113", fontSize: 13, fontFamily: "Calibri" }}
          axisLine={{ stroke: "#D4C5A9" }}
          tickLine={false}
          width={140}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#F5F0E8",
            border: "1px solid #D4C5A9",
            borderRadius: "6px",
            fontFamily: "Calibri",
            fontSize: "13px",
          }}
          labelStyle={{ color: "#1A1C1E", fontWeight: "bold" }}
          itemStyle={{ color: "#0F1113" }}
          cursor={{ fill: "rgba(197, 160, 89, 0.08)" }}
          formatter={(value: number) => [value.toLocaleString("en-GB"), "Organisations"]}
        />
        <Bar
          dataKey={valueKey}
          fill="#C5A059"
          radius={[0, 4, 4, 0]}
          onClick={(_, idx) => onClick?.(data[idx])}
          cursor={onClick ? "pointer" : "default"}
        >
          {data.map((_, idx) => (
            <Cell key={idx} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
