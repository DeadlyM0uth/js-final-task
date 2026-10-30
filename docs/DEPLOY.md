# Развёртывание на сервере

Универсальная инструкция: подходит любой сервер с Debian/Ubuntu и root/sudo. Итог — приложение на HTTPS под вашим доменом, MongoDB на той же машине, наружу открыты только 80/443, порт Mongo доступен только с `127.0.0.1` (проверяющему — через SSH-туннель).

Сокращения для команд ниже (задайте в своей оболочке):

```bash
DOMAIN=<поддомен>.<домен>      # имя, на котором будет работать приложение
TOKEN=<токен>                  # значение API_TOKEN из .env
```

## 1. Что нужно до запуска

1. **DNS.** В панели домена добавьте A-запись на IP сервера:

   ```
   <поддомен>.<домен>.  A  <IP сервера>
   ```

   Проверка (кэш резолверов обновляется до нескольких минут):

   ```bash
   dig +short "$DOMAIN"
   dig +short @8.8.8.8 "$DOMAIN"
   ```

   Оба запроса должны вернуть IP сервера. Если домен обслуживается проксирующим DNS-провайдером (например, Cloudflare), на время выпуска сертификата отключите прокси у этой записи («DNS only»), иначе проверка Let's Encrypt пойдёт через прокси.

2. **Порты.** Снаружи должны быть открыты 80 и 443 — в firewall операционной системы **и** в firewall панели провайдера, если он есть.

## 2. Подготовка сервера

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh      # Docker + Compose v2 (команда docker compose)
systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```


## 3. Код и конфигурация

```bash
git clone <адрес репозитория> /opt/<каталог-проекта>   # или распакуйте ZIP
cd /opt/<каталог-проекта>
cp .env.example .env
chmod 600 .env
nano .env
```

Заполните `.env`:

| Переменная | Что указать |
|---|---|
| `DOMAIN` | `<поддомен>.<домен>`, ровно как в A-записи |
| `API_TOKEN` | свой токен из менеджера секретов либо новый: `npm run token:gen` |
| `OWNER_LOGIN` | `<логин Moodle>` |
| `OWNER_FULL_NAME` | `<ФИО>` как в профиле Moodle |
| `DB_NAME`, `COLLECTION_NAME` | можно оставить значения по умолчанию |
| `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD` | администратор БД, пароль придумайте |
| `MONGO_APP_USER`, `MONGO_APP_PASSWORD` | пользователь приложения |
| `MONGO_CHECKER_USER`, `MONGO_CHECKER_PASSWORD` | пользователь для проверяющего |

Пароли БД используйте из символов `A-Z a-z 0-9` — они попадают в строку подключения. `.env` уже перечислен в `.gitignore`, в репозиторий он не попадёт.

## 4. Запуск

```bash
docker compose up -d --build
docker compose run --rm db-init     # коллекция, индексы, пользователи, персональное дело
docker compose ps                   # mongo healthy, app healthy, caddy running
```

## 5. Проверка

```bash
curl -s "https://$DOMAIN/login/"; echo
curl -s -H "Authorization: Bearer $TOKEN" "https://$DOMAIN/api/author/"; echo
curl -s -H "Authorization: Bearer $TOKEN" "https://$DOMAIN/api/tasks/?runId=manual"; echo
curl -s -o /dev/null -w 'без токена: %{http_code}\n' "https://$DOMAIN/api/tasks/"
```

Ожидаем: логин, JSON с ФИО, массив с персональным делом и `401` без токена. Полный прогон контракта (54 проверки) внутри контейнера:

```bash
docker compose exec app npm run test:smoke
```

Сертификат Caddy выпускает сам при первом запросе — прогресс виден в логах:

```bash
docker compose logs -f caddy
```

