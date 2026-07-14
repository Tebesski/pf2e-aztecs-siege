import { MODULE_ID } from "../../constants.mjs"
import { tKey, validImg } from "../../utils.mjs"
import { VehicleModulesManager } from "../../managers/modules.mjs"
import {
   DEFAULT_MODULE_SLOT_SIZE,
   MODULE_CANVAS_HEIGHT,
   MODULE_CANVAS_WIDTH,
   escapeHTML,
} from "./helpers.mjs"

class VehicleHUDModuleRenderMixin {
   _tabModules() {
      const board = VehicleModulesManager.moduleBoard(this.vehicle)
      const slotSize = this._moduleSlotSize(board)
      const actionSlots = this._moduleActionSlots(board)
      const storedSlots = board.slots
      const slotNodes = [
         ...storedSlots.map((slot) => ({
            id: slot.id,
            x: Number(slot.x) || 0,
            y: Number(slot.y) || 0,
            size: slotSize,
         })),
         ...actionSlots.map((slot) => ({
            id: slot.id,
            x: slot.x,
            y: slot.y,
            size: slot.size,
         })),
      ]
      const byId = new Map(slotNodes.map((node) => [node.id, node]))
      const lines = storedSlots
         .filter((slot) => slot.parentSlotId && byId.has(slot.parentSlotId) && byId.has(slot.id))
         .map((slot) => {
            const from = byId.get(slot.parentSlotId)
            const to = byId.get(slot.id)
            return `<line data-from="${escapeHTML(slot.parentSlotId)}" data-to="${escapeHTML(slot.id)}" x1="${from.x + from.size / 2}" y1="${from.y + from.size / 2}" x2="${to.x + to.size / 2}" y2="${to.y + to.size / 2}"></line>`
         })
         .join("")
      const decorativeNodes = (board.nodes || [])
         .filter((node) => byId.has(node.parentId))
         .map((node) => {
            const from = byId.get(node.parentId)
            const x1 = from.x + from.size / 2
            const y1 = from.y + from.size / 2
            const nodeX = Number(node.x)
            const nodeY = Number(node.y)
            const x2 = Number.isFinite(nodeX) ? nodeX : x1 + Math.max(120, from.size)
            const y2 = Number.isFinite(nodeY) ? nodeY : y1
            return `<g class="vh-module-node" data-node-id="${escapeHTML(node.id)}" data-parent-id="${escapeHTML(node.parentId)}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line><circle class="vh-module-node-handle" data-node-id="${escapeHTML(node.id)}" cx="${x2}" cy="${y2}" r="8"></circle></g>`
         })
         .join("")
      const bgStyle = this._moduleImageLayerStyle(board.background || {})
      const fgStyle = this._moduleImageLayerStyle(board.foreground || {})
      const transform = `translate(${this._moduleView.x}px, ${this._moduleView.y}px) scale(${this._moduleView.scale})`
      const slotsHTML = storedSlots.map((slot) => this._moduleSlotHTML(slot, board)).join("")
      const actionHTML = actionSlots.map((slot) => this._moduleActionSlotHTML(slot)).join("")
      return `<div class="vh-modules-board" data-action="module-board">
         <div class="vh-module-layer" style="transform:${transform};">
            <div class="vh-module-bg vh-module-bg-background" style="${bgStyle}"></div>
            <div class="vh-module-bg vh-module-bg-foreground" style="${fgStyle}"></div>
            <svg class="vh-module-lines" width="${MODULE_CANVAS_WIDTH}" height="${MODULE_CANVAS_HEIGHT}" viewBox="0 0 ${MODULE_CANVAS_WIDTH} ${MODULE_CANVAS_HEIGHT}">${lines}${decorativeNodes}</svg>
            ${slotsHTML}
            ${actionHTML}
         </div>
      </div>`
   }

   _moduleSlotSize(board = null) {
      const size = Number(board?.slotSize ?? DEFAULT_MODULE_SLOT_SIZE)
      return Number.isFinite(size) ? Math.max(24, Math.min(180, Math.round(size))) : DEFAULT_MODULE_SLOT_SIZE
   }

   _moduleImageLayerStyle(layer = {}) {
      const src = String(layer.src || "")
      if (!src) return ""
      const size = layer.size || "cover"
      const percent = (value) => {
         const number = Number(value)
         return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 50
      }
      const x = percent(layer.x ?? 50)
      const y = percent(layer.y ?? 50)
      return `background-image:url('${src.replace(/'/g, "%27")}');background-size:${escapeHTML(size)};background-position:${x}% ${y}%;background-repeat:no-repeat;`
   }

   _applyModuleImagePreview(background = {}, foreground = {}) {
      const bgEl = this.element?.querySelector?.(".vh-module-bg-background")
      if (bgEl) bgEl.style.cssText = this._moduleImageLayerStyle(background)
      const fgEl = this.element?.querySelector?.(".vh-module-bg-foreground")
      if (fgEl) fgEl.style.cssText = this._moduleImageLayerStyle(foreground)
   }

   _applyModuleSlotSizePreview(size) {
      const px = this._moduleSlotSize({ slotSize: size })
      const root = this.element
      if (!root) return
      root.querySelectorAll(".vh-module-slot").forEach((slotEl) => {
         slotEl.style.width = `${px}px`
         slotEl.style.height = `${px}px`
      })
      this._refreshModuleLines(root)
      this._syncClippedModuleTooltips(root)
   }

