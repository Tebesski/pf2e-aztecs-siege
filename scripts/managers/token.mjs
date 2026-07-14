import { MODULE_ID } from "../constants.mjs"
import { isSiege, tKey } from "../utils.mjs"
import { SiegeMacros } from "../macros/index.mjs"
import { VehicleEntryManager } from "./entry.mjs"
import { VehicleLoadManager } from "./vehicle-load.mjs"
import { tokenCrewTargetingMethods } from "./token/crew-targeting.mjs"
import { siegeIdsFor } from "./portable-helpers.mjs"

export class SiegeTokenManager {
   static _crewTargetPrompting = new Set()
   static _allowedCrewTargetKeys = new Set()
   static _preUpdatePositions = new Map()
   static _portableMoveIntents = new Map()

   static _tokenMoveKey(tokenDoc) {
      return tokenDoc?.uuid || `${tokenDoc?.parent?.id ?? ""}.${tokenDoc?.id ?? ""}`
   }

   static _rememberPortableMove(tokenDoc, data) {
      const key = this._tokenMoveKey(tokenDoc)
      if (!key) return
      const intent = {
         ...data,
         oldX: tokenDoc.x,
         oldY: tokenDoc.y,
         sceneId: tokenDoc.parent?.id,
      }
      this._portableMoveIntents.set(key, intent)
   }

   static _forgetPortableMove(tokenDoc) {
      const key = this._tokenMoveKey(tokenDoc)
      const intent = this._portableMoveIntents.get(key)
      if (key) this._portableMoveIntents.delete(key)
      return intent
   }

   static _movementDelta(tokenDoc, changes, previous) {
      const nextX =
         changes.x !== undefined ? Number(changes.x) : Number(tokenDoc.x)
      const nextY =
         changes.y !== undefined ? Number(changes.y) : Number(tokenDoc.y)
      return {
         dx:
            previous && Number.isFinite(nextX)
               ? nextX - Number(previous.oldX)
               : 0,
         dy:
            previous && Number.isFinite(nextY)
               ? nextY - Number(previous.oldY)
               : 0,
      }
   }

   static _resolveSiegeActor(siegeId) {
      const tokenActor = canvas?.tokens?.placeables?.find((token) => {
         const actor = token.actor
         if (!actor?.getFlag?.(MODULE_ID, "isSiegeWeapon")) return false
         return (
            actor.id === siegeId ||
            token.document?.actorId === siegeId ||
            actor.token?.baseActor?.id === siegeId
         )
      })?.actor
      return tokenActor || game.actors.get(siegeId) || null
   }

