require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/User');

async function promoteUser(emailArgument) {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  const email = typeof emailArgument === 'string' ? emailArgument.trim().toLowerCase() : '';
  if (!email) throw new Error('Provide the registered account email as the first argument');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const user = await User.findOneAndUpdate(
      { email },
      { $set: { role: 'admin' } },
      { new: true },
    );
    if (!user) throw new Error(`No user found with email ${email}`);
    console.log(`Administrator role assigned to ${user.email}`);
  } finally {
    await mongoose.disconnect();
  }
}

promoteUser(process.argv[2]).catch((error) => {
  console.error('Could not assign administrator role:', error.message);
  process.exitCode = 1;
});
