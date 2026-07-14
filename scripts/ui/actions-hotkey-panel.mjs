import { MODULE_ID } from "../constants.mjs"
import { tKey, validImg } from "../utils.mjs"
import {
   actionDisabledReason,
   ensureSiegeCSS,
   getActionsForCrew,
} from "../macros/helpers.mjs"
import { executeActionItem } from "../macros/action.mjs"
import { VehicleLaunchManager } from "../managers/launch.mjs"
import { VehicleEntryManager } from "../managers/entry.mjs"

const DRIVER_ROLES = ["Driver", "Operator"]
const START_ICON = "icons/sundries/misc/key-modern.webp"
const STOP_ICON = "icons/commodities/tech/lever.webp"
const MAX_SLOTS = 10

export class ActionsHotkeyPanel {
   static _open = new Map()

   static toggle(vehicle, crewman = null) {
      if (!vehicle) return null
      const existing = this._open.get(vehicle.id)
      if (existing) {
         existing.close()
         return null
      }
      const actor = crewman || this._resolveCrewman(vehicle)
      if (!actor) {
         ui.notifications.warn(tKey("Notifications.NotMountedOnSiege"))
         return null
      }
      const panel = new ActionsHotkeyPanel(vehicle, actor)
      this._open.set(vehicle.id, panel)
      panel.render({ force: true })
      return panel
   }

   static _resolveCrewman(vehicle) {
      return VehicleEntryManager.activeCrewmanForVehicle(vehicle)
   }

   static refreshFor(vehicleId) {
      const panel = this._open.get(vehicleId)
      if (!panel) return
      const crewman = this._resolveCrewman(panel.vehicle)
      if (!crewman) {
         panel.close({ animate: false })
         return
      }
      panel.crewman = crewman
      panel.render()
   }

   constructor(vehicle, crewman) {
      this.vehicle = vehicle
      this.crewman = crewman
      this._keyHandler = this._onKeyDown.bind(this)
      this._outsideHandler = this._onOutsidePointerDown.bind(this)
      this._closeTimer = null
      ensureSiegeCSS()
   }

   get title() {
      return tKey("ActionsHotkey.Title", { name: this.vehicle?.name ?? "" })
   }

   _position() {
      this._syncCrewman()
      const effect = this.crewman?.itemTypes?.effect?.find(
         (e) =>
            e.getFlag(MODULE_ID, "siegeId") === this.vehicle.id &&
            e.getFlag(MODULE_ID, "position"),
      )
      return effect?.getFlag(MODULE_ID, "position") || null
   }

   _syncCrewman() {
      const selected = VehicleEntryManager.activeCrewmanForVehicle(this.vehicle)
      if (!selected) return false
      this.crewman = selected
      return true
   }

   _layoutKey() {
      return `${this.vehicle.id}:${this._position() || "crew"}`
   }

   _layout() {
      const all = game.user.getFlag(MODULE_ID, "actionsHotkeyPanel") || {}
      const layout = all[this._layoutKey()] || {}
      const position = layout.position || null
      return {
         order: Array.isArray(layout.order) ? [...layout.order] : [],
         hidden: Array.isArray(layout.hidden) ? [...layout.hidden] : [],
         position:
            layout.positionVersion === 2 &&
            Number.isFinite(position?.left) && Number.isFinite(position?.top)
               ? { left: position.left, top: position.top }
               : null,
      }
   }

   async _saveLayout(layout) {
      const all = foundry.utils.deepClone(
         game.user.getFlag(MODULE_ID, "actionsHotkeyPanel") || {},
      )
      all[this._layoutKey()] = {
         order: layout.order,
         hidden: layout.hidden,
         position: layout.position || null,
         positionVersion: layout.position ? 2 : null,
      }
      await game.user.setFlag(MODULE_ID, "actionsHotkeyPanel", all)
   }

   _allEntries() {
      const position = this._position()
      const launched = VehicleLaunchManager.isLaunched(this.vehicle)
      const vehicleNeedsIgnition =
         this.vehicle.getFlag(MODULE_ID, "needsIgnition") === true
      const entries = []

      if (
         vehicleNeedsIgnition &&
         (game.user.isGM || DRIVER_ROLES.includes(position))
      ) {
         entries.push({
            id: "ignition",
            type: "ignition",
            label: launched
               ? tKey("CrewHUD.StopIgnition")
               : tKey("CrewHUD.StartIgnition"),
            img: launched ? STOP_ICON : START_ICON,
            blocked: false,
         })
      }

      for (const action of getActionsForCrew(this.vehicle, position, this.crewman)) {
         const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
         const disabledReason = actionDisabledReason(flag)
         const ignitionBlocked =
            vehicleNeedsIgnition &&
            flag.needsIgnition !== false &&
            !VehicleLaunchManager.isLaunched(this.vehicle)
         const blocked = !!disabledReason || ignitionBlocked
         const blockedReason = disabledReason || (ignitionBlocked ? tKey("CrewHUD.NotLaunched") : "")
         entries.push({
            id: `action:${action.id}`,
            type: "action",
            actionId: action.id,
            label: action.name,
            img: validImg(action.img, "icons/svg/aura.svg"),
            blocked,
            blockedReason,
         })
      }
      return entries
   }

