// 持仓纪律 · 结构化投资底稿（五层）本地存储层。
// MVP：localStorage（仿 myDashboard）；登录后云同步留待 L2。

export type TriState = 'yes' | 'no' | 'unsure';
export type ReasonCategory =
  | 'valuation'
  | 'growth'
  | 'dividend'
  | 'moat'
  | 'management'
  | 'catalyst'
  | 'other';

export interface Holding {
  id: string;
  code: string;
  displayCode: string;
  name: string | null;
  market: string;
  cost?: number;
  quantity?: number;
  buyDate?: string;
  status: 'holding' | 'closed';
  createdAt: number;
  updatedAt: number;
}

// 第一层：商业模式
export interface BusinessModel {
  summary?: string;
  pros: string[];
  cons: string[];
  updatedAt: number;
}

// 第二层：护城河
export interface MoatVerdict {
  verdict: TriState;
  note?: string;
}
export interface MoatCustomType {
  id: string;
  label: string;
}
export interface MoatAssessment {
  width?: 'wide' | 'narrow' | 'none';
  trend?: 'widening' | 'stable' | 'narrowing';
  note?: string;
  verdicts: Record<string, MoatVerdict>; // typeId -> verdict
  customTypes: MoatCustomType[];
  updatedAt: number;
}

// 第三层：管理层
export interface ManagementMember {
  id: string;
  holdingId: string;
  name: string;
  title?: string;
  source: 'auto' | 'manual';
  note?: string;
  verdicts: Record<string, MoatVerdict>; // criterionId -> verdict
}

// 第四层：自定义财务指标
export interface WatchedMetric {
  id: string;
  holdingId: string;
  source: 'builtin' | 'custom';
  metricKey?: string;
  label: string;
  targetNote?: string;
  monitorLink?: string; // 预留：挂监控 L4
  order: number;
}

