/**
 * Host half of dsh-plugin-tetris.
 *
 * The game is entirely browser-side: this tiny entry only exists so the
 * package can be inserted as a regular Cordis plugin. Its `dsh.client`
 * declaration is what makes the Web client load `./client`.
 */
export const name = 'dsh-plugin-tetris'

export function apply() {
  // No host services, tools, or routes. The client bundle owns the game.
}
