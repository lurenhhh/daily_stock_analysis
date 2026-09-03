import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { KlinePoint } from '../../api/valuation';
import type { UiLanguage, UiTextKey, UiTextParams } from '../../i18n/uiText';
import { fmtNumber } from './chartUtils';
import { cn } from '../../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const RANGES = [
  { key: '3m', days: 63 },
  { key: '1y', days: 250 },
  { key: '3y', days: 750 },
  { key: '10y', days: 2500 },
  { key: 'all', days: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

const UP = '#ef4444'; // 涨红（A股习惯）
const DOWN = '#22c55e'; // 跌绿

export const KlineChart: React.FC<{ data: KlinePoint[]; language: UiLanguage; t: Translate }> = ({ data, language, t }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  const [range, setRange] = useState<RangeKey>('1y');
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return undefined;
    }
    const ro = new ResizeObserver((entries) => setWidth(Math.max(320, entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? 250;
  const sliced = useMemo(() => (rangeDays > 0 ? data.slice(-rangeDays) : data), [data, rangeDays]);

  const H = 340;
  const padT = 10;
  const padB = 24;
  const padR = 54;
  const padL = 8;
  const volH = 56;
  const gap = 8;
  const priceTop = padT;
  const priceBottom = H - padB - volH - gap;
  const volTop = priceBottom + gap;
  const volBottom = H - padB;
  const innerW = width - padL - padR;

  const { minLow, maxHigh, maxVol } = useMemo(() => {
    let mn = Infinity;
    let mx = -Infinity;
    let mv = 0;
    sliced.forEach((d) => {
      mn = Math.min(mn, d.low);
      mx = Math.max(mx, d.high);
      mv = Math.max(mv, d.volume);
    });
    if (!Number.isFinite(mn)) {
      mn = 0;
      mx = 1;
    }
    return { minLow: mn, maxHigh: mx, maxVol: mv || 1 };
  }, [sliced]);

  const n = sliced.length;
  const step = n > 0 ? innerW / n : innerW;
  const cw = Math.max(1, Math.min(step * 0.7, 12));
  const x = (i: number) => padL + i * step + step / 2;
  const yP = (v: number) => priceTop + ((maxHigh - v) / ((maxHigh - minLow) || 1)) * (priceBottom - priceTop);
  const yV = (v: number) => volBottom - (v / maxVol) * (volBottom - volTop);

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => minLow + ((maxHigh - minLow) * i) / ticks);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round((px - padL - step / 2) / step);
    setHover(i >= 0 && i < n ? i : null);
  };

  const hd = hover != null ? sliced[hover] : null;

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="mb-2 flex items-center justify-end gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn('rounded-md px-2 py-0.5 text-xs transition-colors', range === r.key ? 'bg-cyan text-background' : 'text-secondary-text hover:text-foreground')}
          >
            {t(`kline.range.${r.key}` as UiTextKey)}
          </button>
        ))}
      </div>
      <svg width={width} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block">
        {gridVals.map((g, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={yP(g)} y2={yP(g)} stroke="rgba(148,163,184,0.14)" />
            <text x={width - padR + 4} y={yP(g) + 3} fontSize="10" fill="#94a3b8">
              {fmtNumber(g, language, 2)}
            </text>
          </g>
        ))}
        {sliced.map((d, i) => {
          const up = d.close >= d.open;
          const color = up ? UP : DOWN;
          const bodyTop = yP(Math.max(d.open, d.close));
          const bodyBot = yP(Math.min(d.open, d.close));
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={yP(d.high)} y2={yP(d.low)} stroke={color} strokeWidth={1} />
              <rect x={x(i) - cw / 2} y={bodyTop} width={cw} height={Math.max(1, bodyBot - bodyTop)} fill={color} />
              <rect x={x(i) - cw / 2} y={yV(d.volume)} width={cw} height={Math.max(0.5, volBottom - yV(d.volume))} fill={color} opacity={0.45} />
            </g>
          );
        })}
        {hd && hover != null ? (
          <line x1={x(hover)} x2={x(hover)} y1={priceTop} y2={volBottom} stroke="rgba(148,163,184,0.4)" strokeDasharray="3 3" />
        ) : null}
        {n > 0
          ? [0, Math.floor(n / 2), n - 1].map((i, k) => (
              <text key={k} x={x(i)} y={H - 8} fontSize="10" fill="#94a3b8" textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}>
                {sliced[i]?.date}
              </text>
            ))
          : null}
      </svg>
      {hd ? (
        <div className="pointer-events-none absolute left-2 top-8 rounded-lg border border-border/70 bg-card/95 px-2 py-1 text-[0.7rem] text-secondary-text shadow-soft-card">
          <div className="text-foreground">{hd.date}</div>
          <div>
            {t('kline.o')} {fmtNumber(hd.open, language, 2)} · {t('kline.h')} {fmtNumber(hd.high, language, 2)}
          </div>
          <div>
            {t('kline.l')} {fmtNumber(hd.low, language, 2)} · {t('kline.c')} {fmtNumber(hd.close, language, 2)}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default KlineChart;
