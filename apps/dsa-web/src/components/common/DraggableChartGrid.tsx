import React, { useEffect, useState } from 'react';
import { GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import { Card } from './Card';
import { cn } from '../../utils/cn';

export interface ChartPanelSpec {
  /** 稳定的面板唯一 id，用于记忆顺序与宽度 */
  id: string;
  /** 面板标题（显示在拖拽把手右侧） */
  title: string;
  /** 可选副标题 */
  subtitle?: React.ReactNode;
  /** 面板正文（图表等） */
  content: React.ReactNode;
  /** 未被用户手动调整过时的默认宽度：2=整行，1=半宽 */
  defaultSpan?: 1 | 2;
}

interface LayoutState {
  order: string[];
  spans: Record<string, 1 | 2>;
}

interface DraggableChartGridProps {
  panels: ChartPanelSpec[];
  /** localStorage 记忆布局用的 key */
  storageKey: string;
  labels: { half: string; full: string; dragHint: string };
}

function loadLayout(key: string): LayoutState | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LayoutState;
    if (!parsed || !Array.isArray(parsed.order) || typeof parsed.spans !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveLayout(key: string, state: LayoutState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* 忽略：隐私模式 / 存储不可用时不影响功能 */
  }
}

/**
 * 可拖拽重排 + 可切换整行/半宽的图表面板网格。
 * - 拖动卡片头部把手可调整先后顺序；
 * - 点击「半宽/整行」按钮，把两张图并排到同一行（半宽）或各占整行。
 * - 布局记忆到 localStorage（按 storageKey）。
 */
export const DraggableChartGrid: React.FC<DraggableChartGridProps> = ({ panels, storageKey, labels }) => {
  const fullKey = `dsa:chartgrid:${storageKey}`;

  const [layout, setLayout] = useState<LayoutState>(() => loadLayout(fullKey) ?? { order: [], spans: {} });
  const [dragId, setDragId] = useState<string | null>(null);

  // 持久化到 localStorage（写外部系统，属于 effect 的正当用途）
  useEffect(() => {
    saveLayout(fullKey, layout);
  }, [fullKey, layout]);

  // 在渲染期根据当前面板集合派生有效布局，避免在 effect 里 setState
  const ids = panels.map((panel) => panel.id);
  const defaultSpanById = new Map(panels.map((panel) => [panel.id, panel.defaultSpan ?? 2]));
  const effectiveOrder = [
    ...layout.order.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !layout.order.includes(id)),
  ];
  const spanOf = (id: string): 1 | 2 => layout.spans[id] ?? defaultSpanById.get(id) ?? 2;

  const normalizedSpans = (spans: Record<string, 1 | 2>): Record<string, 1 | 2> => {
    const next: Record<string, 1 | 2> = {};
    for (const id of ids) {
      next[id] = spans[id] ?? defaultSpanById.get(id) ?? 2;
    }
    return next;
  };

  const normalizedOrder = (order: string[]): string[] => [
    ...order.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !order.includes(id)),
  ];

  const handleDrop = (targetId: string) => {
    setDragId((currentDrag) => {
      if (currentDrag && currentDrag !== targetId) {
        setLayout((prev) => {
          const order = normalizedOrder(prev.order);
          const from = order.indexOf(currentDrag);
          const to = order.indexOf(targetId);
          if (from < 0 || to < 0) {
            return prev;
          }
          order.splice(from, 1);
          order.splice(to, 0, currentDrag);
          return { order, spans: normalizedSpans(prev.spans) };
        });
      }
      return null;
    });
  };

  const toggleSpan = (id: string) => {
    setLayout((prev) => {
      const spans = normalizedSpans(prev.spans);
      spans[id] = spans[id] === 2 ? 1 : 2;
      return { order: normalizedOrder(prev.order), spans };
    });
  };

  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const ordered = effectiveOrder
    .map((id) => byId.get(id))
    .filter((panel): panel is ChartPanelSpec => Boolean(panel));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {ordered.map((panel) => {
        const span = spanOf(panel.id);
        const isDropTarget = Boolean(dragId) && dragId !== panel.id;
        return (
          <div
            key={panel.id}
            className={cn(
              'min-w-0 transition-shadow',
              span === 2 ? 'lg:col-span-2' : 'lg:col-span-1',
              isDropTarget ? 'rounded-2xl ring-1 ring-cyan/40' : '',
              dragId === panel.id ? 'opacity-60' : '',
            )}
            onDragOver={(event) => {
              if (dragId) {
                event.preventDefault();
              }
            }}
            onDrop={() => handleDrop(panel.id)}
          >
            <Card className="h-full rounded-2xl" padding="md">
              <div
                className="mb-3 flex items-center gap-2"
                draggable
                onDragStart={() => setDragId(panel.id)}
                onDragEnd={() => setDragId(null)}
              >
                <span
                  className="cursor-grab text-secondary-text active:cursor-grabbing"
                  title={labels.dragHint}
                  aria-label={labels.dragHint}
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <h3 className="min-w-0 truncate text-lg font-semibold text-foreground">{panel.title}</h3>
                <button
                  type="button"
                  onClick={() => toggleSpan(panel.id)}
                  className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-card/70 px-2.5 py-1 text-xs text-secondary-text transition-colors hover:bg-hover hover:text-foreground"
                >
                  {span === 2 ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  {span === 2 ? labels.half : labels.full}
                </button>
              </div>
              {panel.subtitle ? <div className="mb-3 -mt-1">{panel.subtitle}</div> : null}
              {panel.content}
            </Card>
          </div>
        );
      })}
    </div>
  );
};

export default DraggableChartGrid;
