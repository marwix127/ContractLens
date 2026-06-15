# ContractLens

> Asistente de análisis de contratos con IA. Sube un contrato en PDF y obtén, en segundos, un resumen ejecutivo, los datos clave extraídos, una detección de riesgos con nivel de severidad y un chat para preguntar sobre el documento con citas a página y cláusula.

**Problema que resuelve:** la revisión inicial de un contrato lleva entre 1 y 2 horas. ContractLens la reduce a unos minutos, dando a despachos pequeños y pymes una primera lectura estructurada antes de la revisión profesional.

---

## Demo

- **App desplegada:** _(pendiente de URL)_
- **Vídeo (Loom):** _(pendiente)_

> ⚠️ ContractLens proporciona un análisis automatizado con fines informativos. **No sustituye el asesoramiento de un profesional legal.**

---

## Arquitectura

```
1. El usuario sube un PDF
        ↓
2. Extracción de texto por páginas (pdf-parse)
        ↓
3. Chunking semántico por cláusulas (página + referencia de cláusula)
        ↓
4. Embeddings (Gemini) → pgvector
        ↓
5. Análisis inicial con structured output (JSON): resumen, datos clave, riesgos
        ↓
6. Persistencia en Postgres (contrato, chunks, análisis)
        ↓
7. Dashboard de análisis + visor del PDF + chat lateral
        ↓
8. Chat RAG: pregunta → embedding → retrieval top-k → respuesta en streaming con citas
```

---

## Stack técnico

**Backend** — Node.js + Express
- `pg` + extensión **pgvector** — Postgres con búsqueda vectorial
- `pdf-parse` (v2) — extracción de texto página a página
- `@google/genai` — embeddings, análisis y chat con Gemini
- `multer` — subida de archivos en memoria

**Frontend** — React 19 + Vite + Tailwind CSS 4
- `react-pdf` — visor de PDF integrado (carga diferida)

**Infraestructura**
- Postgres + pgvector en Railway
- Variables de entorno para credenciales (`.env`)

**Modelos (Gemini)**
- Embeddings: `gemini-embedding-001` (1536 dimensiones)
- Análisis y chat: `gemini-3.5-flash`

---

## Decisiones técnicas

Estas son las decisiones que diferencian el proyecto de un tutorial:

- **Un solo proveedor (Gemini) para embeddings, análisis y chat.** Simplifica la operación y aprovecha un único origen de cuota/credenciales. El diseño aísla cada tarea en su servicio, así que cambiar de modelo o proveedor es trivial.

- **pgvector en vez de una base vectorial dedicada (Pinecone, etc.).** Para este volumen, mantener los vectores junto a los datos relacionales en Postgres elimina una pieza de infraestructura, simplifica los _joins_ (chunk ↔ contrato) y abarata el despliegue. Índice `ivfflat` con distancia coseno.

- **Embeddings a 1536 dimensiones y normalizados manualmente.** `gemini-embedding-001` produce 3072 dimensiones por defecto, pero el índice `ivfflat` de pgvector no admite más de 2000. Se solicita `outputDimensionality: 1536`; como Gemini no normaliza los vectores al truncarlos, se normalizan en código para que la distancia coseno sea correcta. (`taskType` diferenciado: `RETRIEVAL_DOCUMENT` al indexar, `RETRIEVAL_QUERY` al preguntar.)

- **Chunking semántico por cláusulas, no por tamaño fijo.** Se detectan encabezados de cláusula/artículo con expresiones regulares y se parte el texto en esos límites, conservando **número de página y referencia de cláusula** en cada chunk. Esto es lo que permite las citas precisas del chat. Las cláusulas muy largas se subdividen con solapamiento.

- **Structured output (JSON por schema) en el análisis.** El análisis inicial usa un esquema de respuesta de Gemini, lo que garantiza un JSON válido sin parseo frágil.

- **RAG con citas, manejo de "no lo sé", historial y streaming.** El chat recupera los fragmentos más relevantes, responde citando página y cláusula, dice explícitamente cuándo la respuesta no está en el documento (evita alucinaciones), mantiene el contexto entre mensajes y emite la respuesta por **Server-Sent Events**.

