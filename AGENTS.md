# Metapi Engineering Rules

These rules apply to the whole repository unless a deeper `AGENTS.md` overrides
them. They are intentionally opinionated and mechanical so humans and agents can
make small, consistent changes without re-learning the codebase each time.

## Local Fork Modifications (本 fork 独有改动)

本仓库是 metapi 的本地 fork，运行中的 docker 容器 `metapi`（镜像
`metapi-lowio:vN`，端口 5635->4000）由本仓库构建。上游没有以下改动，
rebase/合并上游时必须保留并重新验证：

1. **流式响应每个 chunk 携带 usage（PROXY_STREAM_USAGE_EVERY_CHUNK，默认开）**
   - 背景：AI coding agent 等严格客户端反序列化每个 SSE chunk 时强制要求
     `usage.total_tokens` 存在；标准 OpenAI 流式协议只在最后一个 chunk 带
     usage，导致 `missing field total_tokens` 报错。
   - 实现：`src/server/transformers/openai/chat/proxyStream.ts` 会话内累积
     上游 usage，并在写出前为每个下行 OpenAI chat SSE chunk 注入/补齐
     `usage`（中间 chunk 为已累积值或 0；已带 usage 的 chunk 自动补齐缺失
     的 `total_tokens`）。仅影响 openai 下游；claude 下游不变。
   - 配置：`PROXY_STREAM_USAGE_EVERY_CHUNK=false` 恢复标准行为。
   - 测试：`src/server/transformers/openai/chat/proxyStream.usageEveryChunk.test.ts`。

重建并替换容器的固定流程（先构建镜像，再停旧容器、用原 env/volume/port 启新容器）：

```bash
docker build -f docker/Dockerfile -t metapi-lowio:vN .
docker stop metapi && docker rm metapi
docker run -d --name metapi --restart unless-stopped \
  -p 5635:4000 -v metapi-data-local:/app/data --env-file <原容器 env> \
  metapi-lowio:vN
```

验证：流式 curl `/v1/chat/completions`，确认每个 chunk 都含
`"usage":{"prompt_tokens":..,"completion_tokens":..,"total_tokens":..}`。

## Golden Principles

- Prefer one source of truth. If a helper, contract, or workflow already owns
  an invariant, extend it instead of creating a parallel implementation.
- Fix the family, not just the symptom. When a bug comes from a repeated
  pattern, sweep adjacent paths in the same subsystem before calling the work
  done.
- Keep changes narrow and reviewable. Land one coherent slice at a time and
  avoid bundling unrelated cleanup into the same patch.

## Server Layers

- `src/server/routes/**` are adapters, not owners. Route files may register
  Fastify endpoints, parse request context, and delegate. They must not own
  protocol conversion, retry policy, stream lifecycle, billing, or
  persistence.
- If a helper is imported by anything outside one route file, it does not
  belong under `src/server/routes/proxy/`.
- `src/server/proxy-core/**` owns proxy orchestration. Endpoint fallback should
  flow through `executeEndpointFlow()`. Channel/session bookkeeping should flow
  through `sharedSurface.ts`.
- `src/server/transformers/**` are protocol-pure. Do not import from
  `src/server/routes/**`, Fastify, OAuth services, token router, or runtime
  dispatch modules. If a transformer needs a shared contract, move it to a
  neutral module first.
- Whole-body upstream reads in proxy orchestration should use
  `readRuntimeResponseText()` instead of direct `.text()` reads.

## Platform And Routing Rules

- Platform behavior must be explicit. Detection, endpoint preference, discovery
  transport, and management capability should come from one declared capability
  story, not scattered `if platform === ...` branches.
- Thin adapters must stay honest. Do not let a platform look feature-complete
  through inherited defaults if the underlying upstream does not support the
  feature.
- Retry classification and routing health classification should share the same
  failure vocabulary whenever possible.

## Database Rules

- One schema change requires three synchronized outputs: update the Drizzle
  schema, update SQLite migration history, and regenerate checked-in schema
  artifacts together.
- Cross-dialect bootstrap and upgrade SQL must be generated from the schema
  contract. Do not hand-write new MySQL/Postgres schema patches in feature
  code.
- Legacy schema compatibility is temporary and spec-owned. Additive startup
  shims should stay narrow and trace back to a feature compatibility spec.

## Web Rules

- Pages are orchestration surfaces, not shared utility libraries. Do not import
  one top-level page from another top-level page.
- Mobile behavior should reuse existing shared primitives first:
  `ResponsiveFilterPanel`, `ResponsiveBatchActionBar`, `MobileCard`,
  `useIsMobile`, and `mobileLayout.ts`.
- When a page grows a second complex modal, drawer, or panel family, extract it
  into a domain subfolder before adding more inline state and rendering logic.

## Guardrails

- Run `npm run repo:drift-check` before finishing changes that touch shared
  architecture boundaries.
- If you add a new boundary-heavy module, add or extend an architecture test in
  the same area so the rule becomes executable.
- Keep local planning files under `docs/plans/`. They are intentionally ignored
  by git and should not be treated as published documentation.
