import React from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  FundamentalsResponse,
  MetricKey,
  MetricSeries,
  PeHistoryResponse,
} from '../../api/valuation';
import type { UiLanguage } from '../../i18n/uiText';
import {
  CHART_COLORS,
  METRIC_CONFIG_BY_KEY,
  buildFundData,
  fmtNumber,
  fundUnitText,
  getPeMetricLabel,
  type FundPoint,
  type Translate,
} from './chartUtils';

export const LegendItem: React.FC<{ color: string; label: string; dashed?: boolean; filled?: boolean }> = ({
  color,
  label,
  dashed,
  filled,
}) => (
  <span className="inline-flex items-center gap-2">
    {filled ? (
      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
    ) : (
      <span
        className="inline-block h-0 w-5 border-t-2"
        style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
      />
    )}
    {label}
  </span>
);

// ------------------------------ tooltips ------------------------------

const PeTooltip: React.FC<{
  active?: boolean;
  payload?: { payload?: { date?: string; pe?: number } }[];
  language: UiLanguage;
  t: Translate;
}> = ({ active, payload, language, t }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }
  return (
    <div className="rounded-xl border border-border/70 bg-card/95 px-3 py-2 text-xs shadow-soft-card backdrop-blur">
      <p className="text-secondary-text">{point.date}</p>
      <p className="mt-1 font-semibold text-foreground">
        {t('valuation.tooltip.pe')}: {fmtNumber(point.pe, language)}
      </p>
    </div>
  );
};

const FundTooltip: React.FC<{
  active?: boolean;
  payload?: { payload?: FundPoint }[];
  language: UiLanguage;
  unit: string;
  t: Translate;
}> = ({ active, payload, language, unit, t }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }
  return (
    <div className="rounded-xl border border-border/70 bg-card/95 px-3 py-2 text-xs shadow-soft-card backdrop-blur">
      <p className="text-secondary-text">{point.year}</p>
      {typeof point.revenue === 'number' ? (
        <p className="mt-1 font-medium" style={{ color: CHART_COLORS.revenue }}>
          {t('valuation.tooltip.revenue')}: {fmtNumber(point.revenue, language)} {unit}
        </p>
      ) : null}
      {typeof point.marketCap === 'number' ? (
        <p className="mt-1 font-medium" style={{ color: CHART_COLORS.marketCap }}>
          {t('valuation.tooltip.marketCap')}: {fmtNumber(point.marketCap, language)} {unit}
        </p>
      ) : null}
    </div>
  );
};

const MetricTooltip: React.FC<{
  active?: boolean;
  payload?: { payload?: { year?: string; value?: number } }[];
  color: string;
  unit: string;
  label: string;
  language: UiLanguage;
}> = ({ active, payload, color, unit, label, language }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const point = payload[0]?.payload;
  if (!point || typeof point.value !== 'number') {
    return null;
  }
  return (
    <div className="rounded-xl border border-border/70 bg-card/95 px-3 py-2 text-xs shadow-soft-card backdrop-blur">
      <p className="text-secondary-text">{point.year}</p>
      <p className="mt-1 font-medium" style={{ color }}>
        {label}: {fmtNumber(point.value, language)} {unit}
      </p>
    </div>
  );
};

// ------------------------------ chart views ------------------------------

