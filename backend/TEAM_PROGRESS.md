# 阶段 A 开发分工与验证

用户在当前项目明确要求“现在分工进行开发吧”。本轮由原项目主线程直接协调原生子 Agent；旧 `AGENT_TEAM_INTAKE.yaml` 留作历史草案，未声称向其他控制中心送达或登记。

所有原生子线程共享文件系统。本轮通过互斥文件所有权并行开发，没有创建独立 Git Worktree。现有 `docs/`、`tmp_aw/` 和前端保持原状，不提交或合并 Git。

| 工作包 | 原生子线程 / agent_id | 文件所有权 | 状态 |
| --- | --- | --- | --- |
| PG-01 / PG-02 | `/root/postgres_integration` | `test/postgres.integration.ts`、`POSTGRES_VALIDATION.md` | 完成，7项真实PG测试经独立复验 |
| EVAL-01 | `/root/model_evaluation` | `evaluation/`、`test/evaluation.test.ts`、`MODEL_CAPABILITIES.md` | 完成，冲突门返工经独立复验 |
| 集成 | `/root` | 依赖、环境示例、运行入口、README、本台账；必要共享代码修复 | 完成，本地API及数据库重启恢复实测通过 |
| QA-01 | `/root/independent_qa` | 只读实现，可运行验证；不自行修复代码 | 通过，无剩余本轮阻断项 |

任务模型继承当前会话配置，未要求或执行模型覆盖。以上路径是工具返回的真实子 Agent 标识；不虚构顶层 threadId 或独立主机。

## 验收范围

- 后端不再依赖父前端工程，独立安装可以复现。
- 在本轮创建的本地 PostgreSQL 容器上验证真实事务、并发幂等、Worker 领取及恢复；集成测试只创建/清理其自身随机 schema。
- 离线评测使用明确标注的合成样本，验证结构、引用及规则；自动通过不能替代人工语义验收或真实模型评测。
- 独立 QA 对实际集成结果出具结论；不足交回对应实现线程修复。

## 当前环境

Docker Desktop 已启动。本轮使用 Compose 项目 `tujiang-stage-a`，数据库服务 `postgres`，本机端口 55432。访问凭据只在被 Git 忽略的 `.env` 中配置，不写入本台账。

真实产品样本、OpenRouter 候选模型与 Key 尚未提供；它们只阻塞真实模型评测。未接入真实前端、生产鉴权或正式导出。

## 验证结果（2026-09-05）

| 命令 / 检查 | 结果 | 执行者 |
| --- | --- | --- |
| `npm ci`，`npm ls --depth=0` | 独立后端安装通过，父前端依赖及锁文件残留已移除 | 主线程 |
| `npm run migrate` | 本轮创建的PostgreSQL 17.11实例迁移成功 | 主线程 |
| `npm test` | 26通过，0失败 | 独立QA |
| `npm run test:postgres` | 7通过，0失败，0跳过 | 后端Agent、独立QA分别执行 |
| `npm run typecheck`、`npm run build` | 通过 | 独立QA |
| `npm run verify:local-runtime -- --restart` | 重启前ready、提交数据保留、重启后API ready三项通过 | 主线程 |
| `npm run evaluate:offline -- evaluation/fixtures/synthetic-extraction.json evaluation/fixtures/synthetic-extraction-output.json` | 自动检查通过，`needs_human_review`，`businessAcceptance=false` | 主线程 |

## 返工记录

1. 主线程真实容器重启探针发现P1：连接池空闲连接错误未处理导致API退出；独立QA也指出该缺陷。主线程在`src/database.ts`接住错误事件，`src/main.ts`只记录固定脱敏提示；后端Agent新增仅终止自身测试连接的第7项回归，QA独立复验通过。真实容器重启由主线程再次验证通过。
2. 独立QA发现P2：离线规划样本装载时将事实统一标记为无冲突，可能漏过规划门。评测Agent改为复用生产`refreshConflicts`，补confirmed/candidate及confirmed/confirmed回归；QA独立复验通过。

本记录只宣布本轮工程工作包通过。没有真实OpenRouter调用成绩，不代表阶段A真实产品验收或阶段B交付完成；也没有向外部控制中心登记完成状态。
