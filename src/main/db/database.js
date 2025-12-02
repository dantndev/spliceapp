import Datastore from 'nedb-promises'
import { app } from 'electron'
import path from 'path'

// Determinar ruta de guardado (userData)
const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'samples.db')

// Inicializar DB
const db = Datastore.create({
  filename: dbPath,
  autoload: true,
  timestampData: true
})

// Función para guardar una lista de samples
// Usa 'upsert' o insertMany. Para evitar duplicados, usaremos el path como key?
// NeDB no tiene "insertIgnore" nativo fácil, pero podemos verificar.
// Por simplicidad, en este prototipo, insertamos y permitimos duplicados si el usuario importa 2 veces,
// O filtramos antes. Mejor filtrar: upsert basado en 'path'.

export async function saveSamples(samples) {
  const results = []
  for (const sample of samples) {
    // Upsert: si existe el path, actualiza. Si no, inserta.
    // sample.id se generará si no existe, pero nosotros preferimos usar el path como ID unico logico?
    // Mejor dejemos que NeDB maneje _id, pero busquemos por path.
    const numAffected = await db.update(
      { path: sample.path },
      { $set: sample },
      { upsert: true, returnUpdatedDocs: true }
    )
    results.push(numAffected)
  }
  return results
}

export async function getAllSamples() {
  return await db.find({}).sort({ date: -1 })
}

export async function clearAllSamples() {
  return await db.remove({}, { multi: true })
}
