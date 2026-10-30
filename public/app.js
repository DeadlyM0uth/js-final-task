// Интерфейс списка дел: обычный JS без фреймворков.
// Токен не встроен в код — пользователь вводит его в поле «Токен API»,
// он хранится в sessionStorage (вкладка) и уходит в заголовке Authorization.

const TOKEN_KEY = 'todo.token';
const RUN_ID_KEY = 'todo.runId';
const DEFAULT_RUN_ID = 'web';

const els = {
  authForm: document.getElementById('auth-form'),
  token: document.getElementById('token'),
  author: document.getElementById('author'),
  runForm: document.getElementById('run-form'),
  runId: document.getElementById('runId'),
  addForm: document.getElementById('add-form'),
  newTitle: document.getElementById('new-title'),
  status: document.getElementById('status'),
  tasks: document.getElementById('tasks'),
  empty: document.getElementById('empty'),
};

const state = {
  token: sessionStorage.getItem(TOKEN_KEY) || '',
  author: null,
  tasks: [],
  busy: false,
};

/* ---------- утилиты ---------- */

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', Boolean(isError) && message !== '');
}

function describeTask(task) {
  const when = task.createdAt ? new Date(task.createdAt).toLocaleString('ru-RU') : '—';
  return `${when} · runId: ${task.runId}`;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Запрос к API с токеном. Возвращает разобранное тело ответа. */
async function api(path, { method = 'GET', body } = {}) {
  if (!state.token) throw new ApiError('Сначала введите токен API', 401);

  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return null;

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || `HTTP ${response.status}`;
    if (response.status === 401) {
      state.token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      els.author.textContent = '';
    }
    throw new ApiError(message, response.status);
  }
  return data;
}

function currentRunId() {
  return els.runId.value.trim() || DEFAULT_RUN_ID;
}

/* ---------- действия ---------- */

async function login() {
  state.author = await api('/api/author/');
  els.author.textContent = `${state.author.fullName} · ${state.author.login}`;
  await loadTasks();
}

async function loadTasks() {
  const runId = currentRunId();
  state.tasks = await api(`/api/tasks/?runId=${encodeURIComponent(runId)}`);
  render();
}

async function addTask(title) {
  const created = await api('/api/tasks/', {
    method: 'POST',
    body: { title, runId: currentRunId() },
  });
  els.newTitle.value = '';
  await loadTasks();
  setStatus(`Добавлено: «${created.title}»`);
  els.newTitle.focus();
}

async function toggleTask(task) {
  await api(`/api/tasks/${encodeURIComponent(task.id)}/`, {
    method: 'PATCH',
    body: { done: !task.done },
  });
  await loadTasks();
}

async function renameTask(task) {
  const next = window.prompt('Новое название дела', task.title);
  if (next === null) return;
  const title = next.trim();
  if (title === '') {
    setStatus('Название не может быть пустым', true);
    return;
  }
  if (title === task.title) return;
  await api(`/api/tasks/${encodeURIComponent(task.id)}/`, { method: 'PATCH', body: { title } });
  await loadTasks();
  setStatus('Название изменено');
}

async function deleteTask(task) {
  if (!window.confirm(`Удалить дело «${task.title}»?`)) return;
  await api(`/api/tasks/${encodeURIComponent(task.id)}/`, { method: 'DELETE' });
  await loadTasks();
  setStatus('Дело удалено');
}

/* ---------- отрисовка ---------- */

function render() {
  els.tasks.replaceChildren();
  els.empty.hidden = state.tasks.length > 0;

  for (const task of state.tasks) {
    const item = document.createElement('li');
    item.className = task.done ? 'task done' : 'task';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', `Выполнено: ${task.title}`);
    checkbox.addEventListener('change', () =>
      run(() => toggleTask(task), 'Не удалось изменить отметку'),
    );

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = task.title;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = describeTask(task);
    title.append(meta);

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.textContent = 'Изменить';
    rename.setAttribute('aria-label', `Изменить название: ${task.title}`);
    rename.addEventListener('click', () => run(() => renameTask(task), 'Не удалось изменить название'));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Удалить';
    remove.setAttribute('aria-label', `Удалить: ${task.title}`);
    remove.addEventListener('click', () => run(() => deleteTask(task), 'Не удалось удалить дело'));

    item.append(checkbox, title, rename, remove);
    els.tasks.append(item);
  }
}

/** Обёртка: блокируем повторные нажатия и показываем ошибки. */
async function run(action, errorPrefix) {
  if (state.busy) return;
  state.busy = true;
  try {
    await action();
  } catch (error) {
    setStatus(`${errorPrefix}: ${error.message}`, true);
  } finally {
    state.busy = false;
  }
}

/* ---------- события ---------- */

els.authForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.token = els.token.value.trim();
  if (!state.token) {
    setStatus('Введите токен API', true);
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, state.token);
  run(async () => {
    await login();
    setStatus(`Вход выполнен, дел по runId «${currentRunId()}»: ${state.tasks.length}`);
  }, 'Не удалось войти');
});

els.runForm.addEventListener('submit', (event) => {
  event.preventDefault();
  localStorage.setItem(RUN_ID_KEY, currentRunId());
  run(async () => {
    await loadTasks();
    setStatus(`Дел по runId «${currentRunId()}»: ${state.tasks.length}`);
  }, 'Не удалось загрузить список');
});

els.addForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = els.newTitle.value.trim();
  if (title === '') {
    setStatus('Название не может быть пустым', true);
    return;
  }
  run(() => addTask(title), 'Не удалось добавить дело');
});

/* ---------- старт ---------- */

els.runId.value = localStorage.getItem(RUN_ID_KEY) || DEFAULT_RUN_ID;
els.token.value = state.token;

if (state.token) {
  run(async () => {
    await login();
  }, 'Токен не подошёл');
} else {
  setStatus('Введите токен, чтобы увидеть дела.');
}
