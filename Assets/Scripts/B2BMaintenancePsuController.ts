// B2BMaintenancePsuController.ts
// Owns: the physical-swap stand-in — the failed PSU in Slot 2 (grab, drag away,
//       release -> fades out) and the glowing replacement PSU (grab, drag toward
//       Slot 2 -> snaps in when within snapRadiusCm laterally of the slot).
// Expects (@input): authored SceneObjects FailedPSU (seated in Slot 2),
//       ReplacementPSU (its authored transform is the spawn point next to the
//       checklist) and PSUSlot2Target (empty marking the seated pose).
// Must not: drive the checklist or audit log (Main subscribes to the events).

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import animate, {CancelFunction} from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {B2BGeometry, GlowPalette} from "./B2BMaintenanceGeometry"

type PsuParts = {
  root: SceneObject
  palette: GlowPalette
  bodyMat: Material
  bodyColor: vec4
  interactable: Interactable
  manipulation: InteractableManipulation
}

@component
export class B2BMaintenancePsuController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">B2BMaintenancePsuController – PSU swap (grab, drop, snap)</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Failed PSU, authored seated in Slot 2")
  failedPsu!: SceneObject

  @input
  @hint("Replacement PSU; its authored position is the spawn point next to the checklist")
  replacementPsu!: SceneObject

  @input
  @hint("Empty marking the seated pose of a PSU in Slot 2")
  slotTarget!: SceneObject
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Snap distance (cm) between the replacement PSU and Slot 2, measured across the slot face")
  @widget(new SliderWidget(2, 15, 0.5))
  snapRadiusCm: number = 5

  @input
  @hint("How far in front of the slot (cm) the replacement may be while still snapping (slide-in depth)")
  @widget(new SliderWidget(5, 80, 1))
  snapApproachDepthCm: number = 45

  @input
  @hint("Release the failed PSU at least this far (cm) from the slot to discard it")
  @widget(new SliderWidget(5, 60, 1))
  removeDistanceCm: number = 15

  @input
  @hint("Seconds for the discarded PSU to fade out")
  @widget(new SliderWidget(0.1, 2, 0.05))
  fadeSeconds: number = 0.6

  @input("vec4", "{1.0, 0.45, 0.35, 0.55}")
  @hint("Failed PSU body color")
  @widget(new ColorWidget())
  failedColor!: vec4

  @input("vec4", "{0.45, 1.0, 0.85, 0.6}")
  @hint("Replacement PSU body color (glowing)")
  @widget(new ColorWidget())
  replacementColor!: vec4
  @ui.group_end

  private failed!: PsuParts
  private replacement!: PsuParts
  private replacementSpawnPos = vec3.zero()
  private replacementSpawnRot = quat.quatIdentity()
  private failedArmed = false
  private replacementArmed = false
  private _failedRemoved = false
  private _replacementSeated = false
  private fadeCancel: CancelFunction | null = null
  private frame = 0
  private glowMat: Material | null = null

  private _onFailedRemoved = new Event<void>()
  get onFailedRemoved(): PublicApi<void> {
    return this._onFailedRemoved.publicApi()
  }

  private _onReplacementSeated = new Event<void>()
  get onReplacementSeated(): PublicApi<void> {
    return this._onReplacementSeated.publicApi()
  }

  get isFailedRemoved(): boolean {
    return this._failedRemoved
  }

  get isReplacementSeated(): boolean {
    return this._replacementSeated
  }

  /** World position of the Slot 2 seated pose (drag target for tests). */
  getSlotWorldPosition(): vec3 {
    return this.slotTarget.getTransform().getWorldPosition()
  }

  onAwake(): void {
    if (!this.failedPsu || !this.replacementPsu || !this.slotTarget) {
      print("[B2BMaintenancePsuController] ERROR: required @input not wired (check bootstrap Phase B)")
      return
    }
    const rt = this.replacementPsu.getTransform()
    this.replacementSpawnPos = rt.getLocalPosition()
    this.replacementSpawnRot = rt.getLocalRotation()

    this.failed = this.buildPsu(this.failedPsu, this.failedColor, false)
    this.replacement = this.buildPsu(this.replacementPsu, this.replacementColor, true)

    this.createEvent("OnStartEvent").bind(() => {
      this.bindPsu(this.failed, () => this.onFailedReleased(), null)
      this.bindPsu(this.replacement, () => this.onReplacementReleased(), () => this.onReplacementMoved())
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  // ---------------------------------------------------------------- public API

  /** Back to the initial state: failed PSU seated (not grabbable), replacement hidden. */
  resetPsus(): void {
    if (this.fadeCancel) this.fadeCancel()
    this.fadeCancel = null
    this.failedArmed = false
    this.replacementArmed = false
    this._failedRemoved = false
    this._replacementSeated = false
    this.seat(this.failed.root)
    this.failed.palette.setOpacity(1)
    this.failedPsu.enabled = true
    this.replacementPsu.enabled = false
    this.replacement.palette.setOpacity(1)
    const rt = this.replacementPsu.getTransform()
    rt.setLocalPosition(this.replacementSpawnPos)
    rt.setLocalRotation(this.replacementSpawnRot)
    this.setGrabbable(this.failed, false)
    this.setGrabbable(this.replacement, false)
  }

  /** Called when the red fault box appears: the failed PSU becomes grabbable. */
  armFailedPsu(): void {
    this.failedArmed = true
    this.setGrabbable(this.failed, true)
  }

  /** Spawns the glowing replacement next to the checklist panel. */
  spawnReplacement(): void {
    const rt = this.replacementPsu.getTransform()
    rt.setLocalPosition(this.replacementSpawnPos)
    rt.setLocalRotation(this.replacementSpawnRot)
    this.replacementPsu.enabled = true
    this.replacement.palette.setOpacity(1)
    this.replacementArmed = true
    this.setGrabbable(this.replacement, true)
  }

  /** Fades both PSU visuals (used when the whole rack fades out). */
  setOpacity(opacity: number): void {
    this.failed.palette.setOpacity(opacity)
    this.replacement.palette.setOpacity(opacity)
  }

  // ---------------------------------------------------------------- internals

  private onUpdate(): void {
    this.frame++
    if (this.frame === 2) this.resetPsus()
    if (this.replacementPsu.enabled && !this._replacementSeated && this.glowMat) {
      // Gentle glow pulse marks the replacement part.
      const a = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(getTime() * 4))
      this.replacement.palette.setColor(this.glowMat, new vec4(0.6, 1.0, 0.9, a))
    }
  }

  private buildPsu(root: SceneObject, color: vec4, glowing: boolean): PsuParts {
    const palette = new GlowPalette()
    const bodyMat = palette.make(color)
    const faceMat = palette.make(new vec4(0.92, 0.98, 1.0, 1.0))
    B2BGeometry.meshObject(root, "Body", B2BGeometry.box(5, 8, 20), bodyMat)
    B2BGeometry.meshObject(root, "Edges", B2BGeometry.wireBox(5, 8, 20, 0.25), faceMat)
    B2BGeometry.meshObject(root, "Handle", B2BGeometry.box(3.2, 1.0, 1.6), faceMat, new vec3(0, -2.6, 10.8))
    const led = palette.make(glowing ? new vec4(0.3, 1.0, 0.45, 1.0) : new vec4(1.0, 0.25, 0.2, 1.0))
    B2BGeometry.meshObject(root, "StatusLed", B2BGeometry.box(1, 1, 0.4), led, new vec3(1.4, 2.6, 10.2))
    if (glowing) {
      this.glowMat = palette.make(new vec4(0.6, 1.0, 0.9, 0.5))
      B2BGeometry.meshObject(root, "GlowHalo", B2BGeometry.wireBox(6.6, 9.6, 21.6, 0.35), this.glowMat)
    }
    // Generous grab target (larger than the 5x8x20 cm part).
    const collider = root.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(10, 13, 22)
    collider.shape = shape
    collider.fitVisual = false
    const interactable = root.createComponent(Interactable.getTypeName()) as Interactable
    interactable.targetingMode = 3
    const manipulation = root.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation
    manipulation.setCanScale(false)
    manipulation.setCanRotate(false)
    return {root, palette, bodyMat, bodyColor: color, interactable, manipulation}
  }

  private bindPsu(p: PsuParts, onRelease: () => void, onMove: (() => void) | null): void {
    p.interactable.onHoverEnter.add(() => this.highlight(p, true))
    p.interactable.onHoverExit.add(() => this.highlight(p, false))
    p.manipulation.onManipulationEnd.add(() => onRelease())
    if (onMove) p.manipulation.onManipulationUpdate.add(() => onMove())
  }

  private highlight(p: PsuParts, on: boolean): void {
    const c = p.bodyColor
    const lit = on ? new vec4(Math.min(1, c.x + 0.25), Math.min(1, c.y + 0.25), Math.min(1, c.z + 0.25), Math.min(1, c.w + 0.3)) : c
    p.palette.setColor(p.bodyMat, lit)
  }

  private setGrabbable(p: PsuParts, on: boolean): void {
    p.interactable.enabled = on
    p.manipulation.enabled = on
  }

  private seat(root: SceneObject): void {
    const st = this.slotTarget.getTransform()
    const t = root.getTransform()
    t.setWorldPosition(st.getWorldPosition())
    t.setWorldRotation(st.getWorldRotation())
  }

  /** Offset of `root` from the slot in slot-local axes (x/y across the face, z out of the slot). */
  private slotLocalOffset(root: SceneObject): vec3 {
    const st = this.slotTarget.getTransform()
    const delta = root.getTransform().getWorldPosition().sub(st.getWorldPosition())
    const inv = st.getWorldRotation().invert()
    return inv.multiplyVec3(delta)
  }

  private onFailedReleased(): void {
    if (!this.failedArmed || this._failedRemoved) return
    const dist = this.failedPsu.getTransform().getWorldPosition().distance(this.slotTarget.getTransform().getWorldPosition())
    if (dist < this.removeDistanceCm) {
      this.seat(this.failedPsu) // not far enough: slide back into the slot
      return
    }
    this._failedRemoved = true
    this.failedArmed = false
    this.setGrabbable(this.failed, false)
    if (this.fadeCancel) this.fadeCancel()
    this.fadeCancel = animate({
      duration: Math.max(0.05, this.fadeSeconds),
      easing: "ease-out-quad",
      update: (t: number) => this.failed.palette.setOpacity(1 - t),
      ended: () => {
        this.fadeCancel = null
        this.failedPsu.enabled = false
        this._onFailedRemoved.invoke()
      }
    })
  }

  private withinSnap(): boolean {
    const o = this.slotLocalOffset(this.replacementPsu)
    const lateral = Math.sqrt(o.x * o.x + o.y * o.y)
    return lateral <= this.snapRadiusCm && o.z >= -this.snapRadiusCm && o.z <= this.snapApproachDepthCm
  }

  private onReplacementMoved(): void {
    if (this.replacementArmed && !this._replacementSeated && this.withinSnap()) this.snapReplacement()
  }

  private onReplacementReleased(): void {
    if (!this.replacementArmed || this._replacementSeated) return
    if (this.withinSnap()) this.snapReplacement()
    else this.replacementPsu.getTransform().setLocalRotation(this.replacementSpawnRot)
  }

  private snapReplacement(): void {
    this._replacementSeated = true
    this.replacementArmed = false
    this.setGrabbable(this.replacement, false)
    this.seat(this.replacementPsu)
    if (this.glowMat) this.replacement.palette.setColor(this.glowMat, new vec4(0.3, 1.0, 0.45, 0.0))
    this._onReplacementSeated.invoke()
  }
}
