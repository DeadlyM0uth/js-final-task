// Генерация случайного токена для API_TOKEN: 32 байта энтропии в hex (64 символа).
import { randomBytes } from 'node:crypto';

const token = randomBytes(32).toString('hex');
console.log(token);
