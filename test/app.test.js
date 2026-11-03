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
      dni: '12345678',
      direccion: 'Calle Prueba 123',
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
  assert.equal(records.get(userId).dni, '12345678');
  assert.equal(records.get(userId).direccion, 'Calle Prueba 123');
});

const registration = {
  name: 'Cliente', apellido: 'Demo', email: 'cliente@example.com', password: 'password-segura',
};

test('newly registered user has one readable profile before and after completing registration', async () => {
  const created = await register();
  assert.equal(created.status, 201);
  const id = (await created.json()).user.id;
  const headers = { ...jsonHeaders, authorization: `Bearer ${clientToken()}` };
  const initial = await fetch(`${baseUrl}/api/usuarios/me`, { headers });
  assert.equal(initial.status, 200);
  const before = (await initial.json()).user;
  assert.equal(before.id, id);
  assert.equal(before.dni, null);
  assert.equal(before.direccion, null);
  const body = { name: ' Cliente actualizado ', apellido: ' Prueba ', dni: '12345678', telefono: '1123456789', direccion: 'Calle Prueba 123' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const updated = await fetch(`${baseUrl}/api/usuarios/me`, { method: 'PUT', headers, body: JSON.stringify(body) });
    assert.equal(updated.status, 200);
    const user = (await updated.json()).user;
    assert.equal(user.id, id);
    assert.equal(user.name, 'Cliente actualizado');
    assert.equal(user.apellido, 'Prueba');
    assert.equal(user.dni, body.dni);
    assert.equal(user.role, 'client');
  }
  assert.equal(records.size, 1);
  const restored = await fetch(`${baseUrl}/api/usuarios/me`, { headers });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).user.direccion, body.direccion);
});

