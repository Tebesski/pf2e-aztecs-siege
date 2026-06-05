import { MODULE_ID } from "../constants.mjs"
import { tKey, isSiege, getAllActors, buildCrewLeaderEffect } from "../utils.mjs"
import { SiegeSocketManager } from "./sockets.mjs"
import { getLifterCapacity, collectLifters } from "./portable-helpers.mjs"

export class SiegePortableManager {
   static _shiftIsPressed = false
   static _operationQueue = new Map()

   static async enqueue(siegeId, func) {
      if (!siegeId) return
      const current = this._operationQueue.get(siegeId) || Promise.resolve()
      const next = current.then(() => func()).catch(() => {})
      this._operationQueue.set(siegeId, next)
      return next
   }

   static initHooks() {
      Hooks.on("preDeleteItem", (item, options, userId) =>
         this.onPreDeleteItem(item, options, userId),
      )
      Hooks.on("preUpdateItem", (item, changes, options, userId) =>
         this.onPreUpdateItem(item, changes, options, userId),
      )
      Hooks.on("updateItem", (item, changes, options, userId) =>
         this.onUpdateItem(item, changes, options, userId),
      )
      Hooks.on("deleteItem", (item, options, userId) =>
         this.onDeleteItem(item, options, userId),
      )

      const track = (e) => (this._shiftIsPressed = e.shiftKey)
      window.addEventListener("mousedown", track, { capture: true })
      window.addEventListener(
         "keydown",
         (e) => {
            if (e.key === "Shift") this._shiftIsPressed = true
         },
         { capture: true },
      )
      window.addEventListener(
         "keyup",
         (e) => {
            if (e.key === "Shift") this._shiftIsPressed = false
         },
         { capture: true },
      )
   }

   static _getSiegeActor(siegeId) {
      if (!siegeId) return null
      const tokenActor = canvas?.tokens?.placeables?.find(
         (t) => t.actor?.id === siegeId,
      )?.actor
      return tokenActor || game.actors.get(siegeId)
   }

   static onPreDeleteItem(item, options, userId) {
      if (game.user.id !== userId) return
      if (options.systemDeletion || options.siegeDropCascade) return
      if (
         item.name === tKey("ActionTemplates.CarryInConcert.Name") &&
         item.parent &&
         isSiege(item.parent)
      ) {
         ui.notifications.warn(tKey("Notifications.CannotRemoveCarryInConcert"))
         return false
      }
   }

   static onPreUpdateItem(item, changes, options) {
      if (options.siegeDropCascade) return
      const isLiftingEffect =
         item.type === "effect" && item.getFlag(MODULE_ID, "isLiftingEffect")
      const isLiftedItem = item.getFlag(MODULE_ID, "isLiftedItem")
      if (!isLiftingEffect && !isLiftedItem) return

      const newBulkRaw = isLiftingEffect
         ? foundry.utils.getProperty(changes, "system.badge.value")
         : foundry.utils.getProperty(changes, "system.bulk.value")
      if (newBulkRaw === undefined) return

      const oldBulk = isLiftingEffect
         ? item.system.badge?.value || 0
         : item.system.bulk?.value || 0
      if (isLiftingEffect) options.siegeOldBadge = oldBulk
      else options.siegeOldBulk = oldBulk
   }

   static async onUpdateItem(item, changes, options) {
      if (!game.user.isGM || options.siegeDropCascade) return
      const isLiftingEffect =
         item.type === "effect" && item.getFlag(MODULE_ID, "isLiftingEffect")
      if (!isLiftingEffect) return

      const siegeId = item.getFlag(MODULE_ID, "siegeId")
      if (!siegeId) return

      await this.enqueue(siegeId, async () => {
         const actor = item.parent
         const siege = this._getSiegeActor(siegeId)
         if (!actor || !siege) return

         const newBulk = item.system.badge?.value || 0
         const oldBulk = options.siegeOldBadge ?? newBulk
         if (newBulk === oldBulk) return

         await this._syncPair(actor, siege, newBulk)

         if (newBulk < oldBulk) {
            const success = await this._redistributeFreed(
               siege,
               oldBulk - newBulk,
               actor.id,
            )
            if (!success) {
               await this._clearPortableMarkers(siege)
               await this._doSyncPortableState(siege, null, true)
            } else {
               await this._doSyncPortableState(siege)
            }
         } else {
            await this._doSyncPortableState(siege)
         }
      })
   }

