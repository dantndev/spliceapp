import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'
import path from 'path'
import { parseFile } from 'music-metadata'
import { saveSamples, getAllSamples } from './db/database'
import { fileURLToPath } from 'url'

// Register privileged scheme to bypass some security restrictions
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } }
])

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#121212',
    titleBarStyle: 'hidden',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false 
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- HELPER: AUDIO CLASSIFICATION & ANALYSIS ---
const AUDIO_EXTENSIONS = /\.(wav|mp3|aif|aiff|flac|ogg|m4a)$/i

function detectCategory(filename) {
  const lower = filename.toLowerCase()
  if (lower.includes('kick')) return 'Kick'
  if (lower.includes('snare') || lower.includes('clap') || lower.includes('snap')) return 'Snare'
  if (lower.includes('hat') || lower.includes('hihat') || lower.includes('cymbal')) return 'HiHat'
  if (lower.includes('bass') || lower.includes('808')) return 'Bass'
  if (lower.includes('loop')) return 'Loop'
  if (lower.includes('vox') || lower.includes('vocal')) return 'Vocal'
  if (lower.includes('fx') || lower.includes('sweep') || lower.includes('riser')) return 'FX'
  if (lower.includes('perc')) return 'Percussion'
  return 'Other'
}

function detectBpmAndKey(filename, metadata) {
  let bpm = null
  let key = null

  // 1. Try Metadata
  if (metadata && metadata.common) {
    if (metadata.common.bpm) bpm = metadata.common.bpm
    if (metadata.common.key) key = metadata.common.key
  }

  // 2. Try Filename Regex
  if (!bpm) {
    const bpmMatch = filename.match(/(\d{2,3})\s?bpm/i)
    if (bpmMatch) bpm = parseInt(bpmMatch[1])
  }
  if (!key) {
    // Basic Key Regex: Cmin, C#maj, etc.
    const keyMatch = filename.match(/([A-G][#b]?)\s?(min|maj|m)/i)
    if (keyMatch) key = keyMatch[0].toUpperCase()
  }

  return { bpm, key }
}

async function processFile(filePath, libraryName) {
  try {
    const stat = fs.statSync(filePath)
    const filename = path.basename(filePath)

    // Parse Metadata
    let metadata = {}
    try {
      metadata = await parseFile(filePath)
    } catch (e) {
      // Ignore metadata error, continue with basic file info
    }

    const { bpm, key } = detectBpmAndKey(filename, metadata)
    const category = detectCategory(filename)
    const duration = metadata.format ? metadata.format.duration : 0

    return {
      name: filename,
      path: filePath,
      size: stat.size,
      date: stat.mtime,
      library: libraryName,
      category,
      bpm: bpm ? Math.round(bpm) : null,
      key,
      duration
    }
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err)
    return null
  }
}

// Recursive Scan
async function scanDirectory(dir) {
  let results = []
  try {
    const list = fs.readdirSync(dir)
    for (const file of list) {
      const fullPath = path.join(dir, file)
      try {
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          const subResults = await scanDirectory(fullPath)
          results = results.concat(subResults)
        } else if (AUDIO_EXTENSIONS.test(file)) {
          results.push(fullPath) // Store paths first, process later to be clean
        }
      } catch (err) {
        console.error(err)
      }
    }
  } catch (err) {
    console.error(err)
  }
  return results
}

// --- IPC HANDLERS ---

ipcMain.handle('import-content', async (event, { type, paths }) => {
  // type: 'folder' | 'files' | 'drag-folder'
  // paths: optional array of paths (for drag & drop)

  let filePathsToProcess = []
  let folderName = 'Imported'

  // 1. Determine Source
  if (paths) {
    // Drag & Drop Source
    for (const p of paths) {
      const stat = fs.statSync(p)
      if (stat.isDirectory()) {
        folderName = path.basename(p)
        const folderFiles = await scanDirectory(p)
        filePathsToProcess = filePathsToProcess.concat(folderFiles)
      } else if (AUDIO_EXTENSIONS.test(p)) {
        filePathsToProcess.push(p)
      }
    }
  } else {
    // Dialog Source
    const isFolder = type === 'folder'
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: isFolder ? 'Select Folder' : 'Select Samples',
      properties: isFolder ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'aif', 'flac', 'ogg', 'm4a'] }]
    })

    if (canceled || filePaths.length === 0) return null

    if (isFolder) {
      folderName = path.basename(filePaths[0])
      filePathsToProcess = await scanDirectory(filePaths[0])
    } else {
      folderName = 'Individual'
      filePathsToProcess = filePaths
    }
  }

  if (filePathsToProcess.length === 0) return { folderName, files: [] }

  // 2. Process Files (Analyze)
  const processedFiles = []
  for (const fp of filePathsToProcess) {
    const res = await processFile(fp, folderName)
    if (res) processedFiles.push(res)
  }

  // 3. Save to DB
  if (processedFiles.length > 0) {
    await saveSamples(processedFiles)
  }

  return { folderName, files: processedFiles }
})

ipcMain.handle('get-all-samples', async () => {
  return await getAllSamples()
})

ipcMain.on('ondragstart', (event, filePath) => {
  event.sender.startDrag({
    file: filePath,
    icon: icon
  })
})

app.whenReady().then(() => {
  // --- PROTOCOL HANDLER ---
  protocol.handle('media', (req) => {
    // URL format: media://path/to/file
    // On Windows: media://C:/path/to/file -> pathname is /C:/path/to/file (Unix style) or just C:/path?
    // Let's inspect how valid URLs are formed in Renderer and adjust.
    // Assuming Renderer sends: media://C:/Users/Music/file.wav
    // URL object pathname might be /C:/Users/Music/file.wav
    // We need to strip the leading slash if on Windows, or use fileURLToPath logic.
    
    // Easier approach: Reconstruct file:// URL
    const url = req.url.replace('media://', '')
    // Decode URI components (spaces, etc.)
    const filePath = decodeURI(url)
    
    return net.fetch('file://' + filePath)
  })

  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  createWindow()
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
