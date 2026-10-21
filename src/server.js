require('dotenv').config();
const mongoose = require('mongoose');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3101);
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters');
}

async function start() {
  await mongoose.connect(process.env.MONGODB_URI);
  const server = createApp().listen(port, '0.0.0.0', () => {
    console.log(`Users service listening on port ${port}`);
  });

  async function shutdown() {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error('Could not start users service:', error);
  process.exitCode = 1;
});
