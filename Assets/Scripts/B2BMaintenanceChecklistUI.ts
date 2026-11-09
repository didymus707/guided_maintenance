// B2BMaintenanceChecklistUI.ts
// Owns: the minimalist 3-step repair checklist floating right of the rack:
//       header, Step 1/2/3 rows (pending / active / done), a hint line, the gated
//       "Step 1: Swap Complete" button and the "Close Ticket" button. Passive view.
// Public API: show(), hide(), fold(sec, done), resetChecklist(), setActiveStep(n),
//       setStepDone(n), setHint(s), setStep1Enabled(b), markStep1Confirmed(),
//       showCloseTicket(); events onStep1Confirm, onCloseTicket.
//       Readable: activeStep, step1ButtonState, closeTicketVisible, hintText, isVisible.
// Must not: decide when steps advance (Main does).

import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {RoundedRectangle, RoundedRectBlendMode} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {PanelKit, PanelVisibility, UIColors, applyTextRole} from "./B2BMaintenanceSharedUI"

const ICON_FAULT = requireAsset("../Icons/warning.png") as Texture
const ICON_PENDING = requireAsset("../Icons/radio_button_unchecked.png") as Texture
const ICON_DONE = requireAsset("../Icons/check_circle.png") as Texture
const ICON_SWAP = requireAsset("../Icons/swap_horiz.png") as Texture
const ICON_CLOSE = requireAsset("../Icons/task_alt.png") as Texture

type StepRow = {icon: Image; text: Text}

