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

    const COLORS = Object.freeze({
      I: '#7dd3fc',
      J: '#8b9cf7',
      L: '#f6b26b',
      O: '#f4d35e',
      S: '#7fbf9b',
      T: '#b794f6',
      Z: '#f28bb6',
    })

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

    function drawBlock(context, x, y, size, color) {
      const gap = Math.max(1, Math.round(size * 0.08))
      const left = Math.round(x + gap / 2)
      const top = Math.round(y + gap / 2)
      const side = Math.max(1, Math.round(size - gap))

      context.fillStyle = color
      context.fillRect(left, top, side, side)
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
          color: COLORS[type],
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
            if (boardY >= 0 && boardY < ROWS) board[boardY][current.x + col] = current.color
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

        const cell = Math.min(rect.width / COLS, rect.height / ROWS)
        const boardWidth = cell * COLS
        const boardHeight = cell * ROWS
        const originX = (rect.width - boardWidth) / 2
        const originY = (rect.height - boardHeight) / 2

        context.save()
        context.strokeStyle = 'rgba(148, 163, 184, .28)'
        context.lineWidth = 1
        for (let col = 0; col <= COLS; col += 1) {
          const x = Math.round(originX + col * cell) + 0.5
          context.beginPath()
          context.moveTo(x, originY)
          context.lineTo(x, originY + boardHeight)
          context.stroke()
        }
        for (let row = 0; row <= ROWS; row += 1) {
          const y = Math.round(originY + row * cell) + 0.5
          context.beginPath()
          context.moveTo(originX, y)
          context.lineTo(originX + boardWidth, y)
          context.stroke()
        }
        context.restore()

        for (let row = 0; row < ROWS; row += 1) {
          for (let col = 0; col < COLS; col += 1) {
            const color = board[row][col]
            if (!color) continue
            drawBlock(context, originX + col * cell, originY + row * cell, cell, color)
          }
        }

        if (current && !over) {
          for (let row = 0; row < current.matrix.length; row += 1) {
            for (let col = 0; col < current.matrix.length; col += 1) {
              if (!current.matrix[row][col]) continue
              const y = current.y + row
              if (y < 0) continue
              drawBlock(
                context,
                originX + (current.x + col) * cell,
                originY + y * cell,
                cell,
                current.color,
              )
            }
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
        opacity: .78;
        cursor: pointer;
        transition: opacity .12s ease;
      }
      .dsh-tetris-launch::before {
        content: "";
        display: block;
        width: 16px;
        height: 16px;
        border-radius: 0;
        background: #b794f6;
      }
      .dsh-tetris-launch:hover { opacity: 1; }
      .dsh-tetris-launch:focus-visible {
        outline: 1px solid #b794f6;
        outline-offset: 3px;
      }

      .dsh-tetris-panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: min(300px, calc(100vw - 24px));
        max-height: calc(100dvh - 32px);
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        outline: none;
        color: inherit;
      }

      .dsh-tetris-stage {
        display: flex;
        justify-content: center;
        width: 100%;
        overflow: visible;
        background: transparent;
        border-radius: 0;
        box-shadow: none;
      }
      .dsh-tetris-canvas {
        display: block;
        width: auto;
        height: min(56dvh, 560px);
        aspect-ratio: 1 / 2;
        max-width: 100%;
        background: transparent;
        touch-action: none;
      }

      .dsh-tetris-footer {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        width: 100%;
        padding: 5px 2px 0;
        background: transparent;
      }
      .dsh-tetris-status {
        min-height: 13px;
        margin: 0;
        color: #8b5cf6;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 9.5px;
        font-weight: 600;
        line-height: 13px;
        letter-spacing: .12em;
        text-align: center;
        white-space: nowrap;
      }
      .dsh-tetris-status[data-over="true"] { color: #e0447f; }
      .dsh-tetris-hint {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 2px 9px;
        margin: 0;
        color: inherit;
        opacity: .68;
        font-size: 10px;
        line-height: 1.55;
        letter-spacing: .02em;
        text-align: center;
      }
      .dsh-tetris-hint span { white-space: nowrap; }

      @media (max-width: 560px) {
        .dsh-tetris-root {
          right: max(12px, env(safe-area-inset-right));
          bottom: max(12px, env(safe-area-inset-bottom));
        }
        .dsh-tetris-panel { width: min(300px, calc(100vw - 20px)); }
        .dsh-tetris-canvas { height: min(52dvh, 540px); }
        .dsh-tetris-hint { gap: 2px 7px; font-size: 9.5px; }
      }
      @media (max-height: 560px) {
        .dsh-tetris-canvas { height: min(50dvh, 340px); }
        .dsh-tetris-hint { font-size: 8.5px; }
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

        if (key === 'p' || key === 'P') {
          event.preventDefault()
          event.stopPropagation()
          togglePause()
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
          if (
            key.startsWith('Arrow') ||
            key === ' ' ||
            key === 'x' || key === 'X' ||
            key === 'z' || key === 'Z'
          ) {
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
          case 'x':
          case 'X':
            event.preventDefault()
            event.stopPropagation()
            gameRef.current?.rotateCW()
            break
          case 'z':
          case 'Z':
            event.preventDefault()
            event.stopPropagation()
            gameRef.current?.rotateCCW()
            break
          case ' ':
            event.preventDefault()
            event.stopPropagation()
            gameRef.current?.hardDrop()
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
            'aria-describedby': 'dsh-tetris-hint',
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
              width: 300,
              height: 600,
              'aria-hidden': 'true',
            }),
          ),
          h(
            'footer',
            { className: 'dsh-tetris-footer' },
            h(
              'p',
              {
                className: 'dsh-tetris-status',
                'data-over': over ? 'true' : 'false',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': 'true',
              },
              over ? 'GAME OVER · R 重开' : paused ? 'PAUSED · P 继续' : '',
            ),
            h(
              'p',
              {
                className: 'dsh-tetris-hint',
                id: 'dsh-tetris-hint',
                'aria-label': '左、右移动，上或 X 旋转，Z 逆转，下软降，空格硬降，P 暂停，Esc 收起',
              },
              h('span', null, '← → 移动'),
              h('span', null, '↑ / X 旋转'),
              h('span', null, 'Z 逆转'),
              h('span', null, '↓ 软降'),
              h('span', null, '空格 硬降'),
              h('span', null, 'P 暂停'),
              h('span', null, 'Esc 收起'),
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
