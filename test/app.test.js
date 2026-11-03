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
  const patch = (body, token) => fetch(`${baseUrl}/api/usuarios/me`, {
    method: 'PATCH', headers: { ...jsonHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await patch({ dni: '7654321' })).status, 401);
  assert.equal((await patch({ dni: '7654321' }, 'invalid')).status, 401);
  const expired = jwt.sign({ sub: userId, role: 'client' }, jwtSecret, { expiresIn: -1 });
  assert.equal((await patch({ dni: '7654321' }, expired)).status, 401);
  for (const body of [{}, { role: 'admin' }, { dni: '7654321', id: 'another-user' }, { dni: 'abc' }, { direccion: 'x'.repeat(301) }, { telefono: {} }]) {
    assert.equal((await patch(body, clientToken())).status, 400);
  }
  assert.equal(records.get(userId).dni, '12345678');
  assert.equal(records.get(userId).role, 'client');
  const response = await patch({ direccion: ' Nueva dirección ', telefono: '5678' }, clientToken());
  assert.equal(response.status, 200);
  const user = (await response.json()).user;
  assert.equal(user.direccion, 'Nueva dirección');
  assert.equal(user.dni, '12345678');
  assert.equal(user.telefono, '5678');
  const clear = await patch({ dni: '', direccion: null }, clientToken());
  assert.equal(clear.status, 200);
  assert.equal((await clear.json()).user.dni, null);
  const missing = jwt.sign({ sub: '507f1f77bcf86cd799439012', role: 'client' }, jwtSecret);
  assert.equal((await patch({ dni: '7654321' }, missing)).status, 404);
});

test('reference storefront can register with nombre and log in with usuario.nombre and usuario.rol', async () => {
  const created = await fetch(`${baseUrl}/api/usuarios/auth/register`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ nombre: 'Ana', apellido: 'Prueba', email: 'ana@example.com', password: 'password-segura', role: 'admin' }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).user.role, 'client');
  const response = await fetch(`${baseUrl}/api/usuarios/auth/login`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email: 'ana@example.com', password: 'password-segura' }),
  });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.usuario.nombre, 'Ana');
  assert.equal(data.usuario.rol, 'client');
  assert.equal(data.usuario.id, userId);
  assert.equal(jwt.verify(data.token, jwtSecret).sub, userId);
  assert.equal(JSON.stringify(data).includes('passwordHash'), false);
});

test('reference customer form completes the same account and profile maps a single address to direcciones', async () => {
  await register();
  const headers = { ...jsonHeaders, authorization: `Bearer ${clientToken()}` };
  const initial = await fetch(`${baseUrl}/api/clientes/perfil`, { headers });
  assert.equal(initial.status, 404); // Existing storefront shows its form on 404.
  assert.match((await initial.json()).message, /no encontrado/);
  const response = await fetch(`${baseUrl}/api/clientes`, {
    method: 'POST', headers,
    body: JSON.stringify({ nombre: 'Cliente', apellido: 'Prueba', dni: '12345678', telefono: '1123456789', role: 'admin', userId: 'another-account' }),
  });
  assert.equal(response.status, 200);
  assert.equal(records.size, 1);
  assert.equal(records.get(userId).role, 'client');
  assert.equal(records.get(userId).email, registration.email);
  assert.ok(records.get(userId).passwordHash);
  const completed = await fetch(`${baseUrl}/api/clientes/perfil`, { headers });
  assert.equal(completed.status, 200);
  const result = await completed.json();
  assert.equal(result.dni, '12345678');
  assert.equal(result.telefono, '1123456789');
  assert.deepEqual(result.direcciones, []);
  assert.equal(result.nombre, 'Cliente');
  assert.equal(result.rol, 'client');
  await fetch(`${baseUrl}/api/usuarios/me`, {
    method: 'PATCH', headers, body: JSON.stringify({ direccion: 'Av. Prueba 123, Buenos Aires' }),
  });
  const withAddress = await fetch(`${baseUrl}/api/clientes/perfil`, { headers });
  const address = (await withAddress.json()).direcciones[0];
  assert.equal(address.calle, records.get(userId).direccion);
  assert.equal(address.esPredeterminada, true);
  // Omitted optional fields are preserved when the old form is submitted again.
  await fetch(`${baseUrl}/api/clientes`, {
    method: 'POST', headers, body: JSON.stringify({ nombre: 'Cliente', apellido: 'Prueba', dni: '12345678' }),
  });
  assert.equal(records.get(userId).telefono, '1123456789');
  assert.equal(records.get(userId).direccion, 'Av. Prueba 123, Buenos Aires');
});

test('customer compatibility routes require a valid session and never select another account from the body', async () => {
  await register();
  for (const [method, route] of [['GET', '/api/clientes/perfil'], ['POST', '/api/clientes']]) {
    for (const token of [undefined, 'invalid', jwt.sign({ sub: userId }, jwtSecret, { expiresIn: -1 })]) {
      const response = await fetch(`${baseUrl}${route}`, {
        method, headers: { ...jsonHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      assert.equal(response.status, 401);
    }
  }
  const missing = jwt.sign({ sub: '507f1f77bcf86cd799439012', role: 'client' }, jwtSecret);
  const response = await fetch(`${baseUrl}/api/clientes`, {
    method: 'POST', headers: { ...jsonHeaders, authorization: `Bearer ${missing}` },
    body: JSON.stringify({ nombre: 'Intruso', apellido: 'Prueba', dni: '12345678', id: userId }),
  });
  assert.equal(response.status, 404);
  assert.equal(records.get(userId).name, registration.name);
});

test('customer profile validates DNI, address, name and phone before updating', async () => {
  await register();
  const valid = { nombre: 'Cliente', apellido: 'Prueba', dni: '12345678' };
  for (const body of [{ ...valid, dni: '' }, { ...valid, dni: '12.345.678' }, { ...valid, direccion: {} }, { ...valid, direccion: 'x'.repeat(301) }, { ...valid, nombre: ' ' }, { ...valid, telefono: '12abc' }]) {
    const response = await fetch(`${baseUrl}/api/clientes`, {
      method: 'POST', headers: { ...jsonHeaders, authorization: `Bearer ${clientToken()}` }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(records.get(userId).dni, undefined);
});
