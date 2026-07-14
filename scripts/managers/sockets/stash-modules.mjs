import { MODULE_ID } from "../../constants.mjs"
import { tKey } from "../../utils.mjs"
import { staticMethods } from "./helpers.mjs"

const GROUND_STASH_IMG =
   "systems/pf2e/icons/equipment/adventuring-gear/alchemists-lab.webp"

class SocketStashModuleMixin {


   static async takeStashItem(vehicleId, itemId, userId) {
      if (game.user.isGM) {
         await this._doTakeStashItem(vehicleId, itemId, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "takeStashItem",
            vehicleId,
            itemId,
            userId,
         )
      }
   }



   static async removeStashItem(vehicleId, itemId, userId, amount = 1) {
      if (game.user.isGM) {
         await this._doRemoveStashItem(vehicleId, itemId, userId, amount)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "removeStashItem",
            vehicleId,
            itemId,
            userId,
            amount,
         )
      }
   }



   static async putStashItem(vehicleId, itemUuid, userId) {
      if (game.user.isGM) {
         await this._doPutStashItem(vehicleId, itemUuid, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "putStashItem",
            vehicleId,
            itemUuid,
            userId,
         )
      }
   }



   static async moveStashItem(vehicleId, itemId, targetUuid, userId) {
      if (game.user.isGM) {
         await this._doMoveStashItem(vehicleId, itemId, targetUuid, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "moveStashItem",
            vehicleId,
            itemId,
            targetUuid,
            userId,
         )
      }
   }



   static async dropStashItemToGround(vehicleId, itemId, sceneId, x, y, userId) {
      if (game.user.isGM) {
         await this._doDropStashItemToGround(vehicleId, itemId, sceneId, x, y, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "dropStashItemToGround",
            vehicleId,
            itemId,
            sceneId,
            x,
            y,
            userId,
         )
      }
   }



   static async installModule(vehicleId, slotId, itemRef, userId = game.user.id) {
      if (game.user.isGM) {
         const result = await this._doInstallModule(vehicleId, slotId, itemRef, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
         return result
      } else if (globalThis.siegeSocket) {
         return globalThis.siegeSocket.executeAsGM(
            "installModule",
            vehicleId,
            slotId,
            itemRef,
            userId,
         )
      }
      ui.notifications.error(tKey("Notifications.SocketlibRequired"))
      return false
   }



   static async deinstallModule(vehicleId, slotId, userId = game.user.id) {
      if (game.user.isGM) {
         const result = await this._doDeinstallModule(vehicleId, slotId, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
         return result
      } else if (globalThis.siegeSocket) {
         return globalThis.siegeSocket.executeAsGM(
            "deinstallModule",
            vehicleId,
            slotId,
            userId,
         )
      }
      ui.notifications.error(tKey("Notifications.SocketlibRequired"))
      return false
   }



   static async _doMoveStashItem(vehicleId, itemId, targetUuid, userId) {
      const { tKey } = await import("../../utils.mjs")
      const vehicle = game.actors.get(vehicleId)
      const item = vehicle?.items.get(itemId)
      if (!vehicle || !item) return
      const target = await fromUuid(targetUuid)
      const targetActor =
         target?.documentName === "Actor" ? target : target?.actor
      if (!targetActor) return
      if (targetActor.id === vehicle.id) return
      const data = item.toObject()
      delete data._id
      delete data.ownership
      await targetActor.createEmbeddedDocuments("Item", [data])
      await vehicle.deleteEmbeddedDocuments("Item", [item.id])
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
            type: "info",
            key: "Stash.MovedTo",
            data: { name: item.name, target: targetActor.name },
         })
   }



   static async _doDropStashItemToGround(
      vehicleId,
      itemId,
      sceneId,
      x,
      y,
      userId,
   ) {
      const vehicle = game.actors.get(vehicleId)
      const item = vehicle?.items.get(itemId)
      const scene = game.scenes.get(sceneId) || canvas?.scene
      if (!vehicle || !item || !scene) return

      const data = item.toObject()
      delete data._id
      delete data.ownership

      const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3
      const actor = await Actor.create({
         name: item.name,
         type: "loot",
         img: GROUND_STASH_IMG,
         ownership: { default: owner },
         flags: { [MODULE_ID]: { isGroundStash: true } },
      })
      if (!actor) return

      await actor.createEmbeddedDocuments("Item", [data])
      await scene.createEmbeddedDocuments("Token", [
         {
            name: actor.name,
            actorId: actor.id,
            actorLink: true,
            x,
            y,
            width: 1,
            height: 1,
            img: GROUND_STASH_IMG,
            texture: { src: GROUND_STASH_IMG },
            disposition: CONST.TOKEN_DISPOSITIONS?.NEUTRAL ?? 0,
            flags: { [MODULE_ID]: { isGroundStash: true } },
         },
      ])
      await vehicle.deleteEmbeddedDocuments("Item", [item.id])
   }



   static async _doRemoveStashItem(vehicleId, itemId, userId, amount = 1) {
      const vehicle = game.actors.get(vehicleId)
      const item = vehicle?.items.get(itemId)
      if (!vehicle || !item) return
      const name = item.name
      const quantity = Math.max(1, Number(item.system?.quantity) || 1)
      const removed = Math.max(1, Math.min(quantity, parseInt(amount) || 1))
      if (quantity > removed && item.system?.quantity !== undefined) {
         await item.update({ "system.quantity": quantity - removed })
      } else {
         await vehicle.deleteEmbeddedDocuments("Item", [item.id])
      }
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
            type: "info",
            key: "Stash.Removed",
            data: { name: removed > 1 ? `${removed} x ${name}` : name },
         })
   }



   static async _doTakeStashItem(vehicleId, itemId, userId) {
      const { tKey } = await import("../../utils.mjs")
      const vehicle = game.actors.get(vehicleId)
      const item = vehicle?.items.get(itemId)
      const user = game.users.get(userId)
      const target = user?.character
      if (!vehicle || !item) return
      if (!target) {
         if (user?.isGM) {
            const name = item.name
            await vehicle.deleteEmbeddedDocuments("Item", [item.id])
            if (globalThis.siegeSocket)
               globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
                  type: "info",
                  key: "Stash.Removed",
                  data: { name },
               })
            return
         }
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
               type: "warn",
               key: "Stash.NoCharacter",
            })
         return
      }
      const data = item.toObject()
      delete data._id
      delete data.ownership
      await target.createEmbeddedDocuments("Item", [data])
      await vehicle.deleteEmbeddedDocuments("Item", [item.id])
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
            type: "info",
            key: "Stash.Took",
            data: { name: item.name },
         })
   }



   static async _doPutStashItem(vehicleId, itemUuid, userId) {
      const vehicle = game.actors.get(vehicleId)
      if (!vehicle) return
      const item = await fromUuid(itemUuid)
      if (!item) return
      if (item.parent?.id === vehicle.id) return
      const data = item.toObject()
      delete data._id
      delete data.ownership
      await vehicle.createEmbeddedDocuments("Item", [data])
      
      const sourceActor = item.parent
      if (sourceActor && sourceActor.documentName === "Actor" && sourceActor.id !== vehicle.id) {
         try {
            await sourceActor.deleteEmbeddedDocuments("Item", [item.id])
         } catch (e) {
            
         }
      }
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
            type: "info",
            key: "Stash.Stored",
            data: { name: item.name },
         })
   }



   static async _resolveModuleItem(vehicle, itemRef) {
      if (!vehicle || !itemRef) return null
      const local = vehicle.items.get(itemRef)
      if (local) return local
      const world = game.items.get(itemRef)
      if (world) return world
      return await fromUuid(itemRef).catch(() => null)
   }



   static async _doInstallModule(vehicleId, slotId, itemRef) {
      const { VehicleModulesManager } = await import("../modules.mjs")
      const vehicle = game.actors.get(vehicleId)
      if (!vehicle) return false
      const board = VehicleModulesManager.moduleBoard(vehicle)
      const slot = board.slots.find((s) => s.id === slotId)
      if (!slot || slot.installedItemId) return false
      const item = await this._resolveModuleItem(vehicle, itemRef)
      if (!item || !VehicleModulesManager.isEligibleForSlot(vehicle, item, slot))
         return false
      const installed = VehicleModulesManager.installedModuleIds(vehicle)
      if (installed.has(item.id)) return false
      let installItem = item
      if (item.parent?.id !== vehicle.id) {
         const sourceActor = item.parent
         const data = item.toObject()
         delete data._id
         delete data.ownership
         const created = await vehicle.createEmbeddedDocuments("Item", [data], {
            siegeModuleSync: true,
         })
         installItem = created?.[0]
         if (!installItem) return false
         if (sourceActor?.documentName === "Actor" && sourceActor.id !== vehicle.id) {
            try {
               await sourceActor.deleteEmbeddedDocuments("Item", [item.id])
            } catch {
               
            }
         }
      }
      slot.installedItemId = installItem.id
      await vehicle.setFlag(
         MODULE_ID,
         "moduleBoard",
         VehicleModulesManager.normalizeBoard(board),
      )
      await VehicleModulesManager.syncVehicle(vehicle)
      return true
   }



   static async _doDeinstallModule(vehicleId, slotId) {
      const { VehicleModulesManager } = await import("../modules.mjs")
      const vehicle = game.actors.get(vehicleId)
      if (!vehicle) return false
      const board = VehicleModulesManager.moduleBoard(vehicle)
      const slot = board.slots.find((s) => s.id === slotId)
      if (!slot || !slot.installedItemId) return false
      slot.installedItemId = ""
      await vehicle.setFlag(
         MODULE_ID,
         "moduleBoard",
         VehicleModulesManager.normalizeBoard(board),
      )
      await VehicleModulesManager.syncVehicle(vehicle)
      return true
   }
}

export const socketStashModuleMethods = staticMethods(SocketStashModuleMixin)
