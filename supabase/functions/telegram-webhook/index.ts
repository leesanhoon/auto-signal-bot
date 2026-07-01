import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { logger } from "../../../src/shared/logger.ts";
import { buildStatsReport } from "../../../src/shared/stats-report.ts";
import { buildStatsMessage } from "../../../src/shared/stats.ts";
import { vnDateStr } from "../../../src/shared/vn-time.ts";
import {
  buildTelegramWebhookIdempotencyDescriptor,
  shouldProcessTelegramWebhookUpdate,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from "../../../src/shared/telegram-webhook-idempotency.ts";

type WorkflowConfig = {
  file: string;
  description: string;
  parseInputs?: (args: string[]) => Record<string, string>;
};

type WorkflowDispatchResult = {
  workflow_run_id?: number;
  run_url?: string;
  html_url?: string;
};

type InlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type CallbackAction =
  | { type: "menu"; menu: "main" | "lottery_verify" }
  | { type: "run"; command: keyof typeof COMMANDS; args: string[] };

const VERIFY_REGIONS = new Set(["mien-bac", "mien-trung", "mien-nam"]);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_KEY");

let supabaseClient: ReturnType<typeof createClient> | null = null;

const COMMANDS = {
  analyze: {
    file: "analyze.yml",
    description: "phân tích chart",
  },
  match_odds: {
    file: "match-odds.yml",
    description: "quét kèo bóng đá",
  },
  lottery: {
    file: "lottery.yml",
    description: "quét kết quả xổ số",
  },
  lottery_predict: {
    file: "lottery-predict.yml",
    description: "dự đoán xổ số",
  },
  lottery_verify: {
    file: "lottery-verify.yml",
    description: "xác minh kết quả xổ số theo miền",
    parseInputs: (args: string[]) => {
      const region = args[0]?.trim().toLowerCase();
      if (!region || !VERIFY_REGIONS.has(region)) {
        throw new Error("Miền không hợp lệ.");
      }

      return { region };
    },
  },
} satisfies Record<string, WorkflowConfig>;

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseClient;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function sendTelegramRequest(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram ${method} failed: ${body}`);
  }
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
  parseMode?: "Markdown",
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(parseMode ? { parse_mode: parseMode } : {}),
  };

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    if (parseMode && body.includes("can't parse entities")) {
      await sendTelegramMessage(botToken, chatId, text, replyMarkup);
      return;
    }
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
}

function normalizeTelegramCommandToken(
  token: string | undefined,
): string | null {
  if (!token) {
    return null;
  }

  const trimmed = token.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [command] = trimmed.split("@");
  return command;
}

async function editTelegramMessage(
  botToken: string,
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  await sendTelegramRequest(botToken, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function answerTelegramCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await sendTelegramRequest(botToken, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

async function dispatchWorkflow(
  githubToken: string,
  owner: string,
  repo: string,
  ref: string,
  workflow: WorkflowConfig,
  inputs: Record<string, string>,
): Promise<WorkflowDispatchResult | null> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow.file}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref, inputs }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub workflow dispatch failed: ${response.status} ${body}`,
    );
  }

  const rawBody = await response.text();
  if (!rawBody) return null;

  try {
    return JSON.parse(rawBody) as WorkflowDispatchResult;
  } catch {
    return null;
  }
}

async function claimTelegramWebhookIdempotency(
  idempotencyKey: string,
  eventType: "message" | "callback",
  payload: Record<string, unknown>,
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) {
    logger.warn(
      {
        eventType,
        idempotencyKey,
      },
      "Supabase env vars missing, skipping webhook idempotency check",
    );
    return true;
  }

  try {
    const { data, error } = await client.rpc(
      "claim_telegram_webhook_idempotency",
      {
        p_idempotency_key: idempotencyKey,
        p_event_type: eventType,
        p_payload: payload,
      },
    );

    if (error) {
      logger.warn(
        {
          eventType,
          idempotencyKey,
          error,
        },
        "Failed to claim webhook idempotency; continuing with fail-open fallback",
      );
      return true;
    }

    return Boolean(data);
  } catch (error) {
    logger.warn(
      {
        eventType,
        idempotencyKey,
        error,
      },
      "Webhook idempotency RPC threw; continuing with fail-open fallback",
    );
    return true;
  }
}

