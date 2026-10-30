// DOOM game page (runs inside an iframe: the app's CSP forbids WebAssembly in the main window).
// Engine: https://github.com/jacobenget/doom.wasm (GPL-2.0); the Doom shareware WAD is embedded in doom.wasm.

const TICK_MS = 1000 / 35
let modulePromise = null
let activeGame = null

function loadModule(url) {
  if (!modulePromise) {
    modulePromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`doom.wasm HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((bytes) => WebAssembly.compile(bytes))
    modulePromise.catch(() => { modulePromise = null })
  }
  return modulePromise
}

/** Card with a start button; the game starts on click so old cards in history do not all run. */
function mountLauncher(el, wasmUrl, autostart = false) {
  const root = document.createElement('div')
  root.style.cssText = 'display:flex;flex-direction:column;gap:6px;font:12px/1.4 system-ui,"Segoe UI",sans-serif'

  const stage = document.createElement('div')
  stage.style.cssText =
    'position:relative;width:100%;max-width:640px;aspect-ratio:8/5;background:#000;border-radius:6px;overflow:hidden;' +
    'display:flex;align-items:center;justify-content:center'

  const button = document.createElement('button')
  button.textContent = '▶ DOOM 시작'
  button.style.cssText =
    'padding:10px 18px;font:600 14px system-ui;color:#fff;background:#8b0000;border:0;border-radius:6px;cursor:pointer'
  stage.append(button)

  const help = document.createElement('div')
  help.style.cssText = 'opacity:.7;font-size:11px'
  help.textContent =
    '게임 클릭 후 조작 · 이동 ←↑→↓ · 발사 Ctrl/클릭 · 문열기 Space · 옆걸음 , . · 달리기 Shift · 무기 1-7 · 메뉴 Esc · 확인 Enter · 포커스가 빠지면 일시정지'

  root.append(stage, help)
  el.replaceChildren(root)

  let game = null
  const start = () => {
    button.disabled = true
    button.textContent = '불러오는 중…'
    startGame(stage, wasmUrl)
      .then((g) => { game = g })
      .catch((error) => {
        button.disabled = false
        button.textContent = '▶ 다시 시도'
        help.textContent = `DOOM 실행 실패: ${error && error.message ? error.message : error}`
      })
  }
  button.addEventListener('click', start)
  if (autostart) start()

  return () => {
    if (game) game.stop()
    el.replaceChildren()
  }
}

async function startGame(stage, wasmUrl) {
  if (activeGame) activeGame.stop()
  const module = await loadModule(wasmUrl)

  const canvas = document.createElement('canvas')
  canvas.tabIndex = 0
  canvas.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated;outline:none;cursor:crosshair'
  const g2d = canvas.getContext('2d')
  let memory = null
  let image = null
  let pixels = null

  // Game time stops while paused so Doom does not fast-forward missed tics on resume.
  let pausedAt = 0
  let pausedTotal = 0
  const now = () => (pausedAt || performance.now()) - pausedTotal

  const decoder = new TextDecoder('utf-8', { fatal: false })
  const readString = (ptr, len) => decoder.decode(new Uint8Array(memory.buffer, ptr, len))

  const imports = {
    loading: {
      onGameInit(width, height) {
        canvas.width = width
        canvas.height = height
        image = g2d.createImageData(width, height)
        pixels = new Uint32Array(image.data.buffer)
      },
      wadSizes() {}, // no external WAD: the embedded shareware WAD is used
      readWads() {}
    },
    ui: {
      drawFrame(ptr) {
        // Doom pixels are 0xAARRGGBB (bytes B,G,R,A); ImageData wants bytes R,G,B,A.
        const src = new Uint32Array(memory.buffer, ptr, pixels.length)
        for (let i = 0; i < src.length; i++) {
          const s = src[i]
          pixels[i] = 0xff000000 | ((s & 0xff) << 16) | (s & 0xff00) | ((s >>> 16) & 0xff)
        }
        g2d.putImageData(image, 0, 0)
      }
    },
    runtimeControl: { timeInMilliseconds: () => BigInt(Math.trunc(now())) },
    console: {
      onInfoMessage(ptr, len) { console.log('[doom]', readString(ptr, len)) },
      onErrorMessage(ptr, len) { console.error('[doom]', readString(ptr, len)) }
    },
    gameSaving: { sizeOfSaveGame: () => 0, readSaveGame: () => 0, writeSaveGame: () => 0 }
  }

  const instance = await WebAssembly.instantiate(module, imports)
  const ex = instance.exports
  memory = ex.memory

  const keyMap = new Map([
    ['ArrowLeft', ex.KEY_LEFTARROW], ['ArrowRight', ex.KEY_RIGHTARROW],
    ['ArrowUp', ex.KEY_UPARROW], ['ArrowDown', ex.KEY_DOWNARROW],
    [',', ex.KEY_STRAFE_L], ['.', ex.KEY_STRAFE_R],
    ['Control', ex.KEY_FIRE], [' ', ex.KEY_USE], ['Shift', ex.KEY_SHIFT],
    ['Tab', ex.KEY_TAB], ['Escape', ex.KEY_ESCAPE], ['Enter', ex.KEY_ENTER],
    ['Backspace', ex.KEY_BACKSPACE], ['Alt', ex.KEY_ALT]
  ].map(([k, v]) => [k, v && typeof v === 'object' ? v.value : v]))
  const fireKey = keyMap.get('Control')

  const toDoomKey = (e) => {
    if (keyMap.has(e.key)) return keyMap.get(e.key)
    if (e.key.length === 1) return e.key.toLowerCase().charCodeAt(0)
    return null
  }

  const held = new Set()
  const releaseAll = () => {
    for (const k of held) ex.reportKeyUp(k)
    held.clear()
  }
  const onKeyDown = (e) => {
    e.stopPropagation()
    e.preventDefault()
    const k = toDoomKey(e)
    if (k === null || held.has(k)) return
    held.add(k)
    ex.reportKeyDown(k)
  }
  const onKeyUp = (e) => {
    e.stopPropagation()
    e.preventDefault()
    const k = toDoomKey(e)
    if (k === null) return
    held.delete(k)
    ex.reportKeyUp(k)
  }
  const onMouseDown = (e) => {
    if (e.button !== 0) return
    if (document.activeElement !== canvas) { canvas.focus(); return }
    held.add(fireKey)
    ex.reportKeyDown(fireKey)
  }
  const onMouseUp = (e) => {
    if (e.button !== 0 || !held.has(fireKey)) return
    held.delete(fireKey)
    ex.reportKeyUp(fireKey)
  }

  let timer = 0
  let stopped = false
  const tick = () => {
    try {
      ex.tickGame()
    } catch (error) {
      console.error('[doom] crashed', error)
      game.stop()
    }
  }
  const resume = () => {
    if (stopped || timer) return
    if (pausedAt) { pausedTotal += performance.now() - pausedAt; pausedAt = 0 }
    timer = setInterval(tick, TICK_MS)
    canvas.style.opacity = '1'
  }
  const pause = () => {
    releaseAll()
    clearInterval(timer)
    timer = 0
    if (!pausedAt) pausedAt = performance.now()
    canvas.style.opacity = '.55'
  }

  canvas.addEventListener('keydown', onKeyDown)
  canvas.addEventListener('keyup', onKeyUp)
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('focus', resume)
  canvas.addEventListener('blur', pause)
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  stage.replaceChildren(canvas)
  ex.initGame()
  ex.tickGame()

  const game = {
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      timer = 0
      canvas.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('focus', resume)
      canvas.removeEventListener('blur', pause)
      if (canvas.isConnected) canvas.style.opacity = '.35'
      if (activeGame === game) activeGame = null
    }
  }
  activeGame = game
  canvas.focus()
  resume()
  return game
}

const params = new URLSearchParams(location.search)
mountLauncher(document.getElementById('root'), new URL('./doom.wasm', import.meta.url).href, params.get('autostart') === '1')