   _entryState() {
      const entries = this._allEntries()
      const byId = new Map(entries.map((e) => [e.id, e]))
      const layout = this._layout()
      const hidden = new Set(layout.hidden.filter((id) => byId.has(id)))
      const order = layout.order.filter((id) => byId.has(id) && !hidden.has(id))
      for (const entry of entries) {
         if (!order.includes(entry.id) && !hidden.has(entry.id))
            order.push(entry.id)
      }
      const visibleIds = order.slice(0, MAX_SLOTS)
      const visibleSet = new Set(visibleIds)
      return {
         layout: { order, hidden: [...hidden], position: layout.position },
         visible: visibleIds.map((id) => byId.get(id)).filter(Boolean),
         hiddenEntries: entries.filter(
            (entry) => hidden.has(entry.id) || !visibleSet.has(entry.id),
         ),
      }
   }

   _renderHTML() {
      if (!this._syncCrewman())
         return `<div class="sah-wrap"><div class="sah-panel"><div class="sah-empty">${tKey("Notifications.NotMountedOnSiege")}</div></div></div>`
      const state = this._entryState()
      this._entries = state.visible
      this._hiddenEntries = state.hiddenEntries
      const slots = state.visible
         .map((entry, idx) => {
            const digit = idx === 9 ? 0 : idx + 1
            const blocked = entry.blocked ? "sah-slot-blocked" : ""
            const tooltip = entry.blockedReason
               ? `${entry.label}: ${entry.blockedReason}`
               : entry.label
            return `<button class="sah-slot ${blocked}" data-entry-id="${entry.id}" draggable="true" data-tooltip="${tooltip}">
               <span class="sah-number">${digit}</span>
               <img src="${entry.img}" alt="">
               <span class="sah-label">${entry.label}</span>
               <span class="sah-remove" data-entry-id="${entry.id}" data-tooltip="${tKey("ActionsHotkey.Remove")}"><i class="fa-solid fa-xmark"></i></span>
            </button>`
         })
         .join("")
      const canAdd = state.hiddenEntries.length > 0 && state.visible.length < MAX_SLOTS
      const empty = state.visible.length
         ? ""
         : `<div class="sah-empty">${tKey("ActionsHotkey.Empty")}</div>`
      return `<div class="sah-wrap ${canAdd ? "sah-has-add" : ""}">
         <button type="button" class="sah-close" data-tooltip="${tKey("ActionsHotkey.Close")}"><i class="fa-solid fa-xmark"></i></button>
         <div class="sah-drag-stub" data-tooltip="${tKey("ActionsHotkey.Move")}">
            <i class="fa-solid fa-grip-lines-vertical"></i>
         </div>
         <div class="sah-panel">
            <div class="sah-slots">${slots}${empty}</div>
         </div>
         ${
            canAdd
               ? `<button class="sah-add-stub" data-tooltip="${tKey("ActionsHotkey.Add")}"><i class="fa-solid fa-plus"></i></button>`
               : ""
         }
      </div>`
   }

   render() {
      const isNew = !this.element
      if (isNew) {
         this.element = document.createElement("div")
         this.element.className = "siege-actions-hotkey-panel-app"
         document.body.appendChild(this.element)
         document.addEventListener("keydown", this._keyHandler, true)
         window.setTimeout(() => {
            if (!this.element || this._closing) return
            document.addEventListener("pointerdown", this._outsideHandler, true)
         }, 0)
      }
      this.element.innerHTML = this._renderHTML()
      this._positionPanel()
      this._bindListeners()
      if (isNew) {
         requestAnimationFrame(() => {
            this.element?.classList.add("sah-visible")
         })
      }
      return this
   }

