# Развёртывание на VPS: todo.smirnov-vadim.ru

Инструкция рассчитана на чистый VPS с Ubuntu 22.04/24.04 и root/sudo. Итог: приложение на HTTPS, MongoDB на той же машине, доступ наружу только по 80/443, порт Mongo открыт только на `127.0.0.1` (для проверяющего — SSH-туннель).

## 1. DNS

В панели домена `smirnov-vadim.ru` создайте A-запись:

```
todo.smirnov-vadim.ru.  A  <IP_сервера>
```

Проверка с сервера (должен появиться IP, кэш DNS обновляется до нескольких минут):

```bash
dig +short todo.smirnov-vadim.ru
```

Caddy не выпустит сертификат, пока A-запись не указывает на этот сервер и открыты порты 80/443.

## 2. Подготовка сервера

```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 git ufw
systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Порт `27017` в firewall открывать **не нужно**: контейнер Mongo публикует его только на `127.0.0.1`.

## 3. Код и конфигурация

```bash
git clone <адрес_репозитория> /opt/todo-students   # или распакуйте ZIP
cd /opt/todo-students
cp .env.example .env
nano .env
```

Заполните `.env`:

| Переменная | Что указать |
|---|---|
| `DOMAIN` | `todo.smirnov-vadim.ru` |
| `API_TOKEN` | токен из личного сообщения, либо новый: `npm run token:gen` |
| `OWNER_LOGIN`, `OWNER_FULL_NAME` | уже заполнены: `vadim_smirnov_4150`, `Смирнов Вадим Андреевич` |
| `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD` | админ БД, пароль придумайте (латиница, цифры) |
| `MONGO_APP_USER`, `MONGO_APP_PASSWORD` | пользователь приложения |
| `MONGO_CHECKER_USER`, `MONGO_CHECKER_PASSWORD` | пользователь для проверяющего |

Пароли БД используйте из символов `A-Z a-z 0-9` (они попадают в строку подключения). Файл `.env` не коммитится: он в `.gitignore`.

Права на файл, чтобы конфиг не читали посторонние:

```bash
chmod 600 .env
```

## 4. Запуск

```bash
docker compose up -d --build
docker compose run --rm db-init     # коллекция, индексы, пользователи, персональное дело
docker compose ps                   # mongo healthy, app healthy, caddy running
```

Скрипт `db-init` идемпотентен: создаёт коллекцию `tasks`, уникальный индекс по `id`, индексы по `runId` и `createdAt`, пользователей `todo_app` и `todo_checker`, роль `todo_checker_role` с доступом только к коллекции `tasks`, а также дело «Итоговая работа 24.10.2026: vadim_smirnov_4150» с `runId="manual"`.

## 5. Проверка

```bash
curl -s https://todo.smirnov-vadim.ru/login/; echo
TOKEN=<ваш токен>
curl -s -H "Authorization: Bearer $TOKEN" https://todo.smirnov-vadim.ru/api/author/; echo
curl -s -H "Authorization: Bearer $TOKEN" "https://todo.smirnov-vadim.ru/api/tasks/?runId=manual"; echo
curl -s -o /dev/null -w 'без токена: %{http_code}\n' https://todo.smirnov-vadim.ru/api/tasks/
```

Ожидаем: логин, JSON с ФИО, массив с персональным делом и `401` без токена. Полный прогон контракта (54 проверки) внутри контейнера:

```bash
docker compose exec app npm run test:smoke
```

Сертификат Caddy выпускает сам при первом запросе; прогресс видно в логах:

```bash
docker compose logs -f caddy
```

## 6. Доступ проверяющего к БД (п.5 ТЗ)

Проверяющему выдаются только учётные данные `MONGO_CHECKER_USER` из `.env` и SSH-доступ для туннеля. Он может читать, добавлять, изменять и удалять документы коллекции `tasks` — и ничего больше (права на другие коллекции, другие базы, удаление коллекции и создание пользователей отсутствуют).

Создайте отдельного системного пользователя для туннеля (не root):

```bash
useradd -m -s /bin/bash student-check
passwd student-check
```

Сообщение проверяющему (личным сообщением в Moodle, без паролей Moodle/ИСУ):

```
HTTPS: https://todo.smirnov-vadim.ru/
Логин/ФИО: vadim_smirnov_4150, Смирнов Вадим Андреевич
API: Bearer-токен — отдельным сообщением, если требуется
SSH-туннель: ssh -N -L 27017:127.0.0.1:27017 student-check@<IP_сервера>
Mongo: mongosh "mongodb://todo_checker:<пароль>@127.0.0.1:27017/todo_students?authSource=todo_students"
Коллекция: todo_students.tasks (учебные данные)
```

Пример независимой правки данных проверяющим:

```javascript
// в mongosh после подключения
db.tasks.find({ runId: "manual" })
db.tasks.insertOne({ id: "2f7b0c1a-1111-4222-8333-944455556666",
  ownerLogin: "vadim_smirnov_4150", title: "Добавлено проверяющим",
  done: false, runId: "manual", createdAt: new Date() })
db.tasks.updateOne({ runId: "manual" }, { $set: { done: true } })
db.tasks.deleteOne({ id: "2f7b0c1a-1111-4222-8333-944455556666" })
```

Изменения сразу видны в интерфейсе и в `GET /api/tasks/?runId=manual`. Альтернатива туннелю — разрешить в `ufw` порт 27017 только с IP проверяющего, но тогда Mongo придётся опубликовать на внешний адрес; по умолчанию так не сделано.

## 7. Эксплуатация

Резервная копия (учётные данные берутся из `.env`):

```bash
mkdir -p backup
docker run --rm --network todo-students_default \
  -v "$PWD/backup:/backup" mongo:7.0 \
  mongodump --uri="mongodb://root:ПАРОЛЬ@mongo:27017/?authSource=admin" \
  --gzip --archive=/backup/todo-$(date +%F).gz
```

Обновление после `git pull`:

```bash
docker compose up -d --build
docker compose run --rm db-init
```

Логи и состояние: `docker compose logs -f app`, `docker compose logs -f mongo`, `docker compose ps`.

| Симптом | Причина и решение |
|---|---|
| Caddy бесконечно пытается получить сертификат | A-запись не указывает на сервер или закрыты 80/443: проверьте `dig` и `ufw status`. Пока DNS не готов, для теста можно заменить в `Caddyfile` домен на `:80` |
| `502` от Caddy | Контейнер `app` упал: `docker compose logs app`. Обычно нет `.env` или Mongo ещё не прошла healthcheck |
| API отвечает `401` | Токен не совпадает с `API_TOKEN`; после смены токена перезапустите: `docker compose restart app` |
| API отвечает `503` | Приложение потеряло связь с Mongo: `docker compose ps`, `docker compose logs mongo` |
| `db-init` падает с `Authentication failed` | Пароль в `.env` изменён после первого старта Mongo: Mongo хранит пароль root в томе. Верните прежний пароль или пересоздайте том (`docker compose down -v`) |
| Интерфейс пуст | В поле `runId` указано значение без дел: персональное дело лежит в `runId=manual` |

## 8. Helios (факультетская площадка)

Отдельно: доступ к Helios у автора пока не получен. После выдачи доступа нужно проверить доступную СУБД (MongoDB там не гарантирована), лимиты хранения, возможность подключения со своего VPS и только тогда дополнить таблицу сравнения в README. Отсутствие доступа фиксируется в отчёте как факт, Helios не обязателен для развёртывания.
