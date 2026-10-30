// Работа с MongoDB: подключение, сортировка документов в формат API.
import { MongoClient } from 'mongodb';

// Ошибка БД -> наверх уйдёт HTTP 503 (см. errorHandler в app.js).
export class DatabaseError extends Error {
  constructor(cause) {
    super('база данных недоступна');
    this.status = 503;
    this.cause = cause;
  }
}

/**
 * Документ из MongoDB -> объект ответа API.
 * В ответе только поля из ТЗ, внутренний _id наружу не отдаём.
 */
export function toApiTask(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    ownerLogin: doc.ownerLogin,
    title: doc.title,
    done: doc.done === true,
    runId: doc.runId,
    createdAt: toIsoString(doc.createdAt),
  };
}

// createdAt может быть BSON Date (обычный случай), либо строкой/числом,
// если документ добавлен в БД вручную. Итог всегда строка UTC в ISO 8601.
function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

export function createStore(config) {
  let client = null;
  let collection = null;

  return {
    get collection() {
      if (!collection) throw new DatabaseError(new Error('MongoDB не подключена'));
      return collection;
    },

    /** Проверка живости БД для /healthz и docker healthcheck. */
    async ping() {
      if (!client) throw new DatabaseError(new Error('MongoDB не подключена'));
      await client.db(config.dbName).command({ ping: 1 });
    },

    /** Подключение с несколькими попытками: контейнер mongo может стартовать позже приложения. */
    async connect({ attempts = 10, delayMs = 2000, log = console } = {}) {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          client = new MongoClient(config.mongoUri, {
            serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs,
          });
          await client.connect();
          await client.db(config.dbName).command({ ping: 1 });
          collection = client.db(config.dbName).collection(config.collectionName);
          log.info(`MongoDB подключена: база "${config.dbName}", коллекция "${config.collectionName}"`);
          return this;
        } catch (error) {
          await client?.close().catch(() => {});
          client = null;
          collection = null;
          log.error(`Попытка подключения к MongoDB ${attempt}/${attempts} не удалась: ${error.message}`);
          if (attempt === attempts) throw new DatabaseError(error);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      return this;
    },

    async close() {
      await client?.close().catch(() => {});
      client = null;
      collection = null;
    },
  };
}

/** Обёртка над операциями БД: ошибки драйвера превращаются в DatabaseError (HTTP 503). */
export async function dbCall(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    // Ошибки драйвера: Mongo*, MongoServerSelectionError и т.п., а также серверные коды.
    if (String(error?.name || '').startsWith('Mongo') || typeof error?.code === 'number') {
      const wrapped = new DatabaseError(error);
      wrapped.stack = `${wrapped.stack}\nОригинальная ошибка: ${error?.message}`;
      throw wrapped;
    }
    throw error;
  }
}