/** 历史 PE 折线 + 正态分布高估/平均/低估参考线 */
export const PeChart: React.FC<{ data: PeHistoryResponse; language: UiLanguage; t: Translate }> = ({
  data,
  language,
  t,
}) => {
  const stats = data.stats;
  if (!stats) {
    return null;
  }
  const lo = Math.min(stats.min, stats.undervalued);
  const hi = Math.max(stats.max, stats.overvalued);
  const pad = Math.max((hi - lo) * 0.05, 0.5);
  const yDomain: [number, number] = [Math.max(0, lo - pad), hi + pad];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-secondary-text">
        <LegendItem color={CHART_COLORS.pe} label={getPeMetricLabel(data.metric, t)} />
        <LegendItem color={CHART_COLORS.overvalued} label={t('valuation.band.high')} dashed />
        <LegendItem color={CHART_COLORS.mean} label={t('valuation.band.mean')} dashed />
        <LegendItem color={CHART_COLORS.undervalued} label={t('valuation.band.low')} dashed />
      </div>
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.series} margin={{ top: 10, right: 16, bottom: 8, left: 4 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
              tickFormatter={(value: string) => (typeof value === 'string' ? value.slice(0, 4) : String(value))}
              minTickGap={48}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
            />
            <YAxis
              domain={yDomain}
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
              tickFormatter={(value: number) => fmtNumber(value, language, 0)}
              width={48}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
            />
            <Tooltip content={<PeTooltip language={language} t={t} />} />
            <ReferenceLine
              y={stats.overvalued}
              stroke={CHART_COLORS.overvalued}
              strokeDasharray="5 4"
              label={{ value: t('valuation.band.high'), position: 'insideTopRight', fill: CHART_COLORS.overvalued, fontSize: 11 }}
            />
            <ReferenceLine
              y={stats.mean}
              stroke={CHART_COLORS.mean}
              strokeDasharray="5 4"
              label={{ value: t('valuation.band.mean'), position: 'insideTopRight', fill: CHART_COLORS.mean, fontSize: 11 }}
            />
            <ReferenceLine
              y={stats.undervalued}
              stroke={CHART_COLORS.undervalued}
              strokeDasharray="5 4"
              label={{ value: t('valuation.band.low'), position: 'insideBottomRight', fill: CHART_COLORS.undervalued, fontSize: 11 }}
            />
            <Line
              type="monotone"
              dataKey="pe"
              stroke={CHART_COLORS.pe}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-secondary-text">{t('valuation.chartFootnote')}</p>
    </>
  );
};

/** 总营收(年度柱) + 总市值(年末线) 组合图 */
export const FundChart: React.FC<{ fundamentals: FundamentalsResponse; language: UiLanguage; t: Translate }> = ({
  fundamentals,
  language,
  t,
}) => {
  const fundData = buildFundData(fundamentals);
  const unit = fundUnitText(fundamentals, t);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-secondary-text">
        <LegendItem color={CHART_COLORS.revenue} label={t('valuation.legend.revenue')} filled />
        <LegendItem color={CHART_COLORS.marketCap} label={t('valuation.legend.marketCap')} />
        <span>· {t('valuation.unitLabel', { unit })}</span>
      </div>
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={fundData} margin={{ top: 10, right: 8, bottom: 8, left: 4 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis
              dataKey="year"
              type="category"
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
              minTickGap={16}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
            />
            <YAxis
              yAxisId="revenue"
              orientation="left"
              tick={{ fill: CHART_COLORS.revenue, fontSize: 11 }}
              tickFormatter={(value: number) => fmtNumber(value, language, 0)}
              width={52}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
            />
            <YAxis
              yAxisId="cap"
              orientation="right"
              tick={{ fill: CHART_COLORS.marketCap, fontSize: 11 }}
              tickFormatter={(value: number) => fmtNumber(value, language, 0)}
              width={56}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
              content={<FundTooltip language={language} unit={unit} t={t} />}
            />
            <Bar
              yAxisId="revenue"
              dataKey="revenue"
              fill={CHART_COLORS.revenue}
              maxBarSize={72}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              yAxisId="cap"
              type="monotone"
              dataKey="marketCap"
              stroke={CHART_COLORS.marketCap}
              strokeWidth={1.8}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-secondary-text">{t('valuation.fundFootnote')}</p>
    </>
  );
};

/** 单个扩展财务指标图（折线或柱状） */
export const MetricChartView: React.FC<{
  metricKey: MetricKey;
  series: MetricSeries;
  currency: string;
  language: UiLanguage;
  t: Translate;
}> = ({ metricKey, series, currency, language, t }) => {
  const cfg = METRIC_CONFIG_BY_KEY[metricKey];
  const color = cfg?.color ?? CHART_COLORS.pe;
  const label = cfg ? t(cfg.labelKey) : metricKey;
  const amountUnit = `${'亿'}${currency ? ` ${currency}` : ''}`;
  const unit = series.unit === '%' ? '%' : amountUnit;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary-text">
        <LegendItem color={color} label={label} filled={series.kind === 'bar'} />
        <span>· {t('valuation.unitLabel', { unit })}</span>
      </div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series.points} margin={{ top: 10, right: 8, bottom: 8, left: 4 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis
              dataKey="year"
              type="category"
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
              minTickGap={16}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
            />
            <YAxis
              tick={{ fill: CHART_COLORS.axis, fontSize: 11 }}
              tickFormatter={(value: number) => fmtNumber(value, language, 0)}
              width={48}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
              content={<MetricTooltip color={color} unit={unit} label={label} language={language} />}
            />
            {series.kind === 'bar' ? (
              <Bar dataKey="value" fill={color} maxBarSize={72} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            ) : (
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.8}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
};
