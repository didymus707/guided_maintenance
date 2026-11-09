// B2BMaintenanceGeometry.ts
// Owns: code-authored MeshBuilder geometry (boxes, wireframe boxes, arrow) and
//       the glowing-material helper used by every 3D stand-in in this Lens
//       (rack, chassis, PSUs, LEDs, power button, scan line, fault box, ghost).
// Expects: Assets/Materials/B2BGlow.mat (Unlit preset) — created by the bootstrap.
// Must not: build UI (UI lives in *UI.ts modules) or hold flow state.
//
// Why code-authored: the brief asks for glowing white wireframe stand-ins with
// exact slot geometry and recolorable LEDs; MeshBuilder gives precise sizes in cm
// and per-instance colors (declared in the Phase 0 build plan, Hard Rule 2).

const GLOW_MATERIAL = requireAsset("../Materials/B2BGlow.mat") as Material

const LAYOUT = [
  {name: "position", components: 3},
  {name: "normal", components: 3, normalized: true}
]

type V3 = [number, number, number]

function newBuilder(): MeshBuilder {
  const b = new MeshBuilder(LAYOUT)
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  return b
}

/** Verified CCW box (from mesh-builder-scripting/primitives.md), position+normal layout. */
function addBox(
  builder: MeshBuilder,
  indices: number[],
  cx: number, cy: number, cz: number,
  hw: number, hh: number, hd: number,
  baseIdx: number
): number {
  const x0 = cx - hw, x1 = cx + hw
  const y0 = cy - hh, y1 = cy + hh
  const z0 = cz - hd, z1 = cz + hd
  const verts: number[] = []
  let vi = baseIdx
  const face = (p0: V3, p1: V3, p2: V3, p3: V3, n: V3) => {
    verts.push(...p0, ...n, ...p1, ...n, ...p2, ...n, ...p3, ...n)
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3)
    vi += 4
  }
  face([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0])
  face([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0])
  face([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0])
  face([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0])
  face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1])
  face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1])
  builder.appendVerticesInterleaved(verts)
  return vi
}

/** Triangle whose winding is auto-corrected to face away from `inside`. */
function addTri(builder: MeshBuilder, indices: number[], a: vec3, b: vec3, c: vec3, inside: vec3, baseIdx: number): number {
  let n = b.sub(a).cross(c.sub(a)).normalize()
  const centroid = a.add(b).add(c).uniformScale(1 / 3)
  let p1 = b
  let p2 = c
  if (n.dot(centroid.sub(inside)) < 0) {
    p1 = c
    p2 = b
    n = n.uniformScale(-1)
  }
  builder.appendVerticesInterleaved([
    a.x, a.y, a.z, n.x, n.y, n.z,
    p1.x, p1.y, p1.z, n.x, n.y, n.z,
    p2.x, p2.y, p2.z, n.x, n.y, n.z
  ])
  indices.push(baseIdx, baseIdx + 1, baseIdx + 2)
  return baseIdx + 3
}

function finish(builder: MeshBuilder, indices: number[]): RenderMesh {
  builder.appendIndices(indices)
  builder.updateMesh()
  return builder.getMesh()
}

export class B2BGeometry {
  /** Solid box w×h×d (cm) centered at `center`. */
  static box(w: number, h: number, d: number, center: vec3 = vec3.zero()): RenderMesh {
    const b = newBuilder()
    const idx: number[] = []
    addBox(b, idx, center.x, center.y, center.z, w / 2, h / 2, d / 2, 0)
    return finish(b, idx)
  }

