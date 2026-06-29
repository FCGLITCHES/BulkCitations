import {
  Cell,
  Legend,
  Pie,
  PieChart,
  Tooltip,
} from "recharts";
import {
  buildCitationStatusPieRows,
  type CitationPieRow,
} from "@/lib/admin-citation-status-chart";
import { SafeResponsiveChart } from "./SafeResponsiveChart";

const tooltipClass =
  "rounded-xl border border-slate-500/40 bg-slate-950/95 px-3 py-2.5 text-xs text-slate-100 shadow-lg backdrop-blur-sm max-w-[260px]";

type CitationStatusTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: CitationPieRow }>;
};

function CitationStatusTooltip({
  active,
  payload,
}: CitationStatusTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as CitationPieRow;
  if (row.statusKey === "empty") {
    return (
      <div className={tooltipClass}>
        <p className="font-bold text-slate-50">{row.name}</p>
        <p className="mt-1 leading-snug text-slate-400">{row.description}</p>
      </div>
    );
  }
  return (
    <div className={tooltipClass}>
      <p className="font-bold text-slate-50">{row.name}</p>
      <p className="mt-1 leading-snug text-slate-400">{row.description}</p>
      <p className="mt-2 tabular-nums text-slate-200">
        <span className="font-semibold">{row.value.toLocaleString()}</span>
        <span className="text-slate-400"> citations</span>
        <span className="text-slate-500"> · </span>
        <span>{row.percentOfTotal.toFixed(1)}%</span>
        <span className="text-slate-500"> of total</span>
      </p>
    </div>
  );
}

function legendFormatter(value: string, entry: unknown) {
  const row = (entry as { payload?: CitationPieRow })?.payload;
  if (!row || row.statusKey === "empty") return value;
  return `${value} — ${row.value.toLocaleString()} (${row.percentOfTotal.toFixed(1)}%)`;
}

export type CitationStatusPieChartProps = {
  citationsByStatus: Record<string, number> | null | undefined;
  /** Outer wrapper height (chart + legend), e.g. h-56 */
  className?: string;
  innerRadius?: number;
  outerRadius?: number;
  /** Vertical position of pie center (leave room for legend below) */
  cy?: string | number;
};

export function CitationStatusPieChart({
  citationsByStatus,
  className = "h-64 w-full",
  innerRadius = 45,
  outerRadius = 80,
  cy = "42%",
}: CitationStatusPieChartProps) {
  const rows = buildCitationStatusPieRows(citationsByStatus);

  return (
    <SafeResponsiveChart className={className} minHeight={200}>
        <PieChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy={cy}
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth={1}
          >
            {rows.map((entry, i) => (
              <Cell key={`${entry.statusKey}-${i}`} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip content={<CitationStatusTooltip />} />
          <Legend
            verticalAlign="bottom"
            layout="horizontal"
            align="center"
            wrapperStyle={{ fontSize: 11, paddingTop: 6, lineHeight: 1.35 }}
            formatter={legendFormatter}
          />
        </PieChart>
    </SafeResponsiveChart>
  );
}
