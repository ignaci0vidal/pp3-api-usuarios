const assert = require('node:assert/strict');
const { test } = require('node:test');
const User = require('../src/User');

const required = { name: 'Cliente', apellido: 'Prueba', email: 'test@example.com', passwordHash: 'hash-de-prueba' };

test('Mongoose persists optional DNI and address without requiring migration of existing users', () => {
  const legacy = new User(required);
  assert.equal(legacy.validateSync(), undefined);
  assert.equal(legacy.dni, null);
  assert.equal(legacy.direccion, null);
  const current = new User({ ...required, dni: ' 01234567 ', direccion: ' Av. Prueba 123 ' });
  assert.equal(current.validateSync(), undefined);
  const stored = current.toObject();
  assert.equal(stored.dni, '01234567');
  assert.equal(stored.direccion, 'Av. Prueba 123');
});

test('Mongoose rejects malformed DNI and oversized addresses', () => {
  assert.ok(new User({ ...required, dni: '12.345.678' }).validateSync().errors.dni);
  assert.ok(new User({ ...required, direccion: 'x'.repeat(301) }).validateSync().errors.direccion);
  const cleared = new User({ ...required, dni: ' ', direccion: '' });
  assert.equal(cleared.validateSync(), undefined);
  assert.equal(cleared.dni, null);
  assert.equal(cleared.direccion, null);
});
