const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  legacyId: { type: Number, unique: true, sparse: true },
  name: { type: String, required: true, trim: true },
  apellido: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true },
  telefono: { type: String, default: null },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'client'], default: 'client', required: true },
  carrito: {
    type: [{
      productId: { type: String, required: true },
      quantity: { type: Number, required: true, min: 1 },
    }],
    default: [],
  },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('User', userSchema);