function buildMainMenuMessage(note?: string): string {
  return note ?? "Chọn tác vụ bên dưới:";
}

function buildMainMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "📊 Phân tích chart", callback_data: "run:analyze" },
        { text: "⚽ Quét kèo bóng đá", callback_data: "run:match_odds" },
      ],
      [
        { text: "🎰 Quét kết quả xổ số", callback_data: "run:lottery" },
        { text: "🔮 Dự đoán xổ số", callback_data: "run:lottery_predict" },
      ],
      [{ text: "✅ Xác minh kết quả ▸", callback_data: "menu:lottery_verify" }],
    ],
  };
}

function buildRegionSubmenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Miền Bắc", callback_data: "run:lottery_verify:mien-bac" },
        { text: "Miền Trung", callback_data: "run:lottery_verify:mien-trung" },
      ],
      [{ text: "Miền Nam", callback_data: "run:lottery_verify:mien-nam" }],
      [{ text: "◂ Quay lại", callback_data: "menu:main" }],
    ],
  };
}

function parseCallbackData(data: string): CallbackAction | null {
  const [kind = "", scope = "", part = ""] = data.trim().split(":");

  if (kind === "menu") {
    if (scope === "main" || scope === "lottery_verify") {
      return { type: "menu", menu: scope };
    }
    return null;
  }

  if (kind !== "run") return null;
  if (!(scope in COMMANDS)) return null;

  if (scope === "lottery_verify") {
    return VERIFY_REGIONS.has(part)
      ? { type: "run", command: scope, args: [part] }
      : null;
  }

  return { type: "run", command: scope as keyof typeof COMMANDS, args: [] };
}

function buildWorkflowSummary(inputs: Record<string, string>): string {
  if (Object.keys(inputs).length === 0) return "";
  return `\nInputs: ${Object.entries(inputs)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")}`;
}

function buildSuccessMessage(
  workflow: WorkflowConfig,
  inputs: Record<string, string>,
  dispatchResult: WorkflowDispatchResult | null,
): string {
  const inputSummary = buildWorkflowSummary(inputs);
  const runSummary = dispatchResult?.html_url
    ? `\nRun: ${dispatchResult.html_url}`
    : "";
  return `✅ Đã kích hoạt ${workflow.description} ${inputSummary}${runSummary}`;
}

function buildErrorMessage(workflow: WorkflowConfig, message: string): string {
  return `❌ Không thể kích hoạt ${workflow.description} \n${message}`;
}

async function showMenu(
  botToken: string,
  chatId: number | string,
): Promise<void> {
  await sendTelegramMessage(
    botToken,
    chatId,
    buildMainMenuMessage(),
    buildMainMenuKeyboard(),
  );
}

async function editMenu(
  botToken: string,
  chatId: number | string,
  messageId: number,
  menu: "main" | "lottery_verify",
): Promise<void> {
  if (menu === "main") {
    await editTelegramMessage(
      botToken,
      chatId,
      messageId,
      buildMainMenuMessage(),
      buildMainMenuKeyboard(),
    );
    return;
  }

  await editTelegramMessage(
    botToken,
    chatId,
    messageId,
    "Chọn miền để xác minh:",
    buildRegionSubmenuKeyboard(),
  );
}

