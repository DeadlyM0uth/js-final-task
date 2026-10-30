// Точка входа: конфигурация -> подключение к MongoDB -> HTTP-сервер.
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createStore } from './store.js';

const log = {
  info: (message) => console.log(`[${new Date().toISOString()}] INFO  ${message}`),
  error: (message) => console.error(`[${new Date().toISOString()}] ERROR ${message}`),
};

async function main() {
  const config = loadConfig();
  const store = createStore(config);

  await store.connect({ log });

  const app = createApp({ config, store, log });
  const server = app.listen(config.port, config.host, () => {
    log.info(`Сервер слушает http://${config.host}:${config.port}`);
    log.info(`Автор: ${config.ownerFullName} (${config.ownerLogin})`);
  });

  const shutdown = async (signal) => {
    log.info(`Получен ${signal}, останавливаюсь`);
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
    // Страховка: не зависаем, если соединения не закрылись.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  log.error(`Запуск не удался: ${error.message}`);
  process.exit(1);
});
