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
      I: '#48d7ff',
      J: '#6d8dff',
      L: '#ffb454',
      O: '#ffd166',
      S: '#5ee08a',
      T: '#b98cff',
      Z: '#ff7b9c',
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

    function pathRoundRect(context, x, y, width, height, radius) {
      const r = Math.min(radius, width / 2, height / 2)
      context.beginPath()
      if (typeof context.roundRect === 'function') {
        context.roundRect(x, y, width, height, r)
        return
      }
      context.moveTo(x + r, y)
      context.arcTo(x + width, y, x + width, y + height, r)
      context.arcTo(x + width, y + height, x, y + height, r)
      context.arcTo(x, y + height, x, y, r)
      context.arcTo(x, y, x + width, y, r)
      context.closePath()
    }

    function drawBlock(context, x, y, size, color, ghost) {
      const inset = Math.max(1, size * 0.055)
      const left = x + inset
      const top = y + inset
      const side = size - inset * 2
      const radius = Math.max(1.5, size * 0.13)

      if (ghost) {
        context.save()
        context.globalAlpha = 0.38
        context.strokeStyle = color
        context.lineWidth = Math.max(1, size * 0.055)
        pathRoundRect(context, left, top, side, side, radius)
        context.stroke()
        context.restore()
        return
      }

      pathRoundRect(context, left, top, side, side, radius)
      context.fillStyle = color
      context.fill()

      // A restrained two-tone bevel keeps the canvas readable at small sizes.
      context.save()
      pathRoundRect(context, left, top, side, side, radius)
      context.clip()
      context.fillStyle = 'rgba(255, 255, 255, .26)'
      context.fillRect(left, top, side, Math.max(1, side * 0.12))
      context.fillStyle = 'rgba(0, 0, 0, .18)'
      context.fillRect(left, top + side * 0.78, side, side * 0.22)
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

        context.fillStyle = '#070a10'
        context.fillRect(originX, originY, boardWidth, boardHeight)

        context.save()
        context.strokeStyle = 'rgba(255, 255, 255, .045)'
        context.lineWidth = 1
        for (let col = 0; col <= COLS; col += 1) {
          const x = originX + col * cell + 0.5
          context.beginPath()
          context.moveTo(x, originY)
          context.lineTo(x, originY + boardHeight)
          context.stroke()
        }
        for (let row = 0; row <= ROWS; row += 1) {
          const y = originY + row * cell + 0.5
          context.beginPath()
          context.moveTo(originX, y)
          context.lineTo(originX + boardWidth, y)
          context.stroke()
        }
        context.restore()

        if (current && !over) {
          let ghostY = current.y
          while (!collides(board, current.matrix, current.x, ghostY + 1)) ghostY += 1
          if (ghostY > current.y) {
            for (let row = 0; row < current.matrix.length; row += 1) {
              for (let col = 0; col < current.matrix.length; col += 1) {
                if (!current.matrix[row][col]) continue
                const y = ghostY + row
                if (y < 0) continue
                drawBlock(
                  context,
                  originX + (current.x + col) * cell,
                  originY + y * cell,
                  cell,
                  current.color,
                  true,
                )
              }
            }
          }
        }

        for (let row = 0; row < ROWS; row += 1) {
          for (let col = 0; col < COLS; col += 1) {
            const color = board[row][col]
            if (!color) continue
            drawBlock(context, originX + col * cell, originY + row * cell, cell, color, false)
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
                false,
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
        right: max(20px, env(safe-area-inset-right));
        bottom: max(20px, env(safe-area-inset-bottom));
        z-index: 30;
        pointer-events: auto;
        color-scheme: dark;
        font-family: inherit;
      }

      .dsh-tetris-launch {
        appearance: none;
        -webkit-appearance: none;
        display: flex;
        align-items: center;
        gap: 10px;
        height: 48px;
        padding: 0 15px 0 11px;
        border: 1px solid rgba(255, 255, 255, .16);
        border-radius: 14px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, .07), rgba(255, 255, 255, 0) 46%),
          #141824;
        color: #f5f7ff;
        box-shadow:
          0 16px 40px rgba(0, 0, 0, .34),
          0 1px 0 rgba(255, 255, 255, .13) inset;
        font: inherit;
        cursor: pointer;
        user-select: none;
        transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
      }
      .dsh-tetris-launch:hover {
        transform: translateY(-2px);
        border-color: rgba(121, 219, 255, .52);
        box-shadow:
          0 20px 48px rgba(0, 0, 0, .42),
          0 0 0 1px rgba(72, 215, 255, .08) inset,
          0 1px 0 rgba(255, 255, 255, .15) inset;
      }
      .dsh-tetris-launch:active { transform: translateY(0) scale(.985); }
      .dsh-tetris-launch:focus-visible {
        outline: 2px solid #71e2ff;
        outline-offset: 3px;
      }

      .dsh-tetris-mark {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(2, 1fr);
        gap: 2px;
        width: 26px;
        height: 26px;
        padding: 2px;
        flex: none;
        border-radius: 7px;
        background: rgba(255, 255, 255, .055);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, .06) inset;
      }
      .dsh-tetris-mark i {
        display: block;
        border-radius: 2px;
        box-shadow: 0 1px 0 rgba(255, 255, 255, .26) inset;
      }
      .dsh-tetris-mark i:nth-child(1) { grid-area: 1 / 2; background: #48d7ff; }
      .dsh-tetris-mark i:nth-child(2) { grid-area: 2 / 1; background: #ffd166; }
      .dsh-tetris-mark i:nth-child(3) { grid-area: 2 / 2; background: #b98cff; }
      .dsh-tetris-mark i:nth-child(4) { grid-area: 2 / 3; background: #ff7b9c; }

      .dsh-tetris-label {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 3px;
        line-height: 1;
        white-space: nowrap;
      }
      .dsh-tetris-label strong {
        font-size: 13px;
        font-weight: 650;
        letter-spacing: .015em;
      }
      .dsh-tetris-label small {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 8px;
        line-height: 1;
        letter-spacing: .18em;
        color: #8d96ad;
      }

      .dsh-tetris-panel {
        position: relative;
        display: flex;
        flex-direction: column;
        width: min(332px, calc(100vw - 24px));
        max-height: calc(100dvh - 40px);
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .13);
        border-radius: 20px;
        background:
          radial-gradient(90% 70% at 100% 0%, rgba(100, 83, 255, .17), transparent 54%),
          radial-gradient(70% 54% at 0% 100%, rgba(44, 186, 255, .08), transparent 62%),
          #0c0f16;
        box-shadow:
          0 34px 90px rgba(0, 0, 0, .54),
          0 0 0 1px rgba(0, 0, 0, .25),
          0 1px 0 rgba(255, 255, 255, .06) inset;
        animation: dsh-tetris-pop .2s cubic-bezier(.2, .85, .3, 1.08);
        outline: none;
      }
      .dsh-tetris-panel::before {
        content: "";
        position: absolute;
        z-index: 2;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, #48d7ff, #8f7bff 34%, #ffd166 68%, #ff7b9c);
        opacity: .92;
        pointer-events: none;
      }
      .dsh-tetris-panel:focus-visible {
        outline: 2px solid rgba(113, 226, 255, .65);
        outline-offset: 3px;
      }

      .dsh-tetris-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 16px 13px 10px;
      }
      .dsh-tetris-brand {
        display: flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
      }
      .dsh-tetris-brand .dsh-tetris-mark {
        width: 22px;
        height: 22px;
        border-radius: 6px;
      }
      .dsh-tetris-brand .dsh-tetris-title {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        line-height: 1;
      }
      .dsh-tetris-title strong {
        color: #f5f7ff;
        font-size: 13px;
        font-weight: 650;
        letter-spacing: .03em;
      }
      .dsh-tetris-title span {
        color: #7d8599;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 8px;
        letter-spacing: .16em;
      }

      .dsh-tetris-actions { display: flex; align-items: center; gap: 3px; }
      .dsh-tetris-icon-button {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: #9aa4b9;
        cursor: pointer;
        transition: background .14s ease, color .14s ease;
      }
      .dsh-tetris-icon-button:hover:not(:disabled) {
        background: rgba(255, 255, 255, .075);
        color: #f5f7ff;
      }
      .dsh-tetris-icon-button:focus-visible {
        outline: 2px solid #71e2ff;
        outline-offset: 1px;
      }
      .dsh-tetris-icon-button:disabled { opacity: .35; cursor: default; }

      .dsh-tetris-board-wrap {
        display: flex;
        justify-content: center;
        padding: 3px 14px 8px;
        background: radial-gradient(70% 64% at 50% 45%, rgba(80, 107, 255, .1), transparent 72%);
      }
      .dsh-tetris-stage {
        position: relative;
        display: flex;
        max-width: 100%;
        overflow: hidden;
        border-radius: 9px;
        background: #070a10;
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, .085),
          0 18px 42px rgba(0, 0, 0, .38);
      }
      .dsh-tetris-canvas {
        display: block;
        width: auto;
        height: min(52dvh, 480px);
        aspect-ratio: 1 / 2;
        max-width: 100%;
        touch-action: none;
      }

      .dsh-tetris-state {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 16px;
        text-align: center;
        background: rgba(5, 7, 11, .76);
        -webkit-backdrop-filter: blur(3px);
        backdrop-filter: blur(3px);
      }
      .dsh-tetris-state .dsh-tetris-eyebrow {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: .2em;
        color: #71e2ff;
      }
      .dsh-tetris-state[data-over="true"] .dsh-tetris-eyebrow { color: #ff91a7; }
      .dsh-tetris-state strong {
        color: #f6f8ff;
        font-size: 18px;
        font-weight: 650;
        letter-spacing: .02em;
      }
      .dsh-tetris-state p {
        margin: 0;
        color: #929bb0;
        font-size: 10.5px;
        line-height: 1.55;
      }
      .dsh-tetris-state button {
        appearance: none;
        height: 30px;
        margin-top: 3px;
        padding: 0 13px;
        border: none;
        border-radius: 8px;
        background: #eef3ff;
        color: #111522;
        font: inherit;
        font-size: 11px;
        font-weight: 650;
        cursor: pointer;
        transition: transform .14s ease, background .14s ease;
      }
      .dsh-tetris-state button:hover { background: #fff; transform: translateY(-1px); }
      .dsh-tetris-state button:active { transform: translateY(0) scale(.98); }
      .dsh-tetris-state button:focus-visible {
        outline: 2px solid #71e2ff;
        outline-offset: 2px;
      }

      .dsh-tetris-footer {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0 14px 12px;
      }
      .dsh-tetris-hint {
        overflow: hidden;
        color: #778095;
        font-size: 9.5px;
        line-height: 1.4;
        letter-spacing: .035em;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-tetris-controls {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
      }
      .dsh-tetris-control {
        appearance: none;
        height: 34px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, .085);
        border-radius: 9px;
        background: rgba(255, 255, 255, .045);
        color: #c9d2e6;
        font: inherit;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
        user-select: none;
        transition: background .12s ease, color .12s ease, transform .12s ease;
      }
      .dsh-tetris-control[data-action="drop"] { color: #71e2ff; }
      .dsh-tetris-control:hover:not(:disabled) {
        background: rgba(255, 255, 255, .09);
        color: #fff;
      }
      .dsh-tetris-control:active:not(:disabled) { transform: scale(.95); }
      .dsh-tetris-control:focus-visible {
        outline: 2px solid #71e2ff;
        outline-offset: 1px;
      }
      .dsh-tetris-control:disabled { opacity: .35; cursor: default; }

      .dsh-tetris-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }

      @keyframes dsh-tetris-pop {
        from { opacity: 0; transform: translateY(9px) scale(.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @media (max-height: 700px) {
        .dsh-tetris-canvas { height: min(46dvh, 420px); }
        .dsh-tetris-hint { display: none; }
        .dsh-tetris-header { padding-top: 13px; padding-bottom: 8px; }
      }
      @media (max-height: 560px) {
        .dsh-tetris-canvas { height: min(44dvh, 330px); }
        .dsh-tetris-footer { gap: 6px; padding-bottom: 8px; }
        .dsh-tetris-control { height: 30px; }
      }
      @media (max-width: 560px) {
        .dsh-tetris-root {
          right: max(12px, env(safe-area-inset-right));
          bottom: max(12px, env(safe-area-inset-bottom));
        }
        .dsh-tetris-panel { max-height: calc(100dvh - 24px); }
        .dsh-tetris-launch { height: 44px; padding-right: 12px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-tetris-panel { animation: none; }
        .dsh-tetris-launch,
        .dsh-tetris-state button,
        .dsh-tetris-control,
        .dsh-tetris-icon-button { transition: none; }
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

    function TetrisMark() {
      return h(
        'span',
        { className: 'dsh-tetris-mark', 'aria-hidden': 'true' },
        h('i'), h('i'), h('i'), h('i'),
      )
    }

    function PauseIcon({ paused }) {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        paused
          ? h('path', { d: 'M8 5.5v13l10-6.5-10-6.5Z', fill: 'currentColor' })
          : h('g', { fill: 'currentColor' },
              h('rect', { x: 7, y: 5, width: 3.5, height: 14, rx: 1 }),
              h('rect', { x: 13.5, y: 5, width: 3.5, height: 14, rx: 1 }),
            ),
      )
    }

    function CloseIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M6 6l12 12M18 6 6 18',
          stroke: 'currentColor',
          strokeWidth: '1.8',
          strokeLinecap: 'round',
        }),
      )
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

      function openGame() {
        setPaused(false)
        setOver(false)
        setOpen(true)
      }

      function closeGame() {
        setOpen(false)
        setPaused(false)
        setOver(false)
        requestAnimationFrame(() => launchRef.current?.focus({ preventScroll: true }))
      }

      function restartGame() {
        gameRef.current?.restart()
        setPaused(false)
        setOver(false)
        rootRef.current?.focus({ preventScroll: true })
      }

      function resumeGame() {
        gameRef.current?.resume()
        rootRef.current?.focus({ preventScroll: true })
      }

      function togglePause() {
        if (over) return
        gameRef.current?.togglePause()
      }

      function handleBlur(event) {
        if (!open || over) return
        if (event.currentTarget.contains(event.relatedTarget)) return
        gameRef.current?.pause()
      }

      function handleKeyDown(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const target = event.target
        const onButton = target instanceof HTMLElement && target.closest('button') !== null
        const key = event.key

        if (key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeGame()
          return
        }

        // Let Space/Enter activate a focused control instead of dropping a piece.
        if (onButton && (key === ' ' || key === 'Enter')) return

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

        if (paused) return

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
          h(
            'button',
            {
              ref: launchRef,
              type: 'button',
              className: 'dsh-tetris-launch',
              onClick: openGame,
              'aria-haspopup': 'dialog',
              'aria-expanded': false,
              title: '打开俄罗斯方块',
            },
            h(TetrisMark),
            h(
              'span',
              { className: 'dsh-tetris-label' },
              h('strong', null, '俄罗斯方块'),
              h('small', null, 'START GAME'),
            ),
          ),
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
            'aria-labelledby': 'dsh-tetris-title',
            'aria-describedby': 'dsh-tetris-hint',
            tabIndex: 0,
            onKeyDown: handleKeyDown,
            onBlur: handleBlur,
          },
          h(
            'header',
            { className: 'dsh-tetris-header' },
            h(
              'div',
              { className: 'dsh-tetris-brand' },
              h(TetrisMark),
              h(
                'div',
                { className: 'dsh-tetris-title' },
                h('strong', { id: 'dsh-tetris-title' }, '俄罗斯方块'),
                h('span', null, 'TETRIS · NO SCORE'),
              ),
            ),
            h(
              'div',
              { className: 'dsh-tetris-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-tetris-icon-button',
                  onClick: togglePause,
                  disabled: over,
                  'aria-label': paused ? '继续游戏' : '暂停游戏',
                  'aria-pressed': paused,
                  title: paused ? '继续 (P)' : '暂停 (P)',
                },
                h(PauseIcon, { paused }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-tetris-icon-button',
                  onClick: closeGame,
                  'aria-label': '关闭俄罗斯方块',
                  title: '关闭 (Esc)',
                },
                h(CloseIcon),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsh-tetris-board-wrap' },
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
              over
                ? h(
                    'div',
                    { className: 'dsh-tetris-state', 'data-over': 'true', role: 'status' },
                    h('span', { className: 'dsh-tetris-eyebrow' }, 'GAME OVER'),
                    h('strong', null, '方块堆满了'),
                    h('p', null, '再来一局，继续消磨等待的时间。'),
                    h('button', { type: 'button', onClick: restartGame }, '再来一局'),
                  )
                : paused
                  ? h(
                      'div',
                      { className: 'dsh-tetris-state', 'data-over': 'false', role: 'status' },
                      h('span', { className: 'dsh-tetris-eyebrow' }, 'PAUSED'),
                      h('strong', null, '游戏已暂停'),
                      h('p', null, '点击继续，或按 P 恢复。'),
                      h('button', { type: 'button', onClick: resumeGame }, '继续游戏'),
                    )
                  : null,
            ),
          ),
          h(
            'footer',
            { className: 'dsh-tetris-footer' },
            h(
              'div',
              { className: 'dsh-tetris-hint', id: 'dsh-tetris-hint' },
              '← → 移动 · ↑ / X 旋转 · ↓ 软降 · 空格 落下',
            ),
            h(
              'div',
              { className: 'dsh-tetris-controls', 'aria-label': '游戏控制' },
              h('button', {
                type: 'button',
                className: 'dsh-tetris-control',
                onClick: () => gameRef.current?.moveLeft(),
                disabled: paused || over,
                'aria-label': '向左移动',
                title: '向左移动 (←)',
              }, '←'),
              h('button', {
                type: 'button',
                className: 'dsh-tetris-control',
                onClick: () => gameRef.current?.rotateCW(),
                disabled: paused || over,
                'aria-label': '顺时针旋转',
                title: '顺时针旋转 (↑ / X)',
              }, '↻'),
              h('button', {
                type: 'button',
                className: 'dsh-tetris-control',
                onClick: () => gameRef.current?.moveRight(),
                disabled: paused || over,
                'aria-label': '向右移动',
                title: '向右移动 (→)',
              }, '→'),
              h('button', {
                type: 'button',
                className: 'dsh-tetris-control',
                onClick: () => gameRef.current?.softDrop(),
                disabled: paused || over,
                'aria-label': '向下软降',
                title: '向下软降 (↓)',
              }, '↓'),
              h('button', {
                type: 'button',
                className: 'dsh-tetris-control',
                'data-action': 'drop',
                onClick: () => gameRef.current?.hardDrop(),
                disabled: paused || over,
                'aria-label': '直接落下',
                title: '直接落下 (空格)',
              }, '⇣'),
            ),
            h(
              'div',
              { className: 'dsh-tetris-sr-only', 'aria-live': 'polite' },
              over ? '游戏结束，方块堆满了' : paused ? '游戏已暂停' : '',
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
