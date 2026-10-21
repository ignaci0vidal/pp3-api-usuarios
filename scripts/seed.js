require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../src/User');

const demoUsers = [
  { name: 'Administrador', apellido: 'Demo', email: 'admin@example.com', telefono: '1122334455', password: 'demo1234', role: 'admin' },
  { name: 'Cliente', apellido: 'Demo', email: 'cliente@example.com', telefono: '1199887766', password: 'demo1234', role: 'client' },
  { name: 'Lionel', apellido: 'Messi', email: 'lionel.messi@example.com', telefono: '1100000001', password: 'demo1234', role: 'client' },
  { name: 'Mirtha', apellido: 'Legrand', email: 'mirtha.legrand@example.com', telefono: '1100000002', password: 'demo1234', role: 'client' },
  { name: 'Bizarrap', apellido: 'Demo', email: 'bizarrap@example.com', telefono: '1100000003', password: 'demo1234', role: 'client' },
  { name: 'María', apellido: 'Becerra', email: 'maria.becerra@example.com', telefono: '1100000004', password: 'demo1234', role: 'client' },
  { name: 'Ricardo', apellido: 'Darín', email: 'ricardo.darin@example.com', telefono: '1100000005', password: 'demo1234', role: 'client' },
  { name: 'Taylor', apellido: 'Swift', email: 'taylor.swift@example.com', telefono: '1100000006', password: 'demo1234', role: 'client' },
  { name: 'Zendaya', apellido: 'Demo', email: 'zendaya@example.com', telefono: '1100000007', password: 'demo1234', role: 'client' },
  { name: 'Keanu', apellido: 'Reeves', email: 'keanu.reeves@example.com', telefono: '1100000008', password: 'demo1234', role: 'client' },
];

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo users cannot be seeded in production');
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    for (const demoUser of demoUsers) {
      const passwordHash = await bcrypt.hash(demoUser.password, 12);
      await User.findOneAndUpdate(
        { email: demoUser.email },
        {
          $set: {
            name: demoUser.name,
            apellido: demoUser.apellido,
            telefono: demoUser.telefono,
            passwordHash,
            role: demoUser.role,
          },
          $setOnInsert: { email: demoUser.email, carrito: [] },
        },
        { upsert: true, new: true, runValidators: true },
      );
      console.log(`Demo account ready: ${demoUser.email} (${demoUser.role})`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch((error) => {
  console.error('Users seed failed:', error);
  process.exitCode = 1;
});