   static async onDeleteItem(item, options) {
      if (!game.user.isGM || options.siegeDropCascade || options.systemDeletion)
         return

      const siegeId = item.getFlag(MODULE_ID, "siegeId")
      if (!siegeId) {
         const isMarker =
            (item.name === tKey("Markers.Dropped") ||
               item.name === tKey("Markers.Lifted")) &&
            item.getFlag(MODULE_ID, "isPortableMarker")
         if (isMarker && item.parent)
            await this.enqueue(item.parent.id, () =>
               this._doSyncPortableState(item.parent),
            )
         return
      }

      await this.enqueue(siegeId, async () => {
         if (item.type === "effect" && item.getFlag(MODULE_ID, "isCrewLeader")) {
            if (options.siegeLeadershipDelegation) return
            await this._reassignCrewLeader(siegeId, item.parent.id)
            return
         }

         if (item.type === "effect" && item.getFlag(MODULE_ID, "position")) {
            await this._onPositionDeleted(item, siegeId)
            return
         }

         if (
            item.type === "effect" &&
            item.getFlag(MODULE_ID, "isLiftingEffect")
         ) {
            await this._onLiftingEffectDeleted(item, siegeId)
            return
         }

         if (item.getFlag(MODULE_ID, "isLiftedItem")) {
            const actor = item.parent
            const linkedEffect = actor.items.find(
               (i) =>
                  i.type === "effect" &&
                  i.getFlag(MODULE_ID, "isLiftingEffect") &&
                  i.getFlag(MODULE_ID, "siegeId") === siegeId,
            )
            if (linkedEffect)
               await actor.deleteEmbeddedDocuments("Item", [linkedEffect.id], {
                  siegeDropCascade: true,
               })
         }
      })
   }

   static async _onPositionDeleted(item, siegeId) {
      const actor = item.parent
      const siege = this._getSiegeActor(siegeId)
      if (!actor || !siege) return

      const liftingEffect = actor.items.find(
         (i) =>
            i.type === "effect" &&
            i.getFlag(MODULE_ID, "isLiftingEffect") &&
            i.getFlag(MODULE_ID, "siegeId") === siegeId,
      )
      const liftedItem = actor.items.find(
         (i) =>
            i.getFlag(MODULE_ID, "isLiftedItem") &&
            i.getFlag(MODULE_ID, "siegeId") === siegeId,
      )
      const leaderEffect = actor.items.find(
         (i) =>
            i.getFlag(MODULE_ID, "isCrewLeader") &&
            i.getFlag(MODULE_ID, "siegeId") === siegeId,
      )

      let oldBulk = 0
      const toDelete = []
      if (liftingEffect) {
         oldBulk = liftingEffect.system.badge?.value || 0
         toDelete.push(liftingEffect.id)
      }
      if (liftedItem) toDelete.push(liftedItem.id)
      if (leaderEffect) {
         toDelete.push(leaderEffect.id)
         await this._reassignCrewLeader(siegeId, actor.id)
      }
      if (toDelete.length > 0)
         await actor.deleteEmbeddedDocuments("Item", toDelete, {
            siegeDropCascade: true,
         })

      if (oldBulk > 0) {
         const success = await this._redistributeFreed(siege, oldBulk, actor.id)
         if (!success) {
            await this._clearPortableMarkers(siege)
            await this._doSyncPortableState(siege, null, true)
         } else {
            await this._doSyncPortableState(siege)
         }
      }
   }

   static async _onLiftingEffectDeleted(item, siegeId) {
      const actor = item.parent
      const siege = game.actors.get(siegeId)
      if (!actor || !siege) return

      const leaderEffect = actor.items.find(
         (i) =>
            i.getFlag(MODULE_ID, "isCrewLeader") &&
            i.getFlag(MODULE_ID, "siegeId") === siegeId,
      )
      if (leaderEffect) {
         await actor.deleteEmbeddedDocuments("Item", [leaderEffect.id], {
            siegeDropCascade: true,
         })
         await this._reassignCrewLeader(siegeId, actor.id)
      }

      const linkedItem = actor.items.find(
         (i) =>
            i.getFlag(MODULE_ID, "isLiftedItem") &&
            i.getFlag(MODULE_ID, "siegeId") === siegeId,
      )
      if (linkedItem)
         await actor.deleteEmbeddedDocuments("Item", [linkedItem.id], {
            siegeDropCascade: true,
         })

      const oldBulk = item.system.badge?.value || 0
      const success = await this._redistributeFreed(siege, oldBulk, actor.id)
      if (!success) {
         await this._clearPortableMarkers(siege)
         await this._doSyncPortableState(siege, item.id, true)
      } else {
         await this._doSyncPortableState(siege, item.id)
      }
   }

