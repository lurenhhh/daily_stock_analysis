# 开发文档 · L2-lite 最小可验证登录（零成本版）

> 版本：v0.1
> 日期：2026-08-25
> 定位：用**最小成本**验证「注册/登录 + 看板跨设备同步」是否成立，不追求完整与规模
> 与完整版关系：这是《开发文档-L2-账号体系与云端同步》的**先行验证版**，验证通过后再平滑升级到完整 L2

---

## 1. 目标（只验证一件事）

**用户能注册、能登录，登录后看板数据跟着账号走、换设备也在。** 其余一律推迟。

---

## 2. 极简原则

- **不花钱**：只用免费/自建的东西，零按量费用、零第三方资质。
- **复用现有**：尽量在你已有的认证 + SQLAlchemy + service 分层上加，不引入新中间件。
- **能删就删**：任何"规模化/健壮性/商业化"相关的东西，验证阶段一律不做（见第 8 节推迟清单）。

---

## 3. 技术选型（全部零成本）

| 项 | 选择 | 为什么 |
|----|------|--------|
| 登录方式 | **邮箱 + 密码** | 无短信按量费、无签名资质、无微信企业门槛，代码即可实现 |
| 邮箱验证 | **MVP 跳过**（注册即用） | 省事省钱；如需可复用你现有的邮件推送配置（`EMAIL_SENDER` 等），零额外成本 |
| 数据库 | **SQLite（沿用现有 `DatabaseManager`）** | 你现在就在用，零新增基础设施；验证阶段够用 |
| 会话 | **复用现有 cookie session**（`src.auth` 的 `COOKIE_NAME` 思路），加上 `user_id` | 不引入 JWT/Redis |
| 频控/缓存 | **不引入 Redis**；登录失败用现有 429 逻辑即可 | 验证阶段无需 |
| 部署 | 跑在你现有服务器或本地 | 零新增成本 |

---

## 4. 数据模型（最小两张表）

```
users
  id            PK
  email         varchar unique
  password_hash varchar            -- argon2/bcrypt，绝不存明文
  nickname      varchar nullable
  created_at    timestamptz

user_dashboard                     -- 整个看板存成一个 JSON，不建 items 表
  user_id       PK/FK -> users.id
  data_json     text               -- 序列化的 DashboardItem[]
  updated_at    timestamptz
```

> 关键简化：看板不拆成 `dashboard_items` 多行，而是**整存为一个 JSON blob**。读=返回 blob，写=覆盖 blob。验证阶段完全够用，升级时再拆表（见第 9 节）。

---

## 5. API（5 个够了）

全部挂在现有 `/api/v1` 下，私有接口依赖 `get_current_user`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/register` | 邮箱 + 密码注册（成功即登录，下发 cookie） |
| POST | `/api/v1/auth/login` | 邮箱 + 密码登录 |
| POST | `/api/v1/auth/logout` | 注销 |
| GET | `/api/v1/me/dashboard` | 拉取当前用户看板 JSON |
| PUT | `/api/v1/me/dashboard` | 覆盖保存看板 JSON（**last-write-wins，不做冲突处理**） |

```jsonc
// POST /api/v1/auth/register
{ "email": "a@b.com", "password": "******", "nickname": "老李" }
// -> 200 Set-Cookie: <session>; { "user": { "id": "...", "email": "a@b.com" } }

// GET /api/v1/me/dashboard -> 200
{ "items": [ /* DashboardItem[] 原样 */ ], "updatedAt": "..." }

// PUT /api/v1/me/dashboard
{ "items": [ /* DashboardItem[] */ ] }
// -> 200 { "ok": true, "updatedAt": "..." }
```

> `items` 直接沿用前端现有的 `DashboardItem` 结构，前后端零转换。

---

## 6. 后端落地（最小改动）

- **建表**：users + user_dashboard（走你现有的建表/迁移方式）。
- **扩展 `src.auth`**：会话里带上 `user_id`；新增按 session 反查 `user_id` 的函数。
- **新增 `get_current_user` 依赖**（`api/deps.py`）：无有效会话返回 401。
- **新增 service**：`UserService`（注册/校验密码）、`DashboardService`（读/写 JSON）。
- **密码哈希**：argon2id 或 bcrypt。
- 现有 `/api/v1/valuation/*` 等无状态接口**完全不动**。

---

## 7. 前端改动（最小）

- `LoginPage`：改成邮箱 + 密码的登录/注册表单（复用现有样式与 429 处理）。
- `AuthContext` / `authApi`：加 `register`、`login(email,password)`、`getMe`。
- **看板 store**：`utils/myDashboard.ts` 保持 `localStorage` 逻辑不变，只加一层：
  - **未登录** → 纯本地（现状，L1 无缝）。
  - **登录后** → 登录时 `GET` 拉服务端看板覆盖本地；本地变更（增删/拖拽）去抖后 `PUT` 覆盖服务端。
  - **首次登录迁移**：若服务端为空而本地非空，把本地看板 `PUT` 上去一次。
- 现有 `MY_DASHBOARD_CHANGED_EVENT` 语义保留，`AddToDashboardButton` 等**无需改动**。

---

## 8. 明确推迟（验证阶段都不做）

- 手机号短信验证码、微信登录（要钱/要企业资质）。
- PostgreSQL、Redis、Alembic 复杂迁移。
- 看板拆 `dashboard_items` 表、条目级同步、`version`/`409` 冲突合并。
- 自定义模版云端（`user_templates`）。
- 会员/权限（`user_entitlements`）与配额。
- 登录设备管理、账号注销链路、邮箱验证/找回密码。
- 多用户模式开关（`AUTH_MODE`）——验证阶段直接就是多用户即可。

---

## 9. 升级到完整 L2 的路径（验证通过后）

- **登录**：邮箱密码 → 增加手机验证码 / 微信登录（M3）。
- **看板存储**：JSON blob → 拆 `dashboard_items` 表 + `version` 乐观并发 + `409` 处理。
- **数据库**：SQLite → PostgreSQL（SQLAlchemy 抽象，迁移平滑）。
- **补齐**：Redis 频控、自定义模版云端、会员权益、账号注销与合规。

> 因为看板 API 形态（`GET/PUT /me/dashboard`）不变、`DashboardItem` 结构不变，从 blob 升级到拆表对前端基本无感。

---

## 10. 成本与门槛

- **软件/基础设施成本：¥0**（SQLite 自带、无短信、无 Redis、跑在现有服务器/本地）。
- **唯一提醒**：如果验证阶段要**公开**给不特定用户访问的境内域名，仍需 ICP 备案；若只是小范围内测（自己/朋友/内测账号），用现有服务器或临时域名即可，先不折腾备案。

---

## 11. 工期与验收

- **预计工期**：约 1–2 周（后端 5 个接口 + 2 张表；前端登录页 + store 同步层）。
- **验收标准**：
  1. 能用邮箱密码注册并登录。
  2. 登录后在 A 设备加的看板，B 设备登录同账号能看到。
  3. 未登录时本地生成的看板，首次登录后被迁移到账号且不丢。
  4. 退出登录后回到本地态，不串号。

---

*本文档为最小验证版设计。目标是最低成本跑通登录与同步；健壮性、规模化、商业化项均在验证通过后按完整 L2 补齐。*
