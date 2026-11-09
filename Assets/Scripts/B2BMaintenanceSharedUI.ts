// B2BMaintenanceSharedUI.ts
// Owns: the shared UIKit composition kit for every B2BMaintenance*UI panel —
//       the type scale, the brief's styling (NO dark backgrounds: a faint cyan
//       glass fill + glowing white wireframe border, cyan / bright-white text),
//       FlexLayout helpers, UIKit Button + icon helpers, and show/fold animations.
// Used only by the *UI.ts panel modules. Not a component.
// Must not: hold flow state.
//
// Surface choice: UIKit's BackPlate/Frame ship dark gray fills, which the brief
// forbids. Panels therefore use UIKit's RoundedRectangle visual (the same
// primitive BackPlate/Frame render with) configured as a translucent cyan glass
// fill with a white border — a UIKit primitive, not a hand-rolled mesh.

import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {RoundedRectangle, RoundedRectBlendMode} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import animate, {CancelFunction} from "SpectaclesInteractionKit.lspkg/Utils/animate"

const IMAGE_MATERIAL = requireAsset("../Materials/ImageMaterial.mat") as Material

// ── Typography: the single source of truth for text size + weight ────────────
// `Text.size` is the em-square height (em cm = size / 43.886), calibrated for the
// SnapOS system font at the 110 cm focal plane. Pick a role, never a raw number.
const FONT_SIZE_SCALE = 1.0

export type TextRole =
  | "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2"
  | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"

const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1: {size: 105, weight: 700},
  Title2: {size: 93, weight: 700},
  HeadlineXL: {size: 62, weight: 700},
  Headline1: {size: 54, weight: 700},
  Headline2: {size: 48, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 700},
  Callout: {size: 39, weight: 700},
  Body: {size: 39, weight: 600},
  Caption: {size: 38, weight: 600}
}

export function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}

export function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

// ── Palette (light/bright only — the display is additive) ────────────────────
export const UIColors = {
  white: new vec4(1, 1, 1, 1),
  cyan: new vec4(0.5, 1.0, 1.0, 1),
  dim: new vec4(0.85, 0.95, 1.0, 0.85),
  green: new vec4(0.35, 1.0, 0.5, 1),
  yellow: new vec4(1.0, 0.9, 0.25, 1),
  red: new vec4(1.0, 0.45, 0.4, 1),
  glassFill: new vec4(0.4, 0.9, 1.0, 0.18),
  border: new vec4(0.92, 0.98, 1.0, 1.0)
}

// Z lifts (local +Z = toward the viewer).
const CONTENT_Z = 0.6
const LAYOUT_Z = 0.02
const BUTTON_LABEL_Z = 0.08

export type FlexOpts = {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign}

