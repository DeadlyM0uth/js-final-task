// Проверка HTTP-контракта из ТЗ на запущенном приложении.
// Запуск: npm run test:smoke  (использует BASE_URL, API_TOKEN, OWNER_LOGIN из .env)
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN;
const OWNER_LOGIN = process.env.OWNER_LOGIN;

if (!TOKEN || !OWNER_LOGIN) {
  console.error('Нужны API_TOKEN и OWNER_LOGIN в окружении (.env)');
  process.exit(1);
}

const RUN_ID = `smoke_${Date.now()}`;
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, details = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${details ? ` -> ${details}` : ''}`);
  }
}

async function request(path, { method = 'GET', token = TOKEN, body, rawBody, contentType } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers['Content-Type'] = contentType;
  else if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, contentType: response.headers.get('content-type') || '', text, json };
}

const isJson = (res) => /application\/json/.test(res.contentType);
const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function main() {
  console.log(`Проверка ${BASE_URL}, автор ${OWNER_LOGIN}, runId ${RUN_ID}\n`);

  // --- /login/ ---
  const login = await request('/login/', { token: null });
  check('GET /login/ -> 200', login.status === 200, `status ${login.status}`);
  check('GET /login/ -> text/plain', /text\/plain/.test(login.contentType), login.contentType);
  check('GET /login/ -> логин Moodle', login.text.trim() === OWNER_LOGIN, JSON.stringify(login.text));

  // --- защита /api/ ---
  const noToken = await request('/api/author/', { token: null });
  check('GET /api/author/ без токена -> 401', noToken.status === 401, `status ${noToken.status}`);
  check('401 -> application/json', isJson(noToken), noToken.contentType);
  const badToken = await request('/api/author/', { token: 'wrong-token' });
  check('GET /api/author/ с неверным токеном -> 401', badToken.status === 401, `status ${badToken.status}`);
  const listNoToken = await request(`/api/tasks/?runId=${RUN_ID}`, { token: null });
  check('GET /api/tasks/ без токена -> 401', listNoToken.status === 401, `status ${listNoToken.status}`);

  // --- /api/author/ ---
  const author = await request('/api/author/');
  check('GET /api/author/ -> 200', author.status === 200, `status ${author.status}`);
  check('GET /api/author/ -> login', author.json?.login === OWNER_LOGIN, JSON.stringify(author.json));
  check(
    'GET /api/author/ -> fullName',
    typeof author.json?.fullName === 'string' && author.json.fullName.length > 0,
    JSON.stringify(author.json),
  );

  // --- POST ---
  const created = await request('/api/tasks/', { method: 'POST', body: { title: '  Smoke тест  ', runId: RUN_ID } });
  check('POST /api/tasks/ -> 201', created.status === 201, `status ${created.status}`);
  const task = created.json ?? {};
  check('POST -> id это UUID', isUuid(task.id), String(task.id));
  check('POST -> ownerLogin от сервера', task.ownerLogin === OWNER_LOGIN, String(task.ownerLogin));
  check('POST -> title после trim', task.title === 'Smoke тест', JSON.stringify(task.title));
  check('POST -> done=false', task.done === false, String(task.done));
  check('POST -> runId', task.runId === RUN_ID, String(task.runId));
  check(
    'POST -> createdAt строка UTC ISO 8601',
    typeof task.createdAt === 'string' && /Z$/.test(task.createdAt) && !Number.isNaN(Date.parse(task.createdAt)),
    String(task.createdAt),
  );
  check('POST -> в ответе нет _id', !Object.hasOwn(task, '_id'));

  const badPosts = [
    ['пустой title', { title: '   ', runId: RUN_ID }],
    ['title 201 символ', { title: 'x'.repeat(201), runId: RUN_ID }],
    ['нет runId', { title: 'ok' }],
    ['runId с пробелом', { title: 'ok', runId: 'a b' }],
    ['runId 65 символов', { title: 'ok', runId: 'a'.repeat(65) }],
    ['лишнее поле', { title: 'ok', runId: RUN_ID, ownerLogin: 'hacker' }],
    ['done в POST', { title: 'ok', runId: RUN_ID, done: true }],
    ['title число', { title: 42, runId: RUN_ID }],
  ];
  for (const [label, body] of badPosts) {
    const res = await request('/api/tasks/', { method: 'POST', body });
    check(`POST ${label} -> 400`, res.status === 400, `status ${res.status}`);
    check(`POST ${label} -> {"error":…}`, typeof res.json?.error === 'string' && isJson(res));
  }
  const badJson = await request('/api/tasks/', {
    method: 'POST',
    rawBody: '{"title": "x",',
    contentType: 'application/json',
  });
  check('POST битый JSON -> 400', badJson.status === 400, `status ${badJson.status}`);
  const arrayBody = await request('/api/tasks/', { method: 'POST', body: [{ title: 'x', runId: RUN_ID }] });
  check('POST массив вместо объекта -> 400', arrayBody.status === 400, `status ${arrayBody.status}`);

  // --- GET list ---
  const list = await request(`/api/tasks/?runId=${RUN_ID}`);
  check('GET /api/tasks/?runId= -> 200', list.status === 200, `status ${list.status}`);
  check('GET /api/tasks/?runId= -> массив с делом', Array.isArray(list.json) && list.json.some((t) => t.id === task.id));
  const emptyList = await request('/api/tasks/?runId=no_such_run_id');
  check('GET /api/tasks/?runId=несуществующий -> []', Array.isArray(emptyList.json) && emptyList.json.length === 0);
  const noRunId = await request('/api/tasks/');
  check('GET /api/tasks/ без runId -> 400', noRunId.status === 400, `status ${noRunId.status}`);

  // --- GET by id ---
  const one = await request(`/api/tasks/${task.id}/`);
  check('GET /api/tasks/:id/ -> 200 + дело', one.status === 200 && one.json?.id === task.id, `status ${one.status}`);
  const badId = await request('/api/tasks/not-a-uuid/');
  check('GET /api/tasks/невалидный-id/ -> 400', badId.status === 400, `status ${badId.status}`);
  const missingId = await request('/api/tasks/11111111-2222-3333-4444-555555555555/');
  check('GET /api/tasks/отсутствующий -> 404', missingId.status === 404, `status ${missingId.status}`);

  // --- PATCH ---
  const patchedTitle = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', body: { title: 'Новое имя' } });
  check(
    'PATCH title -> 200 + новое название',
    patchedTitle.status === 200 && patchedTitle.json?.title === 'Новое имя',
    `status ${patchedTitle.status} ${JSON.stringify(patchedTitle.json)}`,
  );
  const patchedDone = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', body: { done: true } });
  check(
    'PATCH done -> 200 + done=true',
    patchedDone.status === 200 && patchedDone.json?.done === true,
    `status ${patchedDone.status} ${JSON.stringify(patchedDone.json)}`,
  );
  const badPatches = [
    ['пустое тело', {}],
    ['done строкой', { done: 'true' }],
    ['лишнее поле', { title: 'ok', id: 'x' }],
    ['title пустой', { title: ' ' }],
  ];
  for (const [label, body] of badPatches) {
    const res = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', body });
    check(`PATCH ${label} -> 400`, res.status === 400, `status ${res.status}`);
  }
  const patchMissing = await request('/api/tasks/11111111-2222-3333-4444-555555555555/', {
    method: 'PATCH',
    body: { done: true },
  });
  check('PATCH отсутствующего дела -> 404', patchMissing.status === 404, `status ${patchMissing.status}`);

  // --- DELETE ---
  const deleted = await request(`/api/tasks/${task.id}/`, { method: 'DELETE' });
  check('DELETE -> 204', deleted.status === 204, `status ${deleted.status}`);
  check('DELETE -> пустое тело', deleted.text === '', JSON.stringify(deleted.text));
  const deletedAgain = await request(`/api/tasks/${task.id}/`, { method: 'DELETE' });
  check('DELETE повторно -> 404', deletedAgain.status === 404, `status ${deletedAgain.status}`);
  const afterDelete = await request(`/api/tasks/${task.id}/`);
  check('GET после DELETE -> 404', afterDelete.status === 404, `status ${afterDelete.status}`);

  console.log(`\nИтого: ${passed} ok, ${failed} fail`);
  if (failed > 0) {
    console.log('Проваленные проверки:');
    for (const name of failures) console.log(`  - ${name}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Тест упал: ${error.stack || error.message}`);
  process.exit(1);
});
