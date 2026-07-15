import "../shared/infra/env.js";
import { setChatMenuButton, setMyCommands } from "../shared/notification/telegram-client.js";
import { createLogger } from "../shared/infra/logger.js";

const logger = createLogger("scripts:setup-telegram-menu");
async function main(): Promise<void> {
  const commands = [
    { command: "help", description: "Hướng dẫn sử dụng" },
    { command: "stats", description: "Xem thống kê hiện tại" },
  ];

  logger.info("Setting Telegram commands...");
  await setMyCommands(commands);
  logger.info("✓ Commands updated");

  logger.info("Setting Telegram menu button...");
  await setChatMenuButton();
  logger.info("✓ Menu button updated");
}

main().catch((error) => {
  logger.error("Error:", error);
  process.exit(1);
});
