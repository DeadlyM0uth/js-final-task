// Инициализация учебной БД MongoDB:
//   1) коллекция tasks + индексы (структура описана в README);
//   2) пользователь приложения (чтение/запись в свою базу);
//   3) пользователь для проверяющего — readWrite ТОЛЬКО на коллекции tasks;
//   4) персональное дело «Итоговая работа 24.10.2026: <логин Moodle>» с runId="manual".
// Скрипт идемпотентен: повторный запуск ничего не ломает.
import { MongoClient } from 'mongodb';

const {
  MONGO_ADMIN_URI,
  DB_NAME = 'todo_students',
  COLLECTION_NAME = 'tasks',
  MONGO_APP_USER = 'todo_app',
  MONGO_APP_PASSWORD,
  MONGO_CHECKER_USER = 'todo_checker',
  MONGO_CHECKER_PASSWORD,
  OWNER_LOGIN,
  MONGO_URI,
} = process.env;

// Фиксированный UUID персонального дела: повторный запуск не создаёт дубль.
const MANUAL_TASK_ID = '48bc4484-478e-476b-9986-73f90588bb11';

function fail(message) {
  console.error(`ОШИБКА: ${message}`);
  process.exit(1);
}

for (const [name, value] of Object.entries({
  MONGO_ADMIN_URI,
  MONGO_APP_PASSWORD,
  MONGO_CHECKER_PASSWORD,
  OWNER_LOGIN,
})) {
  if (!value) fail(`не задана переменная ${name}`);
}

/** Создать пользователя или обновить пароль/роли, если он уже есть. */
async function ensureUser(db, { user, pwd, roles }) {
  try {
    await db.command({ createUser: user, pwd, roles });
    console.log(`  + пользователь "${user}" создан`);
  } catch (error) {
    if (error.code === 51003 || /already exists/i.test(error.message)) {
      await db.command({ updateUser: user, pwd, roles });
      console.log(`  ~ пользователь "${user}" уже был: пароль и роли синхронизированы`);
    } else {
      throw error;
    }
  }
}

async function main() {
  console.log(`Инициализация MongoDB: база "${DB_NAME}", коллекция "${COLLECTION_NAME}"`);

  const admin = new MongoClient(MONGO_ADMIN_URI);
  await admin.connect();
  const db = admin.db(DB_NAME);

  try {
    // 1. Коллекция и индексы
    const existing = await db.listCollections({ name: COLLECTION_NAME }).toArray();
    if (existing.length === 0) {
      await db.createCollection(COLLECTION_NAME);
      console.log(`  + коллекция "${COLLECTION_NAME}" создана`);
    } else {
      console.log(`  ~ коллекция "${COLLECTION_NAME}" уже есть`);
    }

    const collection = db.collection(COLLECTION_NAME);
    await collection.createIndex({ id: 1 }, { unique: true, name: 'uniq_id' });
    await collection.createIndex({ runId: 1 }, { name: 'idx_runId' });
    await collection.createIndex({ createdAt: 1 }, { name: 'idx_createdAt' });
    console.log('  + индексы uniq_id, idx_runId, idx_createdAt на месте');

    // 2. Пользователь приложения: полный readWrite в своей базе.
    await ensureUser(db, {
      user: MONGO_APP_USER,
      pwd: MONGO_APP_PASSWORD,
      roles: [{ role: 'readWrite', db: DB_NAME }],
    });

    // 3. Пользователь проверяющего. Встроенную роль readWrite с указанием collection
    //    MongoDB молча расширяет до всей базы, поэтому создаём свою роль с явными
    //    привилегиями только на учебную коллекцию.
    const checkerRole = 'todo_checker_role';
    const privileges = [
      {
        resource: { db: DB_NAME, collection: COLLECTION_NAME },
        actions: ['find', 'insert', 'update', 'remove', 'killCursors', 'changeStream'],
      },
    ];
    try {
      await db.command({ createRole: checkerRole, privileges, roles: [] });
      console.log(`  + роль "${checkerRole}" создана (только коллекция "${COLLECTION_NAME}")`);
    } catch (error) {
      if (error.code === 51002 || /already exists/i.test(error.message)) {
        await db.command({ updateRole: checkerRole, privileges, roles: [] });
        console.log(`  ~ роль "${checkerRole}" уже была: привилегии синхронизированы`);
      } else {
        throw error;
      }
    }

    await ensureUser(db, {
      user: MONGO_CHECKER_USER,
      pwd: MONGO_CHECKER_PASSWORD,
      roles: [{ role: checkerRole, db: DB_NAME }],
    });

    // 4. Персональное дело автора.
    const manualTitle = `Итоговая работа 24.10.2026: ${OWNER_LOGIN}`;
    const result = await collection.updateOne(
      { id: MANUAL_TASK_ID },
      {
        $setOnInsert: {
          id: MANUAL_TASK_ID,
          ownerLogin: OWNER_LOGIN,
          title: manualTitle,
          done: false,
          runId: 'manual',
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount === 1) {
      console.log(`  + персональное дело создано: "${manualTitle}" (runId=manual)`);
    } else {
      console.log(`  ~ персональное дело уже есть: "${manualTitle}" (runId=manual)`);
    }

    const total = await collection.countDocuments({ ownerLogin: OWNER_LOGIN });
    console.log(`Всего дел автора в коллекции: ${total}`);
  } finally {
    await admin.close();
  }

  // 5. Проверка, что приложение сможет подключиться с учётными данными из MONGO_URI.
  if (MONGO_URI) {
    const app = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    try {
      await app.connect();
      await app.db(DB_NAME).command({ ping: 1 });
      console.log('  + подключение пользователя приложения (MONGO_URI) проверено');
    } catch (error) {
      fail(`приложение не может подключиться по MONGO_URI: ${error.message}`);
    } finally {
      await app.close().catch(() => {});
    }
  }

  console.log('Готово.');
}

main().catch((error) => {
  fail(error.message);
});
