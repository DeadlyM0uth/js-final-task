// HTTP-слой: маршруты из ТЗ, защита /api/, валидация, обработка ошибок.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { dbCall, toApiTask } from './store.js';
import {
  UUID_PATTERN,
  validateCreateBody,
  validateId,
  validateUpdateBody,
  validateRunId,
} from './validation.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Маршруты из ТЗ оканчиваются на «/». Добавляем вариант без «/» для удобства,
// чтобы оба написания работали одинаково.
const trailing = (route) => [route.replace(/\/$/, '') + '/', route.replace(/\/$/, '')];

const uuid = randomUUID;

/** Сравнение токенов за постоянное время. */
function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Authorization: Bearer <токен>; иначе 401. */
function requireToken(config) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match || !tokenMatches(match[1].trim(), config.apiToken)) {
      res.type('application/json').status(401).json({ error: 'неверный или отсутствующий токен' });
      return;
    }
    next();
  };
}

export function createApp({ config, store, log = console }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('json spaces', 0);

  // ---------- Открытые маршруты ----------

  app.get(trailing('/login/'), (req, res) => {
    res.type('text/plain').send(config.ownerLogin);
  });

  // Проверка живости для docker/systemd. Не под /api/, токен не нужен.
  app.get('/healthz', async (req, res) => {
    try {
      await dbCall(() => store.ping());
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(503).json({ status: 'error', error: error.message });
    }
  });

  app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

  // ---------- /api/ ----------

  const api = express.Router();
  api.use(requireToken(config));
  api.use(express.json({ limit: '100kb' }));

  api.get('/author/', (req, res) => {
    res.json({ login: config.ownerLogin, fullName: config.ownerFullName });
  });

  // POST /api/tasks/ — только title и runId; id, ownerLogin, createdAt, done ставит сервер.
  api.post('/tasks/', async (req, res, next) => {
    try {
      const input = validateCreateBody(req.body);
      if (!input.ok) {
        res.status(400).json({ error: input.error });
        return;
      }

      const task = {
        id: uuid(),
        ownerLogin: config.ownerLogin,
        title: input.value.title,
        done: false,
        runId: input.value.runId,
        createdAt: new Date(),
      };

      await dbCall(() => store.collection.insertOne({ ...task }));
      res.status(201).location(`${req.baseUrl}/tasks/${task.id}/`).json(toApiTask(task));
    } catch (error) {
      next(error);
    }
  });

  // GET /api/tasks/?runId=… — дела автора с указанным runId.
  api.get('/tasks/', async (req, res, next) => {
    try {
      const rawRunId = Array.isArray(req.query.runId) ? req.query.runId[0] : req.query.runId;
      if (typeof rawRunId !== 'string' || rawRunId === '') {
        res.status(400).json({ error: 'параметр runId обязателен' });
        return;
      }
      const runId = validateRunId(rawRunId);
      if (!runId.ok) {
        res.status(400).json({ error: runId.error });
        return;
      }

      const docs = await dbCall(() =>
        store.collection
          .find({ ownerLogin: config.ownerLogin, runId: runId.value })
          .sort({ createdAt: 1, _id: 1 })
          .toArray(),
      );
      res.json(docs.map(toApiTask));
    } catch (error) {
      next(error);
    }
  });

  api.get('/tasks/:id/', async (req, res, next) => {
    try {
      const id = validateId(req.params.id);
      if (!id.ok) {
        res.status(400).json({ error: id.error });
        return;
      }
      const doc = await dbCall(() => store.collection.findOne({ id: id.value }));
      if (!doc) {
        res.status(404).json({ error: 'дело не найдено' });
        return;
      }
      res.json(toApiTask(doc));
    } catch (error) {
      next(error);
    }
  });

  api.patch('/tasks/:id/', async (req, res, next) => {
    try {
      const id = validateId(req.params.id);
      if (!id.ok) {
        res.status(400).json({ error: id.error });
        return;
      }
      const update = validateUpdateBody(req.body);
      if (!update.ok) {
        res.status(400).json({ error: update.error });
        return;
      }

      const doc = await dbCall(() =>
        store.collection.findOneAndUpdate(
          { id: id.value },
          { $set: update.value },
          { returnDocument: 'after' },
        ),
      );
      if (!doc) {
        res.status(404).json({ error: 'дело не найдено' });
        return;
      }
      res.json(toApiTask(doc));
    } catch (error) {
      next(error);
    }
  });

  api.delete('/tasks/:id/', async (req, res, next) => {
    try {
      const id = validateId(req.params.id);
      if (!id.ok) {
        res.status(400).json({ error: id.error });
        return;
      }
      const result = await dbCall(() => store.collection.deleteOne({ id: id.value }));
      if (result.deletedCount === 0) {
        res.status(404).json({ error: 'дело не найдено' });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // Неизвестный маршрут под /api/ — JSON, а не HTML.
  api.use((req, res) => {
    res.status(404).json({ error: 'маршрут не найден' });
  });

  app.use('/api', api);

  // ---------- Обработка ошибок ----------

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
      res.status(400).json({ error: 'некорректный JSON' });
      return;
    }
    if (error?.type === 'entity.too.large') {
      res.status(413).json({ error: 'тело запроса слишком большое' });
      return;
    }
    if (error?.status === 503) {
      log.error(`Ошибка БД: ${error.message}; причина: ${error.cause?.message ?? '—'}`);
      res.status(503).json({ error: 'ошибка базы данных' });
      return;
    }
    log.error(`Необработанная ошибка: ${error?.stack ?? error}`);
    res.status(500).json({ error: 'внутренняя ошибка сервера' });
  });

  return app;
}

export { UUID_PATTERN };
