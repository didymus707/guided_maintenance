// B2BMaintenanceTelemetryUI.ts
// Owns: the small floating holographic telemetry graph shown left of the chassis
//       once Step 2 ticks off: "Power Draw: Normal", live wattage, PSU status and
//       an animated bar sparkline of simulated power draw. Passive view.
// Public API: show(), hide(), fold(sec, done); readable: isVisible, statusText.
// Must not: decide when it appears (Main does).

import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {PanelKit, PanelVisibility, UIColors} from "./B2BMaintenanceSharedUI"
import {B2BGeometry, GlowPalette} from "./B2BMaintenanceGeometry"

const ICON_TELEMETRY = requireAsset("../Icons/monitoring.png") as Texture
const BAR_COUNT = 24

@component
export class B2BMaintenanceTelemetryUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">B2BMaintenanceTelemetryUI – simulated live telemetry</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Status headline")
  statusLabel: string = "Power Draw: Normal"

  @input
  @hint("Nominal simulated power draw (W)")
  @widget(new SliderWidget(100, 1000, 10))
  nominalWatts: number = 412

  @input
  @hint("Sample rate of the simulated telemetry (samples per second)")
  @widget(new SliderWidget(1, 20, 1))
  samplesPerSecond: number = 6

  @input("vec4", "{0.35, 1.0, 0.5, 0.9}")
  @hint("Graph bar color")
  @widget(new ColorWidget())
  barColor!: vec4
  @ui.group_end

  private kit = new PanelKit()
  private vis!: PanelVisibility
  private wattsText!: Text
  private status!: Text
  private bars: SceneObject[] = []
  private samples: number[] = []
  private lastSample = 0
  private palette = new GlowPalette()

  get isVisible(): boolean {
    return this.vis ? this.vis.visible : false
  }

  get statusText(): string {
    return this.status ? this.status.text : ""
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    const root = this.kit.obj(this.sceneObject, "PanelRoot")
    const w = 24
    const h = 15
    this.kit.glassPanel(root, w, h)
    const content = this.kit.content(root)
    const col = this.kit.column(content, w, h, {gap: 0.5, padY: 1.1, padX: 1.2, justify: FlexJustify.Start, align: FlexAlign.Center})
    const header = this.kit.row(col, w - 2.4, 2.6, {gap: 0.7, justify: FlexJustify.Start, align: FlexAlign.Center})
    this.kit.icon(header, "TelemetryIcon", ICON_TELEMETRY, 2.0, UIColors.cyan)
    this.kit.text(header, "Title", "Live Telemetry · Chassis 07", "Subheadline", w - 5.4, 2.4, UIColors.white)
    const statusRow = this.kit.row(col, w - 2.4, 2.4, {gap: 0.5, justify: FlexJustify.SpaceBetween, align: FlexAlign.Center})
    this.status = this.kit.text(statusRow, "PowerStatus", this.statusLabel, "Callout", 14, 2.2, UIColors.green)
    this.wattsText = this.kit.text(statusRow, "Watts", this.nominalWatts + " W", "Body", 7, 2.2, UIColors.white, HorizontalAlignment.Right)
    // Data-viz marks (bar chart) — not a panel surface, so no UIKit primitive applies.
    this.kit.child(col, "Graph", w - 2.4, 5.4, (graph) => this.buildBars(graph, w - 3.4, 5.0))
    this.kit.text(col, "PsuStatus", "PSU 1: OK   PSU 2: OK   Inlet 24 °C", "Caption", w - 2.4, 2.0, UIColors.cyan)
    this.vis = new PanelVisibility(this, root, false)
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  show(): void {
    this.vis.show(0.35)
  }

  hide(): void {
    this.vis.hide()
  }

  fold(seconds: number, done?: () => void): void {
    this.vis.fold(seconds, done)
  }

  private buildBars(graph: SceneObject, gw: number, gh: number): void {
    const mat = this.palette.make(this.barColor)
    const axis = this.palette.make(new vec4(0.9, 0.97, 1.0, 0.6))
    B2BGeometry.meshObject(graph, "Baseline", B2BGeometry.box(gw, 0.12, 0.1), axis, new vec3(0, -gh / 2, 0.1))
    const step = gw / BAR_COUNT
    const barMesh = B2BGeometry.box(step * 0.6, 1, 0.1, new vec3(0, 0.5, 0))
    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = B2BGeometry.meshObject(graph, "Bar" + i, barMesh, mat, new vec3(-gw / 2 + step * (i + 0.5), -gh / 2, 0.12))
      this.bars.push(bar)
      this.samples.push(0.55)
    }
    this.graphHeight = gh
  }

  private graphHeight = 5

  private onUpdate(): void {
    if (!this.isVisible) return
    const now = getTime()
    if (now - this.lastSample < 1 / Math.max(1, this.samplesPerSecond)) return
    this.lastSample = now
    const v = 0.55 + 0.12 * Math.sin(now * 1.7) + 0.08 * (Math.random() - 0.5)
    this.samples.push(v)
    this.samples.shift()
    for (let i = 0; i < this.bars.length; i++) {
      const hh = Math.max(0.05, this.samples[i] * this.graphHeight)
      this.bars[i].getTransform().setLocalScale(new vec3(1, hh, 1))
    }
    this.wattsText.text = Math.round(this.nominalWatts * (v / 0.55)) + " W"
  }
}