@component
export class B2BMaintenanceChecklistUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">B2BMaintenanceChecklistUI – 3-step repair checklist</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Checklist header")
  headerText: string = "Ticket #4471 · PSU Slot 2 Fault"

  @input
  @hint("Step 1 label")
  step1Text: string = "Step 1: Swap PSU in Slot 2"

  @input
  @hint("Step 2 label")
  step2Text: string = "Step 2: Boot Diagnostics"

  @input
  @hint("Step 3 label")
  step3Text: string = "Step 3: Close Ticket"

  @input
  @hint("Gated confirm button label")
  step1ButtonLabel: string = "Step 1: Swap Complete"

  @input
  @hint("Final button label")
  closeTicketLabel: string = "Close Ticket"

  @input("vec4", "{0.35, 1.0, 0.5, 1.0}")
  @hint("Color for completed steps and the confirmed Step 1 button")
  @widget(new ColorWidget())
  doneColor!: vec4
  @ui.group_end

  private kit = new PanelKit()
  private vis!: PanelVisibility
  private rows: StepRow[] = []
  private hint!: Text
  private step1Btn!: Button
  private step1Label!: Text
  private step1Icon: Image | null = null
  private step1So!: SceneObject
  private step1Glow!: SceneObject
  private closeBtnSo!: SceneObject
  private stepLabels: string[] = []
  private _activeStep = 0
  private doneSteps = [false, false, false]
  private _step1State = "hidden"
  private _closeVisible = false
  private closeArmed = false
  private frame = 0

  private _onStep1Confirm = new Event<void>()
  get onStep1Confirm(): PublicApi<void> {
    return this._onStep1Confirm.publicApi()
  }

  private _onCloseTicket = new Event<void>()
  get onCloseTicket(): PublicApi<void> {
    return this._onCloseTicket.publicApi()
  }

  get isVisible(): boolean {
    return this.vis ? this.vis.visible : false
  }

  /** 0 = none, 1..3 = the step currently in progress, 4 = all done. */
  get activeStep(): number {
    return this._activeStep
  }

  /** "hidden" | "disabled" | "active" | "confirmed" */
  get step1ButtonState(): string {
    return this._step1State
  }

  get closeTicketVisible(): boolean {
    return this._closeVisible
  }

  get hintText(): string {
    return this.hint ? this.hint.text : ""
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.stepLabels = [this.step1Text, this.step2Text, this.step3Text]
    const root = this.kit.obj(this.sceneObject, "PanelRoot")
    const w = 30
    const h = 25
    this.kit.glassPanel(root, w, h)
    const content = this.kit.content(root)
    const col = this.kit.column(content, w, h, {gap: 0.6, padY: 1.3, padX: 1.5, justify: FlexJustify.Start, align: FlexAlign.Center})

    const header = this.kit.row(col, w - 3, 3.2, {gap: 0.8, justify: FlexJustify.Start, align: FlexAlign.Center})
    this.kit.icon(header, "HeaderIcon", ICON_FAULT, 2.4, UIColors.red)
    this.kit.text(header, "HeaderText", this.headerText, "Subheadline", w - 6.4, 3.0, UIColors.cyan)

    for (let i = 0; i < 3; i++) {
      const row = this.kit.row(col, w - 3, 2.8, {gap: 0.8, justify: FlexJustify.Start, align: FlexAlign.Center})
      row.name = "Step" + (i + 1) + "Row"
      const icon = this.kit.icon(row, "StepIcon", ICON_PENDING, 2.0, UIColors.dim)
      const text = this.kit.text(row, "StepText", this.stepLabels[i], "Body", w - 6, 2.6, UIColors.dim)
      this.rows.push({icon, text})
    }

    this.hint = this.kit.text(col, "HintText", "Pull the failed PSU out of Slot 2", "Caption", w - 3, 2.4, UIColors.cyan, HorizontalAlignment.Center)

    const action = this.kit.child(col, "ActionArea", w - 4, 4.6)
    // Green confirmation glow sits behind the Step 1 button face.
    this.step1Glow = this.kit.obj(action, "Step1ConfirmedGlow", new vec3(0, 0, -0.4))
    const glow = this.step1Glow.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    glow.cornerRadius = 1.0
    glow.blendMode = RoundedRectBlendMode.Normal
    glow.gradient = false
    glow.backgroundColor = new vec4(this.doneColor.x, this.doneColor.y, this.doneColor.z, 0.35)
    glow.border = true
    glow.borderSize = 0.3
    glow.borderColor = this.doneColor
    glow.size = new vec2(w - 2.6, 5.8)
    glow.initialize()
    glow.size = new vec2(w - 2.6, 5.8)
    glow.backgroundColor = new vec4(this.doneColor.x, this.doneColor.y, this.doneColor.z, 0.35)
    glow.border = true
    glow.borderSize = 0.3
    glow.borderColor = this.doneColor

    const s1 = this.kit.button(action, "Step1Button", this.step1ButtonLabel, w - 4, 4.6, ICON_SWAP)
    this.step1Btn = s1.button
    this.step1Label = s1.label
    this.step1Icon = s1.icon
    this.step1So = s1.so
    this.step1Btn.inactive = true
    this.step1Btn.onTriggerUp.add(() => {
      if (this._step1State !== "active") return
      this._onStep1Confirm.invoke()
    })

    const close = this.kit.button(action, "CloseTicketButton", this.closeTicketLabel, w - 4, 4.6, ICON_CLOSE)
    this.closeBtnSo = close.so
    close.button.onTriggerUp.add(() => {
      if (!this.closeArmed) return
      this.closeArmed = false
      this._onCloseTicket.invoke()
    })

    this.vis = new PanelVisibility(this, root, false)
    this.createEvent("UpdateEvent").bind(() => {
      this.frame++
      if (this.frame < 3) return
      // Keep the hidden-by-default children in sync once UIKit has initialized.
      const glowOn = this._step1State === "confirmed" && !this._closeVisible
      if (this.step1Glow.enabled !== glowOn) this.step1Glow.enabled = glowOn
      if (this.closeBtnSo.enabled !== this._closeVisible) this.closeBtnSo.enabled = this._closeVisible
      const s1Visible = this._step1State !== "hidden" && !this._closeVisible
      if (this.step1So.enabled !== s1Visible) this.step1So.enabled = s1Visible
    })
    this.resetChecklist()
  }

  // ---------------------------------------------------------------- public API

  show(): void {
    this.vis.show(0.35)
  }

  hide(): void {
    this.vis.hide()
  }

  fold(seconds: number, done?: () => void): void {
    this.vis.fold(seconds, done)
  }

  resetChecklist(): void {
    this.doneSteps = [false, false, false]
    this._activeStep = 0
    this._closeVisible = false
    this.closeArmed = false
    this.setStep1State("hidden")
    for (let i = 0; i < 3; i++) this.renderRow(i)
    this.setHint("Pull the failed PSU out of Slot 2")
  }

  setActiveStep(step: number): void {
    this._activeStep = step
    for (let i = 0; i < 3; i++) this.renderRow(i)
    if (step === 1 && this._step1State === "hidden") this.setStep1State("disabled")
  }

  setStepDone(step: number): void {
    if (step >= 1 && step <= 3) this.doneSteps[step - 1] = true
    for (let i = 0; i < 3; i++) this.renderRow(i)
  }

  setHint(message: string): void {
    if (this.hint) this.hint.text = message
  }

  /** Gate: grayed out + not clickable until the replacement PSU has snapped in. */
  setStep1Enabled(enabled: boolean): void {
    if (this._step1State === "confirmed") return
    this.setStep1State(enabled ? "active" : "disabled")
  }

  /** Step 1 button turns green. */
  markStep1Confirmed(): void {
    this.setStep1State("confirmed")
  }

  /** Replaces the Step 1 button with the Close Ticket button. */
  showCloseTicket(): void {
    this._closeVisible = true
    this.closeArmed = true
  }

  // ---------------------------------------------------------------- internals

  private setStep1State(state: string): void {
    this._step1State = state
    if (!this.step1Btn) return
    if (state === "confirmed") {
      this.step1Btn.inactive = false
      this.step1Label.text = this.step1ButtonLabel + " - Done"
      this.step1Label.textFill.color = this.doneColor
      if (this.step1Icon) {
        this.kit.setIconTexture(this.step1Icon, ICON_DONE)
        this.kit.setIconTint(this.step1Icon, this.doneColor)
      }
      return
    }
    this.step1Label.text = this.step1ButtonLabel
    if (this.step1Icon) this.kit.setIconTexture(this.step1Icon, ICON_SWAP)
    const enabled = state === "active"
    this.step1Btn.inactive = !enabled
    const c = enabled ? UIColors.white : new vec4(0.85, 0.9, 0.95, 0.45)
    this.step1Label.textFill.color = c
    if (this.step1Icon) this.kit.setIconTint(this.step1Icon, c)
  }

  private renderRow(i: number): void {
    const row = this.rows[i]
    if (!row) return
    const done = this.doneSteps[i]
    const active = !done && this._activeStep === i + 1
    row.text.text = this.stepLabels[i]
    if (done) {
      this.kit.setIconTexture(row.icon, ICON_DONE)
      this.kit.setIconTint(row.icon, this.doneColor)
      row.text.textFill.color = this.doneColor
      applyTextRole(row.text, "Body")
    } else if (active) {
      this.kit.setIconTexture(row.icon, ICON_PENDING)
      this.kit.setIconTint(row.icon, UIColors.cyan)
      row.text.textFill.color = UIColors.white
      applyTextRole(row.text, "Callout")
    } else {
      this.kit.setIconTexture(row.icon, ICON_PENDING)
      this.kit.setIconTint(row.icon, UIColors.dim)
      row.text.textFill.color = UIColors.dim
      applyTextRole(row.text, "Body")
    }
  }
}