   _bindListeners() {
      const root = this.element
      this._bindPanelDrag(root)
      root.querySelector(".sah-close")?.addEventListener("click", (event) => {
         event.preventDefault()
         event.stopPropagation()
         this.close()
      })
      root.querySelectorAll(".sah-slot").forEach((slot) => {
         slot.addEventListener("click", (event) => this._executeEntry(slot.dataset.entryId, event))
         slot.addEventListener("dragstart", (event) => {
            event.dataTransfer.setData("text/plain", slot.dataset.entryId)
         })
         slot.addEventListener("dragover", (event) => event.preventDefault())
         slot.addEventListener("drop", async (event) => {
            event.preventDefault()
            await this._moveEntry(
               event.dataTransfer.getData("text/plain"),
               slot.dataset.entryId,
            )
         })
      })
      root.querySelectorAll(".sah-remove").forEach((btn) => {
         btn.addEventListener("click", async (event) => {
            event.preventDefault()
            event.stopPropagation()
            await this._removeEntry(btn.dataset.entryId)
         })
      })
      root.querySelector(".sah-add-stub")?.addEventListener("click", async (event) => {
         event.preventDefault()
         event.stopPropagation()
         await this._openAddMenu()
      })
   }

   _positionPanel() {
      const layout = this._layout()
      const wrap = this.element?.querySelector(".sah-wrap")
      const addAllowance = wrap?.classList.contains("sah-has-add") ? 34 : 0
      const width = Math.max(
         90,
         wrap?.offsetWidth || this._estimatedWidth(),
      ) + addAllowance
      const height = Math.max(66, wrap?.offsetHeight || this._estimatedHeight())
      const fallback = {
         left: 20,
         top: Math.max(60, Math.round((window.innerHeight - height) / 2)),
      }
      const pos = this._clampPosition(layout.position || fallback, width, height)
      this._applyPosition(pos)
   }

   _estimatedWidth() {
      const slotCount = Math.max(1, Math.min(MAX_SLOTS, this._entries?.length || 1))
      return 18 + 16 + slotCount * 50 + Math.max(0, slotCount - 1) * 8
   }

   _estimatedHeight() {
      return 66
   }

   _applyPosition(pos) {
      if (!this.element) return
      this.element.style.setProperty("position", "fixed", "important")
      this.element.style.setProperty("left", `${pos.left}px`, "important")
      this.element.style.setProperty("top", `${pos.top}px`, "important")
      this.element.style.setProperty("right", "auto", "important")
      this.element.style.setProperty("bottom", "auto", "important")
      this.element.style.setProperty("width", "max-content", "important")
      this.element.style.setProperty("height", "auto", "important")
   }

   _clampPosition(pos, width, height) {
      const margin = 8
      return {
         left: Math.max(
            margin,
            Math.min(Math.round(pos.left), window.innerWidth - width - margin),
         ),
         top: Math.max(
            margin,
            Math.min(Math.round(pos.top), window.innerHeight - height - margin),
         ),
      }
   }

