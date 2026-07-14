import { MODULE_ID } from "../constants.mjs"
import { slugify, tKey } from "../utils.mjs"

const LAUNCH_IMG = "icons/sundries/misc/key-modern.webp"

export class VehicleLaunchManager {
   static initHooks() {
      if (!globalThis.siegeSocket) return
      
   }

   static isLaunched(vehicle) {
      return !!vehicle?.itemTypes?.effect?.some((e) =>
         e.getFlag(MODULE_ID, "isLaunched"),
      )
   }

   static async toggleLaunched(vehicle, actor = null) {
      if (!vehicle) return
      const actorUuid = actor?.uuid || null
      if (!this.isLaunched(vehicle) && !(await this._canStartIgnition(vehicle, actorUuid)))
         return false
      if (game.user.isGM) {
         await this._doToggle(vehicle.id, actorUuid, game.user.id)
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "toggleLaunched",
            vehicle.id,
            actorUuid,
            game.user.id,
         )
      }
   }

   static async _doToggle(vehicleId, actorUuid = null, sourceUserId = null) {
      const vehicle = game.actors.get(vehicleId)
      if (!vehicle) return
      const { SiegeSFXManager } = await import("./sfx.mjs")
      const existing = vehicle.itemTypes.effect.filter((e) =>
         e.getFlag(MODULE_ID, "isLaunched"),
      )
      if (existing.length > 0) {
         await vehicle.deleteEmbeddedDocuments(
            "Item",
            existing.map((e) => e.id),
         )
         SiegeSFXManager.play(vehicle, "stopIgnition", sourceUserId)
         ui.notifications.info(
            tKey("CrewHUD.LandedNotice", { name: vehicle.name }),
         )
      } else {
         if (!(await this._canStartIgnition(vehicle, actorUuid))) return false
         SiegeSFXManager.warmMovementSFX(vehicle)
         await vehicle.createEmbeddedDocuments("Item", [
            {
               name: tKey("CrewHUD.LaunchedEffect"),
               type: "effect",
               img: LAUNCH_IMG,
               system: {
                  description: { value: tKey("CrewHUD.LaunchedDesc") },
                  tokenIcon: { show: true },
                  duration: {
                     value: -1,
                     unit: "unlimited",
                     sustained: false,
                     expiry: null,
                  },
               },
               flags: { [MODULE_ID]: { isLaunched: true } },
            },
         ])
         SiegeSFXManager.play(vehicle, "launch", sourceUserId)
         ui.notifications.info(
            tKey("CrewHUD.LaunchedNotice", { name: vehicle.name }),
         )
      }
      
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeForEveryone("refreshCrewHud", vehicleId)
      const { CrewHUD } = await import("../ui/crew-hud.mjs")
      CrewHUD.refreshFor(vehicleId)
      return true
   }

   static _requiredIgnitionSlugs(vehicle) {
      return String(vehicle?.getFlag?.(MODULE_ID, "ignitionItemSlugs") || "")
         .split(",")
         .map((slug) => slugify(slug.trim()))
         .filter(Boolean)
   }

   static async _canStartIgnition(vehicle, actorUuid = null) {
      const required = this._requiredIgnitionSlugs(vehicle)
      if (required.length === 0) return true
      const actors = this._driverActors(vehicle)
      if (actorUuid) {
         try {
            const actor = await fromUuid(actorUuid)
            if (
               actor &&
               this._isDriverActor(actor, vehicle) &&
               !actors.some((a) => a.id === actor.id)
            )
               actors.push(actor)
         } catch (_e) {}
      }
      const hasRequired = actors.some((actor) =>
         actor.items?.some((item) =>
            required.includes(slugify(item.system?.slug || item.name)),
         ),
      )
      if (hasRequired) return true
      ui.notifications.warn(
         tKey("CrewHUD.IgnitionItemRequired", {
            slugs: required.join(", "),
         }),
      )
      return false
   }

   static _driverActors(vehicle) {
      if (!vehicle) return []
      return game.actors.filter((actor) => this._isDriverActor(actor, vehicle))
   }

   static _isDriverActor(actor, vehicle) {
      return !!actor?.itemTypes?.effect?.some(
         (effect) =>
            effect.getFlag(MODULE_ID, "siegeId") === vehicle?.id &&
            ["Driver", "Operator"].includes(
               effect.getFlag(MODULE_ID, "position"),
            ),
      )
   }
}