- **Reintentos con backoff** para los errores transitorios (429/503) de la API de Gemini, compartidos entre análisis y chat.

- **Disclaimer legal siempre visible** en la interfaz y en las respuestas del análisis.

---

## Estructura del proyecto

```
ContractLens/
├── index.js                  # servidor Express
├── src/
│   ├── db.js                 # pool de conexión a Postgres
│   ├── routes/contracts.js   # endpoints
│   └── services/
│       ├── embeddings.js     # Gemini embeddings (normalizados)
│       ├── chunking.js       # chunking por cláusulas
│       ├── ingest.js         # pipeline chunks → embeddings → pgvector
│       ├── analysis.js       # análisis inicial (structured output)
│       ├── chat.js           # RAG: retrieval + respuesta (normal y streaming)
│       └── retry.js          # reintentos con backoff para Gemini
├── migrations/               # schema y migraciones
├── seed/seed-samples.js      # contratos de muestra para el demo
└── frontend/                 # React + Vite + Tailwind
    └── src/
        ├── api.js
        └── components/       # UploadScreen, ContractView, Dashboard, ChatPanel, PdfViewer
```

---

## Puesta en marcha

### Requisitos
- Node.js 18+
- Una base de datos Postgres con la extensión **pgvector** (p. ej. en Railway)
- Una API key de Gemini ([Google AI Studio](https://aistudio.google.com/apikey))

### 1. Backend

```bash
npm install
```

Crea un archivo `.env` en la raíz:

```env
DATABASE_URL=postgresql://usuario:password@host:puerto/basededatos
GEMINI_API_KEY=tu_api_key
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

Aplica el esquema de base de datos y (opcional) siembra contratos de muestra:

```bash
npm run migrate     # crea tablas + extensión pgvector
npm run seed        # contratos de ejemplo precargados (usa la API de Gemini)
npm run dev         # arranca el backend en http://localhost:3000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev         # http://localhost:5173 (proxy al backend)
```

### Scripts útiles
- `npm run migrate [archivo.sql]` — aplica una migración (por defecto `schema.sql`)
- `npm run db:reset` — vacía todos los datos (mantiene el esquema)
- `npm run seed` — regenera los contratos de muestra

---

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/contracts` | Sube un PDF (campo `file`): extrae texto, chunking e indexado |
| `GET`  | `/contracts` | Lista los contratos |
| `GET`  | `/contracts/samples` | Lista los contratos de muestra |
| `GET`  | `/contracts/:id` | Detalle de un contrato |
| `GET`  | `/contracts/:id/file` | Sirve el PDF original |
| `POST` | `/contracts/:id/analyze` | Genera y guarda el análisis (Gemini) |
| `GET`  | `/contracts/:id/analysis` | Devuelve el análisis guardado |
| `POST` | `/contracts/:id/chat` | Pregunta sobre el contrato (respuesta completa) |
| `POST` | `/contracts/:id/chat/stream` | Igual, con respuesta en streaming (SSE) |

---

## Limitaciones conocidas

- El modelo `gemini-3.5-flash` tiene un límite de cuota diario en el _free tier_; un uso intensivo del análisis y el chat puede agotarlo. El análisis se guarda en base de datos, así que volver a verlo no consume cuota; solo el chat hace llamadas por mensaje.
- El chunking por expresiones regulares está optimizado para contratos en español bien estructurados (Cláusula/Artículo/Estipulación).
- Los PDFs escaneados sin OCR no tienen texto extraíble y se rechazan con un aviso.

---

## Estado y próximos pasos

- [x] Backend completo (upload, chunking, embeddings, análisis, chat con streaming)
- [x] Frontend (upload, dashboard, chat, visor de PDF, contratos de muestra)
- [ ] Despliegue (backend en Railway, frontend en Vercel)
- [ ] Comparación entre versiones de un contrato
- [ ] Export del análisis a PDF
