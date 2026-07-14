import { MODULE_ID } from "../../constants.mjs"
import { tKey } from "../../utils.mjs"
import { staticMethods } from "./helpers.mjs"

class SocketMovementMixin {
   static _sceneForMovement(sceneId = null, sourceTokenId = null) {
      if (sceneId) {
         const scene = game.scenes?.get(sceneId)
         if (scene) return scene
      }
      if (sourceTokenId) {
         const scene = game.scenes?.find((s) => s.tokens?.has(sourceTokenId))
         if (scene) return scene
      }
      return canvas?.scene ?? null
   }

   static _actorIdsFor(actor) {
      return new Set(
         [
            actor?.id,
            actor?.token?.actorId,
            actor?.token?.baseActor?.id,
            actor?.prototypeToken?.actorId,
         ].filter(Boolean),
      )
   }

   static _resolveSiegeActor(siegeId, scene = null) {
      const sceneActor = [...(scene?.tokens ?? [])]
         .find((tokenDoc) => {
            const actor = tokenDoc.actor
            if (!actor?.getFlag?.(MODULE_ID, "isSiegeWeapon")) return false
            return (
               actor.id === siegeId ||
               tokenDoc.actorId === siegeId ||
               actor.token?.baseActor?.id === siegeId
            )
         })?.actor
      if (sceneActor) return sceneActor

      const canvasActor = canvas?.tokens?.placeables
         ?.find((token) => {
            const actor = token.actor
            if (!actor?.getFlag?.(MODULE_ID, "isSiegeWeapon")) return false
            return (
               actor.id === siegeId ||
               token.document?.actorId === siegeId ||
               actor.token?.baseActor?.id === siegeId
            )
         })?.actor
      return canvasActor || game.actors.get(siegeId) || null
   }

   static _siegeIdSet(siegeId, siege = null, scene = null) {
      const ids = new Set([siegeId, ...this._actorIdsFor(siege)].filter(Boolean))
      for (const tokenDoc of scene?.tokens ?? []) {
         const actor = tokenDoc.actor
         if (!actor?.getFlag?.(MODULE_ID, "isSiegeWeapon")) continue
         if (ids.has(actor.id) || ids.has(tokenDoc.actorId)) {
            ids.add(actor.id)
            if (tokenDoc.actorId) ids.add(tokenDoc.actorId)
            for (const id of this._actorIdsFor(actor)) ids.add(id)
         }
      }
      return ids
   }

   static _effectMatchesAnySiegeId(effect, ids) {
      return ids.has(effect?.getFlag?.(MODULE_ID, "siegeId"))
   }


