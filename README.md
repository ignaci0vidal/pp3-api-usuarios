# PP3 — API de Usuarios

Microservicio independiente del proyecto de comercio electrónico de PP3, a cargo de Ignacio Vidal. Gestiona usuarios, autenticación, roles y persistencia del carrito.

- **Repositorio:** https://github.com/ignaci0vidal/pp3-api-usuarios
- **API pública:** https://pp3-api-usuarios.onrender.com
- **Estado del servicio:** https://pp3-api-usuarios.onrender.com/health
- **Backend:** Node.js, Express, Mongoose, bcryptjs y jsonwebtoken.
- **Alojamiento:** Render, mediante Docker.
- **Base de datos:** MongoDB Atlas, base `ecommerce_users`, colección `users`.

## Alcance y estado

El servicio está desplegado y se comprobó su conexión con Atlas, el registro público con persistencia y el inicio de sesión del administrador en Render. En ejecución local también se comprobó la consulta del perfil con token y el rechazo de la misma consulta sin token.

La integración con el API Gateway, el frontend y los otros microservicios está pendiente. Este repositorio contiene únicamente la API de Usuarios. Catálogo y Pedidos deben administrar sus propias bases; no necesitan acceso directo a MongoDB de Usuarios.

## Estructura

| Archivo o carpeta | Responsabilidad |
| --- | --- |
| `src/server.js` | Carga de configuración, conexión a MongoDB e inicio del servidor |
| `src/app.js` | Rutas HTTP, autenticación, autorización y validaciones |
| `src/User.js` | Modelo de usuario y carrito en Mongoose |
| `scripts/seed.js` | Carga o actualización de las diez cuentas de demostración |
| `scripts/set-admin.js` | Script auxiliar de administración de roles; revisar su implementación antes de usarlo |
| `test/app.test.js` | Pruebas automatizadas de la aplicación |
| `Dockerfile` | Construcción de la imagen del servicio |
| `.env.example` | Referencia de configuración, sin credenciales reales |

Los comandos se ejecutan desde la raíz del repositorio, donde se encuentra `package.json`.

## Ejecución local

Requisito del proyecto: **Node.js 22 o superior** y npm. Se necesita un usuario de base de datos de Atlas y autorización de red para la IP desde la que se ejecuta el servicio.

```powershell
git clone https://github.com/ignaci0vidal/pp3-api-usuarios.git
cd pp3-api-usuarios
npm ci
Copy-Item .env.example .env
```

Editar `.env` con la configuración propia:

```dotenv
PORT=3101
MONGODB_URI=mongodb+srv://USUARIO:CLAVE_CODIFICADA@HOST_ATLAS/ecommerce_users?authSource=admin
JWT_SECRET=REEMPLAZAR_POR_UN_SECRETO_ALEATORIO_DE_AL_MENOS_32_CARACTERES
```

El ejemplo es una plantilla: reemplazar usuario, contraseña, host y secreto. Los caracteres reservados de la contraseña deben codificarse para una URI. El nombre `ecommerce_users` debe estar en la ruta de la conexión; `authSource=admin` identifica la base de autenticación y no cambia la base de datos de la aplicación.

No subir `.env` a Git. `.env.example` debe contener solo valores de ejemplo. El archivo `.env` se usa localmente; en Render los valores se configuran como variables de entorno.

```powershell
npm start
```

El servidor escucha en `0.0.0.0` y utiliza el puerto configurado. Para reiniciarlo localmente, detenerlo con Ctrl+C y ejecutar nuevamente `npm start`.

```powershell
Invoke-RestMethod http://localhost:3101/health
```

Respuesta con conexión activa, **200 OK**:

```json
{ "status": "ok", "service": "users" }
```

Si Mongoose no está conectado, la ruta devuelve **503** con `status: "unavailable"`. Esta comprobación consulta el estado de conexión; no prueba todas las operaciones de la API.

## Datos de demostración

```powershell
npm run seed
```

El script usa `MONGODB_URI` del entorno local. Si apunta a Atlas, carga los datos directamente allí y Render puede consultarlos sin reiniciarse. Se bloquea cuando `NODE_ENV` es exactamente `production`; no forma parte del arranque del servicio.

