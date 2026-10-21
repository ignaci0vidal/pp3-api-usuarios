const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('./User');

function authorizeAdmin(req, res, next) {
  const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ message: 'Autenticación requerida' });
  try {
    req.claims = jwt.verify(token, process.env.JWT_SECRET);
    if (req.claims.role !== 'admin') return res.status(403).json({ message: 'Se requieren permisos de administrador' });
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token inválido o expirado' });
    }
    return next(error);
  }
}

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    apellido: user.apellido,
    email: user.email,
    telefono: user.telefono,
    role: user.role,
  };
}

function createApp({ UserModel = User, connectionState = () => mongoose.connection.readyState } = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', async (_req, res) => {
    const state = connectionState();
    res.status(state === 1 ? 200 : 503).json({
      status: state === 1 ? 'ok' : 'unavailable',
      service: 'users',
    });
  });

  app.post('/api/usuarios', async (req, res) => {
    const { name, apellido, email, password, telefono } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (typeof name !== 'string' || !name.trim() || typeof apellido !== 'string' || !apellido.trim()
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'Nombre, apellido, email y contraseña son obligatorios' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres' });
    }
    if (telefono != null && telefono !== '' && !/^\d+$/.test(String(telefono))) {
      return res.status(400).json({ success: false, message: 'El teléfono debe contener solo números' });
    }

    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await UserModel.create({
        name: name.trim(),
        apellido: apellido.trim(),
        email: normalizedEmail,
        telefono: telefono ? String(telefono).trim() : null,
        passwordHash,
        role: 'client',
      });
      return res.status(201).json({
        success: true,
        message: 'Usuario registrado con éxito',
        user: publicUser(user),
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ success: false, message: 'El correo electrónico ya está registrado' });
      }
      console.error('User registration failed:', error);
      return res.status(500).json({ success: false, message: 'Error al registrar el usuario' });
    }
  });

  app.post('/api/sesiones', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body || {};
    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({ success: false, message: 'Email y contraseña son obligatorios' });
    }
    try {
      const user = await UserModel.findOne({ email }).select('+passwordHash');
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
      }
      const details = publicUser(user);
      const token = jwt.sign({
        sub: details.id,
        id: details.id,
        name: details.name,
        apellido: details.apellido,
        email: details.email,
        role: details.role,
      }, process.env.JWT_SECRET, { expiresIn: '2h' });
      return res.status(201).json({ success: true, message: 'Sesión creada', token, user: details });
    } catch (error) {
      console.error('Session creation failed:', error);
      return res.status(500).json({ success: false, message: 'Error al iniciar sesión' });
    }
  });

  app.get('/api/usuarios/me', async (req, res) => {
    const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    try {
      const claims = jwt.verify(token, process.env.JWT_SECRET);
      const user = await UserModel.findById(claims.sub);
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      return res.json({ success: true, user: publicUser(user) });
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
      }
      console.error('Profile lookup failed:', error);
      return res.status(500).json({ success: false, message: 'Error al consultar el perfil' });
    }
  });

  app.get('/api/usuarios/me/carrito', async (req, res) => {
    const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    try {
      const claims = jwt.verify(token, process.env.JWT_SECRET);
      const user = await UserModel.findById(claims.sub).select('carrito');
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      return res.json({ success: true, carrito: user.carrito });
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
      }
      console.error('Cart lookup failed:', error);
      return res.status(500).json({ success: false, message: 'Error al recuperar el carrito' });
    }
  });

  app.put('/api/usuarios/me/carrito', async (req, res) => {
    const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    const carrito = req.body?.carrito;
    if (!Array.isArray(carrito) || carrito.some((item) => (
      !item || !/^\d+$/.test(String(item.productId)) || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0
    ))) {
      return res.status(400).json({ success: false, message: 'El carrito debe contener productos y cantidades válidas' });
    }
    try {
      const claims = jwt.verify(token, process.env.JWT_SECRET);
      const user = await UserModel.findByIdAndUpdate(
        claims.sub,
        { $set: { carrito: carrito.map((item) => ({ productId: String(item.productId), quantity: Number(item.quantity) })) } },
        { new: true, runValidators: true, projection: 'carrito' },
      );
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      return res.json({ success: true, carrito: user.carrito });
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
      }
      console.error('Cart update failed:', error);
      return res.status(500).json({ success: false, message: 'Error al guardar el carrito' });
    }
  });

  app.get('/api/usuarios/admin-session', async (req, res) => {
    const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ message: 'Autenticación requerida' });
    try {
      const claims = jwt.verify(token, process.env.JWT_SECRET);
      if (claims.role !== 'admin') return res.status(403).json({ message: 'Se requieren permisos de administrador' });
      return res.json({ user: { id: claims.sub, name: claims.name, apellido: claims.apellido, role: claims.role } });
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token inválido o expirado' });
      }
      console.error('Admin session validation failed:', error);
      return res.status(500).json({ message: 'Error al validar la sesión' });
    }
  });

  app.get('/api/usuarios', authorizeAdmin, async (req, res) => {
    try {
      const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 100);
      const [totalItems, users] = await Promise.all([
        UserModel.countDocuments(),
        UserModel.find().sort({ _id: 1 }).skip((page - 1) * limit).limit(limit),
      ]);
      return res.json({
        items: users.map(publicUser),
        pagination: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit),
          hasPreviousPage: page > 1,
          hasNextPage: page < Math.ceil(totalItems / limit),
        },
      });
    } catch (error) {
      console.error('Failed to list users:', error);
      return res.status(500).json({ message: 'No se pudieron consultar los usuarios' });
    }
  });

  app.post('/api/usuarios/admin', authorizeAdmin, async (req, res) => {
    const { name, apellido = '', email, password, role = 'client', telefono = null } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (typeof name !== 'string' || !name.trim()
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      || typeof password !== 'string' || password.length < 8
      || !['admin', 'client'].includes(role)) {
      return res.status(400).json({ message: 'Datos de usuario inválidos' });
    }
    try {
      const user = await UserModel.create({
        name: name.trim(),
        apellido: String(apellido).trim(),
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(password, 12),
        role,
        telefono: telefono ? String(telefono) : null,
      });
      return res.status(201).json({ success: true, usuario: publicUser(user) });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'El correo electrónico ya está registrado' });
      console.error('Failed to create user administratively:', error);
      return res.status(500).json({ message: 'No se pudo crear el usuario' });
    }
  });

  app.get('/api/usuarios/:id', authorizeAdmin, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Usuario no encontrado' });
    try {
      const user = await UserModel.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
      return res.json(publicUser(user));
    } catch (error) {
      console.error('Failed to get user:', error);
      return res.status(500).json({ message: 'No se pudo consultar el usuario' });
    }
  });

  app.put('/api/usuarios/:id', authorizeAdmin, async (req, res) => {
    const { name, apellido, email, role, telefono } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!mongoose.isValidObjectId(req.params.id) || typeof name !== 'string' || !name.trim()
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      || !['admin', 'client'].includes(role)) {
      return res.status(400).json({ message: 'Datos de usuario inválidos' });
    }
    try {
      const user = await UserModel.findByIdAndUpdate(req.params.id, {
        $set: {
          name: name.trim(),
          email: normalizedEmail,
          role,
          ...(apellido === undefined ? {} : { apellido: String(apellido).trim() }),
          ...(telefono === undefined ? {} : { telefono: telefono ? String(telefono) : null }),
        },
      }, { new: true, runValidators: true });
      if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
      return res.json({ success: true, usuario: publicUser(user) });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'El correo electrónico ya está registrado' });
      console.error('Failed to update user:', error);
      return res.status(500).json({ message: 'No se pudo actualizar el usuario' });
    }
  });

  app.delete('/api/usuarios/:id', authorizeAdmin, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Usuario no encontrado' });
    if (String(req.claims.sub) === req.params.id) {
      return res.status(400).json({ message: 'No podés eliminar tu propio usuario mientras estás conectado' });
    }
    try {
      const user = await UserModel.findByIdAndDelete(req.params.id);
      if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
      return res.json({ success: true, message: 'Usuario eliminado correctamente' });
    } catch (error) {
      console.error('Failed to delete user:', error);
      return res.status(500).json({ message: 'No se pudo eliminar el usuario' });
    }
  });

  return app;
}

module.exports = { createApp };
