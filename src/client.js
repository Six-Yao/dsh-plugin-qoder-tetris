window.__ModuleLoader__.load({
  id: 'dsh-plugin-tetris',
  factory(require) {
    const React = require('react')
    const { useEffect, useRef, useState } = React
    const h = React.createElement

    // ---------------------------------------------------------------------
    // Game model
    // ---------------------------------------------------------------------

    const COLS = 10
    const ROWS = 20
    const GRAVITY_MS = 680
    const PIECE_TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z']

    const SHAPES = Object.freeze({
      I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
      J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
      L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
      O: [[1, 1], [1, 1]],
      S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
      T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
      Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    })

    // Qoder's PixelBlocksGame palette: blue, lavender, orange, yellow,
    // teal, purple, pink. Cells are painted at 80% over the page.
    const COLORS = Object.freeze({
      I: '#3f8ef7',
      J: '#b49ef9',
      L: '#ea873f',
      O: '#f2c647',
      S: '#55b5a6',
      T: '#605ce5',
      Z: '#da5597',
    })

    // Qoder's brighter palette for the dark surface.
    const COLORS_DARK = Object.freeze({
      I: '#4ba8ff',
      J: '#c9b5ff',
      L: '#fa8125',
      O: '#fac414',
      S: '#4dd4c4',
      T: '#9b96ff',
      Z: '#f472b6',
    })

    const CELL_GAP = 3
    const CELL_RADIUS = 2
    const BLOCK_ALPHA = 0.8

    function emptyRow() {
      return Array(COLS).fill(null)
    }

    function emptyBoard() {
      return Array.from({ length: ROWS }, emptyRow)
    }

    /** Rotate a square matrix 90 degrees clockwise. */
    function rotateCW(matrix) {
      const size = matrix.length
      return matrix.map((row, y) => row.map((_, x) => matrix[size - 1 - x][y]))
    }

    /** Rotate a square matrix 90 degrees counter-clockwise. */
    function rotateCCW(matrix) {
      const size = matrix.length
      return matrix.map((row, y) => row.map((_, x) => matrix[x][size - 1 - y]))
    }

    function collides(board, matrix, x, y) {
      for (let row = 0; row < matrix.length; row += 1) {
        for (let col = 0; col < matrix.length; col += 1) {
          if (!matrix[row][col]) continue
          const boardX = x + col
          const boardY = y + row
          if (boardX < 0 || boardX >= COLS || boardY >= ROWS) return true
          if (boardY >= 0 && board[boardY][boardX]) return true
        }
      }
      return false
    }

    /** Remove full rows and return the compacted board plus the row count. */
    function clearFullRows(board) {
      const remaining = board.filter((row) => row.some((cell) => cell === null))
      const cleared = ROWS - remaining.length
      if (cleared === 0) return { board, cleared: 0 }
      const next = []
      for (let row = 0; row < cleared; row += 1) next.push(emptyRow())
      return { board: next.concat(remaining), cleared }
    }

    /** A shuffled seven-bag keeps piece distribution fair without a score system. */
    function createBag(random) {
      const bag = PIECE_TYPES.slice()
      for (let index = bag.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1))
        const value = bag[index]
        bag[index] = bag[swap]
        bag[swap] = value
      }
      return bag
    }

    /**
     * Qoder paints the playfield as loose tiles, never as a continuous board:
     * 3px gutters between cells and a 2px radius on each tile. The gaps stay
     * transparent so the overlay sits directly on the host background.
     */
    function drawCell(context, x, y, size, color, alpha) {
      const radius = Math.min(CELL_RADIUS, size / 2)
      context.save()
      context.globalAlpha = alpha
      context.fillStyle = color
      context.beginPath()
      context.moveTo(x + radius, y)
      context.arcTo(x + size, y, x + size, y + size, radius)
      context.arcTo(x + size, y + size, x, y + size, radius)
      context.arcTo(x, y + size, x, y, radius)
      context.arcTo(x, y, x + size, y, radius)
      context.closePath()
      context.fill()
      context.restore()
    }

    function createGame(canvas, hooks = {}) {
      const context = canvas && typeof canvas.getContext === 'function'
        ? canvas.getContext('2d')
        : null
      const random = typeof hooks.random === 'function' ? hooks.random : Math.random

      let board = emptyBoard()
      let current = null
      let bag = []
      let started = false
      let paused = false
      let over = false
      let disposed = false
      let raf = 0
      let lastTime = 0
      let gravityAccumulator = 0

      function now() {
        return typeof performance !== 'undefined' ? performance.now() : Date.now()
      }

      function emit() {
        if (typeof hooks.onState === 'function') hooks.onState({ paused, over, started })
      }

      function canPlay() {
        return started && !paused && !over && current !== null
      }

      function spawnPiece() {
        if (bag.length === 0) bag = createBag(random)
        const type = bag.pop()
        const matrix = SHAPES[type].map((row) => row.slice())
        const piece = {
          type,
          matrix,
          x: Math.floor((COLS - matrix.length) / 2),
          y: 0,
        }
        if (collides(board, matrix, piece.x, piece.y)) {
          current = piece
          over = true
          paused = false
          emit()
          return false
        }
        current = piece
        emit()
        return true
      }

      function lockPiece() {
        if (!current) return
        for (let row = 0; row < current.matrix.length; row += 1) {
          for (let col = 0; col < current.matrix.length; col += 1) {
            if (!current.matrix[row][col]) continue
            const boardY = current.y + row
            if (boardY >= 0 && boardY < ROWS) board[boardY][current.x + col] = current.type
          }
        }
        const result = clearFullRows(board)
        board = result.board
        current = null
        gravityAccumulator = 0
        spawnPiece()
      }

      function moveBy(dx, dy) {
        if (!canPlay()) return false
        if (collides(board, current.matrix, current.x + dx, current.y + dy)) return false
        current.x += dx
        current.y += dy
        return true
      }

      function softDrop() {
        if (!canPlay()) return false
        if (!moveBy(0, 1)) {
          lockPiece()
          return false
        }
        gravityAccumulator = 0
        return true
      }

      function hardDrop() {
        if (!canPlay()) return
        while (!collides(board, current.matrix, current.x, current.y + 1)) current.y += 1
        lockPiece()
      }

      function rotate(direction) {
        if (!canPlay()) return
        const matrix = direction < 0 ? rotateCCW(current.matrix) : rotateCW(current.matrix)
        const kicks = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]]
        for (const [dx, dy] of kicks) {
          if (!collides(board, matrix, current.x + dx, current.y + dy)) {
            current.matrix = matrix
            current.x += dx
            current.y += dy
            return
          }
        }
      }

      function pause() {
        if (!started || over || paused) return
        paused = true
        emit()
      }

      function resume() {
        if (!started || over || !paused) return
        paused = false
        lastTime = now()
        gravityAccumulator = 0
        emit()
      }

      function togglePause() {
        if (paused) resume()
        else pause()
      }

      function draw() {
        if (!context || disposed) return
        const rect = canvas.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return
        const dpr = Math.min(
          typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1,
          3,
        )
        const pixelWidth = Math.max(1, Math.round(rect.width * dpr))
        const pixelHeight = Math.max(1, Math.round(rect.height * dpr))
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth
          canvas.height = pixelHeight
        }
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
        context.clearRect(0, 0, rect.width, rect.height)

        const cell = Math.max(
          1,
          Math.min(
            (rect.width - CELL_GAP * (COLS - 1)) / COLS,
            (rect.height - CELL_GAP * (ROWS - 1)) / ROWS,
          ),
        )
        const boardWidth = cell * COLS + CELL_GAP * (COLS - 1)
        const boardHeight = cell * ROWS + CELL_GAP * (ROWS - 1)
        const originX = (rect.width - boardWidth) / 2
        const originY = (rect.height - boardHeight) / 2

        let emptyColor = '#f0f3f2'
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
          const themed = window.getComputedStyle(canvas).getPropertyValue('--dsh-tetris-empty').trim()
          if (themed) emptyColor = themed
        }
        const dark = typeof document !== 'undefined'
          && document.body
          && document.body.hasAttribute('data-ds-dark-theme')
        const palette = dark ? COLORS_DARK : COLORS

        // Merge the settled board and the active piece into one display grid so
        // a translucent tile is always painted over the page, never over an
        // empty tile underneath it.
        const display = board.map((row) => row.slice())
        if (current && !over) {
          for (let row = 0; row < current.matrix.length; row += 1) {
            for (let col = 0; col < current.matrix.length; col += 1) {
              if (!current.matrix[row][col]) continue
              const y = current.y + row
              if (y < 0) continue
              display[y][current.x + col] = current.type
            }
          }
        }

        const dimmed = paused || over
        const emptyAlpha = dimmed ? 0.55 : 1
        const blockAlpha = dimmed ? BLOCK_ALPHA * 0.45 : BLOCK_ALPHA

        for (let row = 0; row < ROWS; row += 1) {
          for (let col = 0; col < COLS; col += 1) {
            const type = display[row][col]
            const color = type ? palette[type] || type : null
            const x = originX + col * (cell + CELL_GAP)
            const y = originY + row * (cell + CELL_GAP)
            if (color) drawCell(context, x, y, cell, color, blockAlpha)
            else drawCell(context, x, y, cell, emptyColor, emptyAlpha)
          }
        }
      }

      function schedule() {
        if (raf === 0 && !disposed && typeof requestAnimationFrame === 'function') {
          raf = requestAnimationFrame(loop)
        }
      }

      function loop(time) {
        raf = 0
        if (disposed) return
        if (!lastTime) lastTime = time
        const delta = Math.min(100, time - lastTime)
        lastTime = time
        if (!paused && !over && started) {
          gravityAccumulator += delta
          if (gravityAccumulator >= GRAVITY_MS) {
            gravityAccumulator = 0
            if (current) {
              if (!collides(board, current.matrix, current.x, current.y + 1)) current.y += 1
              else lockPiece()
            }
          }
        }
        draw()
        schedule()
      }

      function start() {
        if (disposed) return
        board = emptyBoard()
        current = null
        bag = []
        started = true
        paused = false
        over = false
        lastTime = now()
        gravityAccumulator = 0
        spawnPiece()
        emit()
        draw()
        schedule()
      }

      function destroy() {
        disposed = true
        if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
        raf = 0
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('blur', onWindowBlur)
        }
      }

      function onVisibilityChange() {
        if (typeof document !== 'undefined' && document.hidden) pause()
      }

      function onWindowBlur() {
        pause()
      }

      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVisibilityChange)
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('blur', onWindowBlur)
      }

      return {
        start,
        restart: start,
        destroy,
        pause,
        resume,
        togglePause,
        moveLeft: () => moveBy(-1, 0),
        moveRight: () => moveBy(1, 0),
        softDrop,
        hardDrop,
        rotateCW: () => rotate(1),
        rotateCCW: () => rotate(-1),
        draw,
        getState: () => ({
          board: board.map((row) => row.slice()),
          current: current
            ? { ...current, matrix: current.matrix.map((row) => row.slice()) }
            : null,
          over,
          paused,
          started,
        }),
      }
    }

    // ---------------------------------------------------------------------
    // Interface
    // ---------------------------------------------------------------------

    const STYLE_TEXT = `
      .dsh-tetris-root,
      .dsh-tetris-root * { box-sizing: border-box; }

      .dsh-tetris-root {
        position: fixed;
        right: max(16px, env(safe-area-inset-right));
        bottom: max(16px, env(safe-area-inset-bottom));
        z-index: 30;
        pointer-events: auto;
        font-family: inherit;
        color: inherit;
      }

      .dsh-tetris-launch {
        appearance: none;
        -webkit-appearance: none;
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        opacity: .9;
        cursor: pointer;
        transition: opacity .12s ease;
      }
      .dsh-tetris-launch::before {
        content: "";
        display: block;
        width: 16px;
        height: 16px;
        border-radius: 0;
        background: #605ce5;
      }
      .dsh-tetris-launch:hover { opacity: 1; }
      .dsh-tetris-launch:focus-visible {
        outline: 1px solid #605ce5;
        outline-offset: 3px;
      }

      .dsh-tetris-panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: fit-content;
        max-width: calc(100vw - 24px);
        max-height: calc(100dvh - 24px);
        padding: 8px;
        border: 0;
        border-radius: 0;
        background: var(--dsw-alias-bg-base, #fff);
        box-shadow: none;
        outline: none;
        color: inherit;
      }
      body[data-ds-dark-theme] .dsh-tetris-panel {
        background: var(--dsw-alias-bg-base, #151517);
      }

      .dsh-tetris-stage {
        position: relative;
        display: flex;
        justify-content: center;
        width: min(147px, calc(100vw - 48px), calc((100dvh - 96px) / 2.02));
        max-width: 100%;
        overflow: hidden;
        background: transparent;
      }
      .dsh-tetris-canvas {
        display: block;
        width: 100%;
        height: auto;
        aspect-ratio: 147 / 297;
        background: transparent;
        --dsh-tetris-empty: #f0f3f2;
        touch-action: none;
      }
      body[data-ds-dark-theme] .dsh-tetris-canvas {
        --dsh-tetris-empty: #1c2e25;
      }

      .dsh-tetris-footer {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 0;
        margin-top: 8px;
        padding: 0;
        background: transparent;
      }
      .dsh-tetris-status {
        margin: 0 0 2px;
        color: inherit;
        font-size: 11px;
        font-weight: 500;
        line-height: 1.4;
        letter-spacing: .12em;
        text-align: center;
        opacity: .8;
      }
      .dsh-tetris-hint {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        margin: 0;
        color: inherit;
        opacity: .62;
        font-size: 12px;
        line-height: 1.45;
        letter-spacing: 0;
        text-align: center;
      }
      .dsh-tetris-hint span { white-space: nowrap; }

      @media (max-width: 560px) {
        .dsh-tetris-root {
          right: max(12px, env(safe-area-inset-right));
          bottom: max(12px, env(safe-area-inset-bottom));
        }
        .dsh-tetris-stage {
          width: min(147px, calc(100vw - 40px), calc((100dvh - 88px) / 2.02));
        }
      }
      @media (max-height: 560px) {
        .dsh-tetris-root { bottom: max(12px, env(safe-area-inset-bottom)); }
        .dsh-tetris-panel { padding: 6px; }
        .dsh-tetris-stage {
          width: min(147px, calc(100vw - 40px), calc((100dvh - 72px) / 2.02));
        }
        .dsh-tetris-footer { margin-top: 6px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-tetris-launch { transition: none; }
      }
    `

    function usePluginStyles() {
      useEffect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-plugin', 'dsh-plugin-tetris')
        style.textContent = STYLE_TEXT
        document.head.appendChild(style)
        return () => style.remove()
      }, [])
    }

    function TetrisDock() {
      usePluginStyles()
      const [open, setOpen] = useState(false)
      const [paused, setPaused] = useState(false)
      const [over, setOver] = useState(false)
      const rootRef = useRef(null)
      const canvasRef = useRef(null)
      const launchRef = useRef(null)
      const gameRef = useRef(null)

      useEffect(() => {
        if (!open) return undefined
        const canvas = canvasRef.current
        if (!canvas) return undefined
        const game = createGame(canvas, {
          onState(state) {
            setPaused(state.paused)
            setOver(state.over)
          },
        })
        gameRef.current = game
        setPaused(false)
        setOver(false)
        game.start()
        const focusFrame = requestAnimationFrame(() => {
          rootRef.current?.focus({ preventScroll: true })
        })
        return () => {
          cancelAnimationFrame(focusFrame)
          game.destroy()
          if (gameRef.current === game) gameRef.current = null
        }
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        function collapse() {
          setOpen(false)
          setPaused(false)
          setOver(false)
          requestAnimationFrame(() => {
            launchRef.current?.focus({ preventScroll: true })
          })
        }
        function onVisibilityChange() {
          if (document.hidden) collapse()
        }
        window.addEventListener('blur', collapse)
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => {
          window.removeEventListener('blur', collapse)
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
      }, [open])

      function openGame() {
        setPaused(false)
        setOver(false)
        setOpen(true)
      }

      function collapseGame(restoreFocus = false) {
        setOpen(false)
        setPaused(false)
        setOver(false)
        if (restoreFocus) {
          requestAnimationFrame(() => {
            launchRef.current?.focus({ preventScroll: true })
          })
        }
      }

      function restartGame() {
        gameRef.current?.restart()
        setPaused(false)
        setOver(false)
        rootRef.current?.focus({ preventScroll: true })
      }

      function togglePause() {
        if (over) return
        gameRef.current?.togglePause()
      }

      function handleBlur(event) {
        if (event.currentTarget.contains(event.relatedTarget)) return
        collapseGame(!event.relatedTarget)
      }

      function handleKeyDown(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const key = event.key

        if (key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          collapseGame(true)
          return
        }

        if (key === 'x' || key === 'X' || key === 'z' || key === 'Z' || key === 'p' || key === 'P') {
          event.preventDefault()
          event.stopPropagation()
          return
        }

        if (over) {
          if (key === 'r' || key === 'R' || key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            restartGame()
          }
          return
        }

        if (paused) {
          if (key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            togglePause()
          } else if (key.startsWith('Arrow')) {
            event.preventDefault()
            event.stopPropagation()
          }
          return
        }

        switch (key) {
          case 'ArrowLeft':
            event.preventDefault()
            event.stopPropagation()
            gameRef.current?.moveLeft()
            break
          case 'ArrowRight':
            event.preventDefault()
            event.stopPropagation()
            gameRef.current?.moveRight()
            break
          case 'ArrowDown':
            event.preventDefault()
            event.stopPropagation()
            gameRef.current?.softDrop()
            break
          case 'ArrowUp':
            event.preventDefault()
            event.stopPropagation()
            gameRef.current?.rotateCW()
            break
          case ' ':
            event.preventDefault()
            event.stopPropagation()
            togglePause()
            break
          default:
            break
        }
      }

      if (!open) {
        return h(
          'div',
          { className: 'dsh-tetris-root' },
          h('button', {
            ref: launchRef,
            type: 'button',
            className: 'dsh-tetris-launch',
            onClick: openGame,
            'aria-label': '打开俄罗斯方块',
            'aria-haspopup': 'dialog',
            'aria-expanded': false,
          }),
        )
      }

      return h(
        'div',
        { className: 'dsh-tetris-root' },
        h(
          'section',
          {
            ref: rootRef,
            className: 'dsh-tetris-panel',
            role: 'dialog',
            'aria-modal': 'false',
            'aria-label': '俄罗斯方块',
            'aria-describedby': 'dsh-tetris-guide',
            tabIndex: 0,
            onKeyDown: handleKeyDown,
            onBlur: handleBlur,
            onMouseDown: (event) => event.preventDefault(),
          },
          h(
            'div',
            { className: 'dsh-tetris-stage' },
            h('canvas', {
              ref: canvasRef,
              className: 'dsh-tetris-canvas',
              width: 147,
              height: 297,
              'aria-hidden': 'true',
            }),
          ),
          h(
            'footer',
            {
              className: 'dsh-tetris-footer',
              id: 'dsh-tetris-guide',
            },
            paused || over
              ? h(
                  'p',
                  {
                    className: 'dsh-tetris-status',
                    role: 'status',
                    'aria-live': 'polite',
                    'aria-atomic': 'true',
                  },
                  over ? '游戏结束' : '已暂停',
                )
              : null,
            h(
              'p',
              {
                className: 'dsh-tetris-hint',
                'aria-label': over
                  ? 'R 重新开始，Esc 收起'
                  : paused
                    ? '空格继续，Esc 收起'
                    : '左、右移动，上旋转，下软降，空格暂停，Esc 收起',
              },
              over
                ? h('span', null, 'R 重新开始　Esc 收起')
                : paused
                  ? h('span', null, '空格 继续　Esc 收起')
                  : [
                      h('span', { key: 'move' }, '←→ 移动　↑ 旋转　↓ 降'),
                      h('span', { key: 'system' }, '空格 暂停　Esc 收起'),
                    ],
            ),
          ),
        ),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-plugin-tetris',
      }, TetrisDock))
    }

    return {
      name: 'dsh-plugin-tetris',
      inject: ['slots'],
      apply,
      // Kept out of the UI surface; the behavior is covered by the package tests.
      __testing: {
        COLS,
        ROWS,
        SHAPES,
        COLORS,
        emptyBoard,
        rotateCW,
        rotateCCW,
        collides,
        clearFullRows,
        createBag,
        createGame,
      },
    }
  },
})
