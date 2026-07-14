import { MODULE_ID } from "../../constants.mjs"
import { tKey } from "../../utils.mjs"
import { VehicleModulesManager } from "../../managers/modules.mjs"
import { SiegeSettings } from "../../managers/settings.mjs"
import {
   MODULE_CANVAS_HEIGHT,
   MODULE_CANVAS_WIDTH,
   escapeHTML,
} from "./helpers.mjs"

class VehicleHUDModuleMixin {
   async _saveModuleBoard(board) {
      await this.vehicle.setFlag(MODULE_ID, "moduleBoard", VehicleModulesManager.normalizeBoard(board))
      VehicleModulesManager.queueSync(this.vehicle)
   }

   _moduleBoardPoint(event) {
      const board = this.element.querySelector(".vh-modules-board")
      const rect = board.getBoundingClientRect()
      return {
         x: (event.clientX - rect.left - this._moduleView.x) / this._moduleView.scale,
         y: (event.clientY - rect.top - this._moduleView.y) / this._moduleView.scale,
      }
   }

   _clampModuleView(boardEl) {
      if (!boardEl) return
      const rect = boardEl.getBoundingClientRect()
      const scale = this._moduleView.scale
      const width = MODULE_CANVAS_WIDTH * scale
      const height = MODULE_CANVAS_HEIGHT * scale
      this._moduleView.x = width <= rect.width
         ? (rect.width - width) / 2
         : Math.min(0, Math.max(rect.width - width, this._moduleView.x))
      this._moduleView.y = height <= rect.height
         ? (rect.height - height) / 2
         : Math.min(0, Math.max(rect.height - height, this._moduleView.y))
   }

   _centerModuleView(boardEl) {
      if (!boardEl) return
      const rect = boardEl.getBoundingClientRect()
      this._moduleView.x = rect.width / 2 - (MODULE_CANVAS_WIDTH * this._moduleView.scale) / 2
      this._moduleView.y = rect.height / 2 - (MODULE_CANVAS_HEIGHT * this._moduleView.scale) / 2
      this._clampModuleView(boardEl)
   }

