import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Play,
  Pause,
  Search,
  Folder,
  Music,
  Plus,
  HardDrive,
  Filter,
  FileAudio,
  ArrowRightFromLine,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'

// --- COMPONENTS ---

// Helper para determinar el tipo de audio correcto
const getMimeType = (filePath) => {
  const ext = filePath.split('.').pop().toLowerCase()
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'ogg') return 'audio/ogg'
  if (ext === 'flac') return 'audio/flac'
  if (ext === 'm4a') return 'audio/mp4'
  if (ext === 'aif' || ext === 'aiff') return 'audio/x-aiff'
  return 'audio/wav' // Fallback
}

// Waveform Player usando Buffer Directo (Estrategia Anti-Bloqueo)
const WaveformPlayer = ({ audioPath, isPlaying, onFinish }) => {
  const containerRef = useRef(null)
  const wavesurferRef = useRef(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return
    let active = true 
    let blobUrl = null

    const initWaveSurfer = async () => {
      setLoading(true)
      setError(null)

      try {
        console.log("Pidiendo buffer al backend para:", audioPath)
        
        // 1. PEDIMOS LOS DATOS AL BACKEND (IPC)
        // Esto evita el 'Failed to fetch' porque no usa la red/disco directo del navegador
        const buffer = await window.electron.ipcRenderer.invoke('read-file-buffer', audioPath)
        
        if (!active) return
        
        if (!buffer) {
            console.error("El backend devolvió null. Verifica que main/index.js tenga el handler 'read-file-buffer'.")
            throw new Error("Lectura fallida")
        }
        
        console.log("Buffer recibido. Bytes:", buffer.byteLength || buffer.length)

        // 2. Crear Blob URL en memoria
        const mimeType = getMimeType(audioPath)
        const blob = new Blob([buffer], { type: mimeType })
        blobUrl = URL.createObjectURL(blob)

        if (wavesurferRef.current) {
          wavesurferRef.current.destroy()
        }

        // 3. Iniciar WaveSurfer con la URL del Blob
        wavesurferRef.current = WaveSurfer.create({
          container: containerRef.current,
          waveColor: '#4b5563', 
          progressColor: '#3b82f6', 
          cursorColor: 'transparent',
          barWidth: 2,
          barGap: 1,
          height: 32, 
          normalize: true,
          url: blobUrl, // Usamos la URL de memoria, que es segura
        })

        wavesurferRef.current.on('finish', () => {
          if (onFinish) onFinish()
        })

        wavesurferRef.current.on('ready', () => {
          setLoading(false)
          wavesurferRef.current.setVolume(0.5)
          if (isPlaying) wavesurferRef.current.play()
        })
        
        wavesurferRef.current.on('error', (e) => {
          console.error("WaveSurfer Error:", e)
          if (active) setError("Error Decodificación")
        })

      } catch (e) {
        console.error("Error loading audio:", e)
        if (active) {
            // Detectamos si falta la conexión con el backend
            if (e.message && (e.message.includes("No handler") || e.message.includes("ipcRenderer"))) {
                setError("Reinicia Terminal")
            } else {
                setError("Error Carga")
            }
        }
      }
    }

    initWaveSurfer()

    return () => {
      active = false
      if (wavesurferRef.current) wavesurferRef.current.destroy()
      if (blobUrl) URL.revokeObjectURL(blobUrl) // Limpieza de memoria
    }
  }, [audioPath]) 

  useEffect(() => {
    if (!wavesurferRef.current) return
    try {
      if (isPlaying) {
        wavesurferRef.current.play()
      } else {
        wavesurferRef.current.pause()
      }
    } catch (e) { console.error(e) }
  }, [isPlaying])

  if (error) {
    return (
        <div className="w-full h-full flex items-center justify-center bg-red-900/20 text-red-400 text-[10px] gap-1 px-2 rounded font-bold border border-red-900/50 cursor-help" title={error}>
            <AlertCircle size={12}/> <span className="truncate">{error}</span>
        </div>
    )
  }

  if (loading) {
     return (
        <div className="w-full h-full flex items-center gap-[2px] opacity-40 animate-pulse">
            {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="w-1 bg-gray-600 rounded-full" style={{ height: '50%' }} />
            ))}
        </div>
     )
  }

  return <div ref={containerRef} className="w-full h-full" />
}

const StaticWaveform = () => (
  <div className="w-full h-full flex items-center gap-[2px] opacity-40">
    {Array.from({ length: 40 }).map((_, i) => (
      <div
        key={i}
        className="w-1 bg-gray-600 rounded-full"
        style={{ height: `${20 + Math.random() * 60}%` }}
      />
    ))}
  </div>
)