   _bindPanelDrag(root) {
      const stub = root.querySelector(".sah-drag-stub")
      if (!stub) return
      stub.addEventListener("pointerdown", (event) => {
         event.preventDefault()
         event.stopPropagation()
         const start = root.getBoundingClientRect()
         const origin = {
            x: event.clientX,
            y: event.clientY,
            left: start.left,
            top: start.top,
         }
         root.classList.add("sah-dragging")
         stub.setPointerCapture?.(event.pointerId)

         const move = (moveEvent) => {
            const rect = root.getBoundingClientRect()
            const next = this._clampPosition(
               {
                  left: origin.left + moveEvent.clientX - origin.x,
                  top: origin.top + moveEvent.clientY - origin.y,
               },
               rect.width,
               rect.height,
            )
            this._applyPosition(next)
         }
         const up = async () => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", up)
            root.classList.remove("sah-dragging")
            const rect = root.getBoundingClientRect()
            const layout = this._layout()
            layout.position = { left: Math.round(rect.left), top: Math.round(rect.top) }
            await this._saveLayout(layout)
         }
         window.addEventListener("pointermove", move)
         window.addEventListener("pointerup", up, { once: true })
      })
   }

   async _removeEntry(entryId) {
      const state = this._entryState()
      state.layout.order = state.layout.order.filter((id) => id !== entryId)
      if (!state.layout.hidden.includes(entryId)) state.layout.hidden.push(entryId)
      await this._saveLayout(state.layout)
      this.render()
   }

   async _addEntry(entryId) {
      const state = this._entryState()
      state.layout.hidden = state.layout.hidden.filter((id) => id !== entryId)
      state.layout.order = state.layout.order.filter((id) => id !== entryId)
      state.layout.order.push(entryId)
      await this._saveLayout(state.layout)
      this.render()
   }

   async _openAddMenu() {
      const entries = this._entryState().hiddenEntries
      if (entries.length === 0) return
      if (entries.length === 1) {
         await this._addEntry(entries[0].id)
         return
      }

      this._closeAddMenu()
      const menu = document.createElement("div")
      menu.className = "sah-add-menu"
      menu.innerHTML = entries
         .map(
            (entry) => `<button class="sah-add-menu-item" data-entry-id="${entry.id}">
               <img src="${entry.img}" alt="">
               <span>${entry.label}</span>
            </button>`,
         )
         .join("")
      this.element.appendChild(menu)
      menu.querySelectorAll(".sah-add-menu-item").forEach((btn) => {
         btn.addEventListener("click", async (event) => {
            event.preventDefault()
            event.stopPropagation()
            await this._addEntry(btn.dataset.entryId)
         })
      })
      this._menuOutsideHandler = (event) => {
         if (!this.element?.contains(event.target)) this._closeAddMenu()
      }
      window.setTimeout(
         () => document.addEventListener("pointerdown", this._menuOutsideHandler, true),
         0,
      )
   }

   _closeAddMenu() {
      this.element?.querySelector(".sah-add-menu")?.remove()
      if (this._menuOutsideHandler) {
         document.removeEventListener("pointerdown", this._menuOutsideHandler, true)
         this._menuOutsideHandler = null
      }
   }

   async _moveEntry(fromId, toId) {
      if (!fromId || !toId || fromId === toId) return
      const state = this._entryState()
      const order = state.visible.map((entry) => entry.id)
      const from = order.indexOf(fromId)
      const to = order.indexOf(toId)
      if (from < 0 || to < 0) return
      order.splice(to, 0, order.splice(from, 1)[0])
      const remaining = state.layout.order.filter((id) => !order.includes(id))
      state.layout.order = [...order, ...remaining]
      await this._saveLayout(state.layout)
      this.render()
   }

   _onKeyDown(event) {
      if (this._isTextInputEvent(event)) return
      if (event.code === "Escape") {
         event.preventDefault()
         event.stopPropagation()
         event.stopImmediatePropagation?.()
         this.close()
         return
      }
      const code = event.code || ""
      const index =
         code === "Digit0" || code === "Numpad0"
            ? 9
            : /^Digit[1-9]$/.test(code)
              ? Number(code.slice(5)) - 1
              : /^Numpad[1-9]$/.test(code)
                ? Number(code.slice(6)) - 1
                : null
      if (index === null) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      const entry = this._entries?.[index]
      if (entry) this._executeEntry(entry.id, new MouseEvent("click"))
   }

   _isTextInputEvent(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return true
      const target = event.target
      const active = document.activeElement
      const isEditable = (el) => {
         if (!el) return false
         const tag = el.tagName?.toLowerCase()
         return (
            tag === "input" ||
            tag === "textarea" ||
            tag === "select" ||
            el.isContentEditable ||
            !!el.closest?.("[contenteditable='true'], .prosemirror, .editor-content")
         )
      }
      return isEditable(target) || isEditable(active)
   }

   _onOutsidePointerDown(event) {
      if (!this.element || this.element.contains(event.target)) return
      this.close()
   }

   async _executeEntry(entryId, event = null) {
      if (!this._syncCrewman()) {
         ui.notifications.warn(tKey("Notifications.NotMountedOnSiege"))
         this.close()
         return
      }
      const entry = this._entryState().visible.find((e) => e.id === entryId)
      if (!entry) return
      if (entry.blocked) {
         ui.notifications.warn(entry.blockedReason || tKey("CrewHUD.NotLaunched"))
         return
      }
      if (entry.type === "ignition") {
         await VehicleLaunchManager.toggleLaunched(this.vehicle, this.crewman)
         this.render()
         return
      }
      const action = this.vehicle.items.get(entry.actionId)
      if (!action) return
      await executeActionItem({
         event,
         crewman: this.crewman,
         siege: this.vehicle,
         actionItem: action,
      })
      this.render()
   }

   close({ animate = true } = {}) {
      if (this._closing) {
         this.element?.remove()
         this.element = null
         if (this._closeTimer) window.clearTimeout(this._closeTimer)
         ActionsHotkeyPanel._open.delete(this.vehicle?.id)
         return
      }
      this._closing = true
      this._closeAddMenu()
      document.removeEventListener("keydown", this._keyHandler, true)
      document.removeEventListener("pointerdown", this._outsideHandler, true)
      ActionsHotkeyPanel._open.delete(this.vehicle?.id)
      const remove = () => {
         this.element?.remove()
         this.element = null
         this._closeTimer = null
      }
      if (!animate || !this.element) {
         remove()
         return
      }
      this.element.classList.remove("sah-visible")
      this.element.classList.add("sah-closing")
      if (this._closeTimer) window.clearTimeout(this._closeTimer)
      this._closeTimer = window.setTimeout(remove, 120)
   }
}
