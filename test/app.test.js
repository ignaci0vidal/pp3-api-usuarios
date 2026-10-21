const assert = require('node:assert/strict');
const http = require('node:http');
const { afterEach, beforeEach, test } = require('node:test');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');

const jwtSecret = 'test-jwt-secret-that-is-long-enough-for-this-suite';
const userId = '507f1f77bcf86cd799439011';
let records;
let server;
let baseUrl;

function createFakeUserModel() {
  return {
    async create(data) {
      if ([...records.values()].some((user) => user.email === data.email)) {
        const error = new Error('Duplicate email');
        error.code = 11000;
        throw error;
      }
      const user = { _id: userId, ...data };
      records.set(userId, user);
      return user;
    },
    findOne(filter) {
      return { select: async () => [...records.values()].find((user) => user.email === filter.email) || null };
    },
    async findById(id) {
      return records.get(String(id)) || null;
    },
    async findByIdAndUpdate(id, update) {
      const user = records.get(String(id));
      if (!user) return null;
      Object.assign(user, update.$set);
      return user;
    },
    async countDocuments() {
      return records.size;
    },
    find() {
      throw new Error('Unexpected list in this test');
    },
  };
}

beforeEach(async () => {
  process.env.JWT_SECRET = jwtSecret;
  records = new Map();
  const app = createApp({ UserModel: createFakeUserModel(), connectionState: () => 1 });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('public registration always assigns client role and never returns a password hash', async () => {
  const response = await fetch(`${baseUrl}/api/usuarios`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Cliente',
      apellido: 'Demo',
      email: 'CLIENTE@example.com',
      password: 'password-segura',
      role: 'admin',
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.user.role, 'client');
  assert.equal(result.user.email, 'cliente@example.com');
  assert.equal(JSON.stringify(result).includes('passwordHash'), false);
  assert.match(records.get(userId).passwordHash, /^\$2[aby]\$/);
});

test('session creation verifies bcrypt credentials and issues a role-bearing JWT', async () => {
  await fetch(`${baseUrl}/api/usuarios`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Cliente',
      apellido: 'Demo',
      email: 'cliente@example.com',
      password: 'password-segura',
    }),
  });
  const response = await fetch(`${baseUrl}/api/sesiones`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'CLIENTE@example.com', password: 'password-segura' }),
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(jwt.verify(result.token, jwtSecret).role, 'client');
  assert.equal(result.user.id, userId);
});

test('session creation rejects invalid credentials without revealing account existence', async () => {
  const response = await fetch(`${baseUrl}/api/sesiones`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'missing@example.com', password: 'password-segura' }),
  });
  const result = await response.json();
  assert.equal(response.status, 401);
  assert.equal(result.message, 'Credenciales inválidas');
});

test('admin updates preserve profile fields omitted by the legacy form', async () => {
  await fetch(`${baseUrl}/api/usuarios`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Cliente',
      apellido: 'Vidal',
      email: 'cliente@example.com',
      password: 'password-segura',
      telefono: '1234567',
    }),
  });
  const adminToken = jwt.sign({ sub: 'admin-id', role: 'admin' }, jwtSecret);

  const response = await fetch(`${baseUrl}/api/usuarios/${userId}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Cliente actualizado', email: 'cliente@example.com', role: 'client' }),
  });

  assert.equal(response.status, 200);
  assert.equal(records.get(userId).name, 'Cliente actualizado');
  assert.equal(records.get(userId).apellido, 'Vidal');
  assert.equal(records.get(userId).telefono, '1234567');
});
