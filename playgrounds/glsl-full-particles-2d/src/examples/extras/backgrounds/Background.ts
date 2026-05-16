import type { Object3D } from 'three'

/**
 * A scene-graph background: owns its mesh, advances its own internal state
 * each frame, and cleans up on dispose. The mesh is added to the scene by
 * the caller (`scene.add(background.mesh)`); rendering happens via the
 * regular `renderer.render(scene, camera)` along with everything else.
 *
 * Both `update` arguments are passed every frame; concrete backgrounds use
 * whichever they need — procedural `Backdrop` reads `elapsed` for animated
 * uniforms, `Slideshow` reads `dt` for fade/cycle timing.
 */
export interface Background {
  /** The renderable. Add to the scene via `scene.add(background.mesh)`. */
  mesh: Object3D
  /** Optional opacity hook used by the background switcher for cross-fades. */
  setOpacity?(opacity: number): void
  /**
   * Per-frame state advance.
   * @param dt      Delta seconds since previous call.
   * @param elapsed Total seconds since start.
   */
  update(dt: number, elapsed: number): void
  /** Free GPU resources (geometry + material + any owned textures). */
  dispose(): void
}