   async _promptModuleType(title) {
      const types = SiegeSettings.moduleTypes()
      if (!types.length) {
         ui.notifications.warn(tKey("Modules.NoModuleTypes"))
         return null
      }
      const options = types
         .map((type) => `<option value="${escapeHTML(type)}">${escapeHTML(type)}</option>`)
         .join("")
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog", "siege-module-type-dialog"],
         window: { title },
         position: { width: 360 },
         content: `<div class="form-group"><label>${tKey("Modules.InstallType")}</label><select id="siege-module-type-choice">${options}</select></div>`,
         buttons: [
            {
               action: "ok",
               label: tKey("Builder.Create"),
               default: true,
               callback: () => document.getElementById("siege-module-type-choice")?.value || null,
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel"), callback: () => null },
         ],
      }).catch(() => null)
      return types.includes(result) ? result : null
   }

   async _addVehicleModuleSlot(event) {
      const moduleType = await this._promptModuleType(tKey("Modules.AddVehicleModule"))
      if (!moduleType) return
      const point = this._moduleBoardPoint(event)
      const board = VehicleModulesManager.moduleBoard(this.vehicle)
      board.slots.push({
         id: foundry.utils.randomID(),
         kind: "vehicle",
         moduleType,
         x: Math.round(point.x),
         y: Math.round(point.y),
         parentSlotId: "",
         installedItemId: "",
      })
      await this._saveModuleBoard(board)
      this.render({ force: false })
   }

   async _addComponentModuleSlot(parentId, moduleType, x, y) {
      const board = VehicleModulesManager.moduleBoard(this.vehicle)
      const offset = this._moduleSlotSize(board) + 26
      board.slots.push({
         id: foundry.utils.randomID(),
         kind: "component",
         moduleType,
         x: Math.round(x + offset),
         y: Math.round(y + 12),
         parentSlotId: parentId,
         installedItemId: "",
      })
      await this._saveModuleBoard(board)
      this.render({ force: false })
   }

   async _addModuleNode(parentId, x, y, size) {
      if (!parentId) return
      const board = VehicleModulesManager.moduleBoard(this.vehicle)
      const centerX = Number(x) + Number(size) / 2
      const centerY = Number(y) + Number(size) / 2
      board.nodes = board.nodes || []
      board.nodes.push({
         id: foundry.utils.randomID(),
         parentId,
         x: Math.round(centerX + Math.max(120, Number(size) || this._moduleSlotSize(board))),
         y: Math.round(centerY),
      })
      await this._saveModuleBoard(board)
      this.render({ force: false })
   }

   _eligibleModulesForSlot(slot) {
      const installed = VehicleModulesManager.installedModuleIds(this.vehicle)
      return this.vehicle.items.filter((item) => {
         if (installed.has(item.id) && item.id !== slot.installedItemId) return false
         return VehicleModulesManager.isEligibleForSlot(this.vehicle, item, slot)
      })
   }

   async _chooseModuleForSlot(slot) {
      const modules = this._eligibleModulesForSlot(slot)
      if (!modules.length) {
         ui.notifications.warn(tKey("Modules.NoEligibleModules"))
         return null
      }
      const options = modules
         .map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`)
         .join("")
      return foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog", "siege-module-install-dialog"],
         window: { title: tKey("Modules.InstallModule") },
         content: `<div class="form-group"><label>${tKey("Modules.Module")}</label>
            <div class="vh-install-module-picker">
               <select id="siege-module-install-choice">${options}</select>
               <button type="button" class="vh-install-module-info" data-tooltip="${tKey("Modules.Inspect")}" data-tooltip-direction="UP"><i class="fa-solid fa-circle-info"></i></button>
            </div>
         </div>`,
         buttons: [
            {
               action: "install",
               label: tKey("Modules.Install"),
               default: true,
               callback: () => document.getElementById("siege-module-install-choice")?.value || null,
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel") },
         ],
         render: (_event, dialog) => {
            const root = dialog?.element || document
            root.querySelector(".vh-install-module-info")?.addEventListener("click", async (event) => {
               event.preventDefault()
               event.stopPropagation()
               const itemId = root.querySelector("#siege-module-install-choice")?.value
               const item = modules.find((moduleItem) => moduleItem.id === itemId)
               await this._inspectModule(item)
            })
         },
      }).catch(() => null)
   }

   async _resolveModuleReference(itemRef) {
      if (!itemRef) return null
      const local = this.vehicle.items.get(itemRef)
      if (local) return local
      const world = game.items.get(itemRef)
      if (world) return world
      return await fromUuid(itemRef).catch(() => null)
   }

   async _installModule(slotId, itemId = null) {
      const board = VehicleModulesManager.moduleBoard(this.vehicle)
      const slot = board.slots.find((s) => s.id === slotId)
      if (!slot) return
      const chosenRef = itemId || await this._chooseModuleForSlot(slot)
      if (!chosenRef) return
      const item = await this._resolveModuleReference(chosenRef)
      if (!item || !VehicleModulesManager.isEligibleForSlot(this.vehicle, item, slot)) {
         ui.notifications.warn(tKey("Modules.NotEligible"))
         return
      }
      if (!(await this._passModuleCraftingCheck(item))) return
      const { SiegeSocketManager } = await import("../../managers/sockets.mjs")
      const ok = await SiegeSocketManager.installModule(
         this.vehicle.id,
         slot.id,
         item.uuid || item.id,
         game.user.id,
      )
      if (!ok) ui.notifications.warn(tKey("Modules.NotEligible"))
      this.render({ force: false })
   }

   async _deinstallModule(slotId) {
      const { SiegeSocketManager } = await import("../../managers/sockets.mjs")
      await SiegeSocketManager.deinstallModule(
         this.vehicle.id,
         slotId,
         game.user.id,
      )
      this.render({ force: false })
   }

   async _removeModuleSlot(slotId) {
      const board = VehicleModulesManager.moduleBoard(this.vehicle)
      board.slots = board.slots.filter((slot) => slot.id !== slotId)
      await this._saveModuleBoard(board)
      this.render({ force: false })
   }

   async _passModuleCraftingCheck(item) {
      const flags = item.getFlag(MODULE_ID, "vehicleModule") || {}
      const dc = Number(flags.craftingDC) || 0
      if (dc <= 0) return true
      const crewman = this._currentCrewman() || game.user.character
      if (!crewman?.skills?.crafting && !crewman?.system?.skills?.crafting) {
         ui.notifications.warn(tKey("Notifications.MissingCraftingSkill"))
         return false
      }
      const proceed = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Modules.CraftingCheckTitle") },
         content: `<p>${tKey("Modules.CraftingCheckPrompt", { name: item.name, dc })}</p>`,
         buttons: [
            {
               action: "roll",
               label: tKey("Modules.RollCrafting"),
               icon: "fa-solid fa-dice-d20",
               default: true,
               callback: () => true,
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel") },
         ],
      }).catch(() => false)
      if (!proceed) return false
      const stat = crewman.skills?.crafting || crewman.system?.skills?.crafting || {}
      const mod = Number(stat.mod ?? stat.totalModifier ?? stat.value ?? 0) || 0
      const roll = await new Roll("1d20 + @mod", { mod }).evaluate()
      await roll.toMessage({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         flavor: tKey("Modules.CraftingCheckChat", { name: item.name, dc }),
      })
      if (roll.total >= dc) return true
      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: `<p>${tKey("Modules.InstallFailed", { name: item.name, dc, total: roll.total })}</p>`,
      })
      ui.notifications.warn(tKey("Modules.InstallFailed", { name: item.name, dc, total: roll.total }))
      return false
   }

   async _configureModuleBackground() {
      const board = VehicleModulesManager.moduleBoard(this.vehicle)
      const clampPercent = (value) => {
         const number = Number(value)
         return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 50
      }
      const clampLayer = (layer = {}) => ({
         src: layer.src || "",
         size: layer.size || "cover",
         x: clampPercent(layer.x ?? 50),
         y: clampPercent(layer.y ?? 50),
      })
      const background = clampLayer(board.background)
      const foreground = clampLayer(board.foreground)
      const slotSize = this._moduleSlotSize(board)
      const sizeOptions = [
         { value: "cover", label: "Cover" },
         { value: "contain", label: "Contain" },
         { value: "auto", label: "Auto" },
         { value: "100% 100%", label: "Stretch" },
      ]
      const layerFields = (kind, label, layer) => `<fieldset class="siege-module-bg-layer">
            <legend>${label}</legend>
            <div class="form-group siege-module-bg-image-row"><label>${tKey("Modules.Image")}</label><div class="siege-module-bg-image-control"><input type="text" id="siege-module-${kind}-src" value="${escapeHTML(layer.src || "")}"><button type="button" class="siege-module-bg-picker" data-layer="${kind}" data-tooltip="${tKey("Modules.ChooseImage")}"><i class="fa-solid fa-file-image"></i></button></div></div>
            <div class="form-group"><label>${tKey("Modules.ImageSize")}</label><select id="siege-module-${kind}-size">
               ${sizeOptions.map((option) => `<option value="${option.value}" ${option.value === layer.size ? "selected" : ""}>${option.label}</option>`).join("")}
            </select></div>
            <div class="form-group"><label>${tKey("Modules.ImagePositionX")}</label><input type="range" id="siege-module-${kind}-x" min="0" max="100" step="1" value="${layer.x}"></div>
            <div class="form-group"><label>${tKey("Modules.ImagePositionY")}</label><input type="range" id="siege-module-${kind}-y" min="0" max="100" step="1" value="${layer.y}"></div>
         </fieldset>`
      const readLayer = (kind) => ({
         src: document.getElementById(`siege-module-${kind}-src`)?.value || "",
         size: document.getElementById(`siege-module-${kind}-size`)?.value || "cover",
         x: Number(document.getElementById(`siege-module-${kind}-x`)?.value ?? 50),
         y: Number(document.getElementById(`siege-module-${kind}-y`)?.value ?? 50),
      })
      const preview = () => {
         const nextSize = Number(document.getElementById("siege-module-slot-size")?.value ?? slotSize)
         this._applyModuleImagePreview(readLayer("background"), readLayer("foreground"))
         this._applyModuleSlotSizePreview(nextSize)
      }
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Modules.ConfigureBackground") },
         position: { width: 500 },
         content: `<div class="siege-module-bg-config">
            ${layerFields("background", tKey("Modules.BackgroundImage"), background)}
            ${layerFields("foreground", tKey("Modules.ForegroundImage"), foreground)}
            <div class="form-group"><label>${tKey("Modules.SlotSize")}</label><input type="number" class="siege-module-slot-size-input" id="siege-module-slot-size" min="24" max="180" step="1" value="${slotSize}"></div>
         </div>`,
         buttons: [
            {
               action: "save",
               label: tKey("Modules.Save"),
               default: true,
               callback: () => ({
                  background: readLayer("background"),
                  foreground: readLayer("foreground"),
                  slotSize: Number(document.getElementById("siege-module-slot-size")?.value ?? slotSize),
               }),
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel"), callback: () => null },
         ],
         render: () => {
            const ids = [
               "siege-module-background-src",
               "siege-module-background-size",
               "siege-module-background-x",
               "siege-module-background-y",
               "siege-module-foreground-src",
               "siege-module-foreground-size",
               "siege-module-foreground-x",
               "siege-module-foreground-y",
               "siege-module-slot-size",
            ]
            for (const id of ids) {
               const el = document.getElementById(id)
               el?.addEventListener("input", preview)
               el?.addEventListener("change", preview)
            }
            document.querySelectorAll(".siege-module-bg-picker").forEach((button) => button.addEventListener("click", () => {
               const layer = button.dataset.layer || "foreground"
               const FP = foundry.applications?.apps?.FilePicker?.implementation || globalThis.FilePicker
               if (!FP) return
               new FP({
                  type: "image",
                  current: document.getElementById(`siege-module-${layer}-src`)?.value || "",
                  callback: (path) => {
                     const input = document.getElementById(`siege-module-${layer}-src`)
                     if (input) input.value = path
                     preview()
                  },
               }).render(true)
            }))
            preview()
         },
      }).catch(() => null)
      if (!result || typeof result !== "object") {
         this._applyModuleImagePreview(background, foreground)
         this._applyModuleSlotSizePreview(slotSize)
         return
      }
      board.imageLayersVersion = 2
      board.background = clampLayer(result.background)
      board.foreground = clampLayer(result.foreground)
      board.slotSize = this._moduleSlotSize({ slotSize: result.slotSize })
      await this._saveModuleBoard(board)
      this.render({ force: false })
   }

   _showModuleContext(event, items) {
      document.querySelector(".vh-module-context")?.remove()
      const menu = document.createElement("div")
      menu.className = "vh-module-context"
      menu.style.left = `${event.clientX}px`
      menu.style.top = `${event.clientY}px`
      menu.innerHTML = items
         .map((item, index) => `<button type="button" data-index="${index}">${item.label}</button>`)
         .join("")
      document.body.append(menu)
      menu.querySelectorAll("button").forEach((button) => {
         button.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const item = items[Number(button.dataset.index)]
            menu.remove()
            await item.action()
         })
      })
      setTimeout(() => {
         const close = () => menu.remove()
         document.addEventListener("click", close, { once: true })
         document.addEventListener("contextmenu", close, { once: true })
      }, 0)
   }

   _readDropData(event) {
      const helper = foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData
      try {
         const data = helper?.(event)
         if (data) return data
      } catch {
         
      }
      const tryParse = (raw) => {
         if (!raw) return null
         try {
            return JSON.parse(raw)
         } catch {
            return null
         }
      }
      return (
         tryParse(event.dataTransfer.getData("application/json")) ||
         tryParse(event.dataTransfer.getData("text/json")) ||
         tryParse(event.dataTransfer.getData("text/plain"))
      )
   }

   async _resolveDroppedItem(data) {
      if (!data || data.type !== "Item") return null
      if (data.uuid || data.documentUuid)
         return fromUuid(data.uuid || data.documentUuid)
      if (data.id) {
         const worldItem = game.items.get(data.id)
         if (worldItem) return worldItem
         const actor = data.actorId ? game.actors.get(data.actorId) : null
         if (actor) return actor.items.get(data.id) || null
      }
      return null
   }

   _bindModuleBoard(root) {
      const boardEl = root.querySelector(".vh-modules-board")
      const layer = root.querySelector(".vh-module-layer")
      if (!boardEl || !layer) return
      const applyView = () => {
         layer.style.transform = `translate(${this._moduleView.x}px, ${this._moduleView.y}px) scale(${this._moduleView.scale})`
      }
      this._clampModuleView(boardEl)
      applyView()
      boardEl.addEventListener("wheel", (event) => {
         event.preventDefault()
         const rect = boardEl.getBoundingClientRect()
         const before = {
            x: (event.clientX - rect.left - this._moduleView.x) / this._moduleView.scale,
            y: (event.clientY - rect.top - this._moduleView.y) / this._moduleView.scale,
         }
         const factor = event.deltaY < 0 ? 1.1 : 0.9
         this._moduleView.scale = Math.max(0.35, Math.min(2.6, this._moduleView.scale * factor))
         this._moduleView.x = event.clientX - rect.left - before.x * this._moduleView.scale
         this._moduleView.y = event.clientY - rect.top - before.y * this._moduleView.scale
         this._clampModuleView(boardEl)
         applyView()
         this._saveModuleView()
      }, { passive: false })
      boardEl.addEventListener("dblclick", (event) => {
         if (event.button !== 0 || event.target.closest(".vh-module-slot")) return
         event.preventDefault()
         this._centerModuleView(boardEl)
         applyView()
         this._saveModuleView()
      })
      boardEl.addEventListener("mousedown", (event) => {
         if (event.button !== 0 || event.target.closest(".vh-module-slot")) return
         event.preventDefault()
         const start = { x: event.clientX, y: event.clientY, vx: this._moduleView.x, vy: this._moduleView.y }
         const move = (ev) => {
            this._moduleView.x = start.vx + ev.clientX - start.x
            this._moduleView.y = start.vy + ev.clientY - start.y
            this._clampModuleView(boardEl)
            applyView()
         }
         const up = () => {
            window.removeEventListener("mousemove", move)
            window.removeEventListener("mouseup", up)
            this._saveModuleView()
         }
         window.addEventListener("mousemove", move)
         window.addEventListener("mouseup", up)
      })
      if (game.user.isGM) {
         boardEl.addEventListener("contextmenu", (event) => {
            if (event.target.closest(".vh-module-slot")) return
            event.preventDefault()
            this._showModuleContext(event, [
               { label: tKey("Modules.AddVehicleModule"), action: () => this._addVehicleModuleSlot(event) },
               { label: tKey("Modules.ConfigureBackground"), action: () => this._configureModuleBackground() },
            ])
         })
         root.querySelectorAll(".vh-module-node-handle").forEach((handle) => {
            handle.addEventListener("mousedown", (event) => {
               if (event.button !== 0) return
               event.preventDefault()
               event.stopPropagation()
               const nodeId = handle.dataset.nodeId
               const group = handle.closest(".vh-module-node")
               const line = group?.querySelector("line")
               const start = {
                  clientX: event.clientX,
                  clientY: event.clientY,
                  x: Number(handle.getAttribute("cx")) || 0,
                  y: Number(handle.getAttribute("cy")) || 0,
               }
               const move = (ev) => {
                  const x = start.x + (ev.clientX - start.clientX) / this._moduleView.scale
                  const y = start.y + (ev.clientY - start.clientY) / this._moduleView.scale
                  handle.setAttribute("cx", Math.round(x))
                  handle.setAttribute("cy", Math.round(y))
                  if (line) {
                     line.setAttribute("x2", Math.round(x))
                     line.setAttribute("y2", Math.round(y))
                  }
               }
               const up = async () => {
                  window.removeEventListener("mousemove", move)
                  window.removeEventListener("mouseup", up)
                  const board = VehicleModulesManager.moduleBoard(this.vehicle)
                  const node = (board.nodes || []).find((n) => n.id === nodeId)
                  if (!node) return
                  node.x = Math.round(Number(handle.getAttribute("cx")) || 0)
                  node.y = Math.round(Number(handle.getAttribute("cy")) || 0)
                  await this._saveModuleBoard(board)
               }
               window.addEventListener("mousemove", move)
               window.addEventListener("mouseup", up)
            })
         })
      }
      root.querySelectorAll(".vh-module-slot").forEach((slotEl) => {
         const startDrag = (event) => {
            if (event.button !== 0) return
            event.preventDefault()
            const board = VehicleModulesManager.moduleBoard(this.vehicle)
            const isAction = !!slotEl.dataset.actionId
            const slot = isAction
               ? null
               : board.slots.find((s) => s.id === slotEl.dataset.slotId)
            const actionId = slotEl.dataset.actionId
            const left = parseFloat(slotEl.style.left) || 0
            const top = parseFloat(slotEl.style.top) || 0
            const start = { x: event.clientX, y: event.clientY, left, top }
            const move = (ev) => {
               const x = start.left + (ev.clientX - start.x) / this._moduleView.scale
               const y = start.top + (ev.clientY - start.y) / this._moduleView.scale
               slotEl.style.left = `${Math.round(x)}px`
               slotEl.style.top = `${Math.round(y)}px`
               this._refreshModuleLines(root)
            }
            const up = async () => {
               window.removeEventListener("mousemove", move)
               window.removeEventListener("mouseup", up)
               const x = Math.round(parseFloat(slotEl.style.left) || 0)
               const y = Math.round(parseFloat(slotEl.style.top) || 0)
               if (isAction) {
                  board.actionPositions = board.actionPositions || {}
                  board.actionPositions[actionId] = { x, y }
               } else if (slot) {
                  slot.x = x
                  slot.y = y
               }
               await this._saveModuleBoard(board)
            }
            window.addEventListener("mousemove", move)
            window.addEventListener("mouseup", up)
         }
         if (game.user.isGM) slotEl.addEventListener("mousedown", startDrag)
         slotEl.addEventListener("dragstart", (event) => {
            if (!slotEl.dataset.slotId || !slotEl.dataset.installedItemId) return
            const payload = {
               type: "siegeInstalledModule",
               vehicleId: this.vehicle.id,
               slotId: slotEl.dataset.slotId,
               itemId: slotEl.dataset.installedItemId,
            }
            event.dataTransfer.setData("text/plain", JSON.stringify(payload))
            event.dataTransfer.setData("application/json", JSON.stringify(payload))
            event.dataTransfer.effectAllowed = "move"
         })
         slotEl.addEventListener("contextmenu", (event) => {
            event.preventDefault()
            event.stopPropagation()
            const board = VehicleModulesManager.moduleBoard(this.vehicle)
            const isAction = !!slotEl.dataset.actionId
            const slot = isAction ? null : board.slots.find((s) => s.id === slotEl.dataset.slotId)
            const moduleType = slotEl.dataset.moduleType || slot?.moduleType || ""
            const parentId = isAction ? `action:${slotEl.dataset.actionId}` : slot?.id
            const x = parseFloat(slotEl.style.left) || 0
            const y = parseFloat(slotEl.style.top) || 0
            const size = parseFloat(slotEl.style.width) || this._moduleSlotSize(board)
            const items = []
            const installedItem = slot?.installedItemId
               ? this.vehicle.items.get(slot.installedItemId)
               : null
            if (installedItem)
               items.push({ label: tKey("Modules.Inspect"), action: () => this._inspectModule(installedItem) })
            if (slot) {
               if (slot.installedItemId)
                  items.push({ label: tKey("Modules.Deinstall"), action: () => this._deinstallModule(slot.id) })
               else
                  items.push({ label: tKey("Modules.InstallModule"), action: () => this._installModule(slot.id) })
            }
            if (game.user.isGM && parentId)
               items.push({ label: tKey("Modules.AddComponentModule"), action: () => this._addComponentModuleSlot(parentId, moduleType, x, y) })
            if (game.user.isGM && parentId)
               items.push({ label: tKey("Modules.AddNode"), action: () => this._addModuleNode(parentId, x, y, size) })
            if (game.user.isGM && slot && !slot.installedItemId)
               items.push({ label: tKey("Modules.RemoveSlot"), action: () => this._removeModuleSlot(slot.id) })
            if (items.length) this._showModuleContext(event, items)
         })
         if (!slotEl.dataset.slotId) return
         slotEl.addEventListener("dragover", (event) => {
            event.preventDefault()
            slotEl.classList.add("dragover")
         })
         slotEl.addEventListener("dragleave", () => slotEl.classList.remove("dragover"))
         slotEl.addEventListener("drop", async (event) => {
            event.preventDefault()
            event.stopPropagation()
            slotEl.classList.remove("dragover")
            const data = this._readDropData(event)
            if (data?.type === "siegeInstalledModule") {
               if (data.vehicleId !== this.vehicle.id || data.slotId === slotEl.dataset.slotId) return
               const board = VehicleModulesManager.moduleBoard(this.vehicle)
               const slot = board.slots.find((s) => s.id === slotEl.dataset.slotId)
               if (!slot) return
               if (slot.installedItemId) return
               await this._deinstallModule(data.slotId)
               await this._installModule(slotEl.dataset.slotId, data.itemId)
               return
            }
            const item = await this._resolveDroppedItem(data)
            if (!item) return
            const board = VehicleModulesManager.moduleBoard(this.vehicle)
            const slot = board.slots.find((s) => s.id === slotEl.dataset.slotId)
            if (!slot) return
            if (slot.installedItemId) return
            if (!VehicleModulesManager.isEligibleForSlot(this.vehicle, item, slot)) {
               ui.notifications.warn(tKey("Modules.NotEligible"))
               return
            }
            await this._installModule(slotEl.dataset.slotId, item.uuid || item.id)
         })
      })
   }

}

export const vehicleHudModuleMethods = Object.fromEntries(
   Object.getOwnPropertyNames(VehicleHUDModuleMixin.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => [name, VehicleHUDModuleMixin.prototype[name]]),
)
