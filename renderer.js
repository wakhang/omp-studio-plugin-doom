// DOOM — turns `![DOOM](omp-plugin://doom/play.png)` images in chat replies (returned by the play_doom tool)
// into the game, and offers the same game in a modal from the composer button / command palette.
// The game runs in an iframe (game.html): the app window's CSP does not allow compiling WebAssembly.

let observer = null
const mounted = new Map() // img -> host element

export function activate(ctx) {
  const gameUrl = new URL('./game.html', import.meta.url).href
  const selector = `img[src^="omp-plugin://${ctx.pluginId}/play"]`

  const frame = (autostart) => {
    const iframe = document.createElement('iframe')
    iframe.src = autostart ? `${gameUrl}?autostart=1` : gameUrl
    iframe.title = 'DOOM'
    iframe.style.cssText = 'display:block;width:100%;max-width:640px;aspect-ratio:640/432;border:0;background:transparent'
    return iframe
  }

  const attach = (img) => {
    if (mounted.has(img)) return
    img.style.display = 'none'
    const host = frame(false)
    img.after(host)
    mounted.set(img, host)
  }
  const scan = (root) => {
    if (root.matches && root.matches(selector)) attach(root)
    if (root.querySelectorAll) for (const img of root.querySelectorAll(selector)) attach(img)
  }
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') scan(m.target)
      for (const n of m.addedNodes) if (n.nodeType === 1) scan(n)
    }
    for (const [img, host] of mounted) {
      if (!img.isConnected) { host.remove(); mounted.delete(img) }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
  scan(document)

  const openModal = () =>
    ctx.ui.modal({
      title: 'DOOM',
      width: 680,
      mount(el) {
        el.replaceChildren(frame(true))
        return () => el.replaceChildren()
      }
    })
  ctx.registerComposerAction({ id: 'doom.play', title: 'DOOM 플레이', icon: '👹', run: openModal })
  ctx.registerCommand({ id: 'doom.play', title: 'DOOM 플레이', run: openModal })
}

export function deactivate() {
  if (observer) observer.disconnect()
  observer = null
  for (const [img, host] of mounted) { host.remove(); img.style.display = '' }
  mounted.clear()
}
