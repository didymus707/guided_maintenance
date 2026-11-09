// B2BMaintenanceRackController.ts
// Owns: the 1:1 virtual server rack stand-in (wireframe frame, filler units, the
//       target blade chassis, healthy PSU in Slot 1), the blue diagnostics scan
//       line, the red fault box on PSU Slot 2, the power button (pinch to boot),
//       the LED boot sequence, and the pulsing Step 2 arrow.
// Expects (@input): authored SceneObjects RackFrame, TargetChassis, ScanLine,
//       FaultBox_PSU2, PowerButton, LEDs, StepArrow (placed by the bootstrap;
//       move them in the Inspector to re-lay-out the rack).
// Must not: decide flow (Main owns the state machine) or build UI.

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import animate, {CancelFunction} from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {B2BGeometry, GlowPalette} from "./B2BMaintenanceGeometry"

@component
export class B2BMaintenanceRackController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">B2BMaintenanceRackController – virtual server rack stand-in</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Empty root the rack frame + filler server units are built under")
  rackFrame!: SceneObject

  @input
  @hint("Target blade chassis root (~130 cm off the floor). PSU slots, power button and LEDs live under it")
  targetChassis!: SceneObject

  @input
  @hint("Blue diagnostics scan line; swept from the rack top to the floor")
  scanLine!: SceneObject

  @input
  @hint("Red bounding box around PSU Slot 2")
  faultBox!: SceneObject

  @input
  @hint("Virtual power button on the chassis (pinch to boot)")
  powerButton!: SceneObject

  @input
  @hint("Row of chassis status LEDs (boot sequence)")
  leds!: SceneObject

  @input
  @hint("Pulsing 3D arrow pointing at the power button")
  stepArrow!: SceneObject
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input("vec3", "{60, 200, 100}")
  @hint("Rack width / height / depth in cm (real size)")
  rackSizeCm!: vec3

  @input
  @hint("Duration of the blue scan sweep, seconds")
  @widget(new SliderWidget(0.3, 3, 0.1))
  scanDurationSeconds: number = 1.0

  @input
  @hint("Amber blink cycles before the LEDs settle on solid green")
  @widget(new SliderWidget(1, 8, 1))
  bootBlinkCount: number = 4

  @input
  @hint("Seconds per amber blink half-cycle / per green LED fill step")
  @widget(new SliderWidget(0.1, 1, 0.05))
  bootStepSeconds: number = 0.3

  @input("vec4", "{0.9, 0.97, 1.0, 0.95}")
  @hint("Glowing wireframe color for the rack frame and target chassis")
  @widget(new ColorWidget())
  wireColor!: vec4

  @input("vec4", "{0.35, 0.9, 1.0, 0.6}")
  @hint("Accent color for filler server units and slot outlines")
  @widget(new ColorWidget())
  accentColor!: vec4

  @input("vec4", "{0.25, 0.6, 1.0, 0.95}")
  @hint("Diagnostics scan line color")
  @widget(new ColorWidget())
  scanColor!: vec4

  @input("vec4", "{1.0, 0.2, 0.2, 1.0}")
  @hint("Fault bounding box color")
  @widget(new ColorWidget())
  faultColor!: vec4
  @ui.group_end

  private palette = new GlowPalette()
  private ledMats: Material[] = []
  private faultMat!: Material
  private arrowMat!: Material
  private powerMat!: Material
  private powerBaseColor = new vec4(0.85, 0.97, 1.0, 1.0)
  private powerInteractable!: Interactable
  private powerEnabled = false
  private faultVisible = false
  private arrowVisible = false
  private arrowBase = vec3.zero()
  private scanCancel: CancelFunction | null = null
  private fadeCancel: CancelFunction | null = null
  private bootTimers: DelayedCallbackEvent[] = []
  private frame = 0
  private visibleWanted = false
  private ledColorNames: string[] = ["off", "off", "off", "off"]

  private _onPowerPressed = new Event<void>()
  get onPowerPressed(): PublicApi<void> {
    return this._onPowerPressed.publicApi()
  }

  /** "off" | "amber" | "green" per LED — readable by tests. */
  get ledStates(): string[] {
    return this.ledColorNames.slice()
  }

  get isFaultVisible(): boolean {
    return this.faultVisible
  }

  get isArrowVisible(): boolean {
    return this.arrowVisible
  }

  onAwake(): void {
    if (!this.rackFrame || !this.targetChassis || !this.scanLine || !this.faultBox || !this.powerButton || !this.leds || !this.stepArrow) {
      print("[B2BMaintenanceRackController] ERROR: required @input not wired (check bootstrap Phase B)")
      return
    }
    this.buildRackFrame()
    this.buildChassis()
    this.buildScanLine()
    this.buildFaultBox()
    this.buildPowerButton()
    this.buildLeds()
    this.buildArrow()

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    this.createEvent("OnStartEvent").bind(() => {
      this.powerInteractable.onHoverEnter.add(() => this.setPowerHighlight(true))
      this.powerInteractable.onHoverExit.add(() => this.setPowerHighlight(false))
      this.powerInteractable.onTriggerEnd.add(() => {
        if (this.powerEnabled) this._onPowerPressed.invoke()
      })
    })
  }

  // ---------------------------------------------------------------- public API

  showRack(): void {
    this.cancelFade()
    this.visibleWanted = true
    this.palette.setOpacity(1)
    if (this.frame >= 2) this.applyVisibility()
  }

  hideRack(): void {
    this.cancelFade()
    this.visibleWanted = false
    this.applyVisibility()
  }

  /** Fades every rack visual to transparent, then hides it. */
  fadeOutRack(seconds: number, done?: () => void): void {
    this.cancelFade()
    this.fadeCancel = animate({
      duration: Math.max(0.05, seconds),
      easing: "ease-in-quad",
      update: (t: number) => this.palette.setOpacity(1 - t),
      ended: () => {
        this.fadeCancel = null
        this.hideRack()
        if (done) done()
      }
    })
  }

  /** Sweeps the blue scan line down the full rack height. */
  playScan(done?: () => void): void {
    if (this.scanCancel) this.scanCancel()
    const tr = this.scanLine.getTransform()
    const top = this.rackSizeCm.y + 4
    const p = tr.getLocalPosition()
    this.scanLine.enabled = true
    this.scanCancel = animate({
      duration: Math.max(0.1, this.scanDurationSeconds),
      easing: "linear",
      update: (t: number) => tr.setLocalPosition(new vec3(p.x, top - (top + 2) * t, p.z)),
      ended: () => {
        this.scanCancel = null
        this.scanLine.enabled = false
        tr.setLocalPosition(new vec3(p.x, top, p.z))
        if (done) done()
      }
    })
  }

  setFaultVisible(visible: boolean): void {
    this.faultVisible = visible
    this.faultBox.enabled = visible
  }

  setArrowVisible(visible: boolean): void {
    this.arrowVisible = visible
    this.stepArrow.enabled = visible
  }

  setPowerButtonEnabled(enabled: boolean): void {
    this.powerEnabled = enabled
    this.setPowerHighlight(false)
  }

  /** Amber blink cycles, then fills LEDs green one by one; `done` when solid green. */
  runBootSequence(done?: () => void): void {
    this.clearBootTimers()
    let t = 0
    const step = Math.max(0.05, this.bootStepSeconds)
    for (let i = 0; i < this.bootBlinkCount; i++) {
      this.after(t, () => this.setAllLeds("amber"))
      t += step
      this.after(t, () => this.setAllLeds("off"))
      t += step * 0.6
    }
    for (let i = 0; i < this.ledMats.length; i++) {
      const idx = i
      this.after(t, () => this.setLed(idx, "green"))
      t += step * 0.8
    }
    this.after(t, () => {
      this.setAllLeds("green")
      if (done) done()
    })
  }

  resetRack(): void {
    this.clearBootTimers()
    if (this.scanCancel) this.scanCancel()
    this.scanCancel = null
    this.scanLine.enabled = false
    this.setAllLeds("off")
    this.setFaultVisible(false)
    this.setArrowVisible(false)
    this.setPowerButtonEnabled(false)
    this.palette.setOpacity(1)
  }

  // ---------------------------------------------------------------- internals

  private onUpdate(): void {
    this.frame++
    if (this.frame === 2) {
      // Deferred initial hide: SIK/UIKit components below finish OnStart first.
      this.resetRack()
      this.applyVisibility()
    }
    const time = getTime()
    if (this.faultVisible && this.faultMat) {
      const a = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(time * 6))
      this.palette.setColor(this.faultMat, new vec4(this.faultColor.x, this.faultColor.y, this.faultColor.z, a))
    }
    if (this.arrowVisible) {
      const s = 1 + 0.18 * (0.5 + 0.5 * Math.sin(time * 5))
      const tr = this.stepArrow.getTransform()
      tr.setLocalScale(new vec3(s, s, s))
      tr.setLocalPosition(this.arrowBase.add(new vec3(0, 1.2 * Math.sin(time * 5), 0)))
    }
  }

  private applyVisibility(): void {
    this.rackFrame.enabled = this.visibleWanted
    this.targetChassis.enabled = this.visibleWanted
    if (!this.visibleWanted) this.scanLine.enabled = false
  }

  private cancelFade(): void {
    if (this.fadeCancel) this.fadeCancel()
    this.fadeCancel = null
  }

  private after(seconds: number, fn: () => void): void {
    const ev = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    ev.bind(() => fn())
    ev.reset(seconds)
    this.bootTimers.push(ev)
  }

  private clearBootTimers(): void {
    for (const ev of this.bootTimers) {
      ev.enabled = false
    }
    this.bootTimers = []
  }

  private ledColor(name: string): vec4 {
    if (name === "amber") return new vec4(1.0, 0.68, 0.1, 1.0)
    if (name === "green") return new vec4(0.3, 1.0, 0.45, 1.0)
    return new vec4(0.55, 0.65, 0.75, 0.35)
  }

  private setLed(i: number, name: string): void {
    this.ledColorNames[i] = name
    this.palette.setColor(this.ledMats[i], this.ledColor(name))
  }

  private setAllLeds(name: string): void {
    for (let i = 0; i < this.ledMats.length; i++) this.setLed(i, name)
  }

  private setPowerHighlight(on: boolean): void {
    if (!this.powerMat) return
    const c = this.powerEnabled && on ? new vec4(0.5, 1.0, 1.0, 1.0) : this.powerBaseColor
    this.palette.setColor(this.powerMat, c)
    const s = this.powerEnabled && on ? 1.15 : 1.0
    this.powerButton.getTransform().setLocalScale(new vec3(s, s, s))
  }

  private buildRackFrame(): void {
    const w = this.rackSizeCm.x
    const h = this.rackSizeCm.y
    const d = this.rackSizeCm.z
    const wire = this.palette.make(this.wireColor)
    B2BGeometry.meshObject(this.rackFrame, "RackWireframe", B2BGeometry.wireBox(w, h, d, 1.2, new vec3(0, h / 2, -d / 2)), wire)
    const rail = this.palette.make(new vec4(this.accentColor.x, this.accentColor.y, this.accentColor.z, 0.45))
    for (const sx of [-1, 1]) {
      B2BGeometry.meshObject(this.rackFrame, "FrontRail", B2BGeometry.box(1.6, h, 0.8), rail, new vec3(sx * (w / 2 - 2.5), h / 2, -0.4))
    }
    // Filler server units above and below the target chassis.
    const unitOutline = this.palette.make(this.accentColor)
    const unitPlate = this.palette.make(new vec4(this.accentColor.x, this.accentColor.y, this.accentColor.z, 0.07))
    const statusGreen = this.palette.make(new vec4(0.3, 1.0, 0.45, 0.9))
    const unitHeights = [15, 30, 45, 60, 75, 90, 105, 155, 170, 185]
    const unitOutlineMesh = B2BGeometry.wireRect(w - 6, 10, 0.35)
    const unitPlateMesh = B2BGeometry.box(w - 6, 10, 0.4)
    const ledMesh = B2BGeometry.box(1, 1, 0.4)
    for (const y of unitHeights) {
      const unit = global.scene.createSceneObject("FillerUnit_" + y)
      unit.setParent(this.rackFrame)
      unit.getTransform().setLocalPosition(new vec3(0, y, -0.6))
      B2BGeometry.meshObject(unit, "Outline", unitOutlineMesh, unitOutline, new vec3(0, 0, 0.3))
      B2BGeometry.meshObject(unit, "Plate", unitPlateMesh, unitPlate, new vec3(0, 0, -0.2))
      B2BGeometry.meshObject(unit, "StatusLed", ledMesh, statusGreen, new vec3(-(w / 2 - 6), 2.5, 0.5))
    }
  }

  private buildChassis(): void {
    const w = this.rackSizeCm.x - 4
    const visuals = global.scene.createSceneObject("ChassisVisuals")
    visuals.setParent(this.targetChassis)
    const wire = this.palette.make(this.wireColor)
    const plate = this.palette.make(new vec4(this.accentColor.x, this.accentColor.y, this.accentColor.z, 0.1))
    const slotOutline = this.palette.make(this.accentColor)
    B2BGeometry.meshObject(visuals, "ChassisOutline", B2BGeometry.wireRect(w, 18, 0.6), wire, new vec3(0, 0, 0.2))
    B2BGeometry.meshObject(visuals, "ChassisDepthOutline", B2BGeometry.wireBox(w, 18, 70, 0.3, new vec3(0, 0, -35)), slotOutline)
    B2BGeometry.meshObject(visuals, "ChassisPlate", B2BGeometry.box(w, 18, 0.4), plate, new vec3(0, 0, -0.6))
    // PSU slot openings (Slot 1 at x=16, Slot 2 at x=23).
    const slotMesh = B2BGeometry.wireRect(6.4, 9.4, 0.35)
    B2BGeometry.meshObject(visuals, "PSUSlot1Opening", slotMesh, slotOutline, new vec3(16, -3, 0.4))
    B2BGeometry.meshObject(visuals, "PSUSlot2Opening", slotMesh, slotOutline, new vec3(23, -3, 0.4))
    // Healthy PSU already seated in Slot 1.
    const healthyBody = this.palette.make(new vec4(0.55, 0.9, 1.0, 0.25))
    const healthyFace = this.palette.make(this.wireColor)
    const healthy = global.scene.createSceneObject("HealthyPSU_Slot1")
    healthy.setParent(visuals)
    healthy.getTransform().setLocalPosition(new vec3(16, -3, -9))
    B2BGeometry.meshObject(healthy, "Body", B2BGeometry.box(5, 8, 20), healthyBody)
    B2BGeometry.meshObject(healthy, "FaceOutline", B2BGeometry.wireRect(5, 8, 0.3), healthyFace, new vec3(0, 0, 10.05))
    B2BGeometry.meshObject(healthy, "StatusLed", B2BGeometry.box(1, 1, 0.4), this.palette.make(new vec4(0.3, 1.0, 0.45, 0.95)), new vec3(1.4, -2.8, 10.2))
  }

  private buildScanLine(): void {
    const w = this.rackSizeCm.x + 8
    const core = this.palette.make(this.scanColor)
    const band = this.palette.make(new vec4(this.scanColor.x, this.scanColor.y, this.scanColor.z, 0.22))
    B2BGeometry.meshObject(this.scanLine, "ScanCore", B2BGeometry.box(w, 1.0, 1.0), core)
    B2BGeometry.meshObject(this.scanLine, "ScanGlow", B2BGeometry.box(w, 6, 0.3), band, new vec3(0, 3, -0.5))
    this.scanLine.getTransform().setLocalPosition(new vec3(0, this.rackSizeCm.y + 4, this.scanLine.getTransform().getLocalPosition().z))
  }

  private buildFaultBox(): void {
    this.faultMat = this.palette.make(this.faultColor)
    B2BGeometry.meshObject(this.faultBox, "FaultOutline", B2BGeometry.wireBox(7.6, 10.6, 4, 0.55), this.faultMat)
  }

  private buildPowerButton(): void {
    this.powerMat = this.palette.make(this.powerBaseColor)
    const ring = this.palette.make(this.accentColor)
    B2BGeometry.meshObject(this.powerButton, "ButtonCap", B2BGeometry.box(3.4, 3.4, 1.2), this.powerMat)
    B2BGeometry.meshObject(this.powerButton, "ButtonRing", B2BGeometry.wireRect(4.8, 4.8, 0.35), ring, new vec3(0, 0, -0.3))
    // Big pinch target (7 cm) — larger than the visual so it is easy to aim at.
    const collider = this.powerButton.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(7, 7, 5)
    collider.shape = shape
    collider.fitVisual = false
    this.powerInteractable = this.powerButton.createComponent(Interactable.getTypeName()) as Interactable
    this.powerInteractable.targetingMode = 3
  }

  private buildLeds(): void {
    const mesh = B2BGeometry.box(1.4, 1.4, 0.6)
    for (let i = 0; i < 4; i++) {
      const m = this.palette.make(this.ledColor("off"))
      this.ledMats.push(m)
      B2BGeometry.meshObject(this.leds, "LED_" + i, mesh, m, new vec3(-i * 2.4, 0, 0))
    }
  }

  private buildArrow(): void {
    this.arrowMat = this.palette.make(new vec4(0.4, 0.95, 1.0, 1.0))
    B2BGeometry.meshObject(this.stepArrow, "ArrowMesh", B2BGeometry.downArrow(9, 1.4, 4, 3.5), this.arrowMat)
    this.arrowBase = this.stepArrow.getTransform().getLocalPosition()
  }
}
