# 阶段 A PostgreSQL 集成验证

## 已验证结果

2026-09-05 在本地 Docker `postgres:17-alpine` 运行；数据库实际版本为 **PostgreSQL 17.11**，Node.js **22.23.2**。

- `npm run typecheck`：通过。
- `npx tsx --test test/postgres.integration.ts`（已通过环境变量配置连接）：**6 通过，0 失败，0 跳过**。
- `npm run test:postgres`（加入空闲连接中断回归后）：**7 通过，0 失败，0 跳过**，再次类型检查通过。
- 测试完成后查询 `pg_namespace`：`tujiang_test_` 前缀 schema 剩余 **0**。
- 未配置 `TEST_DATABASE_URL` 时执行独立测试：**退出码 1**，明确提示缺少连接配置，不会跳过后显示成功。

| 测试 | 验证内容 |
|---|---|
| 迁移与事务 | 两个独立连接池并发迁移，重复迁移保持三张预期表；事务抛错后业务对象与历史快照均回滚 |
| 并发版本 | 同一业务版本的两个独立写入只有一个成功，另一个得到 `VERSION_CONFLICT`，失败者不新增快照或回执 |
| 并发幂等 | 两个连接同时提交相同 key，只执行一次变更，返回相同结果；改用不同操作复用 key 得到 `IDEMPOTENCY_CONFLICT` |
| Worker 领取 | 第一个 Worker 的模型调用仍在进行时，第二个 Worker 不会再次执行同一任务；最终仅一次调用、一次 attempt |
| 租约与重试 | 人为将测试任务租约置为过去时间，接管扫描标记 `WORKER_INTERRUPTED`；迟到结果不生效，显式重试后第二次 attempt 成功 |
| 连接恢复 | 关闭两个原连接池，再建立新连接池；项目、审计、历史快照和幂等回执保持一致 |
| 空闲连接异常 | 仅终止测试自身 schema 中获取的连接 PID，并匹配连接开始时间；受控错误回调触发一次，后续查询创建新连接，项目和历史仍保持一致 |

## 重复执行

在仓库根目录启动项目专用 PostgreSQL：

```powershell
docker compose -p tujiang-stage-a -f backend/compose.yaml up -d postgres
cd backend
npm run typecheck
npm run test:postgres
```

`test:postgres` 从本地 `.env` 加载 `TEST_DATABASE_URL`；也可以通过当前进程环境变量提供。连接值不应提交版本库或打印到日志。数据库账号需要创建和删除测试 schema 的权限。

独立命令不读取 `.env`，适合已有安全环境变量注入的 CI：

```powershell
npx tsx --test test/postgres.integration.ts
```

`postgres.integration.ts` 不匹配默认 `*.test.ts`，真实数据库测试必须单独执行；普通单元测试通过不能代替本项结果。

## 隔离与边界

每项测试通过随机 UUID 创建 `tujiang_test_<32位十六进制>` schema，先验证名称格式，再将测试连接的 `search_path` 限定为该 schema，并校验 `current_schema()`。最终关闭所有测试连接池，仅删除该次创建的 schema。测试使用生产 `postgres()`、`migrate()`、`Store` 与 `Worker`，没有使用 PGlite。

模型是内存替身，测试不调用 OpenRouter，不评估模型质量。租约到期由修改测试数据模拟，不必等待 120 秒。连接恢复和单个空闲连接中断测试证明新连接能读取已提交数据，**不代表 PostgreSQL 容器或主机重启测试**，也不代表备份恢复、生产高可用或真实规格书端到端验收。容器重启和 API 服务启动证据由主集成任务单独核验。
