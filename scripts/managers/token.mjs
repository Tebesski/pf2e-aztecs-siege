import { MODULE_ID } from "../constants.mjs"
import { isSiege, tKey } from "../utils.mjs"
import { SiegeMacros } from "../macros/index.mjs"
import { SiegeCrewManager } from "./crew.mjs"
import { VehicleEntryManager } from "./entry.mjs"
import { VehicleLoadManager } from "./vehicle-load.mjs"

export class SiegeTokenManager {
   static initHooks() {
      Hooks.once("setup", () => this.onSetup())

      
      
      
      
      Hooks.on("preUpdateToken", (tokenDoc, changes, options) => {
         if (
            options.siegeSyncMovement ||
            options.siegeEntering ||
            options.siegeExiting
         )
            return
         const actor = tokenDoc.actor
         if (!actor) return

         
         if (
            VehicleEntryManager.isEntered(actor) &&
            (changes.x !== undefined || changes.y !== undefined)
         ) {
            delete changes.x
            delete changes.y
         }

         
         
         
         if (VehicleEntryManager.isEntered(actor)) {
            if (changes.width !== undefined && changes.width > 0.5)
               delete changes.width
            if (changes.height !== undefined && changes.height > 0.5)
               delete changes.height
            if (changes.alpha !== undefined && changes.alpha > 0)
               delete changes.alpha
            if (Object.keys(changes).length === 0) return false
            return
         }

         
         
         
         if (actor.type === "vehicle" && !game.user.isGM) {
            const owns = actor.testUserPermission(game.user, "OWNER")
            const wantsMove =
               (changes.x !== undefined && changes.x !== tokenDoc.x) ||
               (changes.y !== undefined && changes.y !== tokenDoc.y)
            const wantsRotate =
               changes.rotation !== undefined &&
               changes.rotation !== tokenDoc.rotation
            if (!wantsMove && !wantsRotate) return
            if (wantsMove && VehicleLoadManager.isAtMax(actor)) {
               ui.notifications.warn(tKey("VehicleLoad.MaxBulkMoveBlocked"))
               return false
            }
            if (owns) return
            const canDrive = VehicleEntryManager.canUserDrive(game.user, actor)
            const canRotate = VehicleEntryManager.canUserRotate(game.user, actor)

            const change = {}
            if (wantsMove && canDrive) {
               if (changes.x !== undefined) change.x = changes.x
               if (changes.y !== undefined) change.y = changes.y
            }
            if (wantsRotate && canRotate) change.rotation = changes.rotation

            if (Object.keys(change).length > 0) {
               import("../managers/sockets.mjs").then((m) =>
                  m.SiegeSocketManager.moveVehicleByRole(
                     tokenDoc.uuid,
                     change,
                  ),
               )
            } else {
               
               ui.notifications.warn(tKey("Enter.Notifications.NoControl"))
            }
            
            return false
         }
      })

      
      Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
         if (game.user.id !== userId || options.siegeSyncMovement) return
         const actor = tokenDoc.actor
         if (!actor || actor.type !== "vehicle") return
         if (!VehicleEntryManager.isEnterable(actor)) return
         const movedXY = changes.x !== undefined || changes.y !== undefined
         if (!movedXY) return
         const dx = (changes.x ?? tokenDoc.x) - tokenDoc.x
         const dy = (changes.y ?? tokenDoc.y) - tokenDoc.y
         if (dx === 0 && dy === 0) return
         if (!game.user.isGM) return
         const updates = []
         for (const t of canvas.tokens.placeables) {
            const a = t.actor
            if (!a) continue
            const entered = a.itemTypes.effect.some(
               (e) =>
                  e.getFlag(MODULE_ID, "isEntered") &&
                  e.getFlag(MODULE_ID, "siegeId") === actor.id,
            )
            if (!entered || t.document.id === tokenDoc.id) continue
            updates.push({
               _id: t.document.id,
               x: t.document.x + dx,
               y: t.document.y + dy,
            })
         }
         if (updates.length > 0)
            canvas.scene.updateEmbeddedDocuments("Token", updates, {
               siegeSyncMovement: true,
            })
      })

      
      const reshrinking = new WeakSet()
      const sequencerDeletedTokens = new Set()
      const sequencerTokenKey = (token) =>
         token?.document?.uuid || token?.document?.id || token?.id || null
      const isParkedEnteredToken = (token, actor) => {
         if (VehicleEntryManager.isEntered(actor)) return true
         if (token?.document?.getFlag?.(MODULE_ID, "enteredHidden") === true)
            return true
         return false
      }
      const sequencerQueriesFor = (token) => {
         const doc = token?.document
         if (!doc) return []
         const sceneId = doc.parent?.id || canvas?.scene?.id || game.user?.viewedScene
         return [
            { object: doc, sceneId },
            { source: doc, sceneId },
            { target: doc, sceneId },
            { origin: doc.uuid, sceneId },
         ].filter((query) => query.sceneId)
      }
      const sequencerEffectsFor = (token) => {
         const manager = globalThis.Sequencer?.EffectManager
         if (!manager?.getEffects || !token?.document) return []
         const seen = new Set()
         const found = []
         for (const query of sequencerQueriesFor(token)) {
            let matches = []
            try {
               matches = manager.getEffects(query) || []
            } catch (_e) {
               matches = []
            }
            for (const effect of matches) {
               if (!effect || seen.has(effect)) continue
               seen.add(effect)
               found.push(effect)
            }
         }
         return found
      }
      const deleteSequencerEffects = (token, reason = "entered") => {
         const manager = globalThis.Sequencer?.EffectManager
         if (!manager || !token?.document) return
         const effects = sequencerEffectsFor(token)
         console.debug(
            `[siege][sequencer] deleting effects token=${token.document.uuid} actor=${token.actor?.name} reason=${reason} count=${effects.length}`,
         )
         if (effects.length === 0) return
         try {
            Promise.resolve(manager.endEffects?.({ effects })).catch((err) =>
               console.debug("[siege][sequencer] endEffects failed", {
                  token: token.document.uuid,
                  reason,
                  err,
               }),
            )
         } catch (err) {
            console.debug("[siege][sequencer] endEffects failed", {
               token: token.document.uuid,
               reason,
               err,
            })
         }

         for (const effect of effects) {
            try {
               if (!manager.endEffects) effect.end?.()
            } catch (err) {
               console.debug("[siege][sequencer] direct effect end failed", {
                  effect,
                  err,
               })
            }
         }
      }
      const hideEnteredDecorations = (token, allowReshrink = false) => {
         try {
            const actor = token?.document?.actor
            if (!actor) return
            const seqKey = sequencerTokenKey(token)
            if (!isParkedEnteredToken(token, actor)) {
               if (seqKey) sequencerDeletedTokens.delete(seqKey)
               return
            }
            if (token.effects) token.effects.visible = false
            if (token.nameplate) token.nameplate.visible = false
            if (token.border) token.border.visible = false
            if (token.ring) token.ring.visible = false
            if (seqKey && !sequencerDeletedTokens.has(seqKey)) {
               sequencerDeletedTokens.add(seqKey)
               deleteSequencerEffects(token)
            }
            
            if (token.turnMarker) {
               if (token.turnMarker.visible !== undefined)
                  token.turnMarker.visible = false
               if (token.turnMarker.renderable !== undefined)
                  token.turnMarker.renderable = false
            }
            
            
            try {
               const auras = token.auras
               if (auras) {
                  if (auras.visible !== undefined) auras.visible = false
                  if (typeof auras.forEach === "function")
                     auras.forEach((a) => {
                        if (a) a.visible = false
                     })
                  if (auras.children)
                     auras.children.forEach((c) => (c.visible = false))
               }
            } catch (e) {
               
            }
            token.interactionState = 0
            if (token.mesh) token.mesh.alpha = 0
            
            if (
               allowReshrink &&
               token.document.width > 0.5 &&
               !reshrinking.has(token) &&
               game.user.isGM
            ) {
               reshrinking.add(token)
               token.document
                  .update(
                     { width: 0.2, height: 0.2, alpha: 0 },
                     { siegeEntering: true },
                  )
                  .finally(() => reshrinking.delete(token))
            }
         } catch (e) {
            
         }
      }
      Hooks.on("drawToken", (token) => hideEnteredDecorations(token, true))
      Hooks.on("refreshToken", (token) => hideEnteredDecorations(token, false))

      
      
      
      Hooks.on("dropActorSheetData", (actor, sheet, data) => {
         if (!data?.siegeStashMove) return true
         SiegeTokenManager._handleStashDropToActor(actor, data)
         return false 
      })
      Hooks.on("dropCanvasData", (canvasObj, data) => {
         if (!data?.siegeStashMove) return true
         SiegeTokenManager._handleStashDropToCanvas(data)
         return false
      })
      Hooks.on("deleteToken", (tokenDoc) => {
         if (!game.user.isGM) return
         const actor = tokenDoc.actor
         if (!actor?.getFlag?.(MODULE_ID, "isGroundStash")) return
         this._deleteGroundStashActor(actor)
      })
      Hooks.on("deleteItem", (item) => {
         if (!game.user.isGM) return
         const actor = item.parent
         if (!actor?.getFlag?.(MODULE_ID, "isGroundStash")) return
         const remaining = actor.items.filter((i) => i.id !== item.id)
         if (remaining.length === 0) this._deleteGroundStashActor(actor)
      })

      
      
      Hooks.on("renderTokenHUD", (hud, html, data) => {
         if (!game.user.isGM) return
         const actor = hud.object?.document?.actor
         if (!actor || actor.type !== "vehicle") return
         if (!actor.getFlag(MODULE_ID, "enterable") && !isSiege(actor)) return

         const root = html instanceof HTMLElement ? html : html?.[0]
         if (!root) return
         
         const col =
            root.querySelector(".col.left") ||
            root.querySelector(".left") ||
            root.querySelector(".col.middle") ||
            root.querySelector("[data-palette='left']")
         if (!col) return
         if (col.querySelector(".siege-crew-hud-toggle")) return

         
         
         const sample = col.querySelector("button.control-icon, .control-icon")
         const tag = sample && sample.tagName === "BUTTON" ? "button" : "div"
         const btn = document.createElement(tag)
         if (tag === "button") btn.type = "button"
         btn.classList.add("control-icon", "siege-crew-hud-toggle")
         btn.setAttribute("data-tooltip", tKey("CrewHUD.OpenTooltip"))
         btn.innerHTML = '<i class="fa-solid fa-steering-wheel"></i>'
         btn.addEventListener("click", async () => {
            const { CrewHUD } = await import("../ui/crew-hud.mjs")
            CrewHUD.open(actor)
         })
         col.appendChild(btn)
      })

      Hooks.on("preUpdateToken", (tokenDoc, changes, options) => {
         if (changes.x === undefined && changes.y === undefined) return
         const actor = tokenDoc.actor
         if (!actor) return

         const liftingEffect = actor.itemTypes.effect.find(
            (e) =>
               e.getFlag(MODULE_ID, "isLiftingEffect") &&
               e.system.badge?.value > 0,
         )
         if (!liftingEffect) return

         const siegeId = liftingEffect.getFlag(MODULE_ID, "siegeId")
         const siege = game.actors.get(siegeId)
         if (!siege || !siege.system.traits?.value?.includes("portable")) return

         const isLeader = actor.itemTypes.effect.some(
            (e) =>
               e.getFlag(MODULE_ID, "isCrewLeader") &&
               e.getFlag(MODULE_ID, "siegeId") === siegeId,
         )

         if (!isLeader && !options.siegeSyncMovement) {
            ui.notifications.warn(tKey("Notifications.OnlyLeaderCanMove"))
            delete changes.x
            delete changes.y
            return
         }

         if (isLeader && !options.siegeSyncMovement) {
            const dx =
               (changes.x !== undefined ? changes.x : tokenDoc.x) - tokenDoc.x
            const dy =
               (changes.y !== undefined ? changes.y : tokenDoc.y) - tokenDoc.y
            options.leaderMovedSiege = { siegeId, dx, dy }
         }
      })

      Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
         if (game.user.id !== userId) return

         if (options.leaderMovedSiege) {
            const { siegeId, dx, dy } = options.leaderMovedSiege
            import("../managers/sockets.mjs").then((m) =>
               m.SiegeSocketManager.moveSiegeAndCrew(
                  siegeId,
                  dx,
                  dy,
                  tokenDoc.id,
               ),
            )
         }

         const actor = tokenDoc.actor
         if (
            actor &&
            actor.type === "vehicle" &&
            actor.getFlag(MODULE_ID, "isSiegeWeapon") &&
            actor.system.traits?.value?.includes("portable") &&
            !options.siegeSyncMovement
         ) {
            const dx =
               (changes.x !== undefined ? changes.x : tokenDoc.x) - tokenDoc.x
            const dy =
               (changes.y !== undefined ? changes.y : tokenDoc.y) - tokenDoc.y
            if (dx !== 0 || dy !== 0) {
               import("../managers/sockets.mjs").then((m) =>
                  m.SiegeSocketManager.moveSiegeAndCrew(
                     actor.id,
                     dx,
                     dy,
                     tokenDoc.id,
                  ),
               )
            }
         }
      })
   }

   static onSetup() {
      const TokenClass = CONFIG.Token.objectClass || Token

      const originalCanView = TokenClass.prototype._canView
      TokenClass.prototype._canView = function (user, ...args) {
         if (isSiege(this.document?.actor)) return true
         if (originalCanView) return originalCanView.call(this, user, ...args)
         return this.document.testUserPermission(user, "OBSERVER")
      }

      const originalCanConfigure = TokenClass.prototype._canConfigure
      TokenClass.prototype._canConfigure = function (user, ...args) {
         if (isSiege(this.document?.actor)) return true
         if (originalCanConfigure)
            return originalCanConfigure.call(this, user, ...args)
         return user.isGM
      }

      
      
      
      
      const originalCanControl = TokenClass.prototype._canControl
      TokenClass.prototype._canControl = function (user, event) {
         const actor = this.document?.actor
         if (actor && VehicleEntryManager.isEntered(actor)) return false
         if (
            actor?.type === "vehicle" &&
            (VehicleEntryManager.canUserDrive(user, actor) ||
               VehicleEntryManager.canUserRotate(user, actor))
         )
            return true
         if (originalCanControl)
            return originalCanControl.call(this, user, event)
         return actor?.testUserPermission(user, "OWNER") ?? user.isGM
      }

      
      const originalSetTarget = TokenClass.prototype.setTarget
      TokenClass.prototype.setTarget = function (targeted = true, context = {}) {
         const actor = this.document?.actor
         if (targeted && actor && VehicleEntryManager.isEntered(actor)) return
         return originalSetTarget.call(this, targeted, context)
      }

      
      
      
      
      const originalDragDrop = TokenClass.prototype._onDragLeftDrop
      TokenClass.prototype._onDragLeftDrop = async function (event) {
         const actor = this.document?.actor
         if (actor?.type === "vehicle" && !game.user.isGM) {
            if (VehicleLoadManager.isAtMax(actor)) {
               this.layer.clearPreviewContainer?.()
               ui.notifications.warn(tKey("VehicleLoad.MaxBulkMoveBlocked"))
               return false
            }
            const owns = actor.testUserPermission(game.user, "OWNER")
            const canDrive = VehicleEntryManager.canUserDrive(game.user, actor)
            const role = VehicleEntryManager.userVehicleRole(game.user, actor)
            console.log(
               "%c[Drive]",
               "color:#0a0",
               `dragDrop on ${actor.name}: owns=${owns} canDrive=${canDrive} role=${role} drivable=${actor.getFlag(MODULE_ID, "drivable")}`,
            )
            if (!owns && canDrive) {
               
               const clones = event.interactionData?.clones || []
               const clone = clones.find((c) => c.id === this.id) || clones[0]
               const dest = clone
                  ? {
                       x: Math.round(clone.document.x),
                       y: Math.round(clone.document.y),
                    }
                  : null
               console.log("%c[Drive]", "color:#0a0", "drag dest:", dest, {
                  cloneCount: clones.length,
               })
               
               this.layer.clearPreviewContainer?.()
               if (dest) {
                  const { SiegeSocketManager } = await import("./sockets.mjs")
                  
                  await SiegeSocketManager.moveVehicleByRole(
                     this.document.uuid,
                     dest,
                  )
               }
               return false
            }
            if (!owns && !canDrive) {
               this.layer.clearPreviewContainer?.()
               ui.notifications.warn(tKey("Enter.Notifications.NoControl"))
               return false
            }
         }
         if (originalDragDrop) return originalDragDrop.call(this, event)
      }

      
      
      const originalRotate = TokenClass.prototype.rotate
      TokenClass.prototype.rotate = async function (...args) {
         const actor = this.document?.actor
         if (actor?.type === "vehicle" && !game.user.isGM) {
            const owns = actor.testUserPermission(game.user, "OWNER")
            if (!owns) {
               if (VehicleEntryManager.canUserRotate(game.user, actor)) {
                  
                  let rotation =
                     typeof args[0] === "object" ? args[0]?.angle : args[0]
                  if (rotation !== undefined && rotation !== null) {
                     const { SiegeSocketManager } = await import("./sockets.mjs")
                     await SiegeSocketManager.moveVehicleByRole(
                        this.document.uuid,
                        { rotation: Number(rotation) },
                     )
                  }
                  return this
               }
               ui.notifications.warn(tKey("Enter.Notifications.NoControl"))
               return this
            }
         }
         return originalRotate.call(this, ...args)
      }

      const originalClickLeft2 = TokenClass.prototype._onClickLeft2
      TokenClass.prototype._onClickLeft2 = function (event) {
         const actor = this.document?.actor
         const enterable =
            actor?.type === "vehicle" && !!actor.getFlag(MODULE_ID, "enterable")

         
         
         if (enterable && !game.user.isGM) {
            const crewman =
               canvas.tokens.controlled[0]?.actor || game.user.character
            if (!crewman) {
               ui.notifications.warn(
                  tKey("Notifications.SelectCharacterTokenFirst"),
               )
               return
            }
            
            if (crewman.id === actor.id || crewman.type === "vehicle") {
               ui.notifications.warn(tKey("Enter.Notifications.CannotEnterSelf"))
               return
            }
            const inside = crewman.itemTypes.effect.some(
               (e) =>
                  e.getFlag(MODULE_ID, "isEntered") &&
                  e.getFlag(MODULE_ID, "siegeId") === actor.id,
            )
            if (inside) {
               SiegeMacros.actionMacro(crewman)
               return
            }
            
            const isMountable =
               actor.getFlag(MODULE_ID, "mountableByPCs") !== false
            console.debug(
               `[siege] dblclick enter attempt: crewman=${crewman?.name} vehicle=${actor?.name} mountable=${isMountable}`,
            )
            if (!isMountable) {
               ui.notifications.warn(tKey("Notifications.CannotBeMountedByPCs"))
               return
            }
            
            const otherVehicle = crewman.itemTypes.effect.find(
               (e) =>
                  e.getFlag(MODULE_ID, "isEntered") &&
                  e.getFlag(MODULE_ID, "siegeId") &&
                  e.getFlag(MODULE_ID, "siegeId") !== actor.id,
            )
            if (otherVehicle) {
               ui.notifications.warn(tKey("Enter.Notifications.AlreadyInVehicle"))
               return
            }
            SiegeMacros.enterVehicleMacro(crewman, actor)
            return
         }

         if (isSiege(actor) && !game.user.isGM) {
            const isMountable =
               actor.getFlag(MODULE_ID, "mountableByPCs") !== false
            if (!isMountable) {
               ui.notifications.warn(tKey("Notifications.CannotBeMountedByPCs"))
               return
            }

            const crewman =
               canvas.tokens.controlled[0]?.actor || game.user.character
            if (!crewman) {
               ui.notifications.warn(
                  tKey("Notifications.SelectCharacterTokenFirst"),
               )
               return
            }

            const effect = crewman.itemTypes.effect.find(
               (e) => e.getFlag(MODULE_ID, "siegeId") === actor.id,
            )
            if (effect) SiegeMacros.actionMacro(crewman)
            else SiegeMacros.mountMacro(crewman, actor)
            return
         }
         if (originalClickLeft2) return originalClickLeft2.call(this, event)
      }

      const originalClickRight2 = TokenClass.prototype._onClickRight2
      TokenClass.prototype._onClickRight2 = async function (event) {
         const actor = this.document?.actor
         const enterable =
            actor?.type === "vehicle" && !!actor.getFlag(MODULE_ID, "enterable")

         
         
         if (enterable && !game.user.isGM) {
            
            
            
            const ctrl = canvas.tokens.controlled[0]?.actor
            let crewman =
               ctrl && ctrl.id !== actor.id && ctrl.type !== "vehicle"
                  ? ctrl
                  : game.user.character
            if (!crewman) {
               ui.notifications.warn(
                  tKey("Notifications.SelectCharacterTokenFirst"),
               )
               return
            }
            if (crewman.id === actor.id || crewman.type === "vehicle") {
               ui.notifications.warn(tKey("Enter.Notifications.CannotEnterSelf"))
               return
            }
            SiegeMacros.actionMacro(crewman)
            return
         }

         if (isSiege(actor) && !game.user.isGM) {
            const crewman =
               canvas.tokens.controlled[0]?.actor || game.user.character
            if (crewman) {
               const effect = crewman.itemTypes.effect.find(
                  (e) => e.getFlag(MODULE_ID, "siegeId") === actor.id,
               )
               if (effect) {
                  await SiegeCrewManager.dismountCrewman(crewman, actor)
                  ui.notifications.info(
                     tKey("Notifications.CrewmanDismounted", {
                        crewman: crewman.name,
                        siege: actor.name,
                     }),
                  )
               }
            }
            return
         }
         if (originalClickRight2) return originalClickRight2.call(this, event)
      }
   }

   static _deleteGroundStashActor(actor) {
      this._deletingGroundStashes = this._deletingGroundStashes || new Set()
      if (this._deletingGroundStashes.has(actor.id)) return
      this._deletingGroundStashes.add(actor.id)
      actor.delete().finally(() => this._deletingGroundStashes.delete(actor.id))
   }

   

   
   
   
   static async _handleStashDropToActor(targetActor, data) {
      try {
         const { vehicleId, itemId } = data.siegeStashMove
         if (!targetActor) return
         
         if (targetActor.id === vehicleId) return
         const { SiegeSocketManager } = await import("./sockets.mjs")
         await SiegeSocketManager.moveStashItem(
            vehicleId,
            itemId,
            targetActor.uuid,
            game.user.id,
         )
      } catch (e) {
         console.error("[siege] stash drop-to-actor failed", e)
      }
   }

   
   
   static async _handleStashDropToCanvas(data) {
      try {
         const { vehicleId, itemId } = data.siegeStashMove
         const x = data.x
         const y = data.y
         const token = canvas?.tokens?.placeables?.find((t) => {
            const b = t.bounds
            return b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
         })
         if (!token?.actor) {
            const { SiegeSocketManager } = await import("./sockets.mjs")
            await SiegeSocketManager.dropStashItemToGround(
               vehicleId,
               itemId,
               canvas.scene.id,
               x,
               y,
               game.user.id,
            )
            return
         }
         const { SiegeSocketManager } = await import("./sockets.mjs")
         await SiegeSocketManager.moveStashItem(
            vehicleId,
            itemId,
            token.actor.uuid,
            game.user.id,
         )
      } catch (e) {
         console.error("[siege] stash drop-to-canvas failed", e)
      }
   }
}
