// B2BTestKit.ts — shared helpers for the B2B guided-maintenance LEAF scenarios.
// Test-only. Reads Lens state through the public getters of the game scripts and
// drives the Lens through real SIK interactions (IK hand by default, or the LEAF
// simulated hand). Never calls game handlers directly.

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {findSceneObjectByName, nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {LeafHandInteractor} from "Leaf.lspkg/Interactors/interactor/LeafTwoHandInteractor"
import {createIKInteractor} from "Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar"
import {IKBodyInteractor} from "Leaf.lspkg/Interactors/interactor/ik/IKBodyInteractor"
import {DiagnosticRecorder} from "Leaf.lspkg/Diagnostic/DiagnosticRecorder"

export type DriveMode = "ik" | "hand"

/** Default parameters shared by every scenario (overridable from run_leaf_scenario). */
export const B2B_DEFAULT_PARAMS: Record<string, string> = {
  interactor: "ik", // "ik" = IK avatar arm, real SIK targeting; "hand" = LEAF simulated SIK hand
  anchor_target: "RackGhost", // "RackGhost" or "FloorTarget"
}

export function log(msg: string): void {
  print("[B2BTest] " + msg)
}

function fmt(v: vec3): string {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`
}

/** Finds the ScriptComponent on `objectName` that exposes `probeProp`. */
export function scriptOn(objectName: string, probeProp: string): any {
  const so = findSceneObjectByName(objectName)
  if (!so) throw new Error(`SceneObject "${objectName}" not found`)
  const comps = so.getComponents("Component.ScriptComponent") as any[]
  for (const c of comps) {
    if (c !== null && c !== undefined && (c as any)[probeProp] !== undefined) return c
  }
  throw new Error(`No script on "${objectName}" exposes "${probeProp}"`)
}

export class B2BLens {
  get main(): any {
    return scriptOn("B2BMaintenance", "stateHistory")
  }
  get placement(): any {
    return scriptOn("Placement", "isPlacing")
  }
  get rack(): any {
    return scriptOn("ServerRack", "ledStates")
  }
  get psus(): any {
    return scriptOn("PSUs", "isReplacementSeated")
  }
  get diagnostics(): any {
    return scriptOn("DiagnosticsPanel", "isVisible")
  }
  get checklist(): any {
    return scriptOn("ChecklistPanel", "step1ButtonState")
  }
  get auditLog(): any {
    return scriptOn("AuditLogPanel", "fullText")
  }
  get telemetry(): any {
    return scriptOn("TelemetryGraph", "isVisible")
  }
  get badge(): any {
    return scriptOn("MaintenanceCompleteBadge", "isVisible")
  }

  get state(): string {
    return this.main.state
  }

  obj(name: string): SceneObject {
    const so = findSceneObjectByName(name)
    if (!so) throw new Error(`SceneObject "${name}" not found`)
    return so
  }

  /** PanelRoot child of a panel object — panels toggle this, not themselves. */
  panelRootShown(panelName: string): boolean {
    const panel = this.obj(panelName)
    for (let i = 0; i < panel.getChildrenCount(); i++) {
      const c = panel.getChild(i)
      if (c.name === "PanelRoot") return c.isEnabledInHierarchy
    }
    throw new Error(`PanelRoot not found under "${panelName}"`)
  }

  snapshot(label: string): void {
    let s = `SNAPSHOT ${label}: state=${this.state} history=[${this.main.stateHistory.join(",")}]`
    s += ` isPlacing=${this.placement.isPlacing}`
    s += ` rackShown=${this.obj("RackFrame").isEnabledInHierarchy}/${this.obj("TargetChassis").isEnabledInHierarchy}`
    s += ` diag=${this.diagnostics.isVisible}/${this.panelRootShown("DiagnosticsPanel")}`
    s += ` checklist=${this.checklist.isVisible}/${this.panelRootShown("ChecklistPanel")} activeStep=${this.checklist.activeStep}`
    s += ` step1=${this.checklist.step1ButtonState} closeVisible=${this.checklist.closeTicketVisible} hint="${this.checklist.hintText}"`
    s += ` fault=${this.rack.isFaultVisible}/${this.obj("FaultBox_PSU2").isEnabledInHierarchy} arrow=${this.rack.isArrowVisible}`
    s += ` leds=[${this.rack.ledStates.join(",")}]`
    s += ` failedRemoved=${this.psus.isFailedRemoved} seated=${this.psus.isReplacementSeated}`
    s += ` audit=${this.auditLog.isVisible} offline=${this.auditLog.isOffline}`
    s += ` telemetry=${this.telemetry.isVisible} badge=${this.badge.isVisible}/${this.panelRootShown("MaintenanceCompleteBadge")}`
    log(s)
  }

  async waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<number> {
    const start = getTime()
    while (!pred()) {
      if ((getTime() - start) * 1000 > timeoutMs) {
        this.snapshot("timeout:" + label)
        throw new Error(`Timed out after ${timeoutMs} ms waiting for: ${label} (state=${this.state})`)
      }
      await nextFrame()
    }
    const ms = Math.round((getTime() - start) * 1000)
    log(`waitFor OK "${label}" after ${ms} ms`)
    return ms
  }

  /** Waits for the Lens' own frame-3 reset into "placing". */
  async waitForPlacing(): Promise<void> {
    await sleep(500)
    await this.waitFor(() => this.state === "placing" && this.placement.isPlacing, 5000, "initial placing state")
  }
}

/**
 * Drives SIK interactables either with the LEAF IK avatar (real hand pose +
 * SIK's own direct/far-field targeting against colliders) or the LEAF simulated
 * hand (forces SIK's currentInteractable — exercises SIK events, not hit tests).
 */
export class B2BDriver {
  readonly mode: DriveMode
  private ik: IKBodyInteractor | null = null

  constructor(config?: ScenarioConfig) {
    const m = config?.get("interactor") ?? "ik"
    this.mode = m === "hand" ? "hand" : "ik"
    log(`driver mode = ${this.mode}`)
  }

  async init(): Promise<void> {
    if (this.mode === "ik") {
      // Strict: a reach/FOV/convergence problem throws instead of silently
      // falling back to a simulated SIK trigger.
      DiagnosticRecorder.getInstance().setPolicy("fail-fast")
      this.ik = createIKInteractor()
      await this.ik.ready
      await sleep(300)
    }
  }

  find(name: string): Interactable {
    const i = findInteractableByName(name, undefined, true)
    if (!i) {
      const any = findInteractableByName(name)
      throw new Error(
        `Interactable "${name}" not found or not enabled` +
          (any ? ` (exists: component enabled=${any.enabled}, inHierarchy=${any.getSceneObject().isEnabledInHierarchy})` : " (does not exist)"),
      )
    }
    return i
  }

  /** IK routing decision: direct poke (within arm reach) vs far-field ray. */
  private ikRoute(target: Interactable): string {
    if (!this.ik) return ""
    return this.ik.right.isIndirect(target) ? " [IK route: indirect/far-field ray]" : " [IK route: direct poke]"
  }

  /** Logs what a camera->target ray hits first (occlusion / hit-test evidence). */
  probeFromCamera(target: Interactable): void {
    const cam = findSceneObjectByName("Camera Object")
    if (!cam) return
    const from = cam.getTransform().getWorldPosition()
    const to = target.getTransform().getWorldPosition()
    const dir = to.sub(from).normalize()
    const end = to.add(dir.uniformScale(30))
    Physics.createGlobalProbe().rayCast(from, end, (hit) => {
      const name = isNull(hit) || isNull(hit.collider) ? "<nothing>" : hit.collider.getSceneObject().name
      log(`probe camera${fmt(from)} -> "${target.getSceneObject().name}"${fmt(to)} dist=${to.distance(from).toFixed(1)}: first hit = "${name}"`)
    })
  }

  async pinch(name: string): Promise<void> {
    const target = this.find(name)
    this.probeFromCamera(target)
    log(`pinch "${name}" via ${this.mode}${this.ikRoute(target)}`)
    let hovered = false
    let triggered = false
    const u1 = target.onHoverEnter.add(() => (hovered = true))
    const u2 = target.onTriggerEnd.add(() => (triggered = true))
    if (this.ik) {
      await this.ik.trigger(target, "right")
    } else {
      await LeafHandInteractor.get("right").trigger(target)
    }
    u1()
    u2()
    log(`pinch "${name}" done: hoverEnter=${hovered} triggerEnd=${triggered}`)
    if (!triggered) throw new Error(`Pinch on "${name}" never produced a SIK onTriggerEnd`)
    await sleep(150)
  }

  /** Drags by a world-space delta (cm) once. */
  async dragBy(name: string, delta: vec3): Promise<void> {
    const target = this.find(name)
    this.probeFromCamera(target)
    log(`drag "${name}" via ${this.mode}${this.ikRoute(target)}`)
    const before = target.getTransform().getWorldPosition()
    let dragStarted = false
    const u = target.onDragStart.add(() => (dragStarted = true))
    if (this.ik) {
      await this.ik.drag(target, delta, "right")
    } else {
      // LEAF hand drag is velocity-based: dragVector is added on every SIK drag update.
      const frames = 30
      await LeafHandInteractor.get("right").drag(target, delta.uniformScale(1 / frames), 500)
    }
    u()
    await sleep(100)
    const after = isNull(target) ? before : target.getTransform().getWorldPosition()
    log(`drag "${name}" delta=${fmt(delta)} via ${this.mode}: dragStart=${dragStarted} moved ${fmt(before)} -> ${fmt(after)} (|d|=${after.distance(before).toFixed(1)} cm)`)
  }

  /**
   * Loop-until drag toward a world point; stops as soon as `done()` holds.
   * Returns the number of drag attempts used.
   */
  async dragToward(name: string, goal: () => vec3, done: () => boolean, maxAttempts: number): Promise<number> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (done()) return attempt - 1
      const target = findInteractableByName(name, undefined, true)
      if (!target) {
        if (done()) return attempt - 1
        throw new Error(`"${name}" is no longer interactable before goal was reached`)
      }
      const delta = goal().sub(target.getTransform().getWorldPosition())
      await this.dragBy(name, delta)
      await sleep(200)
    }
    return maxAttempts
  }
}
