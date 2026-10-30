# Структура коллекции и её инициализация

База `todo_students`, коллекция `tasks`.

Пример документа:

```javascript
{
  _id: ObjectId("6725d1f4a1b2c3d4e5f60718"),   // внутренний ключ MongoDB, в API не отдаётся
  id: "48bc4484-478e-476b-9986-73f90588bb11",  // UUID-строка, уникальна
  ownerLogin: "vadim_smirnov_4150",
  title: "Итоговая работа 24.10.2026: vadim_smirnov_4150",
  done: false,
  runId: "manual",
  createdAt: ISODate("2026-10-30T17:21:00.201Z") // BSON Date, в API — ISO 8601 UTC
}
```

Индексы:

| Индекс | Поля | Назначение |
|---|---|---|
| `uniq_id` | `{ id: 1 }`, unique | уникальность UUID, поиск `GET/PATCH/DELETE /api/tasks/:id/` |
| `idx_runId` | `{ runId: 1 }` | выборка `GET /api/tasks/?runId=…` |
| `idx_createdAt` | `{ createdAt: 1 }` | сортировка списка по времени создания |

Инициализация — `npm run init:db` (или `docker compose run --rm db-init`), скрипт `scripts/init-db.js`:

1. создаёт коллекцию `tasks`, если её нет;
2. создаёт индексы `uniq_id`, `idx_runId`, `idx_createdAt`;
3. создаёт пользователя приложения (`readWrite` на базу `todo_students`);
4. создаёт роль `todo_checker_role` с привилегиями `find/insert/update/remove/killCursors/changeStream` только на `todo_students.tasks` и пользователя проверяющего с этой ролью;
5. создаёт персональное дело «Итоговая работа 24.10.2026: vadim_smirnov_4150» с фиксированным `id` и `runId="manual"` (повторный запуск дубля не создаёт);
6. проверяет, что приложение может подключиться по `MONGO_URI`.