test('profile returns 401 for invalid sessions and 404 only for nonexistent account', async () => {
  await register();
  for (const token of [undefined, 'invalid', jwt.sign({ sub: userId }, jwtSecret, { expiresIn: -1 })]) {
    const response = await fetch(`${baseUrl}/api/usuarios/me`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    assert.equal(response.status, 401);
  }
  const token = jwt.sign({ sub: '507f1f77bcf86cd799439012' }, jwtSecret);
  const response = await fetch(`${baseUrl}/api/usuarios/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).message, 'Usuario no encontrado');
});

test('URLs with verbs and separate customer resources are no longer endpoints', async () => {
  for (const [method, path] of [['POST', '/api/usuarios/auth/register'], ['POST', '/api/usuarios/auth/login'], ['POST', '/api/clientes'], ['GET', '/api/clientes/perfil'], ['PATCH', '/api/usuarios/me']]) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: jsonHeaders });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).message, 'Ruta no encontrada');
  }
});
const jsonHeaders = { 'content-type': 'application/json' };
const clientToken = () => jwt.sign({ sub: userId, role: 'client' }, jwtSecret);
const adminToken = () => jwt.sign({ sub: 'admin-id', role: 'admin' }, jwtSecret);

async function register(extra = {}) {
  return fetch(`${baseUrl}/api/usuarios`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ...registration, ...extra }),
  });
}

test('registration, login and own profile round-trip DNI and address without placing them in JWT', async () => {
  const response = await register({ dni: ' 01234567 ', direccion: ' Av. Prueba 123 ' });
  assert.equal(response.status, 201);
  const created = (await response.json()).user;
  assert.equal(created.dni, '01234567');
  assert.equal(created.direccion, 'Av. Prueba 123');
  assert.equal(records.get(userId).dni, created.dni);
  assert.equal(records.get(userId).direccion, created.direccion);
  const session = await fetch(`${baseUrl}/api/sesiones`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(registration),
  });
  assert.equal(session.status, 201);
  const result = await session.json();
  assert.equal(result.user.dni, created.dni);
  const claims = jwt.verify(result.token, jwtSecret);
  assert.equal(claims.dni, undefined);
  assert.equal(claims.direccion, undefined);
  const profile = await fetch(`${baseUrl}/api/usuarios/me`, { headers: { authorization: `Bearer ${result.token}` } });
  assert.equal(profile.status, 200);
  assert.deepEqual((await profile.json()).user, created);
});

test('legacy users expose null optional fields and can still log in', async () => {
  assert.equal((await register()).status, 201);
  delete records.get(userId).dni;
  delete records.get(userId).direccion;
  const response = await fetch(`${baseUrl}/api/sesiones`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(registration),
  });
  assert.equal(response.status, 201);
  const { user } = await response.json();
  assert.equal(user.dni, null);
  assert.equal(user.direccion, null);
});

test('both registration routes reject invalid DNI and address before persisting', async () => {
  for (const route of ['/api/usuarios', '/api/usuarios/admin']) {
    for (const fields of [{ dni: '123456' }, { dni: '12.345.678' }, { dni: 12345678 }, { dni: {} }, { direccion: [] }, { direccion: 'x'.repeat(301) }]) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST', headers: { ...jsonHeaders, authorization: `Bearer ${adminToken()}` },
        body: JSON.stringify({ ...registration, ...fields }),
      });
      assert.equal(response.status, 400, JSON.stringify({ route, fields }));
      assert.equal(records.size, 0);
    }
  }
});

test('administrator can create, read, change and clear DNI and address', async () => {
  const headers = { ...jsonHeaders, authorization: `Bearer ${adminToken()}` };
  const created = await fetch(`${baseUrl}/api/usuarios/admin`, {
    method: 'POST', headers, body: JSON.stringify({ ...registration, dni: '1234567', direccion: 'Calle 123' }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).usuario.dni, '1234567');
  const read = await fetch(`${baseUrl}/api/usuarios/${userId}`, { headers });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).direccion, 'Calle 123');
  const update = await fetch(`${baseUrl}/api/usuarios/${userId}`, {
    method: 'PUT', headers, body: JSON.stringify({ name: 'Cliente', email: registration.email, role: 'client', dni: '7654321', direccion: 'Calle 456' }),
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).usuario.dni, '7654321');
  const invalid = await fetch(`${baseUrl}/api/usuarios/${userId}`, {
    method: 'PUT', headers, body: JSON.stringify({ name: 'Cliente', email: registration.email, role: 'client', dni: 'no' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(records.get(userId).dni, '7654321');
  const cleared = await fetch(`${baseUrl}/api/usuarios/${userId}`, {
    method: 'PUT', headers, body: JSON.stringify({ name: 'Cliente', email: registration.email, role: 'client', dni: null, direccion: ' ' }),
  });
  assert.equal(cleared.status, 200);
  const user = (await cleared.json()).usuario;
  assert.equal(user.dni, null);
  assert.equal(user.direccion, null);
});

test('own profile update authenticates and only modifies allowed fields on token owner', async () => {
  await register({ dni: '12345678', direccion: 'Dirección anterior', telefono: '1234' });
  const put = (body, token) => fetch(`${baseUrl}/api/usuarios/me`, {
    method: 'PUT', headers: { ...jsonHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await put({ dni: '7654321' })).status, 401);
  assert.equal((await put({ dni: '7654321' }, 'invalid')).status, 401);
  const expired = jwt.sign({ sub: userId, role: 'client' }, jwtSecret, { expiresIn: -1 });
  assert.equal((await put({ dni: '7654321' }, expired)).status, 401);
  for (const body of [{}, { role: 'admin' }, { dni: '7654321', id: 'another-user' }, { dni: 'abc' }, { direccion: 'x'.repeat(301) }, { telefono: {} }]) {
    assert.equal((await put(body, clientToken())).status, 400);
  }
  assert.equal(records.get(userId).dni, '12345678');
  assert.equal(records.get(userId).role, 'client');
  const response = await put({ direccion: ' Nueva dirección ', telefono: '5678' }, clientToken());
  assert.equal(response.status, 200);
  const user = (await response.json()).user;
  assert.equal(user.direccion, 'Nueva dirección');
  assert.equal(user.dni, '12345678');
  assert.equal(user.telefono, '5678');
  const clear = await put({ dni: '', direccion: null }, clientToken());
  assert.equal(clear.status, 200);
  assert.equal((await clear.json()).user.dni, null);
  const missing = jwt.sign({ sub: '507f1f77bcf86cd799439012', role: 'client' }, jwtSecret);
  assert.equal((await put({ dni: '7654321' }, missing)).status, 404);
});
