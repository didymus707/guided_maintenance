// B2BMaintenancePlacementController.ts
// Owns: rack placement — a transparent ghost outline of the rack that follows the
//       user's gaze on the floor; pinching the floor (FloorTarget) or the ghost
//       itself (RackGhost) requests an anchor at the ghost's pose.
//       Floor detection: World Query hit test along the gaze ray (real surfaces);
//       fallback = a virtual floor plane `eyeHeightCm` below the camera, so it
//       also works in Lens Studio's Interactive Preview where there is no floor.
// Expects (@input): Camera Object, GhostPose (moved every frame), RackGhost
//       (child of GhostPose, offset to the rack's center), FloorTarget.
// Must not: show the rack or advance the flow (Main reacts to onAnchorRequested).

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {B2BGeometry, GlowPalette} from "./B2BMaintenanceGeometry"

export type AnchorPose = {position: vec3; rotation: quat}

@component
export class B2BMaintenancePlacementController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">B2BMaintenancePlacementController – ghost rack + floor anchoring</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("The world camera (Camera Object)")
  cameraObject!: SceneObject

  @input
  @hint("Pose root moved to the gaze point on the floor (rack front-center at floor level)")
  ghostPose!: SceneObject

  @input
  @hint("Ghost rack outline (pinchable). Child of GhostPose, offset to the rack center")
  rackGhost!: SceneObject

  @input
  @hint("Large invisible floor collider; pinch anywhere on the floor to anchor")
  floorTarget!: SceneObject
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Fallback floor: camera height above the floor in cm (used when no real surface is found)")
  @widget(new SliderWidget(100, 200, 1))
  eyeHeightCm: number = 160

  @input
  @hint("Distance (cm) to place the rack front when the gaze does not hit the floor")
  @widget(new SliderWidget(60, 300, 5))
  defaultDistanceCm: number = 110

  @input
  @hint("Closest / farthest rack placement distance (cm)")
  @widget(new SliderWidget(40, 200, 5))
  minDistanceCm: number = 70

  @input
  @hint("Farthest rack placement distance (cm)")
  @widget(new SliderWidget(150, 800, 10))
  maxDistanceCm: number = 350

  @input
  @hint("Use World Query hit tests to find the real floor (falls back to the virtual floor)")
  useWorldQuery: boolean = true

  @input
  @hint("Show the ghost outline")
  showGhost: boolean = true
  @ui.group_end

  private active = false
  private floorY = 0
  private floorYInitialized = false
  private hitSession: HitTestSession | null = null
  private frame = 0
  private ghostPalette = new GlowPalette()
  private ghostRotation = quat.quatIdentity()
  private ghostInteractable!: Interactable
  private floorInteractable!: Interactable
  private _worldQueryHits = 0

  private _onAnchorRequested = new Event<AnchorPose>()
  get onAnchorRequested(): PublicApi<AnchorPose> {
    return this._onAnchorRequested.publicApi()
  }

  get isPlacing(): boolean {
    return this.active
  }

  /** Number of real-surface (floor) hits from World Query so far. */
  get worldQueryHits(): number {
    return this._worldQueryHits
  }

  onAwake(): void {
    if (!this.cameraObject || !this.ghostPose || !this.rackGhost || !this.floorTarget) {
      print("[B2BMaintenancePlacementController] ERROR: required @input not wired (check bootstrap Phase B)")
      return
    }
    this.buildGhost()
    this.buildFloorTarget()
    if (this.useWorldQuery) this.startWorldQuery()
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    this.createEvent("OnStartEvent").bind(() => {
      this.ghostInteractable.onTriggerEnd.add(() => this.requestAnchor())
      this.floorInteractable.onTriggerEnd.add(() => this.requestAnchor())
    })
  }

  // ---------------------------------------------------------------- public API

  /** Starts gaze-following placement (ghost visible). */
  begin(): void {
    this.active = true
    this.frame = Math.min(this.frame, 1)
    this.applyVisibility()
  }

  /** Stops placement (ghost and floor target hidden). */
  end(): void {
    this.active = false
    this.applyVisibility()
  }

  /** Anchors at the current ghost pose (same as pinching the floor). */
  requestAnchor(): void {
    if (!this.active) return
    const t = this.ghostPose.getTransform()
    this._onAnchorRequested.invoke({position: t.getWorldPosition(), rotation: t.getWorldRotation()})
  }

  getGhostPose(): AnchorPose {
    const t = this.ghostPose.getTransform()
    return {position: t.getWorldPosition(), rotation: t.getWorldRotation()}
  }

  // ---------------------------------------------------------------- internals

  private onUpdate(): void {
    this.frame++
    if (this.frame === 2) this.applyVisibility()
    if (!this.active) return

    const camT = this.cameraObject.getTransform()
    const camPos = camT.getWorldPosition()
    const look = camT.forward.uniformScale(-1).normalize() // camera looks down -Z
    if (!this.floorYInitialized) {
      this.floorY = camPos.y - this.eyeHeightCm
      this.floorYInitialized = true
    }

    if (this.hitSession && this.frame % 3 === 0) {
      this.hitSession.hitTest(camPos, camPos.add(look.uniformScale(this.maxDistanceCm * 1.5)), (hit: WorldQueryHitTestResult) => {
        if (hit && hit.normal.y > 0.8 && hit.position.y < camPos.y - 60) {
          this._worldQueryHits++
          this.floorY = this.floorY + (hit.position.y - this.floorY) * 0.3
        }
      })
    }

    let flat = new vec3(look.x, 0, look.z)
    if (flat.length < 0.001) flat = new vec3(0, 0, -1)
    flat = flat.normalize()
    let horizontalDist = this.defaultDistanceCm
    if (look.y < -0.05) {
      const t = (this.floorY - camPos.y) / look.y
      const p = camPos.add(look.uniformScale(t))
      horizontalDist = new vec3(p.x - camPos.x, 0, p.z - camPos.z).length
    }
    horizontalDist = Math.max(this.minDistanceCm, Math.min(this.maxDistanceCm, horizontalDist))
    const target = new vec3(camPos.x + flat.x * horizontalDist, this.floorY, camPos.z + flat.z * horizontalDist)

    // Rack front (+Z local) faces the user.
    const toCam = new vec3(camPos.x - target.x, 0, camPos.z - target.z)
    const yaw = Math.atan2(toCam.x, toCam.z)
    this.ghostRotation = quat.angleAxis(yaw, vec3.up())

    const gt = this.ghostPose.getTransform()
    const cur = gt.getWorldPosition()
    const smoothed = this.frame <= 3 ? target : vec3.lerp(cur, target, 0.25)
    gt.setWorldPosition(smoothed)
    gt.setWorldRotation(this.ghostRotation)

    // The floor collider follows the user so a pinch anywhere on the floor lands on it.
    this.floorTarget.getTransform().setWorldPosition(new vec3(camPos.x, this.floorY, camPos.z))
  }

  private applyVisibility(): void {
    this.ghostPose.enabled = this.active && this.showGhost
    this.floorTarget.enabled = this.active
  }

  private startWorldQuery(): void {
    try {
      const wq = require("LensStudio:WorldQueryModule") as WorldQueryModule
      const options = HitTestSessionOptions.create()
      options.filter = true
      this.hitSession = wq.createHitTestSessionWithOptions(options)
      this.hitSession.start()
    } catch (e) {
      print("[B2BMaintenancePlacementController] World Query unavailable, using virtual floor: " + e)
      this.hitSession = null
    }
  }

  private buildGhost(): void {
    // RackGhost sits at the rack's center (0, 100, -50) under GhostPose.
    const edges = this.ghostPalette.make(new vec4(0.75, 0.95, 1.0, 0.55))
    const footprint = this.ghostPalette.make(new vec4(0.4, 0.95, 1.0, 0.95))
    const shell = this.ghostPalette.make(new vec4(0.5, 0.9, 1.0, 0.06))
    B2BGeometry.meshObject(this.rackGhost, "GhostEdges", B2BGeometry.wireBox(60, 200, 100, 0.8), edges)
    B2BGeometry.meshObject(this.rackGhost, "GhostShell", B2BGeometry.box(60, 200, 100), shell)
    B2BGeometry.meshObject(this.rackGhost, "GhostFootprint", B2BGeometry.floorRect(64, 104, 1.5, new vec3(0, -100, 0)), footprint)
    const collider = this.rackGhost.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(60, 200, 100)
    collider.shape = shape
    collider.fitVisual = false
    this.ghostInteractable = this.rackGhost.createComponent(Interactable.getTypeName()) as Interactable
    this.ghostInteractable.targetingMode = 3
  }

  private buildFloorTarget(): void {
    const collider = this.floorTarget.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(1200, 2, 1200)
    collider.shape = shape
    collider.fitVisual = false
    this.floorInteractable = this.floorTarget.createComponent(Interactable.getTypeName()) as Interactable
    this.floorInteractable.targetingMode = 3
  }
}