Todas las cuentas de esta demostración usan la contraseña **`demo1234`** por decisión del equipo para la presentación académica.

| Nombre | Email | Rol |
| --- | --- | --- |
| Administrador Demo | `admin@example.com` | `admin` |
| Cliente Demo | `cliente@example.com` | `client` |
| Lionel Messi | `lionel.messi@example.com` | `client` |
| Mirtha Legrand | `mirtha.legrand@example.com` | `client` |
| Bizarrap Demo | `bizarrap@example.com` | `client` |
| María Becerra | `maria.becerra@example.com` | `client` |
| Ricardo Darín | `ricardo.darin@example.com` | `client` |
| Taylor Swift | `taylor.swift@example.com` | `client` |
| Zendaya Demo | `zendaya@example.com` | `client` |
| Keanu Reeves | `keanu.reeves@example.com` | `client` |

El seed busca por email y realiza un `upsert`. No borra la colección ni usuarios ajenos a la lista, pero **sobrescribe nombre, apellido, teléfono, contraseña y rol** de las cuentas que coinciden. Conserva sus carritos existentes y crea un carrito vacío para cuentas nuevas. Las contraseñas se guardan como hashes bcrypt con costo 12.

## Contrato HTTP

Las solicitudes con cuerpo deben enviar `Content-Type: application/json`. El límite configurado del cuerpo JSON es 256 KB. Los identificadores de usuario son cadenas correspondientes a ObjectId de MongoDB.

En rutas protegidas, enviar:

```http
Authorization: Bearer TOKEN
```

| Método | Ruta | Acceso | Resultado exitoso |
| --- | --- | --- | --- |
| GET | `/health` | Público | 200, estado de conexión |
| POST | `/api/usuarios` | Público | 201, registro con rol `client` |
| POST | `/api/sesiones` | Público | 201, JWT y datos del usuario |
| GET | `/api/usuarios/me` | JWT | 200, perfil propio |
| GET | `/api/usuarios/me/carrito` | JWT | 200, carrito propio |
| PUT | `/api/usuarios/me/carrito` | JWT | 200, reemplazo del carrito propio |
| GET | `/api/usuarios/admin-session` | JWT con rol `admin` | 200, datos extraídos del token |
| GET | `/api/usuarios` | Administrador | 200, listado paginado |
| POST | `/api/usuarios/admin` | Administrador | 201, alta con rol indicado |
| GET | `/api/usuarios/:id` | Administrador | 200, usuario solicitado |
| PUT | `/api/usuarios/:id` | Administrador | 200, actualización del usuario |
| DELETE | `/api/usuarios/:id` | Administrador | 200, eliminación del usuario |

### Registro

```http
POST /api/usuarios
Content-Type: application/json
```

```json
{
  "name": "Ana",
  "apellido": "Pérez",
  "email": "ana@example.com",
  "password": "ejemplo1234",
  "telefono": "1100000010"
}
```

El campo se llama **`name`**, no `nombre`. Nombre y apellido no pueden estar vacíos, el email debe tener formato válido y la contraseña requiere al menos ocho caracteres. El teléfono es opcional y, si se informa, solo admite dígitos. El email se normaliza a minúsculas y se eliminan espacios de los extremos.

El registro público siempre asigna `client`, aunque el cuerpo incluya otro rol.

Respuesta **201 Created**:

```json
{
  "success": true,
  "message": "Usuario registrado con éxito",
  "user": {
    "id": "ID_GENERADO",
    "name": "Ana",
    "apellido": "Pérez",
    "email": "ana@example.com",
    "telefono": "1100000010",
    "role": "client"
  }
}
```

Errores: **400** por datos inválidos, **409** por email duplicado y **500** por un fallo interno.

### Inicio de sesión

```http
POST /api/sesiones
Content-Type: application/json
```

```json
{ "email": "admin@example.com", "password": "demo1234" }
```

Respuesta **201 Created** con `success`, `message`, `token` y `user`. El JWT dura **dos horas** e incluye `sub`, `id`, `name`, `apellido`, `email` y `role`, además de las marcas temporales de JWT.

Errores: **400** por campos faltantes, **401** por credenciales incorrectas y **500** por un fallo interno. El mensaje de credenciales incorrectas es el mismo tanto si el email no existe como si la contraseña no coincide.

