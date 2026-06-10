# ContractLens — Asistente de Análisis de Contratos con IA

> Proyecto de portfolio + producto vendible para freelance de LLM Integration.
> Stack: Node.js + pgvector + Gemini Flash + Claude Sonnet + React.

---

## 1. Visión del producto

ContractLens es una herramienta web donde el usuario sube un contrato en PDF y obtiene:

1. **Resumen ejecutivo** generado automáticamente.
2. **Extracción estructurada** de datos clave (partes, fechas, importes, jurisdicción, etc.).
3. **Detección de riesgos** y cláusulas inusuales con nivel de severidad.
4. **Chat RAG** para hacer preguntas específicas sobre el documento, con citas a página y cláusula.

**Pitch comercial:**
> *Reduce el tiempo de revisión inicial de contratos de 1-2 horas a 10 minutos. Despliegue personalizado para tu despacho/pyme en 2-3 semanas.*

**Target:** despachos legales pequeños, pymes que firman muchos contratos, departamentos de compras.

---

## 2. Arquitectura

### Flujo principal

```
1. Usuario sube PDF
        ↓
2. Backend extrae texto (pdf-parse)
        ↓
3. Chunking semántico por cláusulas
        ↓
4. Embeddings → pgvector (con metadata: página, cláusula, sección)
        ↓
5. Análisis inicial con Gemini Flash (todo el contrato en contexto)
   → JSON estructurado: resumen, datos clave, riesgos
        ↓
6. Guardado en Postgres asociado al contrato
        ↓
7. Frontend muestra dashboard + chat lateral
        ↓
8. Chat: pregunta → embedding → retrieval top 3-5 chunks → Claude Sonnet
   → respuesta con citas precisas
```

### Por qué este diseño es bueno (criterio senior)

- **Modelo adecuado para cada tarea**: Gemini Flash (barato, contexto largo) para procesamiento masivo inicial; Claude Sonnet para razonamiento final del chat.
- **Structured outputs (JSON)** en la extracción inicial — clave en proyectos profesionales.
- **Chunking semántico por cláusulas**, no por tamaño fijo — diferencia un dev que ha leído tutoriales de uno que entiende RAG.
- **Citas precisas** a página y cláusula — lo que pediría un abogado real.

---

## 3. Stack técnico

### Backend
- Node.js + Express
- `pdf-parse` — extracción de texto
- `@google/genai` — Gemini API
- `@anthropic-ai/sdk` — Claude API
- `pg` + extensión `pgvector` — Postgres con búsqueda vectorial
- `multer` — uploads de archivos

### Frontend
- React + Vite
- Tailwind CSS
- shadcn/ui — componentes bonitos sin esfuerzo
- `react-pdf` — visor de PDF lateral (opcional pero impresiona)

### Infra y despliegue
- Backend en Railway (Postgres + pgvector incluido)
- Frontend en Vercel
- Variables de entorno para API keys (`.env`)

### Modelos LLM
- **Embeddings**: `text-embedding-3-small` (OpenAI) o embeddings de Gemini
- **Análisis inicial masivo**: Gemini 2.5 Flash (barato, contexto largo)
- **Chat RAG (respuestas finales)**: Claude Sonnet

---

## 4. Datos a extraer en el análisis inicial

El JSON estructurado debe incluir:

- **Partes involucradas** — nombres y roles
- **Fechas clave** — firma, inicio, vencimiento, renovación
- **Importes y condiciones económicas**
- **Duración** del contrato
- **Cláusulas de penalización**
- **Confidencialidad / no competencia**
- **Jurisdicción y ley aplicable**
- **Causas de terminación**
- **Riesgos detectados** con nivel (alto/medio/bajo), ubicación y explicación

Todo en una sola llamada a Gemini con structured output. Tarda 5-15 segundos.

---

## 5. Prompt para detección de riesgos

Estructura obligatoria:

1. **Rol claro**:
   > *"Eres un asistente experto en análisis de contratos comerciales. Tu función es identificar cláusulas inusuales, ambiguas o desfavorables."*

2. **Lista de patrones a buscar**:
   - Cláusulas de penalización desproporcionadas
   - Renovaciones automáticas
   - Ausencia de límite de responsabilidad
   - Jurisdicción extranjera inesperada
   - Cláusulas de exclusividad amplias
   - Términos de pago abusivos
   - Cesión unilateral del contrato

3. **Formato de salida estructurado** — cada riesgo con:
   - Título
   - Severidad (alta/media/baja)
   - Ubicación (página, cláusula)
   - Explicación
   - Recomendación

4. **Disclaimer obligatorio en el output**:
   > *"Este análisis no constituye asesoramiento legal y debe ser revisado por un profesional."*

---

## 6. Features que separan demo de producto

Implementar sí o sí:

- [ ] **Citas de fuentes** en cada respuesta del chat (página + cláusula).
- [ ] **Manejo de "no lo sé"** — cuando no está en los documentos, decirlo explícitamente. Evita alucinaciones.
- [ ] **Historial de conversación** — mantener contexto entre mensajes.
- [ ] **Upload por interfaz** — el usuario sube PDFs sin tocar código.
- [ ] **Streaming de respuestas** — palabras apareciendo progresivamente como ChatGPT.

---

## 7. Plan de ejecución (3 fines de semana)

### Fin de semana 1 — Backend + análisis inicial
- [ ] Setup proyecto Node + Postgres + pgvector (Railway o local con Docker).
- [ ] Schema de BD: tablas `contracts`, `chunks`, `analyses`, `conversations`, `messages`.
- [ ] Endpoint `POST /contracts` — upload de PDF.
- [ ] Extracción de texto con `pdf-parse`.
- [ ] Chunking por cláusulas (regex sobre "Cláusula X", "Artículo X", o usar Gemini para identificar secciones).
- [ ] Generación de embeddings y guardado en pgvector.
- [ ] Análisis inicial con Gemini Flash + structured output (JSON).
- [ ] Endpoint `GET /contracts/:id/analysis` para obtener el análisis.

### Fin de semana 2 — Chat RAG + frontend
- [ ] Endpoint `POST /contracts/:id/chat` — embedding pregunta → retrieval → respuesta con Claude.
- [ ] Streaming de respuestas (Server-Sent Events o streaming nativo de Anthropic SDK).
- [ ] Frontend React: pantalla de upload, dashboard de análisis, chat lateral.
- [ ] Visor de PDF integrado con `react-pdf` (opcional).
- [ ] Conexión frontend ↔ backend.

### Fin de semana 3 — Pulido + despliegue
- [ ] Estilos finales con Tailwind + shadcn/ui.
- [ ] Manejo de errores, loading states, casos edge (PDFs muy grandes, idiomas raros, escaneados sin OCR).
- [ ] Despliegue backend en Railway.
- [ ] Despliegue frontend en Vercel.
- [ ] README excelente con arquitectura, decisiones técnicas, capturas.
- [ ] Vídeo Loom de 60-90 segundos mostrando el flujo completo.
- [ ] Post de LinkedIn explicando el proyecto.

---

## 8. Disclaimers legales (obligatorios)

Visible siempre en la interfaz:

> ⚠️ *ContractLens proporciona un análisis automatizado con fines informativos. No sustituye el asesoramiento de un profesional legal. Las decisiones sobre la firma o modificación de contratos deben tomarse con la revisión de un abogado cualificado.*

No es paranoia — es lo que hace que un abogado o pyme se sienta cómodo usándolo y compartiéndolo.

---

## 9. Contratos de prueba para el demo

**No usar contratos reales con datos de empresas reales** (privacidad, propiedad intelectual).