async function runWorkflowFromCallback(
  botToken: string,
  callbackQueryId: string,
  chatId: number,
  messageId: number,
  githubToken: string,
  githubOwner: string,
  githubRepo: string,
  githubRef: string,
  command: keyof typeof COMMANDS,
  args: string[],
): Promise<Response> {
  const workflow = COMMANDS[command];

  let inputs: Record<string, string>;
  try {
    inputs = workflow.parseInputs ? workflow.parseInputs(args) : {};
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await answerTelegramCallbackQuery(
      botToken,
      callbackQueryId,
      "⏳ Đang xử lý...",
    );
    await editTelegramMessage(
      botToken,
      chatId,
      messageId,
      buildErrorMessage(workflow, messageText),
    );
    return Response.json({ ok: true, command, ignored: "invalid-input" });
  }

  await answerTelegramCallbackQuery(
    botToken,
    callbackQueryId,
    "⏳ Đang xử lý...",
  );
  await editTelegramMessage(
    botToken,
    chatId,
    messageId,
    `⏳ Đang kích hoạt ${workflow.description}...`,
  );

  try {
    const dispatchResult = await dispatchWorkflow(
      githubToken,
      githubOwner,
      githubRepo,
      githubRef,
      workflow,
      inputs,
    );
    await editTelegramMessage(
      botToken,
      chatId,
      messageId,
      buildSuccessMessage(workflow, inputs, dispatchResult),
    );
    return Response.json({
      ok: true,
      command,
      workflow: workflow.file,
      inputs,
      dispatchResult,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await editTelegramMessage(
      botToken,
      chatId,
      messageId,
      buildErrorMessage(workflow, messageText),
    );
    return Response.json({ ok: true, command, ignored: "dispatch-error" });
  }
}

async function handleStatsCommand(
  botToken: string,
  chatId: number,
): Promise<Response> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Missing Supabase configuration for /stats");
  }

  const now = new Date();
  const performanceSince = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const today = vnDateStr(now.getTime());

  const [
    { count: openPositionsCount, error: openPositionsError },
    closedPositionsResult,
    aiUsageResult,
  ] = await Promise.all([
    client
      .from("open_positions")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    client
      .from("open_positions")
      .select(
        "id, pair, direction, entry, stop_loss, take_profit_1, take_profit_2, status, closed_at, tp1_closed_percent, trailing_stop_loss, risk_reward_ratio, tp1_risk_reward_ratio, tp2_risk_reward_ratio, last_management_action, close_reason, realized_risk_reward_ratio, realized_exit_price",
      )
      .eq("status", "closed")
      .gte("closed_at", performanceSince)
      .order("closed_at", { ascending: true }),
    client
      .from("ai_usage")
      .select(
        "recorded_at, usage_date, provider, model, source, input_tokens, output_tokens, estimated_cost_usd, metadata",
      )
      .eq("usage_date", today)
      .order("recorded_at", { ascending: true }),
  ]);

  if (openPositionsError) {
    throw new Error(
      `Failed to load open positions: ${openPositionsError.message}`,
    );
  }
  if (closedPositionsResult.error) {
    throw new Error(
      `Failed to load closed positions: ${closedPositionsResult.error.message}`,
    );
  }
  if (aiUsageResult.error) {
    throw new Error(`Failed to load AI usage: ${aiUsageResult.error.message}`);
  }

  const report = buildStatsReport({
    openPositions: openPositionsCount ?? 0,
    closedPositions: (closedPositionsResult.data ?? []).map((row: any) => ({
      id: row.id,
      pair: row.pair,
      direction: row.direction,
      entry: row.entry,
      stopLoss: row.stop_loss,
      takeProfit1: row.take_profit_1,
      takeProfit2: row.take_profit_2,
      status: row.status,
      closedAt: row.closed_at,
      tp1ClosedPercent: row.tp1_closed_percent,
      trailingStopLoss: row.trailing_stop_loss,
      riskRewardRatio: row.risk_reward_ratio,
      tp1RiskRewardRatio: row.tp1_risk_reward_ratio,
      tp2RiskRewardRatio: row.tp2_risk_reward_ratio,
      lastManagementAction: row.last_management_action,
      closeReason: row.close_reason,
      realizedRiskRewardRatio: row.realized_risk_reward_ratio,
      realizedExitPrice: row.realized_exit_price,
    })),
    aiUsageRecords: (aiUsageResult.data ?? []).map((row: any) => ({
      recordedAt: row.recorded_at,
      usageDate: row.usage_date,
      provider: row.provider,
      model: row.model,
      source: row.source,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
      metadata: row.metadata ?? {},
    })),
    now,
    performanceWindowDays: 7,
  });

  await sendTelegramMessage(
    botToken,
    chatId,
    buildStatsMessage(report),
    undefined,
    "Markdown",
  );
  return Response.json({ ok: true, command: "stats" });
}

