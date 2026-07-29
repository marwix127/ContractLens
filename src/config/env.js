const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const projectRoot = path.resolve(__dirname, '..', '..')

// En desarrollo preferimos .env.local para que las credenciales o URLs de
// Railway guardadas en .env no se usen por accidente. En producción, las
// variables inyectadas por el proveedor conservan prioridad porque dotenv no
// sobrescribe valores existentes.
const requestedFile = process.env.ENV_FILE
const candidates = requestedFile
  ? [path.resolve(process.cwd(), requestedFile)]
  : [
      path.join(projectRoot, '.env.local'),
      path.join(projectRoot, '.env')
    ]

const envFile = candidates.find(candidate => fs.existsSync(candidate))
if (envFile) dotenv.config({ path: envFile, quiet: true })

module.exports = { envFile }
