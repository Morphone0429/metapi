// 出站工具 Schema 归一化（shared）。
//
// 背景（2026-09-24 排查结论）：部分客户端（Codex 等）发出的工具 parameters
// 根节点缺 `"type": "object"`（生态已知缺陷类，如 vercel/ai#7924），
// Metapi 原样透传后，DashScope 等严格上游以
// `parameters must be a JSON Schema of type object` 拒绝（HTTP 400）。
//
// 修复策略（修在所有路径共同经过的出站点，而非逐个协议补丁）：
// - parameters/input_schema 为对象但缺 `type` → 注入 type:'object'；
// - 完全缺失 parameters → 默认 { type:'object', properties:{} }；
// - 非对象（null/字符串/数组）或根 type 明确为非 object → 丢弃该工具，
//   不静默透传畸形 Schema（严格上游必 400，宽松上游行为也不可预期）；
// - 合法 Schema 保真：已有 type:'object' 的对象一字不改（保持引用相等）。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 无参数工具（如 terminal_last_command）应产生的最小合法对象 Schema。
function emptyObjectSchema(): Record<string, unknown> {
  return { type: 'object', properties: {} };
}

// 归一化单个工具的参数 Schema；返回 null 表示该工具应被丢弃。
function sanitizeParameterSchema(schema: unknown): Record<string, unknown> | null {
  if (schema === undefined || schema === null) {
    return emptyObjectSchema();
  }
  if (!isRecord(schema)) {
    return null; // 字符串/数组等畸形 Schema：不可修复，丢弃工具
  }
  if (typeof schema.type === 'string') {
    if (schema.type.trim().toLowerCase() === 'object') return schema;
    return null; // 根节点明确为其他类型：无法作为工具参数
  }
  // 缺 type（无论是否有 properties/$defs 等）：统一补 object 根
  return { type: 'object', ...schema };
}

// 对单个 OpenAI function 工具做归一化；返回 null 表示丢弃。
function sanitizeOpenAiFunctionTool(tool: Record<string, unknown>): Record<string, unknown> | null {
  const fn = isRecord(tool.function) ? tool.function : null;
  if (!fn) return tool;
  const next = sanitizeParameterSchema(fn.parameters);
  if (next === null) return null;
  if (next !== fn.parameters) {
    return { ...tool, function: { ...fn, parameters: next } };
  }
  return tool;
}

// 对 Anthropic 风格工具（input_schema 直挂）做归一化；返回 null 表示丢弃。
function sanitizeAnthropicStyleTool(tool: Record<string, unknown>): Record<string, unknown> | null {
  const next = sanitizeParameterSchema(tool.input_schema);
  if (next === null) return null;
  if (next !== tool.input_schema) {
    return { ...tool, input_schema: next };
  }
  return tool;
}

// 出站前清洗 tools 数组。仅 function/custom 语义的工具受影响；
// server tools（web_search 等）与无法识别的条目原样保留，行为不变。
export function sanitizeOutboundToolSchemas<T>(rawTools: T): T {
  if (!Array.isArray(rawTools)) return rawTools;

  const out: unknown[] = [];
  for (const item of rawTools) {
    if (!isRecord(item)) {
      out.push(item);
      continue;
    }
    const type = typeof item.type === 'string' ? item.type.toLowerCase() : '';

    if (type === 'function' && isRecord(item.function)) {
      const sanitized = sanitizeOpenAiFunctionTool(item);
      if (sanitized !== null) out.push(sanitized);
      continue;
    }
    if (item.input_schema !== undefined) {
      const sanitized = sanitizeAnthropicStyleTool(item);
      if (sanitized !== null) out.push(sanitized);
      continue;
    }
    if ((type === 'custom' || type === 'function') && item.parameters !== undefined) {
      // 无 function 包装的 custom/function 变体（Responses additional_tools 等）
      const next = sanitizeParameterSchema(item.parameters);
      if (next === null) continue;
      if (next !== item.parameters) {
        out.push({ ...item, parameters: next });
        continue;
      }
      out.push(item);
      continue;
    }
    out.push(item);
  }
  return out as unknown as T;
}
