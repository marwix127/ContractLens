require('dotenv').config()

const express = require('express')
const contractsRouter = require('./src/routes/contracts')

const app = express()
const PORT = process.env.PORT || 3000

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
