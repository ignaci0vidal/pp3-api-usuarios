// Shared by HTTP validation and the Mongoose schema.
const DNI_PATTERN = /^\d{7,8}$/;
const ADDRESS_MAX_LENGTH = 300;

function normalizeOptionalText(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value.trim() || null : value;
}

function validateProfileFields(body) {
  const fields = {};
  for (const key of ['dni', 'direccion']) {
    // Omitted values must not overwrite an existing profile on updates.
    if (body[key] === undefined) continue;
    const value = normalizeOptionalText(body[key]);
    if (value !== null && typeof value !== 'string') {
      return { error: `${key === 'dni' ? 'El DNI' : 'La dirección'} debe ser texto` };
    }
    if (key === 'dni' && value !== null && !DNI_PATTERN.test(value)) {
      return { error: 'El DNI debe contener 7 u 8 dígitos, sin puntos ni espacios' };
    }
    if (key === 'direccion' && value !== null && value.length > ADDRESS_MAX_LENGTH) {
      return { error: `La dirección debe tener como máximo ${ADDRESS_MAX_LENGTH} caracteres` };
    }
    fields[key] = value;
  }
  return { fields };
}

module.exports = { DNI_PATTERN, ADDRESS_MAX_LENGTH, normalizeOptionalText, validateProfileFields };
