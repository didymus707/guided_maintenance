// B2BMaintenanceMain.ts
// Owns: the guided-maintenance flow state machine (public `state`, see
//       B2BMaintenanceFlowState.ts) and the wiring between controllers, UI panels,
//       audio and DualBackendManager.js:
//   anchor -> diagnostics -> scan -> fault on PSU Slot 2 -> pull failed PSU ->
//   snap replacement (gates Step 1) -> Step 1 + mock audit log -> power button ->
//   LED boot -> telemetry + Step 3 -> Close Ticket -> UI folds -> badge -> reset.
// Expects (@input): every controller / UI module ScriptComponent and the
//       DualBackendManager ScriptComponent (wired by the bootstrap Phase B).
// Must not: build UI or geometry itself (UI modules / controllers do).

import {FlowState, FlowStateName} from "./B2BMaintenanceFlowState"
import {AnchorPose, B2BMaintenancePlacementController} from "./B2BMaintenancePlacementController"
import {B2BMaintenanceRackController} from "./B2BMaintenanceRackController"
import {B2BMaintenancePsuController} from "./B2BMaintenancePsuController"
import {B2BMaintenanceAudioController} from "./B2BMaintenanceAudioController"
import {B2BMaintenanceDiagnosticsUI} from "./B2BMaintenanceDiagnosticsUI"
import {B2BMaintenanceChecklistUI} from "./B2BMaintenanceChecklistUI"
import {B2BMaintenanceAuditLogUI} from "./B2BMaintenanceAuditLogUI"
import {B2BMaintenanceTelemetryUI} from "./B2BMaintenanceTelemetryUI"
import {B2BMaintenanceBadgeUI} from "./B2BMaintenanceBadgeUI"

type BackendResult = {lines: string[]; offline: boolean; mock: boolean}

