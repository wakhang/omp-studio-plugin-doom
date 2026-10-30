// DOOM — host tool `play_doom`. It returns a Markdown image line; the renderer (renderer.js) replaces
// that image in the chat reply with a playable doom.wasm game (same pattern as the model-viewer plugin).

exports.activate = (ctx) => {
  const line = `![DOOM](omp-plugin://${ctx.pluginId}/play.png)`
  ctx.registerHostTool({
    definition: {
      name: 'play_doom',
      label: 'DOOM',
      description:
        'Puts a playable DOOM (1993 shareware) game into the chat. Call it when the user wants to play DOOM. ' +
        `It returns the Markdown line ${line}; copy that exact line into your final reply where the game should appear.`,
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    async execute() {
      return {
        content: [
          {
            type: 'text',
            text:
              `${line}\n\nCopy the line above verbatim into your final reply; the chat turns it into the game. ` +
              'Controls to tell the user: click the game, arrows move, Ctrl or left click fire, Space use/open, , . strafe, ' +
              'Shift run, 1-7 weapons, Esc menu, Enter confirm. Do not call play_doom again.'
          }
        ]
      }
    }
  })
  ctx.log('play_doom 도구를 등록했습니다')
}

exports.deactivate = () => {}
