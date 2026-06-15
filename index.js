require('dotenv').config()

const express = require('express')
const cors = require('cors')
const contractsRouter = require('./src/routes/contracts')

const app = express()
const PORT = process.env.PORT || 3000

// En producción, el frontend (Vercel) está en otro origen: permitimos solo el
// configurado en FRONTEND_URL. En local, sin configurar, se permite cualquiera.
// Se normaliza quitando la barra final: el Origin del navegador nunca la lleva
// y CORS compara de forma exacta (una barra de más bloquea todas las llamadas).
const allowedOrigin = process.env.FRONTEND_URL?.replace(/\/+$/, '')
app.use(cors({ origin: allowedOrigin || true }))
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'ContractLens API', status: 'ok' })
})

app.use('/contracts', contractsRouter)

// Manejo centralizado de errores (multer, validación de archivos, etc.)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera el límite de 20 MB' })
  }
  if (err.message === 'Solo se aceptan archivos PDF') {
    return res.status(415).json({ error: err.message })
  }
  console.error(err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})
