type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: {
    id: number;
  };
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: TelegramMessage;
};

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

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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
      [
        { text: "✅ Xác minh kết quả ▸", callback_data: "menu:lottery_verify" },
      ],
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

  if (kind !== "run") {
    return null;
  }

  if (!(scope in COMMANDS)) {
    return null;
  }

  if (scope === "lottery_verify") {
    return VERIFY_REGIONS.has(part)
      ? { type: "run", command: scope, args: [part] }
      : null;
  }

  return { type: "run", command: scope as keyof typeof COMMANDS, args: [] };
}

async function sendTelegramRequest(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

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
): Promise<void> {
  await sendTelegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
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
      body: JSON.stringify({
        ref,
        inputs,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub workflow dispatch failed: ${response.status} ${body}`);
  }

  const rawBody = await response.text();
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as WorkflowDispatchResult;
  } catch {
    return null;
  }
}

function buildWorkflowSummary(inputs: Record<string, string>): string {
  if (Object.keys(inputs).length === 0) {
    return "";
  }

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
  const runSummary = dispatchResult?.html_url ? `\nRun: ${dispatchResult.html_url}` : "";

  return `✅ Đã kích hoạt ${workflow.description} ${inputSummary}${runSummary}`;
}

function buildErrorMessage(workflow: WorkflowConfig, message: string): string {
  return `❌ Không thể kích hoạt ${workflow.description} \n${message}`;
}

async function showMenu(botToken: string, chatId: number | string): Promise<void> {
  await sendTelegramMessage(botToken, chatId, buildMainMenuMessage(), buildMainMenuKeyboard());
}

async function editMenu(
  botToken: string,
  chatId: number | string,
  messageId: number,
  menu: "main" | "lottery_verify",
): Promise<void> {
  if (menu === "main") {
    await editTelegramMessage(botToken, chatId, messageId, buildMainMenuMessage(), buildMainMenuKeyboard());
    return;
  }

  await editTelegramMessage(botToken, chatId, messageId, "Chọn miền để xác minh:", buildRegionSubmenuKeyboard());
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
    await answerTelegramCallbackQuery(botToken, callbackQueryId, "⏳ Đang xử lý...");
    await editTelegramMessage(botToken, chatId, messageId, buildErrorMessage(workflow, messageText));
    return Response.json({ ok: true, command, ignored: "invalid-input" });
  }

  await answerTelegramCallbackQuery(botToken, callbackQueryId, "⏳ Đang xử lý...");
  await editTelegramMessage(botToken, chatId, messageId, `⏳ Đang kích hoạt ${workflow.description}...`);

  try {
    const dispatchResult = await dispatchWorkflow(githubToken, githubOwner, githubRepo, githubRef, workflow, inputs);
    const successMessage = buildSuccessMessage(workflow, inputs, dispatchResult);
    await editTelegramMessage(botToken, chatId, messageId, successMessage);
    return Response.json({ ok: true, command, workflow: workflow.file, inputs, dispatchResult });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await editTelegramMessage(botToken, chatId, messageId, buildErrorMessage(workflow, messageText));
    return Response.json({ ok: true, command, ignored: "dispatch-error" });
  }
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
    await answerTelegramCallbackQuery(botToken, callbackQuery.id, "Thiếu ngữ cảnh chat");
    return Response.json({ ok: true, ignored: "callback-without-message" });
  }

  const action = callbackQuery.data ? parseCallbackData(callbackQuery.data) : null;
  if (!action) {
    await answerTelegramCallbackQuery(botToken, callbackQuery.id, "Callback không hợp lệ");
    return Response.json({ ok: true, ignored: "unknown-callback" });
  }

  if (action.type === "menu") {
    await answerTelegramCallbackQuery(botToken, callbackQuery.id);
    await editMenu(botToken, message.chat.id, message.message_id, action.menu);
    return Response.json({ ok: true, menu: action.menu });
  }

  return await runWorkflowFromCallback(
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

    const requestSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
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

      await showMenu(botToken, message.chat.id);
      return Response.json({ ok: true, menu: "main" });
    }

    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      messageChatId = callbackQuery.message?.chat.id;

      if (!messageChatId || String(messageChatId) !== allowedChatId) {
        return new Response("Forbidden", { status: 403 });
      }

      return await handleTelegramCallback(
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
    console.error(error);

    if (botToken && allowedChatId && messageChatId && String(messageChatId) === allowedChatId) {
      try {
        const messageText = error instanceof Error ? error.message : String(error);
        await sendTelegramMessage(botToken, messageChatId, `Không thể xử lý yêu cầu:\n${messageText}`);
      } catch (notifyError) {
        console.error("Failed to send Telegram error message", notifyError);
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