  /** Wireframe box: the 12 edges of a w×h×d box as thin bars of `t` cm. */
  static wireBox(w: number, h: number, d: number, t: number, center: vec3 = vec3.zero()): RenderMesh {
    const b = newBuilder()
    const idx: number[] = []
    let vi = 0
    const hx = w / 2, hy = h / 2, hz = d / 2, ht = t / 2
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        vi = addBox(b, idx, center.x, center.y + sy * hy, center.z + sz * hz, hx + ht, ht, ht, vi)
      }
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        vi = addBox(b, idx, center.x + sx * hx, center.y, center.z + sz * hz, ht, hy + ht, ht, vi)
      }
    }
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        vi = addBox(b, idx, center.x + sx * hx, center.y + sy * hy, center.z, ht, ht, hz + ht, vi)
      }
    }
    return finish(b, idx)
  }

  /** Flat rectangular outline (4 bars) in the XY plane, w×h, bar thickness t. */
  static wireRect(w: number, h: number, t: number, center: vec3 = vec3.zero()): RenderMesh {
    const b = newBuilder()
    const idx: number[] = []
    let vi = 0
    const hx = w / 2, hy = h / 2, ht = t / 2
    vi = addBox(b, idx, center.x, center.y + hy, center.z, hx + ht, ht, ht, vi)
    vi = addBox(b, idx, center.x, center.y - hy, center.z, hx + ht, ht, ht, vi)
    vi = addBox(b, idx, center.x + hx, center.y, center.z, ht, hy + ht, ht, vi)
    vi = addBox(b, idx, center.x - hx, center.y, center.z, ht, hy + ht, ht, vi)
    return finish(b, idx)
  }

  /** Rectangular outline lying on the floor (XZ plane), w×d, bar thickness t. */
  static floorRect(w: number, d: number, t: number, center: vec3 = vec3.zero()): RenderMesh {
    const b = newBuilder()
    const idx: number[] = []
    let vi = 0
    const hx = w / 2, hz = d / 2, ht = t / 2
    vi = addBox(b, idx, center.x, center.y, center.z + hz, hx + ht, ht, ht, vi)
    vi = addBox(b, idx, center.x, center.y, center.z - hz, hx + ht, ht, ht, vi)
    vi = addBox(b, idx, center.x + hx, center.y, center.z, ht, ht, hz + ht, vi)
    vi = addBox(b, idx, center.x - hx, center.y, center.z, ht, ht, hz + ht, vi)
    return finish(b, idx)
  }

  /** Downward-pointing arrow (tip at the origin, shaft rising along +Y). */
  static downArrow(totalLength: number, shaftWidth: number, headWidth: number, headLength: number): RenderMesh {
    const b = newBuilder()
    const idx: number[] = []
    const shaftLen = totalLength - headLength
    let vi = addBox(b, idx, 0, headLength + shaftLen / 2, 0, shaftWidth / 2, shaftLen / 2, shaftWidth / 2, 0)
    const hw = headWidth / 2
    const apex = new vec3(0, 0, 0)
    const c0 = new vec3(-hw, headLength, -hw)
    const c1 = new vec3(hw, headLength, -hw)
    const c2 = new vec3(hw, headLength, hw)
    const c3 = new vec3(-hw, headLength, hw)
    const inside = new vec3(0, headLength * 0.4, 0)
    vi = addTri(b, idx, c0, c1, apex, inside, vi)
    vi = addTri(b, idx, c1, c2, apex, inside, vi)
    vi = addTri(b, idx, c2, c3, apex, inside, vi)
    vi = addTri(b, idx, c3, c0, apex, inside, vi)
    vi = addTri(b, idx, c0, c2, c1, inside, vi)
    vi = addTri(b, idx, c0, c3, c2, inside, vi)
    return finish(b, idx)
  }

  /** Clone of the glow material with a color; translucent colors blend normally. */
  static glowMaterial(color: vec4): Material {
    const m = GLOW_MATERIAL.clone()
    m.mainPass.baseColor = color
    m.mainPass.blendMode = BlendMode.Normal
    m.mainPass.depthWrite = color.w >= 0.99
    m.mainPass.twoSided = false
    return m
  }

  /** Creates a child SceneObject with a RenderMeshVisual. */
  static meshObject(parent: SceneObject, name: string, mesh: RenderMesh, material: Material, localPos?: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (localPos) so.getTransform().setLocalPosition(localPos)
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = mesh
    rmv.mainMaterial = material
    return so
  }
}

/**
 * Tracks a set of glow materials with their base colors so a whole assembly can
 * be faded (opacity multiplier) or recolored as one unit.
 */
export class GlowPalette {
  private entries: {mat: Material; base: vec4}[] = []
  private opacity = 1

  make(color: vec4): Material {
    const m = B2BGeometry.glowMaterial(color)
    this.entries.push({mat: m, base: color})
    this.apply(this.entries[this.entries.length - 1])
    return m
  }

  setColor(mat: Material, color: vec4): void {
    for (const e of this.entries) {
      if (e.mat === mat) {
        e.base = color
        this.apply(e)
      }
    }
  }

  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity))
    for (const e of this.entries) this.apply(e)
  }

  getOpacity(): number {
    return this.opacity
  }

  private apply(e: {mat: Material; base: vec4}): void {
    const a = e.base.w * this.opacity
    e.mat.mainPass.baseColor = new vec4(e.base.x, e.base.y, e.base.z, a)
    e.mat.mainPass.depthWrite = a >= 0.99
  }
}