### Perfil y carrito

`GET /api/usuarios/me` devuelve `{ "success": true, "user": { ... } }`. Consulta al usuario por `sub` del JWT y devuelve **404** si no existe.

`GET /api/usuarios/me/carrito` devuelve `{ "success": true, "carrito": [...] }`.

Para reemplazar el carrito completo:

```http
PUT /api/usuarios/me/carrito
Authorization: Bearer TOKEN
Content-Type: application/json
```

```json
{
  "carrito": [
    { "productId": "1", "quantity": 2 },
    { "productId": "3", "quantity": 1 }
  ]
}
```

Enviar `{ "carrito": [] }` para vaciarlo. `productId` debe tener formato de dígitos y `quantity` debe poder convertirse a un entero seguro positivo. Se guardan como cadena y número, respectivamente.

Este servicio persiste referencias y cantidades: **no verifica que el producto exista, ni su precio o stock**. Esa validación corresponde a la integración con Catálogo y Pedidos.

### Administración

`GET /api/usuarios?page=1&limit=10` devuelve `items` y `pagination`. El tamaño predeterminado es 10, con máximo 100. La paginación incluye `page`, `limit`, `totalItems`, `totalPages`, `hasPreviousPage` y `hasNextPage`.

`POST /api/usuarios/admin` recibe `name`, `apellido`, `email`, `password`, `role` y `telefono`. `role` puede ser `admin` o `client`; por defecto es `client`. Incluir un apellido no vacío para satisfacer el modelo. Devuelve `{ "success": true, "usuario": { ... } }`.

`GET /api/usuarios/:id` devuelve el objeto público del usuario directamente, sin envoltorio `user` o `usuario`.

`PUT /api/usuarios/:id` requiere `name`, `email` y `role`. Acepta `apellido` y `telefono`; si se omiten, conserva sus valores anteriores. No actualiza contraseñas. Devuelve `{ "success": true, "usuario": { ... } }`.

`DELETE /api/usuarios/:id` devuelve `{ "success": true, "message": "Usuario eliminado correctamente" }`. Impide que el administrador elimine su propio usuario con **400**.

`GET /api/usuarios/admin-session` valida el JWT y su rol; devuelve `{ "user": { "id": "...", "name": "...", "apellido": "...", "role": "admin" } }`. No consulta la base para esta validación.

Las rutas administrativas rechazan solicitudes sin token con **401**, y tokens válidos sin rol `admin` con **403**. Las consultas y eliminaciones por ID inexistente devuelven **404**. La actualización devuelve **400** ante un ID inválido. Las altas y modificaciones con email duplicado devuelven **409**.

## Modelo persistido

| Campo | Tipo / uso |
| --- | --- |
| `_id` | ObjectId generado por MongoDB |
| `legacyId` | Número opcional, índice único y disperso para compatibilidad |
| `name`, `apellido` | Texto obligatorio |
| `email` | Texto obligatorio, normalizado e índice único |
| `telefono` | Texto o `null` |
| `passwordHash` | Hash bcrypt obligatorio; excluido por defecto en consultas Mongoose |
| `role` | `admin` o `client` |
| `carrito` | Lista de referencias `productId` y cantidades `quantity` |
| `createdAt`, `updatedAt` | Fechas administradas por Mongoose |

Las respuestas públicas de usuario exponen `id`, `name`, `apellido`, `email`, `telefono` y `role`; no incluyen `passwordHash`.

## Integración del futuro API Gateway

Destino del servicio:

```text
https://pp3-api-usuarios.onrender.com
```

1. Configurar esa URL como destino de Usuarios en el Gateway. El nombre de la variable debe acordarse con su implementación; este servicio no impone uno.
2. Reenviar las rutas `/api/usuarios` y `/api/sesiones`, incluidos sus subrecursos, conservando método, query parameters, cuerpo JSON y header `Authorization`.
3. Preservar los códigos y cuerpos de respuesta, o documentar explícitamente cualquier transformación. No asumir que todas las rutas usan el mismo envoltorio JSON.
4. Si el Gateway verifica estos JWT con firma simétrica, configurar allí el mismo `JWT_SECRET`, compartido por un canal privado. El frontend no debe recibirlo.
5. Permitir el registro y la creación de sesiones sin exigir un JWT previo. Conservar la autorización del propio microservicio en las rutas protegidas.
6. Configurar CORS en el Gateway para el origen del frontend cuando se implemente la conexión desde navegador. El código actual de Usuarios no configura CORS.