   static _snappedTokenDestination(clone) {
      const x = Number(clone?.document?.x)
      const y = Number(clone?.document?.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null

      const grid = canvas?.grid
      if (typeof grid?.getSnappedPosition === "function") {
         const point = grid.getSnappedPosition(x, y)
         if (point) return { x: point.x, y: point.y }
      }

      const size = Number(grid?.size) || 1
      return {
         x: Math.round(x / size) * size,
         y: Math.round(y / size) * size,
      }
   }

   static _dragTokenDestination(token, event) {
      const clones = event?.interactionData?.clones || []
      const clone = clones.find((c) => c.id === token?.id) || clones[0]
      const cloneDest = this._snappedTokenDestination(clone)
      if (cloneDest) return cloneDest

      const destination =
         event?.interactionData?.destination ||
         event?.interactionData?.dest ||
         event?.data?.destination ||
         null
      const origin = event?.interactionData?.origin || event?.data?.origin || null
      const x = Number(destination?.x)
      const y = Number(destination?.y)
      if (Number.isFinite(x) && Number.isFinite(y)) {
         const originX = Number(origin?.x)
         const originY = Number(origin?.y)
         if (Number.isFinite(originX) && Number.isFinite(originY)) {
            return this._snappedPointDestination(
               Number(token?.document?.x ?? token?.x ?? 0) + x - originX,
               Number(token?.document?.y ?? token?.y ?? 0) + y - originY,
            )
         }
         return this._snappedPointDestination(x, y)
      }

      return null
   }

   static _snappedPointDestination(x, y) {
      const grid = canvas?.grid
      if (typeof grid?.getSnappedPosition === "function") {
         const point = grid.getSnappedPosition(x, y)
         if (point) return { x: point.x, y: point.y }
      }

      const size = Number(grid?.size) || 1
      return {
         x: Math.round(x / size) * size,
         y: Math.round(y / size) * size,
      }
   }

   static _isControlledToken(token) {
      const uuid = token?.document?.uuid
      return canvas.tokens.controlled.some(
         (controlled) =>
            controlled === token ||
            controlled.id === token?.id ||
            controlled.document?.uuid === uuid,
      )
   }

   static _isMountedOnVehicle(actor, vehicle) {
      if (!actor || actor.type === "vehicle" || !vehicle) return false
      return actor.itemTypes.effect.some(
         (effect) =>
            effect.getFlag(MODULE_ID, "siegeId") === vehicle.id &&
            effect.getFlag(MODULE_ID, "position"),
      )
   }

   static _userMountedActorsForVehicle(user, vehicle) {
      const seen = new Set()
      const candidates = []
      const add = (actor) => {
         if (!actor || seen.has(actor.id)) return
         seen.add(actor.id)
         candidates.push(actor)
      }
      add(user?.character)
      for (const token of canvas.tokens.controlled) add(token.actor)
      for (const actor of game.actors) add(actor)
      for (const token of canvas.tokens.placeables) add(token.actor)

      return candidates.filter(
         (actor) =>
            actor?.testUserPermission?.(user, "OWNER") &&
            this._isMountedOnVehicle(actor, vehicle),
      )
   }

   static _targetedOwnedActor() {
      const target = Array.from(game.user?.targets ?? [])[0]
      const actor = target?.actor
      if (!actor || actor.type === "vehicle") return null
      if (!actor.testUserPermission?.(game.user, "OWNER")) return null
      return actor
   }

   static _defaultCrewmanForVehicle(vehicle) {
      const targeted =
         VehicleEntryManager.targetedOwnedActor() ||
         this._targetedOwnedActor()
      if (targeted) return targeted

      const sceneActor = VehicleEntryManager.singleOwnedSceneActor()
      if (sceneActor) return sceneActor

      const selected = VehicleEntryManager.selectedCrewmanForVehicle(vehicle)
      if (selected) return selected

      const controlled = canvas.tokens.controlled[0]?.actor
      if (
         controlled &&
         controlled.id !== vehicle?.id &&
         controlled.type !== "vehicle"
      )
         return controlled

      return game.user.character
   }

   static _selectedOperableVehicleCrewman(token, vehicle) {
      if (vehicle?.type !== "vehicle") return null
      const targeted = VehicleEntryManager.targetedOwnedActor()
      if (targeted)
         return VehicleEntryManager.isCrewOfVehicle(targeted, vehicle)
            ? targeted
            : null
      if (game.user.isGM) return null
      if (!this._isControlledToken(token)) return null
      return VehicleEntryManager.activeCrewmanForVehicle(vehicle)
   }

   static _crewTargetPermissionKey(token, user = game.user) {
      const tokenKey =
         token?.document?.uuid || token?.uuid || token?.id || token?.document?.id
      const userId =
         typeof user === "string" ? user : user?.id || game.user?.id || ""
      return tokenKey && userId ? `${userId}:${tokenKey}` : ""
   }

   static _isEnteredCrewToken(token) {
      const actor = token?.document?.actor || token?.actor || null
      return !!actor && VehicleEntryManager.isEntered(actor)
   }

   static _allowCrewTarget(token, user = game.user) {
      const key = this._crewTargetPermissionKey(token, user)
      if (key) this._allowedCrewTargetKeys.add(key)
   }

   static _clearCrewTargetAllowance(token, user = game.user) {
      const key = this._crewTargetPermissionKey(token, user)
      if (key) this._allowedCrewTargetKeys.delete(key)
   }

   static _isCrewTargetAllowed(token, user = game.user) {
      const key = this._crewTargetPermissionKey(token, user)
      return !!key && this._allowedCrewTargetKeys.has(key)
   }

   static _removeIllegalEnteredTarget(token, user = game.user) {
      if (!token || user !== game.user) return
      if (!this._isEnteredCrewToken(token)) return
      if (this._isCrewTargetAllowed(token, user)) return
      try {
         token.setTarget?.(false, {
            user,
            releaseOthers: false,
            groupSelection: true,
            siegeBypassCrewTargeting: true,
         })
      } catch (_err) {}
      try {
         token._updateTarget?.(false, user)
      } catch (_err) {}
      user.targets?.delete?.(token)
      token.renderFlags?.set?.({ refreshTarget: true })
      if (token.document) ui.combat?.refreshTargetDisplay?.(token.document)
   }

   static _purgeIllegalEnteredTargets(user = game.user) {
      if (!user || user !== game.user) return
      for (const token of Array.from(user.targets || [])) {
         this._removeIllegalEnteredTarget(token, user)
      }
   }

   static _patchUserTargetUpdates() {
      const user = game.user
      if (!user || user._siegeEnteredTargetPatch) return
      user._siegeEnteredTargetPatch = true
      const purge = () => window.setTimeout(() => this._purgeIllegalEnteredTargets(user), 0)

      if (typeof user.updateTokenTargets === "function") {
         const original = user.updateTokenTargets.bind(user)
         user.updateTokenTargets = (...args) => {
            const result = original(...args)
            purge()
            return result
         }
      }

      if (typeof user._onUpdateTokenTargets === "function") {
         const original = user._onUpdateTokenTargets.bind(user)
         user._onUpdateTokenTargets = (...args) => {
            const result = original(...args)
            purge()
            return result
         }
      }

      this._purgeIllegalEnteredTargets(user)
   }

   static initHooks() {
      Hooks.once("setup", () => this.onSetup())
      Hooks.once("ready", () => this._patchUserTargetUpdates())

      Hooks.on("targetToken", (user, token, targeted) => {
         if (user !== game.user) return
         if (!this._isEnteredCrewToken(token)) return
         if (!targeted) {
            this._clearCrewTargetAllowance(token, user)
            return
         }
         if (!this._isCrewTargetAllowed(token, user))
            window.setTimeout(
               () => this._removeIllegalEnteredTarget(token, user),
               0,
            )
      })

Hooks.on("preUpdateToken", (tokenDoc, changes, options) => {
         if (
            options.siegeSyncMovement ||
            options.siegeEntering ||
            options.siegeExiting
         )
            return
         const actor = tokenDoc.actor
         if (!actor) return
         if (changes.x !== undefined || changes.y !== undefined)
            this._preUpdatePositions.set(tokenDoc.uuid || tokenDoc.id, {
               x: tokenDoc.x,
               y: tokenDoc.y,
            })

         if (
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
               options.portableSiegeVehicleMoved = {
                  siegeId: actor.id,
               }
               this._rememberPortableMove(tokenDoc, {
                  type: "vehicle",
                  siegeId: actor.id,
               })
            }
         }

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
            const canDrive =
               VehicleEntryManager.canUserDrive(game.user, actor) ||
               VehicleEntryManager.canUserMoveMountedSiege(game.user, actor)
            const canRotate =
               VehicleEntryManager.canUserRotate(game.user, actor) ||
               VehicleEntryManager.canUserMoveMountedSiege(game.user, actor)

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
         const prev = this._preUpdatePositions.get(tokenDoc.uuid || tokenDoc.id)
         const dx = prev && changes.x !== undefined ? tokenDoc.x - prev.x : 0
         const dy = prev && changes.y !== undefined ? tokenDoc.y - prev.y : 0
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
         if (effects.length === 0) return
         try {
            Promise.resolve(manager.endEffects?.({ effects })).catch(() => {})
         } catch {
         }

         for (const effect of effects) {
            try {
               if (!manager.endEffects) effect.end?.()
            } catch {
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
            if (token.targeted?.has?.(game.user))
               SiegeTokenManager._refreshCrewTargetIndicator(token)

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
      Hooks.on("updateItem", (item) => {
         if (!game.user.isGM) return
         const actor = item.parent
         if (!actor?.getFlag?.(MODULE_ID, "isGroundStash")) return
         const hasItems = actor.items.some((i) => {
            const raw = i.system?.quantity
            const quantity = Number(
               raw && typeof raw === "object" ? raw.value : raw ?? 1,
            )
            return quantity > 0
         })
         if (!hasItems) this._deleteGroundStashActor(actor)
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

         const liftingEffect = actor.itemTypes.effect.find((e) => {
            if (
               !e.getFlag(MODULE_ID, "isLiftingEffect") ||
               e.system.badge?.value <= 0
            )
               return false
            const effectSiege = this._resolveSiegeActor(
               e.getFlag(MODULE_ID, "siegeId"),
            )
            return effectSiege?.system.traits?.value?.includes("portable")
         })
         if (!liftingEffect) return

         const siegeId = liftingEffect.getFlag(MODULE_ID, "siegeId")
         const siege = this._resolveSiegeActor(siegeId)
         if (!siege || !siege.system.traits?.value?.includes("portable")) return

         const siegeIds = siegeIdsFor(siege)
         siegeIds.add(siegeId)
         const isLeader = actor.itemTypes.effect.some(
            (e) =>
               e.getFlag(MODULE_ID, "isCrewLeader") &&
               siegeIds.has(e.getFlag(MODULE_ID, "siegeId")),
         )

         if (!isLeader && !options.siegeSyncMovement) {
            ui.notifications.warn(tKey("Notifications.OnlyLeaderCanMove"))
            delete changes.x
            delete changes.y
            return
         }

         if (isLeader && !options.siegeSyncMovement) {
            options.leaderMovedSiege = { siegeId }
            this._rememberPortableMove(tokenDoc, {
               type: "leader",
               siegeId,
            })
         }
      })

      Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
         if (game.user.id !== userId) return

         const intent = options.siegeSyncMovement
            ? null
         : this._forgetPortableMove(tokenDoc)
         if (intent) {
            const { dx, dy } = this._movementDelta(tokenDoc, changes, intent)
            if (dx !== 0 || dy !== 0)
               import("../managers/sockets.mjs").then((m) =>
                  m.SiegeSocketManager.moveSiegeAndCrew(
                     intent.siegeId,
                     dx,
                     dy,
                     tokenDoc.id,
                     intent.sceneId ?? tokenDoc.parent?.id,
                  ),
               )
            return
         }

         if (options.leaderMovedSiege) {
            const { siegeId } = options.leaderMovedSiege
            const prev = this._preUpdatePositions.get(tokenDoc.uuid || tokenDoc.id)
            const { dx, dy } = this._movementDelta(
               tokenDoc,
               changes,
               prev && { oldX: prev.x, oldY: prev.y },
            )
            if (dx === 0 && dy === 0) return
            import("../managers/sockets.mjs").then((m) =>
               m.SiegeSocketManager.moveSiegeAndCrew(
                  siegeId,
                  dx,
                  dy,
                  tokenDoc.id,
                 tokenDoc.parent?.id,
               ),
            )
         }

         if (options.portableSiegeVehicleMoved) {
            const { siegeId } = options.portableSiegeVehicleMoved
            const prev = this._preUpdatePositions.get(tokenDoc.uuid || tokenDoc.id)
            const { dx, dy } = this._movementDelta(
               tokenDoc,
               changes,
               prev && { oldX: prev.x, oldY: prev.y },
            )
            if (dx === 0 && dy === 0) return
            import("../managers/sockets.mjs").then((m) =>
               m.SiegeSocketManager.moveSiegeAndCrew(
                  siegeId,
                  dx,
                  dy,
                  tokenDoc.id,
                  tokenDoc.parent?.id,
               ),
            )
            return
         }

         const actor = tokenDoc.actor
         if (
            actor &&
            actor.type === "vehicle" &&
            actor.getFlag(MODULE_ID, "isSiegeWeapon") &&
            actor.system.traits?.value?.includes("portable") &&
            !options.siegeSyncMovement
         ) {
            const prev = this._preUpdatePositions.get(tokenDoc.uuid || tokenDoc.id)
            const { dx, dy } = this._movementDelta(
               tokenDoc,
               changes,
               prev && { oldX: prev.x, oldY: prev.y },
            )
            if (dx !== 0 || dy !== 0) {
               import("../managers/sockets.mjs").then((m) =>
                  m.SiegeSocketManager.moveSiegeAndCrew(
                     actor.id,
                     dx,
                     dy,
                     tokenDoc.id,
                     tokenDoc.parent?.id,
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
               VehicleEntryManager.canUserRotate(user, actor) ||
               VehicleEntryManager.canUserMoveMountedSiege(user, actor))
         )
            return true
         if (originalCanControl)
            return originalCanControl.call(this, user, event)
         return actor?.testUserPermission(user, "OWNER") ?? user.isGM
      }

const originalSetTarget = TokenClass.prototype.setTarget
      TokenClass.prototype.setTarget = function (targeted = true, context = {}) {
         const actor = this.document?.actor
         if (actor && VehicleEntryManager.isEntered(actor)) {
            if (targeted && !context.siegeCrewTargeting) return false
            if (targeted) SiegeTokenManager._allowCrewTarget(this, context.user)
            else SiegeTokenManager._clearCrewTargetAllowance(this, context.user)
         }
         const result = originalSetTarget.call(this, targeted, context)
         if (
            targeted &&
            actor?.type === "vehicle" &&
            SiegeTokenManager._shouldPromptCrewTarget(this, context)
         )
            window.setTimeout(() => {
               SiegeTokenManager._handleCrewTargetPrompt(this, context)
            }, 0)
         return result
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
            const canDrive =
               VehicleEntryManager.canUserDrive(game.user, actor) ||
               VehicleEntryManager.canUserMoveMountedSiege(game.user, actor)
            if (canDrive) {

               const dest = SiegeTokenManager._dragTokenDestination(this, event)

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
            this.layer.clearPreviewContainer?.()
            ui.notifications.warn(tKey("Enter.Notifications.NoControl"))
            return false
         }
         if (originalDragDrop) return originalDragDrop.call(this, event)
      }

const originalRotate = TokenClass.prototype.rotate
      TokenClass.prototype.rotate = async function (...args) {
         const actor = this.document?.actor
         if (actor?.type === "vehicle" && !game.user.isGM) {
            if (
               VehicleEntryManager.canUserRotate(game.user, actor) ||
               VehicleEntryManager.canUserMoveMountedSiege(game.user, actor)
            ) {

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
         return originalRotate.call(this, ...args)
      }

      const originalClickLeft2 = TokenClass.prototype._onClickLeft2
      TokenClass.prototype._onClickLeft2 = async function (event) {
         const actor = this.document?.actor
         const enterable =
            actor?.type === "vehicle" && !!actor.getFlag(MODULE_ID, "enterable")
         const targetedActor = VehicleEntryManager.targetedOwnedActor()
         const useVehicleFlow = !game.user.isGM

         const selectedCrewman = SiegeTokenManager._selectedOperableVehicleCrewman(
            this,
            actor,
         )
         if (selectedCrewman) {
            const { CrewHUD } = await import("../ui/crew-hud.mjs")
            await CrewHUD.changePositionDialog(actor, selectedCrewman)
            return
         }

         if (enterable && useVehicleFlow) {
            const crewman =
               targetedActor || SiegeTokenManager._defaultCrewmanForVehicle(actor)
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
               import("../ui/vehicle-hud.mjs").then((m) =>
                  m.VehicleHUD.open(actor),
               )
               return
            }

            const isMountable =
               actor.getFlag(MODULE_ID, "mountableByPCs") !== false
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

         if (isSiege(actor) && useVehicleFlow) {
            const isMountable =
               actor.getFlag(MODULE_ID, "mountableByPCs") !== false
            if (!isMountable) {
               ui.notifications.warn(tKey("Notifications.CannotBeMountedByPCs"))
               return
            }

            const crewman =
               targetedActor || SiegeTokenManager._defaultCrewmanForVehicle(actor)
            if (!crewman) {
               ui.notifications.warn(
                  tKey("Notifications.SelectCharacterTokenFirst"),
               )
               return
            }

            const effect = crewman.itemTypes.effect.find(
               (e) => e.getFlag(MODULE_ID, "siegeId") === actor.id,
            )
            if (effect)
               import("../ui/vehicle-hud.mjs").then((m) =>
                  m.VehicleHUD.open(actor),
               )
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
         const targetedActor = VehicleEntryManager.targetedOwnedActor()
         const useVehicleFlow = !game.user.isGM

         const selectedCrewman = SiegeTokenManager._selectedOperableVehicleCrewman(
            this,
            actor,
         )
         if (selectedCrewman) {
            await SiegeMacros.actionMacro(selectedCrewman)
            return
         }

         if (enterable && useVehicleFlow) {
            const crewman =
               targetedActor || SiegeTokenManager._defaultCrewmanForVehicle(actor)
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

         if (isSiege(actor) && useVehicleFlow) {
            const crewman =
               targetedActor || SiegeTokenManager._defaultCrewmanForVehicle(actor)
            if (crewman) {
               const effect = crewman.itemTypes.effect.find(
                  (e) => e.getFlag(MODULE_ID, "siegeId") === actor.id,
               )
               if (effect) SiegeMacros.actionMacro(crewman)
            }
            return
         }
         if (originalClickRight2) return originalClickRight2.call(this, event)
      }
   }

}

Object.assign(
   SiegeTokenManager,
   tokenCrewTargetingMethods,
)