   static async _doMoveVehicleByRole(vehicleRef, change, sourceUserId) {
      let vehicleToken = null
      let vehicle = null
      const fromToken = await fromUuid(vehicleRef).catch(() => null)
      if (fromToken?.documentName === "Token") {
         vehicleToken = fromToken
         vehicle = fromToken.actor
      } else {
         vehicle = game.actors.get(vehicleRef)
         vehicleToken = vehicle?.getActiveTokens()[0]?.document ?? null
      }
      if (!vehicle || !vehicleToken) return
      const user = game.users.get(sourceUserId)
      if (!user) return

      const { VehicleEntryManager } = await import("../entry.mjs")
      const { VehicleLaunchManager } = await import("../launch.mjs")
      const { VehicleLoadManager } = await import("../vehicle-load.mjs")
      const wantsMove = change.x !== undefined || change.y !== undefined
      const wantsRotate = change.rotation !== undefined
      const canMoveMounted = VehicleEntryManager.canUserMoveMountedSiege(
         user,
         vehicle,
      )
      const canDrive =
         VehicleEntryManager.canUserDrive(user, vehicle) || canMoveMounted
      const canRotate =
         VehicleEntryManager.canUserRotate(user, vehicle) || canMoveMounted

      const needsIgnition = vehicle.getFlag(MODULE_ID, "needsIgnition") === true
      const launched = VehicleLaunchManager.isLaunched(vehicle)

      if (needsIgnition && !launched) {
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeAsUser(
               "notifyUser",
               sourceUserId,
               { type: "warn", key: "CrewHUD.NotLaunched" },
            )
         return
      }
      await VehicleLoadManager.sync(vehicle)
      if (wantsMove && VehicleLoadManager.isAtMax(vehicle)) {
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeAsUser(
               "notifyUser",
               sourceUserId,
               { type: "warn", key: "VehicleLoad.MaxBulkMoveBlocked" },
            )
         return
      }
      if (wantsMove && !canDrive) {
         return
      }
      if (wantsRotate && !wantsMove && !canRotate) {
         return
      }
      if (wantsMove) {
         const { SiegeSFXManager } = await import("../sfx.mjs")
         SiegeSFXManager.warmMovementSFX(vehicle)
      }

      const oldX = vehicleToken.x
      const oldY = vehicleToken.y

      const update = { _id: vehicleToken.id }
      if (change.x !== undefined) update.x = change.x
      if (change.y !== undefined) update.y = change.y
      if (change.rotation !== undefined) update.rotation = change.rotation

      const scene = vehicleToken.parent ?? canvas.scene
      await scene.updateEmbeddedDocuments("Token", [update], {
         siegeSyncMovement: true,
         siegeSourceUserId: sourceUserId,
      })

      const dx = update.x !== undefined ? update.x - oldX : 0
      const dy = update.y !== undefined ? update.y - oldY : 0

      if (
         wantsMove &&
         (dx !== 0 || dy !== 0) &&
         vehicle.system.traits?.value?.includes("portable")
      ) {
         await this._doMoveSiegeAndCrew(
            vehicle.id,
            dx,
            dy,
            vehicleToken.id,
            sourceUserId,
            scene.id,
         )
         return
      }

      if (wantsMove && (dx !== 0 || dy !== 0)) {
         const vehBaseId = vehicle.id
         const crewUpdates = []
         for (const t of scene.tokens) {
            const a = t.actor
            if (!a) continue
            const linked = a.itemTypes.effect.some(
               (e) =>
                  e.getFlag(MODULE_ID, "siegeId") === vehBaseId &&
                  e.getFlag(MODULE_ID, "isEntered"),
            )
            if (!linked || t.id === vehicleToken.id) continue
            crewUpdates.push({ _id: t.id, x: t.x + dx, y: t.y + dy })
         }
         if (crewUpdates.length > 0)
            await scene.updateEmbeddedDocuments("Token", crewUpdates, {
               siegeSyncMovement: true,
               siegeSourceUserId: sourceUserId,
            })
      }
   }



