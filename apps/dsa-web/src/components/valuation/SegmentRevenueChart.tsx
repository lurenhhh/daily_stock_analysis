import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SegmentRevenueResponse } from '../../api/valuation';
import type { UiLanguage } from '../../i18n/uiText';
import { CHART_COLORS, fmtNumber, type Translate } from './chartUtils';

const PALETTE = [
  '#22d3ee',
  '#f59e0b',
  '#a78bfa',
  '#34d399',
  '#f87171',
  '#60a5fa',
  '#fb923c',
  '#f472b6',
  '#4ade80',
  '#eab308',
  '#94a3b8',
];

export const SegmentRevenueChart: React.FC<{
  data: SegmentRevenueResponse;
  language: UiLanguage;
  t: Translate;
}> = ({ data, language, t }) => {
  const rows = data.points.map((p) => {
    const row: Record<string, number | string> = { date: p.date };
    data.segments.forEach((seg, i) => {
      row[seg] = p.revenues[i] ?? 0;
    });
    return row;
  });

  const yearTick = (v: unknown) => (typeof v === 'string' ? v.slice(0, 4) : String(v));

  return (
    <div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={yearTick}
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
              minTickGap={20}
            />
            <YAxis
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
              width={46}
              tickFormatter={(v) => fmtNumber(Number(v), language, 0)}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(value, name) => [
                `${fmtNumber(value == null ? 0 : Number(value), language, 2)} ${t('valuation.unitYi')}`,
                String(name),
              ]}
            />
            {data.segments.map((seg, i) => (
              <Line
                key={seg}
                type="monotone"
                dataKey={seg}
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {data.segments.map((seg, i) => (
          <span key={seg} className="inline-flex items-center gap-1.5 text-xs text-secondary-text">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            {seg}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[0.7rem] text-secondary-text/70">
        {t('valuation.segment.classifyPrefix')}{data.classify || '—'} · {t('valuation.segment.unitNote')}
      </p>
    </div>
  );
};

export default SegmentRevenueChart;