const FilterPill = ({ label, value, options, onChange, placeholder = "Select" }) => {
  return (
     <div className="flex flex-col gap-1 min-w-[120px]">
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{label}</span>
        <div className="relative">
          <select 
            className="w-full bg-[#1e1e1e] text-gray-300 text-xs py-1.5 px-2 rounded border border-gray-700 outline-none appearance-none cursor-pointer hover:border-blue-500 transition-colors"
            value={value}
            onChange={e => onChange(e.target.value)}
          >
            <option value="">{placeholder}</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"/>
        </div>
     </div>
  )
}

export default function SampleManagerApp() {
  const [samples, setSamples] = useState([])
  const [libraries, setLibraries] = useState([])
  const [currentView, setCurrentView] = useState('pool')
  const [playingId, setPlayingId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Pagination
  const [page, setPage] = useState(1)
  const ITEMS_PER_PAGE = 50

  // Filters
  const [filterKey, setFilterKey] = useState('')
  const [filterBpmMin, setFilterBpmMin] = useState('')
  const [filterBpmMax, setFilterBpmMax] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [showFilters, setShowFilters] = useState(true)

  const [showImportModal, setShowImportModal] = useState(false)
  const [importConfig, setImportConfig] = useState({ name: '', genre: '' })

  // Initial Load
  useEffect(() => {
    const loadSamples = async () => {
      try {
        const allSamples = await window.electron.ipcRenderer.invoke('get-all-samples').catch(() => [])
        if (allSamples && allSamples.length > 0) {
          setSamples(allSamples)
          const libs = [...new Set(allSamples.map((s) => s.library))]
          setLibraries(libs)
        }
      } catch (e) {
        console.log("No hay samples guardados previamente")
      }
    }
    loadSamples()
  }, [])

  useEffect(() => {
    setPage(1)
  }, [currentView, searchQuery, filterKey, filterCategory, filterBpmMin, filterBpmMax])

  const startImportProcess = () => {
    setImportConfig({ name: '', genre: '' })
    setShowImportModal(true)
  }

  const handleImport = async (type, paths = null) => {
    setShowImportModal(false)
    try {
      const result = await window.electron.ipcRenderer.invoke('import-content', { type, paths })

      if (result && result.files.length > 0) {
        const newSamples = result.files.map(f => ({
           ...f,
           library: result.folderName,
           bpm: f.name.match(/(\d{2,3})\s?bpm/i)?.[1] || null,
           key: f.name.match(/([A-G][#b]?)\s?(min|maj|m)/i)?.[0]?.toUpperCase() || null,
           category: 'Imported' 
        }))

        setSamples(prev => [...prev, ...newSamples])
        setLibraries(prev => {
           if (!prev.includes(result.folderName)) return [...prev, result.folderName]
           return prev
        })
        setCurrentView(result.folderName || 'pool')
      } else if (result) {
        if (!paths) alert('No se encontraron audios válidos.')
      }
    } catch (e) {
      console.error(e)
      alert('Error al importar.')
    }
  }

  const handleAppDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files).map((f) => f.path)
      handleImport('drag-folder', paths) 
    }
  }
  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragToDAW = (e, path) => {
    e.preventDefault()
    window.electron.ipcRenderer.send('ondragstart', path)
  }

  const togglePlay = (id) => {
    if (playingId === id) {
      setPlayingId(null)
    } else {
      setPlayingId(id)
    }
  }

  const filtered = useMemo(() => {
    return samples.filter((s) => {
      if (currentView !== 'pool' && s.library !== currentView) return false
      if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
      if (filterKey && s.key !== filterKey) return false
      if (filterCategory && s.category !== filterCategory) return false
      if (filterBpmMin && (!s.bpm || s.bpm < parseInt(filterBpmMin))) return false
      if (filterBpmMax && (!s.bpm || s.bpm > parseInt(filterBpmMax))) return false
      return true
    })
  }, [samples, currentView, searchQuery, filterKey, filterCategory, filterBpmMin, filterBpmMax])

  const paginated = useMemo(() => {
    return filtered.slice(0, page * ITEMS_PER_PAGE)
  }, [filtered, page])

  const uniqueKeys = useMemo(
    () => [...new Set(samples.map((s) => s.key).filter(Boolean))].sort(),
    [samples]
  )
  const uniqueCats = useMemo(
    () => [...new Set(samples.map((s) => s.category).filter(Boolean))].sort(),
    [samples]
  )

  return (
    <div
      className="flex h-screen bg-[#121212] text-gray-300 font-sans overflow-hidden relative"
      onDrop={handleAppDrop}
      onDragOver={handleDragOver}
    >
      {/* Import Modal */}
      {showImportModal && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1f1f1f] border border-gray-700 p-6 rounded-lg w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Añadir Samples</h2>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => handleImport('folder')}
                className="px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold flex items-center justify-center gap-2"
              >
                <Folder size={18} /> Escanear Carpeta
              </button>
              <button
                onClick={() => handleImport('files')}
                className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-bold flex items-center justify-center gap-2"
              >
                <FileAudio size={18} /> Elegir Archivos
              </button>
            </div>
            <button
              onClick={() => setShowImportModal(false)}
              className="w-full text-center text-xs text-gray-500 hover:text-white mt-4"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className="w-64 bg-[#1a1a1a] border-r border-gray-800 flex flex-col">
        <div className="p-4 flex items-center gap-2 drag-region">
          <div className="bg-blue-600 p-1 rounded">
            <Music size={16} color="white" />
          </div>
          <span className="font-bold text-white">Soundstarter</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <button
            onClick={() => setCurrentView('pool')}
            className={`w-full text-left px-3 py-2 rounded flex items-center gap-2 text-sm ${currentView === 'pool' ? 'bg-blue-900/40 text-blue-400' : 'hover:bg-gray-800'}`}
          >
            <HardDrive size={14} /> Pool Global
          </button>
          <div className="pt-4 px-3 flex justify-between text-xs font-bold text-gray-500">
            LIBRERÍAS{' '}
            <Plus size={14} className="cursor-pointer hover:text-white" onClick={startImportProcess} />
          </div>
          {libraries.map((lib) => (
            <button
              key={lib}
              onClick={() => setCurrentView(lib)}
              className={`w-full text-left px-3 py-2 rounded flex items-center gap-2 text-sm truncate ${currentView === lib ? 'bg-blue-900/40 text-blue-400' : 'hover:bg-gray-800'}`}
            >
              <Folder size={14} /> {lib}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <div className="border-b border-gray-800 bg-[#121212] flex flex-col z-10">
          <div className="h-14 flex items-center px-4 gap-4 drag-region">
            <Search size={16} className="text-gray-500" />
            <input
              className="bg-transparent outline-none flex-1 text-sm no-drag text-white placeholder-gray-600"
              placeholder="Buscar por nombre..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div 
               className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-white transition-colors"
               onClick={() => setShowFilters(!showFilters)}
            >
               <Filter size={14} /> Filtros {showFilters ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
            </div>
          </div>
          {/* Filters... */}
          {showFilters && (
             <div className="px-4 pb-4 pt-2 border-t border-gray-800/50 bg-[#181818] flex flex-wrap gap-4 items-end">
                <FilterPill label="Categoría" value={filterCategory} onChange={setFilterCategory} options={uniqueCats} />
                <FilterPill label="Musical Key" value={filterKey} onChange={setFilterKey} options={uniqueKeys} />
             </div>
          )}
        </div>

        {/* List Header */}
        <div className="flex items-center gap-4 px-4 py-2 bg-[#1a1a1a] text-[10px] text-gray-500 font-bold uppercase tracking-wider border-b border-gray-800">
           <div className="w-8"></div>
           <div className="flex-1">Name / Lib</div>
           <div className="w-48">Preview</div>
           <div className="w-12 text-center">BPM</div>
           <div className="w-12 text-center">Key</div>
           <div className="w-20 text-right">Type</div>
           <div className="w-8"></div>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto">
          {paginated.map((s) => (
             <div
               key={s._id || s.path}
               draggable
               onDragStart={(e) => handleDragToDAW(e, s.path)}
               className={`flex items-center gap-4 px-4 py-2 border-b border-gray-800/30 hover:bg-[#252525] group select-none transition-colors h-14 ${playingId === (s._id || s.path) ? 'bg-[#1e2530]' : ''}`}
               onDoubleClick={() => togglePlay(s._id || s.path)}
             >
               <button onClick={() => togglePlay(s._id || s.path)} className="w-8 flex justify-center flex-shrink-0">
                 {playingId === (s._id || s.path) ? <Pause size={16} className="text-blue-400 fill-current" /> : <Play size={16} className="text-gray-500 group-hover:text-white" />}
               </button>
               <div className="flex-1 min-w-0 flex flex-col justify-center">
                 <div className={`text-sm font-medium truncate ${playingId === (s._id || s.path) ? 'text-blue-400' : 'text-gray-300'}`}>{s.name}</div>
                 <div className="text-[10px] text-gray-600 truncate">{s.library}</div>
               </div>
               <div className="w-48 h-full py-2 flex items-center">
                 {playingId === (s._id || s.path) ? (
                   <WaveformPlayer audioPath={s.path} isPlaying={true} onFinish={() => setPlayingId(null)} />
                 ) : ( <StaticWaveform /> )}
               </div>
               <div className="w-12 text-center text-xs text-gray-500 font-mono">{s.bpm || '-'}</div>
               <div className="w-12 text-center text-xs text-gray-500 font-mono">{s.key || '-'}</div>
               <div className="w-20 text-right text-xs text-gray-500 truncate">{s.category}</div>
               <div className="w-8 flex justify-center cursor-grab active:cursor-grabbing text-gray-600 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity" draggable onDragStart={(e) => handleDragToDAW(e, s.path)}>
                 <ArrowRightFromLine size={16} />
               </div>
             </div>
          ))}
        </div>
      </div>
    </div>
  )
}