async function handleTelegramCallback(
  botToken: string,
  callbackQuery: TelegramCallbackQuery,
  githubToken: string,
  githubOwner: string,
  githubRepo: string,
  githubRef: string,
): Promise<Response> {
  const message = callbackQuery.message;
  if (!message?.chat?.id) {
    await answerTelegramCallbackQuery(
      botToken,
      callbackQuery.id,
      "Thiếu ngữ cảnh chat",
    );
    return Response.json({ ok: true, ignored: "callback-without-message" });
  }

  const action = callbackQuery.data
    ? parseCallbackData(callbackQuery.data)
    : null;
  if (!action) {
    await answerTelegramCallbackQuery(
      botToken,
      callbackQuery.id,
      "Callback không hợp lệ",
    );
    return Response.json({ ok: true, ignored: "unknown-callback" });
  }

  if (action.type === "menu") {
    await answerTelegramCallbackQuery(botToken, callbackQuery.id);
    await editMenu(botToken, message.chat.id, message.message_id, action.menu);
    return Response.json({ ok: true, menu: action.menu });
  }

  return runWorkflowFromCallback(
    botToken,
    callbackQuery.id,
    message.chat.id,
    message.message_id,
    githubToken,
    githubOwner,
    githubRepo,
    githubRef,
    action.command,
    action.args,
  );
}

Deno.serve(async (request) => {
  let botToken: string | undefined;
  let allowedChatId: string | undefined;
  let messageChatId: number | undefined;

  try {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    botToken = getEnv("TELEGRAM_BOT_TOKEN");
    allowedChatId = getEnv("TELEGRAM_CHAT_ID");
    const webhookSecret = getEnv("TELEGRAM_WEBHOOK_SECRET");
    const githubToken = getEnv("GITHUB_PAT");
    const githubOwner = getEnv("GITHUB_OWNER");
    const githubRepo = getEnv("GITHUB_REPO");
    const githubRef = Deno.env.get("GITHUB_REF") ?? "main";

    const requestSecret = request.headers.get(
      "X-Telegram-Bot-Api-Secret-Token",
    );
    if (requestSecret !== webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const update = (await request.json()) as TelegramUpdate;

    if (update.message) {
      const message = update.message;
      messageChatId = message.chat.id;
      if (String(message.chat.id) !== allowedChatId) {
        return new Response("Forbidden", { status: 403 });
      }

      const messageDescriptor =
        buildTelegramWebhookIdempotencyDescriptor(update);
      const shouldProcessMessage = await shouldProcessTelegramWebhookUpdate(
        update,
        async ({ idempotencyKey, eventType, payload }) =>
          claimTelegramWebhookIdempotency(idempotencyKey, eventType, payload),
      );
      if (!shouldProcessMessage) {
        logger.info(
          {
            eventType: messageDescriptor?.eventType,
            idempotencyKey: messageDescriptor?.idempotencyKey,
          },
          "Skipping duplicate Telegram webhook update",
        );
        return Response.json({ ok: true, ignored: "duplicate-message-update" });
      }

      const command = normalizeTelegramCommandToken(
        message.text?.trim().split(/\s+/)[0],
      );
      if (command === "/stats") {
        return handleStatsCommand(botToken, message.chat.id);
      }

      await showMenu(botToken, message.chat.id);
      return Response.json({ ok: true, menu: "main" });
    }

    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      messageChatId = callbackQuery.message?.chat.id;

      if (!messageChatId || String(messageChatId) !== allowedChatId) {
        return new Response("Forbidden", { status: 403 });
      }

      const callbackDescriptor =
        buildTelegramWebhookIdempotencyDescriptor(update);
      const shouldProcessCallback = await shouldProcessTelegramWebhookUpdate(
        update,
        async ({ idempotencyKey, eventType, payload }) =>
          claimTelegramWebhookIdempotency(idempotencyKey, eventType, payload),
      );
      if (!shouldProcessCallback) {
        logger.info(
          {
            eventType: callbackDescriptor?.eventType,
            idempotencyKey: callbackDescriptor?.idempotencyKey,
          },
          "Skipping duplicate Telegram webhook update",
        );
        return Response.json({ ok: true, ignored: "duplicate-callback-query" });
      }

      return handleTelegramCallback(
        botToken,
        callbackQuery,
        githubToken,
        githubOwner,
        githubRepo,
        githubRef,
      );
    }

    return Response.json({ ok: true, ignored: "unsupported-update" });
  } catch (error) {
    logger.error(error);

    if (
      botToken &&
      allowedChatId &&
      messageChatId &&
      String(messageChatId) === allowedChatId
    ) {
      try {
        const messageText =
          error instanceof Error ? error.message : String(error);
        await sendTelegramMessage(
          botToken,
          messageChatId,
          `Không thể xử lý yêu cầu:\n${messageText}`,
        );
      } catch (notifyError) {
        logger.error("Failed to send Telegram error message", notifyError);
      }
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
});
