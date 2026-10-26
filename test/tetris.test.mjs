import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '..')

let plugin

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      const React = {
        createElement() {},
        useEffect() {},
        useRef() {},
        useState() {},
      }
      plugin = definition.factory((id) => {
        if (id === 'react') return React
        throw new Error(`Unexpected module request: ${id}`)
      })
    },
  },
}

await import('../src/client.js')

const {
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
} = plugin.__testing

/** Small deterministic PRNG so the engine test never flakes. */
function mulberry32(seed) {
  let value = seed >>> 0
  return function random() {
    value = (value + 0x6D2B79F5) >>> 0
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

test('package manifest exposes a web client bundle', async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-plugin-tetris')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.exports['./client'], './src/client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('the client plugin registers into the shell overlay slot', () => {
  assert.deepEqual(plugin.inject, ['slots'])
  const registrations = []
  const ctx = {
    slots: {
      inject(name, callback) {
        assert.equal(name, 'shell.overlay')
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
      },
    },
  }
  plugin.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.deepEqual(registrations[0].options, {
    name: 'shell.overlay',
    id: 'dsh-plugin-tetris',
  })
  assert.equal(typeof registrations[0].component, 'function')
})

test('every tetromino is square, four blocks, and has a color', () => {
  for (const [type, matrix] of Object.entries(SHAPES)) {
    assert.ok(Array.isArray(matrix))
    assert.equal(matrix.length, matrix[0].length, `${type} must be square`)
    assert.ok(matrix.every((row) => row.length === matrix.length))
    assert.equal(matrix.flat().filter(Boolean).length, 4, `${type} must have four blocks`)
    assert.match(COLORS[type], /^#[0-9a-f]{6}$/i)
  }
  assert.equal(Object.keys(SHAPES).length, 7)
})

test('rotations are lossless and reversible', () => {
  for (const [type, matrix] of Object.entries(SHAPES)) {
    assert.deepEqual(rotateCW(rotateCCW(matrix)), matrix, `${type} CCW then CW`)
    assert.deepEqual(rotateCCW(rotateCW(matrix)), matrix, `${type} CW then CCW`)
    assert.deepEqual(rotateCW(rotateCW(rotateCW(rotateCW(matrix)))), matrix, `${type} x4`)
  }
})

test('collision handles walls, floor, ceiling, and occupied cells', () => {
  const board = emptyBoard()
  const matrix = SHAPES.O
  assert.equal(collides(board, matrix, 0, 0), false)
  assert.equal(collides(board, matrix, -1, 0), true, 'left wall')
  assert.equal(collides(board, matrix, COLS - 1, 0), true, 'right wall')
  assert.equal(collides(board, matrix, 0, ROWS - 1), true, 'floor')
  assert.equal(collides(board, matrix, 0, -1), false, 'above the ceiling is allowed')
  board[1][1] = '#fff'
  assert.equal(collides(board, matrix, 0, 0), true, 'occupied cell')
})

test('full rows are removed and empty rows are added at the top', () => {
  const board = emptyBoard()
  board[ROWS - 1].fill('#ff7b9c')
  board[ROWS - 2][0] = '#48d7ff'
  board[ROWS - 3].fill('#ffd166')

  const result = clearFullRows(board)
  assert.equal(result.cleared, 2)
  assert.equal(result.board.length, ROWS)
  assert.ok(result.board[0].every((cell) => cell === null))
  assert.ok(result.board[1].every((cell) => cell === null))
  assert.equal(result.board[ROWS - 1][0], '#48d7ff')
  assert.equal(result.board[ROWS - 1][1], null)

  const untouched = clearFullRows(emptyBoard())
  assert.equal(untouched.cleared, 0)
})

test('seven-bag produces each tetromino exactly once', () => {
  for (let seed = 0; seed < 30; seed += 1) {
    const bag = createBag(mulberry32(seed))
    assert.equal(bag.length, 7)
    assert.equal(new Set(bag).size, 7)
  }
})

test('engine starts empty, drops, moves, pauses, and eventually ends', () => {
  const game = createGame(null, { random: mulberry32(7) })
  game.start()

  const started = game.getState()
  assert.equal(started.started, true)
  assert.equal(started.paused, false)
  assert.equal(started.over, false)
  assert.ok(started.current)
  assert.equal(started.board.flat().filter(Boolean).length, 0)

  const spawnX = started.current.x
  const spawnY = started.current.y
  game.moveLeft()
  assert.equal(game.getState().current.x, spawnX - 1)
  game.moveRight()
  assert.equal(game.getState().current.x, spawnX)
  game.softDrop()
  assert.equal(game.getState().current.y, spawnY + 1)

  game.pause()
  assert.equal(game.getState().paused, true)
  game.hardDrop()
  assert.equal(game.getState().board.flat().filter(Boolean).length, 0, 'paused game ignores input')
  game.resume()
  assert.equal(game.getState().paused, false)

  game.hardDrop()
  const dropped = game.getState()
  assert.ok(dropped.board.flat().filter(Boolean).length >= 4)
  assert.notEqual(dropped.current, null)

  let drops = 0
  while (!game.getState().over && drops < 200) {
    game.hardDrop()
    drops += 1
  }
  assert.equal(game.getState().over, true, 'stack eventually reaches the spawn area')
  assert.ok(drops < 200)

  game.destroy()
})

test('restart clears the board and makes the game playable again', () => {
  const game = createGame(null, { random: mulberry32(42) })
  game.start()
  for (let index = 0; index < 12; index += 1) game.hardDrop()
  assert.ok(game.getState().board.flat().some(Boolean))

  game.restart()
  const restarted = game.getState()
  assert.equal(restarted.over, false)
  assert.equal(restarted.paused, false)
  assert.equal(restarted.board.flat().filter(Boolean).length, 0)
  assert.ok(restarted.current)
  game.destroy()
})