export class PanelKit {
  // ---------------------------------------------------------------- scene objects
  obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (position) so.getTransform().setLocalPosition(position)
    return so
  }

  /** Glass panel surface: faint cyan fill + glowing white wireframe border. */
  glassPanel(parent: SceneObject, w: number, h: number, borderColor: vec4 = UIColors.border, fill: vec4 = UIColors.glassFill): RoundedRectangle {
    const so = this.obj(parent, "GlassPanel")
    const rr = so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    rr.cornerRadius = 1.2
    rr.blendMode = RoundedRectBlendMode.Normal // translucent glass, never an opaque dark card
    rr.gradient = false
    rr.backgroundColor = fill
    rr.border = true
    rr.borderSize = 0.4
    rr.borderColor = borderColor
    rr.size = new vec2(w, h)
    rr.initialize()
    rr.size = new vec2(w, h)
    rr.backgroundColor = fill
    rr.border = true
    rr.borderSize = 0.4
    rr.borderColor = borderColor
    return rr
  }

  /** Content root lifted in front of the glass so text never z-fights it. */
  content(parent: SceneObject): SceneObject {
    return this.obj(parent, "Content", new vec3(0, 0, CONTENT_Z))
  }

  // ---------------------------------------------------------------- flex layout
  column(parent: SceneObject, w: number, h: number, opts?: FlexOpts): SceneObject {
    return this.flex(parent, FlexDirection.Column, w, h, opts)
  }

  row(parent: SceneObject, w: number, h: number, opts?: FlexOpts): SceneObject {
    return this.flex(parent, FlexDirection.Row, w, h, opts)
  }

  private flex(parent: SceneObject, direction: FlexDirection, w: number, h: number, opts?: FlexOpts): SceneObject {
    const container = this.obj(parent, direction === FlexDirection.Row ? "Row" : "Column", new vec3(0, 0, LAYOUT_Z))
    const layout = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    layout.autoDiscoverItemsOnStart = false // items are registered explicitly via addItems()
    const item = container.createComponent(FlexItem.getTypeName()) as FlexItem
    item.overrideWidth = w
    item.overrideHeight = h
    item.flexShrink = 0
    layout.onInitialized.add(() => {
      layout.width = w
      layout.height = h
      layout.direction = direction
      if (direction === FlexDirection.Row) layout.columnGap = opts?.gap ?? 0
      else layout.rowGap = opts?.gap ?? 0
      layout.paddingTop = opts?.padY ?? 0
      layout.paddingBottom = opts?.padY ?? 0
      layout.paddingLeft = opts?.padX ?? 0
      layout.paddingRight = opts?.padX ?? 0
      layout.justifyContent = opts?.justify ?? FlexJustify.Start
      layout.alignItems = opts?.align ?? FlexAlign.Center
    })
    this.register(parent, item)
    return container
  }

  /** A sized flex child; `builder` composes its content. */
  child(parent: SceneObject, name: string, w: number, h: number, builder?: (so: SceneObject) => void): SceneObject {
    const so = this.obj(parent, name, new vec3(0, 0, LAYOUT_Z))
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.overrideWidth = w
    item.overrideHeight = h
    item.flexGrow = 0
    item.flexShrink = 0
    if (builder) builder(so)
    this.register(parent, item)
    return so
  }

  private register(parent: SceneObject, item: FlexItem): void {
    const parentLayout = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentLayout) parentLayout.addItems([item])
  }

  // ---------------------------------------------------------------- content
  /** Text inside a w×h flex cell. Multi-line text wraps and is top-aligned. */
  text(parent: SceneObject, name: string, value: string, role: TextRole, w: number, h: number,
       color: vec4 = UIColors.white, align: HorizontalAlignment = HorizontalAlignment.Left, wrap: boolean = false): Text {
    const cell = this.child(parent, name, w, h)
    const so = this.obj(cell, "Text", new vec3(0, 0, 0.05))
    const t = so.createComponent("Component.Text") as Text
    t.text = value
    t.depthTest = true
    applyTextRole(t, role)
    t.textFill.color = color
    t.horizontalAlignment = align
    t.verticalAlignment = wrap ? VerticalAlignment.Top : VerticalAlignment.Center
    t.horizontalOverflow = wrap ? HorizontalOverflow.Wrap : HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-w / 2, w / 2, -h / 2, h / 2)
    return t
  }

  /** Icon image (cloned ImageMaterial) centered in a size×size flex cell. */
  icon(parent: SceneObject, name: string, texture: Texture, size: number, tint: vec4 = UIColors.white): Image {
    const cell = this.child(parent, name, size, size)
    return this.rawIcon(cell, texture, size, tint, new vec3(0, 0, 0.05))
  }

  rawIcon(parent: SceneObject, texture: Texture, size: number, tint: vec4, pos: vec3): Image {
    const so = this.obj(parent, "Icon", pos)
    const img = so.createComponent("Component.Image") as Image
    const mat = IMAGE_MATERIAL.clone()
    mat.mainPass.baseTex = texture
    mat.mainPass.baseColor = tint
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    so.getTransform().setLocalScale(new vec3(size, size, 1))
    return img
  }

  setIconTint(img: Image, tint: vec4): void {
    img.mainMaterial.mainPass.baseColor = tint
  }

  setIconTexture(img: Image, texture: Texture): void {
    img.mainMaterial.mainPass.baseTex = texture
  }

  /**
   * UIKit Button in a flex cell, with an optional leading icon and a raw label
   * lifted in front of the face. The Button SceneObject is named `name` so tests
   * can find it. Returns the button, its label and its SceneObject.
   */
  button(parent: SceneObject, name: string, label: string, w: number, h: number, iconTex?: Texture,
         labelColor: vec4 = UIColors.white): {button: Button; label: Text; so: SceneObject; icon: Image | null} {
    const so = this.obj(parent, name, new vec3(0, 0, LAYOUT_Z))
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(w, h, 1)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.overrideWidth = w
    item.overrideHeight = h
    item.flexShrink = 0
    let icon: Image | null = null
    const iconSize = h * 0.62
    let labelLeft = -w / 2 + 0.6
    if (iconTex) {
      icon = this.rawIcon(so, iconTex, iconSize, labelColor, new vec3(-w / 2 + 0.9 + iconSize / 2, 0, BUTTON_LABEL_Z))
      labelLeft = -w / 2 + 1.4 + iconSize
    }
    const labelSo = this.obj(so, "ButtonLabel", new vec3(0, 0, BUTTON_LABEL_Z))
    const t = labelSo.createComponent("Component.Text") as Text
    t.text = label
    t.depthTest = true
    applyTextRole(t, "Button")
    t.textFill.color = labelColor
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(labelLeft, w / 2 - 0.6, -h / 2, h / 2)
    btn.onInitialized.add(() => {
      btn.size = new vec3(w, h, 1)
    })
    this.register(parent, item)
    return {button: btn, label: t, so, icon}
  }
}

