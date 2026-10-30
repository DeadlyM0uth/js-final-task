// Конфигурация приложения. Все секреты и данные автора берутся ТОЛЬКО из окружения
// (файл .env на сервере), в исходниках их нет.

const REQUIRED = ['MONGO_URI', 'API_TOKEN', 'OWNER_LOGIN', 'OWNER_FULL_NAME'];

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !String(env[name] ?? '').trim());
  if (missing.length > 0) {
    throw new Error(`Не заданы переменные окружения: ${missing.join(', ')}. Смотрите .env.example`);
  }

  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    // Токен Bearer для /api/. Приходит из .env, в браузер встраивается вручную через интерфейс.
    apiToken: String(env.API_TOKEN),
    // Логин и ФИО из профиля Moodle. Сервер проставляет их сам, из тела запроса они не принимаются.
    ownerLogin: String(env.OWNER_LOGIN).trim(),
    ownerFullName: String(env.OWNER_FULL_NAME).trim(),
    mongoUri: String(env.MONGO_URI),
    dbName: env.DB_NAME || 'todo_students',
    collectionName: env.COLLECTION_NAME || 'tasks',
    // Таймауты, чтобы при недоступной БД API отвечало 503, а не висело.
    mongoServerSelectionTimeoutMs: Number(env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000),
  };
}