   static async _doMoveSiegeAndCrew(
      siegeId,
      dx,
      dy,
      sourceTokenId = null,
      sourceUserId = null,
      sceneId = null,
   ) {
      const scene = this._sceneForMovement(sceneId, sourceTokenId)
      const siege = this._resolveSiegeActor(siegeId, scene)
      if (!siege || !scene) return

      const siegeIds = this._siegeIdSet(siegeId, siege, scene)
      const updates = new Map()
      const sourceToken = sourceTokenId ? scene.tokens?.get(sourceTokenId) : null
      const sourceIsSiege = !!sourceToken?.actor?.getFlag?.(
         MODULE_ID,
         "isSiegeWeapon",
      )
      const addUpdate = (tokenDoc) => {
         if (!tokenDoc || tokenDoc.id === sourceTokenId) return
         updates.set(tokenDoc.id, {
            _id: tokenDoc.id,
            x: tokenDoc.x + dx,
            y: tokenDoc.y + dy,
         })
      }

      if (sourceIsSiege) {
         for (const tokenDoc of scene.tokens ?? []) {
            const actor = tokenDoc.actor
            if (!actor) continue
            const isLifting = actor.itemTypes.effect.some(
               (effect) =>
                  effect.getFlag(MODULE_ID, "isLiftingEffect") &&
                  this._effectMatchesAnySiegeId(effect, siegeIds) &&
                  effect.system.badge?.value > 0,
            )
            if (isLifting) addUpdate(tokenDoc)
         }
         if (updates.size > 0)
            await scene.updateEmbeddedDocuments("Token", [...updates.values()], {
               siegeSyncMovement: true,
               siegeSourceUserId: sourceUserId,
            })
         return
      }

      const siegeTokenDocs = []
      for (const tokenDoc of scene.tokens ?? []) {
         const actor = tokenDoc.actor
         if (!actor?.getFlag?.(MODULE_ID, "isSiegeWeapon")) continue
         const tokenIds = new Set([
            tokenDoc.actorId,
            ...this._actorIdsFor(actor),
         ].filter(Boolean))
         if ([...tokenIds].some((id) => siegeIds.has(id)))
            siegeTokenDocs.push(tokenDoc)
      }

      if (siegeTokenDocs.length > 0) {
         const chosen = sourceToken
            ? [...siegeTokenDocs].sort((a, b) => {
                 const da =
                    Math.abs(a.x - sourceToken.x) + Math.abs(a.y - sourceToken.y)
                 const db =
                    Math.abs(b.x - sourceToken.x) + Math.abs(b.y - sourceToken.y)
                 return da - db
              })[0]
            : siegeTokenDocs[0]
         addUpdate(chosen)
      }

      for (const tokenDoc of scene.tokens ?? []) {
         const actor = tokenDoc.actor
         if (!actor) continue
         const isLifting = actor.itemTypes.effect.some(
            (effect) =>
               effect.getFlag(MODULE_ID, "isLiftingEffect") &&
               this._effectMatchesAnySiegeId(effect, siegeIds) &&
               effect.system.badge?.value > 0,
         )
         if (!isLifting) continue
         addUpdate(tokenDoc)
      }
      if (updates.size > 0) {
         await scene.updateEmbeddedDocuments("Token", [...updates.values()], {
            siegeSyncMovement: true,
            siegeSourceUserId: sourceUserId,
         })
      }
   }



   static async moveSiegeAndCrew(
      siegeId,
      dx,
      dy,
      sourceTokenId = null,
      sceneId = null,
   ) {
      if (game.user.isGM) {
         await this._doMoveSiegeAndCrew(
            siegeId,
            dx,
            dy,
            sourceTokenId,
            game.user.id,
            sceneId,
         )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "moveSiegeAndCrew",
            siegeId,
            dx,
            dy,
            sourceTokenId,
            game.user.id,
            sceneId,
         )
      }
   }



   static async requestSwapConsent(displaced, mover, vehicle, newPos, oldPos) {
      const payload = {
         moverName: mover.name,
         displacedName: displaced.name,
         newPos,
         oldPos,
      }
      
      const owner = game.users.find(
         (u) =>
            u.active &&
            !u.isGM &&
            displaced.testUserPermission(u, "OWNER"),
      )
      if (owner && owner.id !== game.user.id && globalThis.siegeSocket) {
         try {
            return await globalThis.siegeSocket.executeAsUser(
               "promptSwapConsent",
               owner.id,
               payload,
            )
         } catch (e) {
            return false
         }
      }
      
      return await foundry.applications.api.DialogV2.confirm({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("CrewHUD.SwitchRequestTitle") },
         content: `<p>${tKey("CrewHUD.SwitchRequest", {
            mover: payload.moverName,
            you: payload.displacedName,
            pos: newPos,
            cur: oldPos,
         })}</p>`,
      }).catch(() => false)
   }



   static async moveVehicleByRole(vehicleId, change) {
      if (game.user.isGM) {
         await this._doMoveVehicleByRole(vehicleId, change, game.user.id)
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "moveVehicleByRole",
            vehicleId,
            change,
            game.user.id,
         )
      }
   }
}

export const socketMovementMethods = staticMethods(SocketMovementMixin)