/**
 * Show/hide for a panel root. The initial state is applied on the 2nd frame so
 * UIKit Buttons/Layouts created in onAwake finish their OnStart initialization
 * before the root is disabled (UIKit init-order gotcha G3).
 */
export class PanelVisibility {
  private frame = 0
  private wanted: boolean
  private anim: CancelFunction | null = null

  constructor(owner: BaseScriptComponent, private root: SceneObject, startVisible: boolean) {
    this.wanted = startVisible
    owner.createEvent("UpdateEvent").bind(() => {
      this.frame++
      if (this.frame === 2) this.root.enabled = this.wanted
    })
  }

  get visible(): boolean {
    return this.wanted
  }

  /** Enables the root and pops it in from zero scale. */
  show(popSeconds: number = 0.25): void {
    this.cancel()
    this.wanted = true
    const tr = this.root.getTransform()
    if (this.frame >= 2) this.root.enabled = true
    if (popSeconds <= 0) {
      tr.setLocalScale(vec3.one())
      return
    }
    tr.setLocalScale(new vec3(0.01, 0.01, 0.01))
    this.anim = animate({
      duration: popSeconds,
      easing: "ease-out-back",
      update: (t: number) => {
        const s = Math.max(0.01, t)
        tr.setLocalScale(new vec3(s, s, s))
      },
      ended: () => {
        this.anim = null
        tr.setLocalScale(vec3.one())
      }
    })
  }

  hide(): void {
    this.cancel()
    this.wanted = false
    if (this.frame >= 2) this.root.enabled = false
    this.root.getTransform().setLocalScale(vec3.one())
  }

  /** Folds inward (shrinks to nothing), then disables. */
  fold(seconds: number, done?: () => void): void {
    this.cancel()
    const tr = this.root.getTransform()
    const start = tr.getLocalScale()
    this.anim = animate({
      duration: Math.max(0.05, seconds),
      easing: "ease-in-quad",
      update: (t: number) => {
        const k = Math.max(0.001, 1 - t)
        tr.setLocalScale(new vec3(start.x * k, start.y * k * k, start.z))
      },
      ended: () => {
        this.anim = null
        this.hide()
        if (done) done()
      }
    })
  }

  private cancel(): void {
    if (this.anim) this.anim()
    this.anim = null
  }
}