Opciones:
- Contratos ficticios generados con LLMs (pedir a Claude/Gemini que genere NDAs, contratos de servicios, laborales, alquileres realistas).
- Plantillas públicas oficiales (BOE, cámaras de comercio).
- Contratos propios anonimizados.

**Tener 5-10 contratos de muestra precargados en el demo** — el cliente entra y prueba sin subir nada propio.

---

## 10. Diferenciadores opcionales (si sobra tiempo)

Cada uno añade ~1 fin de semana pero multiplica valor percibido:

- **Comparación entre versiones** — subir dos contratos y ver qué cambió.
- **Multi-idioma** — detectar automáticamente español/catalán/inglés y responder en el idioma del contrato.
- **Export a PDF** — el análisis convertido a informe profesional descargable.

---

## 11. Cómo presentar el proyecto después

Igual de importante que construirlo:

1. **Demo en vivo desplegado** — URL pública, probable sin instalar nada.
2. **Vídeo Loom de 60-90 segundos** mostrando: subir PDF → ver análisis → hacer preguntas → recibir respuestas con citas. Añadir al perfil de Upwork, LinkedIn, GitHub.
3. **README en GitHub** con:
   - Problema que resuelve
   - Arquitectura (diagrama simple)
   - Decisiones técnicas (por qué pgvector y no Pinecone, por qué Gemini Flash + Claude Sonnet, cómo manejas alucinaciones)
   - Capturas de pantalla
   - Cómo desplegarlo
4. **Post en LinkedIn** explicando proyecto, decisiones técnicas y aprendizajes. Atrae clientes directamente.

---

## 12. Pitch comercial post-proyecto

> *"ContractLens es un asistente de análisis de contratos para despachos pequeños y pymes. Reduce el tiempo de revisión inicial de 1-2 horas a 10 minutos. Puedo desplegar una versión personalizada para tu empresa, adaptada a tu tipo de contratos, en 2-3 semanas, por X €."*

**Rangos de precio orientativos:**
- Despliegue básico personalizado: 1.500–3.000 €
- Con integraciones (CRM, email, Slack): 3.000–6.000 €
- Mantenimiento mensual: 200–500 €/mes

---

## 13. Variables de entorno necesarias

```env
# Database
DATABASE_URL=postgresql://...

# LLM APIs
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...   # opcional, solo si usas embeddings de OpenAI

# App
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

---

## 14. Schema de base de datos (propuesta inicial)

```sql
-- Activar extensión
CREATE EXTENSION IF NOT EXISTS vector;

-- Contratos subidos
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW(),
  total_pages INTEGER,
  raw_text TEXT
);

-- Chunks con embeddings
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page_number INTEGER,
  clause_reference TEXT,
  embedding vector(1536),  -- ajustar según modelo de embeddings
  metadata JSONB
);

CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops);

-- Análisis estructurado del contrato
CREATE TABLE analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  summary TEXT,
  extracted_data JSONB,  -- partes, fechas, importes, etc.
  risks JSONB,           -- array de riesgos detectados
  created_at TIMESTAMP DEFAULT NOW()
);

-- Conversaciones de chat
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations JSONB,  -- referencias a chunks usados en la respuesta
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 15. Próximos pasos inmediatos

1. Crear repo en GitHub: `contractlens`.
2. Decidir nombre final (si no convence ContractLens).
3. Setup inicial: Node + Express + Postgres local con Docker.
4. Empezar por **Fin de semana 1, paso 1**.
5. Trabajar con Claude Code iterativamente — pedir un endpoint, revisarlo, testear, siguiente.

---

## Notas para trabajar con Claude Code

- Pedir feature a feature, no todo el proyecto de golpe.
- Revisar siempre el código generado antes de aceptar.
- Pedirle tests al menos para los endpoints críticos (upload, análisis, chat).
- Mantener un `CHANGELOG.md` para documentar decisiones.
- Cuando se atasque, pedir explicación del problema antes de pedir solución.