@component
export class B2BMaintenanceMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">B2BMaintenanceMain – guided maintenance flow</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Ghost rack placement controller")
  placement!: B2BMaintenancePlacementController

  @input
  @hint("Root moved to the anchored pose; the rack and all panels live under it")
  rackAnchor!: SceneObject

  @input
  @hint("Server rack stand-in (scan line, fault box, power button, LEDs, arrow)")
  rack!: B2BMaintenanceRackController

  @input
  @hint("Failed / replacement PSU swap controller")
  psus!: B2BMaintenancePsuController

  @input
  @hint("Run Hardware Diagnostics panel")
  diagnosticsPanel!: B2BMaintenanceDiagnosticsUI

  @input
  @hint("3-step checklist panel")
  checklistPanel!: B2BMaintenanceChecklistUI

  @input
  @hint("System Audit Log panel")
  auditLogPanel!: B2BMaintenanceAuditLogUI

  @input
  @hint("Telemetry graph panel")
  telemetryGraph!: B2BMaintenanceTelemetryUI

  @input
  @hint("Maintenance Complete badge")
  completeBadge!: B2BMaintenanceBadgeUI

  @input
  @hint("Sound cues")
  audio!: B2BMaintenanceAudioController

  @input
  @hint("DualBackendManager.js ScriptComponent (all network / mock API logic)")
  backendManager!: ScriptComponent
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Seconds the Step 1 audit log stays visible before fading")
  @widget(new SliderWidget(1, 15, 0.5))
  auditLogHoldSeconds: number = 5

  @input
  @hint("Seconds the final (Close Ticket) audit log flash stays before the UI folds")
  @widget(new SliderWidget(0.2, 5, 0.1))
  closeLogHoldSeconds: number = 1.0

  @input
  @hint("Seconds for checklist / audit log / telemetry to fold away")
  @widget(new SliderWidget(0.1, 2, 0.05))
  foldSeconds: number = 0.5

  @input
  @hint("Seconds the Maintenance Complete badge hovers before the rack fades")
  @widget(new SliderWidget(1, 10, 0.5))
  badgeHoldSeconds: number = 3

  @input
  @hint("Seconds for the rack to fade out before the Lens resets")
  @widget(new SliderWidget(0.2, 4, 0.1))
  rackFadeSeconds: number = 1.2

  @input
  @hint("Ticket ID sent to the backend")
  ticketId: string = "4471"
  @ui.group_end

  @ui.separator
  @ui.group_start("Layout")
  @input
  @hint("Rack size multiplier (1 = real 60x200x100 cm rack). Smaller fits the whole rack in view")
  @widget(new SliderWidget(0.3, 1, 0.05))
  rackScale: number = 0.5

  @input
  @hint("Panel size multiplier (bigger panels = bigger text and buttons)")
  @widget(new SliderWidget(0.8, 2, 0.05))
  panelScale: number = 1.5

  @input
  @hint("Gap (cm) between the rack's side edge and the checklist / telemetry panels")
  @widget(new SliderWidget(0, 40, 1))
  panelGapCm: number = 5

  @input
  @hint("How far (cm) the side panels sit in front of the rack's front plane")
  @widget(new SliderWidget(0, 30, 1))
  panelFrontCm: number = 10

  @input
  @hint("Lift the rack so the target chassis and panels sit at eye level (off = rack stands on the floor)")
  eyeLevel: boolean = true

  @input
  @hint("Distance (cm) from you to the rack front when you anchor while looking straight ahead")
  @widget(new SliderWidget(70, 300, 5))
  rackDistanceCm: number = 160

  @input
  @hint("Shift the rack left so your gaze lands between the rack and the checklist (keeps both in view)")
  centerOnWorkZone: boolean = true
  @ui.group_end

  private _state: FlowStateName = FlowState.Placing
  private _history: string[] = []
  private taskStartTime = 0
  private timers: DelayedCallbackEvent[] = []

  /** Current flow state (one of FlowState values) — read by LEAF tests. */
  get state(): string {
    return this._state
  }

  /** Every state entered since Lens start, in order. */
  get stateHistory(): string[] {
    return this._history.slice()
  }

  onAwake(): void {
    if (!this.placement || !this.rackAnchor || !this.rack || !this.psus || !this.diagnosticsPanel || !this.checklistPanel ||
        !this.auditLogPanel || !this.telemetryGraph || !this.completeBadge || !this.audio || !this.backendManager) {
      print("[B2BMaintenance] ERROR: required @input not wired (check bootstrap Phase B)")
      return
    }
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  /**
   * Sizes the rack (and its ghost) and places every panel around the scaled
   * chassis, so the whole work zone fits in view. Panels scale on their own
   * object; PanelVisibility animates the PanelRoot child, so this is preserved.
   */
  private applyLayout(): void {
    const s = this.rackScale
    const p = this.panelScale
    const deg = Math.PI / 180
    const one = new vec3(s, s, s)
    this.rack.getSceneObject().getTransform().setLocalScale(one)
    if (this.placement.ghostPose) this.placement.ghostPose.getTransform().setLocalScale(one)

    const chassisY = 130 * s
    this.placement.eyeLevelHeightCm = this.eyeLevel ? chassisY : -1
    this.placement.defaultDistanceCm = this.rackDistanceCm
    const edge = 30 * s + this.panelGapCm // rack half-width + gap
    const z0 = this.panelFrontCm
    const cos = Math.cos(15 * deg)
    const sin = Math.sin(15 * deg)
    const place = (so: SceneObject, pos: vec3, yawDeg: number) => {
      const t = so.getTransform()
      t.setLocalPosition(pos)
      t.setLocalRotation(quat.angleAxis(yawDeg * deg, vec3.up()))
      t.setLocalScale(new vec3(p, p, p))
    }

    // Right side: checklist (and the diagnostics button in the same spot), angled 15° inward.
    const checklistW = 30 * p
    const right = new vec3(edge + (checklistW / 2) * cos, chassisY, z0 + (checklistW / 2) * sin)
    place(this.checklistPanel.getSceneObject(), right, -15)
    place(this.diagnosticsPanel.getSceneObject(), right, -15)
    // Center the gaze on the span from the rack's left edge to the checklist's right edge.
    const workRight = edge + checklistW * cos
    this.placement.lateralOffsetCm = this.centerOnWorkZone ? -(workRight - 30 * s) / 2 : 0

    // Audit log sits directly above the checklist, same x/z and angle.
    const checklistH = 25 * p
    const auditH = 20 * p
    const lift = checklistH / 2 + 1 * p + auditH / 2
    place(this.auditLogPanel.getSceneObject(), right.add(new vec3(0, lift, 0)), -15)

    // Left side: telemetry graph, mirrored angle.
    const telemetryW = 24 * p
    place(this.telemetryGraph.getSceneObject(), new vec3(-(edge + (telemetryW / 2) * cos), chassisY, z0 + (telemetryW / 2) * sin), 15)

    // Badge hovers just above the target chassis.
    place(this.completeBadge.getSceneObject(), new vec3(0, chassisY + 20 * s + 8 * p, 8), 0)
    print("[B2BMaintenance] layout: rackScale=" + s + " panelScale=" + p +
      " distance=" + this.rackDistanceCm + " lateral=" + this.placement.lateralOffsetCm.toFixed(1) +
      " ghostScale=" + (this.placement.ghostPose ? this.placement.ghostPose.getTransform().getWorldScale().y.toFixed(2) : "none"))
  }

  private onStart(): void {
    this.applyLayout()
    this.placement.onAnchorRequested.add((pose) => this.onAnchor(pose))
    this.diagnosticsPanel.onRunDiagnostics.add(() => this.onRunDiagnostics())
    this.psus.onFailedRemoved.add(() => this.onFailedRemoved())
    this.psus.onReplacementSeated.add(() => this.onReplacementSeated())
    this.checklistPanel.onStep1Confirm.add(() => this.onStep1Confirm())
    this.rack.onPowerPressed.add(() => this.onPowerPressed())
    this.checklistPanel.onCloseTicket.add(() => this.onCloseTicket())
    // First reset on frame 3, after every UIKit / SIK component finished OnStart.
    let frame = 0
    const boot = this.createEvent("UpdateEvent")
    boot.bind(() => {
      frame++
      if (frame === 3) {
        boot.enabled = false
        this.resetToPlacing()
      }
    })
  }

  // ---------------------------------------------------------------- flow steps

  private onAnchor(pose: AnchorPose): void {
    if (this._state !== FlowState.Placing) return
    const t = this.rackAnchor.getTransform()
    t.setWorldPosition(pose.position)
    t.setWorldRotation(pose.rotation)
    this.placement.end()
    this.rack.resetRack()
    this.rack.showRack()
    this.psus.resetPsus()
    this.checklistPanel.resetChecklist()
    this.diagnosticsPanel.show()
    this.audio.playClick()
    this.taskStartTime = getTime()
    this.setState(FlowState.Anchored)
  }

  private onRunDiagnostics(): void {
    if (this._state !== FlowState.Anchored) return
    this.audio.playClick()
    this.diagnosticsPanel.hide()
    this.setState(FlowState.Scanning)
    this.audio.playScan()
    this.rack.playScan(() => {
      this.rack.setFaultVisible(true)
      this.audio.playFault()
      this.checklistPanel.show()
      this.checklistPanel.setActiveStep(1)
      this.checklistPanel.setStep1Enabled(false)
      this.checklistPanel.setHint("Pull the failed PSU out of Slot 2")
      this.psus.armFailedPsu()
      this.setState(FlowState.FaultDetected)
    })
  }

  private onFailedRemoved(): void {
    if (this._state !== FlowState.FaultDetected) return
    this.psus.spawnReplacement()
    this.checklistPanel.setHint("Slide the glowing replacement PSU into Slot 2")
    this.setState(FlowState.FailedPsuRemoved)
  }

  private onReplacementSeated(): void {
    if (this._state !== FlowState.FailedPsuRemoved) return
    this.rack.setFaultVisible(false)
    this.audio.playSnap()
    this.checklistPanel.setStep1Enabled(true)
    this.checklistPanel.setHint("Pinch \"Step 1: Swap Complete\" to confirm")
    this.setState(FlowState.ReplacementSeated)
  }

  private onStep1Confirm(): void {
    if (this._state !== FlowState.ReplacementSeated) return
    this.checklistPanel.markStep1Confirmed()
    this.checklistPanel.setStepDone(1)
    this.checklistPanel.setActiveStep(2)
    this.checklistPanel.setHint("Pinch the server's power button")
    this.rack.setArrowVisible(true)
    this.rack.setPowerButtonEnabled(true)
    this.audio.playSuccess()
    this.setState(FlowState.Step1Confirmed)
    this.callBackend("logStepOneComplete", (r) => {
      this.auditLogPanel.showEntries(r.lines, r.offline, this.auditLogHoldSeconds)
    })
  }

  private onPowerPressed(): void {
    if (this._state !== FlowState.Step1Confirmed) return
    this.rack.setArrowVisible(false)
    this.rack.setPowerButtonEnabled(false)
    this.audio.playBoot()
    this.checklistPanel.setHint("Booting... waiting for solid green LEDs")
    this.setState(FlowState.Booting)
    this.rack.runBootSequence(() => {
      if (this._state !== FlowState.Booting) return
      this.checklistPanel.setStepDone(2)
      this.checklistPanel.setActiveStep(3)
      this.checklistPanel.showCloseTicket()
      this.checklistPanel.setHint("System healthy. Pinch \"Close Ticket\"")
      this.telemetryGraph.show()
      this.audio.playSuccess()
      this.setState(FlowState.Step2Complete)
    })
  }

  private onCloseTicket(): void {
    if (this._state !== FlowState.Step2Complete) return
    this.audio.playClick()
    this.checklistPanel.setStepDone(3)
    this.checklistPanel.setActiveStep(4)
    this.setState(FlowState.ClosingTicket)
    this.callBackend("closeTicket", (r) => {
      this.auditLogPanel.showEntries(r.lines, r.offline, this.closeLogHoldSeconds)
      // Fold everything away once the final log line has been read.
      const typingSeconds = r.lines.join("").length / 60 + 0.6
      this.after(typingSeconds + this.closeLogHoldSeconds, () => this.finishTicket())
    })
  }

  private finishTicket(): void {
    if (this._state !== FlowState.ClosingTicket) return
    this.auditLogPanel.hide()
    this.checklistPanel.fold(this.foldSeconds)
    this.telemetryGraph.fold(this.foldSeconds)
    this.after(this.foldSeconds, () => {
      this.completeBadge.show()
      this.audio.playComplete()
      this.setState(FlowState.Complete)
      this.after(this.badgeHoldSeconds, () => {
        this.completeBadge.hide()
        this.rack.fadeOutRack(this.rackFadeSeconds, () => this.resetToPlacing())
        this.fadePsus(this.rackFadeSeconds)
      })
    })
  }

  /** Back to the empty room: ghost outline follows the gaze again. */
  private resetToPlacing(): void {
    this.clearTimers()
    this.diagnosticsPanel.hide()
    this.checklistPanel.hide()
    this.checklistPanel.resetChecklist()
    this.auditLogPanel.hide()
    this.telemetryGraph.hide()
    this.completeBadge.hide()
    this.rack.resetRack()
    this.rack.hideRack()
    this.psus.resetPsus()
    this.setState(FlowState.Placing)
    this.placement.begin()
  }

  // ---------------------------------------------------------------- helpers

  private setState(s: FlowStateName): void {
    this._state = s
    this._history.push(s)
    print("[B2BMaintenance] state -> " + s)
  }

  private callBackend(method: string, onResult: (r: BackendResult) => void): void {
    const api = this.backendManager as any
    const info = {
      taskId: method === "closeTicket" ? "Ticket_Close" : "PSU_Swap",
      ticketId: this.ticketId,
      partId: "PSU",
      elapsedSeconds: Math.round(getTime() - this.taskStartTime)
    }
    if (!api || typeof api[method] !== "function") {
      print("[B2BMaintenance] WARN: DualBackendManager." + method + " unavailable; skipping audit log")
      return
    }
    api[method](info, (r: BackendResult) => onResult(r))
  }

  private fadePsus(seconds: number): void {
    const start = getTime()
    const ev = this.createEvent("UpdateEvent")
    ev.bind(() => {
      const t = Math.min(1, (getTime() - start) / Math.max(0.05, seconds))
      this.psus.setOpacity(1 - t)
      if (t >= 1) ev.enabled = false
    })
  }

  private after(seconds: number, fn: () => void): void {
    const ev = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    ev.bind(() => fn())
    ev.reset(seconds)
    this.timers.push(ev)
  }

  private clearTimers(): void {
    for (const ev of this.timers) ev.enabled = false
    this.timers = []
  }
}
