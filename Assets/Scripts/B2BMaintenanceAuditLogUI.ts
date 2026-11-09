// B2BMaintenanceAuditLogUI.ts
// Owns: the System Audit Log panel that slides out from the right side of the
//       checklist and types terminal-style log lines (BlocTi / stoQr payloads),
//       holds them, then fades out. Offline sync (real API failed) = yellow text.
// Public API: showEntries(lines, offline, holdSeconds, done?), hide();
//       readable: isVisible, displayedText, fullText, isOffline, isTyping.
// Must not: call any backend (DualBackendManager.js does; Main passes results in).

import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import animate, {CancelFunction} from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {PanelKit, PanelVisibility, UIColors} from "./B2BMaintenanceSharedUI"

const ICON_TERMINAL = requireAsset("../Icons/terminal.png") as Texture

const MAX_LINES = 2

@component
export class B2BMaintenanceAuditLogUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">B2BMaintenanceAuditLogUI – System Audit Log</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Typing speed, characters per second")
  @widget(new SliderWidget(10, 200, 5))
  charsPerSecond: number = 60

  @input
  @hint("Slide-out distance (cm) from behind the checklist")
  @widget(new SliderWidget(0, 40, 1))
  slideDistanceCm: number = 30

  @input
  @hint("Seconds for the slide-out / fade-out animations")
  @widget(new SliderWidget(0.1, 2, 0.05))
  animSeconds: number = 0.45

  @input("vec4", "{0.35, 0.95, 1.0, 1.0}")
  @hint("Log text color when synced")
  @widget(new ColorWidget())
  syncedColor!: vec4

  @input("vec4", "{1.0, 0.9, 0.25, 1.0}")
  @hint("Log text color in offline-sync state (real API failed, mock data shown)")
  @widget(new ColorWidget())
  offlineColor!: vec4
  @ui.group_end

  private kit = new PanelKit()
  private vis!: PanelVisibility
  private slideRoot!: SceneObject
  private glass!: RoundedRectangle
  private lineTexts: Text[] = []
  private statusText!: Text
  private titleText!: Text
  private icon!: Image
  private lines: string[] = []
  private typed = 0
  private typing = false
  private typeStart = 0
  private offline = false
  private anim: CancelFunction | null = null
  private holdTimer: DelayedCallbackEvent | null = null
  private pendingDone: (() => void) | null = null
  private holdSeconds = 5

  get isVisible(): boolean {
    return this.vis ? this.vis.visible : false
  }

  get isTyping(): boolean {
    return this.typing
  }

  get isOffline(): boolean {
    return this.offline
  }

  /** Full text of the current entries (what will be shown once typing ends). */
  get fullText(): string {
    return this.lines.join("\n")
  }

  /** Text currently visible on the panel. */
  get displayedText(): string {
    return this.lineTexts.map((t) => t.text).filter((s) => s.length > 0).join("\n")
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    const root = this.kit.obj(this.sceneObject, "PanelRoot")
    this.slideRoot = this.kit.obj(root, "SlideRoot")
    const w = 30
    const h = 20
    this.glass = this.kit.glassPanel(this.slideRoot, w, h)
    const content = this.kit.content(this.slideRoot)
    const col = this.kit.column(content, w, h, {gap: 0.8, padY: 1.3, padX: 1.5, justify: FlexJustify.Start, align: FlexAlign.Center})
    const header = this.kit.row(col, w - 3, 3.0, {gap: 0.8, justify: FlexJustify.Start, align: FlexAlign.Center})
    this.icon = this.kit.icon(header, "TerminalIcon", ICON_TERMINAL, 2.2, UIColors.cyan)
    this.titleText = this.kit.text(header, "Title", "System Audit Log", "Subheadline", 14, 2.8, UIColors.white)
    this.statusText = this.kit.text(header, "SyncStatus", "SYNCED", "Caption", 9, 2.8, UIColors.green, HorizontalAlignment.Right)
    for (let i = 0; i < MAX_LINES; i++) {
      const t = this.kit.text(col, "LogLine" + (i + 1), "", "Caption", w - 3, 6.0, this.syncedColor, HorizontalAlignment.Left, true)
      this.lineTexts.push(t)
    }
    this.vis = new PanelVisibility(this, root, false)
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /**
   * Slides the panel out, types `lines`, holds for `holdSeconds`, fades out,
   * then calls `done`.
   */
  showEntries(lines: string[], offline: boolean, holdSeconds: number, done?: () => void): void {
    this.stopTimers()
    this.lines = lines.slice(0, MAX_LINES)
    this.offline = offline
    this.holdSeconds = holdSeconds
    this.pendingDone = done ?? null
    const color = offline ? this.offlineColor : this.syncedColor
    for (const t of this.lineTexts) {
      t.text = ""
      t.textFill.color = color
    }
    this.statusText.text = offline ? "OFFLINE SYNC" : "SYNCED"
    this.statusText.textFill.color = offline ? this.offlineColor : UIColors.green
    this.setOpacity(1)
    this.vis.show(0)
    const tr = this.slideRoot.getTransform()
    tr.setLocalPosition(new vec3(-this.slideDistanceCm, 0, -0.5))
    this.anim = animate({
      duration: this.animSeconds,
      easing: "ease-out-quad",
      update: (t: number) => tr.setLocalPosition(new vec3(-this.slideDistanceCm * (1 - t), 0, -0.5 * (1 - t))),
      ended: () => {
        this.anim = null
        this.typed = 0
        this.typing = true
        this.typeStart = getTime()
      }
    })
  }

  hide(): void {
    this.stopTimers()
    this.typing = false
    this.vis.hide()
  }

  // ---------------------------------------------------------------- internals

  private onUpdate(): void {
    if (!this.typing) return
    const total = this.lines.reduce((n, s) => n + s.length, 0)
    const count = Math.min(total, Math.floor((getTime() - this.typeStart) * this.charsPerSecond))
    if (count !== this.typed) {
      this.typed = count
      let remaining = count
      for (let i = 0; i < this.lineTexts.length; i++) {
        const s = this.lines[i] ?? ""
        const n = Math.max(0, Math.min(s.length, remaining))
        this.lineTexts[i].text = s.substring(0, n) + (n < s.length && n === remaining && remaining > 0 ? "_" : "")
        remaining -= n
      }
    }
    if (count >= total) {
      this.typing = false
      for (let i = 0; i < this.lineTexts.length; i++) this.lineTexts[i].text = this.lines[i] ?? ""
      this.holdTimer = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
      this.holdTimer.bind(() => this.fadeOut())
      this.holdTimer.reset(Math.max(0, this.holdSeconds))
    }
  }

  private fadeOut(): void {
    this.holdTimer = null
    this.anim = animate({
      duration: this.animSeconds * 1.6,
      easing: "ease-in-out-quad",
      update: (t: number) => this.setOpacity(1 - t),
      ended: () => {
        this.anim = null
        this.vis.hide()
        const done = this.pendingDone
        this.pendingDone = null
        if (done) done()
      }
    })
  }

  private setOpacity(a: number): void {
    if (this.glass) this.glass.opacity = a
    const fade = (t: Text) => {
      const c = t.textFill.color
      t.textFill.color = new vec4(c.x, c.y, c.z, a)
    }
    this.lineTexts.forEach(fade)
    fade(this.statusText)
    fade(this.titleText)
    this.kit.setIconTint(this.icon, new vec4(UIColors.cyan.x, UIColors.cyan.y, UIColors.cyan.z, a))
  }

  private stopTimers(): void {
    if (this.anim) this.anim()
    this.anim = null
    if (this.holdTimer) this.holdTimer.enabled = false
    this.holdTimer = null
  }
}