El Gateway no necesita `MONGODB_URI` ni credenciales de Atlas. Actualmente esta API es accesible directamente y no exige un token interno entre servicios.

## Configuración del despliegue utilizado

| Campo | Configuración |
| --- | --- |
| Repositorio | `ignaci0vidal/pp3-api-usuarios` |
| Rama | `main` |
| Runtime | Docker |
| Directorio raíz | Raíz del repositorio |
| Región utilizada | Oregon |
| Health Check Path | `/health` |
| Variables | `MONGODB_URI`, `JWT_SECRET` |
| Puerto | El proporcionado por Render mediante `PORT` |

El despliegue se realizó en una instancia Free. Según el aviso mostrado por Render durante la configuración, puede suspenderse por inactividad y demorar la primera petición al reactivarse.

En Atlas se autorizaron los rangos de salida mostrados para este servicio: `74.220.48.0/24` y `74.220.56.0/24`, además de la IP local usada para desarrollo. Para otro despliegue, consultar sus propios rangos de salida en Render.

Los datos están en Atlas, por lo que no dependen del disco del contenedor. Cambiar variables de entorno requiere aplicarlas mediante un nuevo despliegue o reinicio según la opción del panel.

## Pruebas

```powershell
npm test
```

Para ejecutar únicamente el archivo de pruebas del servicio:

```powershell
npm test -- test/app.test.js
```

Se observaron cuatro pruebas aprobadas en ese archivo: registro público con rol cliente y sin exposición del hash; inicio de sesión con bcrypt y JWT con rol; rechazo de credenciales incorrectas; y conservación de campos omitidos en la actualización administrativa. Esto no equivale a cobertura completa de todas las rutas.

### Comprobación manual en Render

```powershell
$baseUrl = 'https://pp3-api-usuarios.onrender.com'
Invoke-RestMethod "$baseUrl/health"

$body = @{
    email = 'admin@example.com'
    password = 'demo1234'
} | ConvertTo-Json

$sesion = Invoke-RestMethod -Uri "$baseUrl/api/sesiones" `
    -Method Post -ContentType 'application/json' -Body $body

$headers = @{ Authorization = "Bearer $($sesion.token)" }
Invoke-RestMethod -Uri "$baseUrl/api/usuarios/me" -Headers $headers
Invoke-RestMethod -Uri "$baseUrl/api/usuarios?page=1&limit=20" -Headers $headers
```

El token queda en una variable; no es necesario publicarlo. Para comprobar el rechazo sin autenticación:

```powershell
try {
    Invoke-WebRequest -Uri "$baseUrl/api/usuarios/me" -UseBasicParsing
} catch {
    [int]$_.Exception.Response.StatusCode
    $_.ErrorDetails.Message
}
```

Se espera **401**. Los comandos son una guía reproducible; no todas estas comprobaciones se han ejecutado sobre Render en esta entrega.

## Limitaciones técnicas identificadas

- En el alta administrativa, la validación HTTP permite omitir `apellido`, pero el modelo lo exige. Esa entrada puede producir **500** en lugar de **400**. También hay diferencias de validación de teléfono entre las rutas públicas y administrativas.
- La autorización administrativa usa el rol del JWT sin consultar si la cuenta sigue existiendo o conserva ese rol. Un token anterior puede seguir autorizando hasta vencer, incluso después de cambiar el rol o borrar la cuenta. No hay revocación de tokens implementada.
- Las respuestas alternan `user`, `usuario`, objetos directos y distintos formatos de error. El consumidor debe respetar el contrato específico de cada ruta.
- El `PUT` administrativo conserva campos omitidos; su comportamiento corresponde a una actualización parcial aunque la ruta use PUT.
- El carrito no valida existencia, stock ni duplicación de productos. Se limita a persistir referencias y cantidades.
- No se ha configurado versionado de rutas, CORS, limitación de intentos de login ni autenticación interna del Gateway en el código de `app.js` revisado.

Estas limitaciones describen la implementación revisada; no se consideran correcciones ya realizadas.
