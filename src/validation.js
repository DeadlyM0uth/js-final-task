// Валидация входных данных по требованиям ТЗ.
// Любая ошибка валидации -> HTTP 400 {"error":"..."}.

export const TITLE_MIN = 1;
export const TITLE_MAX = 200;
export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// Проверяем форму UUID (8-4-4-4-12 hex). Версию не ограничиваем, чтобы
// вручную добавленные в БД документы тоже читались по id.
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Тело запроса должно быть JSON-объектом (массив, строка, null — 400). */
export function asJsonObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'тело запроса должно быть JSON-объектом' };
  }
  return { ok: true, value: body };
}

/** Лишние поля не допускаются. */
export function rejectExtraFields(object, allowed) {
  const extra = Object.keys(object).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    return { ok: false, error: `лишние поля: ${extra.join(', ')}` };
  }
  return { ok: true };
}

export function validateTitle(value) {
  if (typeof value !== 'string') {
    return { ok: false, error: 'title должен быть строкой' };
  }
  const title = value.trim();
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    return { ok: false, error: `title после trim должен содержать от ${TITLE_MIN} до ${TITLE_MAX} символов` };
  }
  return { ok: true, value: title };
}

export function validateRunId(value) {
  if (typeof value !== 'string') {
    return { ok: false, error: 'runId должен быть строкой' };
  }
  if (!RUN_ID_PATTERN.test(value)) {
    return { ok: false, error: 'runId: от 1 до 64 символов из A-Z, a-z, 0-9, «_», «-»' };
  }
  return { ok: true, value };
}

export function validateDone(value) {
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'done должен быть boolean' };
  }
  return { ok: true, value };
}

export function validateId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return { ok: false, error: 'id должен быть UUID' };
  }
  return { ok: true, value };
}

/** POST /api/tasks/: только title и runId, оба обязательны. */
export function validateCreateBody(body) {
  const object = asJsonObject(body);
  if (!object.ok) return object;

  const extra = rejectExtraFields(object.value, ['title', 'runId']);
  if (!extra.ok) return extra;

  const title = validateTitle(object.value.title);
  if (!title.ok) return title;

  const runId = validateRunId(object.value.runId);
  if (!runId.ok) return runId;

  return { ok: true, value: { title: title.value, runId: runId.value } };
}

/** PATCH /api/tasks/:id/: непустой набор title и/или done. */
export function validateUpdateBody(body) {
  const object = asJsonObject(body);
  if (!object.ok) return object;

  const extra = rejectExtraFields(object.value, ['title', 'done']);
  if (!extra.ok) return extra;

  const hasTitle = Object.hasOwn(object.value, 'title');
  const hasDone = Object.hasOwn(object.value, 'done');
  if (!hasTitle && !hasDone) {
    return { ok: false, error: 'PATCH принимает непустой набор: title и/или done' };
  }

  const update = {};
  if (hasTitle) {
    const title = validateTitle(object.value.title);
    if (!title.ok) return title;
    update.title = title.value;
  }
  if (hasDone) {
    const done = validateDone(object.value.done);
    if (!done.ok) return done;
    update.done = done.value;
  }
  return { ok: true, value: update };
}