   _moduleActionSlots(board) {
      const slotSize = this._moduleSlotSize(board)
      const step = slotSize + 26
      const actions = this.vehicle.items.filter((item) => {
         const flag = item.getFlag(MODULE_ID, "siegeAction") || {}
         const hasComponentFlag = Object.prototype.hasOwnProperty.call(flag, "isComponent")
         const isComponent =
            flag.isComponent === true ||
            flag.isComponent === "true" ||
            flag.isComponent === 1 ||
            flag.isComponent === "1" ||
            (!hasComponentFlag && !!flag.componentType)
         return item.type === "action" && isComponent
      })
      return actions.map((action, index) => {
         const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
         const pos = board.actionPositions?.[action.id] || {
            x: 40 + (index % 6) * step,
            y: 260 + Math.floor(index / 6) * step,
         }
         return {
            id: `action:${action.id}`,
            actionId: action.id,
            action,
            moduleType: flag.componentType || "",
            x: Number(pos.x) || 0,
            y: Number(pos.y) || 0,
            size: slotSize,
         }
      })
   }

   _moduleSlotHTML(slot, board = null) {
      const size = this._moduleSlotSize(board)
      const item = slot.installedItemId ? this.vehicle.items.get(slot.installedItemId) : null
      const icon = item ? validImg(item.img, "icons/svg/item-bag.svg") : ""
      const rawLabel = slot.moduleType || tKey("Modules.UnassignedType")
      const rawName = item ? item.name : tKey("Modules.EmptySlot")
      const label = escapeHTML(rawLabel)
      const name = escapeHTML(rawName)
      return `<div class="vh-module-slot vh-module-slot-${slot.kind} ${item ? "installed" : ""}" data-slot-id="${slot.id}" data-module-type="${escapeHTML(slot.moduleType || "")}" data-installed-item-id="${item?.id || ""}" draggable="${item ? "true" : "false"}" style="left:${Number(slot.x) || 0}px;top:${Number(slot.y) || 0}px;width:${size}px;height:${size}px;">
         <div class="vh-module-slot-label" data-full-label="${label}">${label}</div>
         <div class="vh-module-slot-box">
            ${item ? `<img src="${icon}" alt="">` : `<i class="fa-solid fa-kaaba"></i>`}
         </div>
         <div class="vh-module-slot-name" data-full-label="${name}">${name}</div>
      </div>`
   }

   _moduleActionSlotHTML(slot) {
      const icon = validImg(slot.action.img, "icons/svg/d20.svg")
      const rawLabel = slot.moduleType || tKey("Modules.UnassignedType")
      const label = escapeHTML(rawLabel)
      const name = escapeHTML(slot.action.name)
      return `<div class="vh-module-slot vh-module-slot-action" data-action-id="${slot.actionId}" data-module-type="${escapeHTML(slot.moduleType || "")}" style="left:${slot.x}px;top:${slot.y}px;width:${slot.size}px;height:${slot.size}px;">
         <div class="vh-module-slot-label" data-full-label="${label}">${label}</div>
         <div class="vh-module-slot-box"><img src="${icon}" alt=""></div>
         <div class="vh-module-slot-name" data-full-label="${name}">${name}</div>
      </div>`
   }

   _syncClippedModuleTooltips(root = this.element) {
      if (!root) return
      const sync = () => {
         root.querySelectorAll(".vh-module-slot-label, .vh-module-slot-name").forEach((label) => {
            const full = label.dataset.fullLabel || label.textContent?.trim() || ""
            if (full && label.scrollWidth > label.clientWidth + 1) {
               label.dataset.tooltip = full
               label.dataset.tooltipDirection = "DOWN"
            } else {
               label.removeAttribute("data-tooltip")
               label.removeAttribute("data-tooltip-direction")
            }
         })
      }
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(sync)
      else sync()
   }

   _refreshModuleLines(root) {
      const nodes = new Map()
      root.querySelectorAll(".vh-module-slot").forEach((slotEl) => {
         const id = slotEl.dataset.slotId || (slotEl.dataset.actionId ? `action:${slotEl.dataset.actionId}` : "")
         if (!id) return
         const x = parseFloat(slotEl.style.left) || 0
         const y = parseFloat(slotEl.style.top) || 0
         const width = parseFloat(slotEl.style.width) || slotEl.offsetWidth || 0
         const height = parseFloat(slotEl.style.height) || slotEl.offsetHeight || 0
         nodes.set(id, { x, y, width, height })
      })
      root.querySelectorAll(".vh-module-lines line[data-from][data-to]").forEach((line) => {
         const from = nodes.get(line.dataset.from)
         const to = nodes.get(line.dataset.to)
         if (!from || !to) return
         line.setAttribute("x1", from.x + from.width / 2)
         line.setAttribute("y1", from.y + from.height / 2)
         line.setAttribute("x2", to.x + to.width / 2)
         line.setAttribute("y2", to.y + to.height / 2)
      })
      root.querySelectorAll(".vh-module-node[data-parent-id]").forEach((group) => {
         const from = nodes.get(group.dataset.parentId)
         if (!from) return
         const line = group.querySelector("line")
         const circle = group.querySelector(".vh-module-node-handle")
         if (!line || !circle) return
         const x2 = Number(circle.getAttribute("cx")) || 0
         const y2 = Number(circle.getAttribute("cy")) || 0
         line.setAttribute("x1", from.x + from.width / 2)
         line.setAttribute("y1", from.y + from.height / 2)
         line.setAttribute("x2", x2)
         line.setAttribute("y2", y2)
      })
   }


}

export const vehicleHudModuleRenderMethods = Object.fromEntries(
   Object.getOwnPropertyNames(VehicleHUDModuleRenderMixin.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => [name, VehicleHUDModuleRenderMixin.prototype[name]]),
)