   static async _syncPair(actor, siege, newBulk) {
      const liftedItem = actor.items.find(
         (i) =>
            i.getFlag(MODULE_ID, "isLiftedItem") &&
            i.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (liftedItem && (liftedItem.system?.bulk?.value || 0) !== newBulk)
         await actor.updateEmbeddedDocuments(
            "Item",
            [{ _id: liftedItem.id, "system.bulk.value": newBulk }],
            { siegeDropCascade: true },
         )
   }

   static async _redistributeFreed(siege, freedBulk, excludeActorId) {
      if (freedBulk <= 0) return true
      const others = collectLifters(siege, { excludeActorId })
      if (others.length === 0) return false

      const assignments = new Map(others.map((o) => [o.actor.id, o.currentBulk]))
      let remaining = freedBulk
      let possible = true

      while (remaining > 0 && possible) {
         possible = false
         others.sort(
            (a, b) => assignments.get(a.actor.id) - assignments.get(b.actor.id),
         )
         for (const o of others) {
            if (remaining <= 0) break
            const current = assignments.get(o.actor.id)
            if (o.baseOtherBulk + current + 1 >= o.maxLimit) continue
            assignments.set(o.actor.id, current + 1)
            remaining -= 1
            possible = true
         }
      }

      if (remaining > 0) return false

      for (const o of others) {
         const newBulk = assignments.get(o.actor.id)
         if (newBulk !== o.currentBulk) await this._setLifterBulk(o, newBulk)
      }
      return true
   }

   static async _setLifterBulk(lifter, newBulk) {
      const { actor, liftedItem, liftingEffect } = lifter
      const updates = []
      if (liftedItem && (liftedItem.system?.bulk?.value || 0) !== newBulk)
         updates.push({ _id: liftedItem.id, "system.bulk.value": newBulk })
      if (liftingEffect && (liftingEffect.system?.badge?.value || 0) !== newBulk)
         updates.push({ _id: liftingEffect.id, "system.badge.value": newBulk })
      if (updates.length > 0)
         await actor.updateEmbeddedDocuments("Item", updates, {
            siegeDropCascade: true,
         })
   }

   static async _reassignCrewLeader(siegeId, excludeActorId) {
      const siege = game.actors.get(siegeId)
      if (!siege) return
      const candidates = collectLifters(siege, { excludeActorId }).filter(
         (l) => l.currentBulk > 0,
      )
      if (candidates.length === 0) return
      const target =
         candidates[Math.floor(Math.random() * candidates.length)].actor
      await SiegeSocketManager.modifySiegeItem(target.uuid, "create", [
         buildCrewLeaderEffect(siegeId),
      ])
   }

   static async syncPortableState(siege, deletedItemId = null, forceDrop = false) {
      if (!siege) return
      if (!game.user.isGM) {
         if (globalThis.siegeSocket)
            await globalThis.siegeSocket.executeAsGM(
               "syncPortableState",
               siege.uuid,
               deletedItemId,
               forceDrop,
            )
         return
      }
      await this.enqueue(siege.id, () =>
         this._doSyncPortableState(siege, deletedItemId, forceDrop),
      )
   }

   static async _doSyncPortableState(siege, deletedItemId = null, forceDrop = false) {
      if (!siege) return

      if (!(siege.system.traits?.value || []).includes("portable")) {
         await this._clearPortableMarkers(siege)
         forceDrop = true
      }

      const totalBulk = parseInt(siege.getFlag(MODULE_ID, "bulk")) || 0
      let currentlyLifted = 0
      if (!forceDrop) {
         for (const actor of getAllActors()) {
            const effects = actor.items.filter(
               (i) =>
                  i.id !== deletedItemId &&
                  i.type === "effect" &&
                  i.getFlag(MODULE_ID, "isLiftingEffect") &&
                  i.getFlag(MODULE_ID, "siegeId") === siege.id,
            )
            for (const e of effects) currentlyLifted += e.system.badge?.value || 0
         }
      }

      const droppedRemaining = Math.max(0, totalBulk - currentlyLifted)
      const droppedName = tKey("Markers.Dropped")
      const liftedName = tKey("Markers.Lifted")
      const droppedMarkers = siege.itemTypes.effect.filter(
         (e) =>
            e.name === droppedName && e.getFlag(MODULE_ID, "isPortableMarker"),
      )
      const liftedMarkers = siege.itemTypes.effect.filter(
         (e) =>
            e.name === liftedName && e.getFlag(MODULE_ID, "isPortableMarker"),
      )

      if (droppedRemaining <= 0 && totalBulk > 0) {
         if (droppedMarkers.length > 0)
            await SiegeSocketManager.modifySiegeItem(
               siege.uuid,
               "delete",
               droppedMarkers.map((m) => m.id),
               { systemDeletion: true },
            )
         if (liftedMarkers.length === 0) {
            await SiegeSocketManager.modifySiegeItem(siege.uuid, "create", [
               {
                  name: liftedName,
                  type: "effect",
                  img: "icons/svg/upgrade.svg",
                  system: {
                     level: { value: 1 },
                     description: {
                        value: tKey("Markers.LiftedDesc", { name: siege.name }),
                     },
                     tokenIcon: { show: true },
                  },
                  flags: { [MODULE_ID]: { isPortableMarker: true } },
               },
            ])
         } else if (liftedMarkers.length > 1) {
            await SiegeSocketManager.modifySiegeItem(
               siege.uuid,
               "delete",
               liftedMarkers.slice(1).map((m) => m.id),
               { systemDeletion: true },
            )
         }
      } else {
         if (liftedMarkers.length > 0)
            await SiegeSocketManager.modifySiegeItem(
               siege.uuid,
               "delete",
               liftedMarkers.map((m) => m.id),
               { systemDeletion: true },
            )
         if (droppedMarkers.length > 0) {
            const primary = droppedMarkers[0]
            if (primary.system.badge?.value !== droppedRemaining)
               await SiegeSocketManager.modifySiegeItem(siege.uuid, "update", [
                  { _id: primary.id, "system.badge.value": droppedRemaining },
               ])
            if (droppedMarkers.length > 1)
               await SiegeSocketManager.modifySiegeItem(
                  siege.uuid,
                  "delete",
                  droppedMarkers.slice(1).map((m) => m.id),
                  { systemDeletion: true },
               )
         } else if (totalBulk > 0) {
            await SiegeSocketManager.modifySiegeItem(siege.uuid, "create", [
               {
                  name: droppedName,
                  type: "effect",
                  img: "icons/svg/downgrade.svg",
                  system: {
                     level: { value: 1 },
                     badge: { type: "counter", value: droppedRemaining },
                     description: {
                        value: tKey("Markers.DroppedDescFull", {
                           name: siege.name,
                        }),
                     },
                     tokenIcon: { show: true },
                  },
                  flags: { [MODULE_ID]: { isPortableMarker: true } },
               },
            ])
         }
      }

      if (siege.sheet?.rendered) siege.sheet.render(false)
      const { SiegeCrewManager } = await import("./crew.mjs")
      await SiegeCrewManager.updateSiegeSpeed(siege)
   }

   static async _clearPortableMarkers(siege) {
      for (const actor of getAllActors()) {
         const ids = actor.items
            .filter(
               (i) =>
                  i.getFlag(MODULE_ID, "siegeId") === siege.id &&
                  (i.getFlag(MODULE_ID, "isLiftingEffect") ||
                     i.getFlag(MODULE_ID, "isLiftedItem") ||
                     i.getFlag(MODULE_ID, "isCrewLeader")),
            )
            .map((i) => i.id)
         if (ids.length > 0)
            await actor.deleteEmbeddedDocuments("Item", ids, {
               siegeDropCascade: true,
            })
      }
   }

   static _getLifterCapacity(actor, currentLiftedBulk = 0) {
      return getLifterCapacity(actor, currentLiftedBulk)
   }

   static _collectLifters(siege, options = {}) {
      return collectLifters(siege, options)
   }

   static async rebalanceLifters(siege) {
      if (!game.user.isGM || !siege) return
      await this.syncPortableState(siege)
   }
}