// 第五层：买卖理由
export interface HoldingReason {
  id: string;
  holdingId: string;
  type: 'buy' | 'sell';
  text: string;
  category?: ReasonCategory;
  status: 'active' | 'broken';
  brokenNote?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SellReviewCheck {
  reasonId: string;
  text: string;
  stillHolds: boolean;
}
export interface SellReviewLog {
  id: string;
  holdingId: string;
  createdAt: number;
  checks: SellReviewCheck[];
  sellReason?: string;
  decision: 'sold' | 'keep' | 'thinking';
}

// 默认模版（label 走 i18n：discipline.moat.type.<id> / discipline.mgmt.crit.<id>）
export const DEFAULT_MOAT_TYPES = ['intangibles', 'switching', 'network', 'cost', 'scale'] as const;
export const DEFAULT_MGMT_CRITERIA = [
  'capital',
  'minorityAlign',
  'integrity',
  'verifiable',
  'stakeholders',
  'longterm',
] as const;

export interface Store {
  holdings: Holding[];
  reasons: HoldingReason[];
  logs: SellReviewLog[];
  business: Record<string, BusinessModel>;
  moat: Record<string, MoatAssessment>;
  members: ManagementMember[];
  metrics: WatchedMetric[];
  mgmtCriteria: Record<string, MoatCustomType[]>; // holdingId -> custom criteria
}

const STORAGE_KEY = 'dsa:holdingDiscipline';
export const HOLDINGS_CHANGED_EVENT = 'dsa:holdingDisciplineChanged';

function emitChange(): void {
  try {
    window.dispatchEvent(new Event(HOLDINGS_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyStore(): Store {
  return { holdings: [], reasons: [], logs: [], business: {}, moat: {}, members: [], metrics: [], mgmtCriteria: {} };
}

export function loadStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyStore();
    }
    const p = JSON.parse(raw);
    const store: Store = {
      holdings: Array.isArray(p?.holdings) ? p.holdings : [],
      reasons: Array.isArray(p?.reasons) ? p.reasons : [],
      logs: Array.isArray(p?.logs) ? p.logs : [],
      business: p?.business && typeof p.business === 'object' ? p.business : {},
      moat: p?.moat && typeof p.moat === 'object' ? p.moat : {},
      members: Array.isArray(p?.members) ? p.members : [],
      metrics: Array.isArray(p?.metrics) ? p.metrics : [],
      mgmtCriteria: p?.mgmtCriteria && typeof p.mgmtCriteria === 'object' ? p.mgmtCriteria : {},
    };
    // 迁移：v0.1 理由无 type 字段 → 视为买入理由。
    store.reasons = store.reasons.map((r) => (r.type ? r : { ...r, type: 'buy' as const }));
    return store;
  } catch {
    return emptyStore();
  }
}

function saveStore(store: Store): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
  emitChange();
}

// ---------------- 持仓 ----------------
export function listHoldings(): Holding[] {
  return loadStore().holdings;
}
export function getHolding(id: string): Holding | undefined {
  return loadStore().holdings.find((h) => h.id === id);
}
export function addHolding(input: {
  code: string;
  displayCode: string;
  name: string | null;
  market: string;
  cost?: number;
  quantity?: number;
  buyDate?: string;
}): Holding {
  const store = loadStore();
  const existing = store.holdings.find(
    (h) => h.code.toUpperCase() === input.code.toUpperCase() && h.status === 'holding',
  );
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const holding: Holding = {
    id: newId(),
    code: input.code,
    displayCode: input.displayCode || input.code,
    name: input.name,
    market: input.market,
    cost: input.cost,
    quantity: input.quantity,
    buyDate: input.buyDate,
    status: 'holding',
    createdAt: now,
    updatedAt: now,
  };
  store.holdings.push(holding);
  saveStore(store);
  return holding;
}
export function updateHolding(id: string, patch: Partial<Holding>): void {
  const store = loadStore();
  const h = store.holdings.find((x) => x.id === id);
  if (!h) {
    return;
  }
  Object.assign(h, patch, { updatedAt: Date.now() });
  saveStore(store);
}
export function setHoldingStatus(id: string, status: 'holding' | 'closed'): void {
  updateHolding(id, { status });
}
export function removeHolding(id: string): void {
  const store = loadStore();
  store.holdings = store.holdings.filter((h) => h.id !== id);
  store.reasons = store.reasons.filter((r) => r.holdingId !== id);
  store.logs = store.logs.filter((l) => l.holdingId !== id);
  store.members = store.members.filter((m) => m.holdingId !== id);
  store.metrics = store.metrics.filter((m) => m.holdingId !== id);
  delete store.business[id];
  delete store.moat[id];
  delete store.mgmtCriteria[id];
  saveStore(store);
}

// ---------------- 第一层：商业模式 ----------------
export function getBusinessModel(holdingId: string): BusinessModel {
  return loadStore().business[holdingId] ?? { pros: [], cons: [], updatedAt: 0 };
}
export function saveBusinessModel(holdingId: string, patch: Partial<BusinessModel>): void {
  const store = loadStore();
  const cur = store.business[holdingId] ?? { pros: [], cons: [], updatedAt: 0 };
  store.business[holdingId] = { ...cur, ...patch, updatedAt: Date.now() };
  saveStore(store);
}

// ---------------- 第二层：护城河 ----------------
export function getMoat(holdingId: string): MoatAssessment {
  return loadStore().moat[holdingId] ?? { verdicts: {}, customTypes: [], updatedAt: 0 };
}
export function saveMoat(holdingId: string, patch: Partial<MoatAssessment>): void {
  const store = loadStore();
  const cur = store.moat[holdingId] ?? { verdicts: {}, customTypes: [], updatedAt: 0 };
  store.moat[holdingId] = { ...cur, ...patch, updatedAt: Date.now() };
  saveStore(store);
}
export function setMoatVerdict(holdingId: string, typeId: string, verdict: TriState, note?: string): void {
  const cur = getMoat(holdingId);
  const verdicts = { ...cur.verdicts, [typeId]: { verdict, note } };
  saveMoat(holdingId, { verdicts });
}
export function addMoatCustomType(holdingId: string, label: string): void {
  const clean = label.trim();
  if (!clean) {
    return;
  }
  const cur = getMoat(holdingId);
  saveMoat(holdingId, { customTypes: [...cur.customTypes, { id: newId(), label: clean }] });
}
export function removeMoatCustomType(holdingId: string, typeId: string): void {
  const cur = getMoat(holdingId);
  const verdicts = { ...cur.verdicts };
  delete verdicts[typeId];
  saveMoat(holdingId, { customTypes: cur.customTypes.filter((c) => c.id !== typeId), verdicts });
}

// ---------------- 第三层：管理层 ----------------
export function listMembers(holdingId: string): ManagementMember[] {
  return loadStore().members.filter((m) => m.holdingId === holdingId);
}
export function addMember(holdingId: string, name: string, title?: string, source: 'auto' | 'manual' = 'manual'): void {
  const clean = name.trim();
  if (!clean) {
    return;
  }
  const store = loadStore();
  if (store.members.some((m) => m.holdingId === holdingId && m.name === clean)) {
    return;
  }
  store.members.push({ id: newId(), holdingId, name: clean, title, source, verdicts: {} });
  saveStore(store);
}
export function removeMember(id: string): void {
  const store = loadStore();
  store.members = store.members.filter((m) => m.id !== id);
  saveStore(store);
}
export function setMemberVerdict(memberId: string, criterionId: string, verdict: TriState, note?: string): void {
  const store = loadStore();
  const m = store.members.find((x) => x.id === memberId);
  if (!m) {
    return;
  }
  m.verdicts = { ...m.verdicts, [criterionId]: { verdict, note } };
  saveStore(store);
}
export function listMgmtCustomCriteria(holdingId: string): MoatCustomType[] {
  return loadStore().mgmtCriteria[holdingId] ?? [];
}
export function addMgmtCustomCriterion(holdingId: string, label: string): void {
  const clean = label.trim();
  if (!clean) {
    return;
  }
  const store = loadStore();
  const cur = store.mgmtCriteria[holdingId] ?? [];
  store.mgmtCriteria[holdingId] = [...cur, { id: newId(), label: clean }];
  saveStore(store);
}
export function removeMgmtCustomCriterion(holdingId: string, criterionId: string): void {
  const store = loadStore();
  const cur = store.mgmtCriteria[holdingId] ?? [];
  store.mgmtCriteria[holdingId] = cur.filter((c) => c.id !== criterionId);
  saveStore(store);
}

// ---------------- 第四层：财务指标 ----------------
export function listMetrics(holdingId: string): WatchedMetric[] {
  return loadStore()
    .metrics.filter((m) => m.holdingId === holdingId)
    .sort((a, b) => a.order - b.order);
}
export function addMetric(
  holdingId: string,
  input: { source: 'builtin' | 'custom'; metricKey?: string; label: string; targetNote?: string },
): void {
  if (!input.label.trim()) {
    return;
  }
  const store = loadStore();
  const order = store.metrics.filter((m) => m.holdingId === holdingId).length;
  store.metrics.push({
    id: newId(),
    holdingId,
    source: input.source,
    metricKey: input.metricKey,
    label: input.label.trim(),
    targetNote: input.targetNote?.trim() || undefined,
    order,
  });
  saveStore(store);
}
export function updateMetric(id: string, patch: Partial<WatchedMetric>): void {
  const store = loadStore();
  const m = store.metrics.find((x) => x.id === id);
  if (!m) {
    return;
  }
  Object.assign(m, patch);
  saveStore(store);
}
export function removeMetric(id: string): void {
  const store = loadStore();
  store.metrics = store.metrics.filter((m) => m.id !== id);
  saveStore(store);
}

// ---------------- 第五层：买卖理由 ----------------
export function listReasons(holdingId: string, type?: 'buy' | 'sell'): HoldingReason[] {
  return loadStore().reasons.filter((r) => r.holdingId === holdingId && (type ? r.type === type : true));
}
export function addReason(
  holdingId: string,
  text: string,
  category?: ReasonCategory,
  type: 'buy' | 'sell' = 'buy',
): HoldingReason | null {
  const clean = text.trim();
  if (!clean) {
    return null;
  }
  const store = loadStore();
  const now = Date.now();
  const reason: HoldingReason = {
    id: newId(),
    holdingId,
    type,
    text: clean,
    category,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  store.reasons.push(reason);
  saveStore(store);
  return reason;
}
export function updateReason(id: string, patch: Partial<HoldingReason>): void {
  const store = loadStore();
  const r = store.reasons.find((x) => x.id === id);
  if (!r) {
    return;
  }
  Object.assign(r, patch, { updatedAt: Date.now() });
  saveStore(store);
}
export function setReasonStatus(id: string, status: 'active' | 'broken', brokenNote?: string): void {
  updateReason(id, { status, brokenNote: status === 'broken' ? brokenNote : undefined });
}
export function removeReason(id: string): void {
  const store = loadStore();
  store.reasons = store.reasons.filter((r) => r.id !== id);
  saveStore(store);
}

// ---------------- 对质日志 ----------------
export function listLogs(holdingId: string): SellReviewLog[] {
  return loadStore()
    .logs.filter((l) => l.holdingId === holdingId)
    .sort((a, b) => b.createdAt - a.createdAt);
}
export function addSellReviewLog(input: {
  holdingId: string;
  checks: SellReviewCheck[];
  sellReason?: string;
  decision: 'sold' | 'keep' | 'thinking';
}): SellReviewLog {
  const store = loadStore();
  const log: SellReviewLog = {
    id: newId(),
    holdingId: input.holdingId,
    createdAt: Date.now(),
    checks: input.checks,
    sellReason: input.sellReason,
    decision: input.decision,
  };
  store.logs.push(log);
  saveStore(store);
  return log;
}

// ---------------- 汇总辅助 ----------------
export interface HoldingSummary {
  filledLayers: number; // 0-5
  totalLayers: number;
  hasBrokenReason: boolean;
}
export function getHoldingSummary(holdingId: string): HoldingSummary {
  const store = loadStore();
  const bm = store.business[holdingId];
  const moat = store.moat[holdingId];
  const members = store.members.filter((m) => m.holdingId === holdingId);
  const metrics = store.metrics.filter((m) => m.holdingId === holdingId);
  const reasons = store.reasons.filter((r) => r.holdingId === holdingId);
  let filled = 0;
  if (bm && (bm.summary || bm.pros.length || bm.cons.length)) {
    filled += 1;
  }
  if (moat && (Object.keys(moat.verdicts).length || moat.width || moat.trend)) {
    filled += 1;
  }
  if (members.length) {
    filled += 1;
  }
  if (metrics.length) {
    filled += 1;
  }
  if (reasons.length) {
    filled += 1;
  }
  return {
    filledLayers: filled,
    totalLayers: 5,
    hasBrokenReason: reasons.some((r) => r.type === 'buy' && r.status === 'broken'),
  };
}

// ---------------- 云同步（L2）辅助 ----------------
export function exportStore(): Store {
  return loadStore();
}
export function storeHasContent(store: Store): boolean {
  return (
    store.holdings.length > 0 ||
    store.reasons.length > 0 ||
    store.logs.length > 0 ||
    store.members.length > 0 ||
    store.metrics.length > 0 ||
    Object.keys(store.business).length > 0 ||
    Object.keys(store.moat).length > 0
  );
}
export function replaceStoreFromCloud(data: unknown): void {
  if (!data || typeof data !== 'object') {
    return;
  }
  const p = data as Partial<Store>;
  saveStore({
    holdings: Array.isArray(p.holdings) ? p.holdings : [],
    reasons: Array.isArray(p.reasons) ? p.reasons : [],
    logs: Array.isArray(p.logs) ? p.logs : [],
    business: p.business && typeof p.business === 'object' ? p.business : {},
    moat: p.moat && typeof p.moat === 'object' ? p.moat : {},
    members: Array.isArray(p.members) ? p.members : [],
    metrics: Array.isArray(p.metrics) ? p.metrics : [],
    mgmtCriteria: p.mgmtCriteria && typeof p.mgmtCriteria === 'object' ? p.mgmtCriteria : {},
  });
}
export function clearDiscipline(): void {
  saveStore(emptyStore());
}
