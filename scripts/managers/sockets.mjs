import { MODULE_ID } from "../constants.mjs"
import { SiegeSFXManager } from "./sfx.mjs"
import { socketAmmoLoadMethods } from "./sockets/ammo-load.mjs"
import { socketItemMethods } from "./sockets/items.mjs"
import { socketMovementMethods } from "./sockets/movement.mjs"
import { socketStashModuleMethods } from "./sockets/stash-modules.mjs"

export class SiegeSocketManager {
   static initHooks() {
      const registerSocket = () => {
         if (globalThis.siegeSocket) return
         globalThis.siegeSocket = socketlib.registerModule(MODULE_ID)

         globalThis.siegeSocket.register("playSFX", async (payload) => {
            const data =
               typeof payload === "string" ? { path: payload } : payload || {}
            return SiegeSFXManager.receiveSocketAudio({
               type: "playSFX",
               ...data,
            })
         })

         globalThis.siegeSocket.register("playActorSFX", async (actorUuid, key, userId = null) => {
            const actor =
               (await fromUuid(actorUuid).catch(() => null)) ||
               game.actors.get(actorUuid)
            if (!actor) return false
            await SiegeSFXManager._playLocal(actor, key, userId)
            return true
         })

         globalThis.siegeSocket.register("resolvePath", async (path) => {
            return await SiegeSFXManager.resolvePath(path)
         })

         globalThis.siegeSocket.register("resolvePathChoices", async (path) => {
            return await SiegeSFXManager.resolvePathChoices(path)
         })

         globalThis.siegeSocket.register(
            "updateSiegeSpeed",
            async (siegeUuid) => {
               const siege = await fromUuid(siegeUuid)
               if (!siege) return
               const { SiegeCrewManager } = await import("./crew.mjs")
               await SiegeCrewManager.updateSiegeSpeed(siege)
            },
         )

         globalThis.siegeSocket.register(
            "syncPortableState",
            async (
               siegeUuid,
               deletedItemId = null,
               forceDrop = false,
               totalBulkOverride = null,
            ) => {
               const siege = await fromUuid(siegeUuid)
               if (!siege) return
               const { SiegePortableManager } = await import("./portable.mjs")
               await SiegePortableManager.syncPortableState(
                  siege,
                  deletedItemId,
                  forceDrop,
                  totalBulkOverride,
               )
            },
         )

         globalThis.siegeSocket.register(
            "executeSiegeLoad",
            this._executeSiegeLoad.bind(this),
         )

         globalThis.siegeSocket.register(
            "moveSiegeAndCrew",
            (
               siegeId,
               dx,
               dy,
               sourceTokenId,
               sourceUserId = null,
               sceneId = null,
            ) =>
               this._doMoveSiegeAndCrew(
                  siegeId,
                  dx,
                  dy,
                  sourceTokenId,
                  sourceUserId,
                  sceneId,
               ),
         )

         globalThis.siegeSocket.register(
            "modifySiegeItem",
            async (siegeUuid, action, data, context = {}) => {
               const siege = await fromUuid(siegeUuid)
               if (siege) await this._applyItemMod(siege, action, data, context)
            },
         )

         globalThis.siegeSocket.register(
            "confirmConsequence",
            async (payload = {}) => this._confirmConsequence(payload),
         )

         globalThis.siegeSocket.register(
            "applyConsequenceCardDamage",
            async (payload = {}) => {
               const { ConsequenceCardManager } = await import(
                  "./consequence-cards.mjs"
               )
               return ConsequenceCardManager.gmApplyCardDamage(payload)
            },
         )

         globalThis.siegeSocket.register(
            "applyConsequenceCardHealing",
            async (payload = {}) => {
               const { ConsequenceCardManager } = await import(
                  "./consequence-cards.mjs"
               )
               return ConsequenceCardManager.gmApplyCardHealing(payload)
            },
         )

         globalThis.siegeSocket.register(
            "persistConsequenceCard",
            async (payload = {}) => {
               const { ConsequenceCardManager } = await import(
                  "./consequence-cards.mjs"
               )
               return ConsequenceCardManager.gmPersistCard(payload)
            },
         )

         globalThis.siegeSocket.register(
            "applyShieldBlockDamage",
            async (vehicleUuid, block, damage, userId = null) => {
               const { VehicleShieldManager } = await import("./shields.mjs")
               return VehicleShieldManager._doApplyShieldBlockDamage(
                  vehicleUuid,
                  block,
                  damage,
                  userId,
               )
            },
         )

         globalThis.siegeSocket.register(
            "applyShieldRepair",
            async (vehicleUuid, sourceKey, amount) => {
               const { VehicleShieldManager } = await import("./shields.mjs")
               return VehicleShieldManager._doApplyShieldRepair(
                  vehicleUuid,
                  sourceKey,
                  amount,
               )
            },
         )

         globalThis.siegeSocket.register(
            "applyVehicleHpDelta",
            async (vehicleUuid, delta) => {
               const vehicle = await fromUuid(vehicleUuid).catch(() => null)
               return this._doApplyVehicleHpDelta(vehicle, delta)
            },
         )

         globalThis.siegeSocket.register(
            "haulRelease",
            async (haulerId, targetActorId, elevationData = null) => {
               const { HaulManager } = await import("./haul.mjs")
               await HaulManager.releaseTarget(
                  haulerId,
                  targetActorId,
                  elevationData,
               )
            },
         )

         globalThis.siegeSocket.register(
            "moveVehicleByRole",
            async (vehicleId, change, sourceUserId) => {
               await this._doMoveVehicleByRole(vehicleId, change, sourceUserId)
            },
         )

         globalThis.siegeSocket.register(
            "enterVehicle",
            async (crewmanUuid, vehicleId, position) => {
               const { VehicleEntryManager } = await import("./entry.mjs")
               const crewman = await fromUuid(crewmanUuid)
               const vehicle = game.actors.get(vehicleId)
               await VehicleEntryManager._doEnter(crewman, vehicle, position)
            },
         )

         globalThis.siegeSocket.register(
            "exitVehicle",
            async (crewmanUuid, vehicleId, applyElevation = false) => {
               const { VehicleEntryManager } = await import("./entry.mjs")
               const crewman = await fromUuid(crewmanUuid)
               const vehicle = vehicleId ? game.actors.get(vehicleId) : null
               await VehicleEntryManager._doExit(crewman, vehicle, applyElevation)
            },
         )

         globalThis.siegeSocket.register(
            "setCrewPortrait",
            async (actorUuid, data, scope = "all", vehicleId = null) => {
               const actor = await fromUuid(actorUuid)
               if (!actor) return
               if (scope === "vehicle" && vehicleId)
                  await actor.setFlag(
                     MODULE_ID,
                     `crewPortraitByVehicle.${vehicleId}`,
                     data,
                  )
               else await actor.setFlag(MODULE_ID, "crewPortrait", data)
            },
         )

         globalThis.siegeSocket.register("refreshCrewHud", async (vehicleId) => {
            const { CrewHUD } = await import("../ui/crew-hud.mjs")
            CrewHUD.refreshFor(vehicleId)
         })

         globalThis.siegeSocket.register("detargetToken", async (tokenUuid) => {
            const document =
               globalThis.fromUuidSync?.(tokenUuid) ||
               (await fromUuid(tokenUuid).catch(() => null))
            const token =
               document?.object ||
               canvas?.tokens?.placeables?.find(
                  (placeable) =>
                     placeable.document?.uuid === tokenUuid ||
                     placeable.document?.id === document?.id,
               ) ||
               Array.from(game.user?.targets ?? []).find(
                  (placeable) => placeable.document?.uuid === tokenUuid,
               )
            if (!token?.setTarget) return false
            token.setTarget(false, { user: game.user, releaseOthers: false })
            return true
         })

         globalThis.siegeSocket.register(
            "refreshVehicleHud",
            async (vehicleId) => {
               const { VehicleHUD } = await import("../ui/vehicle-hud.mjs")
               VehicleHUD.refreshFor(vehicleId)
            },
         )

         globalThis.siegeSocket.register("toggleLaunched", async (vehicleId, actorUuid = null, sourceUserId = null) => {
            const { VehicleLaunchManager } = await import("./launch.mjs")
            await VehicleLaunchManager._doToggle(vehicleId, actorUuid, sourceUserId)
         })

         globalThis.siegeSocket.register(
            "reloadStrike",
            async (vehicleId, actionId, amount = null, options = {}) => {
               const { AmmunitionManager } = await import("./ammunition.mjs")
               const vehicle = game.actors.get(vehicleId)
               const action = vehicle?.items.get(actionId)
               if (vehicle && action) {
                  const result = await AmmunitionManager.reloadStrike(
                     vehicle,
                     action,
                     amount,
                     options,
                  )
                  globalThis.siegeSocket.executeForEveryone(
                     "refreshVehicleHud",
                     vehicleId,
                  )
                  return result
               }
               return false
            },
         )

         globalThis.siegeSocket.register(
            "deductAmmo",
            async (vehicleUuid, actionId, flag = {}) => {
               const siege = await fromUuid(vehicleUuid)
               const action = siege?.items.get(actionId)
               if (!siege || !action) return false
               const { deductAmmo } = await import("../macros/action-roll.mjs")
               const result = await deductAmmo(siege, flag, action, {
                  forceLocal: true,
               })
               if (result && siege.id) {
                  globalThis.siegeSocket.executeForEveryone(
                     "refreshVehicleHud",
                     siege.id,
                  )
               }
               return result
            },
         )

         globalThis.siegeSocket.register(
            "unloadStrike",
            async (vehicleId, actionId, amount = null, options = {}) => {
               const { AmmunitionManager } = await import("./ammunition.mjs")
               const vehicle = game.actors.get(vehicleId)
               const action = vehicle?.items.get(actionId)
               if (vehicle && action) {
                  const result = await AmmunitionManager.unloadStrike(
                     vehicle,
                     action,
                     amount,
                     options,
                  )
                  globalThis.siegeSocket.executeForEveryone(
                     "refreshVehicleHud",
                     vehicleId,
                  )
                  return result
               }
               return false
            },
         )

         globalThis.siegeSocket.register(
            "switchLoadedAmmo",
            async (vehicleId, actionId, choice = null) => {
               const { AmmunitionManager } = await import("./ammunition.mjs")
               const vehicle = game.actors.get(vehicleId)
               const action = vehicle?.items.get(actionId)
               if (vehicle && action) {
                  const result = await AmmunitionManager.switchActiveLoadedAmmo(
                     vehicle,
                     action,
                     choice,
                  )
                  globalThis.siegeSocket.executeForEveryone(
                     "refreshVehicleHud",
                     vehicleId,
                  )
                  return result
               }
               return false
            },
         )

         globalThis.siegeSocket.register(
            "takeStashItem",
            async (vehicleId, itemId, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               await SiegeSocketManager._doTakeStashItem(
                  vehicleId,
                  itemId,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
            },
         )

         globalThis.siegeSocket.register(
            "removeStashItem",
            async (vehicleId, itemId, userId, amount = 1) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               await SiegeSocketManager._doRemoveStashItem(
                  vehicleId,
                  itemId,
                  userId,
                  amount,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
            },
         )

         globalThis.siegeSocket.register(
            "putStashItem",
            async (vehicleId, itemUuid, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               await SiegeSocketManager._doPutStashItem(
                  vehicleId,
                  itemUuid,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
            },
         )

         globalThis.siegeSocket.register(
            "moveStashItem",
            async (vehicleId, itemId, targetUuid, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               await SiegeSocketManager._doMoveStashItem(
                  vehicleId,
                  itemId,
                  targetUuid,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
            },
         )

         globalThis.siegeSocket.register(
            "dropStashItemToGround",
            async (vehicleId, itemId, sceneId, x, y, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               await SiegeSocketManager._doDropStashItemToGround(
                  vehicleId,
                  itemId,
                  sceneId,
                  x,
                  y,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
            },
         )

         globalThis.siegeSocket.register(
            "installModule",
            async (vehicleId, slotId, itemRef, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               const result = await SiegeSocketManager._doInstallModule(
                  vehicleId,
                  slotId,
                  itemRef,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
               return result
            },
         )

         globalThis.siegeSocket.register(
            "deinstallModule",
            async (vehicleId, slotId, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               const result = await SiegeSocketManager._doDeinstallModule(
                  vehicleId,
                  slotId,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
               return result
            },
         )

         globalThis.siegeSocket.register("notifyUser", async (payload) => {
            const { tKey } = await import("../utils.mjs")
            const msg = payload.key ? tKey(payload.key, payload.data || {}) : payload.text
            if (payload.type === "error") ui.notifications.error(msg)
            else if (payload.type === "warn") ui.notifications.warn(msg)
            else ui.notifications.info(msg)
         })

         globalThis.siegeSocket.register(
            "changePosition",
            async (crewmanUuid, vehicleId, newPosition) => {
               const { VehicleEntryManager } = await import("./entry.mjs")
               await VehicleEntryManager._doChangePosition(
                  crewmanUuid,
                  vehicleId,
                  newPosition,
               )
            },
         )

globalThis.siegeSocket.register(
            "promptSwapConsent",
            async (payload) => {
               const { tKey } = await import("../utils.mjs")
               const ok = await foundry.applications.api.DialogV2.confirm({
                  classes: ["siege-v2-dialog"],
                  window: { title: tKey("CrewHUD.SwitchRequestTitle") },
                  content: `<p>${tKey("CrewHUD.SwitchRequest", {
                     mover: payload.moverName,
                     you: payload.displacedName,
                     pos: payload.newPos,
                     cur: payload.oldPos,
                  })}</p>`,
               }).catch(() => false)
               return !!ok
            },
         )
      }

      Hooks.once("socketlib.ready", registerSocket)
      Hooks.once("ready", () => {
         if (game.modules.get("socketlib")?.active) registerSocket()
      })
   }

   static async applyVehicleHpDelta(vehicle, delta) {
      if (!vehicle || !Number.isFinite(Number(delta))) return false
      if (game.user.isGM || !globalThis.siegeSocket)
         return this._doApplyVehicleHpDelta(vehicle, delta)
      return globalThis.siegeSocket.executeAsGM(
         "applyVehicleHpDelta",
         vehicle.uuid,
         Number(delta),
      )
   }

   static async _doApplyVehicleHpDelta(vehicle, delta) {
      const actor = vehicle?.actor || vehicle
      if (!actor) return false
      const hp = actor.system?.attributes?.hp || {}
      const current = Number(hp.value) || 0
      const max = Number(hp.max) || current
      const next = Math.max(0, Math.min(max, current + Number(delta)))
      if (next === current) return { old: current, value: next, max }
      await actor.update({ "system.attributes.hp.value": next })
      return { old: current, value: next, max }
   }

}

Object.assign(
   SiegeSocketManager,
   socketItemMethods,
   socketStashModuleMethods,
   socketAmmoLoadMethods,
   socketMovementMethods,
)
